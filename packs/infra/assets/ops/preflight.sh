#!/usr/bin/env bash
# 배포 전 확인 (preflight, compose 스택)
#
#   ② 이번 작업으로 바뀌는(재생성되는) 컨테이너: compose 설정 해시 라벨 비교 · 같은 태그의 새 이미지
#   ③ 그때 사라지는 상태: preflight.conf 의 STATES (서비스별 설명 · 수준)
#   ① 도는 배치: preflight.conf 의 BATCH_QUERY 결과. 분 주기 작업(MINUTE_JOBS)만 돌면 끝나는 틈을 WAIT_MAX 초까지 기다린다
#   위험하면 0 아닌 값으로 멈춘다. 강제: --force 또는 PREFLIGHT_FORCE=1
#
# 사용 (compose 파일이 있는 배포 폴더에서. pull · build 를 마친 뒤 up 직전에)
#   ops/preflight.sh [--force] [--conf 파일] [서비스...] [-- 통과하면 바로 실행할 명령]
#   예: ops/preflight.sh api -- docker compose up -d api      (틈을 기다린 직후 바로 배포해 틈을 놓치지 않는다)
#
# 설정: --conf · PREFLIGHT_CONF · 이 스크립트 옆 preflight.conf · ./ops/preflight.conf 순. 없으면 ②만 본다.
# 종료: 0 통과(또는 강제) · 1 위험해서 멈춤 · 2 사용법 · 설정 · 환경 오류. 통과 뒤 명령을 주면 그 명령의 종료 코드.
# docker CLI 만 쓴다 (jq 없음). bash 3.2 이상. 서버에 kedovi 이 없어도 이 파일 하나로 돈다.

set -u
FORCE="${PREFLIGHT_FORCE:-0}"
CONF="${PREFLIGHT_CONF:-}"
SERVICES=""
RUN=()
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --conf) CONF="${2:-}"; shift ;;
    --) shift; RUN=("$@"); break ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "✖ 모르는 옵션: $1"; exit 2 ;;
    *) SERVICES="$SERVICES $1" ;;
  esac
  shift
done

# 설정 기본값 (preflight.conf 가 덮는다)
COMPOSE="docker compose"
WAIT_MAX=90
POLL_SEC=2
PULL=0
BATCH_QUERY=""
BATCH_SERVICES=""
MINUTE_JOBS=""
STATES=""

here=$(cd "$(dirname "$0")" && pwd)
if [ -z "$CONF" ]; then
  for f in "$here/preflight.conf" "./ops/preflight.conf"; do [ -f "$f" ] && { CONF="$f"; break; }; done
fi
if [ -n "$CONF" ]; then
  [ -r "$CONF" ] || { echo "✖ 설정 파일이 없습니다: $CONF"; exit 2; }
  # shellcheck disable=SC1090
  . "$CONF" || { echo "✖ 설정 파일 오류: $CONF"; exit 2; }
fi

command -v docker >/dev/null 2>&1 || { echo "✖ docker 가 없습니다"; exit 2; }
$COMPOSE config -q 2>/dev/null || { echo "✖ '$COMPOSE config' 실패: compose 파일이 있는 폴더에서 실행합니다"; exit 2; }

[ -n "$SERVICES" ] || SERVICES=$($COMPOSE config --services)
SERVICES=$(echo $SERVICES)
echo "preflight: $(echo "$SERVICES" | wc -w | tr -d ' ')개 서비스 ($SERVICES)${CONF:+ · 설정 $CONF}"

if [ "$PULL" = 1 ]; then
  $COMPOSE pull -q $SERVICES >/dev/null 2>&1 || echo "  ⚠ pull 실패: 로컬 이미지로 비교한다"
fi

RISK=""            # 멈출 이유 (줄바꿈으로 나눔)
risk() { RISK="${RISK}${RISK:+
}$1"; }

# ② · ③ ────────────────────────────────────────────
HASHES=$($COMPOSE config --hash="*" 2>/dev/null)
state_of() { echo "$STATES" | awk -F'|' -v s="$1" '{ gsub(/^[ \t]+|[ \t]+$/, "", $1) } $1==s { print $2 "|" $3; exit }'; }
CHANGED=""
echo "② 이번 작업으로 바뀌는 컨테이너 · ③ 그때 사라지는 상태"
for svc in $SERVICES; do
  want=$(echo "$HASHES" | awk -v s="$svc" '$1==s{print $2}')
  [ -n "$want" ] || { echo "   $svc: compose 에 없는 서비스"; risk "$svc: compose 에 없음"; continue; }
  cids=$($COMPOSE ps -aq "$svc" 2>/dev/null)
  why=""
  if [ -z "$cids" ]; then
    echo "   $svc: 새로 만듦 (지금 컨테이너 없음)"; continue
  fi
  for c in $cids; do
    info=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}|{{.Image}}|{{.Config.Image}}|{{.State.Status}}' "$c" 2>/dev/null)
    have=$(echo "$info" | cut -d'|' -f1); img_id=$(echo "$info" | cut -d'|' -f2); img_ref=$(echo "$info" | cut -d'|' -f3); st=$(echo "$info" | cut -d'|' -f4)
    if [ "$have" != "$want" ]; then why="설정 변경"
    else
      new_id=$(docker image inspect -f '{{.Id}}' "$img_ref" 2>/dev/null)
      [ -n "$new_id" ] && [ "$new_id" != "$img_id" ] && why="이미지 변경: $img_ref"
    fi
    [ -z "$why" ] && [ "$st" != running ] && why="멈춰 있음 → 시작"
  done
  if [ -z "$why" ]; then echo "   $svc: 그대로"; continue; fi
  CHANGED="$CHANGED $svc"
  s=$(state_of "$svc")
  level=$(echo "${s%%|*}" | tr -d ' \t'); desc="${s#*|}"
  case "$level" in
    block) echo "   $svc: 재생성($why): $desc [멈춤]"; risk "$svc: $desc" ;;
    warn)  echo "   $svc: 재생성($why): $desc" ;;
    *)     echo "   $svc: 재생성($why): 사라지는 상태 설명 없음 (preflight.conf STATES 에 적는다)" ;;
  esac
done
[ -n "$CHANGED" ] || echo "   바뀌는 컨테이너 없음"

# ① ────────────────────────────────────────────────
batch_rows() { bash -c "$BATCH_QUERY" 2>/dev/null | sed '/^[[:space:]]*$/d'; }
is_minute() { [ -n "$MINUTE_JOBS" ] && echo "$1" | grep -Eq "$MINUTE_JOBS"; }

hits_batch=0
if [ -n "$CHANGED" ] && [ -n "$BATCH_QUERY" ]; then
  if [ -z "$BATCH_SERVICES" ]; then hits_batch=1
  else for s in $CHANGED; do case " $BATCH_SERVICES " in *" $s "*) hits_batch=1 ;; esac; done; fi
fi
if [ -z "$BATCH_QUERY" ]; then echo "① 도는 배치: 조회 명령 없음 (preflight.conf BATCH_QUERY)"
elif [ -z "$CHANGED" ]; then echo "① 도는 배치: 바뀌는 컨테이너가 없어 건너뜀"
elif [ "$hits_batch" = 0 ]; then echo "① 도는 배치: 재생성 대상에 배치 서비스($BATCH_SERVICES)가 없어 건너뜀"
else
  echo "① 도는 배치 (BATCH_QUERY)"
  if ! rows=$(set -o pipefail; bash -c "$BATCH_QUERY" 2>&1 | sed '/^[[:space:]]*$/d'); then
    echo "   조회 실패: $(echo "$rows" | head -1)"; risk "도는 배치를 확인하지 못함"
  elif [ -z "$rows" ]; then echo "   도는 배치 0"
  else
    only_minute=1
    while IFS='|' read -r id job status start _; do
      tag=""; if is_minute "$job"; then tag=" (분 주기)"; else only_minute=0; fi
      echo "   실행 $id · $job · $status · 시작 $start$tag"
    done <<EOF
$rows
EOF
    if [ "$only_minute" = 1 ]; then
      echo "   분 주기 작업만 돈다: 끝나는 틈을 최대 ${WAIT_MAX}초 기다린다"
      t0=$SECONDS; gap=0
      while [ $((SECONDS - t0)) -lt "$WAIT_MAX" ]; do
        sleep "$POLL_SEC"
        [ -z "$(batch_rows)" ] && { gap=1; break; }
      done
      if [ "$gap" = 1 ]; then echo "   틈: 도는 배치 0, 진행 ($((SECONDS - t0))초 기다림)"
      else echo "   ${WAIT_MAX}초 안에 틈이 없음"; risk "분 주기 배치가 ${WAIT_MAX}초 안에 끝나지 않음"; fi
    else
      risk "분 주기가 아닌 배치가 돈다 (끝난 뒤 다시)"
    fi
  fi
fi

# 판정 ─────────────────────────────────────────────
if [ -n "$RISK" ]; then
  if [ "$FORCE" = 1 ]; then
    echo "강제 진행 (--force · PREFLIGHT_FORCE=1). 위험:"; echo "$RISK" | sed 's/^/   /'
  else
    echo "멈춤:"; echo "$RISK" | sed 's/^/   /'
    echo "   그래도 진행: --force 또는 PREFLIGHT_FORCE=1"
    exit 1
  fi
else
  echo "통과"
fi

if [ ${#RUN[@]} -gt 0 ]; then
  echo "실행: ${RUN[*]}"
  exec "${RUN[@]}"
fi
exit 0
