"""쓰기 보고서 기록기 (SQLAlchemy + pytest).

시험 본문이 DB 에 쓴 것을 `.write-report/<묶음>/<이름>.yaml` 로 남기고,
`assert_writes(이름, 테이블...)` 로 승인본과 비교한다. 형식은 킷의 FORMAT.md 를 따른다.

붙이는 법: conftest.py 에 `pytest_plugins = ["tests.write_report"]`.
의존성: 표준 라이브러리 + SQLAlchemy(1.4 · 2.x) + pytest.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import difflib
import enum
import json
import os
import re
import shutil
import threading
import uuid as _uuid
import weakref
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import Pool

try:  # SQLAlchemy 2.x
    from sqlalchemy.engine.interfaces import ExecuteStyle as _ExecuteStyle

    _INSERTMANYVALUES = _ExecuteStyle.INSERTMANYVALUES
except Exception:  # 1.4
    _INSERTMANYVALUES = None

STACK = "sqlalchemy"
APPROVE_ENV = "WRITE_REPORT_APPROVE"
RUN_ENV = "WRITE_REPORT_RUN"

# ---------------------------------------------------------------- 설정

DEFAULT_CONFIG = {
    "output": ".write-report",
    "approved": "tests/write-report/approved",
    "viewer": "tests/write-report/viewer.html",
    "ids": [],
    "now": ["created_at", "updated_at", "inserted_at", "modified_at"],
    "replace": [],
    "mask": {"unknownBinds": "type"},
    "exclude": {
        "tables": ["batch_*", "qrtz_*", "flyway_schema_history", "databasechangelog*", "shedlock"],
        "updatesOnly": [],
    },
}


def _as_list(v):
    if v is None:
        return []
    if isinstance(v, str):
        return [s.strip() for s in v.split(",") if s.strip()]
    return list(v)


def load_config(root: Path) -> dict:
    """write-report.json 을 읽는다. 중첩 키와 점 키(`exclude.tables`) 둘 다 받는다."""
    raw = {}
    p = root / "write-report.json"
    if p.is_file():
        raw = json.loads(p.read_text(encoding="utf-8"))
    flat = {}
    for k, v in raw.items():
        if isinstance(v, dict) and k in ("mask", "exclude"):
            for k2, v2 in v.items():
                flat[f"{k}.{k2}"] = v2
        else:
            flat[k] = v
    # exclude.updatesOnly.1 같은 번호 키를 목록으로
    upd = _as_list(flat.get("exclude.updatesOnly")) if not isinstance(flat.get("exclude.updatesOnly"), str) else [flat["exclude.updatesOnly"]]
    rep = flat.get("replace", [])
    rep = [rep] if isinstance(rep, str) else list(rep)
    for k in sorted(flat):
        if re.match(r"^exclude\.updatesOnly\.\d+$", k):
            upd.append(flat[k])
        if re.match(r"^replace\.\d+$", k):
            rep.append(flat[k])
    d = DEFAULT_CONFIG
    cfg = {
        "root": root,
        "output": root / flat.get("output", d["output"]),
        "approved": root / flat.get("approved", d["approved"]),
        "viewer": root / flat.get("viewer", d["viewer"]),
        "ids": [s.lower() for s in _as_list(flat.get("ids", d["ids"]))],
        "now": [s.lower() for s in _as_list(flat.get("now", d["now"]))],
        "unknownBinds": flat.get("mask.unknownBinds", d["mask"]["unknownBinds"]),
        "excludeTables": _as_list(flat.get("exclude.tables", d["exclude"]["tables"])),
        "replace": [],
        "updatesOnly": [],
    }
    for r in rep:
        if isinstance(r, dict):
            pat, to = r.get("pattern", ""), r.get("replacement", "")
        elif isinstance(r, (list, tuple)):
            pat, to = r[0], (r[1] if len(r) > 1 else "")
        else:
            pat, _, to = str(r).partition("=>")
        if pat:
            cfg["replace"].append((re.compile(pat), to))
    for u in upd:
        if isinstance(u, dict):
            t, cols = u.get("table", ""), _as_list(u.get("columns"))
        else:
            t, _, c = str(u).partition(":")
            cols = _as_list(c)
        if t and cols:
            cfg["updatesOnly"].append({"table": t.strip(), "columns": [c.lower() for c in cols]})
    return cfg


# ---------------------------------------------------------------- 값 표지


class SqlExpr:
    """바인드가 아닌 식 (`!sql "now()"`)."""

    __slots__ = ("text",)

    def __init__(self, text):
        self.text = text


class Bytes:
    __slots__ = ("n",)

    def __init__(self, n):
        self.n = n


class DateVal:
    """따옴표 없이 쓰는 날짜 (2026-11-04)."""

    __slots__ = ("s",)

    def __init__(self, s):
        self.s = s


class NumText:
    """숫자 컬럼에 문자열로 들어온 숫자."""

    __slots__ = ("s",)

    def __init__(self, s):
        self.s = s


class Bind:
    __slots__ = ("key",)

    def __init__(self, key):
        self.key = key


class AnyBind:
    """col = ANY(:p) 의 배열 바인드."""

    __slots__ = ("bind",)

    def __init__(self, b):
        self.bind = b


class _Default:
    pass


DEFAULT = _Default()

# ---------------------------------------------------------------- SQL 토큰


class Tok:
    __slots__ = ("kind", "text", "val")

    def __init__(self, kind, text, val=None):
        self.kind, self.text, self.val = kind, text, val

    def __repr__(self):
        return f"{self.kind}:{self.text}"


_PARAM_KINDS = ("pnum", "pnamed", "ppos", "pcolon")
_TOK_PARTS = [
    ("ws", r"\s+"),
    ("cm", r"--[^\n]*|/\*[\s\S]*?\*/"),
    ("str", r"[Ee]'(?:[^'\\]|\\[\s\S]|'')*'|[Nn]?'(?:[^']|'')*'"),
    ("dol", r"\$\$[\s\S]*?\$\$|\$(?P<tag>[A-Za-z_]\w*)\$[\s\S]*?\$(?P=tag)\$"),
    ("pnum", r"\$\d+"),
    ("pnamed", r"%\(\w+\)s"),
    ("ppos", r"%s|\?"),
    ("cast", r"::"),
    ("pcolon", r":[A-Za-z_]\w*|:\d+"),
    ("qid", r'"(?:[^"]|"")*"|`[^`]*`'),
    ("num", r"(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?"),
    ("id", r"[A-Za-z_\u0080-￿][\w$\u0080-￿]*"),
    ("op", r"<>|!=|<=|>=|\|\||%%|[(),;.\[\]=<>+\-*/%^~!@#&|{}]"),
    ("other", r"[\s\S]"),
]


def _tok_regex(styles):
    parts = []
    for kind, pat in _TOK_PARTS:
        if kind == "pnum" and "dollar" not in styles:
            continue
        if kind == "pnamed" and "pyformat" not in styles:
            continue
        if kind == "ppos":
            alts = []
            if "pyformat" in styles or "format" in styles:
                alts.append("%s")
            if "qmark" in styles:
                alts.append(r"\?")
            if not alts:
                continue
            pat = "|".join(alts)
        if kind == "pcolon" and "named" not in styles and "numeric" not in styles:
            continue
        parts.append(f"(?P<{kind}>{pat})")
    return re.compile("|".join(parts))


_TOK_CACHE = {}


def tokenize(sql, styles=("dollar",)):
    key = tuple(sorted(styles))
    rx = _TOK_CACHE.get(key) or _TOK_CACHE.setdefault(key, _tok_regex(key))
    out, pos_i = [], 0
    for m in rx.finditer(sql):
        kind = m.lastgroup
        if kind == "tag":
            kind = "dol"
        text = m.group(0)
        if kind in ("ws", "cm"):
            continue
        val = None
        if kind == "id":
            val = text.lower()
        elif kind == "qid":  # 따옴표 식별자는 대소문자 그대로
            kind, val = "id", (text[1:-1].replace('""', '"') if text[0] == '"' else text[1:-1])
        elif kind == "pnum":
            val = int(text[1:]) - 1
        elif kind == "pnamed":
            val = text[2:-2]
        elif kind == "ppos":
            val = pos_i
            pos_i += 1
        elif kind == "pcolon":
            val = int(text[1:]) - 1 if text[1:].isdigit() else text[1:]
        out.append(Tok(kind, text, val))
    return out


def _is(t, *words):
    return t is not None and t.kind == "id" and t.val in words and not t.text.startswith(('"', "`"))


def _op(t, *ops):
    return t is not None and t.kind == "op" and t.text in ops


def _at(toks, i):
    return toks[i] if 0 <= i < len(toks) else None


def _match_paren(toks, i):
    depth = 0
    for j in range(i, len(toks)):
        if _op(toks[j], "(", "["):
            depth += 1
        elif _op(toks[j], ")", "]"):
            depth -= 1
            if depth == 0:
                return j
    raise ValueError("괄호 짝 없음")


def _split_top(toks, pred):
    parts, cur, depth = [], [], 0
    for t in toks:
        if _op(t, "(", "["):
            depth += 1
        elif _op(t, ")", "]"):
            depth -= 1
        if depth == 0 and pred(t):
            parts.append(cur)
            cur = []
        else:
            cur.append(t)
    parts.append(cur)
    return parts


def _commas(toks):
    return [p for p in _split_top(toks, lambda t: _op(t, ",")) if p] if toks else []


def _find_top(toks, pred, start=0):
    depth = 0
    for j in range(start, len(toks)):
        t = toks[j]
        if _op(t, "(", "["):
            depth += 1
        elif _op(t, ")", "]"):
            depth -= 1
        elif depth == 0 and pred(t):
            return j
    return -1


_NO_SPACE_FN = {
    "in", "values", "and", "or", "not", "exists", "as", "on", "where", "set", "from", "into", "using",
    "select", "when", "then", "else", "over", "filter", "within", "returning", "conflict", "any", "all",
    "is", "between", "like", "ilike", "by", "having", "join", "update", "do", "table", "only",
}


def render(toks):
    """SQL 로 남기는 경로: 바인드 · 인라인 리터럴을 ? 로."""
    out = []
    prev = None
    cast_left = 0  # :: 뒤 타입 이름 (숫자를 그대로 둔다)
    type_depth = 0
    for t in toks:
        if t.kind in _PARAM_KINDS or t.kind in ("str", "dol"):
            piece = "?"
        elif t.kind == "num":
            piece = t.text if type_depth > 0 else "?"
        else:
            piece = t.text
        if t.kind == "cast":
            cast_left = 1
        elif cast_left and t.kind == "id":
            cast_left = 2
        elif cast_left == 2 and _op(t, "("):
            type_depth += 1
        elif type_depth and _op(t, ")"):
            type_depth -= 1
            if not type_depth:
                cast_left = 0
        elif cast_left == 2 and not _op(t, "[", "]"):
            cast_left = 0
        space = True
        if prev is None:
            space = False
        elif _op(t, ",", ")", "]", ".") or t.kind == "cast":
            space = False
        elif _op(prev, "(", "[", ".") or prev.kind == "cast":
            space = False
        elif _op(t, "(", "[") and prev.kind == "id" and prev.val not in _NO_SPACE_FN:
            space = False
        out.append((" " if space else "") + piece)
        prev = t
    return "".join(out)


def _unquote_str(text):
    if text[0] in "Ee":
        body = text[2:-1].replace("''", "'")
        return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t", "r": "\r"}.get(m.group(1), m.group(1)), body)
    if text[0] in "Nn":
        text = text[1:]
    return text[1:-1].replace("''", "'")


def _strip_cast(toks):
    j = _find_top(toks, lambda t: t.kind == "cast")
    if j > 0:
        toks = toks[:j]
    if len(toks) >= 4 and _is(toks[0], "cast") and _op(toks[1], "(") and _match_paren(toks, 1) == len(toks) - 1:
        inner = toks[2:-1]
        k = _find_top(inner, lambda t: _is(t, "as"))
        if k > 0:
            return _strip_cast(inner[:k])
    return toks


class _Lit:
    __slots__ = ("v",)

    def __init__(self, v):
        self.v = v


def value_of(toks):
    """바인드 · 리터럴 하나면 그 값 표지, 아니면 None (식)."""
    toks = _strip_cast(toks)
    while len(toks) >= 2 and _op(toks[0], "(") and _match_paren(toks, 0) == len(toks) - 1:
        toks = toks[1:-1]
    if len(toks) == 1:
        t = toks[0]
        if t.kind in _PARAM_KINDS:
            return Bind(t.val)
        if t.kind == "str":
            return _Lit(_unquote_str(t.text))
        if t.kind == "num":
            return _Lit(_num(t.text))
        if _is(t, "null"):
            return _Lit(None)
        if _is(t, "true"):
            return _Lit(True)
        if _is(t, "false"):
            return _Lit(False)
        if _is(t, "default"):
            return DEFAULT
    if len(toks) == 2 and _op(toks[0], "-") and toks[1].kind == "num":
        return _Lit(-_num(toks[1].text))
    return None


def _num(text):
    if re.fullmatch(r"\d+", text):
        return int(text)
    return decimal.Decimal(text)


def _expr(toks):
    v = value_of(toks)
    return v if v is not None else SqlExpr(render(toks))


def _qname(toks, i):
    parts = []
    t = _at(toks, i)
    if t is None or t.kind != "id":
        raise ValueError("테이블 이름 없음")
    parts.append(t.val)
    i += 1
    while _op(_at(toks, i), ".") and _at(toks, i + 1) is not None and _at(toks, i + 1).kind == "id":
        parts.append(toks[i + 1].val)
        i += 2
    return parts[-2:], i


def _colref(toks, quals):
    """`col` · `t.col` · `s.t.col` → 컬럼 이름 (그 테이블 것이 아니면 None)."""
    if len(toks) == 1 and toks[0].kind == "id" and not _is(toks[0], "null", "true", "false", "default", "not"):
        return toks[0].val
    if len(toks) == 3 and toks[0].kind == "id" and _op(toks[1], ".") and toks[2].kind == "id":
        return toks[2].val if toks[0].val in quals else None
    if len(toks) == 5 and _op(toks[1], ".") and _op(toks[3], ".") and toks[4].kind == "id":
        return toks[4].val if toks[2].val in quals else None
    return None


def _assignments(toks):
    """SET 목록 → ([(col, 표지)], sameAsInsert) . 못 풀면 ValueError."""
    sets, same = [], []
    for part in _commas(toks):
        j = _find_top(part, lambda t: _op(t, "="))
        if j <= 0:
            raise ValueError("SET 식")
        left, right = part[:j], part[j + 1 :]
        if _op(left[0], "("):
            cols = [c[-1].val for c in _commas(left[1:-1])]
            r = right[1:-1] if _op(right[0], "(") else (right[2:-1] if _is(right[0], "row") else None)
            if r is None:
                raise ValueError("다중 SET")
            vals = _commas(r)
            if len(vals) != len(cols):
                raise ValueError("다중 SET 수")
            sets.extend((c, _expr(v)) for c, v in zip(cols, vals))
            continue
        col = left[-1].val
        # EXCLUDED.c (PostgreSQL · SQLite) · VALUES(c) (MySQL)
        if len(right) == 3 and _is(right[0], "excluded") and _op(right[1], ".") and right[2].val == col:
            same.append(col)
            continue
        if len(right) == 4 and _is(right[0], "values") and _op(right[1], "(") and right[2].val == col and _op(right[3], ")"):
            same.append(col)
            continue
        sets.append((col, _expr(right)))
    return sets, same


def _parse_where(toks, quals):
    """WHERE → (where 목록 [(col, 표지)], 못 푼 조각 [토큰목록])."""
    where, rest = [], []
    if _find_top(toks, lambda t: _is(t, "or")) >= 0:
        return where, [toks]
    conj, cur, depth, between = [], [], 0, False
    for t in toks:
        if _op(t, "(", "["):
            depth += 1
        elif _op(t, ")", "]"):
            depth -= 1
        if depth == 0 and _is(t, "between"):
            between = True
        if depth == 0 and _is(t, "and"):
            if between:
                between = False
            else:
                conj.append(cur)
                cur = []
                continue
        cur.append(t)
    conj.append(cur)
    seen = set()
    for c in conj:
        if not c:
            continue
        if _op(c[0], "(") and _match_paren(c, 0) == len(c) - 1:
            w2, r2 = _parse_where(c[1:-1], quals)
            if any(col in seen for col, _ in w2):
                rest.append(c)
            else:
                seen.update(col for col, _ in w2)
                where.extend(w2)
                rest.extend(r2)
            continue
        got = _where_one(c, quals)
        if got and got[0] not in seen:
            seen.add(got[0])
            where.append(got)
        else:
            rest.append(c)
    return where, rest


def _where_one(c, quals):
    j = _find_top(c, lambda t: _op(t, "="))
    if j > 0:
        left, right = c[:j], c[j + 1 :]
        col = _colref(left, quals)
        if col:
            if len(right) >= 3 and _is(right[0], "any") and _op(right[1], "(") and _match_paren(right, 1) == len(right) - 1:
                v = value_of(right[2:-1])
                if isinstance(v, Bind):
                    return (col, AnyBind(v))
                return None
            v = value_of(right)
            if v is not None and v is not DEFAULT:
                return (col, v)
        col = _colref(right, quals)
        if col:
            v = value_of(left)
            if v is not None and v is not DEFAULT:
                return (col, v)
        return None
    k = _find_top(c, lambda t: _is(t, "in"))
    if k > 0 and not _is(c[k - 1], "not"):
        col = _colref(c[:k], quals)
        r = c[k + 1 :]
        if col and r and _op(r[0], "(") and _match_paren(r, 0) == len(r) - 1:
            vals = [value_of(x) for x in _commas(r[1:-1])]
            if vals and all(v is not None and v is not DEFAULT for v in vals):
                return (col, vals)
        return None
    k = _find_top(c, lambda t: _is(t, "is"))
    if k > 0 and len(c) == k + 2 and _is(c[k + 1], "null"):
        col = _colref(c[:k], quals)
        if col:
            return (col, _Lit(None))
    return None


def _guess_table(toks):
    for j in range(len(toks) - 1):
        t = toks[j]
        if _is(t, "into", "update", "from", "truncate", "table", "copy") and toks[j + 1].kind == "id":
            k = j + 1
            if _is(toks[k], "only", "table") and _at(toks, k + 1) is not None and toks[k + 1].kind == "id":
                k += 1
            try:
                return _qname(toks, k)[0]
            except ValueError:
                return None
    return None


def _sql_write(toks, op="SQL"):
    w = {"op": op, "sql": render(toks)}
    t = _guess_table(toks)
    if t:
        w["table"] = t
    return w


def parse_statement(toks):
    """문장 하나 → 쓰기 틀 (바인드 미해결) 또는 None (쓰기가 아님)."""
    if not toks or toks[0].kind != "id":
        return None
    head = toks[0].val
    try:
        if head in ("insert", "replace"):
            return _parse_insert(toks)
        if head == "update":
            return _parse_update(toks)
        if head == "delete":
            return _parse_delete(toks)
        if head == "merge":
            return _sql_write(toks, "MERGE")
        if head == "with":
            j = _find_top(toks, lambda t: _is(t, "insert", "update", "delete", "merge"))
            if j < 0:
                return None
            return _sql_write(toks, "MERGE" if _is(toks[j], "merge") else "SQL")
        if head in ("truncate", "call"):
            return _sql_write(toks)
        if head == "copy" and _find_top(toks, lambda t: _is(t, "from")) > 0:
            return _sql_write(toks)
    except (ValueError, IndexError):
        return _sql_write(toks, "MERGE" if head == "merge" else "SQL")
    return None


def _parse_insert(toks):
    op = "UPSERT" if toks[0].val == "replace" else "INSERT"
    i = 1
    if _is(_at(toks, i), "or"):
        w = toks[i + 1].val
        op = "INSERT_IGNORE" if w == "ignore" else "UPSERT" if w == "replace" else op
        i += 2
    if _is(_at(toks, i), "ignore"):
        op, i = "INSERT_IGNORE", i + 1
    if _is(_at(toks, i), "into"):
        i += 1
    table, i = _qname(toks, i)
    if _is(_at(toks, i), "as"):
        i += 2
    cols = None
    if _op(_at(toks, i), "("):
        e = _match_paren(toks, i)
        cols = []
        for c in _commas(toks[i + 1 : e]):
            if len(c) != 1 or c[0].kind != "id":
                return _sql_write(toks)
            cols.append(c[0].val)
        i = e + 1
    if _is(_at(toks, i), "overriding"):
        while _at(toks, i) is not None and not _is(toks[i], "values", "select"):
            i += 1
    tuples = []
    if _is(_at(toks, i), "default") and _is(_at(toks, i + 1), "values"):
        tuples, cols, i = [[]], [], i + 2
    elif _is(_at(toks, i), "values"):
        i += 1
        while _op(_at(toks, i), "("):
            e = _match_paren(toks, i)
            tuples.append(_commas(toks[i + 1 : e]))
            i = e + 1
            if _op(_at(toks, i), ","):
                i += 1
            else:
                break
    elif _is(_at(toks, i), "select") and cols:
        got = _select_from_values(toks, i, cols)
        if got is None:
            return _sql_write(toks)
        tuples, i = got
    else:
        return _sql_write(toks)
    w = {"op": op, "table": table, "cols": cols, "tuples": [[_expr(x) for x in tup] for tup in tuples]}
    # 꼬리: ON CONFLICT · ON DUPLICATE KEY UPDATE · RETURNING
    if _is(_at(toks, i), "on") and _is(_at(toks, i + 1), "conflict"):
        i += 2
        if _op(_at(toks, i), "("):
            e = _match_paren(toks, i)
            w["conflict"] = [p[-1].val if len(p) == 1 else render(p) for p in _commas(toks[i + 1 : e])]
            i = e + 1
            if _is(_at(toks, i), "where"):
                while _at(toks, i) is not None and not _is(toks[i], "do"):
                    i += 1
        elif _is(_at(toks, i), "on") and _is(_at(toks, i + 1), "constraint"):
            w["conflict"] = ["constraint " + toks[i + 2].val]
            i += 3
        if not _is(_at(toks, i), "do"):
            raise ValueError("ON CONFLICT")
        if _is(_at(toks, i + 1), "nothing"):
            w["op"] = "INSERT_IGNORE"
            i += 2
        elif _is(_at(toks, i + 1), "update") and _is(_at(toks, i + 2), "set"):
            w["op"] = "UPSERT"
            i += 3
            end = _find_top(toks, lambda t: _is(t, "where", "returning"), i)
            body = toks[i:] if end < 0 else toks[i:end]
            w["set"], w["sameAsInsert"] = _assignments(body)
            if end >= 0 and _is(toks[end], "where"):
                r = _find_top(toks, lambda t: _is(t, "returning"), end)
                w["whereSql"] = render(toks[end + 1 :] if r < 0 else toks[end + 1 : r])
        else:
            raise ValueError("DO")
    elif _is(_at(toks, i), "on") and _is(_at(toks, i + 1), "duplicate"):
        i += 4  # ON DUPLICATE KEY UPDATE
        w["op"] = "UPSERT"
        w["set"], w["sameAsInsert"] = _assignments(toks[i:])
    return w


def _select_from_values(toks, i, cols):
    """INSERT … SELECT p0, p1 FROM (VALUES (…), (…)) AS a(p0, p1, …) → 행 (SQLAlchemy insertmanyvalues 꼴)."""
    f = _find_top(toks, lambda t: _is(t, "from"), i)
    if f < 0:
        return None
    items = []
    for it in _commas(toks[i + 1 : f]):
        it = _strip_cast(it)
        if len(it) != 1 or it[0].kind != "id":
            return None
        items.append(it[0].val)
    j = f + 1
    if not _op(_at(toks, j), "(") or not _is(_at(toks, j + 1), "values"):
        return None
    e = _match_paren(toks, j)
    inner = toks[j + 2 : e]
    k = e + 1
    if _is(_at(toks, k), "as"):
        k += 1
    k += 1  # 별칭
    if not _op(_at(toks, k), "("):
        return None
    e2 = _match_paren(toks, k)
    names = [p[0].val for p in _commas(toks[k + 1 : e2])]
    if len(items) != len(cols) or any(n not in names for n in items):
        return None
    tuples = []
    x = 0
    while _op(_at(inner, x), "("):
        ee = _match_paren(inner, x)
        vals = _commas(inner[x + 1 : ee])
        tuples.append([vals[names.index(n)] for n in items])
        x = ee + 1
        if _op(_at(inner, x), ","):
            x += 1
    # ORDER BY 뒤 RETURNING 까지 건너뛴다
    r = _find_top(toks, lambda t: _is(t, "returning", "on"), e2)
    return tuples, (len(toks) if r < 0 else r)


def _parse_update(toks):
    i = 1
    if _is(_at(toks, i), "only"):
        i += 1
    table, i = _qname(toks, i)
    quals = {table[-1], ".".join(table)}
    if _is(_at(toks, i), "as"):
        quals.add(toks[i + 1].val)
        i += 2
    elif _at(toks, i) is not None and toks[i].kind == "id" and not _is(toks[i], "set"):
        quals.add(toks[i].val)
        i += 1
    if not _is(_at(toks, i), "set"):
        return _sql_write(toks)
    i += 1
    end = _find_top(toks, lambda t: _is(t, "from", "where", "returning"), i)
    if end >= 0 and _is(toks[end], "from"):
        return _sql_write(toks)
    sets, same = _assignments(toks[i:] if end < 0 else toks[i:end])
    w = {"op": "UPDATE", "table": table, "set": sets}
    if same:
        raise ValueError("UPDATE EXCLUDED")
    if end >= 0 and _is(toks[end], "where"):
        r = _find_top(toks, lambda t: _is(t, "returning"), end)
        _apply_where(w, toks[end + 1 :] if r < 0 else toks[end + 1 : r], quals)
    return w


def _parse_delete(toks):
    i = 1
    if _is(_at(toks, i), "from"):
        i += 1
    if _is(_at(toks, i), "only"):
        i += 1
    table, i = _qname(toks, i)
    quals = {table[-1], ".".join(table)}
    if _is(_at(toks, i), "as"):
        quals.add(toks[i + 1].val)
        i += 2
    elif _at(toks, i) is not None and toks[i].kind == "id" and not _is(toks[i], "where", "using", "returning"):
        quals.add(toks[i].val)
        i += 1
    if _is(_at(toks, i), "using"):
        return _sql_write(toks)
    w = {"op": "DELETE", "table": table}
    if _is(_at(toks, i), "where"):
        r = _find_top(toks, lambda t: _is(t, "returning"), i)
        _apply_where(w, toks[i + 1 :] if r < 0 else toks[i + 1 : r], quals)
    elif _at(toks, i) is not None and not _is(toks[i], "returning"):
        return _sql_write(toks)
    return w


def _apply_where(w, toks, quals):
    where, rest = _parse_where(toks, quals)
    if where:
        w["where"] = where
    if rest:
        w["whereSql"] = " AND ".join(render(r) for r in rest)


def split_statements(toks):
    return [s for s in _split_top(toks, lambda t: _op(t, ";")) if s]


# ---------------------------------------------------------------- 카탈로그

PG_CATALOG_SQL = """
SELECT n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
       pg_get_expr(d.adbin, d.adrelid), (a.attidentity <> '' OR a.attgenerated <> ''),
       COALESCE((SELECT k.n FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) WHERE k.attnum = a.attnum), 0)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, a.attnum
"""

IS_CATALOG_SQL = """
SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable = 'YES', c.column_default, 0,
       COALESCE((SELECT k.ordinal_position FROM information_schema.table_constraints t
                 JOIN information_schema.key_column_usage k
                   ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema AND k.table_name = t.table_name
                 WHERE t.constraint_type = 'PRIMARY KEY' AND t.table_schema = c.table_schema
                   AND t.table_name = c.table_name AND k.column_name = c.column_name), 0)
FROM information_schema.columns c
WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog', 'mysql', 'performance_schema', 'sys')
ORDER BY c.table_schema, c.table_name, c.ordinal_position
"""


def build_catalog(rows):
    cat = {}
    pk = {}
    for schema, table, col, typ, nullable, default, generated, pkpos in rows:
        t = cat.setdefault(schema, {}).setdefault(table, {"columns": [], "primaryKey": []})
        t["columns"].append(
            {"name": col, "type": typ, "nullable": bool(nullable), "default": default, "generated": bool(generated)}
        )
        if pkpos:
            pk.setdefault((schema, table), []).append((int(pkpos), col))
    for (s, t), cols in pk.items():
        cat[s][t]["primaryKey"] = [c for _, c in sorted(cols)]
    return cat


def _read_catalog(dbapi_conn, dialect_name):
    cur = dbapi_conn.cursor()
    try:
        if dialect_name == "sqlite":
            cur.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
            rows = []
            for (tname,) in cur.fetchall():
                cur.execute(f'PRAGMA table_info("{tname}")')
                for _cid, name, typ, notnull, dflt, pkpos in cur.fetchall():
                    rows.append(("main", tname, name, typ.lower(), not notnull, dflt, False, pkpos))
            return build_catalog(rows), "main"
        cur.execute(PG_CATALOG_SQL if dialect_name == "postgresql" else IS_CATALOG_SQL)
        rows = cur.fetchall()
        schema = None
        for q in ("SELECT current_schema()", "SELECT database()"):
            try:
                cur.execute(q)
                schema = cur.fetchone()[0]
                break
            except Exception:
                continue
        return build_catalog(rows), schema
    finally:
        try:
            cur.close()
        except Exception:
            pass


class Catalog:
    def __init__(self, data=None, schema=None):
        self.data = data or {}
        self.schema = schema

    def resolve(self, parts):
        """[schema, table] 또는 [table] → (schema, table) 표시 이름."""
        if len(parts) == 2:
            return parts[0], parts[1]
        t = parts[0]
        if self.schema and t in self.data.get(self.schema, {}):
            return self.schema, t
        hits = [s for s, ts in self.data.items() if t in ts]
        if len(hits) == 1:
            return hits[0], t
        return self.schema, t

    def table(self, schema, table):
        return self.data.get(schema or "", {}).get(table)

    def col_type(self, schema, table, col):
        t = self.table(schema, table)
        if t:
            for c in t["columns"]:
                if c["name"] == col:
                    return (c["type"] or "").lower()
        return ""


# ---------------------------------------------------------------- 값 다듬기

_MASK_RE = re.compile(r"(^|_)(app|api|access|private|secret)_?key(_|$)|password|passwd|token|secret", re.I)
_NUM_TYPES = re.compile(r"^(smallint|integer|bigint|int\d?|numeric|decimal|real|double precision|float\d?|serial|bigserial|smallserial|money)\b")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_NOW_EXPR = re.compile(
    r"^(now\(\)|current_timestamp(\(\d*\))?|localtimestamp(\(\d*\))?|current_date|current_time|clock_timestamp\(\)"
    r"|statement_timestamp\(\)|transaction_timestamp\(\)|sysdate|getdate\(\)|current_timestamp\(\))(::.*)?$",
    re.I,
)


def masked_col(col):
    return bool(col) and bool(_MASK_RE.search(col))


def _unwrap(v):
    # psycopg Json · Jsonb (.obj) · psycopg2 Json (.adapted)
    for a in ("obj", "adapted"):
        if hasattr(v, a) and type(v).__module__.startswith(("psycopg", "psycopg2")):
            return getattr(v, a)
    return v


def fmt_value(v, coltype=""):
    v = _unwrap(v)
    if v is None or isinstance(v, (bool, SqlExpr)):
        return v
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v
    if isinstance(v, decimal.Decimal):
        return v
    if isinstance(v, _dt.datetime):
        return v.isoformat()
    if isinstance(v, _dt.date):
        return DateVal(v.isoformat())
    if isinstance(v, (_dt.time, _dt.timedelta)):
        return str(v) if isinstance(v, _dt.timedelta) else v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return Bytes(len(bytes(v)))
    if isinstance(v, _uuid.UUID):
        return str(v)
    if isinstance(v, (list, tuple)):
        if coltype.startswith("json"):
            return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str)
        return [fmt_value(x, coltype.rstrip("[]")) for x in v]
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"), default=str)
    if isinstance(v, enum.Enum):
        return fmt_value(v.value, coltype)
    if isinstance(v, str):
        if coltype == "date" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            return DateVal(v)
        if _NUM_TYPES.match(coltype) and re.fullmatch(r"-?\d+(\.\d+)?([eE][+-]?\d+)?", v):
            return NumText(v)
        return v
    return str(v)


def unknown_bind(v, mode):
    v = _unwrap(v)
    if mode == "show":
        return fmt_value(v)
    if v is None:
        return None
    if mode == "hide":
        return "***"
    if isinstance(v, bool):
        return "<bool>"
    if isinstance(v, (int, float, decimal.Decimal)):
        return "<number>"
    if isinstance(v, (_dt.date, _dt.time, _dt.datetime, _dt.timedelta)):
        return "<time>"
    if isinstance(v, (bytes, bytearray, memoryview)):
        return Bytes(len(bytes(v)))
    return f"<text:{len(str(v))}>"


def clean_message(msg, replace=()):
    msg = str(msg or "")
    m = re.search(r"(DETAIL|Detail|세부 ?정보|상세 ?정보)\s*:", msg)
    if m:
        msg = msg[: m.start()]
    msg = " ".join(msg.split())
    for rx, to in replace:
        msg = rx.sub(to, msg)
    return msg.strip()


def sqlstate_of(e):
    e = getattr(e, "orig", None) or e
    for a in ("sqlstate", "pgcode"):
        v = getattr(e, a, None)
        if v:
            return str(v)
    for a in ("sqlite_errorname",):
        v = getattr(e, a, None)
        if v:
            return str(v)
    if getattr(e, "args", None) and isinstance(e.args[0], int):
        return str(e.args[0])
    return type(e).__name__


# ---------------------------------------------------------------- YAML · JSON 쓰기

_PLAIN = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\-]*$")
_RESERVED = {"null", "true", "false", "yes", "no", "on", "off", "y", "n", "~"}


def y_key(k):
    k = str(k)
    return k if _PLAIN.match(k) and k.lower() not in _RESERVED else json.dumps(k, ensure_ascii=False)


def _dec_text(d):
    s = str(d)
    return format(d, "f") if "E" in s or "e" in s else s


def y_val(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v) if v == v and v not in (float("inf"), float("-inf")) else json.dumps(str(v))
    if isinstance(v, decimal.Decimal):
        return _dec_text(v) if v.is_finite() else json.dumps(str(v))
    if isinstance(v, NumText):
        return v.s
    if isinstance(v, DateVal):
        return v.s
    if isinstance(v, SqlExpr):
        return "!sql " + json.dumps(v.text, ensure_ascii=False)
    if isinstance(v, Bytes):
        return f"!bytes {v.n}"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(y_val(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{y_key(k)}: {y_val(x)}" for k, x in v.items()) + "}"
    return json.dumps(str(v), ensure_ascii=False)


def y_name(s):
    return s if re.match(r"^[\w.\-/#]+$", s) and s.lower() not in _RESERVED else json.dumps(s, ensure_ascii=False)


def j_val(v):
    if isinstance(v, SqlExpr):
        return {"$sql": v.text}
    if isinstance(v, Bytes):
        return {"$bytes": v.n}
    if isinstance(v, DateVal):
        return v.s
    if isinstance(v, NumText):
        f = float(v.s)
        return int(f) if f.is_integer() and "." not in v.s else f
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() and "." not in str(v) else float(v)
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return str(v)
    if isinstance(v, (list, tuple)):
        return [j_val(x) for x in v]
    if isinstance(v, dict):
        return {k: j_val(x) for k, x in v.items()}
    return v


KEY_ORDER = ["seq", "op", "table", "rows", "set", "sameAsInsert", "conflict", "where", "whereSql", "sql", "result", "rolledBack"]


def _write_lines(w):
    lines = []
    first = True
    for k in KEY_ORDER:
        if k not in w:
            continue
        v = w[k]
        pre = "  - " if first else "    "
        first = False
        if k == "rows":
            lines.append(pre + "rows:")
            lines.extend("      - " + y_val(r) for r in v)
        elif k in ("sameAsInsert", "conflict"):
            lines.append(pre + f"{k}: [" + ", ".join(y_key(c) for c in v) + "]")
        elif k in ("table", "op"):
            lines.append(pre + f"{k}: " + y_name(v))
        else:
            lines.append(pre + f"{k}: {y_val(v)}")
    return lines


def test_yaml(test):
    out = [
        f"test: {y_name(test['id'])}",
        "specs: [" + ", ".join(y_name(s) for s in test["specs"]) + "]",
        f"started: {test['started']}",
    ]
    if not test["writes"]:
        out.append("writes: []")
    else:
        out.append("writes:")
        for w in test["writes"]:
            out.extend(_write_lines(w))
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- 정규화 (승인본)


def _natural_key(s):
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in re.split(r"(\d+)", s) if p != ""]


def _norm_json_str(s):
    if s[:1] in ("{", "["):
        try:
            return json.dumps(json.loads(s), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        except ValueError:
            return s
    return s


def _numeric(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, decimal.Decimal)):
        return decimal.Decimal(v)
    if isinstance(v, float):
        return decimal.Decimal(repr(v))
    if isinstance(v, NumText):
        return decimal.Decimal(v.s)
    return None


def normalize(writes, catalog: Catalog, cfg):
    """승인본 비교용: 생성 ID · UUID · JSON · 실제 시각 · 메시지."""
    # 생성 ID 후보 컬럼 (표시 테이블 이름, 컬럼)
    idcols = set()
    cfg_ids = cfg["ids"]
    tables = {w["table"] for w in writes if "table" in w}
    for tname in tables:
        parts = tname.split(".")
        schema, table = (parts[0], parts[1]) if len(parts) == 2 else (None, parts[0])
        for spec in cfg_ids:
            sp = spec.split(".")
            if len(sp) >= 2 and (".".join(sp[:-1]) == tname or sp[-2] == table):
                idcols.add((tname, sp[-1], True))
        if not cfg_ids:
            t = catalog.table(schema, table)
            if t and len(t["primaryKey"]) == 1:
                pkc = t["primaryKey"][0]
                if _NUM_TYPES.match(catalog.col_type(schema, table, pkc)):
                    idcols.add((tname, pkc, False))
    mapping = {}
    for tname, col, explicit in idcols:
        inserted, seen = set(), set()
        for w in writes:
            if w.get("table") != tname:
                continue
            for r in w.get("rows", []):
                n = _numeric(r.get(col))
                if n is not None:
                    inserted.add(n)
            for src in (w.get("set", {}), w.get("where", {})):
                v = src.get(col)
                for x in v if isinstance(v, list) else [v]:
                    n = _numeric(x)
                    if n is not None:
                        seen.add(n)
        vals = sorted(seen | inserted) if explicit else sorted(seen - inserted)
        mapping[(tname, col)] = {v: f"<{col}-{i + 1}>" for i, v in enumerate(vals)}

    now_cols = set(cfg["now"])

    def nv(tname, col, v):
        if isinstance(v, list):
            return [nv(tname, col, x) for x in v]
        m = mapping.get((tname, col))
        if m:
            n = _numeric(v)
            if n is not None and n in m:
                return m[n]
        if col in now_cols and v is not None:
            return "<now>"
        if isinstance(v, SqlExpr) and _NOW_EXPR.match(v.text.strip()):
            return "<now>"
        if isinstance(v, str):
            if _UUID_RE.match(v):
                return "<uuid>"
            return _norm_json_str(v)
        return v

    out = []
    for w in writes:
        t = w.get("table")
        n = {}
        for k in KEY_ORDER:
            if k not in w or k == "seq":
                continue
            v = w[k]
            if k == "rows":
                v = [{c: nv(t, c, x) for c, x in r.items()} for r in v]
            elif k in ("set", "where"):
                v = {c: nv(t, c, x) for c, x in v.items()}
            elif k == "result" and "message" in v:
                v = dict(v, message=clean_message(v["message"], cfg["replace"]))
            n[k] = v
        out.append(n)
    return out


def approved_yaml(writes, chosen, catalog: Catalog, cfg):
    norm = normalize(writes, catalog, cfg)
    groups = {}
    for w in norm:
        groups.setdefault(w.get("table") or "(sql)", []).append(w)
    if chosen:
        keys = []
        for c in chosen:
            parts = c.lower().split(".") if not c.startswith('"') else [c.strip('"')]
            if len(parts) == 2:
                full = c
            else:
                s, t = catalog.resolve(parts)
                full = f"{s}.{t}" if s else t
            hit = [g for g in groups if g == full or g.split(".")[-1] == c]
            keys.append(hit[0] if hit else full)
        keys = sorted(set(keys))
    else:
        keys = sorted(groups)
    lines = []
    for k in keys:
        items = []
        for w in groups.get(k, []):
            items.append("{" + ", ".join(
                f"{kk}: {vv}" if kk == "op" else
                f"{kk}: [" + ", ".join(y_key(c) for c in vv) + "]" if kk in ("sameAsInsert", "conflict") else
                f"{kk}: {y_val(vv)}"
                for kk, vv in w.items() if kk != "table") + "}")
        if not items:
            lines.append(f"{y_name(k)}: []")
            continue
        lines.append(f"{y_name(k)}:")
        lines.extend("  - " + s for s in sorted(items, key=_natural_key))
    return ("\n".join(lines) + "\n") if lines else "{}\n"


# ---------------------------------------------------------------- 기록 → 쓰기 목록


def _paramstyle_set(style):
    return {
        "pyformat": ("pyformat", "format"),
        "format": ("format",),
        "qmark": ("qmark",),
        "named": ("named",),
        "numeric": ("numeric",),
        "numeric_dollar": ("dollar",),
        "dollar": ("dollar",),
    }.get(style, ("pyformat",))


_MISSING = object()


def _lookup(params, key):
    try:
        if isinstance(params, dict):
            return params[key] if key in params else _MISSING
        return params[key]
    except (IndexError, KeyError, TypeError):
        return _MISSING


def _resolve(v, params, col, cfg):
    if isinstance(v, Bind):
        x = _lookup(params, v.key)
        return None if x is _MISSING else _unwrap(x)
    if isinstance(v, AnyBind):
        x = _lookup(params, v.bind.key)
        x = _unwrap(x)
        return list(x) if isinstance(x, (list, tuple)) else [x]
    if isinstance(v, _Lit):
        return v.v
    if isinstance(v, list):
        return [_resolve(x, params, col, cfg) for x in v]
    return v


def render_raw(raw, catalog: Catalog, cfg):
    """기록 하나 (SQL · 파라미터 묶음들) → 쓰기 dict 목록 (seq 제외)."""
    toks = tokenize(raw["sql"], _paramstyle_set(raw["style"]))
    out = []
    res = raw.get("result")
    stmts = split_statements(toks)
    for si, st in enumerate(stmts):
        tpl = parse_statement(st)
        if tpl is None:
            continue
        if "table" in tpl:
            s, t = catalog.resolve(tpl["table"])
            tname, schema, table = (f"{s}.{t}" if s else t), s, t
        else:
            tname = schema = table = None
        sets = raw["params"] or [{}]
        if tpl["op"] in ("SQL", "MERGE"):
            w = {"op": tpl["op"]}
            if tname:
                w["table"] = tname
            w["sql"] = tpl["sql"]
            out.append(w)
            continue

        def fv(col, v):
            if masked_col(col) and v is not None and not isinstance(v, SqlExpr):
                return "***"
            return fmt_value(v, catalog.col_type(schema, table, col))

        def resolved_map(pairs, params):
            d = {}
            for col, v in pairs:
                if v is DEFAULT:
                    continue
                x = _resolve(v, params, col, cfg)
                d[col] = [fv(col, e) for e in x] if isinstance(v, (list, AnyBind)) else fv(col, x)
            return d

        if tpl["op"] in ("INSERT", "UPSERT", "INSERT_IGNORE"):
            cols = tpl["cols"]
            unknown = False
            if cols is None:
                tinfo = catalog.table(schema, table)
                if tinfo:
                    cols = [c["name"] for c in tinfo["columns"]]
                else:
                    unknown = True
            rows = []
            for params in sets:
                for tup in tpl["tuples"]:
                    if unknown:
                        r = {}
                        for k, v in enumerate(tup):
                            if v is DEFAULT:
                                continue
                            x = _resolve(v, params, None, cfg)
                            r[f"?{k + 1}"] = unknown_bind(x, cfg["unknownBinds"]) if isinstance(v, Bind) else fmt_value(x)
                        rows.append(r)
                    else:
                        rows.append(resolved_map(list(zip(cols, tup)), params))
            w = {"op": tpl["op"], "table": tname, "rows": rows}
            if tpl.get("set"):
                w["set"] = resolved_map(tpl["set"], sets[0])
            if tpl.get("sameAsInsert"):
                w["sameAsInsert"] = tpl["sameAsInsert"]
            if tpl.get("conflict"):
                w["conflict"] = tpl["conflict"]
            if tpl.get("whereSql"):
                w["whereSql"] = tpl["whereSql"]
            out.append(w)
            continue
        # UPDATE · DELETE: 파라미터 묶음마다 쓰기 하나
        for params in sets:
            w = {"op": tpl["op"], "table": tname}
            if tpl.get("set"):
                w["set"] = resolved_map(tpl["set"], params)
            if tpl.get("where"):
                w["where"] = resolved_map(tpl["where"], params)
            if tpl.get("whereSql"):
                w["whereSql"] = tpl["whereSql"]
            out.append(w)
    # 결과 · 롤백 표시
    n = len(out)
    for w in out:
        if res is not None:
            if "error" in res:
                w["result"] = {"error": res["error"], "message": clean_message(res.get("message"))}
            elif res.get("rows") is not None:
                total = res["rows"]
                if n == 1:
                    w["result"] = {"rows": total}
                elif total == n:
                    w["result"] = {"rows": 1}
        if raw.get("rolledBack"):
            w["rolledBack"] = True
    return out


def _wild(p):
    return re.compile("^" + re.escape(p.lower()).replace(r"\*", ".*") + "$")


class Filter:
    def __init__(self, cfg):
        self.tables = [_wild(p) for p in cfg["excludeTables"]]
        self.upd = cfg["updatesOnly"]

    def table_excluded(self, tname):
        if not tname:
            return False
        t = tname.lower()
        bare = t.split(".")[-1]
        return any(rx.match(t) or rx.match(bare) for rx in self.tables)

    def updates_only(self, w):
        if w["op"] != "UPDATE" or not w.get("set"):
            return None
        t = (w.get("table") or "").lower()
        for i, u in enumerate(self.upd):
            ut = u["table"].lower()
            if (ut == t or ut == t.split(".")[-1]) and set(w["set"]) <= set(u["columns"]):
                return i
        return None


# ---------------------------------------------------------------- 기록기


def _safe(name):
    name = re.sub(r"[\[\]]", "_", name)
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name).strip() or "_"


_SPEC_RE = re.compile(r"(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})[-_]([A-Z][A-Z0-9]{1,9})[-_](\d{1,4})(?:[-_](\d{1,3}))?(?![A-Za-z0-9])")


def find_specs(*texts):
    out = []
    for t in texts:
        for m in _SPEC_RE.finditer(t or ""):
            s = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" + (f"-{m.group(4)}" if m.group(4) else "")
            if s not in out:
                out.append(s)
    return out


class Recorder:
    def __init__(self, cfg):
        self.cfg = cfg
        self.lock = threading.RLock()
        self.state = None  # None | "body" | "closing"
        self.cur = None
        self.tests = []
        self.catalog = Catalog()
        self.watched = weakref.WeakSet()
        self.pending = {}  # id(dbapi 연결) → {"pending": [기록], "sps": [(이름, 위치)]}
        self.filter = Filter(cfg)
        self.excluded = [0] * len(cfg["updatesOnly"])

    # 시험 구간
    def begin(self, test_id, group, name, specs):
        with self.lock:
            if self.state == "body":
                raise RuntimeError(
                    f"쓰기 보고서: 시험 구간이 겹칩니다 ({self.cur['id']} 실행 중에 {test_id} 시작). 직렬로 실행하세요 (병렬은 프로세스를 나눠야 합니다)."
                )
            if self.state == "closing":
                self.finalize()
            self.cur = {
                "id": test_id, "group": group, "name": name, "specs": specs,
                "started": _dt.datetime.now().astimezone().isoformat(timespec="milliseconds"),
                "raw": [], "status": "passed", "touched": False,
            }
            self.state = "body"

    def end_body(self):
        with self.lock:
            if self.state == "body":
                self.state = "closing"
                self.refresh_catalog(self.cur)

    def finalize(self):
        with self.lock:
            t = self.cur
            if t is None:
                return
            self.cur, self.state = None, None
            for raw in t["raw"]:
                st = self.pending.get(raw.get("conn"))
                if st and raw in st["pending"]:
                    st["pending"].remove(raw)
            writes = self.render(t, count=True)
            file = f"{_safe(t['group'])}/{_safe(t['name'])}.yaml"
            if not writes and not t["touched"]:
                old = self.cfg["output"] / file  # 다시 돌았는데 이제 쓰지 않는 시험: 옛 원본을 치운다
                if old.is_file():
                    old.unlink()
                return
            rec = {
                "id": t["id"], "group": t["group"], "name": t["name"],
                "file": file,
                "specs": t["specs"], "status": t["status"], "started": t["started"], "writes": writes,
            }
            p = self.cfg["output"] / rec["file"]
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(test_yaml(rec), encoding="utf-8")
            self.tests.append(rec)

    def render(self, t, count=False):
        writes = []
        for raw in t["raw"]:
            for w in render_raw(raw, self.catalog, self.cfg):
                if self.filter.table_excluded(w.get("table")):
                    continue
                i = self.filter.updates_only(w)
                if i is not None:
                    if count:
                        self.excluded[i] += 1
                    continue
                writes.append(w)
        out = []
        for n, w in enumerate(writes, 1):
            d = {"seq": n}
            d.update(w)
            out.append({k: d[k] for k in KEY_ORDER if k in d})
        return out

    # 쓰기 기록 (SQLAlchemy 이벤트)
    def wants(self, conn):
        if self.state != "body":
            return False
        if len(self.watched):
            try:
                return conn.engine in self.watched
            except Exception:
                return False
        return True

    def refresh_catalog(self, t):
        """시험이 쓴 테이블 중 카탈로그에 없는 것이 있으면 그 엔진의 새 연결로 읽는다.
        쓴 연결은 오류(22003 등) 뒤 트랜잭션이 중단돼 읽을 수 없으므로 쓰지 않는다."""
        engines, unknown = [], False
        for raw in t["raw"]:
            e = raw.get("engine")
            if e is not None and all(e is not x for x in engines):
                engines.append(e)
            if not unknown:
                try:
                    for st in split_statements(tokenize(raw["sql"], _paramstyle_set(raw["style"]))):
                        tpl = parse_statement(st)
                        if tpl and tpl.get("table"):
                            sc, tb = self.catalog.resolve(tpl["table"])
                            if self.catalog.table(sc, tb) is None:
                                unknown = True
                except Exception:
                    pass
        if not unknown:
            return
        for e in engines:
            try:
                with e.connect() as c:
                    data, schema = _read_catalog(_dbapi_of(c), e.dialect.name)
                for sc, ts in data.items():
                    self.catalog.data.setdefault(sc, {}).update(ts)  # 테이블 단위로 합친다
                if self.catalog.schema is None:
                    self.catalog.schema = schema
            except Exception:
                continue

    def tx_of(self, key):
        return self.pending.setdefault(key, {"pending": [], "sps": []})


R: Recorder | None = None
_ACTIVE_HEAD = re.compile(
    r"^\s*(?:(?:--[^\n]*\n|/\*[\s\S]*?\*/)\s*)*(insert|update|delete|merge|with|truncate|copy|call|replace)\b", re.I
)


def _dbapi_of(conn):
    try:
        fairy = conn.connection
        return getattr(fairy, "dbapi_connection", None) or getattr(fairy, "connection", None)
    except Exception:
        return None


def _autocommit(dbapi, dialect_name, conn):
    try:
        if conn.get_execution_options().get("isolation_level") == "AUTOCOMMIT":
            return True
    except Exception:
        pass
    if dialect_name == "sqlite":
        return getattr(dbapi, "isolation_level", "") is None
    v = getattr(dbapi, "autocommit", False)
    return v is True


def _on_before(conn, cursor, statement, parameters, context, executemany):
    r = R
    if r is None or r.state != "body" or not _ACTIVE_HEAD.match(statement or ""):
        return
    if context is not None and getattr(context, "_wr_raw", None) is not None:
        return  # insertmanyvalues 다음 묶음
    if not r.wants(conn):
        return
    with r.lock:
        dbapi = _dbapi_of(conn)
        dname = conn.dialect.name
        compiled = getattr(context, "compiled", None) if context is not None else None
        if compiled is not None and _INSERTMANYVALUES is not None and getattr(context, "execute_style", None) == _INSERTMANYVALUES:
            sql, sets = compiled.string, list(context.parameters)
        else:
            sql = statement
            sets = list(parameters) if executemany else [parameters]
        raw = {"sql": sql, "params": sets, "style": conn.dialect.paramstyle, "result": None, "conn": id(dbapi), "engine": conn.engine}
        r.cur["raw"].append(raw)
        if context is not None:
            try:
                context._wr_raw = raw
            except Exception:
                pass
        if dbapi is not None and not _autocommit(dbapi, dname, conn):
            r.tx_of(id(dbapi))["pending"].append(raw)


def _on_after(conn, cursor, statement, parameters, context, executemany):
    raw = getattr(context, "_wr_raw", None) if context is not None else None
    if raw is None:
        return
    n = getattr(cursor, "rowcount", -1)
    res = raw["result"] or {"rows": 0}
    if "rows" in res and n is not None and n >= 0:
        res["rows"] += n
    raw["result"] = res


def _on_error(ectx):
    raw = getattr(ectx.execution_context, "_wr_raw", None) if ectx.execution_context is not None else None
    if raw is None:
        return
    e = ectx.original_exception
    raw["result"] = {"error": sqlstate_of(e), "message": str(e)}


def _tx_end(conn, rolled):
    r = R
    if r is None:
        return
    with r.lock:
        st = r.pending.pop(id(_dbapi_of(conn)), None)
        if st and rolled:
            for raw in st["pending"]:
                raw["rolledBack"] = True


def _on_commit(conn):
    _tx_end(conn, False)


def _on_rollback(conn):
    _tx_end(conn, True)


def _on_savepoint(conn, name):
    r = R
    if r is None:
        return
    with r.lock:
        st = r.tx_of(id(_dbapi_of(conn)))
        st["sps"].append((name, len(st["pending"])))


def _sp_index(st, name):
    """savepoint 이벤트는 이름 없이(None) 오기도 한다. 이름이 없으면 가장 안쪽 것."""
    for k in range(len(st["sps"]) - 1, -1, -1):
        if st["sps"][k][0] == name:
            return k
    for k in range(len(st["sps"]) - 1, -1, -1):
        if st["sps"][k][0] is None:
            return k
    return len(st["sps"]) - 1


def _on_rollback_sp(conn, name, context):
    r = R
    if r is None:
        return
    with r.lock:
        st = r.pending.get(id(_dbapi_of(conn)))
        if not st:
            return
        k = _sp_index(st, name)
        if k >= 0:
            pos = st["sps"][k][1]
            for raw in st["pending"][pos:]:
                raw["rolledBack"] = True
            del st["pending"][pos:]
            del st["sps"][k + 1 :]


def _on_release_sp(conn, name, context):
    r = R
    if r is None:
        return
    with r.lock:
        st = r.pending.get(id(_dbapi_of(conn)))
        if not st:
            return
        k = _sp_index(st, name)
        if k >= 0:
            del st["sps"][k:]


def _on_pool_reset(dbapi_conn, *rest):
    # 연결이 트랜잭션 안에서 풀로 돌아가면 풀이 롤백한다
    r = R
    if r is None:
        return
    with r.lock:
        st = r.pending.pop(id(dbapi_conn), None)
        if st:
            for raw in st["pending"]:
                raw["rolledBack"] = True


_LISTENERS = [
    (Engine, "before_cursor_execute", _on_before),
    (Engine, "after_cursor_execute", _on_after),
    (Engine, "handle_error", _on_error),
    (Engine, "commit", _on_commit),
    (Engine, "rollback", _on_rollback),
    (Engine, "savepoint", _on_savepoint),
    (Engine, "rollback_savepoint", _on_rollback_sp),
    (Engine, "release_savepoint", _on_release_sp),
    (Pool, "reset", _on_pool_reset),
]


def install(cfg):
    global R
    R = Recorder(cfg)
    for target, name, fn in _LISTENERS:
        if not event.contains(target, name, fn):
            event.listen(target, name, fn)
    return R


def watch(engine):
    """이 엔진에서 온 쓰기만 기록한다 (부르지 않으면 모든 엔진). AsyncEngine 은 sync_engine 을 넘긴다."""
    if R is not None:
        R.watched.add(getattr(engine, "sync_engine", engine))


# ---------------------------------------------------------------- 승인본 비교


def assert_writes(name, *tables):
    """지금 시험이 쓴 것을 승인본과 비교한다. 테이블을 고르면 그 테이블만."""
    r = R
    if r is None or r.cur is None:
        raise RuntimeError("쓰기 보고서: 시험 본문 안에서 부르세요 (conftest.py 에 pytest_plugins 등록 확인)")
    with r.lock:
        r.cur["touched"] = True
        r.refresh_catalog(r.cur)
        writes = r.render(r.cur)
        text = approved_yaml(writes, list(tables), r.catalog, r.cfg)
        group, fname = _safe(r.cur["group"]), _safe(name) + ".yaml"
    cfg = r.cfg
    ap = cfg["approved"] / group / fname
    rp = cfg["output"] / "received" / group / fname
    if os.environ.get(APPROVE_ENV) == "1":
        ap.parent.mkdir(parents=True, exist_ok=True)
        ap.write_text(text, encoding="utf-8")
        if rp.exists():
            rp.unlink()
        return
    old = ap.read_text(encoding="utf-8") if ap.is_file() else None
    if old == text:
        if rp.exists():
            rp.unlink()
        return
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(text, encoding="utf-8")
    root = cfg["root"]

    def rel(p):
        try:
            return str(p.relative_to(root))
        except ValueError:
            return str(p)

    if old is None:
        head = f"쓰기 보고서: 승인본이 없습니다: {rel(ap)}\n받은 값: {rel(rp)}\n승인: {APPROVE_ENV}=1 pytest"
        diff = text.splitlines()[:40]
    else:
        head = f"쓰기 보고서: 승인본과 다릅니다: {rel(ap)}\n받은 값: {rel(rp)}\n승인: {APPROVE_ENV}=1 pytest"
        diff = list(difflib.unified_diff(old.splitlines(), text.splitlines(), "approved", "received", lineterm=""))[:40]
    raise AssertionError(head + "\n" + "\n".join(diff))


class WriteReport:
    """fixture `write_report` 가 주는 객체."""

    def assert_writes(self, name, *tables):
        assert_writes(name, *tables)

    def watch(self, engine):
        watch(engine)


# ---------------------------------------------------------------- 색인 · 화면


def _test_entry(t):
    return {"id": t["id"], "group": t["group"], "name": t["name"], "file": t["file"], "specs": t["specs"],
            "status": t["status"], "writes": [{k: j_val(v) for k, v in w.items()} for w in t["writes"]]}


def write_index(cfg, tests, catalog, excluded):
    """기존 index.json 과 합친다: 이번 실행 시험이 덮고, 원본 yaml 이 없어진 시험은 뺀다. catalog 는 테이블 단위로."""
    out = cfg["output"]
    out.mkdir(parents=True, exist_ok=True)
    merged, cat = {}, {}
    p = out / "index.json"
    if p.is_file():
        try:
            old = json.loads(p.read_text(encoding="utf-8"))
            for t in old.get("tests", []):
                merged[t["id"]] = t
            for sc, ts in (old.get("catalog") or {}).items():
                cat.setdefault(sc, {}).update(ts)
        except (ValueError, KeyError, TypeError):
            pass
    for t in tests:
        merged[t["id"]] = _test_entry(t)
    for sc, ts in catalog.items():
        cat.setdefault(sc, {}).update(ts)
    idx = {
        "format": 1,
        "generatedAt": _dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "repo": cfg["root"].name,
        "stack": STACK,
        "tests": [t for t in merged.values() if (out / t["file"]).is_file()],
        "catalog": cat,
        "excluded": {
            "tables": cfg["excludeTables"],
            "updatesOnly": [
                {"table": u["table"], "columns": u["columns"], "count": excluded[i]} for i, u in enumerate(cfg["updatesOnly"])
            ],
        },
    }
    data = json.dumps(idx, ensure_ascii=False, indent=1)
    tmp = out / f"index.json.{os.getpid()}.tmp"
    tmp.write_text(data + "\n", encoding="utf-8")
    os.replace(tmp, p)
    viewer = cfg["viewer"]
    if viewer.is_file():
        html = viewer.read_text(encoding="utf-8")
        compact = json.dumps(idx, ensure_ascii=False).replace("</", "<\\/")
        (out / "index.html").write_text(html.replace("/*__WRITE_REPORT_DATA__*/null", compact, 1), encoding="utf-8")


# ---------------------------------------------------------------- pytest 훅


def _is_worker(config):
    return hasattr(config, "workerinput")


def pytest_configure(config):
    config.addinivalue_line("markers", "spec(*ids): 기획 ID (쓰기 보고서 specs)")
    cfg = load_config(Path(str(config.rootpath if hasattr(config, "rootpath") else config.rootdir)))
    if not _is_worker(config):
        os.environ.setdefault(RUN_ENV, _uuid.uuid4().hex)
    install(cfg)


def _test_names(item):
    path = item.nodeid.split("::")[0]
    group = re.sub(r"\.py$", "", path).replace("/", ".").replace("\\", ".")
    name = ".".join(item.nodeid.split("::")[1:]) or item.name
    return group, name


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_call(item):
    r = R
    if r is None:
        yield
        return
    group, name = _test_names(item)
    specs = []
    for m in item.iter_markers("spec"):
        specs.extend(str(a) for a in m.args)
    specs += [s for s in find_specs(name) if s not in specs]
    r.begin(f"{group}#{name}", group, name, specs)
    r.cur["touched"] = "write_report" in getattr(item, "fixturenames", ())
    try:
        yield
    finally:
        r.end_body()


def pytest_runtest_makereport(item, call):
    r = R
    if r is None or call.when != "call" or r.cur is None:
        return
    if call.excinfo is None:
        r.cur["status"] = "passed"
    elif call.excinfo.errisinstance(pytest.skip.Exception):
        r.cur["status"] = "skipped"
    else:
        r.cur["status"] = "failed"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_teardown(item, nextitem):
    yield
    if R is not None:
        R.finalize()  # fixture 정리(롤백)까지 본 뒤 원본을 쓴다


def pytest_sessionfinish(session):
    r = R
    if r is None:
        return
    r.finalize()
    cfg = r.cfg
    parts = cfg["output"] / ".parts" / os.environ.get(RUN_ENV, "local")
    if _is_worker(session.config):
        parts.mkdir(parents=True, exist_ok=True)
        wid = session.config.workerinput.get("workerid", str(os.getpid()))
        (parts / f"{wid}.json").write_text(
            json.dumps({"tests": [dict(t, writes=[{k: _pickle(v) for k, v in w.items()} for w in t["writes"]]) for t in r.tests],
                        "catalog": r.catalog.data, "excluded": r.excluded}, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        return
    tests, catalog, excluded = list(r.tests), dict(r.catalog.data), list(r.excluded)
    if parts.is_dir():
        for f in sorted(parts.glob("*.json")):
            d = json.loads(f.read_text(encoding="utf-8"))
            tests += [dict(t, writes=[{k: _unpickle(v) for k, v in w.items()} for w in t["writes"]]) for t in d["tests"]]
            for s, ts in d["catalog"].items():
                catalog.setdefault(s, {}).update(ts)
            excluded = [a + b for a, b in zip(excluded, d["excluded"])]
        shutil.rmtree(cfg["output"] / ".parts", ignore_errors=True)
    write_index(cfg, tests, catalog, excluded)


# xdist 워커 → 컨트롤러로 넘길 때 값 표지를 JSON 으로
def _pickle(v):
    if isinstance(v, SqlExpr):
        return {"$sql": v.text}
    if isinstance(v, Bytes):
        return {"$bytes": v.n}
    if isinstance(v, DateVal):
        return {"$date": v.s}
    if isinstance(v, NumText):
        return {"$num": v.s}
    if isinstance(v, decimal.Decimal):
        return {"$num": _dec_text(v)}
    if isinstance(v, list):
        return [_pickle(x) for x in v]
    if isinstance(v, dict):
        return {k: _pickle(x) for k, x in v.items()}
    return v


def _unpickle(v):
    if isinstance(v, dict):
        if len(v) == 1:
            (k, x), = v.items()
            if k == "$sql":
                return SqlExpr(x)
            if k == "$bytes":
                return Bytes(x)
            if k == "$date":
                return DateVal(x)
            if k == "$num":
                return NumText(x)
        return {k: _unpickle(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_unpickle(x) for x in v]
    return v


@pytest.fixture
def write_report():
    """시험 안에서 `write_report.assert_writes("이름", "app.orders")`. 이 fixture 를 쓴 시험은 쓴 것이 없어도 색인에 남는다."""
    return WriteReport()
