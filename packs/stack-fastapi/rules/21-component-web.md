---
title: FastAPI component-web 구조
load: on-demand
when: FastAPI 에서 라우터 · 화면 API · 기능 폴더를 새로 만들거나 옮길 때
if: vars.backend.layout=component-web
---

## FastAPI component-web (`{{ws:vars.fastapi.package}}`)

개념 · 의존 방향은 backend 팩 「백엔드 구조 (기능 핵심 + 화면 기준 web 층)」. 기능 안 파일은 「FastAPI 폴더 구조 (기능 먼저)」 를 쓰고 (`fastapi.packageLayout = feature`), `router.py` 만 web 으로 옮긴다.

```
<패키지>/
  main.py                                앱 조립만 (web 라우터 include)
  feature/<기능>/[<하위기능>/]             service · repository · mapper · client · schemas · models · exceptions … (router.py 없음)
  web/views/<화면 경로>/                   router.py · dependencies.py · schemas.py (화면 요청 · 응답) · mapper.py
  web/api/<묶음>/                         같은 모양
  config/  shared/<개념>/
  customer/<고객>/feature/… · customer/<고객>/web/…   (선택)
```

- 화면 폴더 이름은 파이썬 패키지라 `-` 대신 `_` (프론트 `order-list` = `order_list`, 대조는 같은 이름으로 본다).
- 화면 `router.py` 는 기능의 `service` 를 `Depends()` 로 받고 `repository` 를 직접 import 하지 않는다.
- **검사는 장치로:** `kedovi archrules fastapi` 가 component-web 이면 import-linter 계약(feature ↛ web, config · shared ↛ feature · web, 공통 ↛ customer)과 `<repo>/tools/check_role_files.py`(web 폴더 파일 목록 · 기능 안 router 금지 · 화면끼리 ↛ · web 은 기능 공개 파일만)를 넣는다.
