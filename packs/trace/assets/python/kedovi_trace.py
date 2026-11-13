# 실행 흐름 기록기 (Python: 3.12 이상은 sys.monitoring, 그 아래는 sys.settrace): 프로젝트 코드만 한 줄씩 기록해 JSON 으로 쓴다. kedovi trace run 이 띄운다
#
# 테스트: python -m pytest -p kedovi_trace <테스트>      (pytest 플러그인. 그 테스트 함수가 도는 동안 기록)
# 서버  : python -m kedovi_trace <모듈|파일.py> [인자…]   (예: uvicorn app:app · manage.py runserver). 표준 입력 「start」 에 기록을 켜고 「stop」 에 끄고 쓴다
# 설정(환경 변수): KEDOVI_TRACE_OUT(출력 파일) · KEDOVI_TRACE_ROOT(프로젝트 폴더) · KEDOVI_TRACE_TEST(기록할 테스트 nodeid)
#                 KEDOVI_TRACE_MAX_STEPS(5000) · KEDOVI_TRACE_MAX_HITS(30) · KEDOVI_TRACE_SQL(on|off)
# 값은 __dict__ · 슬롯 · 기본 자료형만 읽는다. 프로젝트 객체의 메서드 · 프로퍼티 · __repr__ 를 부르지 않는다 (실행 결과가 바뀌지 않게)
# 의존성 없음 (표준 라이브러리만)
import json
import os
import sys
import sysconfig
import threading
import time
import types
from enum import Enum

MAX_DEPTH, MAX_ITEMS, MAX_FIELDS, MAX_STR, MAX_EX = 3, 20, 40, 500, 50
SECRET = ("passw", "pwd", "secret", "token", "apikey", "api_key", "credential", "authorization", "private_key", "privatekey")
QUIET_EX = {"StopIteration", "StopAsyncIteration", "GeneratorExit", "CancelledError"}
HERE = os.path.dirname(os.path.abspath(__file__))
IMMUTABLE = {int, float, str, bool, type(None), bytes, complex}
DISABLE = getattr(getattr(sys, "monitoring", None), "DISABLE", None)


def _suspended(frame):
    """settrace 의 return 이 yield · await 로 멈춘 것인가 (끝난 것이 아니라)"""
    try:
        import dis
        if not frame.f_code.co_flags & 0x3A0:  # 제너레이터 · 코루틴 · async 제너레이터가 아니면 끝난 것
            return False
        code, i = frame.f_code.co_code, frame.f_lasti
        # 3.10 의 YIELD_FROM 은 f_lasti 를 한 칸 앞으로 돌려 둔다 (다시 실행하려고)
        return any(j < len(code) and dis.opname[code[j]] in ("YIELD_VALUE", "YIELD_FROM", "SEND") for j in (i, i + 2))
    except Exception:  # noqa: BLE001
        return False


def _secret(name):
    n = str(name).lower()
    return any(s in n for s in SECRET)


def _qual(t):
    m = getattr(t, "__module__", "") or ""
    q = getattr(t, "__qualname__", None) or getattr(t, "__name__", "?")
    return q if m in ("builtins", "") else f"{m}.{q}"


ROOT = [None]  # 프로젝트 폴더 (Recorder 가 정한다)
_MOD_OURS = {}


def _ours_type(t):
    """프로젝트 코드에 정의된 클래스인가 (아니면 라이브러리 객체: 공개 필드만 한 단계)"""
    m = getattr(t, "__module__", None) or ""
    r = _MOD_OURS.get(m)
    if r is None:
        f = getattr(sys.modules.get(m), "__file__", None) or ""
        f = os.path.realpath(f) if f else ""
        r = bool(ROOT[0]) and f.startswith(ROOT[0] + os.sep) and f"{os.sep}site-packages{os.sep}" not in f and f"{os.sep}.venv{os.sep}" not in f
        _MOD_OURS[m] = r
    return r


def _plain_dict(o):
    try:
        d = object.__getattribute__(o, "__dict__")
        return d if type(d) is dict else None
    except Exception:
        return None


def ser(v, depth=0, path=()):
    """값 → 화면용 JSON 값 (Java 기록기와 같은 모양: 기본값 · {t,f} · {t,n,items} · {t,n,entries} · {t,v})"""
    t = type(v)
    if v is None or t is bool:
        return v
    if t is int:
        return v if -(2 ** 53) < v < 2 ** 53 else {"t": "int", "v": str(v)}
    if t is float:
        return v if v == v and v not in (float("inf"), float("-inf")) else {"t": "float", "v": repr(v)}
    if t is str:
        return v if len(v) <= MAX_STR else v[:MAX_STR] + "…"
    if t in (bytes, bytearray, memoryview):
        return {"t": t.__name__, "n": len(v)}
    if isinstance(v, Enum):
        return {"t": _qual(t), "v": v.name}
    mod = getattr(t, "__module__", "")
    if mod in ("decimal", "datetime", "uuid", "pathlib", "ipaddress", "fractions", "_pydecimal"):
        return {"t": _qual(t), "v": str(v)}
    if isinstance(v, (types.FunctionType, types.BuiltinFunctionType, types.MethodType, type, types.ModuleType)):
        return {"t": t.__name__, "v": getattr(v, "__qualname__", getattr(v, "__name__", "?"))}
    if isinstance(v, (types.CoroutineType, types.GeneratorType, types.AsyncGeneratorType)):
        return {"t": t.__name__, "v": getattr(v, "__qualname__", "?")}
    if isinstance(v, BaseException):
        a = v.args[0] if v.args else ""
        return {"t": _qual(t), "msg": a if type(a) is str else ser(a, MAX_DEPTH)}
    i = id(v)
    if i in path:
        return {"t": _qual(t), "ref": i, "cycle": True}
    p = path + (i,)
    if isinstance(v, (list, tuple, set, frozenset)) or mod == "collections" and t.__name__ == "deque":
        n = len(v)
        if depth >= MAX_DEPTH:
            return {"t": _qual(t), "n": n, "ref": i}
        items = []
        for k, x in enumerate(v):
            if k >= MAX_ITEMS:
                items.append(f"… {n - MAX_ITEMS}개 더")
                break
            items.append(ser(x, depth + 1, p))
        return {"t": _qual(t), "n": n, "items": items}
    if isinstance(v, dict):
        n = len(v)
        if depth >= MAX_DEPTH:
            return {"t": _qual(t), "n": n, "ref": i}
        es = []
        for k, (a, b) in enumerate(dict.items(v)):
            if k >= MAX_ITEMS:
                break
            es.append([ser(a, MAX_DEPTH), "***" if _secret(a) and b is not None else ser(b, depth + 1, p)])
        return {"t": _qual(t), "n": n, "entries": es}
    if mod == "sqlite3" and t.__name__ == "Row":
        ks = v.keys()
        return {"t": "sqlite3.Row", "n": len(ks), "entries": [[k, "***" if _secret(k) else ser(v[k], depth + 1, p)] for k in ks[:MAX_FIELDS]]}
    if depth >= MAX_DEPTH:
        return {"t": _qual(t), "ref": i}
    lib = not _ours_type(t)
    if lib:
        depth = max(depth, MAX_DEPTH - 1)  # 라이브러리 객체: 공개 필드만, 그 아래는 이름만
    f = {}
    d = _plain_dict(v)
    if d is not None:
        for k, x in list(d.items()):
            if k.startswith("_sa_") or k.startswith("__pydantic") or lib and k.startswith("_"):
                continue
            if len(f) >= MAX_FIELDS:
                f["…"] = "필드 더 있음"
                break
            f[k] = "***" if _secret(k) and x is not None else ser(x, depth + 1, p)
    for c in t.__mro__:
        for k in c.__dict__.get("__slots__", ()) if isinstance(c.__dict__.get("__slots__", ()), (tuple, list)) else ():
            if k in f or k.startswith("__") or lib and k.startswith("_") or len(f) >= MAX_FIELDS:
                continue
            try:
                x = object.__getattribute__(v, k)
            except Exception:
                continue
            f[k] = "***" if _secret(k) and x is not None else ser(x, depth + 1, p)
    if f or d is not None:
        return {"t": _qual(t), "f": f}
    return {"t": _qual(t)}


class _Call:
    __slots__ = ("cid", "code", "thread", "last", "vals", "raw", "hits", "cur", "muted", "pending", "d", "unwinding", "pcaught")

    def __init__(self, cid, code, thread, parent=None):
        self.cid, self.code, self.thread = cid, code, thread
        self.last, self.vals, self.raw, self.hits, self.cur, self.muted, self.unwinding, self.pcaught = -1, {}, {}, {}, 0, False, None, None
        self.pending = (parent.cid, parent.last) if parent else (-1, -1)
        self.d = parent.d + 1 if parent else 1


class Recorder:
    def __init__(self, root, out, max_steps=5000, max_hits=30):
        self.root = os.path.realpath(root)
        ROOT[0] = self.root
        self.out, self.max_steps, self.max_hits = out, max_steps, max_hits
        skip = {os.path.realpath(p) for p in (sysconfig.get_paths().get(k) for k in ("stdlib", "platstdlib", "purelib", "platlib")) if p}
        self.skip = tuple(s + os.sep for s in skip) + (HERE + os.sep,)
        self.steps, self.notes = [], []
        self.live = {}  # id(frame) → _Call
        self.ours_cache = {}
        self.lock = threading.RLock()
        self.seq = 0
        self.on = False
        self.done = False
        self.truncated = False
        self.entry_thread = None
        self.t0 = time.time()
        self.started = self.ended = 0
        self.tool = None
        self.n_ex = 0
        self.exs = {}  # id(예외) → (예외, 기록)

    # ── 프로젝트 코드인가 ──
    def ours(self, code):
        r = self.ours_cache.get(code.co_filename)
        if r is None:
            f = os.path.realpath(code.co_filename) if not code.co_filename.startswith("<") else ""
            r = bool(f) and f.startswith(self.root + os.sep) and not f.startswith(self.skip) and f"{os.sep}site-packages{os.sep}" not in f and f"{os.sep}.venv{os.sep}" not in f
            self.ours_cache[code.co_filename] = r
        return r

    def src(self, code):
        return os.path.relpath(os.path.realpath(code.co_filename), self.root).replace(os.sep, "/")

    def now(self):
        return int((time.time() - self.t0) * 1000)

    # ── 켜고 끄기: 3.12 이상은 sys.monitoring (라이브러리 코드는 DISABLE 로 비용 0), 그 아래는 sys.settrace ──
    def install(self):
        if self.tool is not None:
            return True
        mon = getattr(sys, "monitoring", None)
        if mon is None or os.environ.get("KEDOVI_TRACE_ENGINE") == "settrace":
            self.tool = "settrace"
            return True
        for tid in (4, 5, 3, mon.DEBUGGER_ID, mon.PROFILER_ID):  # 0 디버거 · 1 커버리지 · 2 프로파일러는 되도록 피한다
            if mon.get_tool(tid) is None:
                mon.use_tool_id(tid, "kedovi-trace")
                self.tool = tid
                break
        if self.tool is None:
            self.notes.append("sys.monitoring 도구 칸이 모두 쓰여 기록하지 못함 (디버거 · 커버리지를 끄고 다시)")
            return False
        E = mon.events
        for ev, fn in ((E.PY_START, self.m_start), (E.PY_RESUME, self.m_resume), (E.LINE, self.m_line), (E.PY_RETURN, self.m_return),
                       (E.PY_UNWIND, self.m_unwind), (E.RAISE, self.m_raise), (E.EXCEPTION_HANDLED, self.m_handled)):
            mon.register_callback(self.tool, ev, fn)
        return True

    def start(self):
        with self.lock:
            if not self.install():
                return
            self.on = True
            self.started = self.now()
            self.entry_thread = threading.get_ident()
            if self.tool == "settrace":
                threading.settrace(self.t_global)
                sys.settrace(self.t_global)
                f = sys._getframe(1)
                while f is not None:  # 이미 도는 프로젝트 함수(테스트 함수 등)에도 줄 기록을 건다
                    if self.ours(f.f_code):
                        f.f_trace = self.t_local
                    f = f.f_back
                return
            E = sys.monitoring.events
            # restart_events 는 부르지 않는다: 같이 도는 coverage 같은 다른 도구의 DISABLE 까지 풀린다
            sys.monitoring.set_events(self.tool, E.PY_START | E.PY_RESUME | E.LINE | E.PY_RETURN | E.PY_UNWIND | E.RAISE | E.EXCEPTION_HANDLED)

    def stop(self, why=None):
        with self.lock:
            if self.done:
                return
            self.on = False
            self.done = True
            self.ended = self.now()
            if why:
                self.notes.append(why)
            if self.tool == "settrace":
                sys.settrace(None)
                threading.settrace(None)
            elif self.tool is not None:
                sys.monitoring.set_events(self.tool, 0)
                for ev in range(20):
                    try:
                        sys.monitoring.register_callback(self.tool, 1 << ev, None)
                    except Exception:  # noqa: BLE001
                        break
                sys.monitoring.free_tool_id(self.tool)
            self.write()

    # ── 호출 찾기 ──
    def owner(self, frame):
        """frame 에서 위로 올라가며 기록 중인 가장 가까운 호출"""
        f = frame
        while f is not None:
            c = self.live.get(id(f))
            if c is not None and c.code is f.f_code:
                return c
            f = f.f_back
        return None

    def fallback_parent(self):
        """다른 스레드 · 다른 태스크에서 시작한 호출 (테스트 클라이언트의 앱 스레드 · 스레드 풀 · 이벤트 루프): 가장 최근에 움직인 열린 호출 아래로"""
        best = None
        for c in self.live.values():
            if not c.muted and c.last >= 0 and (best is None or c.last > best.last):
                best = c
        return best

    def snapshot(self, frame, c):
        """지역 변수 → {이름: JSON 문자열}. 같은 객체이고 바뀔 수 없는 값이면 앞 줄 것을 다시 쓴다 (값 읽기가 비용 대부분)"""
        out, raw = {}, {}
        try:
            loc = dict(frame.f_locals)  # 3.13+ 의 f_locals 는 쓰기 프록시: 읽기만 한다
        except Exception as e:  # noqa: BLE001
            if len(self.notes) < 20:
                self.notes.append(f"값 읽기 오류: {e!r}")
            return out
        prev = c.raw
        for k, x in loc.items():
            if k.startswith("@") or k.startswith("__") and k.endswith("__") or k.startswith("__kedovi"):  # __class__ (super() 가 만드는 숨은 변수) 등
                continue
            p = prev.get(k)
            if p is not None and p[0] is x and type(x) in IMMUTABLE:
                j = p[1]
            elif _secret(k) and x is not None:
                j = '"***"'
            else:
                try:
                    j = json.dumps(ser(x), ensure_ascii=False, default=str)
                except Exception as e:  # noqa: BLE001
                    j = json.dumps({"t": _qual(type(x)), "err": repr(e)[:200]})
            out[k] = j
            raw[k] = (x, j)
        c.raw = raw
        return out

    def full(self):
        if len(self.steps) >= self.max_steps:
            self.truncated = True
            threading.Thread(target=self.stop, args=(f"단계 상한({self.max_steps})에 닿아 멈춤",), daemon=True).start()
            self.on = False
            return True
        return False

    # ── 기록 (frame 기준. sys.monitoring · settrace 모두 여기로) ──
    def _enter(self, frame):
        c = self.live.get(id(frame))
        if c is not None and c.code is frame.f_code:  # 코루틴 · 제너레이터가 이어짐
            return c
        parent = self.owner(frame.f_back) or self.fallback_parent()
        c = _Call(self.seq, frame.f_code, threading.get_ident(), parent)
        self.seq += 1
        if parent is not None and (parent.muted or parent.hits.get(parent.cur, 0) > self.max_hits):
            c.muted = True
            if not parent.muted and parent.last >= 0:
                s = self.steps[parent.last]
                s["skippedCalls"] = s.get("skippedCalls", 0) + 1
        self.live[id(frame)] = c
        return c

    def _line(self, frame, line):
        code = frame.f_code
        c = self.live.get(id(frame))
        if c is None or c.code is not code:  # 기록 시작 전에 시작한 함수 (테스트 함수 자신 등)
            c = _Call(self.seq, code, threading.get_ident(), self.owner(frame.f_back))
            self.seq += 1
            self.live[id(frame)] = c
        if c.pcaught is not None:  # 방금 잡은 예외: 잡은 곳 = 처리기에서 처음 실행한 줄 (except 줄)
            c.pcaught["caught"] = self.where(code, line)
            c.pcaught = None
        if c.muted or self.full():
            return
        c.cur = line
        h = c.hits.get(line, 0) + 1
        c.hits[line] = h
        first = c.pending is not None
        if not first and h > self.max_hits:
            if c.last >= 0:
                s = self.steps[c.last]
                s["skipped"] = s.get("skipped", 0) + 1
            return
        cur = self.snapshot(frame, c)
        q = code.co_qualname if hasattr(code, "co_qualname") else code.co_name
        mod = frame.f_globals.get("__name__", "")
        cls = f"{mod}.{q.rsplit('.', 1)[0]}" if "." in q else mod
        s = {"i": len(self.steps), "k": "line", "c": c.cid, "d": c.d, "t": self.now(), "ln": line, "cls": cls, "m": code.co_name, "src": self.src(code)}
        if first:
            s["call"] = True
            s["p"], s["site"] = c.pending
            s["args"] = {k: json.loads(v) for k, v in cur.items()}
            c.pending = None
        elif c.last >= 0:
            self._after(c, cur)
        c.vals = cur
        c.last = len(self.steps)
        self.steps.append(s)

    def _after(self, c, cur):
        ch = {k: v for k, v in cur.items() if c.vals.get(k) != v}
        if ch:
            self.steps[c.last].setdefault("after", {}).update({k: json.loads(v) for k, v in ch.items()})

    def _close(self, frame, ret, raised=None):
        c = self.live.get(id(frame))
        if c is None or c.code is not frame.f_code:
            return
        self.live.pop(id(frame), None)
        if c.muted:
            return
        if c.last >= 0 and c.pending is None:
            self._after(c, self.snapshot(frame, c))  # 마지막 줄이 바꾼 값 (list.append 처럼 객체 안이 바뀐 것도)
        s = {"i": len(self.steps), "k": "return", "c": c.cid, "d": c.d, "t": self.now()}
        if c.last >= 0:
            s["ln"] = self.steps[c.last]["ln"]
        s["ret"] = ser(raised) if raised is not None else ser(ret)
        if raised is not None:
            s["raised"] = True
        self.steps.append(s)

    def _ex(self, exc, c, at, caught=None):
        if self.n_ex >= MAX_EX or type(exc).__name__ in QUIET_EX:
            return
        self.n_ex += 1
        a = exc.args[0] if exc.args else ""
        x = {"type": _qual(type(exc)), "msg": a if type(a) is str else str(ser(a, MAX_DEPTH)), "at": at, "caught": caught}
        s = {"i": len(self.steps), "k": "ex", "c": c.cid if c else -1, "d": c.d if c else 1, "t": self.now(), "x": x}
        if c is not None:
            s["site"] = c.last
            if c.last >= 0:
                s["ln"] = self.steps[c.last]["ln"]
        self.exs[id(exc)] = (exc, x)
        self.steps.append(s)

    def where(self, code, line):
        return f"{self.src(code) if self.ours(code) else code.co_filename}:{line}"

    def _origin(self, exc):
        tb = exc.__traceback__
        while tb is not None and tb.tb_next is not None:
            tb = tb.tb_next
        return self.where(tb.tb_frame.f_code, tb.tb_lineno) if tb else "?"

    def _raise(self, frame, exc):
        """프로젝트 코드에서 던진 예외 (부른 쪽으로 넘어갈 때 다시 오는 RAISE 는 건너뜀)"""
        seen = self.exs.get(id(exc))
        if seen and seen[0] is exc:
            return
        self._ex(exc, self.owner(frame), self.where(frame.f_code, frame.f_lineno))

    def _handled(self, frame, exc):
        """프로젝트 코드가 잡은 예외 (라이브러리에서 던졌어도). 잡은 곳은 다음 줄 기록 때 except 줄로 고친다"""
        here = self.where(frame.f_code, frame.f_lineno)
        seen = self.exs.get(id(exc))
        if seen and seen[0] is exc:
            seen[1]["caught"] = here
            x = seen[1]
        else:
            self._ex(exc, self.owner(frame), self._origin(exc), here)
            x = self.exs.get(id(exc), (None, None))[1]
        c = self.live.get(id(frame))
        if c is not None and x is not None:
            c.pcaught = x

    def _unwind(self, frame, exc):
        """예외로 끝난 프로젝트 함수: 라이브러리에서 던져 프로젝트 코드를 빠져나가는 예외도 기록"""
        seen = self.exs.get(id(exc))
        if not (seen and seen[0] is exc):
            self._ex(exc, self.owner(frame), self._origin(exc))
        self._close(frame, None, exc)

    # ── sys.monitoring 콜백 (3.12+): 프로젝트 밖 코드는 DISABLE ──
    def m_start(self, code, offset):
        if not self.ours(code):
            return DISABLE
        if self.on:
            with self.lock:
                self._enter(sys._getframe(1))
        return None

    def m_resume(self, code, offset):
        return None if self.ours(code) else DISABLE

    def m_line(self, code, line):
        if not self.ours(code):
            return DISABLE
        if self.on:
            with self.lock:
                self._line(sys._getframe(1), line)
        return None

    def m_return(self, code, offset, retval):
        if not self.ours(code):
            return DISABLE
        if self.on:
            with self.lock:
                self._close(sys._getframe(1), retval)
        return None

    def m_unwind(self, code, offset, exc):
        if self.on and self.ours(code):
            with self.lock:
                self._unwind(sys._getframe(1), exc)

    def m_raise(self, code, offset, exc):
        if self.on and self.ours(code):
            with self.lock:
                self._raise(sys._getframe(1), exc)

    def m_handled(self, code, offset, exc):
        if self.on and self.ours(code):
            with self.lock:
                self._handled(sys._getframe(1), exc)

    # ── sys.settrace (3.11 이하) ──
    def t_global(self, frame, event, arg):
        if event != "call" or not self.on or not self.ours(frame.f_code):
            return None
        with self.lock:
            self._enter(frame)
        return self.t_local

    def t_local(self, frame, event, arg):
        if not self.on:
            return None
        with self.lock:
            c = self.live.get(id(frame))
            if event == "line":
                if c is not None and c.unwinding is not None:  # 예외가 이 함수 안에서 잡혀 다음 줄로
                    self._handled(frame, c.unwinding)
                    c.unwinding = None
                self._line(frame, frame.f_lineno)
            elif event == "exception":
                exc = arg[1]
                if arg[2] is not None and arg[2].tb_next is None:
                    self._raise(frame, exc)
                c = c or self._enter(frame)
                c.unwinding = exc
            elif event == "return":
                if c is not None and c.unwinding is not None:
                    self._unwind(frame, c.unwinding)
                elif not _suspended(frame):
                    self._close(frame, arg)
        return self.t_local

    # ── SQL (기록할 때만 감싼다. 프로젝트 코드는 고치지 않는다) ──
    def sql(self, q, params, ms, ok=True):
        if not self.on:
            return
        with self.lock:
            caller = sys._getframe(1)
            c = self.owner(caller)
            if c is None or c.muted:
                return
            ps = []
            if isinstance(params, dict):
                ps = [[[k, "***" if _secret(k) else ser(v, 1)] for k, v in params.items()]]
            elif isinstance(params, (list, tuple)):
                rows = params if params and isinstance(params[0], (list, tuple, dict)) and not isinstance(params, dict) else [params]
                for r in rows[:20]:
                    ps.append([[k, "***" if _secret(k) else ser(v, 1)] for k, v in (r.items() if isinstance(r, dict) else enumerate(r, 1))])
            s = {"i": len(self.steps), "k": "sql", "c": c.cid, "d": c.d, "t": self.now(), "site": c.last, "x": {"ms": round(ms, 2), "ok": ok, "qs": [{"q": str(q)[:4000], "ps": ps}]}}
            if c.last >= 0:
                s["ln"] = self.steps[c.last]["ln"]
            self.steps.append(s)

    def write(self):
        data = {"version": 1, "lang": "python", "mode": os.environ.get("KEDOVI_TRACE_MODE", "test"), "entry": os.environ.get("KEDOVI_TRACE_TEST"),
                "include": [self.root], "startedAt": self.started, "endedAt": self.ended, "truncated": self.truncated, "maxHits": self.max_hits,
                "notes": self.notes, "steps": self.steps}
        tmp = self.out + ".part"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, default=str)
        os.replace(tmp, self.out)


REC = None


def recorder():
    global REC
    if REC is None:
        REC = Recorder(os.environ.get("KEDOVI_TRACE_ROOT") or os.getcwd(), os.environ.get("KEDOVI_TRACE_OUT") or "kedovi-trace.json",
                       int(os.environ.get("KEDOVI_TRACE_MAX_STEPS") or 5000), int(os.environ.get("KEDOVI_TRACE_MAX_HITS") or 30))
        if os.environ.get("KEDOVI_TRACE_SQL", "on") != "off":
            hook_sql(REC)
    return REC


def _timed(rec, q, params, fn):
    t = time.perf_counter()
    try:
        r = fn()
    except Exception:
        rec.sql(q, params, (time.perf_counter() - t) * 1000, False)
        raise
    rec.sql(q, params, (time.perf_counter() - t) * 1000)
    return r


def hook_sql(rec):
    """sqlite3 · psycopg(3) · SQLAlchemy 를 기록하는 동안만 감싼다"""
    import importlib.abc
    import importlib.util

    def sqlite(m):
        if getattr(m, "_kedovi", False):
            return
        base_cur, base_con = m.Cursor, m.Connection

        class Cursor(base_cur):
            def execute(self, q, p=(), /):
                return _timed(rec, q, p, lambda: base_cur.execute(self, q, p))

            def executemany(self, q, ps, /):
                ps = list(ps)
                return _timed(rec, q, ps, lambda: base_cur.executemany(self, q, ps))

        class Connection(base_con):
            def cursor(self, factory=Cursor):
                return base_con.cursor(self, factory)

            def execute(self, q, p=(), /):
                return self.cursor().execute(q, p)

            def executemany(self, q, ps, /):
                return self.cursor().executemany(q, ps)

        orig = m.connect

        def connect(*a, **k):
            k.setdefault("factory", Connection)
            return orig(*a, **k)

        for k in (Cursor, Connection):
            k.__module__, k.__qualname__ = "sqlite3", k.__name__
        m.connect = connect
        m._kedovi = True

    def psycopg(m):
        for name in ("Cursor", "AsyncCursor", "ServerCursor"):
            cls = getattr(m, name, None)
            if cls is None or getattr(cls, "_kedovi", False):
                continue
            orig = cls.execute
            if name == "AsyncCursor":
                async def ex(self, query, params=None, *a, _o=orig, **k):
                    t = time.perf_counter()
                    try:
                        r = await _o(self, query, params, *a, **k)
                    except Exception:
                        rec.sql(query, params, (time.perf_counter() - t) * 1000, False)
                        raise
                    rec.sql(query, params, (time.perf_counter() - t) * 1000)
                    return r
            else:
                def ex(self, query, params=None, *a, _o=orig, **k):
                    return _timed(rec, query, params, lambda: _o(self, query, params, *a, **k))
            cls.execute = ex
            cls._kedovi = True

    def sqlalchemy(m):
        try:
            from sqlalchemy import event
            from sqlalchemy.engine import Engine
        except Exception:
            return
        if getattr(Engine, "_kedovi", False):
            return
        Engine._kedovi = True

        def before(conn, cursor, statement, parameters, context, executemany):
            conn.info["_kedovi_t"] = time.perf_counter()

        def after(conn, cursor, statement, parameters, context, executemany):
            rec.sql(statement, parameters, (time.perf_counter() - conn.info.pop("_kedovi_t", time.perf_counter())) * 1000)

        event.listen(Engine, "before_cursor_execute", before)
        event.listen(Engine, "after_cursor_execute", after)

    hooks = {"sqlite3": sqlite, "psycopg": psycopg, "sqlalchemy.engine": sqlalchemy}
    rec_sql_direct = {"sqlalchemy.engine"}  # sqlalchemy 는 sqlite3 를 직접 쓰므로 sqlite 감싸기와 겹친다
    for name, fn in hooks.items():
        if name in sys.modules:
            try:
                fn(sys.modules[name])
            except Exception as e:  # noqa: BLE001
                rec.notes.append(f"SQL 감싸기 실패 {name}: {e!r}")

    class Finder(importlib.abc.MetaPathFinder):
        def find_spec(self, name, path, target=None):
            if name not in hooks:
                return None
            sys.meta_path.remove(self)
            try:
                spec = importlib.util.find_spec(name)
            finally:
                sys.meta_path.insert(0, self)
            if spec is None or spec.loader is None:
                return None
            orig = spec.loader.exec_module

            def exec_module(module, _o=orig, _n=name):
                _o(module)
                try:
                    hooks[_n](module)
                except Exception as e:  # noqa: BLE001
                    rec.notes.append(f"SQL 감싸기 실패 {_n}: {e!r}")
            spec.loader.exec_module = exec_module
            return spec

    sys.meta_path.insert(0, Finder())
    del rec_sql_direct


# ── pytest 플러그인 (-p kedovi_trace) ──
def pytest_configure(config):
    recorder()


def _wanted(item):
    want = os.environ.get("KEDOVI_TRACE_TEST", "")
    if not want:
        return True
    base = item.nodeid.split("[", 1)[0]  # 매개변수화된 테스트는 첫 회차를 기록한다
    return item.nodeid == want or item.nodeid.endswith(want) or base == want or base.endswith(want) or item.name == want or getattr(item, "originalname", None) == want


try:
    import pytest

    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_call(item):
        rec = recorder()
        if rec.done or not _wanted(item):
            yield
            return
        rec.start()
        try:
            yield
        finally:
            rec.stop()
except ImportError:  # pytest 없이 서버 모드로만
    pass


def pytest_sessionfinish(session, exitstatus):
    rec = recorder()
    if not rec.done:
        rec.notes.append("기록할 테스트가 실행되지 않음 (이름 확인)")
        rec.stop()


# ── 서버 모드: python -m kedovi_trace <모듈> [인자…] ──
def _serve():
    import runpy
    rec = recorder()
    if len(sys.argv) < 2:
        print("사용법: python -m kedovi_trace <모듈> [인자…]", file=sys.stderr)
        sys.exit(2)

    def control():
        for line in sys.stdin:
            cmd = line.strip()
            if cmd == "start":
                rec.start()
                print("ARMED", flush=True)
            elif cmd == "stop":
                rec.stop()
                print("WRITTEN", flush=True)
                os._exit(0)
        if not rec.done:
            rec.stop("표준 입력이 닫혀 멈춤")
        os._exit(0)

    rec.install()
    threading.Thread(target=control, daemon=True).start()
    print("ATTACHED", flush=True)
    target = sys.argv[1]
    sys.argv = sys.argv[1:]
    if target.endswith(".py"):  # python manage.py runserver …
        sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
        runpy.run_path(target, run_name="__main__")
    else:  # uvicorn · flask · gunicorn … (모듈)
        sys.path.insert(0, os.getcwd())
        runpy.run_module(target, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    _serve()
