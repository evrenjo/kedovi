#!/usr/bin/env python3
"""기능 폴더 · 역할 파일 검사 (kedovi archrules fastapi 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다).

실행: python tools/check_role_files.py   (표준 라이브러리만 쓴다. 어기면 끝 코드 1)

검사
  1. 기능 폴더(<패키지>/feature/<기능>/[<하위기능>/])에는 허용 목록의 파일만 둔다
  2. 다른 기능은 공개 파일(service · schemas · models · exceptions)만 import 한다. 하위 기능은 자기 상위 기능 전부
  3. 역할 파일(router · dependencies · service · repository · client)에는 클래스 · 대문자 상수를 두지 않는다
  4. NO_HELPER_FUNCTIONS 가 True 면 역할 파일에 도우미 함수 0개 (밑줄 함수 · 자기 파일만 부르는 함수)
"""
import ast
import sys
from pathlib import Path

PACKAGE = "__PACKAGE__"
SOURCE_ROOT = Path(__file__).resolve().parent.parent / "__SOURCE_DIR__"
NO_HELPER_FUNCTIONS = __NO_HELPER_FUNCTIONS__

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


def module_name(path: Path) -> str:
    rel = path.relative_to(SOURCE_ROOT).with_suffix("")
    parts = list(rel.parts)
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)


def feature_unit(module: str):
    """<패키지>.feature.<기능>[.<하위기능>] 단위와 파일 이름. 기능 밖이면 (None, None)."""
    parts = module.split(".")
    if len(parts) < 4 or parts[0] != PACKAGE or parts[1] != "feature":
        return None, None
    # feature.<기능>.<파일> 또는 feature.<기능>.<하위기능>.<파일>
    if len(parts) == 4 or parts[3] in ALLOWED_FILES or parts[3].endswith(HELPER_SUFFIXES):
        return ".".join(parts[:3]), parts[3]
    if len(parts) >= 5:
        return ".".join(parts[:4]), parts[4]
    return ".".join(parts[:4]), None


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
        top = module.split(".")[1] if "." in module else ""

        # 1. 허용 목록 (__init__.py 는 기능 · 하위 기능 폴더 표시라 보지 않는다)
        if path.name == "__init__.py":
            pass
        elif unit and file_role is None:
            problems.append(f"{rel}: 기능 폴더는 feature/<기능>/<파일> · feature/<기능>/<하위기능>/<파일> 까지다")
        elif unit and file_role not in ALLOWED_FILES and not file_role.endswith(HELPER_SUFFIXES):
            problems.append(f"{rel}: 기능 폴더에 둘 수 없는 파일 이름 '{file_role}' (허용: {', '.join(sorted(ALLOWED_FILES))} · *{'/*'.join(HELPER_SUFFIXES)})")

        # 2. import 경계
        for line, target in imported_modules(tree, module, path.name == "__init__.py"):
            t_unit, t_file = feature_unit(target)
            if not t_unit:
                continue
            if top in ("config", "shared"):
                problems.append(f"{rel}:{line}: config · shared 는 feature 를 import 하지 않는다 ({target})")
                continue
            if not unit or t_unit == unit or unit.startswith(t_unit + "."):
                continue
            if t_file and t_file not in PUBLIC_FILES:
                problems.append(f"{rel}:{line}: 다른 기능의 {t_file} 파일은 그 기능 내부다 (공개: {', '.join(sorted(PUBLIC_FILES))}) ({target})")

        if not unit or file_role not in ROLE_FILES:
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
