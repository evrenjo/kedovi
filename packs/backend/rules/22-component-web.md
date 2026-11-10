---
title: 백엔드 구조 (기능 핵심 + 화면 기준 web 층)
load: on-demand
when: 백엔드에 진입점(컨트롤러 · 라우터) · 기능 폴더 · 화면 API 를 새로 만들거나 옮기거나, 화면이 부를 API 를 정할 때
if: vars.backend.layout=component-web
---

## 기능 핵심 + 화면 기준 web 층 (`vars.backend.layout = component-web`)

업무 로직은 기능별로 두고, HTTP 진입점은 그 위의 web 층에 화면 단위로 둔다. 화면 하나 = 프론트 화면 폴더 하나 = 백엔드 화면 API 폴더 하나. **기존 코드가 다른 구조면 그것이 먼저다.** 옮기는 범위는 사용자와 정한다.

```
<소스 루트>/
  feature/<기능>/[<하위기능>/]   업무 로직 · 저장소 · 도메인 값. HTTP 진입점은 두지 않는다
  web/views/<화면 경로>/          화면 전용 API (BFF): 진입점 · 화면 요청 · 응답 · 검증
  web/api/<묶음>/                 화면이 부르지 않는 API (외부 규격 · 운영 도구 · 웹훅)
  config/  shared/<개념>/         전역 설정 · 여러 기능이 쓰는 개념
  customer/<고객>/                (선택) 고객사 전용. 그 아래에 다시 feature · web
```

- **화면 경로 = 프론트 화면 폴더 경로.** 프론트 화면 루트(`react.viewsDir` 등) 기준 상대 경로와 같게 짓는다 (대소문자 · `-` · `_` 차이는 같은 이름으로 본다: `order-list` = `orderlist`). 대조는 `kedovi views check`.
- **의존 방향: web → feature → shared.** feature 는 web 을 모른다. config · shared 는 feature · web 을 모른다. web 은 feature 의 공개 부분(서비스 · 모델 · 기능 DTO · 예외)만 쓰고 저장소를 직접 부르지 않는다.
- **화면끼리 모른다.** `web/views/A` 는 `web/views/B` 를 쓰지 않는다. 두 화면이 같은 것을 쓰면 그것은 feature 나 shared 로 내린다.
- **화면 DTO 는 화면 몫.** 화면 요청 · 응답 모양은 `web/views/<화면>` 에 두고 feature 의 모델 · DTO 를 그대로 내보내지 않는다. 화면이 바뀌어도 feature 는 그대로다.
- **무엇이 web 인가:** HTTP 진입점과 화면이 여는 웹소켓은 web. 메시지 수신 · 예약 작업은 웹 요청이 아니라 feature 에 둔다.
- **고객사 전용:** 공통 코드는 `customer/` 를 모른다. 고객사 코드는 공통을 쓰고, 공통의 동작을 바꿔야 하면 공통이 정한 인터페이스를 구현한다.
- **검사는 장치로:** `kedovi archrules <스택>` 이 위 방향을 시험으로 넣는다 (Spring ArchUnit · NestJS dependency-cruiser · FastAPI · Django import-linter). 화면 체크리스트(`kedovi screens inventory`)는 그 화면의 백엔드 화면 API 경로를 함께 적는다.

### 스택 대응

| 개념 | Spring | NestJS | Express | FastAPI | Django |
|---|---|---|---|---|---|
| 화면 API 진입점 | `web/views/<화면>/controller` `@RestController` | `web/views/<화면>/*.controller.ts` + module | `web/views/<화면>/router.ts` | `web/views/<화면>/router.py` `APIRouter` | `web/views/<화면>/views.py` + `urls.py` |
| 화면 요청 · 응답 · 검증 | `dto` + Bean Validation | DTO + class-validator | 스키마 (zod 등) | `schemas.py` (Pydantic) | `serializers.py` |
| 기능 핵심 | `feature/<기능>/service` · `repository` | provider · module | service 모듈 | `service.py` · `repository.py` | `services.py` · `models.py` |
| 주입 | 생성자 주입 | `@Injectable` | 직접 넘김 | `Depends()` | 함수 인자 |

Express 는 스택 팩이 없어 이 표가 전부다. 나머지 스택의 자세한 자리는 그 스택 팩의 「component-web」 룰.
