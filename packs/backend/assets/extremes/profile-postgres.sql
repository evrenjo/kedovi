-- 실데이터 극값 집계 (kedovi extremes add postgres 가 넣음). 원문은 내보내지 않는다:
-- 칸마다 행 수 · null 수 · 최대 길이(글자 · 바이트) · 숫자 최솟값 · 최댓값만 낸다.
--
-- 실행 (읽기 전용 계정 · 복제본 · 한가한 시간 권장. 표마다 한 번 전체 읽기):
--   psql "$DATABASE_URL" -X -v schema=app -f tools/extremes/profile-postgres.sql --csv -o extremes.csv
-- 큰 표는 표본: -v sample=10 (TABLESAMPLE SYSTEM 10%, 극값을 놓칠 수 있다). 기본 100 = 전체
-- 결과 검사 · fixture: kedovi extremes check extremes.csv · kedovi extremes fixture extremes.csv
-- 숫자 칸 최솟값 · 최댓값도 실제 값이다: 식별 번호처럼 숫자로 저장한 개인정보 칸이 있으면 결과를 공유하기 전에 그 줄을 지운다.
\set ON_ERROR_STOP on
\if :{?schema}
\else
  \set schema public
\endif
\if :{?sample}
\else
  \set sample 100
\endif
WITH cols AS (
  SELECT c.table_name AS t, c.column_name AS col, c.ordinal_position AS pos,
         format_type(a.atttypid, a.atttypmod) AS typ,
         'c' || c.ordinal_position AS k,
         c.data_type IN ('character varying', 'character', 'text') AS is_str,
         c.data_type IN ('smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision') AS is_num
  FROM information_schema.columns c
  JOIN information_schema.tables tb
    ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
  JOIN pg_attribute a
    ON a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass AND a.attname = c.column_name
  WHERE c.table_schema = :'schema'
)
SELECT format(
  'SELECT v.* FROM (SELECT count(*) AS n, %s FROM %I.%I%s) x CROSS JOIN LATERAL (VALUES %s) AS v(table_name, column_name, column_type, row_count, null_count, max_len, max_bytes, min_value, max_value)',
  string_agg(format('count(%I) AS %s_nn, %s AS %s_len, %s AS %s_bytes, %s AS %s_min, %s AS %s_max',
    col, k,
    CASE WHEN is_str THEN format('max(char_length(%I))', col) ELSE 'NULL::int' END, k,
    CASE WHEN is_str THEN format('max(octet_length(%I))', col) ELSE 'NULL::int' END, k,
    CASE WHEN is_num THEN format('min(%I)::text', col) ELSE 'NULL::text' END, k,
    CASE WHEN is_num THEN format('max(%I)::text', col) ELSE 'NULL::text' END, k), ', ' ORDER BY pos),
  :'schema', t,
  CASE WHEN :sample < 100 THEN format(' TABLESAMPLE SYSTEM (%s)', :sample) ELSE '' END,
  string_agg(format('(%L, %L, %L, x.n, x.n - x.%s_nn, x.%s_len, x.%s_bytes, x.%s_min, x.%s_max)', t, col, typ, k, k, k, k, k), ', ' ORDER BY pos))
FROM cols
GROUP BY t
ORDER BY t
\gexec
