---
title: Spring 데이터 접근: 리포지토리·QueryDSL·네이티브 SQL
load: on-demand
when: Repository·QueryDSL·네이티브 SQL 로 DB 를 읽거나 쓰는 코드를 새로 쓰거나 고칠 때 (대량 수정·삭제·복제 포함)
---

저장 경로(save · bulk · jOOQ · JdbcTemplate · 네이티브 SQL)를 바꾸면 쓰기 보고서 · 기대값을 같이 본다 (backend 팩 「백엔드 쓰기 보고서」, 붙이기 `kedovi writes add jooq|jdbc`).

## 수단 고르기

| 케이스 | 수단 |
|---|---|
| 단건·bulk 등록 | `save` / `saveAll` |
| 단건 수정 | 엔티티 setter + dirty checking (또는 `save`) |
| bulk 수정·소프트 삭제 | `findByXxx` → `forEach(setter)` → `saveAll` |
| 삭제 | `deleteById` / 파생 `deleteAllByXxx` |
| PK·단순 조건 조회·존재·카운트 | `findById` · 파생 쿼리 · `existsBy` · `countBy` |
| JOIN·동적 조건·검색·페이징·프로젝션·집계(MAX/COUNT…) | **QueryDSL Query 클래스** |
| JPQL 문자열 `@Query` | ❌ 모든 경우 금지 |

- QueryDSL `update(...).execute()` 로 bulk 수정을 하지 않는다 — 영속성 컨텍스트를 우회해 같은 트랜잭션의 엔티티가 옛 값(stale)으로 남는다. 수백~수천 행은 `saveAll` + `hibernate.jdbc.batch_size` 로 보강한다.

## 파생 쿼리 이름이 "비대"한 기준 — 길이가 아니라 이름에 든 것

| 유형 | 판정 |
|---|---|
| 세그먼트가 전부 키 컬럼 (`…AndXxxCodeAndYyyId`) — 복합 자연키 등가조회 | **파생 쿼리 유지** (옮겨도 코드만 는다) |
| 이름에 `LessThan`·`GreaterThan`·`Between`·`OrderBy…Desc`·`StartingWith`·`Containing`·`Not` 이 섞임 | **QueryDSL 로 분리**, 메서드명은 의도로 (`findCurrentPeriod(date)`) |

- 두 번째 유형이면서 90자를 넘으면 예외 없이 분리. 리포지토리에 line-length 억제를 붙이고 싶어지면 이 표로 판정한다.
- 파생 쿼리는 **기동 시점**에, QueryDSL 은 **컴파일 시점**에 검증된다.

## 리포지토리 = 엔티티당 하나 · 복합 키 = 값 객체

- `{엔티티}Repository` 하나. 소유자·화면별로 리포지토리를 쪼개지 않는다 — 소유자 조건은 **파라미터**로. 쪼개면 경로마다 다른 쪽을 잡아 규칙이 갈라진다.
- 리포지토리·Query 메서드는 **쓰는 코드와 같은 커밋**에서 추가한다(호출부 없는 선언 금지).
- 인자 6개 이상 + 같은 타입 4개 이상 연속이면 값 객체(`record` + `@Builder` + `of(entity)`)로 받는다. 위치 인자 생성자를 부르지 않는다 — 전치 위험이 그대로 옮겨간다. 위치: `model/dto/{도메인}/`.

## 네이티브 SQL — 다른 수단이 없을 때만

원칙(판정 순서·전염 주의)은 backend 팩 「백엔드 데이터 접근」. Spring 에서의 판정:

① 파생 쿼리로 되나 → ② QueryDSL 로 되나(**집계 MAX/COUNT 포함**) → ③ 둘 다 아니면 `createNativeQuery` / `@Query(nativeQuery = true)` + **이유 주석 1줄**.

| 네이티브가 정당한 경우 | 이유 |
|---|---|
| `INSERT … SELECT` | JPA·QueryDSL(jpa) 에 없는 구문 |
| `information_schema`·`pg_*` 등 카탈로그 | 매핑된 엔티티가 없다 |
| 다른 스키마·DB 참조 | Hibernate `default_schema` 밖 |
| `nextval` 채번 | 엔티티가 아니다 |
| 1만 행 이상 대량 처리 예외 | 아래 |

- 자연키 단건 조회·`MAX` 집계·수백 행 UPDATE 를 네이티브로 쓰지 않는다 — 각각 파생 쿼리·QueryDSL `max()`·`saveAll` 이 있다.
- 한 클래스에 네이티브와 JPA 가 섞여 있는 것이 정상이다 — 통일하려고 JPA 쪽을 네이티브로 바꾸지 않는다.

## 대량 처리 예외 (1만 행 이상) — Spring 에서

조건은 backend 팩과 같다(실측 1만 행 이상 · 파티션 키 전체로 한정 · 주석에 건수와 사유). Spring 에서 추가로:

- 수단: 네이티브 `INSERT … SELECT`·`UPDATE … WHERE`·`DELETE … WHERE` 또는 QueryDSL bulk `update()/delete().execute()`.
- 같은 트랜잭션에서 대상 엔티티를 로드하지 않는다. 불가피하면 실행 뒤 `EntityManager.clear()` — 안 하면 영속성 컨텍스트의 엔티티가 옛 값으로 남아 dirty checking 이 되돌려 쓴다.
- 1만 미만이면 `findByXxx` → setter → `saveAll` (+ `hibernate.jdbc.batch_size`).

## 런타임에만 터지는 QueryDSL 형태

| 형태 | 증상 | 검사 |
|---|---|---|
| `Projections.constructor` 인자 수 ≠ DTO 생성자 / `fields`·`bean` 에 없는 필드명 | 그 쿼리를 만드는 순간 `No constructor found` → 500 | `node packs/stack-spring/bin/check-querydsl-projection-arity.js` |
| `DISTINCT` + ORDER BY 에 select 에 없는 **식**(함수·템플릿·정렬 헬퍼) | PostgreSQL `for SELECT DISTINCT, ORDER BY expressions must appear in select list` | `node packs/stack-spring/bin/check-querydsl-distinct-order.js` (프로젝트 정렬 헬퍼는 `--pattern`) |

DTO 필드를 빼거나 정렬을 바꿨으면 둘 다 돌린다. DISTINCT 가 걸리면 정렬을 빼고 `fetch()` 뒤 Java 에서 정렬한다.

## 변경 영향을 볼 때 — 술어 추출기

쿼리의 기준 테이블·조인·WHERE 컬럼을 **DB 컬럼명으로** 뽑아 경로끼리 대조한다 (조회 기준을 바꿨는데 쓰기 경로가 따라왔는지 확인할 때).

```bash
node packs/stack-spring/bin/query-predicates.js --find order                 # *Query / *Repository 찾기
node packs/stack-spring/bin/query-predicates.js <File.java> [--method m] [--cols] [--json]
```

- QueryDSL 은 클래스 안 헬퍼 폐쇄를 따라가고, 별칭은 메서드 스코프로 푼다. 리포지토리는 파생 메서드명을 엔티티 필드로 최장 매칭한다. 서비스·배치의 네이티브 SQL 은 표·WHERE 좌변만.
- `⚠ 못 푼 조각` · `⚠ … SQL 을 못 읽었다` 가 나오면 그 조건은 목록에 없다 — 직접 읽는다.
