# 쓰기 보고서 (SQLAlchemy + pytest)

시험 본문이 DB 에 쓴 것(INSERT · UPSERT · UPDATE · DELETE 와 그 결과)을 기록하고, 승인본으로 고정해 비교한다. 형식은 킷의 `FORMAT.md` 와 같다.

## 붙이는 법

1. `kedovi writes add sqlalchemy` 가 파일 세 개를 복사한다: `tests/write_report.py` · `tests/write-report/viewer.html` · `write-report.json`. <!-- refs:ignore -->
2. `conftest.py` 에 한 줄:

   ```python
   pytest_plugins = ["tests.write_report"]   # tests 가 패키지가 아니면 ["write_report"]
   ```

3. 시험에서 쓴다:

   ```python
   from tests.write_report import assert_writes, watch

   @pytest.fixture(scope="session")
   def engine():
       e = create_engine(URL)
       watch(e)                       # 이 엔진의 쓰기만 기록 (생략하면 모든 엔진)
       return e

   @pytest.mark.spec("FN-ORD-003")
   def test_saves_order(conn):
       service.save(conn, ...)
       assert_writes("저장", "app.orders", "app.refunds")   # 고른 테이블만. 안 쓴 테이블은 []
   ```

   fixture 로도 된다: `def test_x(write_report): ... write_report.assert_writes("저장")`. 이 fixture 를 쓴 시험은 쓴 것이 없어도 색인에 남는다. <!-- refs:ignore -->

| 명령 | 뜻 |
|---|---|
| `pytest` | 기록 · 승인본 비교. 다르면 실패하고 `.write-report/received/` 에 받은 값을 남긴다 | <!-- refs:ignore -->
| `WRITE_REPORT_APPROVE=1 pytest` | 승인본을 지금 값으로 갱신 |
| `.write-report/index.html` | 보는 화면 (실행이 끝나면 만들어진다) | <!-- refs:ignore -->

## 기록 범위

| 항목 | 내용 |
|---|---|
| 구간 | `pytest_runtest_call` 동안 (fixture 준비 · 정리 쓰기는 빠진다) |
| 문맥 | `watch(engine)` 한 엔진 (없으면 모든 엔진). 스레드로 가르지 않아 백그라운드 스레드 쓰기도 잡는다 |
| 문장 | Core · ORM flush(insertmanyvalues 포함) · `text()` · `exec_driver_sql`. 실행되는 SQL 과 파라미터를 직접 풀어 테이블 · 컬럼 · 값으로 남긴다 |
| UPSERT | `on_conflict_do_update` 는 UPSERT (`set_` 이 `excluded.c` 면 sameAsInsert), `on_conflict_do_nothing` 은 INSERT_IGNORE. MySQL `ON DUPLICATE KEY UPDATE` · SQLite `INSERT OR IGNORE` 도 |
| 롤백 | autocommit 이 아닌 연결의 쓰기를 `commit` · `rollback` · savepoint 이벤트에 묶는다. 원본 YAML 은 fixture 정리(롤백)까지 본 뒤 쓴다 |
| 실패 | DBAPI 예외의 SQLSTATE (psycopg `sqlstate` · psycopg2 `pgcode`) |
| 카탈로그 | 시험 구간이 끝날 때 · `assert_writes` 때 모르는 테이블이 있으면 그 엔진의 새 연결로 읽는다 (쓴 연결은 22003 같은 오류 뒤 트랜잭션이 중단돼 못 읽는다). PostgreSQL `pg_catalog`, 그 밖은 `information_schema`, SQLite 는 `PRAGMA` |
| 색인 | 끝날 때 기존 `index.json` 과 합친다. 이번에 돈 시험은 새 것으로 바뀌고, 원본 yaml 이 없어진 시험은 빠진다. `pytest -k` 로 일부만 돌려도 나머지는 남는다 | <!-- refs:ignore -->

## 병렬 실행

- 한 프로세스 안에서 시험 구간이 겹치면 즉시 실패한다 (스레드로 시험을 동시에 돌리는 플러그인).
- pytest-xdist 는 된다. 워커마다 프로세스가 따로라 기록이 섞이지 않고, 컨트롤러가 워커 조각을 모아 색인을 만든다. 같은 DB 를 함께 쓰는 시험 간섭은 기록기가 막지 않는다.

## 한계

- `engine.raw_connection()` 으로 DBAPI 를 직접 쓰면 이벤트가 없어 기록되지 않는다.
- 생성 ID 는 기본 키 하나짜리 숫자 컬럼에서 시험이 넣지 않은 값만 `<id-n>` 으로 바꾼다. 다른 테이블의 외래 키 값은 `write-report.json` 의 `ids` 에 `app.order_items.order_id` 처럼 적는다 (그 컬럼 안에서 따로 번호). <!-- refs:ignore -->
- 정리 뒤에도 끝나지 않은 트랜잭션(세션 범위 트랜잭션)의 쓰기는 롤백 표시 없이 남는다.
- 승인 비교는 `assert_writes` 를 부른 때까지의 쓰기다. 시험 뒤 롤백 여부(rolledBack)는 그때 모르면 빠진다.
- 지운 시험의 원본 yaml 은 남는다. 치우려면 출력 폴더(`.write-report/`)를 지우고 전체를 돌린다. <!-- refs:ignore -->
- 비동기 엔진은 `watch(async_engine)` 로 sync_engine 을 등록하면 같은 이벤트로 잡히지만, 이 킷의 시험은 동기 엔진으로만 했다.
