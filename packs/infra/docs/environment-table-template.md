# 인프라 환경 표 양식: project 팩에 복사해 채운다

`infra` 팩은 실제 환경을 모른다. 아래 표를 `packs/project/rules/` 의 룰(예: `20-infra-environments.md`,
`load: always` 이면 짧게, 길면 `on-demand`)로 옮겨 프로젝트 값을 채운다. **비밀값은 적지 않는다.**
「운영 환경 사실」 표의 확인 명령 · 확인일 칸은 낡은 사실을 근거로 판단하지 않게 하는 칸이다. 칸이 없는 옛 표는 검사하지 않는다.

```markdown
---
title: 인프라 환경
load: always
---

## 인프라 환경

| 별칭 | 클러스터 · kube 컨텍스트 | 네임스페이스 | 클라우드 계정 · 리전 | IaC state 위치 | 배포 방법 | 비고 |
|---|---|---|---|---|---|---|
| local | docker compose | - | - | - | `docker compose up` | 개발용 |
| dev | dev-cluster · `dev-admin` | app-dev | <계정> · <리전> | <원격 state 경로> | 파이프라인 (main) | |
| prd | prd-cluster · `prd-deployer` | app | <계정> · <리전> | <원격 state 경로> | 파이프라인 + 승인 | **직접 반영 금지** |

## 운영 환경 사실

바뀔 수 있는 사실(디스크 · 메모리 상한 · 러너 · 경로 · 버전)은 값과 함께 확인 명령과 확인일을 적는다.
확인일이 30일(vars.docs.factDays) 지난 행은 에이전트가 읽을 때 재확인 알림이 나온다.

| 사실 | 값 | 확인 명령 | 확인일 |
|---|---|---|---|
| dev 서버 디스크 여유 | 120GB | `ssh dev df -h /` | 2026-01-15 |
| CI 러너 동시 작업 수 | 2 | 러너 config.toml 의 concurrent | 2026-01-15 |
| 앱 컨테이너 메모리 상한 | 2GB | `docker inspect -f '{{.HostConfig.Memory}}' app` | 2026-01-15 |

- 비밀 출처: <비밀 저장소 경로 · CI 변수 이름>
- 모호한 "개발 서버" = dev 인지 확인받는다.
- 운영 컨텍스트는 로컬 기본 컨텍스트로 두지 않는다.
```
