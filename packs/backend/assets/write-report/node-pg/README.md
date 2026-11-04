# 쓰기 보고서 (Node pg)

시험 본문이 DB 에 쓴 것(INSERT · UPSERT · UPDATE · DELETE 와 그 결과)을 기록하고, 승인본으로 고정해 비교한다. node:test · vitest · jest 에서 같은 방법으로 쓴다. 형식은 킷의 `FORMAT.md` 와 같다.

## 붙이는 법

1. `kedovi writes add node-pg` 가 파일 세 개를 복사한다: `test/write-report.cjs` · `test/write-report/viewer.html` · `write-report.json`. <!-- refs:ignore -->
2. 시험 함수를 `recordWrites` 로 감싼다:

   ```js
   const { recordWrites, assertWrites, watch } = require('./write-report.cjs'); // ESM: import { ... } from './write-report.cjs'
   const pool = watch(new Pool(...));   // 이 풀의 쓰기만 기록 (생략하면 모든 연결)

   test('FN-ORD-003 주문 저장', recordWrites(async () => {
     await service.save(pool, ...);
     assertWrites('저장', 'app.orders', 'app.refunds');   // 고른 테이블만. 안 쓴 테이블은 []
   }));
   ```

| 명령 | 뜻 |
|---|---|
| 평소 시험 실행 | 기록 · 승인본 비교. 다르면 실패하고 `.write-report/received/` 에 받은 값을 남긴다 | <!-- refs:ignore -->
| `WRITE_REPORT_APPROVE=1` 을 붙여 실행 | 승인본을 지금 값으로 갱신 |
| `.write-report/index.html` | 보는 화면 (실행이 끝나면 만들어진다) | <!-- refs:ignore -->

## 기록 범위

| 항목 | 내용 |
|---|---|
| 구간 | `recordWrites` 로 감싼 시험 함수 실행 동안 (`beforeEach` 준비 · `afterEach` 정리 쓰기는 빠진다) |
| 문맥 | `watch(pool)` 한 풀 · 클라이언트 (없으면 모든 연결). 비동기 문맥으로 가르지 않아 기다리지 않은 백그라운드 쓰기도 잡는다 |
| 문장 | `pg.Client.prototype.query` 를 감싼다 (Pool 도 Client 를 쓴다). SQL 문자열과 값 배열을 직접 풀어 INSERT 다행 · `ON CONFLICT DO UPDATE SET c = EXCLUDED.c` · `DO NOTHING` · `WHERE a = $1 AND b IN (…)` · `= ANY($2)` 를 구조로 남긴다. 못 풀면 `op: SQL` 과 값을 ? 로 바꾼 SQL |
| 롤백 | 같은 클라이언트의 BEGIN · COMMIT · ROLLBACK · SAVEPOINT · ROLLBACK TO · RELEASE 를 따라간다. 실패한 트랜잭션의 COMMIT(응답이 ROLLBACK)도 롤백으로 본다. 원본 YAML 은 그 트랜잭션이 끝난 뒤 쓴다 |
| 실패 | `err.code` (SQLSTATE) |
| 카탈로그 | 처음 쓰는 연결에서 쓰기 전에 한 번 `pg_catalog` 를 읽는다 (트랜잭션 안이면 savepoint 로 감싼다. 동기 `assertWrites` 가 쓰려고). 시험 구간이 끝날 때 모르는 테이블이 남았으면 그 풀 · 연결 설정으로 새 연결을 열어 읽는다 (쓴 연결은 오류 뒤 트랜잭션이 중단돼 못 읽는다) |
| 색인 | 끝날 때 기존 `index.json` 과 합친다. 이번에 돈 시험은 새 것으로 바뀌고, 원본 yaml 이 없어진 시험은 빠진다. 이름 패턴 · `-t` 로 일부만 돌려도 나머지는 남는다 | <!-- refs:ignore -->

## 실행기별 참고

| 실행기 | 참고 |
|---|---|
| node:test | `node --test`. 시험 파일마다 프로세스가 따로라 조각을 모아 색인을 만든다 |
| vitest | forks(기본) · threads 둘 다 된다. 문맥 인자(`ctx`)에서 시험 이름 · 파일을 읽는다 |
| jest | `expect.getState()` 에서 시험 이름 · 파일을 읽는다. 시험 파일 끝(afterAll)에 색인을 쓴다 |

## 한계

- 시험 구간이 겹치면 즉시 실패한다 (`test.concurrent` · node:test `concurrency`). 파일 단위 병렬은 된다 (프로세스 · 워커가 따로).
- done 콜백 형식 시험은 감쌀 수 없다. async 함수로 쓴다.
- pg-native(`pg.native`)는 기록하지 않는다.
- 생성 ID 는 기본 키 하나짜리 숫자 컬럼에서 시험이 넣지 않은 값만 `<id-n>` 으로 바꾼다. 외래 키 값은 `write-report.json` 의 `ids` 에 적는다. <!-- refs:ignore -->
- 승인 비교는 `assertWrites` 를 부른 때까지의 쓰기다. 시험 뒤 롤백 여부는 그때 모르면 빠진다.
- 지운 시험의 원본 yaml 은 남는다. 치우려면 출력 폴더(`.write-report/`)를 지우고 전체를 돌린다. <!-- refs:ignore -->
- vitest threads 모드는 워커가 이벤트 없이 끝나서 시험마다 색인을 다시 쓴다 (시험이 아주 많으면 forks 가 빠르다).
