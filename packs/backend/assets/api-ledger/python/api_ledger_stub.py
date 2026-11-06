"""외부 API 시뮬레이터 (kedovi apiledger add python 이 넣음). 장부(api-ledger.yaml)를 읽어 API 마다 로컬 HTTP 서버를 띄운다.

응답 칸: status · headers · body · delayMs(머리 전 지연) · stallBodyMs(본문 절반 뒤 멈춤) · reset(연결 끊기) · failTimes(앞 N 번만)
measured 동작은 observed(실제로 본 응답), unverified 는 worst(최악 응답)로 응답한다. 의존성: PyYAML.
"""
from __future__ import annotations

import json
import os
import re
import socket
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import yaml

FAULT_KINDS = ["rate-limit", "slow", "empty", "transient-404", "body-stall", "token-slow"]


def ledger_path() -> Path:
    return Path(os.environ.get("API_LEDGER", "api-ledger.yaml")).resolve()


def load_ledger(path: Path | None = None) -> dict:
    with open(path or ledger_path(), encoding="utf-8") as f:
        return yaml.safe_load(f)


def endpoints(ledger: dict) -> list[dict]:
    out = []
    for api in ledger.get("apis") or []:
        for ep in api.get("endpoints") or []:
            out.append({"key": f"{api['id']}/{ep['id']}", "api": api["id"], "ep": ep})
    return out


def problems(ledger: dict) -> list[str]:
    """시험 안에서 보는 최소 형식 검사 (확인일이 오래된 것은 kedovi apiledger check 가 본다)."""
    out = []
    if ledger.get("version") != 1:
        out.append("version: 1 이 없다")
    for e in endpoints(ledger):
        for b in e["ep"].get("behaviors") or []:
            k = f"{e['key']}/{b.get('id')}"
            if b.get("status") not in ("measured", "unverified"):
                out.append(f"{k}: status 는 measured · unverified")
            elif b["status"] == "measured" and not (b.get("checked") and b.get("evidence") and b.get("observed") is not None):
                out.append(f"{k}: measured 는 checked · evidence · observed 가 있어야 한다")
            elif b["status"] == "unverified" and b.get("worst") is None:
                out.append(f"{k}: unverified 는 worst 가 있어야 한다")
    return out


def scenarios(ledger: dict) -> list[dict]:
    out = []
    for e in endpoints(ledger):
        for b in e["ep"].get("behaviors") or []:
            measured = b.get("status") == "measured"
            resp = (b.get("observed") or b.get("worst")) if measured else (b.get("worst") or b.get("observed"))
            out.append({"key": f"{e['key']}/{b['id']}", "endpoint": e["key"], "status": b.get("status"),
                        "kind": b.get("kind", ""), "what": b.get("what", ""), "response": resp or {}})
    return out


def faults(ledger: dict) -> list[dict]:
    out = []
    for e in endpoints(ledger):
        ep = e["ep"]
        t = ep.get("timeoutMs") or 5000
        ok_body = (ep.get("ok") or {}).get("body", "{}")
        defaults = {
            "rate-limit": {"status": 429},
            "slow": {"delayMs": t * 2},
            "empty": {"status": 200, "body": ""},
            "transient-404": {"status": 404, "failTimes": 1},
            "body-stall": {"status": 200, "body": ok_body, "stallBodyMs": t * 2},
            "token-slow": {"delayMs": round(t * 0.9)},
        }
        for kind in FAULT_KINDS:
            if kind == "token-slow" and ep.get("auth") != "token":
                continue
            b = next((x for x in ep.get("behaviors") or [] if x.get("kind") == kind), None)
            resp = (b.get("worst") or b.get("observed")) if b else defaults[kind]
            out.append({"key": f"{e['key']}#{kind}", "endpoint": e["key"], "kind": kind, "response": resp,
                        "from": f"{e['key']}/{b['id']}" if b else "기본값"})
    return out


def _route(path: str) -> re.Pattern:
    return re.compile("^" + "[^/]+".join(re.escape(p) for p in re.split(r"\{[^}]+\}", str(path))) + "$")


class Stub:
    """with Stub(ledger) as stub: stub.urls['partner'] · stub.use(키, 응답) · stub.calls(키)"""

    def __init__(self, ledger: dict | None = None):
        self.ledger = ledger or load_ledger()
        self.eps = endpoints(self.ledger)
        self.state: dict[str, dict] = {}
        self.urls: dict[str, str] = {}
        self.servers = []
        self.reset()

    def reset(self):
        self.state = {e["key"]: {"response": None, "used": 0, "calls": 0} for e in self.eps}

    def use(self, key: str, response: dict):
        if key not in self.state:
            raise KeyError(f"장부에 없는 엔드포인트: {key}")
        self.state[key].update(response=response, used=0)

    def calls(self, key: str) -> int:
        return self.state[key]["calls"]

    def __enter__(self):
        for api_id in dict.fromkeys(e["api"] for e in self.eps):
            mine = [{**e, "re": _route(e["ep"]["path"])} for e in self.eps if e["api"] == api_id]
            server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler(mine))
            server.daemon_threads = True
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.urls[api_id] = f"http://127.0.0.1:{server.server_address[1]}"
            self.servers.append(server)
        return self

    def __exit__(self, *exc):
        for s in self.servers:
            s.shutdown()
            s.server_close()

    def _handler(self, mine):
        stub = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _any(self):
                url = self.path.split("?")[0]
                e = next((x for x in mine if x["re"].match(url) and x["ep"].get("method", self.command) == self.command), None)
                if not e:
                    self.send_response(599)
                    self.end_headers()
                    return
                st = stub.state[e["key"]]
                st["calls"] += 1
                r = st["response"]
                if r and r.get("failTimes") is not None and st["used"] >= r["failTimes"]:
                    r = None
                if r:
                    st["used"] += 1
                ok = e["ep"].get("ok") or {}
                self._reply(r or ok or {"status": 200, "body": ""}, ok)

            def _reply(self, r, ok):
                if r.get("delayMs"):
                    time.sleep(r["delayMs"] / 1000)
                if r.get("reset"):
                    self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, b"\x01\x00\x00\x00\x00\x00\x00\x00")
                    self.connection.close()
                    return
                status = r.get("status", 200)
                body = r.get("body")
                if body is None:
                    body = "" if status != ok.get("status", 200) else ok.get("body", "")
                text = (body if isinstance(body, str) else json.dumps(body)).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                for k, v in (r.get("headers") or {}).items():
                    self.send_header(k, str(v))
                if r.get("stallBodyMs"):
                    text = text or b'{"stalled":true}'
                    self.send_header("content-length", str(len(text)))
                    self.end_headers()
                    half = len(text) // 2
                    self.wfile.write(text[:half])
                    self.wfile.flush()
                    time.sleep(r["stallBodyMs"] / 1000)
                    self.wfile.write(text[half:])
                    return
                self.send_header("content-length", str(len(text)))
                self.end_headers()
                self.wfile.write(text)

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _any

        return H


def write_covered(part: str, keys: list[str]):
    """시험이 다룬 항목을 .api-ledger/covered.json 에 (kedovi apiledger check 가 장부와 대조)."""
    f = Path(".api-ledger/covered.json")
    cur = {}
    if f.exists():
        try:
            cur = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            cur = {}
    cur[part] = sorted(set(keys))
    cur["at"] = datetime.now(timezone.utc).isoformat()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
