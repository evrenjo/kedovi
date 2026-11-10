#!/usr/bin/env python3
"""기능 폴더 · 역할 파일 검사 (kedovi archrules fastapi 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다).

실행: python tools/check_role_files.py   (표준 라이브러리만 쓴다. 어기면 끝 코드 1)

검사
  1. 기능 폴더(<패키지>/feature/<기능>/[<하위기능>/])에는 허용 목록의 파일만 둔다
  2. 다른 기능은 공개 파일(service · schemas · models · exceptions)만 import 한다. 하위 기능은 자기 상위 기능 전부
  3. 역할 파일(router · dependencies · service · repository · client)에는 클래스 · 대문자 상수를 두지 않는다
  4. NO_HELPER_FUNCTIONS 가 True 면 역할 파일에 도우미 함수 0개 (밑줄 함수 · 자기 파일만 부르는 함수)
  5. COMPONENT_WEB 가 True 면 (backend.layout = component-web)
     - 기능 폴더에 router.py 를 두지 않는다 (web/views/<화면>/router.py 로)
     - web 은 web/views/<화면 경로>/<파일> · web/api/<묶음>/<파일> 이고 파일은 WEB_FILES 만
     - feature · config · shared 는 web 을 import 하지 않는다. web 단위(화면 · API 묶음)끼리 import 하지 않는다
     - web 은 기능의 공개 파일만 import 한다. 공통 코드는 customer/<고객> 을, 고객사끼리도 서로 import 하지 않는다
"""
import ast
import sys
from pathlib import Path

PACKAGE = "__PACKAGE__"
SOURCE_ROOT = Path(__file__).resolve().parent.parent / "__SOURCE_DIR__"
NO_HELPER_FUNCTIONS = __NO_HELPER_FUNCTIONS__
COMPONENT_WEB = __COMPONENT_WEB__

# 기능 폴더에 둘 수 있는 파일 (확장자 뺀 이름)
ALLOWED_FILES = {
    "__init__", "router", "dependencies", "schemas", "models", "service",
    "repository", "mapper", "client", "exceptions", "config", "constants",
}
# 도우미를 빼 두는 파일 이름 끝 (예: fee_calculator.py). 프로젝트에 맞게 더한다
HELPER_SUFFIXES = (
    "_validator", "_calculator", "_parser", "_formatter", "_policy", "_resolver",
    "_matcher", "_converter", "_verifier", "_classifier", "_generator",
)
# 다른 기능이 import 해도 되는 파일
PUBLIC_FILES = {"service", "schemas", "models", "exceptions"}
# 역할 파일: 클래스 · 대문자 상수 금지, 도우미 함수 검사 대상
ROLE_FILES = {"router", "dependencies", "service", "repository", "client"}
# component-web: web 폴더(화면 · API 묶음)에 둘 수 있는 파일
WEB_FILES = {"__init__", "router", "dependencies", "schemas", "mapper"}


def module_name(path: Path) -> str:
    rel = path.relative_to(SOURCE_ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def split_customer(module: str):
    """component-web 의 <패키지>.customer.<고객>.… 이면 (고객, <패키지>.… 나머지), 아니면 (None, module)."""
    parts = module.split(".")
    if COMPONENT_WEB and len(parts) >= 3 and parts[0] == PACKAGE and parts[1] == "customer":
        return parts[2], ".".join([PACKAGE] + parts[3:])
    return None, module


def feature_unit(module: str):
    """<패키지>.feature.<기능>[.<하위기능>] 단위와 파일 이름. 기능 밖이면 (None, None). 고객사 코드는 단위 앞에 customer.<고객>."""
    customer, body = split_customer(module)
    prefix = f"customer.{customer}." if customer else ""
    parts = body.split(".")
    if len(parts) < 4 or parts[0] != PACKAGE or parts[1] != "feature":
        return None, None
    # feature.<기능>.<파일> 또는 feature.<기능>.<하위기능>.<파일>
    if len(parts) == 4 or parts[3] in ALLOWED_FILES or parts[3].endswith(HELPER_SUFFIXES):
        return prefix + ".".join(parts[:3]), parts[3]
    if len(parts) >= 5:
        return prefix + ".".join(parts[:4]), parts[4]
    return prefix + ".".join(parts[:4]), None


def body_top(module: str) -> str:
    """고객사 접두를 뺀 첫 단계 (feature · web · config · shared …)."""
    parts = split_customer(module)[1].split(".")
    return parts[1] if len(parts) > 1 and parts[0] == PACKAGE else ""


def web_unit(module: str):
    """component-web: (<패키지>.web.views|api.<이름…> 단위, 파일 이름). 모듈이 폴더 자신이면 파일은 None. web 밖이면 (None, None)."""
    if not COMPONENT_WEB:
        return None, None
    customer, body = split_customer(module)
    prefix = f"customer.{customer}." if customer else ""
    parts = body.split(".")
    if len(parts) < 3 or parts[0] != PACKAGE or parts[1] != "web":
        return None, None
    for i in range(3, len(parts)):
        if parts[i] in WEB_FILES or parts[i].endswith(HELPER_SUFFIXES):
            return prefix + ".".join(parts[:i]), parts[i]
    return prefix + ".".join(parts), None


def imported_modules(tree: ast.AST, module: str, is_pkg: bool):
    """(줄, 절대 모듈 이름) 목록. 상대 import 도 절대 이름으로."""
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


def names_used(tree: ast.AST):
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            out.add(node.id)
        elif isinstance(node, ast.Attribute):
            out.add(node.attr)
        elif isinstance(node, ast.ImportFrom):
            out.update(alias.name for alias in node.names)
    return out


def main() -> int:
    pkg_dir = SOURCE_ROOT / PACKAGE
    if not pkg_dir.is_dir():
        print(f"패키지 폴더가 없습니다: {pkg_dir} (PACKAGE · SOURCE_ROOT 를 고친다)")
        return 1
    files = sorted(p for p in pkg_dir.rglob("*.py") if "__pycache__" not in p.parts)
    trees = {}
    for path in files:
        try:
            trees[path] = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as e:
            print(f"{path}: 읽지 못함 ({e})")
            return 1
    used_elsewhere = {path: set().union(*(names_used(t) for p, t in trees.items() if p != path)) for path in trees}
    problems = []
    for path, tree in trees.items():
        module = module_name(path)
        rel = path.relative_to(SOURCE_ROOT)
        unit, file_role = feature_unit(module)
        w_unit, w_file = web_unit(module)
        top = body_top(module)
        customer = split_customer(module)[0]

        # 1. 허용 목록 (__init__.py 는 기능 · 하위 기능 폴더 표시라 보지 않는다)
        if path.name == "__init__.py":
            pass
        elif unit and file_role is None:
            problems.append(f"{rel}: 기능 폴더는 feature/<기능>/<파일> · feature/<기능>/<하위기능>/<파일> 까지다")
        elif unit and file_role not in ALLOWED_FILES and not file_role.endswith(HELPER_SUFFIXES):
            problems.append(f"{rel}: 기능 폴더에 둘 수 없는 파일 이름 '{file_role}' (허용: {', '.join(sorted(ALLOWED_FILES))} · *{'/*'.join(HELPER_SUFFIXES)})")
        if COMPONENT_WEB and unit and file_role == "router":
            problems.append(f"{rel}: 기능 안에 router.py 를 두지 않는다. 진입점은 web/views/<화면>/router.py (화면이 부르지 않는 API 는 web/api/<묶음>/router.py)")
        if COMPONENT_WEB and top == "web" and path.name != "__init__.py":
            parts = split_customer(module)[1].split(".")
            if len(parts) < 5 or parts[2] not in ("views", "api") or w_file is None:
                problems.append(f"{rel}: web 은 web/views/<화면 경로>/<파일> · web/api/<묶음>/<파일> 이고 파일은 {', '.join(sorted(WEB_FILES - {'__init__'}))} · *{'/*'.join(HELPER_SUFFIXES)}")

        # 2. import 경계
        for line, target in imported_modules(tree, module, path.name == "__init__.py"):
            if COMPONENT_WEB:
                t_customer = split_customer(target)[0]
                if t_customer and t_customer != customer:
                    problems.append(f"{rel}:{line}: " + (f"공통 코드는 customer/{t_customer} 를 import 하지 않는다. 공통이 인터페이스를 정하고 고객사가 구현한다" if not customer else f"customer/{customer} 는 customer/{t_customer} 를 import 하지 않는다") + f" ({target})")
                    continue
                t_web, _ = web_unit(target)
                if t_web and top in ("feature", "config", "shared"):
                    problems.append(f"{rel}:{line}: {top} 는 web 을 import 하지 않는다 (방향은 web → feature → shared) ({target})")
                    continue
                if t_web and w_unit and t_web != w_unit and not t_web.startswith(w_unit + ".") and not w_unit.startswith(t_web + "."):
                    problems.append(f"{rel}:{line}: {w_unit} 는 {t_web} 를 import 하지 않는다. 함께 쓰는 것은 feature 나 shared 로 ({target})")
                    continue
            t_unit, t_file = feature_unit(target)
            if not t_unit:
                continue
            if top in ("config", "shared"):
                problems.append(f"{rel}:{line}: config · shared 는 feature 를 import 하지 않는다 ({target})")
                continue
            own = unit or (w_unit if w_file is not None or path.name == "__init__.py" else None)
            if not own or t_unit == own or own.startswith(t_unit + "."):
                continue
            if t_file and t_file not in PUBLIC_FILES:
                problems.append(f"{rel}:{line}: 다른 기능의 {t_file} 파일은 그 기능 내부다 (공개: {', '.join(sorted(PUBLIC_FILES))}) ({target})")

        if not ((unit and file_role in ROLE_FILES) or (w_unit and w_file in ROLE_FILES)):
            continue
        # 3. 클래스 · 대문자 상수
        for node in tree.body:
            if isinstance(node, ast.ClassDef):
                problems.append(f"{rel}:{node.lineno}: 역할 파일에 클래스 {node.name} (schemas · models · exceptions 로)")
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
            for t in targets:
                if isinstance(t, ast.Name) and t.id.isupper() and len(t.id) > 1:
                    problems.append(f"{rel}:{node.lineno}: 역할 파일에 상수 {t.id} (constants · config · Enum 으로)")
        # 4. 도우미 함수
        if not NO_HELPER_FUNCTIONS:
            continue
        own_uses = names_used(tree)
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.decorator_list:
                continue  # 데코레이터가 붙은 함수(경로 · 이벤트 · 캐시)는 진입점으로 본다
            if node.name.startswith("_"):
                problems.append(f"{rel}:{node.lineno}: 도우미 함수 {node.name} (하는 일 이름의 *_calculator 등 파일로)")
            elif node.name in own_uses and node.name not in used_elsewhere[path]:
                problems.append(f"{rel}:{node.lineno}: 자기 파일만 부르는 도우미 함수 {node.name}")

    for p in problems:
        print(p)
    print(f"{'✖' if problems else '✔'} 역할 파일 검사: {len(files)}개 파일, 어긴 곳 {len(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
