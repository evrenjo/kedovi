---
title: NestJS component-web 구조
load: on-demand
when: NestJS 에서 컨트롤러 · 모듈 · 화면 API · 기능 폴더를 새로 만들거나 옮길 때
if: vars.backend.layout=component-web
---

## NestJS component-web

개념 · 의존 방향은 backend 팩 「백엔드 구조 (기능 핵심 + 화면 기준 web 층)」.

```
src/
  app.module.ts                         조립만 (기능 모듈 · 화면 모듈 imports)
  feature/<기능>/                        <기능>.module.ts · *.service.ts · *.repository.ts · 엔티티 · 기능 DTO. 컨트롤러 없음
  web/views/<화면 경로>/                  <화면>.module.ts · <화면>.controller.ts · dto/*.dto.ts
  web/api/<묶음>/                        같은 모양 (화면이 부르지 않는 API)
  config/  shared/<개념>/
  customer/<고객>/feature/… · customer/<고객>/web/…   (선택)
```

- 화면 모듈은 필요한 기능 모듈을 `imports` 하고, 기능 모듈은 화면이 쓸 provider 만 `exports` 한다. 기능 모듈은 화면 모듈을 `imports` 하지 않는다.
- 화면 요청 · 응답은 `web/views/<화면>/dto` 의 DTO + class-validator. 기능 엔티티를 그대로 돌려주지 않는다.
- **검사는 장치로:** `kedovi archrules nestjs` 가 dependency-cruiser 설정(`<repo>/.dependency-cruiser.cjs`)을 넣는다: feature ↛ web, config · shared ↛ feature · web, 화면 폴더끼리 ↛, 공통 ↛ customer, feature 안 `*.controller.ts` 금지.
