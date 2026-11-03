---
title: Spring 레이어 책임 · 주입 · 설정값
load: always
---

## Spring 레이어 책임 · 주입 · 설정값

공통 원칙은 clean-code 팩 「레이어 책임 · 공통 로직 추출」. 패키지 이름 · 구조는 「Spring 패키지 구조」(계층 먼저 · 기능 먼저 중 vars.spring.packageLayout) 와 프로젝트 관례를 따른다.

- **Controller:** 요청 바인딩 · 검증 어노테이션 · 서비스 호출 · 응답 변환만. 계산 · 분기 규칙 · 저장소 직접 호출 금지.
- **Service:** 트랜잭션 경계와 조율. 업무 규칙은 엔티티 · 값 객체 메서드로 보낸다 (서비스에 계산용 도우미 메서드를 쌓지 않는다. 접근 제한자와 상관없다).
- **Repository:** 쿼리만. **Configuration · `@Bean` 메서드:** 조립만, 업무 로직 금지.

| 꺼낼 것 | 위치 · 이름 |
|---|---|
| 업무 규칙 · 계산 | 엔티티 · 값 객체(`record`) 메서드, `*Policy` · `*Calculator` |
| DTO ↔ 엔티티 변환 | `*Mapper` (MapStruct 등 기존 관례) |
| 입력 검증 규칙 | Bean Validation, `*Validator` |
| 고정 값 묶음 | `enum` (값과 동작을 함께) |
| 환경별 값 | `@ConfigurationProperties` 클래스 (`*Properties`, 검증은 `@Validated`) |
| 여러 기능이 쓰는 기술 코드 | 기존 공용 패키지, 없으면 대상 이름 패키지 (`support.time`) |

- `private static final` 이 여럿이거나 다른 클래스와 같은 값이면 enum · `*Properties` · 개념 클래스로 옮긴다. `@Value` 를 여러 클래스에 흩뿌리지 않는다.
- **의존성은 생성자 주입,** 필드는 `final` (Kotlin 은 주 생성자 `private val`). 생성자가 하나면 `@Autowired` 생략. 필드 · setter 주입 금지 (테스트 제외). 생성자 인자가 많아지면 클래스가 일을 너무 많이 한다는 신호다.
- 빈은 상태를 갖지 않는다. 요청별 값은 인자로 넘긴다.
- 유틸 클래스는 상태 없는 순수 함수만, `private` 생성자, 도메인 규칙 금지.
