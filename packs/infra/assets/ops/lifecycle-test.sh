#!/usr/bin/env bash
# release 수명 시험 (compose 스택)
#
#   서비스(컨테이너)마다: restart 2회 · SIGKILL(비정상 종료) · stop/start 뒤 healthy 복귀,
#   재시작 루프(지켜보는 동안 재시작 수 증가 · 기동이 healthcheck 유예보다 김) · PIDS 상한 · 좀비 프로세스.
#
# 사용 (compose 파일이 있는 폴더에서, 스택이 떠 있어야 한다: docker compose up -d --wait)
#   ops/lifecycle-test.sh [서비스...]          서비스를 안 주면 스택 전체
#
# 환경 변수 (기본값)
#   COMPOSE="docker compose"   compose 명령 (-f · -p 를 붙여도 된다)
#   HEALTH_TIMEOUT=180         healthy 복귀를 기다릴 최대 초
#   WATCH_SEC=60               마지막에 재시작 루프를 지켜볼 초
#   PIDS_PCT=80                PIDS 가 상한의 이 % 를 넘으면 실패
#   SKIP=""                    건너뛸 서비스 (빈칸으로 나눔)
#   ALLOW_NO_RESTART=0         1 이면 재시작 정책이 없는 서비스를 실패로 보지 않는다 (일회성 작업 등)
#   REQUIRE_PIDS_LIMIT=0       1 이면 PIDS 상한(pids_limit)이 없는 서비스를 실패로 본다 (기본은 경고)
#   STOP_TIMEOUT=30            restart · stop 이 SIGTERM 뒤 기다릴 초 (넘으면 SIGKILL, 종료 코드 137 경고)
#   HELPER_IMAGE=busybox:1.36  도우미 이미지: 호스트 PID 공간에서 주 프로세스 SIGKILL · 좀비 세기 (--pid=host 가 되는 Docker)
#
# 결과: 검사마다 한 줄. 종료 코드 0 통과 · 1 실패 있음 · 2 사용법 · 환경 오류
# docker CLI 만 쓴다 (jq 없음). bash 3.2 이상.

set -u
COMPOSE="${COMPOSE:-docker compose}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
WATCH_SEC="${WATCH_SEC:-60}"
PIDS_PCT="${PIDS_PCT:-80}"
SKIP="${SKIP:-}"
ALLOW_NO_RESTART="${ALLOW_NO_RESTART:-0}"
REQUIRE_PIDS_LIMIT="${REQUIRE_PIDS_LIMIT:-0}"
STOP_TIMEOUT="${STOP_TIMEOUT:-30}"
HELPER_IMAGE="${HELPER_IMAGE:-busybox:1.36}"

FAILS=0
WARNS=0
ok()   { echo "  ✔ $1: $2"; }
bad()  { echo "  ✖ $1: $2"; FAILS=$((FAILS + 1)); }
warn() { echo "  ⚠ $1: $2"; WARNS=$((WARNS + 1)); }

command -v docker >/dev/null 2>&1 || { echo "✖ docker 가 없습니다"; exit 2; }
$COMPOSE ps >/dev/null 2>&1 || { echo "✖ '$COMPOSE ps' 실패: compose 파일이 있는 폴더에서 실행합니다"; exit 2; }

# 상태 한 줄: 상태|health|재시작 수|기동 시각
state() {
  docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.RestartCount}}|{{.State.StartedAt}}' "$1" 2>/dev/null
}
field() { echo "$1" | cut -d'|' -f"$2"; }

# 준비될 때까지 기다린다: running 이고 healthy(healthcheck 없으면 running), 기동 시각이 $2 와 다름. 걸린 초를 찍는다
wait_ready() {
  local c="$1" prev="$2" t0=$SECONDS s
  while [ $((SECONDS - t0)) -lt "$HEALTH_TIMEOUT" ]; do
    s=$(state "$c")
    if [ "$(field "$s" 1)" = running ] && [ "$(field "$s" 4)" != "$prev" ]; then
      case "$(field "$s" 2)" in healthy|none) echo $((SECONDS - t0)); return 0 ;; esac
    fi
    sleep 1
  done
  echo $((SECONDS - t0))
  return 1
}

# 초(정수) ← 나노초
ns_to_s() { echo $(( ${1:-0} / 1000000000 )); }

# 컨테이너 프로세스의 좀비 자식 수. 좀비는 종료 순간 cgroup 에서 빠져 docker top 에 안 보이므로 호스트 /proc 를 본다
zombies() {
  local cpids
  cpids=$(docker top "$1" -o pid 2>/dev/null | awk 'NR>1{printf "%s ", $1}')
  [ -n "$cpids" ] || return 1
  docker run --rm --pid=host "$HELPER_IMAGE" sh -c 'n=0; for f in /proc/[0-9]*/stat; do l=$(cat "$f" 2>/dev/null) || continue; r=${l##*) }; set -- $r; [ "$1" = Z ] || continue; case " $0 " in *" $2 "*) n=$((n+1));; esac; done; echo $n' "$cpids" 2>/dev/null
}

services="$*"
[ -n "$services" ] || services=$($COMPOSE config --services 2>/dev/null)
[ -n "$services" ] || { echo "✖ 서비스가 없습니다"; exit 2; }

echo "release 수명 시험: $(echo $services | wc -w | tr -d ' ')개 서비스 · healthy 대기 최대 ${HEALTH_TIMEOUT}초 · 루프 관찰 ${WATCH_SEC}초"

WATCH_LIST=""
for svc in $services; do
  case " $SKIP " in *" $svc "*) echo "· $svc: 건너뜀 (SKIP)"; continue ;; esac
  cids=$($COMPOSE ps -aq "$svc" 2>/dev/null)
  if [ -z "$cids" ]; then echo "✖ $svc"; bad "컨테이너" "없음 (먼저 up)"; continue; fi
  for c in $cids; do
    name=$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')
    echo "▶ $svc ($name)"

    hc=$(docker inspect -f '{{if .Config.Healthcheck}}{{printf "%d" .Config.Healthcheck.Interval}}|{{.Config.Healthcheck.Retries}}|{{printf "%d" .Config.Healthcheck.StartPeriod}}{{end}}' "$c")
    policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c")
    rw=healthy
    [ -n "$hc" ] || { rw=running; warn "healthcheck" "없음: 준비 여부를 running 으로만 본다"; }

    # 0. 처음 상태
    if ! sec=$(wait_ready "$c" ""); then bad "처음 상태" "${sec}초 안에 healthy 아님"; continue; fi
    max_ready=$sec

    # 1. restart 2회
    for i in 1 2; do
      prev=$(field "$(state "$c")" 4)
      docker restart -t "$STOP_TIMEOUT" "$c" >/dev/null 2>&1
      if sec=$(wait_ready "$c" "$prev"); then ok "restart $i/2" "${rw} ${sec}초"; else bad "restart $i/2" "${sec}초 안에 healthy 복귀 못 함"; fi
      [ "$sec" -gt "$max_ready" ] && max_ready=$sec
    done

    # 2. SIGKILL (비정상 종료: 재시작 정책이 살려야 한다. docker kill 은 수동 정지라 정책이 돌지 않아 호스트 PID 로 죽인다)
    prev=$(field "$(state "$c")" 4)
    pid=$(docker inspect -f '{{.State.Pid}}' "$c")
    if [ "$policy" = "no" ] || [ -z "$policy" ]; then
      if [ "$ALLOW_NO_RESTART" = 1 ]; then warn "SIGKILL" "재시작 정책 없음 (ALLOW_NO_RESTART=1): 건너뜀"
      else bad "SIGKILL" "재시작 정책 없음: restart: unless-stopped 등을 둔다 (일회성이면 ALLOW_NO_RESTART=1)"; fi
    elif docker run --rm --pid=host "$HELPER_IMAGE" kill -9 "$pid" >/dev/null 2>&1; then
      if sec=$(wait_ready "$c" "$prev"); then ok "SIGKILL" "정책($policy)이 살림 · ${rw} ${sec}초"; else bad "SIGKILL" "${sec}초 안에 자동 복귀 못 함"; fi
      [ "$sec" -gt "$max_ready" ] && max_ready=$sec
    else
      warn "SIGKILL" "호스트 PID 공간에 못 들어감 (--pid=host 막힘): docker kill + start 로 대신"
      docker kill -s KILL "$c" >/dev/null 2>&1; docker start "$c" >/dev/null 2>&1
      if sec=$(wait_ready "$c" "$prev"); then ok "SIGKILL(대체)" "${rw} ${sec}초"; else bad "SIGKILL(대체)" "${sec}초 안에 복귀 못 함"; fi
    fi

    # 3. stop / start
    prev=$(field "$(state "$c")" 4)
    docker stop -t "$STOP_TIMEOUT" "$c" >/dev/null 2>&1
    code=$(docker inspect -f '{{.State.ExitCode}}' "$c")
    docker start "$c" >/dev/null 2>&1
    if sec=$(wait_ready "$c" "$prev"); then ok "stop/start" "${rw} ${sec}초 · 종료 코드 $code"; else bad "stop/start" "${sec}초 안에 healthy 복귀 못 함"; fi
    [ "$sec" -gt "$max_ready" ] && max_ready=$sec
    case "$code" in 0|143) ;; 137) warn "종료 신호" "stop 이 ${STOP_TIMEOUT}초 안에 안 끝나 강제 종료됨(137): SIGTERM 처리 · exec 형식 CMD 확인" ;; esac

    # 4. 기동 시간 ↔ healthcheck 유예: 유예보다 오래 걸리면 감시 도구(autoheal 등)가 기동 중에 죽이는 루프가 된다
    if [ -n "$hc" ]; then
      iv=$(ns_to_s "$(field "$hc" 1)"); rt=$(field "$hc" 2); sp=$(ns_to_s "$(field "$hc" 3)")
      [ "$iv" -gt 0 ] || iv=30; [ "${rt:-0}" -gt 0 ] || rt=3
      grace=$((sp + iv * rt))
      if [ "$max_ready" -gt "$grace" ]; then warn "기동 ↔ healthcheck" "기동 최대 ${max_ready}초 > 유예 ${grace}초 (start_period ${sp} + interval ${iv}×retries ${rt}): unhealthy 로 죽는 루프 위험, start_period 를 늘린다"
      else ok "기동 ↔ healthcheck" "기동 최대 ${max_ready}초 ≤ 유예 ${grace}초"; fi
    fi

    WATCH_LIST="$WATCH_LIST $svc:$c"
  done
done

# 5. 재시작 루프 · PIDS · 좀비: 모든 서비스를 한꺼번에 WATCH_SEC 동안 지켜본다
if [ -n "$WATCH_LIST" ]; then
  echo "▶ 재시작 루프 관찰 ${WATCH_SEC}초"
  before=""
  for e in $WATCH_LIST; do c=${e#*:}; s=$(state "$c"); before="$before $c=$(field "$s" 3)/$(field "$s" 4)"; done
  sleep "$WATCH_SEC"
  for e in $WATCH_LIST; do
    svc=${e%%:*}; c=${e#*:}
    name=$(docker inspect -f '{{.Name}}' "$c" | sed 's#^/##')
    s=$(state "$c"); was=$(echo "$before" | tr ' ' '\n' | grep "^$c=" | cut -d= -f2)
    now="$(field "$s" 3)/$(field "$s" 4)"
    if [ "$was" != "$now" ]; then bad "$name 루프" "관찰 중 재시작됨 (재시작 수 ${was%%/*} → $(field "$s" 3)): 재시작 루프"
    elif [ "$(field "$s" 2)" = unhealthy ]; then bad "$name 루프" "unhealthy (healthcheck 가 죽이는 루프의 시작)"
    else ok "$name 루프" "재시작 없음 · $(field "$s" 1)/$(field "$s" 2)"; fi

    # PIDS
    pids=$(docker stats --no-stream --format '{{.PIDs}}' "$c" 2>/dev/null)
    limit=$(docker inspect -f '{{.HostConfig.PidsLimit}}' "$c")
    case "$limit" in ''|'<nil>'|0|-1)
      if [ "$REQUIRE_PIDS_LIMIT" = 1 ]; then bad "$name PIDS" "${pids:-?}개 · 상한 없음 (pids_limit 을 둔다)"
      else warn "$name PIDS" "${pids:-?}개 · 상한 없음 (pids_limit 권장)"; fi ;;
    *)
      if [ -n "$pids" ] && [ $((pids * 100)) -ge $((limit * PIDS_PCT)) ]; then bad "$name PIDS" "${pids}/${limit} (${PIDS_PCT}% 이상)"
      else ok "$name PIDS" "${pids:-?}/${limit}"; fi ;;
    esac

    # 좀비
    z=$(zombies "$c")
    if [ -z "$z" ]; then warn "$name 좀비" "확인 못 함 (docker top · --pid=host 도우미 실패)"
    elif [ "$z" -gt 0 ]; then bad "$name 좀비" "${z}개: 주 프로세스가 자식을 거두지 않는다 (init: true 또는 tini)"
    else ok "$name 좀비" "0"; fi
  done
fi

echo "결과: 실패 ${FAILS} · 경고 ${WARNS}"
[ "$FAILS" -eq 0 ] || exit 1
exit 0
