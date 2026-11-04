# 쓰기 보고서 (Java · Spring)

시험이 DB 에 어떤 테이블 · 컬럼에 무슨 값을 썼는지 기록하고, 기대값(승인본)으로 고정한다. 형식은 `packs/core/assets/write-report/FORMAT.md` 가 정본이다.

## 두 판

| 판 | 기록 방식 | 붙는 것 |
|---|---|---|
| `jooq` | jOOQ ExecuteListener + QOM 해석 | `ExecuteListenerProvider` 빈 (Boot 자동설정이 DefaultConfiguration 에 붙인다) · 직접 만든 Configuration · DSLContext 빈은 후처리기가 붙인다 |
| `jdbc` | DataSource 프록시가 PreparedStatement · Statement 를 감싸 SQL 문장 파서로 해석 | JdbcTemplate · NamedParameterJdbcTemplate · JPA(Hibernate) · MyBatis 등 DataSource 를 쓰는 모든 것 |

두 판 모두 DataSource 빈을 `java.lang.reflect.Proxy` 로 감싸 commit · rollback · savepoint 를 본다 (롤백 표시).
등록은 test 리소스 `<repo>/src/test/resources/META-INF/spring.factories` 하나 (`TestExecutionListener` 키 = 시험 경계, `ContextCustomizerFactory` 키 = 빈 등록). `@Import` 나 운영 코드 변경이 없고 슬라이스 시험(`@JooqTest` · `@JdbcTest` · `@DataJpaTest`)에도 붙는다.

## 붙이는 법

```sh
kedovi writes add jooq     # 또는 jdbc
```

| 할 일 | 내용 |
|---|---|
| Gradle 승인 속성 | Kotlin DSL `tasks.test { systemProperty("writeReport.approve", System.getProperty("writeReport.approve") ?: "false") }` |
| spring.factories | 이미 있으면 덮지 않는다. 두 키의 값을 기존 값 뒤에 쉼표로 이어 붙인다 (manifest 의 `"merge": "properties"`) |
| 고정 | 시험에서 `WriteReport.assertMatches("이름", "스키마.테이블", ...)`. 테이블을 빼면 쓴 테이블 전부 |
| 승인 | `./gradlew test -DwriteReport.approve=true` (Maven `mvn test -DwriteReport.approve=true`) 뒤 `src/test/resources/write-report/approved/` 를 커밋 |
| 보기 | `<repo>/build/write-report/index.html` (Maven `target/`). 시험별 원본은 `<클래스>/<메서드>.yaml` |
| 설정 | `<repo>/src/test/resources/write-report.properties` (키 설명은 파일 주석) |

요구 사항: Java 17 이상 (record · switch 식 · instanceof 패턴). JUnit 5 · spring-test · spring-jdbc (jooq 판은 jOOQ) 외 의존성 추가 0. jOOQ 3.20 이상은 jOOQ 쪽이 Java 21 을 요구한다.

## 확인한 환경

Spring Boot 4.1.2 · jOOQ 3.21.9 (Java 21) · Spring JDBC (Java 17) · Hibernate 7.4 (Java 17) · PostgreSQL 17 (Testcontainers 2.0.5).
기록기를 켜고 끈 차이: 쓰기 12,000건 + 조회 3,000건 시험에서 JDBC 판 소음 범위 안, jOOQ 판 약 +1%.

## 한계

| 한계 | 내용 |
|---|---|
| 직렬 실행만 | JUnit 병렬 실행에서 구간이 겹치면 그 시험을 즉시 실패시킨다 |
| 늦게 끝나는 비동기 쓰기 | 시험 메서드가 끝난 뒤에도 도는 스레드의 쓰기는 버려지거나, 같은 문맥을 쓰는 다음 시험 구간에 섞인다. 시험 안에서 끝날 때까지 기다린다 (다른 문맥의 쓰기는 섞이지 않는다) |
| `@TestExecutionListeners` | 시험 클래스가 기본 리스너를 갈아 끼우면(`mergeMode` 기본값) 경계가 빠진다. `MERGE_WITH_DEFAULTS` 를 쓴다 |
| DataSource 형식 | 빈은 CGLIB 클래스 프록시라 `HikariDataSource` 형식 주입도 된다. final 클래스 DataSource 만 인터페이스 프록시로 물러서 그 클래스 형식 주입이 깨진다 |
| JDBC 판 SQL 파서 | INSERT VALUES · ON CONFLICT · ON DUPLICATE KEY · 단순 UPDATE · DELETE 만 행으로 푼다. 그 밖(INSERT SELECT · UPDATE FROM · MERGE · CTE)은 `sql`(값은 ?) |
| jOOQ QOM | `@Experimental` API. jOOQ 를 올리면 `WriteReportJooq.java` 컴파일과 보고서 시험을 다시 본다. plain SQL 은 첫 낱말로 op · 테이블만 |
| 생성 ID 기본값 | catalog 의 기본 키 하나짜리 숫자 컬럼 중 DB 가 값을 만드는 컬럼만. 그 값을 받는 외래 키 컬럼은 설정 `ids` 에 넣는다 |
| catalog | 구간이 끝날 때 모르는 테이블이 있으면 그 DataSource 의 새 연결로 읽는다. 풀 크기 1 에서 `@Transactional` 시험이면 연결을 못 얻어 catalog 없이 쓴다 |
| 연결을 닫을 때 | 커밋하지 않고 닫힌 연결의 쓰기는 롤백으로 본다 (HikariCP 동작) |
| pgjdbc `reWriteBatchedInserts` | 배치 행 수를 모르면(-2) INSERT 는 VALUES 행 수로 적는다 |
