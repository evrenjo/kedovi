---
title: FastAPI 폴더 구조 (기능 먼저)
load: on-demand
when: FastAPI 코드에 파일 · 폴더를 새로 만들거나 옮기거나, 다른 기능의 모듈을 import 할 때
if: vars.fastapi.packageLayout=feature
---

## 폴더 구조 (기능 먼저, `{{ws:vars.fastapi.package}}`)

이 워크스페이스는 기능 단위 구조를 쓴다 (`vars.fastapi.packageLayout = feature`). 기존 코드가 다른 구조면 옮기는 범위는 사용자와 정한다.

```
<패키지>/
  main.py                          앱 조립만
  feature/<기능>/[<하위기능>/]<파일>.py
  config/                          전역 설정 (BaseSettings)
  shared/<개념>/                    여러 기능이 쓰는 개념
```

| 파일 | 담는 것 |
|---|---|
| `router.py` | `APIRouter` 경로 함수 (검증 · 의존성 · 응답만) |
| `dependencies.py` | `Depends` 로 넣는 함수 |
| `service.py` | 유스케이스 · 트랜잭션 경계 |
| `repository.py` | 데이터 접근 |
| `mapper.py` | models ↔ schemas 변환 |
| `client.py` | 외부 API 호출 |
| `schemas.py` | Pydantic 요청 · 응답 |
| `models.py` | ORM 모델 · 도메인 값 |
| `exceptions.py` | 예외 |
| `constants.py` · `config.py` | 그 기능 전용 상수 · 설정 |
| `*_calculator.py` · `*_validator.py` … | 계산 · 검증 도우미 (하는 일 이름) |

- **계층 방향:** router → dependencies → service → repository · mapper · client → models · schemas → exceptions. 아래가 위를 import 하지 않는다.
- **다른 기능은 `service` · `schemas` · `models` · `exceptions` 만** import 한다. 하위 기능은 자기 상위 기능 전부를 쓴다. `config` · `shared` 는 `feature` 를 import 하지 않는다.
- **역할 파일(router · dependencies · service · repository · client)에는 클래스 · 대문자 상수를 두지 않는다.** 클래스는 schemas · models · exceptions 로, 상수는 constants · config · Enum 으로.
- **검사는 장치로:** `kedovi archrules fastapi` 가 import-linter 계약(`<repo>/.importlinter`)과 역할 파일 검사(`<repo>/tools/check_role_files.py`)를 넣는다. 룰 문장만으로 지키게 하지 않는다.
