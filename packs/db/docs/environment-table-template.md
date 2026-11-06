# 환경 표 양식 — project 팩에 복사해 채운다

`db` 팩은 실제 환경을 모른다. 아래 표를 `packs/project/rules/` 의 룰(예: `20-db-environments.md`,
`load: always` 이면 짧게 / 길면 `on-demand`)로 옮겨 프로젝트 값을 채운다. **비밀번호는 적지 않는다.**

```markdown
---
title: DB 환경
load: always
---

## DB 환경

| 별칭 | DBMS | 인스턴스(호스트:포트/DB) | 스키마 | 계정 출처 | 비고 | 확인 명령 | 확인일 |
|---|---|---|---|---|---|---|---|
| local | PostgreSQL 16 | localhost:5432/app | public | 로컬 기본값 | 임베디드·도커 | `psql -c 'select version()'` | 2026-01-15 |
| dev | PostgreSQL 16 | dev-db.internal:5432/app | app_dev | `.run/dev.run.xml` | 우리 개발 서버 | `psql -h dev-db.internal -c 'select version()'` | 2026-01-15 |
| qa | PostgreSQL 16 | … | app_qa | … | 조회만 | … | … |
| prd | PostgreSQL 16 | … | app_prd | 키체인 `app-prd` | **직접 접속·변경 금지** | 운영 담당자에게 확인 | 2026-01-15 |

- 확인 명령 · 확인일: 그 행이 지금도 맞는지 다시 볼 명령과 마지막으로 본 날. 30일(vars.docs.factDays) 지나면 에이전트가 읽을 때 재확인 알림이 나온다. 칸이 없는 옛 표는 검사하지 않는다.
- 모호한 "개발DB" = dev / 공유 개발DB 중 어느 것인지 확인받는다.
- 스키마는 `<별칭>.<스키마>` 로 부른다 (예: `dev.app_dev`).
- 스키마 이름 규칙이 환경마다 다르면(운영만 접두 없음 등) 여기 적는다 — 넘겨짚기 쉬운 곳이다.
- 연결이 안 되면 VPN·터널 등 선행 조건부터 확인한다(있다면 여기 적는다).
- 환경마다 DB 설정값이 달라 성능·동작 비교에 영향을 주면(메모리 파라미터·확장 설치 스키마 등) 여기 적는다.
```

MySQL·MariaDB 는 스키마 = DB 이므로 "스키마" 칸에 DB 이름을, Oracle 은 스키마 = 사용자이므로 소유 계정을 적는다.
MongoDB 는 "스키마" 칸에 DB 이름을 적는다.
