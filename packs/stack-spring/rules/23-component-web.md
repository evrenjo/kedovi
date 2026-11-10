---
title: Spring component-web 구조
load: on-demand
when: Spring 에서 컨트롤러 · 화면 API · 기능 패키지를 새로 만들거나 옮길 때
if: vars.backend.layout=component-web
---

## Spring component-web (`{{ws:vars.spring.basePackage}}`)

개념 · 의존 방향은 backend 팩 「백엔드 구조 (기능 핵심 + 화면 기준 web 층)」. 기능 안 구조는 「Spring 패키지 구조 (기능 먼저)」 를 그대로 쓰고 (`spring.packageLayout = feature-first`), 진입점만 web 으로 옮긴다.

```
<기준 패키지>/
  feature/<기능>/[<하위기능>/]<계층>/     controller · websocket 계층은 쓰지 않는다
  web/views/<화면 경로>/<web 계층>/       화면 경로는 프론트 화면 폴더 경로 (소문자, '-' 는 빼고 붙인다: order-list → orderlist)
  web/api/<묶음>/<web 계층>/
  config/  shared/<개념>/
  customer/<고객>/feature/… · customer/<고객>/web/…   (선택)
```

| web 계층 | 담는 것 | 이름 끝 |
|---|---|---|
| `controller` | `@RestController` | `*Controller` |
| `dto` | 화면 요청 · 응답 + Bean Validation | `*Request` · `*Response` |
| `mapper` | 기능 모델 → 화면 응답 (MapStruct) | `*Mapper` |
| `websocket` | 화면이 여는 웹소켓 | `*Handler` |

- 컨트롤러는 기능의 `service` 를 부르고 `repository` 를 직접 주입하지 않는다. 다른 화면 패키지를 import 하지 않는다.
- 화면 응답은 `web/views/<화면>/dto` 의 `*Response` 로 만든다. 기능의 엔티티 · 모델을 그대로 돌려주지 않는다.
- **검사는 장치로:** `kedovi archrules spring` 이 component-web 이면 최상위 배치(feature · web · config · shared · customer) · web 계층 · 기능 안 진입점 금지 · 의존 방향(feature ↛ web, config · shared ↛ feature · web, 화면끼리 ↛, 공통 ↛ customer)을 ArchUnit 으로 넣는다.
