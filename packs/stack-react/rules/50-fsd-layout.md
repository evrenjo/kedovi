---
title: React 폴더 구조 (FSD)
load: on-demand
when: React 화면 코드에 파일 · 폴더를 새로 만들거나 옮기거나, 다른 slice 를 import 할 때
if: vars.react.packageLayout=fsd
---

## 폴더 구조 (Feature-Sliced Design, `{{ws:vars.react.srcDir}}`)

이 워크스페이스는 FSD 를 쓴다 (`vars.react.packageLayout = fsd`). 「React 구조·쿼리·URL·폼·다이얼로그 구현」 의 디렉토리 표보다 이 룰이 먼저다. 기존 코드가 다른 구조면 옮기는 범위는 사용자와 정한다.

| 레이어 | 담는 것 | slice |
|---|---|---|
| `app` | 앱 시작 · 라우터 · 전역 provider · 전역 스타일 | 없음 |
| `pages` | 경로 하나 = 화면 하나 | 화면 이름 |
| `widgets` | 여러 화면이 쓰는 큰 화면 조각 | 조각 이름 |
| `features` | 사용자 행동 하나 (장바구니 담기 · 로그인) | 행동 이름 |
| `entities` | 업무 개념 (사용자 · 주문) 의 표시 · 상태 | 개념 이름 |
| `shared` | 업무를 모르는 공용 (ui 키트 · api 클라이언트 · lib · config) | 없음, 세그먼트가 바로 온다 |

- slice 안은 **표준 세그먼트**로 나눈다: `ui`(컴포넌트) · `api`(서버 호출 · 쿼리 훅) · `model`(상태 · 업무 규칙 · 타입) · `lib`(이 slice 전용 함수) · `config`(상수 · 설정). 다른 이름의 세그먼트를 만들지 않는다.
- **import 방향은 위에서 아래로만:** app → pages → widgets → features → entities → shared. 같은 레이어의 다른 slice 는 import 하지 않는다.
- **다른 slice 는 루트 `index.ts` 로만** import 한다 (공개 API). slice 안 파일 경로를 직접 가리키지 않는다.
- **생성 API 코드(`{{ws:vars.react.generatedApiDir}}`)의 값(함수 · 훅)은 각 slice 의 `api` 세그먼트와 `shared/api` 에서만** import 한다. `ui` 는 같은 slice 의 `api` · `model` 훅을 쓰고, 생성 코드는 타입만 import 한다.
- **검사는 장치로:** `kedovi archrules react` 가 위 규칙을 eslint-plugin-boundaries 설정으로 넣는다. 룰 문장만으로 지키게 하지 않는다.
