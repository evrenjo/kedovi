---
name: debug-trace
description: API · 함수 · 배치 · 화면 동작 한 번의 실행 흐름을 줄마다 값과 함께 기록해 이 PC 웹 페이지로 보여 준다 (kedovi trace). Java · Kotlin, Python, React 같은 웹 화면, Next.js(화면 + 서버), Node 서버에서 테스트 · 로컬 서버 요청 · 화면 조작을 기록하고, 왼쪽에 탄 함수 단계 · 오른쪽에 코드와 줄별 값 · 아래에 데이터 상세(SQL · 요청 포함)를 띄운다. "○○ API 디버깅 보여줘", "이 함수 어떻게 도는지 보여줘", "버튼 누르면 어떻게 도는지", "배치 흐름 보여줘", "값이 어디서 바뀌는지", "실행 흐름" 요청에 쓴다.
---

# debug-trace: 실행 흐름 디버깅 페이지

`kedovi trace` 가 기록 · 페이지를 만든다. 이 스킬은 무엇을 어떻게 돌릴지 정하는 순서다.

## 1. 대상 찾기

| 사용자가 말한 것 | 찾는 것 |
|---|---|
| API (`POST /api/orders` · 「주문 API」) | 그 경로를 받는 컨트롤러 · 라우트 (`@*Mapping` · `@app.post` · `@router.get` · `@Post` · `app.post(…)` · Next.js `app/**/route.ts` · `pages/api/**`) |
| 함수 · 서비스 (`OrderService.place`) | 그 함수와 부르는 쪽 |
| 배치 · 스케줄 작업 | 작업의 실행 함수 |
| 화면 동작 (「주문 화면에서 취소 누르면」) | 그 화면 · 버튼의 핸들러와 그 화면을 여는 경로 |

여럿이면 후보를 보여 주고 하나를 묻는다. 대상이 든 repo 를 정한다 (`workspace.json` repos). 프런트가 하위 폴더(`frontend/` 등)에 있으면 경로는 그 폴더 기준이다.

## 2. 실행 방식 고르기

| 방식 | 언제 | 명령 |
|---|---|---|
| **테스트** (기본) | 언제나. 같은 입력으로 다시 볼 수 있다. 함수 · 배치는 이것만 | Java `kedovi trace run --test <클래스>#<메서드>` · Python `--test tests/<파일>.py::<이름>` · JS `--test <파일>::<테스트 이름>` (Vitest · Jest) |
| **화면 e2e 테스트** | 화면 동작. 그 화면을 다루는 Playwright 테스트가 있을 때 (먼저 찾는다) | `kedovi trace run --test e2e/<파일>.spec.ts::<테스트 이름>` (계측한 개발 서버(Vite · Next.js)로 돈다. API 흉내 · 조작은 테스트 그대로. Next.js 는 서버 쪽 API 라우트 · 서버 액션 · 서버 컴포넌트도 같은 기록에) |
| **화면 조작 단계** | 화면 동작인데 맞는 e2e 테스트가 없을 때 | `kedovi trace run --web "goto /orders; click text=주문하기; wait [role=status]"` |
| **로컬 서버 요청** | 사용자가 「로컬 데이터로」 · 「실제 서버로」 라고 할 때 (API 만) | `kedovi trace run --request "<METHOD> http://localhost:<포트>/<경로>" [--data '<본문>'] [-H 'K: V']` |

- 테스트: 대상을 부르는 기존 테스트가 있으면 그것을 쓴다. 없으면 기록용 테스트를 그 repo 의 테스트 방식대로 새로 만든다.
  - Java API 는 `@SpringBootTest` + `@AutoConfigureMockMvc`, Python API 는 그 프레임워크의 테스트 클라이언트(FastAPI `TestClient` 등), Node API 는 프로젝트가 쓰는 방식(supertest 등). 함수 · 배치는 한 번 부른다.
  - 만든 파일은 보고에 적고, 커밋할지는 사용자에게 묻는다.
- 화면 조작 단계: `goto /경로` · `click <선택자>` · `fill <선택자> <글>` · `select <선택자> <값>` · `check <선택자>` · `press <키>` · `hover <선택자>` · `wait <ms|선택자>` 를 `;` 로 잇는다. 선택자는 Playwright 선택자(`text=…` · `role=button[name="…"]` · CSS). 사용자가 말한 시나리오를 이 단계로 바꾸고, 버튼 글자 · 경로는 그 화면 소스에서 확인한다.
  - 백엔드가 필요한 화면인데 로컬 백엔드가 없으면, 요청이 실패한 채로 기록된다. 그 사실을 보고하고, 흉내가 필요하면 e2e 테스트를 쓰자고 한다.
  - 사용자가 직접 재현하겠다고 하면 `kedovi trace run --web --manual` 을 안내한다 (브라우저가 뜨고, 다 했으면 터미널에서 Enter). 사용자가 직접 돌린다.
- 로컬 서버: 킷이 서버를 띄우고 요청 한 번을 기록한 뒤 끈다.
  - Java = bootRun · spring-boot:run (이미 디버그 포트로 띄웠으면 `--attach <포트>`). Python = FastAPI · Flask · Django 를 찾아 띄운다. Next.js = 킷이 계측한 개발 서버를 따로 띄운다 (주소의 포트는 쓰지 않는다. 사용자가 띄운 next dev 는 그대로 둔다). Node = package.json 의 start · serve · dev. 다르면 `--serve "<명령>"`.
  - 감시 모드(watch · reload)로 띄우는 명령은 피한다.
  - 주소는 localhost 만 된다. 운영 · 개발 서버에는 붙지 않는다.
  - 로그인이 필요한 API 는 헤더(`-H 'Authorization: …'`)를 사용자에게 받는다. 값은 채팅 · 보고에 적지 않는다.

## 3. 돌리고 보고하기

1. 명령을 돌린다. 처음에는 빌드 · 의존성 · 소스 파서 받기로 몇 분 걸릴 수 있다. 기록 중에는 평소보다 느리다.
2. 출력의 「기록: 호출 · 줄 · SQL · 요청 · 예외」 와 `링크:` 를 확인한다. 경고(⚠)가 있으면 이유를 본다:

   | 경고 | 할 일 |
   |---|---|
   | 시작 메서드 · 테스트가 실행되지 않음 · 프로젝트 코드가 불리지 않음 | 테스트 이름 · 파일 · 건너뛰기 표시 확인 |
   | 테스트 실패 | 기록은 실패 지점까지 있다. 실패 자체가 보고 대상인지 사용자에게 알린다 |
   | 단계 상한 · 「○○」 이 단계 예산을 넘어 접음 | 더 좁은 테스트 · 시나리오로. 필요하면 `--max-steps` |
   | 화면 기록은 Next.js 또는 Vite … 만 | 그 밖의 화면 도구(CRA · Angular 등)는 아직 안 된다. 단위 테스트(Vitest · Jest)로 기록하자고 한다 |
   | node_modules 가 없습니다 · Playwright 를 찾지 못함 | 설치 명령(`npm install` · `npx playwright install chromium`)을 사용자에게 알린다 |
   | Maven: SQL 은 pom 에… | SQL 없이도 흐름 · 값은 보인다. SQL 까지 보려면 pom 에 test 범위로 `datasource-proxy-spring-boot-starter` 를 넣을지 묻는다 |

3. 채팅에는 결론 1줄 + 흐름 요약 3~5줄(예: 사용자 동작 → 핸들러 → 서비스 → 저장소, 눈에 띄는 값 변화 · SQL · 요청 · 예외) + `자세히: <링크>`.

- 반복문은 줄마다 30회까지 값을 남기고 나머지는 횟수만 센다 (`--max-hits`). 화면은 사용자 동작마다 3000단계까지.
- SQL 을 빼려면 `--sql off`. Java 기록 범위가 소스의 공통 패키지와 다르면 `--include com.a,com.b`.
- 지난 기록: `kedovi trace list` · `kedovi trace open [파일]`.

## 하지 않는다

- 운영 · 개발 · 공유 DB 에 붙은 서버를 기록하지 않는다. 로컬 · 테스트 DB 만 쓴다.
- 기록 파일(`.agents/traces/`)을 커밋하거나 밖으로 보내지 않는다. 실제 데이터가 들어 있다.
- 기록하려고 프로젝트의 빌드 파일 · 설정 · 운영 코드를 고치지 않는다. 고칠 수 있는 것은 기록용 테스트 파일뿐이다.
