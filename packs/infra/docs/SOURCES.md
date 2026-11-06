# infra 팩 근거 자료

`infra` 팩 룰의 근거. 룰을 고칠 때 여기 자료와 맞는지 먼저 보고, 근거가 바뀌면 이 표도 함께 고친다. (조사 2026-10, URL 응답 확인)

## 자료 목록

| ID | 자료 | URL | 요지 |
|---|---|---|---|
| C1 | Docker, *Building best practices* | https://docs.docker.com/build/building/best-practices/ | 신뢰할 베이스 · 다단계 빌드 · 캐시 순서 · `.dockerignore` · 비루트 · 버전 고정(digest) |
| C2 | Docker, *Dockerfile reference* | https://docs.docker.com/reference/dockerfile/ | exec 형식 실행 명령 · `HEALTHCHECK` · `USER` · 빌드 비밀 마운트 |
| K1 | Kubernetes, *Configuration best practices* | https://kubernetes.io/docs/concepts/configuration/overview/ | 매니페스트를 버전 관리 · 이미지 태그 고정(`latest` 피함) · 레이블 |
| K2 | Kubernetes, *Resource management for pods and containers* | https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/ | requests · limits 의 뜻과 스케줄링 · 메모리 초과 시 종료 |
| K3 | Kubernetes, *Liveness, readiness and startup probes* | https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/ | 세 프로브의 역할 · 느린 기동은 startup |
| K4 | Kubernetes, *Pod Security Standards* | https://kubernetes.io/docs/concepts/security/pod-security-standards/ | privileged · baseline · restricted. restricted 는 비루트 · 권한 상승 금지 · capability 제거 |
| K5 | Kubernetes, *kubectl diff* | https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/ | 반영 전 클러스터와 차이 보기 |
| H1 | Helm, *Chart best practices* | https://helm.sh/docs/chart_best_practices/ | values 설계 · 표준 레이블 · 차트 버전과 앱 버전 · 리소스 기본값 |
| T1 | HashiCorp, *Remote state* | https://developer.hashicorp.com/terraform/language/state/remote | state 를 원격에 · state 에 비밀값이 평문으로 |
| T2 | HashiCorp, *State locking* | https://developer.hashicorp.com/terraform/language/state/locking | 쓰기 작업마다 잠금 · 강제 해제는 위험 |
| T3 | HashiCorp, *terraform plan* | https://developer.hashicorp.com/terraform/cli/commands/plan | 저장한 계획(`-out`)을 검토 뒤 그대로 apply |
| T4 | HashiCorp, *Import* | https://developer.hashicorp.com/terraform/language/import | `import` 블록으로 기존 리소스를 코드에 남긴다 |
| T5 | HashiCorp, *Version constraints* | https://developer.hashicorp.com/terraform/language/expressions/version-constraints | 코어 · 프로바이더 · 모듈 버전 제약 · 잠금 파일 |
| T6 | OpenTofu, *Documentation* | https://opentofu.org/docs/ | Terraform 과 같은 언어 · state 규칙 (위 원칙이 그대로 통한다) |
| A1 | Ansible, *Check mode and diff mode* | https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html | `--check --diff` 로 먼저 보기 · check 를 지원하지 않는 작업 |
| P1 | GitHub, *Security hardening for GitHub Actions* | https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions | 토큰 권한 최소 · 외부 액션은 커밋 SHA 로 고정 · 비밀 마스킹 · OIDC |
| P2 | GitLab, *CI/CD variables* | https://docs.gitlab.com/ci/variables/ | 마스킹 · 보호 변수 · 로그 노출 주의 |
| P3 | GitLab, *Deployment safety* | https://docs.gitlab.com/ci/environments/deployment_safety/ | 보호 환경 · 배포 승인 · 동시 배포 막기 · 오래된 배포 작업 막기 |
| G1 | The Twelve-Factor App, *Config* | https://12factor.net/config | 설정 · 비밀은 코드 밖(환경)에 |
| O1 | Docker, *Start containers automatically* | https://docs.docker.com/engine/containers/start-containers-automatically/ | 재시작 정책 · 손으로 멈춘 컨테이너는 정책이 살리지 않음 (`docker kill` 도 그렇게 동작함을 2026-11 Docker 29 에서 실측: 그래서 수명 시험은 호스트 PID 로 SIGKILL) |
| O2 | Docker, *Dockerfile reference: HEALTHCHECK* | https://docs.docker.com/reference/dockerfile/#healthcheck | interval · timeout · start period · retries 의 뜻 (유예 = start period + interval × retries) |
| O3 | Docker, *Compose services: init* · *docker compose config* | https://docs.docker.com/reference/compose-file/services/#init | `init: true` 로 PID 1 이 자식(좀비)을 거둔다 · `config --hash` 가 서비스 설정 해시를 낸다 (컨테이너 라벨 `com.docker.compose.config-hash` 와 같음을 실측) |
| O4 | Linux kernel, *Control Group v2* | https://docs.kernel.org/admin-guide/cgroup-v2.html | `memory.stat` 의 anon(익명 메모리) · file(page cache) · `pids.max` |
| O5 | Prometheus, *node_exporter textfile collector* · *Metric and label naming* | https://github.com/prometheus/node_exporter#textfile-collector | `.prom` 을 원자적으로(임시 파일 → mv) 쓴다 · 카운터는 `_total` 접미사 (https://prometheus.io/docs/practices/naming/) |

## 룰별 근거

| 룰 | 항목 | 근거 |
|---|---|---|
| 10-infra-safety | 환경 확정 · plan/diff 먼저 · 파괴적 작업 승인 | T3 · K5 · A1 · P3 |
| 10-infra-safety | 비밀은 출처만 · 버전 고정 | G1 · P1 · P2 · C1 · K1 · T5 |
| 20-containers | 베이스 · 다단계 · 캐시 · 비루트 · `.dockerignore` · 비밀 | C1 · C2 |
| 30-kubernetes | 선언형 · 리소스 · 프로브 · 보안 컨텍스트 · 이미지 · 차트 | K1 ~ K5 · H1 |
| 40-iac | 원격 state · 잠금 · plan 저장 · 버전 · import · Ansible check | T1 ~ T6 · A1 |
| 50-pipelines | 권한 최소 · 비밀 · 고정 · 승인 · 동시 실행 | P1 ~ P3 |
| 20-containers | 헬스체크 유예 · init · PIDS · compose 수명 시험 · 수명 경보(anon/file) · preflight | O1 ~ O5 |
