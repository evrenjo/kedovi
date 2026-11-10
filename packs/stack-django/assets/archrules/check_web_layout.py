#!/usr/bin/env python3
"""component-web 배치 · 경계 검사 (kedovi archrules django 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다).

실행: python tools/check_web_layout.py   (표준 라이브러리만 쓴다. 어기면 끝 코드 1)

검사
  1. 기능 앱(<패키지>/feature/<기능>/)에 views · urls · serializers 를 두지 않는다 (web/views/<화면>/ 로)
  2. web 은 web/views/<화면 경로>/<파일> · web/api/<묶음>/<파일> 이고 파일은 WEB_FILES 만
  3. feature · config · shared 는 web 을 import 하지 않는다. 화면 · API 묶음끼리 import 하지 않는다
  4. web 은 기능의 공개 모듈(PUBLIC_MODULES)만 import 한다 (ORM 질의는 기능의 services · selectors 에)
  5. 공통 코드는 customer/<고객> 을, 고객사끼리도 서로 import 하지 않는다
"""
import ast
import sys
from pathlib import Path

PACKAGE = "__PACKAGE__"
SOURCE_ROOT = Path(__file__).resolve().parent.parent / "__SOURCE_DIR__"

# 기능 앱에 두지 않는 파일 (진입점 · 화면 모양)
ENTRY_FILES = {"views", "urls", "serializers"}
# web 폴더에 둘 수 있는 파일
WEB_FILES = {"__init__", "views", "urls", "serializers", "permissions", "mapper"}
# web 이 import 해도 되는 기능 모듈
PUBLIC_MODULES = {"services", "selectors", "models", "exceptions", "constants"}


def module_name(path: Path) -> str:
    parts = list(path.relative_to(SOURCE_ROOT).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def split_customer(module: str):
    parts = module.split(".")
    if len(parts) >= 3 and parts[0] == PACKAGE and parts[1] == "customer":
        return parts[2], ".".join([PACKAGE] + parts[3:])
    return None, module


def body_parts(module: str):
    return split_customer(module)[1].split(".")


def top(module: str) -> str:
    parts = body_parts(module)
    return parts[1] if len(parts) > 1 and parts[0] == PACKAGE else ""


def feature_unit(module: str):
    """(<패키지>.feature.<기능> 단위, 그 안 첫 모듈 이름). 기능 밖이면 (None, None)."""
    customer, _ = split_customer(module)
    parts = body_parts(module)
    if len(parts) < 3 or parts[0] != PACKAGE or parts[1] != "feature":
        return None, None
    prefix = f"customer.{customer}." if customer else ""
    return prefix + ".".join(parts[:3]), (parts[3] if len(parts) > 3 else None)


def web_unit(module: str):
    """(<패키지>.web.views|api.<이름…> 단위, 파일 이름). 폴더 자신이면 파일 None. web 밖이면 (None, None)."""
    customer, _ = split_customer(module)
    parts = body_parts(module)
    if len(parts) < 3 or parts[0] != PACKAGE or parts[1] != "web":
        return None, None
    prefix = f"customer.{customer}." if customer else ""
    for i in range(3, len(parts)):
        if parts[i] in WEB_FILES:
            return prefix + ".".join(parts[:i]), parts[i]
    return prefix + ".".join(parts), None


def imported_modules(tree: ast.AST, module: str, is_pkg: bool):
    base = module.split(".") if is_pkg else module.split(".")[:-1]
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                up = base[: len(base) - (node.level - 1)] if node.level > 1 else base
                prefix = ".".join(up + ([node.module] if node.module else []))
            else:
                prefix = node.module or ""
            for alias in node.names:
                yield node.lineno, f"{prefix}.{alias.name}"


def main() -> int:
    pkg_dir = SOURCE_ROOT / PACKAGE
    if not pkg_dir.is_dir():
        print(f"패키지 폴더가 없습니다: {pkg_dir} (PACKAGE · SOURCE_ROOT 를 고친다)")
        return 1
    files = sorted(p for p in pkg_dir.rglob("*.py") if "__pycache__" not in p.parts and "migrations" not in p.parts)
    problems = []
    for path in files:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as e:
            print(f"{path}: 읽지 못함 ({e})")
            return 1
        module = module_name(path)
        rel = path.relative_to(SOURCE_ROOT)
        f_unit, f_mod = feature_unit(module)
        w_unit, w_file = web_unit(module)
        where = top(module)
        customer = split_customer(module)[0]

        # 1 · 2. 배치
        if f_unit and f_mod in ENTRY_FILES:
            problems.append(f"{rel}: 기능 앱에 {f_mod}.py 를 두지 않는다. 화면 API 는 web/views/<화면>/{f_mod}.py (화면이 부르지 않는 API 는 web/api/<묶음>/)")
        if where == "web" and path.name != "__init__.py":
            parts = body_parts(module)
            if len(parts) < 5 or parts[2] not in ("views", "api") or w_file is None:
                problems.append(f"{rel}: web 은 web/views/<화면 경로>/<파일> · web/api/<묶음>/<파일> 이고 파일은 {', '.join(sorted(WEB_FILES - {'__init__'}))}")

        # 3 · 4 · 5. import 경계
        for line, target in imported_modules(tree, module, path.name == "__init__.py"):
            t_customer = split_customer(target)[0]
            if t_customer and t_customer != customer:
                problems.append(f"{rel}:{line}: " + (f"공통 코드는 customer/{t_customer} 를 import 하지 않는다" if not customer else f"customer/{customer} 는 customer/{t_customer} 를 import 하지 않는다") + f" ({target})")
                continue
            t_web, _ = web_unit(target)
            if t_web and where in ("feature", "config", "shared"):
                problems.append(f"{rel}:{line}: {where} 는 web 을 import 하지 않는다 (방향은 web → feature → shared) ({target})")
                continue
            if t_web and w_unit and t_web != w_unit and not t_web.startswith(w_unit + ".") and not w_unit.startswith(t_web + "."):
                problems.append(f"{rel}:{line}: {w_unit} 는 {t_web} 를 import 하지 않는다. 함께 쓰는 것은 feature 나 shared 로 ({target})")
                continue
            t_unit, t_mod = feature_unit(target)
            if t_unit and w_unit and t_mod and t_mod not in PUBLIC_MODULES:
                problems.append(f"{rel}:{line}: web 은 기능의 {', '.join(sorted(PUBLIC_MODULES))} 만 import 한다 ({target})")

    for p in problems:
        print(p)
    print(f"{'✖' if problems else '✔'} web 배치 검사: {len(files)}개 파일, 어긴 곳 {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
