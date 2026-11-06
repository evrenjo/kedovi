---
title: 컨테이너 이미지 · compose
load: on-demand
when: Dockerfile · Containerfile · compose 파일을 만들거나 고칠 때, 이미지 크기 · 빌드 시간 · 보안 지적을 다룰 때, compose 스택을 배포하거나 재시작 · 메모리 · PIDS 문제를 다룰 때
---

## 컨테이너 이미지 · compose

- **베이스 이미지**: 공식 · 신뢰할 수 있는 이미지를 버전 태그(가능하면 digest)로 고정한다. 작은 이미지(slim · distroless 등)를 쓰되 프로젝트 관례가 있으면 따른다.
- **다단계 빌드**: 빌드 도구는 빌드 단계에만 두고, 실행 이미지에는 결과물과 실행에 필요한 것만 복사한다.
- **캐시 순서**: 자주 바뀌지 않는 것(의존성 목록 · 설치)을 먼저, 소스 복사를 나중에. 패키지 설치와 캐시 정리는 한 `RUN` 에서.
- **비루트 실행**: `USER` 로 권한 없는 사용자를 지정한다.
- **`.dockerignore`**: `.git` · 빌드 산출물 · 로컬 설정 · 비밀 파일을 뺀다.
- **비밀값을 이미지에 넣지 않는다**: `ARG` · `ENV` 로 넘기면 이미지 기록에 남는다. 빌드 비밀은 빌드 도구의 비밀 마운트로, 실행 비밀은 실행 환경 변수 · 비밀 저장소로.
- **헬스체크**: 오케스트레이터가 따로 검사하지 않는 환경(compose 등)에서는 `HEALTHCHECK` 를 둔다. 의존 서비스는 `depends_on` 의 `condition: service_healthy` 로 기다린다.
- 실행 명령은 exec 형식(`["node", "server.js"]`)으로 써서 종료 신호가 앱에 가게 한다.
- 검증: 이미지를 빌드해 보고, 크기와 실행(헬스체크 통과)을 확인한다.
- **헬스체크 유예**: `start_period` 는 실측 기동 시간보다 길게. 유예(start_period + interval × retries)보다 기동이 길면 감시 도구가 기동 중에 죽이는 재시작 루프가 된다. 자식 프로세스를 만드는 앱은 `init: true`(또는 tini)로 좀비를 거둔다. `pids_limit` 을 둔다.

### compose 스택 수명 · 배포 전 확인

- **release 전에 수명 시험**: 서비스마다 restart 2회 · SIGKILL · stop/start 뒤 healthy 복귀, 재시작 루프 · PIDS · 좀비. 템플릿 `kedovi ops add lifecycle` (release 브랜치 CI job 포함, 개발 루프 대기 0).
- **운영 수명 경보는 메모리를 anon · file 로 나눠 낸다**: working set 하나로는 page cache 증가와 누수를 구분하지 못한다. anon 추세만 누수로 보고, 기동 직후(1시간)는 추세에서 뺀다. 재시작 수 · PIDS · 기동 시각을 함께. 템플릿 `kedovi ops add alerts`.
- **배포 · 수동 재시작 전에 preflight**: 재생성될 컨테이너 · 그때 사라지는 상태(메모리 세션 · 연결 · 볼륨 없는 데이터) · 도는 배치를 보이고, 위험하면 멈춘다. `kedovi ops preflight` (서버에서는 repo 에 넣은 `<ops 폴더>/preflight.sh`). 강제(`--force`)는 사용자가 위험을 보고 정한 뒤에만.
