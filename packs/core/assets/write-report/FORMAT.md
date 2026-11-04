# 쓰기 보고서 형식

시험이 DB 에 쓴 것을 스택과 상관없이 같은 모양으로 남긴다. 스택별 기록기(Java jOOQ · Spring JDBC · Python SQLAlchemy · Node pg)는 이 형식만 맞추고, 보는 화면(`viewer.html`)과 킷 검사(`kedovi writes check`)는 이 형식만 읽는다.

## 파일 위치

| 파일 | 위치 (repo 기준, 스택 기본값) | 만드는 때 |
|---|---|---|
| 시험별 원본 | `<출력>/<시험 묶음>/<시험 이름>.yaml` | 시험 하나가 끝날 때 (트랜잭션 완료 뒤) |
| 색인 데이터 | `<출력>/index.json` | 실행 끝 (JVM 종료 훅 · pytest sessionfinish · node 종료) |
| 화면 | `<출력>/index.html` | 색인과 함께. `viewer.html` 의 `/*__WRITE_REPORT_DATA__*/null` 을 색인 JSON 으로 바꾼 한 파일 |
| 승인본 | `<승인 폴더>/<시험 묶음>/<이름>.yaml` | `writeReport.approve=true` (Java 시스템 속성) · `WRITE_REPORT_APPROVE=1` (Python · Node) 일 때만 |
| 받은 값 | `<출력>/received/<시험 묶음>/<이름>.yaml` | 승인본과 다를 때 |

`<출력>` 기본값: Gradle `build/write-report` · Maven `target/write-report` · Python `.write-report` · Node `.write-report`. `<승인 폴더>` 기본값: Java `src/test/resources/write-report/approved` · Python `tests/write-report/approved` · Node `test/write-report/approved`.
`<시험 묶음>` = 클래스 FQCN(Java) · 모듈 경로(Python, `<repo>/tests/test_x.py` → `tests.test_x`) · 시험 파일 상대 경로(Node). `<시험 이름>` = 메서드 이름 · 시험 함수 이름(매개변수 붙은 시험은 `[...]` 를 `_` 로). 파일 이름에 못 쓰는 글자는 `_`.

## 시험별 원본 (YAML, 실행 순서)

```yaml
test: com.example.batch.DailySalesJobTest#savesDailySales
specs: [FN-SAL-003]            # 시험 이름 · 태그 · 표시 이름에 든 기획 ID (없으면 빈 목록)
started: 2026-11-05T10:00:00.123+09:00
writes:
  - seq: 1
    op: INSERT                 # INSERT | UPSERT | INSERT_IGNORE | UPDATE | DELETE | MERGE | SQL
    table: shop.daily_sales   # 스키마.테이블 (스키마를 모르면 연결의 현재 스키마, 그것도 모르면 테이블만)
    rows:                      # INSERT · UPSERT · INSERT_IGNORE · MERGE 의 VALUES 행 (여러 행이면 여러 개)
      - {store_id: "S01", sale_date: 2026-11-04, avg_price: 123.45, note: null}
    set: {updated_at: !sql "now()"}        # UPDATE SET · ON CONFLICT DO UPDATE SET (바인드가 아닌 식은 !sql)
    sameAsInsert: [avg_price]         # DO UPDATE SET c = EXCLUDED.c 인 컬럼 (set 에서 뺀다)
    conflict: [store_id, sale_date]         # ON CONFLICT 대상 컬럼
    where: {id: 42}                        # WHERE 의 컬럼 = 값 (AND 로 이은 등호 · IN 만. IN 은 목록)
    whereSql: "status <> ?"                # where 로 못 푼 나머지 (값은 ?)
    sql: "INSERT INTO ... SELECT ..."      # 행으로 못 푼 문장 (INSERT SELECT · MERGE · UPDATE FROM · plain SQL). 값은 ?
    result: {rows: 1}                      # {rows: n} | {error: "22003", message: "numeric field overflow"} 
    rolledBack: true                       # 그 쓰기가 롤백된 트랜잭션에 있었으면 (없으면 생략)
```

- 키 순서는 위 표 순서. 빈 키는 쓰지 않는다 (`rows` 가 없으면 줄이 없다). 이 순서는 승인본 비교의 일부다.
- 값: 문자열은 항상 큰따옴표, 숫자 · 참거짓 · null 은 그대로, 날짜 `2026-11-04`, 시각은 ISO-8601 문자열(큰따옴표), 바이트 `!bytes <길이>`, 마스킹 `"***"`, 알 수 없는 바인드 `"<text:12>"` · `"<number>"` · `"<time>"`.
- `rows` 의 행에 없는 컬럼 = 그 문장이 쓰지 않은 컬럼 (화면의 「미기록」). 컬럼 이름은 소문자 그대로 (따옴표 식별자는 원래 대소문자).
- `result.message` 는 정규화 뒤 남긴다 (로케일 번역 「Detail:」 · 「세부 정보:」 줄은 지운다).
- YAML 은 흐름식 맵(`{a: 1}`)과 블록 목록만 쓴다. 기록기는 라이브러리 없이 직접 쓴다 (의존성 추가 0).

## 색인 데이터 (`index.json`)

```json
{
  "format": 1,
  "generatedAt": "2026-11-05T10:03:00+09:00",
  "repo": "app-batch",
  "stack": "jooq",
  "tests": [
    { "id": "com.example.batch.DailySalesJobTest#savesDailySales", "group": "com.example.batch.DailySalesJobTest", "name": "savesDailySales",
      "file": "com.example.batch.DailySalesJobTest/savesDailySales.yaml", "specs": ["FN-SAL-003"], "status": "passed", "writes": [ /* 원본과 같은 쓰기 목록 */ ] }
  ],
  "catalog": {
    "shop": {
      "daily_sales": {
        "columns": [ { "name": "avg_price", "type": "numeric(7,2)", "nullable": true, "default": null, "generated": false } ],
        "primaryKey": ["store_id", "sale_date"]
      }
    }
  },
  "excluded": { "tables": ["batch_*", "qrtz_*"], "updatesOnly": [ { "table": "app.scheduler_jobs", "columns": ["next_fire_at", "updated_at"], "count": 530 } ] }
}
```

- `catalog` 은 시험 구간이 끝날 때 아직 모르는 테이블이 있으면 그 DataSource · 엔진 · 풀의 새 연결로 읽고 모아 둔다 (쓴 연결은 오류 뒤 트랜잭션이 중단돼 있을 수 있고, 종료 훅 때는 컨테이너가 이미 내려갔을 수 있다). PostgreSQL 은 `pg_catalog`(`format_type` · `pg_get_expr`, 파티션 하위 테이블 · 시스템 스키마 제외). 다른 DB 는 `information_schema` 로 같은 모양.
- `status`: `passed` | `failed` | `skipped`. 원본 YAML 에는 넣지 않는다 (승인본이 결과에 흔들리지 않게).
- YAML 태그의 JSON 표기: `!sql "now()"` → `{"$sql": "now()"}`, `!bytes 12` → `{"$bytes": 12}`. 날짜는 문자열 `"2026-11-04"`. 나머지 값은 YAML 과 같다.

## 화면 만들기 (`index.html`)

- `viewer.html` 에 데이터 자리 `/*__WRITE_REPORT_DATA__*/null` 이 정확히 한 번 있다. 이 자리를 색인 JSON(한 줄)으로 바꾼다. 개수가 1 이 아니면 화면을 만들지 않고 경고한다.
- JSON 안의 `</` 는 `<\/` 로 바꾼다 (값에 든 `</script>` 가 스크립트를 끝내지 않게).
- 바꾸기는 문자열 나누기 · 잇기로 한다. 정규식 치환은 값의 `$&` · `$1` 같은 글자를 치환 패턴으로 읽는다 (Java `replace(CharSequence, CharSequence)` · Python `str.replace` 는 괜찮다. JS 는 `split(자리).join(json)`).
- 견본: `sample/build-sample.js` 가 `sample/make-sample.js` 의 표본 데이터로 `<출력>/index.html` 을 만든다. 같은 폴더에 `sample.json` · `viewer.html` 도 쓰므로 화면만 고칠 때는 그 폴더를 로컬 서버로 열고 `viewer.html?data=sample.json`.

## 정규화 (승인본 비교 전에)

| 규칙 | 내용 |
|---|---|
| 생성 ID | 설정 `ids` 에 든 컬럼(기본: 기본 키 하나짜리 숫자 컬럼 중 시험이 넣지 않고 DB 가 만든 값)은 `<컬럼-n>`. n 은 그 시험 안에서 **원값 숫자 오름차순** 번호 (처음 나온 순서가 아니다) |
| UUID | 모양이 UUID 인 문자열은 `<uuid>` |
| 행 정렬 | 승인본은 테이블별로 묶고, 테이블 안 쓰기는 정규화한 내용의 문자열 순서로 자연 정렬 (`seq` 는 지운다) |
| JSON 문자열 | `{` · `[` 로 시작해 JSON 으로 읽히면 키 이름순으로 다시 쓴다 |
| 실제 시각 | 설정 `now` 에 든 컬럼(기본: `created_at` · `updated_at` · `inserted_at` · `modified_at`)과 `!sql "now()"` · `current_timestamp` 는 `<now>`. 시험 시계로 정한 컬럼은 그대로 |
| 메시지 | `Detail:` · `세부 정보:` · `상세 정보:` 이후는 지운다. 설정 `replace` 정규식 목록을 더 적용 |

승인본 모양 (`assertMatches(이름, 테이블...)`):

```yaml
shop.daily_sales:
  - {op: INSERT, rows: [{store_id: "S01", sale_date: 2026-11-04, avg_price: 123.45}], result: {rows: 1}}
shop.refunds: []          # 고른 테이블에 쓴 것이 없으면 「안 썼음」 으로 고정
```

- 테이블을 고르면 그 테이블만, 인자가 없으면 그 시험이 쓴 테이블 전부.
- 테이블 이름 순서로 쓴다. 승인 갱신은 승인 속성 · 환경 변수가 켜졌을 때만, 꺼져 있으면 다르면 실패하고 `received/` 에 받은 값을 남긴다 (메시지에 승인본 · 받은 값 경로와 줄 단위 차이 앞 40줄).

## 마스킹

| 대상 | 규칙 |
|---|---|
| 컬럼 이름 | `(^|_)(app|api|access|private|secret)_?key(_|$)` · `password` · `passwd` · `token` · `secret` 이 들어가면 `"***"`. `key` 단독은 가리지 않는다 (`source_key` 같은 업무 컬럼) |
| 컬럼을 모르는 바인드 | 설정 `mask.unknownBinds` = `type`(기본, `<text:길이>` · `<number>` · `<time>`) · `hide`(`"***"`) · `show` |
| SQL 로 남기는 모든 경로 | `whereSql` · `sql` · DO UPDATE WHERE · INSERT SELECT · MERGE · UPDATE FROM 은 바인드를 `?` 로. 인라인 리터럴(`'…'` · 숫자)도 `?` 로 바꾼다 |

## 제외

| 설정 | 기본 | 뜻 |
|---|---|---|
| `exclude.tables` | `batch_*` · `qrtz_*` · `flyway_schema_history` · `databasechangelog*` · `shedlock` | 통째로 기록하지 않는다 (와일드카드 `*`, 스키마 붙여도 됨) |
| `exclude.updatesOnly` | 없음 | `테이블: 컬럼,컬럼` 목록. 그 테이블의 UPDATE 가 **이 컬럼만** SET 하면 기록하지 않고 개수만 `excluded.updatesOnly` 에 센다 |

## 설정 파일

한 repo 에 한 곳. Java `<repo>/src/test/resources/write-report.properties`, Python · Node `<repo>/write-report.json`. 키는 같다.

```properties
output=build/write-report
approved=src/test/resources/write-report/approved
ids=app.orders.id,app.order_items.id
now=created_at,updated_at
replace.1=\\(at offset \\d+\\)=>
mask.unknownBinds=type
exclude.tables=batch_*,qrtz_*
exclude.updatesOnly.1=app.scheduler_jobs:next_fire_at,updated_at
```

## 시험 경계와 롤백

- 기록 구간 = 시험 본문만 (`@BeforeEach` · fixture 준비 쓰기는 빼고, 시험 함수 실행 시작부터 끝까지).
- 직렬 실행만. 구간이 겹치면(병렬 실행) 즉시 실패시키고 이유를 메시지로.
- 문맥: 그 시험의 애플리케이션 문맥(Spring `ApplicationContext` 동일성 · SQLAlchemy 엔진 · Node 풀)에서 온 쓰기만. 스레드 로컬로 가르지 않는다 (배치 · 비동기 쓰기도 잡게).
- 롤백 표시: 그 연결이 실제 DB 트랜잭션에 참여했고 autocommit 이 꺼졌을 때만 트랜잭션 완료(커밋 · 롤백)에 묶는다. autocommit 쓰기는 즉시 커밋으로 본다. savepoint 부분 롤백은 그 savepoint 뒤 쓰기에 `rolledBack: true`.
- 원본 YAML 은 구간이 끝나고 **트랜잭션 완료를 본 뒤** 쓴다 (`@Transactional` 시험의 롤백은 시험 메서드 뒤에 일어난다).
