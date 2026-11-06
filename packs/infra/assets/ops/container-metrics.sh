#!/usr/bin/env bash
# 운영 수명 지표: 컨테이너별 재시작 · PIDS · 메모리 anon/file · 기동 시각 → node_exporter textfile collector (.prom)
#
# 메모리는 cgroup memory.stat 의 anon(힙 등 앱이 쥔 메모리)과 file(page cache)을 따로 낸다.
# working set 하나만 보면 page cache 증가와 누수를 구분하지 못한다: anon 이 늘면 누수 의심, file 만 늘면 page cache.
#
# 호스트 cron (1분마다, docker 를 부를 수 있는 계정):
#   * * * * * /opt/ops/container-metrics.sh 2>>/var/log/container-metrics.log
# node_exporter: --collector.textfile.directory=<TEXTFILE_DIR>
#
# 환경 변수 (기본값)
#   TEXTFILE_DIR=/var/lib/node_exporter/textfile_collector   .prom 을 쓸 폴더
#   PREFIX=__PREFIX__                 지표 이름 접두사 (경보 규칙 파일과 같아야 한다)
#   FILTER=label=com.docker.compose.project   docker ps --filter (compose 컨테이너만)
#   MEM_SOURCE=auto                   auto | host (호스트 /sys/fs/cgroup) | exec (컨테이너 안 cat, Docker Desktop 처럼 호스트 cgroup 이 안 보일 때)
#   CGROUP_ROOT=/sys/fs/cgroup
#   RECONNECT_DIR=""                  (선택) 앱이 외부 소켓 재연결 누적 횟수를 숫자 하나로 쓰는 폴더. 파일 이름 = 컨테이너 이름 또는 서비스 이름
#
# 지표 (라벨 container · service · project)
#   <접두사>_up · _restarts_total · _started_at_seconds · _healthy(healthcheck 있을 때) · _pids · _pids_limit(0 = 상한 없음)
#   _memory_anon_bytes · _memory_file_bytes · _socket_reconnects_total(RECONNECT_DIR 이 있을 때)
#   _metrics_errors(이번 실행에서 못 읽은 값 수) · _metrics_last_run_seconds · _metrics_containers
# 종료: 0 (지표 일부를 못 읽어도 _metrics_errors 로 알린다) · 1 쓸 폴더 문제

set -u
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile_collector}"
PREFIX="${PREFIX:-__PREFIX__}"
FILTER="${FILTER:-label=com.docker.compose.project}"
MEM_SOURCE="${MEM_SOURCE:-auto}"
CGROUP_ROOT="${CGROUP_ROOT:-/sys/fs/cgroup}"
RECONNECT_DIR="${RECONNECT_DIR:-}"

ERRORS=0
err() { echo "$(date '+%F %T') container-metrics: $*" >&2; ERRORS=$((ERRORS + 1)); }

[ -d "$TEXTFILE_DIR" ] && [ -w "$TEXTFILE_DIR" ] || { echo "✖ 쓸 수 없는 폴더: $TEXTFILE_DIR (TEXTFILE_DIR)" >&2; exit 1; }
OUT="$TEXTFILE_DIR/$PREFIX.prom"
TMP="$TEXTFILE_DIR/.$PREFIX.prom.$$"
trap 'rm -f "$TMP" "$TMP".*' EXIT

# ISO 시각 → epoch 초 (GNU date · BSD date)
to_epoch() {
  local s="${1%%.*}"; s="${s%Z}"
  date -u -d "${s}Z" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$s" +%s 2>/dev/null
}

# memory.stat 내용 → "anon file" (cgroup v2: anon/file, v1: total_rss/total_cache 또는 rss/cache)
mem_pick() {
  awk '$1=="anon"{a=$2} $1=="file"{f=$2} $1=="total_rss"{tr=$2} $1=="total_cache"{tc=$2} $1=="rss"{r=$2} $1=="cache"{c=$2}
       END { if (a=="") a=(tr!=""?tr:r); if (f=="") f=(tc!=""?tc:c); if (a!="" && f!="") print a, f }'
}
mem_host() {
  local id="$1" p
  for p in "$CGROUP_ROOT/system.slice/docker-$id.scope/memory.stat" "$CGROUP_ROOT/docker/$id/memory.stat" \
           "$CGROUP_ROOT/memory/docker/$id/memory.stat" "$CGROUP_ROOT/memory/system.slice/docker-$id.scope/memory.stat"; do
    [ -r "$p" ] && { mem_pick < "$p"; return; }
  done
}
mem_exec() {
  docker exec "$1" cat /sys/fs/cgroup/memory.stat 2>/dev/null | mem_pick && return
  docker exec "$1" cat /sys/fs/cgroup/memory/memory.stat 2>/dev/null | mem_pick
}

ids=$(docker ps -aq --no-trunc --filter "$FILTER" 2>/dev/null) || { err "docker ps 실패"; ids=""; }

# PIDS: 도는 컨테이너 전부를 한 번에
PIDS_ALL=""
running=$(docker ps -q --no-trunc --filter "$FILTER" 2>/dev/null)
[ -n "$running" ] && PIDS_ALL=$(docker stats --no-stream --no-trunc --format '{{.ID}} {{.PIDs}}' $running 2>/dev/null)

: > "$TMP"
while IFS='|' read -r k t h; do
  printf '# HELP %s_%s %s\n# TYPE %s_%s %s\n' "$PREFIX" "$k" "$h" "$PREFIX" "$k" "$t" > "$TMP.$k"
done <<'EOF'
up|gauge|1 = running
restarts_total|counter|Docker RestartCount (restart policy restarts since the container was created or started)
started_at_seconds|gauge|Container start time (unix seconds)
healthy|gauge|1 = healthy, 0 = unhealthy or starting (only with a healthcheck)
pids|gauge|Processes and threads in the container
pids_limit|gauge|pids_limit (0 = none)
memory_anon_bytes|gauge|cgroup memory.stat anon (v1 rss): memory held by the app
memory_file_bytes|gauge|cgroup memory.stat file (v1 cache): page cache, reclaimable
socket_reconnects_total|counter|External socket reconnects reported by the app (RECONNECT_DIR)
EOF

n=0
for id in $ids; do
  line=$(docker inspect -f '{{.Name}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{.State.Status}}|{{.RestartCount}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.HostConfig.PidsLimit}}' "$id" 2>/dev/null) \
    || { err "inspect 실패 $id"; continue; }
  IFS='|' read -r name svc proj status rc started health plimit <<EOF
$line
EOF
  name=${name#/}; n=$((n + 1))
  L="container=\"$name\",service=\"$svc\",project=\"$proj\""
  up=0; [ "$status" = running ] && up=1
  echo "${PREFIX}_up{$L} $up" >> "$TMP.up"
  echo "${PREFIX}_restarts_total{$L} $rc" >> "$TMP.restarts_total"
  if ts=$(to_epoch "$started") && [ -n "$ts" ]; then echo "${PREFIX}_started_at_seconds{$L} $ts" >> "$TMP.started_at_seconds"; else err "$name 기동 시각 변환 실패: $started"; fi
  case "$health" in healthy) echo "${PREFIX}_healthy{$L} 1" >> "$TMP.healthy" ;; unhealthy|starting) echo "${PREFIX}_healthy{$L} 0" >> "$TMP.healthy" ;; esac
  case "$plimit" in ''|'<nil>'|-1) plimit=0 ;; esac
  echo "${PREFIX}_pids_limit{$L} $plimit" >> "$TMP.pids_limit"
  [ "$up" = 1 ] || continue

  p=$(echo "$PIDS_ALL" | awk -v id="$id" '$1==id{print $2}')
  if [ -n "$p" ]; then echo "${PREFIX}_pids{$L} $p" >> "$TMP.pids"; else err "$name PIDS 못 읽음"; fi

  m=""
  case "$MEM_SOURCE" in
    host) m=$(mem_host "$id") ;;
    exec) m=$(mem_exec "$id") ;;
    *) m=$(mem_host "$id"); [ -n "$m" ] || m=$(mem_exec "$id") ;;
  esac
  if [ -n "$m" ]; then
    echo "${PREFIX}_memory_anon_bytes{$L} ${m% *}" >> "$TMP.memory_anon_bytes"
    echo "${PREFIX}_memory_file_bytes{$L} ${m#* }" >> "$TMP.memory_file_bytes"
  else err "$name memory.stat 못 읽음 (MEM_SOURCE=$MEM_SOURCE)"; fi

  if [ -n "$RECONNECT_DIR" ]; then
    for f in "$RECONNECT_DIR/$name" "$RECONNECT_DIR/$svc"; do
      [ -r "$f" ] || continue
      v=$(tr -dc '0-9' < "$f")
      if [ -n "$v" ]; then echo "${PREFIX}_socket_reconnects_total{$L} $v" >> "$TMP.socket_reconnects_total"; else err "$f 가 숫자가 아님"; fi
      break
    done
  fi
done

for k in up restarts_total started_at_seconds healthy pids pids_limit memory_anon_bytes memory_file_bytes socket_reconnects_total; do
  [ "$(wc -l < "$TMP.$k")" -gt 2 ] && cat "$TMP.$k" >> "$TMP"
done
{
  printf '# HELP %s_metrics_containers Containers seen in this run\n# TYPE %s_metrics_containers gauge\n%s_metrics_containers %s\n' "$PREFIX" "$PREFIX" "$PREFIX" "$n"
  printf '# HELP %s_metrics_errors Values this run could not read (see the cron log)\n# TYPE %s_metrics_errors gauge\n%s_metrics_errors %s\n' "$PREFIX" "$PREFIX" "$PREFIX" "$ERRORS"
  printf '# HELP %s_metrics_last_run_seconds Last run time (unix seconds)\n# TYPE %s_metrics_last_run_seconds gauge\n%s_metrics_last_run_seconds %s\n' "$PREFIX" "$PREFIX" "$PREFIX" "$(date +%s)"
} >> "$TMP"
chmod 644 "$TMP"
mv -f "$TMP" "$OUT"
exit 0
