---
title: Django component-web 구조
load: on-demand
when: Django 에서 뷰 · URL · 화면 API · 기능 앱을 새로 만들거나 옮길 때
if: vars.backend.layout=component-web
---

## Django component-web (`{{ws:vars.django.package}}`)

개념 · 의존 방향은 backend 팩 「백엔드 구조 (기능 핵심 + 화면 기준 web 층)」.

```
<패키지>/
  urls.py                                web 의 urls 를 include 만
  feature/<기능>/                          Django 앱: apps.py · models.py · services.py · selectors.py · migrations/. views · urls · serializers 없음
  web/views/<화면 경로>/                   views.py · urls.py · serializers.py (화면 요청 · 응답 · 검증)
  web/api/<묶음>/                         같은 모양
  config/  shared/<개념>/
  customer/<고객>/feature/… · customer/<고객>/web/…   (선택)
```

- 기능 앱은 `INSTALLED_APPS` 에 `<패키지>.feature.<기능>` 으로 등록한다. web 폴더는 앱이 아니다 (모델 없음).
- 화면 뷰는 기능의 `services` · `selectors` 를 부르고 ORM 질의를 직접 쓰지 않는다. 다른 화면 폴더를 import 하지 않는다.
- **검사는 장치로:** `kedovi archrules django` 가 import-linter 계약(`<repo>/.importlinter`)과 `<repo>/tools/check_web_layout.py`(기능 안 views · urls 금지 · 화면끼리 ↛ · web 은 기능의 services · selectors · models · exceptions 만)를 넣는다.
