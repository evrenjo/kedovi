---
title: Spring 테스트 인프라 · 컨텍스트
load: on-demand
when: Spring 에서 통합 테스트(@SpringBootTest · 슬라이스 · Testcontainers)를 새로 쓰거나, 테스트 설정 · 컨테이너 기동 방식을 고치거나, 테스트가 느리거나 컨테이너가 많이 뜰 때
---

원칙(층은 아래로 · 실제 엔진 · 실행당 한 벌 · 쓰는 것만 · 격리)은 backend 팩 「백엔드 테스트」. 여기는 Spring Boot + Testcontainers 에서의 방법이다. 저장소에 이미 공용 테스트 설정이 있으면 그것을 고쳐 쓴다.

## 흔한 원인

| 증상 | 원인 |
|---|---|
| 빌드 한 번에 같은 이미지 컨테이너가 여러 개 | 컨테이너를 `@Bean` 으로 정의 → **컨텍스트마다 한 벌**. 컨텍스트는 설정 조합(`@MockitoBean` · `@Import` · 프로필 · 속성)마다 새로 생기고, 캐시가 JVM 끝까지(기본 32개) 붙잡는다 |
| 두 번째 테스트 클래스부터 연결 실패 | `@Testcontainers` · `@Container` 가 클래스 끝에 컨테이너를 멈추는데, 캐시된 컨텍스트는 그 주소를 계속 쓴다 |
| DB 테스트에도 브로커가 뜸 | 모든 테스트가 같은 「전부 띄우기」 설정을 `@Import` 함 |

## 실행당 한 벌

컨테이너는 **빈이 아닌 static 필드**로 두고 처음 쓰일 때 한 번 시작한다. 연결 정보는 `DynamicPropertyRegistrar` 빈(Spring Framework 6.2+, Boot 3.4+)으로 넘긴다. JVM 이 끝나면 Testcontainers 가 치운다.

```java
// 이미지당 홀더 하나: 클래스가 처음 로드될 때만 시작하므로 안 쓰는 컨테이너는 뜨지 않는다
final class PostgresContainer {
    static final PostgreSQLContainer INSTANCE = new PostgreSQLContainer("postgres:17-alpine");
    static { INSTANCE.start(); }
    private PostgresContainer() {}
}

@TestConfiguration(proxyBeanMethods = false)
public class DbOnly {
    @Bean
    DynamicPropertyRegistrar postgresProperties() {
        var db = PostgresContainer.INSTANCE;
        return registry -> {
            registry.add("spring.datasource.url", db::getJdbcUrl);
            registry.add("spring.datasource.username", db::getUsername);
            registry.add("spring.datasource.password", db::getPassword);
        };
    }
}

@TestConfiguration(proxyBeanMethods = false)
@Import(DbOnly.class)
public class DbAndBroker {
    @Bean
    DynamicPropertyRegistrar rabbitProperties() {
        var mq = RabbitContainer.INSTANCE;   // PostgresContainer 와 같은 모양의 홀더
        return registry -> {
            registry.add("spring.rabbitmq.host", mq::getHost);
            registry.add("spring.rabbitmq.port", mq::getAmqpPort);
            registry.add("spring.rabbitmq.username", mq::getAdminUsername);
            registry.add("spring.rabbitmq.password", mq::getAdminPassword);
        };
    }
}
```

- **공유 컨테이너를 `@Bean` 으로 돌려주지 않는다** (`@ServiceConnection` 포함). Spring 은 컨테이너 빈을 컨텍스트가 닫힐 때 멈춘다. 캐시 초과로 밀려난 컨텍스트 하나 · `@DirtiesContext` 하나가 다른 컨텍스트가 쓰는 공유 컨테이너를 끈다. `@Bean` · `@ServiceConnection` 은 컨텍스트가 하나뿐일 때만 쓴다.
- **`@Testcontainers` · `@Container` 와 섞지 않는다.**
- 3.4 미만이면 공통 기반 클래스의 `@DynamicPropertySource` static 메서드로 같은 일을 한다.
- 여러 컨테이너를 한 번에 띄우면 `Startables.deepStart(a, b).join()` 으로 병렬 시작한다.

## 쓰는 것만 · 컨텍스트 줄이기

- **로직은 Spring 없이** 단위 테스트(생성자에 대역 주입). `@SpringBootTest` 는 경계 확인용으로만.
- **DB 만 쓰면 슬라이스**: `@DataJpaTest` · `@JdbcTest` · `@JooqTest` + `@Import(DbOnly.class)` + `@AutoConfigureTestDatabase(replace = NONE)`. 브로커 · 웹 자동 설정이 뜨지 않는다. 웹 계층은 `@WebMvcTest`.
- 전체 컨텍스트에서 브로커를 안 쓰는 테스트라면 리스너 자동 시작을 끈다(`spring.rabbitmq.listener.simple.auto-startup=false` 등). 그래도 브로커가 필요하면 그 테스트는 `DbAndBroker` 쪽이다.
- **`@MockitoBean` 조합을 모은다**: 클래스마다 다른 대역 빈 조합은 컨텍스트를 하나씩 더 만든다. 자주 쓰는 대역은 공통 기반 클래스 · 설정에 모으고, 대역이 많이 필요한 테스트는 단위 테스트로 내린다.
- `@DirtiesContext` 는 마지막 수단. 데이터 정리로 해결한다.

## 격리

공유 DB 는 테스트끼리 데이터가 남는다. 저장소 방식 하나로 맞춘다: 테스트 트랜잭션 롤백(`@Transactional` 테스트, 단 다른 스레드 · 브로커 소비자가 커밋하는 경로는 롤백되지 않는다) · `@BeforeEach` 정리 · 고유 키 · 큐 이름.

## 확인

테스트를 돌리는 동안 시작된 컨테이너를 이미지별로 센다. 이미지마다 1이어야 한다 (`testcontainers/ryuk` 는 정리용 1개).

```bash
docker events --filter event=start --format '{{.From}}' > container-starts.txt &
./gradlew test; kill $!
sort container-starts.txt | uniq -c; rm container-starts.txt
```
