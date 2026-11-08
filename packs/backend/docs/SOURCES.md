# backend 팩 근거 출처

backend 팩 룰이 기대는 공개 문서 목록과, **룰별 근거**·**출처끼리 어긋나는 지점**을 적는다.
룰을 고칠 때 근거를 여기에 더하고, 근거가 없는 규칙은 넣지 않는다. 조사 시점: 2026-09.

## 1. 출처 목록

### 보안 — OWASP

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| S1 | OWASP Top 10:2025 | https://owasp.org/Top10/2025/ | 1위 접근 제어 실패(SSRF 흡수), 신설 A03 공급망·A10 예외 상황 처리 |
| S2 | A01:2025 Broken Access Control | https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/ | 서버에서·기본 거부·한 곳에 모아·행 단위 소유 확인·실패 로그·테스트 |
| S3 | A03:2025 Software Supply Chain Failures | https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/ | 공식 출처·서명 패키지·불필요 의존성 제거·의도한 버전만·CVE 감시 |
| S4 | A10:2025 Mishandling of Exceptional Conditions | https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions/ | 오류 시 전체 롤백(fail closed)·전역 처리기·자원 한도 |
| S5 | OWASP Top 10:2021 | https://owasp.org/Top10/2021/ | 이전판 — 2025 와 대조용 (A06 취약 구성요소 → 2025 A03 로 확장) |
| S6 | OWASP API Security Top 10 (2023) | https://owasp.org/API-Security/editions/2023/en/0x11-t10/ | BOLA·속성 단위 인가·무제한 자원·기능 인가·업무 흐름 남용·SSRF·외부 API 신뢰 |
| S7 | OWASP ASVS 5.0 | https://owasp.org/www-project-application-security-verification-standard/ | 검증 항목 17장(V1 인코딩 ~ V16 로깅·오류) — 상세 점검표 |
| S8 | Authorization Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html | 최소 권한·기본 거부·매 요청 검사·ID 변조 방지·실패 시 안전 종료·테스트 |
| S9 | IDOR Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html | 객체마다 접근 확인, 추측 어려운 ID 는 보조 수단일 뿐 |
| S10 | Authentication Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html | 일반 실패 문구·응답 시간 일관·계정 기준 시도 제한·재인증·비밀번호 길이 |
| S11 | Password Storage Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html | Argon2id 등 느린 해시와 최소 파라미터, 암호화 금지 |
| S12 | Input Validation Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html | 서버에서·허용 목록·구문+의미 검증·정규식 앵커·검증은 주입 방어를 대신 못 함 |
| S13 | Mass Assignment Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html | 입력을 도메인 객체에 바로 묶지 말고 DTO·허용 필드 목록 |
| S14 | Query Parameterization Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html | 언어별 바인딩 예시 — 문자열 결합 금지 |
| S15 | SQL Injection Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html | 바인딩이 1차, 식별자(정렬·테이블명)는 허용 목록, 최소 권한 DB 계정 |
| S16 | Logging Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html | 남길 보안 이벤트·빼야 할 데이터·언제/어디/누가/무엇·로그 주입 방지 |
| S17 | Error Handling Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html | 전역 처리기, 클라이언트엔 일반 문구, 상세는 서버 로그, RFC 7807/9457 형식 |
| S18 | Secrets Management Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html | 비밀 저장소 권장, 환경 변수 주의, 자동 교체, 커밋 전 탐지, 유출 대응 5단계 |
| S19 | SSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html | 전체 URL 받지 않기·허용 목록·사설/메타데이터 대역 차단·리다이렉트 끄기 |
| S20 | REST Security Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html | 엔드포인트마다 인가·JWT 검증·메서드 허용 목록·크기 제한·보안 헤더·URL 에 자격 증명 금지 |
| S21 | CSRF Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html | 쿠키 인증일 때 토큰·SameSite·Fetch Metadata, GET 으로 상태 변경 금지 |
| S22 | File Upload Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html | 확장자 허용 목록·시그니처·서버가 정한 이름·웹 루트 밖·크기 제한·검사 |
| S23 | Deserialization Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html | 언어 고유 직렬화 금지, 타입 허용 목록, 다형성 자동 타입 끄기, DTO |
| S24 | Denial of Service Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html | 요청 크기·입력 기반 자원 할당 금지·비싼 작업은 인증 뒤 |

### HTTP·API 설계

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| H1 | RFC 9110 HTTP Semantics | https://www.rfc-editor.org/rfc/rfc9110 | 안전·멱등 메서드 정의, 409·412·422·405(Allow)·503(Retry-After) 뜻 |
| H2 | RFC 9457 Problem Details for HTTP APIs | https://www.rfc-editor.org/rfc/rfc9457 | `application/problem+json` 5필드, 확장 필드, 내부 정보 노출 금지 |
| H3 | RFC 9111 HTTP Caching | https://www.rfc-editor.org/rfc/rfc9111 | no-store/no-cache/private 차이, 인증 응답의 공유 캐시 재사용 조건 |
| H4 | The Idempotency-Key HTTP Header Field (IETF draft-07) | https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ | 키 없음 400·다른 본문 422·처리 중 409, 만료 정책 문서화 |
| H5 | RateLimit header fields (IETF draft) | https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/ | `RateLimit`·`RateLimit-Policy` 로 남은 한도 알림 — 초안 |
| H6 | RFC 9745 Deprecation HTTP Header | https://www.rfc-editor.org/rfc/rfc9745 | 폐기 예정 자원을 응답 헤더로 알림 |
| H7 | RFC 8594 Sunset HTTP Header | https://datatracker.ietf.org/doc/html/rfc8594 | 자원이 사라지는 시각 알림 |
| H8 | RFC 8259 JSON | https://www.rfc-editor.org/rfc/rfc8259 | 정수는 ±(2^53−1) 범위에서만 상호 운용 보장 |
| H9 | RFC 3339 Date and Time on the Internet | https://www.rfc-editor.org/rfc/rfc3339 | 인터넷 시각 표기 형식 |
| A1 | Google AIP-180 Backwards compatibility | https://google.aip.dev/180 | 필수 필드 추가·이름·타입·기본값·직렬화 변경은 비호환, 새 필드 기본값 = 옛 동작 |
| A2 | Google AIP-158 Pagination | https://google.aip.dev/158 | 처음부터 페이지, 크기 기본/최대/음수 처리, 불투명 토큰, 토큰은 인가 아님 |
| A3 | Google AIP-155 Request identification | https://google.aip.dev/155 | UUID request_id, 중복이면 이전 성공 응답 반환 |
| A4 | Google AIP-193 Errors | https://google.aip.dev/193 | 기계용 사유는 안정적 계약, 민감 정보 금지, 403 먼저 그다음 404 |
| A5 | Microsoft Azure REST API Guidelines | https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md | 깨는 변경 금지·api-version·확장 가능 열거·nextLink·LRO 202·ETag/412·요청 ID·모르는 헤더 거부 금지 |
| A6 | Zalando RESTful API Guidelines | https://opensource.zalando.com/restful-api-guidelines/ | 호환성 깨지 않기(106)·커서 페이지(160)·Problem JSON(176)·스택트레이스 금지(177)·금액 객체(173)·RFC 3339 UTC(169)·429(153)·폐기 절차(185~191) |
| A7 | Stripe API — Idempotent requests | https://docs.stripe.com/api/idempotent_requests | 첫 결과(500 포함) 저장·재현, 파라미터 비교, 24시간 이상 보존, 실행 전 실패는 저장 안 함 |
| A8 | MDN — CORS | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS | 자격 증명 허용 시 `*` 불가, 동적 출처면 `Vary: Origin` |

### 운영·회복 탄력성

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| R1 | AWS Builders' Library — Timeouts, retries, and backoff with jitter | https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/ | 모든 원격 호출 타임아웃(백분위 기준)·한 층에서만 재시도·지터·토큰 버킷·부작용 있는 호출은 멱등일 때만 |
| R2 | AWS Builders' Library — Making retries safe with idempotent APIs | https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/ | 클라이언트 요청 토큰, 의미상 같은 응답, 다른 파라미터면 오류, 토큰 기록과 변경을 한 트랜잭션 |
| R3 | AWS Builders' Library — Avoiding fallback in distributed systems | https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/ | 폴백은 검증이 어렵다 — 주 경로를 튼튼히, 호출자 재시도, 꼭 필요하면 평소에도 돌려라 |
| R4 | AWS Builders' Library — Using load shedding to avoid overload | https://aws.amazon.com/builders-library/using-load-shedding-to-avoid-overload/ | 과부하 때 빨리 거절, 시간 예산 전파, 큐 대기 시간 상한, 페이지로 일 제한 |
| R5 | Martin Fowler — CircuitBreaker | https://martinfowler.com/bliki/CircuitBreaker.html | 닫힘·열림·반열림, 상태 전환을 로그로 |
| R6 | The Twelve-Factor App — III. Config | https://12factor.net/config | 배포마다 다른 값은 코드 밖(환경 변수), 환경 이름 묶음 대신 값별 설정 |
| R7 | The Twelve-Factor App — VI. Processes | https://12factor.net/processes | 상태 없는 프로세스, 메모리·디스크는 한 요청짜리 캐시일 뿐, 고정 세션 금지 |
| R8 | The Twelve-Factor App — IX. Disposability | https://12factor.net/disposability | 빠른 기동, SIGTERM 에 정상 종료, 작업은 재진입 가능하게 |
| R9 | The Twelve-Factor App — XI. Logs | https://12factor.net/logs | 로그는 표준 출력 이벤트 스트림, 수집·보관은 실행 환경 |
| R10 | The Twelve-Factor App — IV. Backing services | https://12factor.net/backing-services | DB·큐·캐시는 설정으로 바꿔 끼우는 연결 자원 |
| R11 | Kubernetes — Liveness, Readiness, Startup Probes | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ | 살아 있음 검사는 외부 의존을 보지 말 것(연쇄 장애) |
| R12 | Kubernetes — Pod Lifecycle (termination) | https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ | SIGTERM → 유예(기본 30초) → SIGKILL, 엔드포인트 제거와 동시 진행 |
| R13 | gRPC: Deadlines | https://grpc.io/docs/guides/deadlines/ | 모든 호출에 deadline, 서버는 넘긴 요청을 멈춤, 전파 때 시계 차이 때문에 경과 시간을 뺀 timeout 으로 바꿔 보냄 |
| R14 | gRPC over HTTP/2 protocol | https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md | `grpc-timeout` 머리는 남은 시간 상대값(값 + 단위) |
| R15 | Google SRE Book: Addressing Cascading Failures | https://sre.google/sre-book/addressing-cascading-failures/ | deadline 전파, 남은 시간이 부족한 요청은 처리하지 않기, 취소 전파, 재시도 증폭 |
| R16 | Google SRE Book: Testing for Reliability | https://sre.google/sre-book/testing-reliability/ | 장애 상황을 시험으로 재현, 실패 경로 시험 |
| R17 | JDK `HttpRequest.Builder.timeout` | https://docs.oracle.com/en/java/javase/21/docs/api/java.net.http/java/net/http/HttpRequest.Builder.html | 요청 timeout 은 응답(머리)을 받을 때까지. 본문 읽기 중 멈춤은 덮지 않는다 (킷이 2026-11 실측) |
| R18 | Requests: Advanced Usage: Timeouts | https://requests.readthedocs.io/en/latest/user/advanced/ | 연결 · 읽기 timeout 따로, 읽기 timeout 은 서버가 보낸 바이트 사이 간격 (총시간 아님) |

### 관측

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| O1 | OpenTelemetry Logs specification | https://opentelemetry.io/docs/specs/otel/logs/ | 로그 레코드에 TraceId·SpanId, 기존 로거는 appender/bridge 로 연결 |
| O2 | W3C Trace Context | https://www.w3.org/TR/trace-context/ | `traceparent` 형식, 개인정보 금지, 들어온 헤더는 신뢰하지 말고 경계에서 재시작 가능 |

### 테스트

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| T1 | Martin Fowler / Ham Vocke — The Practical Test Pyramid | https://martinfowler.com/articles/practical-test-pyramid.html | 단위 많이·통합 일부·E2E 적게, 동작을 테스트, 실제 DB, 외부는 스텁, 계약 테스트, 중복 제거 |
| T2 | Martin Fowler: ContractTest | https://martinfowler.com/bliki/ContractTest.html | 테스트 대역(스텁)은 실제 서비스와 어긋날 수 있다: 대역이 가정한 동작을 실제와 대조해 두어야 한다 |
| T3 | Docker: Testcontainers 수명 · singleton 컨테이너 | https://docs.docker.com/guides/testcontainers-java-lifecycle/singleton-containers | 컨테이너를 static 초기화로 한 번 띄워 모든 테스트 클래스가 공유, @Testcontainers 와 섞으면 클래스 끝에 멈춰 캐시된 컨텍스트가 끊김, 테스트마다 데이터 정리 |
| T4 | Spring Boot 4.0: Testcontainers | https://docs.spring.io/spring-boot/4.0.0/reference/testing/testcontainers.html | 컨테이너 빈은 컨텍스트마다 한 벌 생성 · 컨텍스트가 닫힐 때 멈춤, JUnit 확장 컨테이너는 캐시된 컨텍스트보다 먼저 멈출 수 있음 |
| T5 | Spring Framework: 테스트 컨텍스트 캐시 · 동적 속성 | https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/ctx-management/caching.html | 설정 조합마다 컨텍스트 키, 기본 최대 32개 · LRU 로 밀려나면 닫힘. 동적 속성은 DynamicPropertyRegistrar 빈 |
| T6 | Testcontainers: Replace H2 with a real database | https://testcontainers.com/guides/replace-h2-with-real-database-for-testing | 메모리 DB 대신 운영과 같은 엔진으로 테스트 |

### 공개 AGENTS.md (에이전트 규칙 사례)

| ID | 제목 | URL | 한 줄 요지 |
|---|---|---|---|
| G1 | AGENTS.md 형식 | https://agents.md/ | 에이전트용 저장소 지침 파일의 공통 형식 |
| G2 | getsentry/sentry AGENTS.md (+ 하위 src 폴더의 AGENTS.md) | https://github.com/getsentry/sentry/blob/master/AGENTS.md | 고객 데이터를 코드·커밋에 넣지 않기, 요청의 ID 를 직접 읽지 말고 권한 확인 헬퍼로, 직렬화 N+1 금지, 복합 조건 인덱스, 하위 호환 마이그레이션, 엔드포인트 추가 전 존재 확인 |
| G3 | n8n-io/n8n AGENTS.md | https://github.com/n8n-io/n8n/blob/master/AGENTS.md | ORM 은 영속 계층 안에만, 업무 로직에 트랜잭션 핸들 노출 금지, 비밀을 명령에 넣지 않기, 보안 수정 주석에 공격 방법 쓰지 않기 |
| G4 | apache/airflow AGENTS.md | https://github.com/apache/airflow/blob/main/AGENTS.md | 세션을 받는 함수는 커밋하지 않기, 상한 없는 일괄 쓰기 금지(나눠 커밋·인덱스), 바뀐 동작마다 그 변경 없이는 실패하는 테스트, 로그 문자열 대조 금지, 시간 고정 |
| G5 | temporalio/sdk-java AGENTS.md | https://github.com/temporalio/sdk-java/blob/master/AGENTS.md | 공개 API 시그니처를 바꾸지 않기, 포맷·테스트 통과 |
| G6 | openai/codex AGENTS.md | https://github.com/openai/codex/blob/main/AGENTS.md | 대형 저장소의 영역별 지침 분리 사례 |
| G7 | supabase/supabase AGENTS.md | https://github.com/supabase/supabase/blob/master/AGENTS.md | 생성 파일 손편집 금지, 관례는 추측하지 말고 정해진 문서에서 |

## 2. 룰별 근거

| 룰 | 규칙 | 근거 |
|---|---|---|
| 10 기본 | 기존 관례 먼저, 새 봉투·코드 체계 금지 | 킷 규칙(AGENTS.md §1), G7 (추측 말고 정해진 관례), A6 106 (계약 안정성) |
| 10 기본 | 만들기 전에 있는지 찾기, 생성 코드 손대지 않기 | G2, G7 |
| 10 기본 | 인가는 매 요청·객체 단위·기본 거부·공용 헬퍼 | S2, S6 API1/API5, S8, S20, G2 |
| 10 기본 | 경계 검증·대량 할당 금지·저장 모델 직접 응답 금지 | S12, S13, S6 API3 |
| 10 기본 | 파라미터 바인딩 | S14, S15, S1 A05 |
| 10 기본 | 시크릿·개인정보·고객 데이터 | S18, S16, R6, G2 |
| 10 기본 | 오류 구분·스택트레이스 금지·전역 처리기 | S17, S4, H2, A6 177 |
| 10 기본 | 트랜잭션 서비스 단위·외부 호출 기다리지 않기 | S4 (fail closed), G3, G4 |
| 10 기본 | 외부 호출 타임아웃·멱등 재시도·백오프+지터 | R1, R2, H1 §9.2.2 |
| 10 기본 | 자원 상한·호출 한도·GET 상태 변경 금지 | S6 API4, S24, A2, R4, S21, H1 §9.2.1 |
| 10 기본 | 깨지 않고 더하기 | A1, A5, A6 106–115·185–191 |
| 10 기본 | 바뀐 동작엔 테스트, 재현부터 | G4, T1, S2 (인가 테스트) |
| 20 계층 | 입력·출력 모델 분리 | S13, S23 (DTO), S6 API3 |
| 20 계층 | ORM 은 데이터 접근 계층 안에 | G3 |
| 20 계층 | 데이터 접근 함수는 커밋하지 않음 | G4 |
| 20 계층 | 트랜잭션 안 외부 호출 금지·아웃박스 | S4, R8 (재진입), R2 (기록과 변경 한 트랜잭션) |
| 20 계층 | 보안 수정 주석에 공격 방법 쓰지 않기 | G3 |
| 20 계층 | 함수 이름은 동사로 | G4 |
| 20 계층 | 소유자 기준 이름·주석 분량 | 킷 원 규칙(실무 사례에서 일반화) — 외부 근거 없음, 프로젝트 관례가 우선 |
| 30 API | 기존 계약 확인·이미 있는 엔드포인트 찾기 | G2, 킷 규칙 |
| 30 API | 객체·기능·속성 단위 인가, 업무 흐름 한도 | S6 API1/3/5/6, S8, S13 |
| 30 API | 허용 목록 검증·구문+의미·정규식 앵커·검증≠주입 방어 | S12 |
| 30 API | 컬럼 길이·정밀도 맞추기, 생성·수정 대칭 | 킷 원 규칙(초과 입력 → DB 오류 → 500 실측) + S4 (예외 상황) |
| 30 API | 크기 상한·413/415/405 | S20, S24, H1 |
| 30 API | 예외는 복구할 수 있을 때만 잡기 | S4, S17 — 아래 교차 검토 ① |
| 30 API | 상태 코드 뜻대로, 500 은 결함 신호 | H1, S17, A6 150·220·243 |
| 30 API | 사용자 메시지 i18n·치환 인자 | A4 (LocalizedMessage), 킷 원 규칙 |
| 30 API | 페이지 상한·결정적 정렬·불투명 커서·토큰≠인가 | A2, A5, A6 159–161·254, R4 |
| 30 API | 시각 RFC 3339 UTC·금액 십진+ISO 4217·큰 정수 문자열·null 규칙 | A6 169·173·238·122–124, H8, H9 |
| 30 API | 민감 응답 `no-store` | H3, S20 |
| 30 API | 오래 걸리는 작업 202 + 상태 조회 | A5 (LRO) |
| 30 API | 멱등 키·같은 키 다른 본문 거부·한 트랜잭션 | H4, A7, R2, A3, A6 229–231 |
| 30 API | 깨는 변경 목록·버전 방식은 관례·Deprecation/Sunset | A1, A5, A6, H6, H7 |
| 30 API | 모르는 필드·헤더를 견딤 | A6 108, A5 (모르는 헤더 거부 금지), H2 (모르는 확장 무시) |
| 40 데이터 | 바인딩·식별자 허용 목록·최소 권한 계정 | S14, S15 |
| 40 데이터 | N+1·필요한 컬럼만 | G2 |
| 40 데이터 | 복합 조건 인덱스 | G2 |
| 40 데이터 | 유니크 제약·낙관적 잠금·조건부 UPDATE | H1 (409·412), A5 (ETag/If-Match), R2 |
| 40 데이터 | 실패 시 전부 되돌림 | S4 |
| 40 데이터 | 확장·축소 순서 배포(추가 먼저, 삭제 나중) | G2 (하위 호환 마이그레이션), A1 |
| 40 데이터 | 상한 없는 일괄 쓰기 금지·나눠 커밋 | G4 |
| 40 데이터 | 1만 행 집합 SQL 예외·값 객체·순서 상수 | 킷 원 규칙(실측 기반) — 외부 근거 없음 |
| 50 로깅 | 레벨·한 번만 기록·예외 객체째·치환 인자 | S16, S17, R9 |
| 50 로깅 | 추적 ID·traceparent 는 외부 입력·appender 연동·개인정보 금지 | O1, O2, A5 (요청 ID) |
| 50 로깅 | 로그 주입 방지 | S16, S20 |
| 50 로깅 | 보안 이벤트 목록·언제/어디/누가/무엇 | S16, S2 (실패 로그·알림), S1 A09 |
| 50 로깅 | 재시도·서킷 상태 전환 기록 | R3 (재시도율 감시), R5 |
| 50 로깅 | 개인정보·비밀 표 | S16, S18 |
| 60 보안 | 보안 장치 직접 구현 금지 | S8 (도구 이해), S11, S1 A04 |
| 60 보안 | 인가 §1 | S2, S8, S9, S6 |
| 60 보안 | 비밀번호 해시·일반 실패 문구·계정 기준 제한·재인증 | S10, S11 |
| 60 보안 | 토큰 검증(alg 고정·iss/aud/exp)·URL 에 토큰 금지 | S20, S2 |
| 60 보안 | CSRF·CORS·쿠키·응답 헤더 | S21, A8, S20 |
| 60 보안 | 요청 한도·비싼 작업 인증 뒤·입력 기반 자원 할당 금지 | S24, S6 API4/6, S20 (429) |
| 60 보안 | 비밀값 주입·유출 시 교체·탐지 훅 유지 | S18, R6, G3 — 교차 검토 ② |
| 60 보안 | 외부 입력 표(SSRF·XXE·역직렬화·CSV·ReDoS·외부 API 응답) | S19, S20, S23, S12, S6 API7/API10 |
| 60 보안 | 파일 업로드 | S22 |
| 60 보안 | 관리 엔드포인트 비공개·디버그 설정 제거 | S20, S1 A02, S6 API8 |
| 60 보안 | 의존성 최소·공식 출처·잠금 파일·의도한 버전 | S3 |
| 70 외부 호출 | 모든 원격 호출 타임아웃·백분위 기준·예산 전파 | R1, R4 |
| 70 외부 호출 | 재시도 조건·백오프+지터·한 층·재시도 예산 | R1, H1 |
| 70 외부 호출 | 서킷 브레이커 | R5, R1 — 교차 검토 ③ |
| 70 외부 호출 | 폴백 자제·fail closed | R3, S4 — 교차 검토 ④ |
| 70 외부 호출 | 빨리 거절·큐 대기 상한 | R4 |
| 70 외부 호출 | 중복 메시지·재진입 작업·주기 작업 지터 | R8, R1 (지터), R2 |
| 70 외부 호출 | 설정 코드 밖·값별 설정·기동 때 실패 | R6, R10 |
| 70 외부 호출 | 상태 없는 프로세스·정상 종료·빠른 기동 | R7, R8, R12 |
| 70 외부 호출 | 살아 있음 검사에 외부 의존 금지 | R11 |
| 70 외부 호출 | 외부 API 엔드포인트별 timeout · 실측 p99 근거 | R1 (백분위 기준), 킷 원 규칙(공용 기본값으로 운영 결함 실측) |
| 70 외부 호출 | 남은 예산을 상대값으로 전파 · 받는 쪽이 대기 · 재시도까지 예산 안에서 · 취소 전파 | R13, R14, R15, R4 |
| 70 외부 호출 | 시간 초과 구간(연결 · 머리 · 본문 중) 분류와 시험 고정 | R17, R18, R16 |
| 70 외부 호출 | 외부 API 동작 장부: 실측만 기대 · 미확인은 최악 · 확인일 · 근거 | T2 (대역과 실제의 대조), R16, 킷 원 규칙(외부 API 가정이 운영 결함 비용 1위였던 실측) |
| 80 테스트 | 바뀐 동작마다 실패하는 테스트, 기존 로직 테스트 추가 안 함 | G4 |
| 80 테스트 | 층 나누기·중복 제거·동작 테스트·실제 DB·외부 스텁·계약 | T1 |
| 80 테스트 | 실제 엔진을 브로커 · 캐시까지 | T1 (실제 인프라로 통합 테스트), T6 |
| 80 테스트 | 컨테이너는 실행당 한 벌 · 쓰는 것만 · 공유 시 격리 | T3, T4, T5, 킷 원 규칙(컨텍스트마다 컨테이너가 떠 빌드 한 번에 30개 이상 뜬 실측) |
| 80 테스트 | 인가 거부 케이스 | S2, S8 |
| 80 테스트 | 시간 고정·로그 문자열 대조 금지·합성 데이터 | G4, G2 |
| 80 테스트 | 실데이터 극값(집계만, 원문 없음) · 칸 여유 | S16 (개인정보 금지), G2 (고객 데이터를 픽스처에 넣지 않기), 킷 원 규칙 |
| 80 테스트 | 실패 주입 세트를 CI 병렬 작업으로 · 운영 결함은 고치기 전 실패 → 고친 뒤 통과 | R16, G4 (그 변경 없이는 실패하는 테스트) |

## 3. 교차 검토 — 출처끼리 어긋나는 곳과 킷의 선택

| # | 주제 | 어긋남 | 킷의 선택 |
|---|---|---|---|
| ① | 예외를 어디서 잡나 | S4(A10:2025)는 "오류가 난 자리에서 잡아 처리" 를, S17·로깅 관례는 "전역 처리기 한 곳에서 변환·기록" 을 권한다 | 둘을 층으로 나눈다 — **그 자리에서 복구·정리할 수 있을 때만 잡고**, 그 밖은 전역 처리기. 삼키기·로그 후 계속은 둘 다 금지 |
| ② | 비밀값을 환경 변수로 | R6(Twelve-Factor)는 설정을 환경 변수로, S18(OWASP)은 비밀은 환경 변수를 되도록 피하고 비밀 저장소·마운트 파일 권장 | 설정은 코드 밖에(공통). 비밀은 **프로젝트 방식**을 따르고, 환경 변수를 쓰면 출력·덤프에 새지 않게 |
| ③ | 서킷 브레이커 | R5 는 장애 전파 차단 수단으로 소개, R1 은 모드 전환이 테스트·회복을 어렵게 한다며 재시도 토큰 버킷을 선호 | 기존 도구가 있으면 그것. 새로 들일 때는 **재시도 예산 또는 서킷 브레이커** 중 사람과 정한다 |
| ④ | 폴백 | 흔한 회복 탄력성 글은 캐시·기본값 폴백을 권하지만 R3 은 폴백을 피하라고 한다 | 기본은 폴백 없이 오류 → 호출자 재시도. 인가·결제 판정은 fail closed |
| ⑤ | 권한 없음 403 vs 404 | A4 는 403 먼저, S9 는 존재를 숨기려 404 를 쓸 수 있다 | 기존 관례, 새로 정하면 전체 일관 |
| ⑥ | 버전 방식 | A6 URL 버전 금지·미디어 타입, A5 `api-version` 쿼리, A1(Google) 경로 주 버전 | 기존 관례. 한 버전 안에서 깨지 않기는 공통 |
| ⑦ | 검증 실패 코드 | H1 은 422 를 정의, A6·S20 은 400 을 흔히 쓴다 | 기존 관례 (400 또는 422) |
| ⑧ | 멱등 키 헤더 이름 | H4·A7 `Idempotency-Key`, A5 `Repeatability-Request-ID`, A3 본문 `request_id` | 기존 관례, 없으면 IETF 초안 이름 |
| ⑨ | 총건수 제공 | 번호 페이지 UI 는 총건수를 원하지만 A5·A6 은 기본 제공을 피하라 | 필요한 화면에만 계산 |
| ⑩ | 속성 이름 표기 | A6 snake_case 강제, 다른 가이드는 camelCase 가 흔함 | 기존 관례 — 룰에 넣지 않았다 |

## 4. 조사했지만 룰에 넣지 않은 것

- 속성 이름 표기(snake/camel), URL 모양, 컬렉션 응답 필드명(`value`·`items`) — 가이드마다 달라 "기존 관례" 한 줄로 충분하다.
- ASVS 5.0 의 전 항목 — 점검표로는 과하다. 보안 검토가 필요하면 S7 을 직접 본다.
- 부하 테스트·용량 계획(R4 앞부분) — 코드 작성 규칙이 아니라 운영 절차다.
- 헤지 요청(R3 의 선제 중복 요청) — 특수한 경우라 일반 규칙이 아니다.
