#!/usr/bin/env node
/**
 * kedovi — AI 협업 워크스페이스 명령 (전역 설치: npm i -g kedovi)
 *
 *   kedovi init [프로젝트명]    선택 화면으로 새 워크스페이스를 만든다 (clone 한 repo 안이면 그 자리에, 아니면 ./<이름> 에)
 *   kedovi init-docs [폴더]     기획자 repo 뼈대를 만든다
 *   kedovi install              repos/ clone + git 훅 + 생성 + 이 워크스페이스의 메인 에이전트 선택
 *   kedovi start [--claude|--codex] [--no-brief] [--no-channel] [--pixel-agents] [-- 에이전트 인자]   설정한 에이전트로 작업 시작. 첫 메시지로 브리핑(마지막 핸드오프 · 미완 작업 · TODO · 공지)
 *   kedovi start -c | -r [세션 ID]   지난 대화 이어서: -c 마지막 대화 · -r <ID> 그 세션(/exit 때 나온 ID) · -r 목록에서 고르기 (Claude · Codex 같은 옵션)
 *   kedovi agent                연결 방식·내 모델 프로필을 다시 고른다 (시작 도구는 연결 방식으로 정해진다)
 *   kedovi ai [show | direct <claude,codex> | plan claude|gpt <요금제> | gateway [--url <주소> --key-env <변수>] | refresh | compose mix|vendor|single | main claude|codex] [--team]
 *                              AI 연결 방식 (서비스 직접 · 게이트웨이) · 쓰는 AI · 역할 구성
 *   kedovi detect               코드 repo 의 기술 스택을 다시 감지하고 고친다 (repo 별 규칙이 바뀐다)
 *   kedovi rules [list | off <ID…> | on <ID…>] [--repo <이름,…>]   킷이 넣은 규칙을 켜고 끈다 (필수 규칙 제외, --repo 는 그 repo 만). 바꾸기는 project 팩의 replaces (repos: 면 그 repo 만)
 *   kedovi rules ondemand|always <ID…|repo-tasks>   상시 규칙을 필요할 때만 읽게 (AGENTS.md 를 줄인다) · 되돌리기
 *   kedovi repo add [주소|폴더|이름] [--kind …] [--group <그룹>]   repo 를 더한다 (이름만 주면 repos/<이름> 에 원격 없이 새로 만든다, legacy 제외. --group 이면 repos/<그룹>/<이름>)
 *   kedovi repo move <이름> --group <그룹>|--no-group   repo 를 그룹 폴더로 옮긴다: 폴더 · workspace.json · 문서의 경로를 고치고 sync
 *   kedovi repo remove <이름> [--delete]   repo 를 뺀다: workspace.json · 리뷰 대상에서 지우고 sync, 이름이 남은 문서를 알린다. 폴더는 --delete 일 때만 (커밋 안 한 변경 · push 안 한 커밋이 있으면 거부)
 *   kedovi repo guides [<이름> follow|kit|ignore] [--rescan [<이름>]]   repo 안에 원래 있던 AI 지침(CLAUDE.md · AGENTS.md · 룰 · 스킬 등) 보기 · 따르는 방식 정하기 (follow = repo 지침 우선, 기본 · kit = 킷 규칙 우선 · ignore = 무시) · 다시 훑기
 *   kedovi team [id] [--take 1,2|all]   팀 현황 (모두의 핸드오프) · 한 사람 자세히 · 그 사람 TODO 항목을 내 TODO 로 인수
 *   kedovi team add|remove <id…> · members · restrict on|off   팀 명단 (workspace.json team) · 명단 밖 사람의 kedovi start 막기
 *   kedovi team edit allow|deny · admins [id…]   팀원 설정 수정 허용·불가 (불가면 팀장만 workspace.json·팩을 바꾼다)
 *   kedovi team lead add|remove <username> [--nick 이름] · leads   팀장 (모든 repo · 설정을 고친다)
 *   kedovi team add <username> [--nick 이름] [--repos a,b] · repos <username> <a,b|-> · nick <username> <이름>   팀원 · 담당 repo (담당 밖 repo 는 훅 · 커밋 검사가 막는다) · 부를 이름
 *   kedovi team whoami [--refresh]   이 PC 사용자 (저장소 계정 username · nickname · 팀장/팀원 · 담당 repo)
 *   kedovi detect --hint <스택> --contains <정규식>   사내 라이브러리를 거쳐 쓰는 스택의 감지 힌트를 더한다
 *   kedovi models [--migrate | --json]   모델 프로필·역할별·교차 검토 모델을 바꾼다 (화면 없이 실행하면 표, --json 은 JSON) / 퇴역 모델을 대체 모델로 일괄 교체
 *   kedovi models profile <이름> [--team] · set <역할> <도구> <모델> [--team] [--effort e]   화면 없이 (AI 가 대신 실행). 내 프로필은 팀보다 낮은 것만
 *   kedovi models allow-higher on|off   팀원이 팀보다 높은 프로필을 고를 수 있게 (팀, 팀장)
 *   kedovi agent --claude|--codex [--args "<인자>"]   화면 없이 메인 에이전트
 *   kedovi list                 이 PC 에서 만들거나 쓴 워크스페이스 목록
 *   kedovi reset [항목,… | --all] [--yes]   이 PC 의 개인 설정을 처음 상태로 (이 PC 설정 · 텔레그램 채널 · 임시 기록 · 개인 지침 · 토큰 중 고른다). 팀 설정 · repos 는 그대로
 *   kedovi remove [이름] [--force]   워크스페이스를 비운다: 그 루트에서 실행하거나 이름으로 (kedovi list). repos/ 포함
 *   kedovi notify setup         알림 설정 화면: 개인 봇 · 자동 알림 · 양방향 대화 · 질문 방식 · 진행 현황 · 팀 방 · 시험 발송을 한 곳에서
 *   kedovi notify [status]      텔레그램 알림 상태
 *   kedovi notify my level all|decisions|progress|off · away on|off · remote done|quiet|send · desk <초>|off · voice on|off|scope|name|test · setup [--new] · on [--min <초>] · off · reset · test   개인 알림 (이 PC). 봇 토큰은 숨김 입력
 *   kedovi notify my channel on [--new]|off|status   양방향 텔레그램 (기본 꺼짐, 프로젝트마다 전용 봇 · Claude Code). 켜면 kedovi start 가 --channels 를 붙인다
 *   kedovi notify team setup [--new] · chat <그룹방 ID|off> · announce "<내용>" · test   팀 방 알림 (chat 은 팀 설정)
 *   kedovi handoff find <티켓·기능> [--all] [--id <id>] · check · index · archive [--weeks N] · organize   핸드오프 기록 찾기·검사·보관
 *   kedovi plan [--short | --json | --stage <번호>] · init · check   로드맵(handoffs/PLAN.md): 단계 흐름 · 지금 단계 표 · 이번에 생긴 것 · 다음
 *   kedovi docs build [repo|폴더] [--out docs-site] [--force] [--no-source] · check [repo|폴더]   문서 사이트: 기획 repo 의 md · 화면설계서 장 → docs-site/ (가이드와 같은 화면 틀 · 근거 색인 ids.json · 묶음은 docs-site.json) · 어긋남 검사 · 문서 점검 경고
 *   kedovi docs show <ID> [--in <파일 조각>] [--all] · refs <ID> [--docs]   기획 문서를 ID 단위로: 정의 부분만 출력 · 그 ID 가 나오는 곳(기획 · 코드 · 이슈 repo, 파일:줄)
 *   kedovi docs refs-quote <md 파일…> [--dry]   본문 괄호 속 근거(파일:줄)를 그 문단 · 목록 · 표 아래 「> 근거:」 인용구로 옮긴다
 *   kedovi docs trace [--ids FN] [--all] [--strict] [--md] [--new]   기획 ID 와 코드의 @spec 주석 대조: 코드에 없는 ID · 테스트에 없는 수용 기준 · 기획에 정의 없는 ID. --md 추적표 · --new 새 진입 파일 중 ID 없는 것 (커밋 전)
 *   kedovi docs pages [on|off] [repo|폴더]   문서 사이트를 Pages 로 올리기 켜고 끄기 · 상태 (원격에 맞는 CI 파일 · .gitignore 의 /docs-site/)
 *   kedovi docs serve [repo|폴더] [--port 8000] [--open]   docs-site/ 를 이 PC 에서 웹 주소로 보기 (전체 인쇄 · 새로고침 없는 이동까지. Ctrl+C 로 끝)
 *   kedovi delegate list · status [<id>] · watch [<id>]   다른 도구에 맡긴 작업(위임: Claude Code ↔ Codex 리뷰 등): 목록 · 지금 진행 현황 · 상대 에이전트가 읽고 실행하는 것을 줄마다 보기 (id 를 빼면 마지막 실행 중 작업)
 *   kedovi debate list · watch [<id>] [--once] · status [<id>] · models [--task code|design|docs]   토론 모드(여러 모델이 따로 보고 서로 반박): 목록 · 모델별 주장 · 판정을 실시간으로 보기(--once = 지금까지만, 채팅용) · 지금 회차와 모델별 상태 · 이 PC 에서 쓸 수 있는 모델과 패널 예시. 시작은 채팅에서 "토론해줘" (debate 스킬)
 *   kedovi board [--no-open] [--no-fetch]   워크스페이스 현황판: 로드맵 · 팀원별 마지막 핸드오프 · 미완 작업 · 공지 + 기록 쪽 (.agents/board/, 이 PC 만 · 보기 전용)
 *   kedovi screens check [repo|폴더]   화면설계서 검사: 근거 ID 가 색인에 있는지 · 화면 ID 중복 · 기능 ID 누락 (screens 팩)
 *   kedovi screens compare <화면 ID> [--proto 파일|주소] [--impl 주소|/경로] [--widths 1280,390] [--storage 상태.json] [--find]   프로토타입과 구현 화면을 같은 폭(PC · 폰)으로 찍어 나란히 보는 compare.html (screens 팩, Playwright). 구현 주소는 @spec 줄의 @route
 *   kedovi datamodel check [repo|폴더]   데이터 설계 검사: 참조 · 기본키 · 중복 · 표 형식 · 컨벤션 · 기능 ID 대조 (datamodel 팩)
 *   kedovi secret set <이름> [--global] · list [--all] · test <이름> · rm <이름> [--global] · import [--global|--project] · exec [--only A,B] -- <명령>   비밀값(토큰): OS 저장소(키체인 · 자격 증명 팀장 · libsecret)에 프로젝트별 · 전역으로. 값은 숨김 입력, 어디에도 출력하지 않는다
 *   kedovi gitlab pipeline [--repo R] [--ref 브랜치 | --mr 번호 | --id ID] [--limit N] [--log [줄 수]] [--json]   GitLab 파이프라인 조회 (gitlab 팩, 읽기만): 최근 목록 · 단계별 작업 상태 · 실패한 작업의 로그 끝부분. MR 은 머지 커밋의 파이프라인도 찾는다
 *   kedovi gitlab wait [--repo R] --mr 번호 | --id ID | --ref 브랜치 [--sha 커밋] [--timeout 분] [--json]   파이프라인이 끝날 때까지 대기: 지금 커밋(MR 머리 · 머지 커밋 · 브랜치 머리)의 파이프라인이 생길 때까지 먼저 기다린다. 성공 0 · 실패 1 · 수동 작업에서 멈추면 0
 *   kedovi gitlab merge <MR 번호> [--repo R] --yes [--json]   MR 머지: 충돌 · 초안 · 토론 · 승인 확인, 도는 파이프라인은 끝날 때까지 기다린 뒤 머지, 머지 커밋 SHA. vars.gitlab.agentMerge 가 true 이거나 사람이 터미널에서 칠 때만
 *   kedovi gitlab create --repo R --source S [--target T] --title … --description-file F [--json]   MR 생성: 같은 source→target 의 열린 MR 이 있으면 그것을 쓴다
 *   kedovi gitlab play --id ID --job 작업 --yes · retry --id ID [--job 작업] --yes · cancel --ref 브랜치 [--sha 커밋] --yes   수동 작업 실행 · 실패한 작업 다시 실행 · 도는 파이프라인 취소 (취소는 agentMerge 를 켰을 때만). --yes 없으면 확인 문구만
 *   kedovi prefs [language ko|en|team · style learn|normal|expert|team] [--team] · mermaid [install] · setup   응답 언어 · 대화 스타일(학습 · 일반 · 전문가) · 그림 미리보기(claude-mermaid). 이 PC 값이 팀 값보다 먼저. 인자 없이 = 지금 값
 *   kedovi timestamp [on|off|team] [--team]   답변 첫 줄에 요청 받은 시각(yyyy-MM-dd HH:mm:ss) 표시 (Claude Code, 기본 켜짐). 이 PC 값이 팀 값보다 먼저, team = 이 PC 값 지우기. 인자 없이 = 지금 값
 *   kedovi type [유형] [--approach a] [--code 이름,…]   유형 바꾸기: 분석·설계 → 구축 · 고도화 등. 유형 팩 · 현행 repo 중 고칠 것(개발 repo 로) · 진행 방식 · 로드맵 새 뼈대 (팀장)
 *   kedovi approach [sprint|full|issue]   진행 방식: MVP · 스프린트(최소 기능부터, 스프린트마다 데모하며 하나씩) · 워터폴 · 전체(전체 설계 뒤 구축) · 이슈형(운영 · 유지보수, 이슈 보드). 바꾸면 로드맵도 맞춘다 (팀장)
 *   kedovi team-mode [auto|fixed] · prefer <역할> <claude|codex>:<모델>|- · [--team]   팀 구성: 자동(리더가 작업마다 역할·모델, 요금제 여유도 반영) · 고정(프로필대로), 역할별 선호 모델. --team 은 팀 기본값(팀장)
 *   kedovi review status · mark [--repo R] [--by "<누가>"] · skip --reason "<사유>" [--repo R]   리뷰 확인(commit · push 전에 리뷰를 거쳤나): 대상 repo 마다 리뷰 안 된 줄 수 · 지금 상태를 리뷰했다고 기록 · 한 번 생략(사용자 승인 뒤). 켜기는 team-mode enforce review
 *   kedovi team-mode enforce review off|warn|block [--repos a,b|*] [--min-lines N] [--paths p1,p2] [--team]   commit · push 전 리뷰 확인 (기본 꺼짐. Claude Code). 대상 · 기준 줄 수 · 경로는 팀 값(--team)
 *   kedovi import <폴더> [--json]   기존 AI 작업 폴더 훑기 (읽기만): 지침 · 룰 · 스킬 · 메모 · 핸드오프 · 스크립트 · 큰 폴더 분류, 문서 속 절대경로, 비밀값 의심 줄(값은 가림). 옮기기는 채팅에서 import 스킬로 (계획 → 승인 → 반영)
 *   kedovi tidy [--new] [--repo <이름>] [--count] [--json]   정리 후보 찾기 (읽기만): 이번 작업 새 파일 · 안 쓰는 이미지 · 문서 · 링크 없는 문서 · 백업 이름, 코드는 프로젝트 도구 안내. 지우기는 채팅에서 tidy 스킬로 (승인 뒤)
 *   kedovi team-mode enforce run off|warn|block [--after 분] [--team]   오래 일하는 팀원 · 위임 (Claude Code 팀원 · delegate.js): 경과가 상한(기본 60분, 팀 값)을 넘으면 계속할지 사용자에게 묻게 한다. block(기본) 멈출 때 한 번 막기 · warn 요청 시작 때 한 줄 · off. 같은 대상은 상한만큼 지나 다시
 *   kedovi team-mode enforce check off|warn|block [--team]   리뷰 전 검사: 리뷰를 맡기는 지시서(delegate.js 리뷰 역할 · Claude 리뷰 에이전트)에 「검사: <명령> 통과」 줄이 없으면 막는다 (기본). 검사가 없는 변경은 「검사: 없음 (사유)」
 *   kedovi team-mode enforce plan off|warn|block [--team]   착수 전 확인 (Claude Code): 요청마다 코드 repo 첫 수정(Edit · Write) 전에 답변에 「착수 전 확인:」 머리말이 없으면 알린다. warn(기본) 요청마다 한 번 · block 머리말을 보일 때까지 수정을 막는다. 문서 · 스타일 두 줄 이하는 제외
 *   kedovi team-mode enforce ask off|block [--team]   결정 질문 점검 (Claude Code): 결정 질문(번호 선택지 2개 이상)을 질문 창 없이 글로 끝내면 한 번 막고 질문 창으로 다시 묻게 한다 (기본). 자리 비움 세션은 제외
 *   kedovi team-mode enforce status off|block [--team]   상태 줄 점검 (Claude Code): 팀원(일하는 중 · 대기)이나 리더의 백그라운드 작업이 남은 채 멈추는데 답변에 「지금 도는 것: … · 예상 종료: … · 사용자가 할 일: …」 줄이 없으면 한 번 막는다 (기본)
 *   kedovi team-mode enforce idle off|warn|block [--after 분] [--remind 분] [--team]   대기 팀원 점검 (Claude Code agent teams): 일을 마치고 대기로 오래 남은 팀원을 리더에게 알린다. block(기본) 멈출 때 한 번 막기 · warn 요청 시작 때 한 줄 · off. 대기 상한(기본 10분) · 다시 알리는 간격(기본 30분)은 팀 값(--team)
 *   kedovi team-mode enforce name off|warn|block · roster off|warn [--team]   훅 강제 수준. name: 팀 모드(Claude Code agent teams)에서 역할 에이전트를 이름 없이 띄우면 막기(기본) · 경고 · 끄기. roster: 한 요청의 첫 역할 에이전트 때 실행 방식 · 구성표를 알렸는지 한 줄(기본) · 끄기. 이 PC 값은 팀 값보다 세게만
 *   kedovi sync | check | doctor | packs   생성물 다시 만들기 · 생성물 검사 · 환경 진단 · 팩 목록
 *   kedovi upgrade [--add 팩]   이 킷 버전으로 워크스페이스의 bin·팩을 갱신
 *   kedovi upgrade --all [--scan <폴더>] [--yes]   이 PC 의 워크스페이스(kedovi list)를 설치된 킷 버전으로 한꺼번에 올린다. 팀장 아님 · 원격에 받지 않은 커밋 · 커밋 안 한 변경이 있으면 건너뛴다. --scan 은 폴더 아래 워크스페이스를 찾아 목록에 더한다
 *   kedovi help [번호|명령|--all]   명령 도움말: 인자 없이 = 자주 쓰는 명령 · 분류 목록 (터미널이면 분류를 골라 보기) · 번호 = 그 분류의 명령 · --all = 전체
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const kit = require('./kit.js');
const gateway = require('./gateway.js');

let clackMod;
const clack = () => (clackMod = clackMod || require('@clack/prompts'));
// p.log 등을 어디서 먼저 쓰든 화면 라이브러리를 불러온다 (늦게 불러오기 때문에 생기던 "undefined (reading 'log')" 방지)
const p = new Proxy({}, { get: (_, k) => clack()[k] });

const BACK = Symbol('kedovi:back');

/** Ctrl+C 로 끝낼 때 덧붙일 안내 — 워크스페이스를 만든 뒤에는 무엇이 남았는지 알린다 */
let abortNote = '';

/** 프롬프트 실행 — Esc 면 BACK(이전 질문·건너뛰기), Ctrl+C 면 어디서든 즉시 전체 취소 */
async function runPrompt(pr) {
  pr.on('key', (_, key) => { if (key && key.name === 'escape') pr.__back = true; });
  const v = await pr.prompt();
  if (clack().isCancel(v) && !pr.__back) {
    p.cancel(abortNote ? `취소했습니다. ${abortNote}` : '취소했습니다');
    process.exit(130);
  }
  return clack().isCancel(v) ? BACK : v;
}
/** 취소·뒤로 줄 — 뒤로면 흐리게 안내, 취소면 취소선 */
function endLine(pr, st, bar, text) {
  const { styleText } = require('util');
  if (pr.__back) return `${bar}  ${styleText('dim', '← 이전 질문으로')}`;
  return `${bar}  ${styleText(['strikethrough', 'dim'], text)}\n${bar}`;
}

/**
 * 입력칸 — 제목(굵게) · 안내(회색, 세로선 포함) · "> 입력값" 줄. clack 기본 text 는 안내 줄에 세로선을 못 그려 직접 그린다.
 * 상태별 색은 clack 과 같다: 입력 중 cyan · 오류 yellow · 제출 후 gray.
 */
async function input({ message, hint, placeholder, initialValue, validate, secret }) {
  const { TextPrompt } = require('@clack/core');
  const { styleText } = require('util');
  const pr = clack();
  const tp = new TextPrompt({
    placeholder, initialValue, validate,
    render() {
      const st = this.state;
      const color = barColor(st);
      const bar = styleText(color, pr.S_BAR);
      const head = frame(pr, st, message, hint, bar);
      const guide = '';
      const ph = placeholder ? styleText('inverse', placeholder[0]) + styleText('dim', placeholder.slice(1)) : styleText(['inverse', 'hidden'], '_');
      const typed = this.userInput ? (secret ? `${'•'.repeat(this.userInput.length)}${styleText(['inverse', 'hidden'], '_')}` : this.userInputWithCursor) : ph;
      const value = secret && this.value ? '•'.repeat(8) : this.value || '';
      if (st === 'submit') return `${head}${bar}  ${styleText('dim', value ? `> ${value}` : '> (비움)')}`;
      if (st === 'cancel') return `${head}${endLine(this, st, bar, `> ${value}`)}`;
      const prompt = `${styleText(color, '>')} ${typed}`;
      if (st === 'error') return `${head}${guide}${bar}  ${prompt}\n${styleText('yellow', pr.S_BAR_END)}  ${styleText('yellow', this.error)}\n`;
      return `${head}${guide}${bar}  ${prompt}\n${bar}  ${styleText('gray', 'Enter 확정 · Esc 뒤로')}\n${styleText('cyan', pr.S_BAR_END)}\n`;
    },
  });
  return runPrompt(tp);
}

/** 터미널 표시 폭 — 한글·전각은 2칸 */
const width = (t) => [...String(t)].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const padTo = (t, n) => t + ' '.repeat(Math.max(0, n - width(t)));

/** 입력칸 공통 머리 — 빈 세로선 · 상태 기호 + 굵은 제목 · (회색 안내) */
let PROGRESS = ''; // "3/9" 처럼 질문 뒤에 붙는 진행 표시 (init · install · agent 가 단계마다 넣는다)
let PROGRESS_FIRST = null; // [진행 표시, 그 단계의 첫 화면 제목]: 한 단계 안의 다음 화면(새 repo 이름 · 확정 등)은 「이어서」 로 (같은 번호가 되풀이돼 보이지 않게)
function frame(pr, st, message, hint, bar) {
  const { styleText } = require('util');
  let tag = PROGRESS;
  if (PROGRESS) {
    if (!PROGRESS_FIRST || PROGRESS_FIRST[0] !== PROGRESS) PROGRESS_FIRST = [PROGRESS, message];
    else if (PROGRESS_FIRST[1] !== message) tag = `${PROGRESS} 이어서`;
  }
  const title = tag ? `${styleText('bold', message)} ${styleText('gray', `(${tag})`)}` : styleText('bold', message);
  const head = `${styleText('gray', pr.S_BAR)}\n${pr.symbol(st)}  ${title}\n`;
  const guide = hint && st !== 'submit' && st !== 'cancel' ? `${bar}  ${styleText('gray', hint)}\n` : '';
  return head + guide;
}
const barColor = (st) => (st === 'error' ? 'yellow' : st === 'submit' || st === 'cancel' ? 'gray' : 'cyan');

/** 선택(하나) — 옵션마다 회색 설명을 같은 열에 맞춰 늘 보여 준다 */
async function choose({ message, hint, options, initialValue }) {
  const { SelectPrompt } = require('@clack/core');
  const { styleText } = require('util');
  const pr = clack();
  const col = Math.max(...options.map((o) => width(o.label))) + 3;
  return runPrompt(new SelectPrompt({
    options, initialValue,
    render() {
      const st = this.state;
      const bar = styleText(barColor(st), pr.S_BAR);
      const top = frame(pr, st, message, hint, bar);
      const cur = this.options[this.cursor];
      if (st === 'submit') return `${top}${bar}  ${styleText('dim', `> ${cur.label}`)}`;
      if (st === 'cancel') return `${top}${endLine(this, st, bar, `> ${cur.label}`)}`;
      const rows = this.options.map((o, i) => {
        const on = i === this.cursor;
        const mark = on ? styleText('cyan', '●') : styleText('dim', '○');
        const label = on ? padTo(o.label, col) : styleText('dim', padTo(o.label, col));
        return `${bar}  ${mark} ${label}${o.hint ? styleText('gray', o.hint) : ''}`;
      });
      const detail = cur.detail && cur.detail.length ? `${bar}\n${cur.detail.map((l) => `${bar}  ${styleText('gray', l)}`).join('\n')}\n` : '';
      return `${top}${rows.join('\n')}\n${detail}${bar}  ${styleText('gray', '↑/↓ 이동 · Enter 확정 · Esc 뒤로')}\n${styleText('cyan', pr.S_BAR_END)}\n`;
    },
  }));
}

/** 선택(여러 개) — Space 토글 */
async function chooseMany({ message, hint, options, initialValues = [] }) {
  const { MultiSelectPrompt } = require('@clack/core');
  const { styleText } = require('util');
  const pr = clack();
  const col = Math.max(...options.map((o) => width(o.label))) + 3;
  return runPrompt(new MultiSelectPrompt({
    options, initialValues, required: false,
    render() {
      const st = this.state;
      const bar = styleText(barColor(st), pr.S_BAR);
      const top = frame(pr, st, message, hint, bar);
      const picked = this.options.filter((o) => (this.value || []).includes(o.value)).map((o) => o.label);
      if (st === 'submit') return `${top}${bar}  ${styleText('dim', `> ${picked.length ? picked.join(', ') : '(없음)'}`)}`;
      if (st === 'cancel') return `${top}${endLine(this, st, bar, '> 취소')}`;
      const rows = this.options.map((o, i) => {
        const on = (this.value || []).includes(o.value);
        const here = i === this.cursor;
        const box = on ? styleText('green', '◼') : here ? styleText('cyan', '◻') : styleText('dim', '◻');
        // 커서 줄: 앞에 › 와 굵은 청록 글자 (모두 켜져 있어도 어디인지 보이게)
        const label = here ? styleText('bold', styleText('cyan', padTo(o.label, col))) : styleText(on ? 'reset' : 'dim', padTo(o.label, col));
        const pointer = here ? styleText('cyan', '›') : ' ';
        return `${bar} ${pointer}${box} ${label}${o.hint ? styleText(here ? 'cyan' : 'gray', o.hint) : ''}`;
      });
      return `${top}${rows.join('\n')}\n${bar}  ${styleText('gray', '↑/↓ 이동 · Space 선택 · Enter 확정 · Esc 뒤로')}\n${styleText('cyan', pr.S_BAR_END)}\n`;
    },
  }));
}

/** 예/아니오 */
async function yesNo({ message, hint, initialValue = true }) {
  const { ConfirmPrompt } = require('@clack/core');
  const { styleText } = require('util');
  const pr = clack();
  return runPrompt(new ConfirmPrompt({
    active: '예', inactive: '아니오', initialValue,
    render() {
      const st = this.state;
      const bar = styleText(barColor(st), pr.S_BAR);
      const top = frame(pr, st, message, hint, bar);
      if (st === 'submit') return `${top}${bar}  ${styleText('dim', `> ${this.value ? '예' : '아니오'}`)}`;
      if (st === 'cancel') return `${top}${endLine(this, st, bar, '> 취소')}`;
      const opt = (label, on) => (on ? `${styleText('cyan', '●')} ${label}` : styleText('dim', `○ ${label}`));
      return `${top}${bar}  ${opt('예', this.value)}   ${opt('아니오', !this.value)}\n${bar}  ${styleText('gray', '←/→ 또는 y/n · Enter 확정 · Esc 뒤로')}\n${styleText('cyan', pr.S_BAR_END)}\n`;
    },
  }));
}

const AGENTS = {
  claude: { label: 'Claude Code', command: 'claude', install: 'npm i -g @anthropic-ai/claude-code', modelFlag: '--model' },
  codex: { label: 'OpenAI Codex', command: 'codex', install: 'npm i -g @openai/codex', modelFlag: '-m' },
};

/** 실행 도구에 항상 붙일 인자 중 자주 쓰는 조합. 목록에 없는 건 "직접 입력" 으로 */
const ARG_PRESETS = {
  claude: [
    { value: '', label: '없음', hint: '파일 수정·셸 명령마다 확인 (Claude 기본)' },
    { value: '--permission-mode plan', label: '계획 먼저', hint: '--permission-mode plan: 조사하고 계획을 보여 준 뒤 승인받고 실행' },
    { value: '--permission-mode acceptEdits', label: '파일 수정은 자동', hint: '--permission-mode acceptEdits: 파일 수정은 묻지 않고 셸 명령만 확인' },
    { value: '--dangerously-skip-permissions', label: '확인 없이 실행', hint: '--dangerously-skip-permissions: 모든 권한 확인 생략. 혼자 쓰는 PC 에서' },
    { value: '--permission-mode plan --dangerously-skip-permissions', label: '계획 먼저, 승인 뒤엔 확인 없이', hint: '위 두 옵션을 같이' },
  ],
  codex: [
    { value: '', label: '없음', hint: 'Codex 기본 (수정·명령마다 확인)' },
    { value: '--search', label: '웹 검색 켜기', hint: '--search' },
    { value: '--full-auto', label: '작업 폴더 안에서 자동 실행', hint: '--full-auto: 샌드박스 안의 수정·명령은 묻지 않음' },
    { value: '--dangerously-bypass-approvals-and-sandbox', label: '확인·샌드박스 없이 실행', hint: '혼자 쓰는 PC 에서' },
  ],
};

/** 항상 붙일 인자 고르기: 자주 쓰는 조합 또는 직접 입력. current = 지금 저장된 값(문자열) */
async function chooseArgs(agent, current) {
  const presets = ARG_PRESETS[agent] || [{ value: '', label: '없음' }];
  for (;;) {
    const known = presets.some((o) => o.value === current);
    const options = [...presets, { value: '__custom', label: '직접 입력', hint: current && !known ? `지금: ${current}` : '목록에 없는 옵션을 적는다' }];
    const picked = await choose({
      message: `${AGENTS[agent].command} 에 항상 붙일 인자`,
      hint: 'kedovi start 가 실행할 때마다 붙입니다. 이 PC 전용.',
      options, initialValue: known ? current : '__custom',
    });
    const v = picked !== '__custom' ? picked : await input({
      message: `${AGENTS[agent].command} 에 붙일 인자 직접 입력`,
      hint: '없으면 Enter 를 누르세요.',
      placeholder: agent === 'claude' ? '예: --permission-mode plan --verbose' : '예: --search --full-auto',
      initialValue: known ? '' : current,
    });
    if (v === BACK || clack().isCancel(v) || !RISKY_ARGS.test(String(v || ''))) return v;
    // 권한 확인을 끄는 인자는 한 번 더 묻는다 (아니오 = 인자 고르기로)
    const ok = await yesNo({ message: '권한 확인 없이 실행할까요?', hint: '에이전트가 묻지 않고 파일을 지우거나 고치고, 셸 명령 · push 를 실행할 수 있습니다. 혼자 쓰는 PC 에서, 되돌릴 수 있는 작업에만 권합니다.', initialValue: false });
    if (ok === true) return v;
    if (clack().isCancel(ok)) return ok;
    current = String(v || '');
  }
}
/** 권한 확인을 끄는 인자 (Claude · Codex) */
const RISKY_ARGS = /--dangerously-(skip-permissions|bypass-approvals-and-sandbox)|--yolo\b/;

/** 모델 목록 (packs/core/models.json) */
function modelCatalog(root) {
  try { return JSON.parse(read(path.join(root, 'packs', 'core', 'models.json'))); } catch { return { tools: {} }; }
}
const modelLabel = (cat, tool, id, blank = '메인과 같게') => {
  if (!id) return blank;
  const sp = kit.splitModel(id, tool); // "codex:gpt-…" = 상대 도구로 위임
  const label = ((cat.tools[sp.tool] || []).find((m) => m.id === sp.model) || { label: sp.model }).label;
  return sp.delegated ? `${label} (${sp.tool === 'codex' ? 'Codex' : 'Claude'} 위임)` : label;
};

/** 모델 하나 고르기 — 목록 · 도구 기본 · 직접 입력. delegate 면 상대 도구 모델도 "위임" 으로 고를 수 있다 (역할 에이전트) */
async function chooseModel(cat, tool, { message, hint, current, blankLabel = '도구 기본', blankHint = '따로 정하지 않는다', delegate = false, viaGateway = false }) {
  const other = tool === 'claude' ? 'codex' : 'claude';
  const otherName = other === 'codex' ? 'Codex' : 'Claude';
  const vendorName = other === 'codex' ? 'GPT' : 'Claude';
  const opts = [{ value: '__blank', label: blankLabel, hint: blankHint },
    ...(cat.tools[tool] || []).map((m) => ({ value: m.id, label: m.label, hint: m.hint })),
    ...(delegate ? (cat.tools[other] || []).map((m) => (viaGateway
      ? { value: `${other}:${m.id}`, label: `${m.label} (${vendorName})`, hint: `게이트웨이로 이 역할을 ${vendorName} 모델이 맡는다 · ${m.hint}` }
      : { value: `${other}:${m.id}`, label: `${m.label} (${otherName} 위임)`, hint: `${otherName} 에게 이 역할을 넘긴다 · ${m.hint}` })) : []),
    { value: '__custom', label: '직접 입력', hint: delegate ? `목록에 없는 모델 ID (위임은 ${other}:<모델>)` : '목록에 없는 모델 ID' }];
  const known = opts.some((o) => o.value === current);
  const v = await choose({ message, hint, options: opts, initialValue: !current ? '__blank' : known ? current : '__custom' });
  if (v === BACK) return BACK;
  if (v === '__blank') return '';
  if (v !== '__custom') return v;
  const t = await input({ message: `${AGENTS[tool].label} 모델 ID`, hint: tool === 'claude' ? '예: claude-opus-5-5 · opus · sonnet' : '예: gpt-6-sol', initialValue: known ? '' : current || '' });
  return t === BACK ? BACK : String(t || '').trim();
}

const KIT_ROOT = kit.kitRoot();
const read = (f) => fs.readFileSync(f, 'utf8');

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

/** 취소(ESC·Ctrl+C)면 조용히 끝낸다 */
function ask(v) {
  if (v === BACK || clack().isCancel(v)) { p.cancel(abortNote ? `취소했습니다. ${abortNote}` : '취소했습니다'); process.exit(130); }
  return v;
}

// PATH 에 없으면 Codex 앱이 내려받은 CLI 도 찾는다 — 워크스페이스의 cross-review·doctor 와 같은 규칙
const { findCli } = require(path.join(KIT_ROOT, 'packs', 'core', 'lib', 'cli.js'));
const hasCommand = (cmd) => !!findCli(cmd);

/** 워크스페이스 찾기: 위로 올라가며 → 없으면 바로 아래 폴더 중 하나 (프로젝트 폴더에서 실행해도 되게) */
function locateWorkspace() {
  const up = kit.findRoot();
  if (up) return remember(up);
  const here = process.cwd();
  const kids = fs.readdirSync(here, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(here, e.name, 'workspace.json')))
    .map((e) => path.join(here, e.name));
  if (kids.length === 1) return remember(kids[0]);
  if (kids.length > 1) fail(`워크스페이스가 여러 개입니다. 그 폴더로 이동해서 실행하세요:\n  ${kids.join('\n  ')}`);
  fail('워크스페이스(workspace.json)를 찾지 못했습니다. kedovi init 으로 만들거나 그 폴더에서 실행하세요');
}

const localConfigPath = (root) => path.join(root, kit.LOCAL_CONFIG);
function readLocal(root) {
  try { return JSON.parse(read(localConfigPath(root))); } catch { return {}; }
}
function writeLocal(root, data) {
  const f = localConfigPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ ...readLocal(root), ...data }, null, 2) + '\n');
}

// 이 PC 의 워크스페이스 목록 — kedovi list · kedovi remove <이름> 이 쓴다. 킷을 쓸 때마다 채워진다 (git 과 무관한 개인 기록)
// ───────── 배포된 최신 버전 확인 (kedovi start) ─────────
const PKG_NAME = (() => { try { return JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).name; } catch { return 'kedovi'; } })();
const semverGt = (x, y) => { const a = String(x).split('.').map((n) => parseInt(n, 10) || 0), b = String(y).split('.').map((n) => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
/**
 * 레지스트리의 dist-tags.latest. ~/.npmrc 의 (scope)registry 와 그 주소의 _authToken 을 읽어 직접 묻는다 (npm 을 띄우지 않아 빠르다).
 * 결과는 ~/.kedovi/update-check.json 에 두고 하루 한 번만 묻는다. 2초 안에 답이 없거나 실패하면 null. KEDOVI_NO_UPDATE_CHECK=1 이면 묻지 않는다
 */
async function latestPublished() {
  if (process.env.KEDOVI_NO_UPDATE_CHECK) return null;
  const home = process.env.KEDOVI_HOME || path.join(require('os').homedir(), '.kedovi');
  const cacheFile = path.join(home, 'update-check.json');
  let cache = {};
  try { cache = JSON.parse(read(cacheFile)); } catch { /* 처음 */ }
  if (cache.checkedAt && Date.now() - cache.checkedAt < 24 * 3600 * 1000) return cache.latest || null;
  let rc = '';
  try { rc = read(path.join(require('os').homedir(), '.npmrc')); } catch { /* 없음 */ }
  const conf = (k) => { const m = new RegExp(`^\\s*${k.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*=\\s*(.+?)\\s*$`, 'm').exec(rc); return m ? m[1] : null; };
  const scope = PKG_NAME.startsWith('@') ? PKG_NAME.split('/')[0] : null;
  const registry = ((scope && conf(`${scope}:registry`)) || conf('registry') || 'https://registry.npmjs.org/').replace(/\/?$/, '/');
  const token = conf(`${registry.replace(/^https?:/, '')}:_authToken`);
  const latest = await new Promise((resolve) => {
    const u = new URL(`${registry}${PKG_NAME.replace('/', '%2f')}`);
    const req = require(u.protocol === 'http:' ? 'http' : 'https').get(u, { timeout: 2000, headers: { accept: 'application/vnd.npm.install-v1+json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body)['dist-tags'].latest || null : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
  try { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(cacheFile, `${JSON.stringify({ checkedAt: Date.now(), latest })}\n`); } catch { /* 저장 실패는 무시 */ }
  return latest;
}

const registryPath = () => path.join(process.env.KEDOVI_HOME || path.join(require('os').homedir(), '.kedovi'), 'workspaces.json');
function readRegistry() {
  try { return JSON.parse(read(registryPath())).workspaces || []; } catch { return []; }
}
function writeRegistry(list) {
  try {
    fs.mkdirSync(path.dirname(registryPath()), { recursive: true });
    fs.writeFileSync(registryPath(), JSON.stringify({ workspaces: list }, null, 2) + '\n');
  } catch { /* 목록은 편의 기능 — 못 써도 명령은 계속한다 */ }
}
function workspaceName(root) {
  try { return JSON.parse(read(path.join(root, 'workspace.json'))).project.name || path.basename(root); } catch { return path.basename(root); }
}
/**
 * 임시 폴더의 워크스페이스인가 — 시험 · 에이전트 작업이 만든 것. 이 PC 목록(kedovi list · upgrade --all)에 올리지 않는다.
 * 시스템 임시 폴더(os.tmpdir · /tmp · /private/tmp · /var/folders · Windows TEMP)와 ~/.claude/jobs
 */
function isTempWorkspace(dir) {
  const os = require('os');
  const real = (x) => { try { return fs.realpathSync(x); } catch { return path.resolve(x); } };
  const p = real(dir);
  const roots = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders', process.env.TEMP, process.env.TMP, path.join(os.homedir(), '.claude', 'jobs')]
    .filter(Boolean).map(real);
  return roots.some((r) => p === r || p.startsWith(r + path.sep));
}
/** 목록에 올린다 (이미 있으면 이름만 갱신) — 받은 경로를 그대로 돌려준다. 임시 폴더는 올리지 않는다 */
function remember(root) {
  if (isTempWorkspace(root) && !process.env.KEDOVI_HOME) { writeShim(root); return root; }
  const all = readRegistry();
  const name = workspaceName(root);
  const old = all.find((w) => w.path === root);
  if (!old || old.name !== name) writeRegistry([...all.filter((w) => w !== old), { name, path: root, addedAt: (old && old.addedAt) || new Date().toISOString().slice(0, 10) }]);
  writeShim(root);
  return root;
}
/**
 * 이 PC 의 kedovi 을 가리키는 실행 파일 (.agents/bin/kedovi, git 제외). 에이전트 셸은 로그인 셸 환경을 새로 읽어
 * kedovi 이 PATH 에 없을 수 있다 (nvm 등). kedovi 스킬은 kedovi 이 없으면 이것을 쓴다
 */
function writeShim(root) {
  try {
    const dir = path.join(root, '.agents', 'bin');
    const target = path.join(KIT_ROOT, 'bin', 'kedovi.js');
    const files = process.platform === 'win32'
      ? [['kedovi.cmd', `@echo off\r\n"${process.execPath}" "${target}" %*\r\n`]]
      : [['kedovi', `#!/bin/sh\n# 이 PC 의 kedovi (kedovi 명령이 만든다, git 제외)\nexec "${process.execPath}" "${target}" "$@"\n`]];
    for (const [name, body] of files) {
      const f = path.join(dir, name);
      if (fs.existsSync(f) && read(f) === body) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, body);
      fs.chmodSync(f, 0o755);
    }
  } catch { /* 편의 기능 — 못 만들어도 명령은 계속 */ }
}
/** 아직 워크스페이스로 남아 있는 것만 — 지웠거나 옮긴 폴더 · 임시 폴더는 목록에서 뺀다 */
function liveRegistry() {
  const all = readRegistry();
  const live = all.filter((w) => fs.existsSync(path.join(w.path, 'workspace.json')) && (process.env.KEDOVI_HOME || !isTempWorkspace(w.path)));
  if (live.length !== all.length) writeRegistry(live);
  return live;
}

const installedVersion = () => JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version;
function wsVersion(root) {
  try { return (JSON.parse(read(path.join(root, 'workspace.json'))).kit || {}).version || null; } catch { return null; }
}

/** 지금 올리면 안 되는 이유 (없으면 null): 팀장 아님 · 원격에 받지 않은 커밋(팀원이 먼저 올렸을 수 있다) · 커밋 안 한 변경 */
function upgradeBlocker(root) {
  try { if (!kit.lockState(root, kit.loadWorkspace(root)).admin) return '팀장만 올릴 수 있음 (팀원 설정 수정이 막혀 있음)'; } catch { /* 옛 킷 */ }
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', timeout: 6000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (git('rev-parse', '--is-inside-work-tree').status !== 0) return null;
  if (git('rev-parse', '--abbrev-ref', '@{u}').status === 0) {
    git('fetch', '-q', '--no-tags');
    const behind = git('rev-list', '--count', 'HEAD..@{u}');
    const n = behind.status === 0 ? Number(behind.stdout.trim()) : 0;
    if (n > 0) return `원격에 받지 않은 커밋 ${n}개: 먼저 git pull (팀원이 먼저 올렸을 수 있음)`;
  }
  if ((git('status', '--porcelain', '--untracked-files=no').stdout || '').trim()) return '커밋 안 한 변경이 있음: 정리한 뒤 그 폴더에서 kedovi upgrade';
  return null;
}

/** 폴더 아래 워크스페이스 찾기 (4단계까지, repos · node_modules · 숨김 폴더는 들어가지 않는다) */
function scanWorkspaces(dir, depth = 0, out = []) {
  if (fs.existsSync(path.join(dir, 'workspace.json')) && wsVersion(dir)) { out.push(dir); return out; }
  if (depth >= 4) return out;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && !['node_modules', 'repos', 'Library', 'Applications'].includes(e.name)) scanWorkspaces(path.join(dir, e.name), depth + 1, out);
  return out;
}

/** 이 PC 의 워크스페이스를 설치된 킷 버전으로 한꺼번에 올린다. 올리기 전에 목록 · 건너뛸 것을 보이고 묻는다 */
async function cmdUpgradeAll(rest) {
  const installed = installedVersion();
  const si = rest.indexOf('--scan');
  if (si >= 0) {
    const dir = rest[si + 1];
    if (!dir || dir.startsWith('--')) fail('사용법: kedovi upgrade --all [--scan <폴더>] [--yes]');
    const found = scanWorkspaces(path.resolve(dir));
    for (const f of found) remember(f);
    console.log(`${path.resolve(dir)} 아래에서 워크스페이스 ${found.length}개를 찾아 목록에 올렸습니다`);
  }
  const rows = liveRegistry().map((w) => ({ ...w, ver: wsVersion(w.path) })).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) fail('기록된 워크스페이스가 없습니다. 워크스페이스 폴더에서 kedovi 명령을 한 번 실행하거나 --scan <폴더> 로 찾으세요');
  const behind = rows.filter((r) => r.ver && semverGt(installed, r.ver));
  const ahead = rows.filter((r) => r.ver && semverGt(r.ver, installed));
  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`설치된 kedovi ${installed}`);
  for (const r of rows) console.log(`  ${r.name.padEnd(w)}  ${padTo(r.ver ? `v${r.ver}` : '?', 9)} ${behind.includes(r) ? '옛 버전' : ahead.includes(r) ? '이 PC 보다 새 버전' : '최신'}  ${r.path}`);
  if (ahead.length) console.log(`  이 PC 보다 새 버전으로 올라간 워크스페이스가 있습니다: npm i -g ${PKG_NAME}`);
  if (!behind.length) { console.log(`✔ 옛 버전 워크스페이스가 없습니다`); return; }
  const checked = behind.map((r) => ({ ...r, block: upgradeBlocker(r.path) }));
  const go = checked.filter((r) => !r.block);
  for (const r of checked.filter((x) => x.block)) console.log(`  건너뜀 ${r.name}: ${r.block}`);
  if (!go.length) return;
  if (!rest.includes('--yes')) {
    if (!process.stdin.isTTY) fail(`올릴 워크스페이스 ${go.length}개: ${go.map((r) => r.name).join(', ')}. 화면 없이 올리려면 --yes 를 붙이세요`);
    clack();
    const ok = ask(await choose({ message: '옛 버전 워크스페이스를 올릴까요', hint: go.map((r) => `${r.name} ${r.ver} → ${installed}`).join(' · '), initialValue: true,
      options: [{ value: true, label: '올리기 (권장)' }, { value: false, label: '그만두기' }] }));
    if (!ok) return;
  }
  const done = [];
  for (const r of go) {
    console.log(`\n■ ${r.name} (${r.ver} → ${installed})`);
    const res = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'kedovi.js'), 'upgrade'], { cwd: r.path, stdio: 'inherit' });
    done.push({ ...r, ok: res.status === 0 });
  }
  console.log('\n결과');
  for (const r of done) console.log(`  ${r.ok ? '✔' : '✖'} ${r.name}  ${r.ok ? `${r.ver} → ${installed}` : '실패 (위 출력 확인)'}`);
  for (const r of checked.filter((x) => x.block)) console.log(`  - ${r.name}  건너뜀: ${r.block}`);
  const ok = done.filter((r) => r.ok);
  if (ok.length) console.log(['\n팀에 반영하려면 워크스페이스마다 commit · push:', ...ok.map((r) => `  git -C "${r.path}" add -A && git -C "${r.path}" commit -m "chore: kedovi ${installed}" && git -C "${r.path}" push`)].join('\n'));
  if (done.some((r) => !r.ok)) process.exitCode = 1;
}

/** npm i -g 로 새 버전을 받은 뒤 첫 kedovi 명령에서 한 번: 이 PC 의 옛 버전 워크스페이스 수를 알린다 */
function noticeNewInstall(cmd) {
  try {
    const file = path.join(path.dirname(registryPath()), 'last-version');
    const installed = installedVersion();
    let last = null;
    try { last = read(file).trim(); } catch { /* 처음 */ }
    if (last === installed) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${installed}\n`);
    if (!last || !semverGt(installed, last) || cmd === 'upgrade') return;
    const behind = liveRegistry().filter((w) => { const v = wsVersion(w.path); return v && semverGt(installed, v); });
    if (behind.length) console.warn(`kedovi ${installed} 설치됨 (전에 ${last}). 이 PC 의 옛 버전 워크스페이스 ${behind.length}개 (${behind.map((w) => w.name).join(', ')}): 한꺼번에 올리기 kedovi upgrade --all`);
  } catch { /* 알림은 편의 기능 */ }
}

function cmdList() {
  const live = liveRegistry();
  if (!live.length) return console.log('기록된 워크스페이스가 없습니다. kedovi init 으로 만들거나, 기존 워크스페이스 폴더에서 kedovi 명령을 한 번 실행하면 목록에 오릅니다');
  const w = Math.max(...live.map((x) => x.name.length));
  for (const x of live.sort((a, b) => a.name.localeCompare(b.name))) {
    let ver = '';
    try { ver = (JSON.parse(read(path.join(x.path, 'workspace.json'))).kit || {}).version || ''; } catch { /* 버전 없음 */ }
    console.log(`${x.name.padEnd(w)}  ${padTo(ver ? `v${ver}` : '', 8)} ${x.path}`);
  }
}

/** 워크스페이스에 들어 있는 kit.js 로 실행 — 워크스페이스가 고정한 버전 규칙을 쓴다 */
function runWorkspaceKit(root, args) {
  const bin = path.join(root, 'bin', 'kit.js');
  const r = spawnSync(process.execPath, [fs.existsSync(bin) ? bin : path.join(KIT_ROOT, 'bin', 'kit.js'), ...args], { cwd: root, stdio: 'inherit' });
  return r.status === 0;
}

// ───────────────────────── 메인 에이전트 선택 ─────────────────────────

const OTHER = { claude: 'codex', codex: 'claude' };
const effortTag = (tool, entry) => { const e = kit.effortOf(entry, tool); return e ? ` ${e}` : ''; };

/** 모델 ID(게이트웨이 이름 포함) → { label, vendor } */
function modelInfo(cat, id) {
  const tail = String(id).split('/').pop();
  for (const t of ['claude', 'codex']) {
    const m = (cat.tools[t] || []).find((y) => y.id === id || y.id === tail);
    if (m) return { label: m.short || m.label, vendor: t };
  }
  const fam = tail.match(/^claude-(opus|sonnet|haiku|fable)/);
  if (fam) { const m = (cat.tools.claude || []).find((y) => y.id === fam[1]); return { label: m ? m.short || m.label : tail, vendor: 'claude' }; }
  return { label: tail, vendor: /^(gpt|o\d|codex)/i.test(tail) ? 'codex' : 'claude' };
}

/** 이 PC 의 연결 방식 (이 PC 값 → 팀 기본값) */
function accessOf(root) {
  let team = {};
  try { team = (JSON.parse(read(path.join(root, 'workspace.json'))).agents || {}).access || {}; } catch { /* 없음 */ }
  return kit.normalizeAccess({ ...team, ...((readLocal(root).agents || {}).access || {}) });
}

/** 프로필 비교표 — 이 도구로 실행했을 때 역할마다 프로필별 모델 (뒤에 붙은 것은 추론 강도). 연결 방식(쓰는 AI · 구성)을 반영한다 */
function profileTable(cat, tool, roles, access = null) {
  const names = Object.keys(cat.profiles || {});
  const grades = Object.fromEntries((roles || []).filter((r) => r.grade).map((r) => [r.name, r.grade]));
  const models = names.map((n) => (access ? kit.applyAccess(kit.profileModels(cat, n, grades), access) : kit.profileModels(cat, n, grades)));
  const vendorName = (t) => (t === 'codex' ? 'GPT' : 'Claude');
  const mainVendor = access && access.main === 'codex' && tool === 'claude' ? 'codex' : tool;
  const cell = (t, x, plain = false) => {
    const id = (x || {})[t];
    if (!id) return plain ? '쓰지 않음' : '메인과 같게';
    const sp = kit.splitModel(id, t);
    const info = modelInfo(cat, sp.model);
    const mark = plain ? '' : sp.delegated ? ` ↗${sp.tool === 'codex' ? 'Codex' : 'Claude'}` : info.vendor !== mainVendor ? ` (${vendorName(info.vendor)})` : '';
    return `${info.label}${mark}${effortTag(t, x)}`;
  };
  const rows = [
    ['메인(리드)', ...models.map((m) => cell(tool, m.main))],
    ...roles.map((r) => [r.title || r.name, ...models.map((m) => cell(tool, (m.roles || {})[r.name]))]),
    [`교차 검토`, ...models.map((m) => cell(OTHER[tool], m.crossReview, true))],
  ];
  const head = ['', ...names.map((n) => cat.profiles[n].label)];
  const w = head.map((_, i) => Math.max(...[head, ...rows].map((x) => width(x[i]))) + 2);
  const line = (x) => x.map((v, i) => padTo(v, w[i])).join('');
  const notes = [];
  if (rows.some((r) => r.some((c) => c.includes('↗')))) notes.push('↗ = 그 역할을 상대 도구에게 위임 (그 도구가 설치·로그인돼 있어야 한다. 없으면 같은 회사 모델로 대신)');
  if (rows.some((r) => r.some((c) => /\((GPT|Claude)\)/.test(c)))) notes.push('(GPT)·(Claude) = 게이트웨이로 그 회사 모델을 하위 에이전트로 바로 쓴다');
  notes.push(`교차 검토 = ${AGENTS[OTHER[tool]].label} 에게 검토를 맡길 때의 모델. 뒤의 xhigh·max 등은 추론 강도`);
  return [line(head), ...rows.map(line), '', ...notes].join('\n');
}

const COMPOSE_LABEL = { mix: '두 회사 모델 섞기', vendor: '한 회사 모델만', single: '단일 모델' };
const accessSummary = (a) => (a.connection === 'gateway'
  ? `AI 게이트웨이 ${a.gateway && a.gateway.url ? `(${a.gateway.url.replace(/^https?:\/\//, '')}, 모델 ${(a.gateway.models || []).length}개)` : ''} · 메인 ${a.main === 'codex' ? 'GPT' : 'Claude'} · ${COMPOSE_LABEL[a.compose]}`
  : `AI 서비스 직접 (${a.vendors.map((v) => (v === 'codex' ? 'GPT' : 'Claude')).join(' · ')}) · ${a.vendors.length === 1 && a.compose === 'vendor' ? '역할마다 알맞은 모델' : COMPOSE_LABEL[a.compose]}`);

/**
 * 게이트웨이로 키를 보내도 되는지. https(또는 localhost)만, 그리고 팀 설정(workspace.json)에서 온 주소 · 키 이름은 이 PC 에서 한 번 승인한 뒤에만.
 * 공유 파일 한 줄 수정으로 팀원의 키와 대화가 다른 서버로 가지 않게 한다. 승인은 .agents/local.json 의 agents.gatewayTrust
 */
async function trustGateway(root, gw) {
  if (!gw || !gw.url || !gw.keyEnv) return false;
  if (!gateway.safeUrl(gw.url)) { console.warn(`⚠ 게이트웨이 주소가 https 가 아니라 키를 보내지 않습니다: ${gw.url}`); return false; }
  const local = readLocal(root).agents || {};
  const same = (x) => x && x.url === gw.url && (x.keyEnv || null) === gw.keyEnv;
  if (same((local.access || {}).gateway) || same(local.gatewayTrust)) return true;
  const what = `주소 ${gw.url} · 키 환경변수 ${gw.keyEnv}`;
  if (!process.stdin.isTTY) { console.warn(`⚠ 팀 설정의 게이트웨이(${what})를 이 PC 에서 아직 승인하지 않아 키를 보내지 않습니다. 터미널에서 kedovi start 로 한 번 승인하세요`); return false; }
  const ok = await clack().confirm({ message: `팀 설정(workspace.json)의 게이트웨이로 키를 보낼까요? ${what} (처음 보는 주소면 아니오)`, initialValue: false });
  if (ok !== true) return false;
  writeLocal(root, { agents: { ...local, gatewayTrust: { url: gw.url, keyEnv: gw.keyEnv } } });
  return true;
}

/** 게이트웨이 모델 조회 (진행 표시 포함) — 반환 models 배열 (실패면 빈 배열) */
async function fetchGatewayModels(g, { quiet = false } = {}) {
  const s = quiet ? null : p.spinner();
  if (s) s.start(`게이트웨이 모델 목록 조회 중 (${g.url})`);
  const r = await gateway.listModels(g.url, g.key);
  if (s) s.stop(r.ok ? `게이트웨이 모델 ${r.models.length}개` : `조회 실패: ${r.error}`);
  return r.ok ? r.models : null;
}

function gatewayNote(models) {
  const g = gateway.groupModels(models);
  const row = (name, list) => (list.length ? `${padTo(name, 8)}${list.map((m) => m.split('/').pop()).join(' · ')}` : null);
  return [row('Claude', g.claude), row('GPT', g.gpt), row('기타', g.other), g.other.length ? '\n기타 모델은 추천 대상이 아닙니다. 쓰려면 kedovi models set 으로 직접 지정합니다.' : null].filter(Boolean).join('\n');
}

/**
 * 쓰는 AI 고르기 — 한 화면: Claude 만 · GPT 만 · Claude + GPT · AI 게이트웨이 → [게이트웨이: 주소 확인 · 모델 조회 · 메인 모델 회사].
 * 역할 구성은 자동(두 회사 = 섞기, 한 회사 = 한 회사 모델만, 단일 모델은 kedovi ai compose single 로 이미 골랐으면 유지).
 * 이 PC(.agents/local.json agents.access)에 저장한다. 반환: 정규화한 access · BACK(첫 질문에서 Esc)
 */
async function chooseAccess(root) {
  const cur = accessOf(root);
  const installed = { claude: hasCommand('claude'), codex: hasCommand('codex') };
  const found = gateway.detect();
  const st = { connection: cur.set ? cur.connection : found.length ? 'gateway' : 'direct', g: null, models: [], vendors: cur.vendors, main: cur.main, compose: cur.compose, plans: kit.teamOptions(kit.loadWorkspace(root), readLocal(root).agents || {}).plans };
  const planCat = kit.loadCatalogFor(root, kit.loadWorkspace(root)).cat;
  const detected = kit.detectPlans(planCat);
  const both = () => (st.vendors || []).includes('claude') && (st.vendors || []).includes('codex');
  const pick = cur.set ? (cur.connection === 'gateway' ? 'gateway' : both() ? 'both' : (st.vendors || [])[0] || 'claude')
    : found.length ? 'gateway' : installed.claude && installed.codex ? 'both' : installed.codex ? 'codex' : 'claude';
  const steps = [
    { run: () => choose({
      message: '쓰는 AI', hint: found.length ? `이 PC 에서 AI 게이트웨이를 찾았습니다 (${found[0].url}).` : '구독하거나 API 키가 있는 것을 고르세요. 시작 도구와 역할 구성은 여기서 정해집니다.',
      options: [
        { value: 'claude', label: 'Claude 만', hint: `Claude Code 로 시작 · ${installed.claude ? 'claude 설치됨' : `미설치: ${AGENTS.claude.install}`}` },
        { value: 'codex', label: 'GPT 만', hint: `Codex 로 시작 · ${installed.codex ? 'codex 설치됨' : `미설치: ${AGENTS.codex.install}`}` },
        { value: 'both', label: 'Claude + GPT', hint: 'Claude Code 로 시작, 리뷰·테스트는 GPT 가 독립 검토 (둘 다 쓸 수 있으면 추천)' },
        { value: 'gateway', label: 'AI 게이트웨이', hint: '여러 회사 모델을 한 주소로 주는 서버 (LiteLLM · OpenRouter 등). 주소와 키 환경변수 이름을 묻습니다' }],
      initialValue: pick }), set: (v) => { if (v === 'gateway') st.connection = 'gateway'; else { st.connection = 'direct'; st.vendors = v === 'both' ? ['claude', 'codex'] : [v]; } } },
    // 요금제 (직접 연결, 고른 회사마다 차례로). 이 PC 로그인 정보의 요금제를 미리 골라 둔다 (내부 저장값이라 사람이 확인)
    ...['claude', 'codex'].map((v) => ({ when: () => st.connection === 'direct' && (st.vendors || []).includes(v), run: () => {
      const list = (planCat.plans || {})[v] || [];
      const det = detected[v] || {};
      const name = v === 'codex' ? 'ChatGPT' : 'Claude';
      return choose({
        message: `${name} 요금제`,
        hint: det.raw && !det.id ? `이 PC 로그인 값 '${det.raw}' 는 목록에 없습니다. 가장 가까운 것을 고르세요.` : '리더가 팀을 짤 때 이 회사 모델을 얼마나 쓸지 정하는 기준입니다 (빠듯 · 넉넉 · 종량). 이 PC 에만 저장합니다.',
        options: list.map((x) => ({ value: x.id, label: x.label, hint: `${ROOM_TEXT[x.room] || x.room} · ${x.hint || ''}${det.id === x.id ? ' (이 PC 로그인에서 확인)' : ''}${x.local ? ' (워크스페이스 임시 목록)' : ''}` })),
        initialValue: st.plans[v] || det.id || (list[0] || {}).id });
    }, set: (x) => { st.plans = { ...st.plans, [v]: x }; } })),
    // 게이트웨이: 찾은 것 확인 또는 직접 입력 → 모델 조회
    { when: () => st.connection === 'gateway', run: async () => {
      let g = null;
      if (found.length) {
        const v = await choose({ message: '게이트웨이', hint: '키 값은 조회에만 쓰고 저장하지 않습니다.',
          options: [...found.map((x, i) => ({ value: String(i), label: x.url.replace(/^https?:\/\//, ''), hint: `${x.source}${x.key ? '' : ' · 키를 못 찾음'}` })), { value: '__manual', label: '직접 입력', hint: '주소와 키가 든 환경변수 이름' }],
          initialValue: '0' });
        if (v === BACK) return BACK;
        if (v !== '__manual') g = found[+v];
      }
      if (!g) {
        const url = await input({ message: '게이트웨이 주소', hint: '예: https://llm.example.com (끝의 /v1 은 빼도 됩니다)', validate: (x) => (/^https?:\/\/\S+$/.test(String(x || '').trim()) ? undefined : 'http(s):// 로 시작하는 주소') });
        if (url === BACK) return BACK;
        const keyName = await input({ message: '키가 든 환경변수 이름', hint: '키 값이 아니라 이름을 적습니다 (예: LLM_GATEWAY_KEY). 없으면 Enter.', validate: (x) => (!x || /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(x).trim()) ? undefined : '환경변수 이름 형식') });
        if (keyName === BACK) return BACK;
        const k = String(keyName || '').trim();
        g = { url: String(url).trim().replace(/\/+$/, '').replace(/\/v1$/, ''), source: '직접 입력', keyName: k || null, key: k ? process.env[k] || null : null, aliases: false };
      }
      const models = await fetchGatewayModels(g);
      if (models) p.note(gatewayNote(models), `게이트웨이 모델 ${models.length}개`);
      else p.log.warn('모델 목록을 받지 못했습니다. 킷 기본 모델 이름으로 진행합니다. 나중에 kedovi ai refresh 로 다시 조회하세요.');
      return { g, models: models || [] };
    }, set: (v) => { st.g = v.g; st.models = v.models; st.vendors = kit.gatewayVendors(v.models); } },
    // 게이트웨이 + 두 회사: 메인 모델 회사
    { when: () => st.connection === 'gateway' && both(), run: () => choose({
      message: '메인 모델', hint: 'Claude Code 로 시작하고, 대화하는 메인 에이전트를 어느 회사 모델로 할지 고릅니다.',
      options: [{ value: 'claude', label: 'Claude', hint: '추천. 설계·구현을 이끄는 데 강하다' }, { value: 'codex', label: 'GPT', hint: 'Claude Code 안에서 GPT 모델로 (게이트웨이라 가능)' }],
      initialValue: st.main }), set: (v) => { st.main = v; } },
  ];
  for (let k = 0; k < steps.length;) {
    if (steps[k].when && !steps[k].when()) { k++; continue; }
    const v = await steps[k].run();
    if (v === BACK) {
      let prev = k - 1;
      while (prev >= 0 && steps[prev].when && !steps[prev].when()) prev--;
      if (prev < 0) return BACK;
      k = prev; continue;
    }
    if (clack().isCancel(v)) return v;
    steps[k].set(v);
    k++;
  }
  st.compose = st.compose === 'single' ? 'single' : both() ? 'mix' : 'vendor'; // 역할 구성은 자동. 단일 모델은 kedovi ai compose single
  const access = { connection: st.connection, compose: st.compose };
  if (st.connection === 'gateway') { access.main = st.main; if (st.g) access.gateway = gateway.toSaved(st.g, st.models); } else access.vendors = st.vendors;
  saveAccess(root, 'local', access);
  if (st.connection === 'direct') {
    const plans = Object.fromEntries(Object.entries(st.plans || {}).filter(([v]) => (st.vendors || []).includes(v)));
    writeLocal(root, { agents: { ...(readLocal(root).agents || {}), plans } });
  }
  return kit.normalizeAccess(access);
}

/** 연결 방식 저장 — local = .agents/local.json, team = workspace.json (팀 기본값, 게이트웨이 모델 목록은 넣지 않는다) */
function saveAccess(root, scope, access) {
  if (scope === 'team') {
    const wsFile = path.join(root, 'workspace.json');
    const raw = JSON.parse(read(wsFile));
    const a = { ...access };
    if (a.gateway) a.gateway = { url: a.gateway.url, keyEnv: a.gateway.keyEnv || null };
    raw.agents = { ...(raw.agents || {}), access: a };
    fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
    return;
  }
  writeLocal(root, { agents: { ...(readLocal(root).agents || {}), access } });
}

/**
 * 예산 프로필 고르기. scope team = 팀 기본(workspace.json), local = 이 PC.
 * 반환: 프로필 이름 · ''(팀 기본 따름) · '__roles'(역할별로 직접 고르기) · BACK. roles: false 면 '__roles' 를 빼고 묻는다 (기준 프로필)
 */
async function chooseProfile(root, tool, scope, current, { roles = true, message, hint } = {}) {
  const cat = modelCatalog(root);
  const pfs = cat.profiles || {};
  let teamName = cat.defaultProfile;
  try { teamName = (JSON.parse(read(path.join(root, 'workspace.json'))).agents || {}).profile || teamName; } catch { /* 없음 */ }
  if (roles) p.note(profileTable(cat, tool, listRoles(root), accessOf(root)), `${AGENTS[tool].label} 로 실행할 때의 추천 모델 (${accessSummary(accessOf(root))})`);
  // 이 PC 프로필은 팀보다 낮은 것만 (요금제 제약). 높은 것은 팀이 허용(kedovi models allow-higher on)했을 때만
  const allowed = (n) => scope === 'team' || profileAllowed(root, cat, n);
  const options = [
    ...(scope === 'local' ? [{ value: '', label: `팀 기본 따름 (${(pfs[teamName] || {}).label || teamName})` }] : []),
    ...Object.entries(pfs).filter(([n]) => allowed(n)).map(([n, pf]) => ({ value: n, label: pf.label, hint: pf.hint })),
    ...(roles ? [{ value: '__roles', label: '역할별로 직접 고르기', hint: '메인·설계·구현·리뷰·테스트·교차 검토 모델을 하나씩' }] : []),
  ];
  return choose({
    message: message || (scope === 'team' ? '팀 기본 모델 프로필' : '내 모델 프로필'),
    hint: hint || (scope === 'team'
      ? '역할(설계·구현·리뷰·테스트·문서)을 어떤 모델로 쓸지 정합니다. 팀이 같이 쓰고, 요금제가 다른 사람은 install 때 따로 고릅니다. 위 표는 이 PC 의 연결 방식 기준이고, 팀원마다 자기 연결 방식에 맞게 바뀝니다.'
      : '이 PC 에서만 쓰는 값입니다. 요금제가 팀보다 빠듯하면 낮추세요. 팀보다 높은 프로필은 팀이 허용(kedovi models allow-higher on)했을 때만 고를 수 있습니다.'),
    options, initialValue: current !== undefined && current !== null ? current : (scope === 'team' ? teamName : ''),
  });
}

/** 프로필 저장 — team 은 workspace.json agents.profile, local 은 .agents/local.json agents.profile ('' = 팀 기본 따름) */
function saveProfile(root, scope, v) {
  if (scope === 'team') {
    const wsFile = path.join(root, 'workspace.json');
    const raw = JSON.parse(read(wsFile));
    raw.agents = { ...(raw.agents || {}), profile: v };
    fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
    return;
  }
  const agents = { ...(readLocal(root).agents || {}) };
  if (v) agents.profile = v; else delete agents.profile;
  writeLocal(root, { agents });
}

/** 이 PC 프로필로 고를 수 있나: 팀 프로필과 같거나 낮은 것, 또는 팀이 allowHigherProfile 로 허용 */
function profileAllowed(root, cat, name) {
  const { profile } = kit.resolveModels(root, kit.loadWorkspace(root));
  if (profile.allowHigher || !profile.team) return true;
  const r = kit.profileRank(cat, name);
  return r === null || r >= kit.profileRank(cat, profile.team);
}

/** 범위의 직접 지정(agents) 읽기·쓰기 — team = workspace.json, local = .agents/local.json */
function readPicks(root, scope) {
  if (scope === 'local') return readLocal(root).agents || {};
  try { return JSON.parse(read(path.join(root, 'workspace.json'))).agents || {}; } catch { return {}; }
}
function writePicks(root, scope, agents) {
  if (scope === 'local') return writeLocal(root, { agents });
  const wsFile = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(wsFile));
  raw.agents = agents;
  fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
}

/**
 * 역할별로 직접 고르기 — 메인 · 역할 에이전트 · 교차 검토(상대 도구)를 차례로. 첫 선택지 "프로필대로" 는 직접 지정을 지운다.
 * 프로필 값과 같은 모델을 고르면 저장하지 않는다 (프로필이 바뀌면 따라가게). Esc 는 앞 역할로. 반환: 바꾼 개수 · BACK
 */
async function chooseRoleModels(root, tool, scope) {
  const cat = modelCatalog(root);
  const base = kit.resolveModels(root, kit.loadWorkspace(root)).base[scope] || {};
  // 상대 회사 모델은 그 회사를 쓰고 두 회사를 섞는 구성일 때만 고를 수 있다 (팀 기본값은 사람마다 달라 늘 연다)
  const access = accessOf(root);
  const otherOk = scope === 'team' || (access.vendors.includes(OTHER[tool]) && access.compose === 'mix');
  const steps = [
    { key: ['main'], title: '메인(리드)', tool },
    ...listRoles(root).map((r) => ({ key: ['roles', r.name], title: r.title || r.name, tool, hint: r.description })),
    { key: ['crossReview'], title: '교차 검토', tool: OTHER[tool], hint: `cross-review 스킬이 ${AGENTS[OTHER[tool]].label} 에게 검토를 맡길 때 쓰는 모델입니다.` },
  ];
  const agents = JSON.parse(JSON.stringify(readPicks(root, scope)));
  const at = (obj, key) => key.reduce((o, k) => (o || {})[k], obj) || {};
  const put = (key, t, v) => {
    let node = agents;
    for (const k of key) node = node[k] = node[k] || {};
    if (v) node[t] = v; else delete node[t];
  };
  p.log.info(`${scope === 'team' ? '팀 기본값(workspace.json)' : '이 PC(.agents/local.json)'} 에 저장합니다. "프로필대로" 는 직접 고른 값을 지웁니다. Esc 는 앞 역할로.`);
  let changed = 0;
  for (let i = 0; i < steps.length;) {
    const st = steps[i];
    const was = at(agents, st.key)[st.tool] || '';
    const fromProfile = at(base, st.key)[st.tool] || '';
    const v = await chooseModel(cat, st.tool, {
      message: `${st.title}: ${AGENTS[st.tool].label} 모델 (${i + 1}/${steps.length})`, hint: st.hint, current: was,
      blankLabel: '프로필대로', blankHint: fromProfile ? modelLabel(cat, st.tool, fromProfile) : st.key[0] === 'roles' ? '메인과 같게' : '도구 기본',
      delegate: st.key[0] === 'roles' && otherOk, viaGateway: access.connection === 'gateway' && tool === 'claude',
    });
    if (v === BACK) { if (i === 0) return BACK; i -= 1; continue; }
    const next = v && v !== fromProfile ? v : '';
    if (next !== was) changed += 1;
    put(st.key, st.tool, next);
    i += 1;
  }
  const prune = (o) => { for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') { prune(v); if (!Object.keys(v).length) delete o[k]; } return o; };
  writePicks(root, scope, prune(agents));
  return changed;
}

const KEEP_LOCAL = ['access', 'plans', 'gatewayTrust', 'limits', 'mode', 'prefer', 'enforce'];
/** 이 PC 의 직접 지정 내려놓기 — 'all' = 프로필·직접 지정 전부(팀 값을 따른다), 도구 이름 = 그 도구의 메인 모델만 */
function dropLocalPicks(root, what) {
  const local = readLocal(root);
  if (!local.agents) return;
  // 연결 방식 · 요금제 · 게이트웨이 승인 같은 모델 아닌 설정은 남긴다 (init 이 쓰는 AI 를 고른 뒤 프로필을 고르면 지워지던 것)
  if (what === 'all') local.agents = Object.fromEntries(Object.entries(local.agents).filter(([k]) => KEEP_LOCAL.includes(k)));
  else if (local.agents.main) delete local.agents.main[what];
  writeLocal(root, { agents: local.agents });
}

/** 만든 뒤의 질문 수 (진행 표시용): 스택 확인 · 규칙 확인 · 쓰는 AI · 모델 프로필 · 메인 모델 · 실행 인자 · 커밋·push, 원격이 없으면 주소 질문 하나 더 */
function postSteps(dir) {
  let remote = '';
  try { remote = spawnSync('git', ['-C', dir, 'remote'], { encoding: 'utf8' }).stdout.trim(); } catch { /* 폴더 없음 */ }
  return 7 + (remote ? 0 : 1);
}

async function chooseAgent(root, { force, askArgs = true, profileScope = 'local', progress } = {}) {
  const cur = readLocal(root);
  if (cur.agent && !force) return cur;
  clack();
  const installed = Object.fromEntries(Object.keys(AGENTS).map((k) => [k, hasCommand(AGENTS[k].command)]));
  // 연결 방식 → 시작 도구는 킷이 정한다 (게이트웨이·Claude 있음 = Claude Code, GPT 만 = Codex). 바꾸려면 kedovi agent --codex|--claude
  const cat = modelCatalog(root);
  // 프로필은 init 에서만 묻는다 (팀 기본 프로필, workspace.json). install·agent 는 팀 값을 따르고, 이 PC 프로필은 kedovi models profile 로만 둔다
  const scope = 'team';
  const current = () => undefined;
  let access; let agent; let args; let rolesPicked = false;
  const profileStep = async () => {
    for (;;) {
      const picked = await chooseProfile(root, agent, scope, current());
      if (picked === BACK || clack().isCancel(picked)) return BACK;
      if (picked !== '__roles') {
        saveProfile(root, scope, picked);
        dropLocalPicks(root, scope === 'team' ? 'all' : agent); // 만드는 사람은 팀 값을 따르고, 프로필을 고르면 직접 고른 메인 모델은 내려놓는다
        rolesPicked = false;
        return true;
      }
      // 직접 고르기 — 먼저 기준 프로필(고르지 않은 역할에 쓴다), 그다음 역할마다. Esc 는 프로필 선택으로
      const base = await chooseProfile(root, agent, scope, current(), { roles: false, message: '기준 프로필', hint: '역할마다 "프로필대로" 를 고르면 이 프로필 값을 씁니다.' });
      if (base === BACK || clack().isCancel(base)) continue;
      saveProfile(root, scope, base);
      if (scope === 'team') dropLocalPicks(root, 'all');
      if ((await chooseRoleModels(root, agent, scope)) !== BACK) { rolesPicked = true; return true; }
    }
  };
  // 메인(리드) 모델 — 프로필은 역할 모델을 정하고, 대화하는 메인은 따로 올릴 수 있게 (예: 표준 프로필 + 메인만 Opus). 역할별로 직접 골랐으면 거기서 정했다
  const mainStep = async () => {
    if (rolesPicked) return true;
    const base = kit.resolveModels(root, kit.loadWorkspace(root)).base[scope] || {};
    const fromProfile = (base.main || {})[agent] || '';
    const picks = readPicks(root, scope);
    const v = await chooseModel(cat, agent, {
      message: '메인(리드) 모델', hint: '대화하는 메인 에이전트의 모델입니다. 역할 에이전트는 프로필대로 둡니다. 나중에 kedovi models 로 바꿉니다.',
      current: ((picks.main || {})[agent]) || '', blankLabel: '프로필대로', blankHint: fromProfile ? modelLabel(cat, agent, fromProfile) : '도구 기본',
    });
    if (v === BACK) return BACK;
    const main = { ...(picks.main || {}) };
    if (v && v !== fromProfile) main[agent] = v; else delete main[agent];
    const next = { ...picks, main };
    if (!Object.keys(main).length) delete next.main;
    writePicks(root, scope, next);
    return true;
  };
  // 연결 방식 → 프로필 → 인자. Esc 는 이전 질문으로, 첫 질문에서 Esc 는 BACK 을 돌려준다 (부르는 쪽이 취소하거나 앞 화면으로)
  const steps = [
    async () => {
      const v = await chooseAccess(root);
      if (v === BACK || clack().isCancel(v)) return BACK;
      access = v; agent = kit.startToolOf(access);
      p.log.info(`시작 도구: ${AGENTS[agent].label}${access.connection === 'gateway' ? ' (게이트웨이는 Claude Code 가 두 회사 모델을 안정적으로 섞는다)' : ''}`);
      return true;
    },
    ...(cat.profiles && profileScope === 'team' ? [profileStep, mainStep] : []),
    async () => {
      if (!askArgs) { args = cur.agent === agent ? (cur.args || []).join(' ') : ''; return true; }
      const v = await chooseArgs(agent, cur.agent === agent ? (cur.args || []).join(' ') : '');
      if (v === BACK || clack().isCancel(v)) return BACK;
      args = v; return true;
    },
  ];
  // 진행 표시: true 면 이 함수 안에서 1/n, { at, total } 이면 바깥 단계 번호에 이어서
  const prog = (i) => { if (progress === true) PROGRESS = `${i + 1}/${steps.length}`; else if (progress) PROGRESS = `${progress.at + i}/${progress.total}`; };
  for (let i = 0; i < steps.length;) {
    prog(i);
    const v = await steps[i]();
    if (v === BACK) { if (i === 0) { if (progress === true) PROGRESS = ''; return BACK; } i--; continue; }
    i++;
  }
  if (progress === true) PROGRESS = '';
  const localAgents = readLocal(root).agents || {};
  const conf = { agent, args: String(args || '').split(/\s+/).filter(Boolean), agents: localAgents };
  writeLocal(root, conf);
  runWorkspaceKit(root, ['sync', '--quiet']); // 프로필이 바뀌면 역할 에이전트 파일도 바뀐다
  p.log.success(`저장: ${path.relative(process.cwd(), localConfigPath(root)) || kit.LOCAL_CONFIG} (이 PC 전용, git 공유 안 함)`);
  if (!installed[agent]) p.log.warn(`${AGENTS[agent].command} 가 설치돼 있지 않습니다. ${AGENTS[agent].install}`);
  if (agent === 'codex') p.log.info('Codex 는 처음 실행할 때 이 프로젝트를 trusted 로 지정하고, /hooks 에서 훅을 신뢰해야 합니다.');
  if (agent === 'claude') p.log.info('Claude Code 는 처음 실행할 때 이 폴더 신뢰 확인을 수락해야 훅·설정이 적용됩니다.');
  return conf;
}

// ───────────────────────── init (선택 화면) ─────────────────────────

function packChoices() {
  const dir = path.join(KIT_ROOT, 'packs');
  return fs.readdirSync(dir)
    .filter((n) => fs.existsSync(path.join(dir, n, 'pack.json')))
    .map((n) => ({ name: n, meta: JSON.parse(read(path.join(dir, n, 'pack.json'))) }));
}

/** 주소 목록(쉼표·공백·줄바꿈)을 repos 항목으로. 이름은 주소 끝 폴더명, git 주소가 아니고 있는 폴더면 링크 */
function parseRepoList(text, kind, root, taken) {
  const role = { code: undefined, docs: '기획·요구사항 문서', legacy: 'AS-IS 소스 (읽기 전용)' }[kind];
  return (Array.isArray(text) ? text : String(text || '').split(/[\s,]+/)).map((x) => String(x).trim()).filter(Boolean).map((v) => {
    const fresh = v.startsWith(NEW_PREFIX);
    let name = path.basename(v.replace(NEW_PREFIX, '').replace(/\/+$/, '')).replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '-') || kind;
    for (let n = 2; taken.includes(name); n++) name = `${name.replace(/-\d+$/, '')}-${n}`;
    taken.push(name);
    const repo = { name, kind };
    if (role) repo.role = role;
    if (fresh) repo.local = true; // 원격 없이 repos/<이름> 에 새로 만든다 — origin 을 달면 sync 가 remote 로 옮긴다
    else if (kit.isGitUrl(v)) repo.remote = v;
    else repo.path = path.relative(root, path.resolve(v)).split(path.sep).join('/');
    // md 사본 폴더: 새로 만드는 repo(견본에 md/ 가 있다) · 원격 repo 는 md, 기존 로컬 폴더는 md/ 가 있을 때만 (없는 폴더를 적으면 doctor 가 경고한다)
    if (kind === 'docs' && (fresh || repo.remote || fs.existsSync(path.join(path.resolve(v), 'md')))) repo.mdPath = 'md';
    return repo;
  });
}


// 유형별로 묻는 repo 가 다르다 — code/legacy 가 null 이면 묻지 않는다
const TYPE_FLOW = {
  new: { hint: '새 시스템을 처음 만든다',
    guide: ['근거: 기획 문서',
      '넣는 것: 개발 repo (없으면 이름만, 새로 만듦) · 기획 repo · 이슈 repo',
      'AI 가 하는 일: 기획 문서를 근거로 설계·구현. 요구사항 ID 를 작업 기록·커밋에 남긴다'],
    code: { message: '프로젝트 repository 주소', hint: '에이전트가 고칠 소스코드 repo 입니다. 원격 없이 로컬에만 있으면 기존 로컬 폴더, 아직 없으면 새로 만들기 (repos/<이름> 에 git init).', required: false, allowNew: true }, docs: '기획 문서 repo', legacy: null },
  modernization: { hint: '옛 시스템(AS-IS)을 새로 만든다',
    guide: ['근거: 기획 문서 + AS-IS 소스',
      '넣는 것: 새 개발 repo · AS-IS 소스 (읽기 전용, 필수) · 기획 repo',
      'AI 가 하는 일: AS-IS 를 분석해 TO-BE 로 옮긴다. 현행 동작의 근거를 AS-IS 파일:라인으로 단다'],
    code: { message: '프로젝트 repository 주소', hint: '새로 만들 TO-BE 소스코드 repo 입니다. 원격 없이 로컬에만 있으면 기존 로컬 폴더, 아직 없으면 새로 만들기 (repos/<이름> 에 git init).', required: false, allowNew: true }, docs: '기획 문서 repo',
    legacy: { message: '레거시(AS-IS) repository 주소', hint: '읽기 전용 근거로 쓰는 AS-IS 소스입니다. 1개 이상 필요합니다.', required: true } },
  enhancement: { hint: '운영 중인 시스템을 고치고 늘린다 (고도화 · 유지보수)',
    guide: ['근거: 운영 중인 코드 + 개선 요구사항 · 이슈 티켓',
      '넣는 것: 운영 중인 개발 repo (필수) · 이슈·티켓 repo · 개선 요구사항 문서 repo',
      'AI 가 하는 일: 기존 관례를 먼저 찾아 따르고, 티켓 단위로 영향 범위를 적은 뒤 고친다'],
    code: { message: '프로젝트 repository 주소', hint: '운영 중인 기존 시스템의 소스코드 repo 입니다. 원격 없이 로컬에만 있으면 기존 로컬 폴더. 1개 이상 필요합니다.', required: true }, docs: '개선 요구사항·업무 문서 repo', legacy: null },
  consulting: { hint: '구축 전에 현행을 분석하고 설계 문서를 만든다 (ISP · ISMP · 제안)',
    guide: ['근거: 현행 자료 · 인터뷰. 결과물은 문서이고 코드는 고치지 않는다',
      '넣는 것: 산출물(문서) repo (kedovi init-docs 로 뼈대) · 현행 소스 (선택, 읽기 전용)',
      'AI 가 하는 일: 근거 달린 현행 분석 · 요구사항 정의서 (ID · 수용 기준) · 목표 모델 · 이행 계획',
      '다음: 이 산출물 repo 를 구축 워크스페이스의 기획 repo 로 등록하면 요구사항 ID 가 그대로 이어진다'],
    code: null, docs: '산출물(문서) repo',
    legacy: { message: '현행 시스템 repository 주소', hint: '분석할 현행 소스입니다(읽기 전용).', required: false } },
};

/** 한 줄 가로 선택 — [추가] [확정] 같은 짧은 선택 */
async function chooseInline({ message, hint, options, initialValue }) {
  const { SelectPrompt } = require('@clack/core');
  const { styleText } = require('util');
  const pr = clack();
  return runPrompt(new SelectPrompt({
    options, initialValue,
    render() {
      const st = this.state;
      const bar = styleText(barColor(st), pr.S_BAR);
      const top = frame(pr, st, message, hint, bar);
      const cur = this.options[this.cursor];
      if (st === 'submit') return `${top}${bar}  ${styleText('dim', `> ${cur.label}`)}`;
      if (st === 'cancel') return `${top}${endLine(this, st, bar, `> ${cur.label}`)}`;
      const row = this.options.map((o, i) => (i === this.cursor ? `${styleText('cyan', '●')} ${o.label}` : styleText('dim', `○ ${o.label}`))).join('   ');
      return `${top}${bar}  ${row}\n${bar}  ${styleText('gray', '←/→ 선택 · Enter 확정 · Esc 뒤로')}\n${styleText('cyan', pr.S_BAR_END)}\n`;
    },
  }));
}

// 원격 없이 새로 만들 repo — 목록 안에서는 new:<이름> 으로 들고 다닌다 (bin/kit.js init --code new:<이름> 과 같은 표기)
const NEW_PREFIX = 'new:';
const NEW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 입력 하나를 목록 값으로 — allowNew 면 있는 폴더가 아닌 이름은 새로 만들 repo */
const asEntry = (x, allowNew) => (allowNew && NEW_NAME.test(x) && !kit.isGitUrl(x) && !fs.existsSync(path.resolve(x)) ? `${NEW_PREFIX}${x}` : x);

/** 주소 하나 검사 — git 주소거나 있는 폴더(allowNew 면 새로 만들 이름도), 이미 넣은 것과 겹치지 않게 */
const validateOne = (taken, required, allowNew) => (v) => {
  const x = String(v || '').trim();
  if (!x) return required && !taken.length ? '1개 이상 필요합니다' : undefined;
  if (/[\s,]/.test(x)) return '주소는 하나씩 입력합니다';
  const e = asEntry(x, allowNew);
  if (!e.startsWith(NEW_PREFIX) && !kit.isGitUrl(x) && !fs.existsSync(path.resolve(x))) return allowNew ? `git 주소·있는 폴더·새 이름(영문·숫자·._-) 중 하나가 아닙니다: ${x}` : `git 주소도, 있는 폴더도 아닙니다: ${x}`;
  if (taken.includes(e) || taken.map(repoNameOf).includes(repoNameOf(e))) return '이미 넣은 주소·이름입니다';
  return undefined;
};

/** ~ 로 시작하는 경로를 홈 폴더로 */
const expandHome = (x) => (/^~(?=$|[\\/])/.test(x) ? path.join(require('os').homedir(), x.slice(1)) : x);
const isFolder = (x) => { try { return fs.statSync(path.resolve(expandHome(x))).isDirectory(); } catch { return false; } };

/** repo 를 넣는 방식 — clone(git 주소) · 기존 로컬 폴더(링크) · 새로 만들기(git init). 원격 없이 로컬에만 둔 repo 는 기존 폴더로 넣는다 */
const REPO_METHODS = {
  clone: { label: 'clone (git 주소)', ask: 'git 주소', placeholder: '예: https://gitlab.example.com/group/repo.git',
    check: (x) => (kit.isGitUrl(x) ? undefined : `git 주소가 아닙니다: ${x}`), entry: (x) => x },
  link: { label: '기존 로컬 폴더', ask: '폴더 경로', placeholder: '예: ~/projects/shop/repos/shop-docs (원격 없이 로컬에서만 커밋하는 repo 도 됨)',
    check: (x) => (isFolder(x) ? undefined : `있는 폴더가 아닙니다: ${x}`), entry: (x) => path.resolve(expandHome(x)) },
  new: { label: '새로 만들기 (git init)', ask: '새 repo 이름', placeholder: '예: my-api (repos/<이름> 에 원격 없이 만듦)',
    check: (x) => (NEW_NAME.test(x) ? undefined : `이름은 영문·숫자·._- 로 씁니다: ${x}`), entry: (x) => `${NEW_PREFIX}${x}` },
};
const methodOf = (e) => (String(e).startsWith(NEW_PREFIX) ? 'new' : kit.isGitUrl(e) ? 'clone' : 'link');

/**
 * repo 하나 받기 — 방식(clone · 기존 폴더 · 새로 만들기)을 먼저 고르고 값을 넣는다. 반환: 목록 값 · BACK · SKIP(없음)
 * Esc: 값 입력에서는 방식 선택으로, 방식 선택에서는 BACK
 */
const SKIP = Symbol('kedovi:skip');
async function askRepo({ message, hint, allowNew, taken = [], skippable = false, method, draft = '' }) {
  for (;;) {
    const options = [...Object.entries(REPO_METHODS).filter(([k]) => allowNew || k !== 'new').map(([value, m]) => ({ value, label: m.label })),
      ...(skippable ? [{ value: 'skip', label: '없음' }] : [])];
    const how = await chooseInline({ message, hint, options, initialValue: method || 'clone' });
    if (how === BACK || clack().isCancel(how)) return how;
    if (how === 'skip') return SKIP;
    const m = REPO_METHODS[how];
    const v = await input({
      message: `${message}: ${m.ask}`, placeholder: m.placeholder, initialValue: methodOf(draft) === how ? String(draft).replace(NEW_PREFIX, '') : '',
      validate: (raw) => {
        const x = String(raw || '').trim();
        if (!x) return `${m.ask}을(를) 넣습니다. Esc 는 방식 선택으로`;
        if (/[\s,]/.test(x) && how !== 'link') return '하나씩 입력합니다';
        const bad = m.check(x);
        if (bad) return bad;
        const e = m.entry(x);
        if (taken.includes(e) || taken.map(repoNameOf).includes(repoNameOf(e))) return '이미 넣은 주소·이름입니다';
        return undefined;
      },
    });
    if (v === BACK) { method = how; continue; }
    if (clack().isCancel(v)) return v;
    return m.entry(String(v).trim());
  }
}

/**
 * repo 를 하나씩 받는다 — 방식 → 값 → [추가][확정] → 추가면 다음. 선택 항목은 첫 방식 선택에 "없음" 이 있다.
 * Esc: 값 입력이면 방식 선택으로, 방식 선택이면 직전 [추가][확정] 으로(처음이면 이전 질문 = BACK).
 */
async function collectAddresses({ message, hint, required, allowNew = false, initial = [], others = [] }) {
  const list = [...initial];
  let asking = list.length === 0;
  let draft = '';
  for (;;) {
    if (asking) {
      const last = list.length ? list[list.length - 1] : draft;
      const v = await askRepo({
        message: list.length ? `${message} (${list.length + 1}번째)` : message,
        hint: list.length ? listHint(list) : hint,
        allowNew, taken: [...list, ...others], skippable: !required && !list.length, method: last ? methodOf(last) : undefined, draft,
      });
      draft = '';
      if (v === BACK) { if (!list.length) return BACK; asking = false; continue; }
      if (clack().isCancel(v)) return v;
      if (v === SKIP) return list;
      list.push(v);
    }
    // 가져온 것만 있으면 「그대로 확정」 이 기본: 같은 repo 를 다시 넣지 않게 (넣어도 주소 · 이름이 같으면 막는다)
    const onlyGot = list.every((v) => IMPORTED.has(v));
    const next = await chooseInline({
      message, hint: onlyGot ? `${listHint(list)}. 분석·설계 워크스페이스에서 가져왔습니다. 다른 repo 가 더 있을 때만 추가` : listHint(list),
      options: [{ value: 'add', label: onlyGot ? '추가 등록' : '추가' }, { value: 'done', label: onlyGot ? '확정 (가져온 그대로)' : '확정' }], initialValue: 'done',
    });
    if (next === BACK) { draft = list.pop(); asking = true; continue; } // 마지막 값을 고쳐 쓰게
    if (clack().isCancel(next)) return next;
    if (next === 'done') return list;
    asking = true;
  }
}
const repoNameOf = (v) => path.basename(String(v).replace(NEW_PREFIX, '').replace(/\/+$/, '')).replace(/\.git$/, '');
const repoLabelOf = (v) => `${repoNameOf(v)}${String(v).startsWith(NEW_PREFIX) ? '(새로 만듦)' : methodOf(v) === 'link' ? '(로컬 폴더)' : ''}`;
/** 분석·설계 워크스페이스에서 가져온 값 (takeFrom). 목록 안내에서 새로 넣은 것과 나눠 보인다 */
const IMPORTED = new Set();
/** 목록 안내: 「가져옴 n개: … · 새로 등록: …」 (가져온 것이 많으면 앞 5개만) */
function listHint(list) {
  const got = list.filter((v) => IMPORTED.has(v)).map(repoNameOf);
  const mine = list.filter((v) => !IMPORTED.has(v)).map(repoLabelOf);
  if (!got.length) return `등록: ${mine.join(', ')}`;
  return [`가져옴 ${got.length}개: ${got.slice(0, 5).join(', ')}${got.length > 5 ? ' …' : ''}`, ...(mine.length ? [`새로 등록: ${mine.join(', ')}`] : [])].join(' · ');
}

/** 분석·설계 워크스페이스의 repo 를 init 목록에 채운다: 기획 · 이슈(· 레거시 질문이 있는 유형은 현행). 원격이 있으면 주소, 없으면 그 폴더 경로(링크) */
function takeFrom(a, fl) {
  let ws;
  try { ws = kit.loadWorkspace(a.from); } catch { return; }
  const put = (list, v) => { if (v && !list.includes(v)) list.push(v); if (v) IMPORTED.add(v); };
  const left = [];
  const missing = [];
  const linked = [];
  for (const r of ws.repos || []) {
    const local = path.join(a.from, kit.repoRel(r));
    const v = r.remote || (fs.existsSync(local) ? fs.realpathSync(local) : null);
    if (!v) { missing.push(r.name); continue; }
    if (!r.remote && (r.kind === 'docs' || r.kind === 'issues' || (r.kind === 'legacy' && fl.legacy) || (r.kind === 'code' && fl.code))) linked.push(r.name);
    if (r.kind === 'docs') put(a.docs, v);
    else if (r.kind === 'issues') put(a.issues, v);
    else if (r.kind === 'legacy' && fl.legacy) put(a.legacy, v);
    else if (r.kind === 'code' && fl.code) put(a.code, v);
    else left.push(r.name);
  }
  p.log.info([`${(ws.project || {}).title || path.basename(a.from)} 에서 가져옴: 기획 ${a.docs.length} · 이슈 ${a.issues.length}${fl.legacy ? ` · 현행 ${a.legacy.length}` : ''}`,
    ...(left.length ? [`현행 repo ${left.length}개 (${left.slice(0, 5).join(', ')}${left.length > 5 ? ' …' : ''}): 고칠 repo 는 프로젝트 repository 에 넣습니다`] : []),
    ...(missing.length ? [`원격도 받은 폴더도 없어 건너뜀: ${missing.join(', ')}`] : []),
    ...(linked.length ? [`원격 없는 repo ${linked.join(', ')} 는 링크로 함께 씁니다: 두 워크스페이스가 같은 파일을 고친다. 문서 사이트 · 커밋 훅은 ${path.basename(a.from)} 쪽 것을 쓴다 (따로 쓰려면 원격을 만들어 clone 으로)`] : [])].join('\n'));
}

async function cmdInit(argv) {
  if (!process.stdin.isTTY) fail('대화형 화면은 터미널에서만 됩니다. 스크립트에서는 node <킷>/bin/kit.js init <폴더> --type … 를 쓰세요');
  clack();
  p.intro(' kedovi init ');
  p.log.info('순서: 프로젝트명 → 시작 유형 → repo 주소 (유형에 따라 2~3개) → 확인 → 생성 → 스택 확인 → 규칙 확인 → 쓰는 AI → 모델 프로필 → 실행 인자 → 워크스페이스 repo 원격 · 커밋·push. Esc 는 이전 질문');
  const cwd = process.cwd();
  const usable = (d) => ['missing', 'empty', 'fresh-repo'].includes(kit.folderState(d));
  // 막 clone 한 repo(README 등만 있음) 안에서 실행하면 그 폴더가 워크스페이스다 — 이름과 무관
  // 인자는 프로젝트명 하나. 지금 폴더가 막 clone 한 repo 나 빈 폴더면 그 자리에, 아니면 지금 폴더 아래 <이름> 에 만든다
  const given = argv[0] || '';
  if (given && !/^[a-z][a-z0-9-]*$/.test(given)) fail(`프로젝트명은 영문 소문자·숫자·'-' 로 쓰고 문자로 시작합니다: ${given}`);
  const here = ['empty', 'fresh-repo'].includes(kit.folderState(cwd)) && path.basename(cwd) !== '' ? cwd : null;
  const targetOf = (name) => (here && (kit.folderState(cwd) === 'fresh-repo' || path.basename(cwd) === name) ? cwd : path.resolve(cwd, name));
  const a = { title: given, type: undefined, approach: undefined, from: '', code: [], docs: [], issues: [], legacy: [], hosts: {}, pages: false };
  const flow = () => TYPE_FLOW[a.type || 'new'];
  // 다른 목록에 이미 넣은 값 (같은 repo 를 두 종류로 넣지 않게)
  const othersOf = (kind) => ['code', 'docs', 'issues', 'legacy'].filter((k) => k !== kind).flatMap((k) => a[k]);

  // 단계 — when 이 거짓이면 건너뛴다 (앞으로·뒤로 모두). Esc 는 이전 단계, 첫 단계에서 Esc 는 취소
  const steps = [
    { run: async () => input({
      message: '프로젝트명', hint: "영문 소문자, '-'만 입력 가능하며 문자로 시작해야 합니다.",
      placeholder: 'my-project', initialValue: a.title,
      validate: (v) => {
        if (!v) return '이름을 입력하세요';
        if (!kit.PROJECT_NAME.test(v)) return kit.PROJECT_NAME_RULE;
        const dir = targetOf(v);
        const st = kit.folderState(dir);
        if (st === 'workspace') return `${dir} 는 이미 워크스페이스입니다 (kedovi remove 로 비우거나 다른 이름)`;
        if (!usable(dir)) return `${dir} 에 다른 파일이 있습니다. 빈 폴더나, README 만 있는 막 만든 repo 에서 만드세요`;
        return undefined;
      },
    }), set: (v) => { a.title = v; p.log.info(`워크스페이스 폴더: ${targetOf(v)}${kit.folderState(targetOf(v)) === 'fresh-repo' ? ' (clone 한 repo 에 만든다)' : ''}`); } },
    { run: async () => choose({
      message: '시작 유형', hint: '프로젝트 성격에 맞게 고르세요. 유형에 따라 에이전트가 삼는 근거와 규칙이 달라집니다.',
      initialValue: a.type,
      options: Object.keys(TYPE_FLOW).map((k) => ({ value: k, label: kit.PROJECT_TYPES[k], hint: TYPE_FLOW[k].hint, detail: TYPE_FLOW[k].guide })),
    }), set: (v) => { a.type = v; } },
    // 신규 구축: 아이디어 · 전체 그림 다음에 MVP 부터 하나씩(스프린트)인지, 전체 설계 뒤 구축(워터폴)인지
    { when: () => a.type === 'new', run: async () => choose({
      message: '개발 방식', hint: '두 방식 모두 아이디어 · 전체 그림(무엇을 왜 만드는지 대화)부터 시작합니다. 나중에 kedovi approach 로 바꿉니다.',
      initialValue: ['sprint', 'full'].includes(a.approach) ? a.approach : kit.TYPE_RULES.new.approach, // 운영·고도화에서 고른 이슈형이 남아 있으면 기본값
      options: [{ value: 'sprint', label: 'MVP · 스프린트 (권장)', hint: '끝까지 동작하는 최소 기능부터, 스프린트마다 데모하며 하나씩 붙인다' },
        { value: 'full', label: '워터폴 · 전체', hint: '요구사항 → 설계 → 구현 → 테스트 → 배포를 한 번에' }],
    }), set: (v) => { a.approach = v; } },
    // 운영·고도화: 이슈마다 운영 반영(운영 · 유지보수)인지, 기능 묶음을 오픈까지 진행(고도화)인지 → 로드맵 모양이 다르다
    { when: () => a.type === 'enhancement', run: async () => choose({
      message: '진행 방식', hint: '운영 · 유지보수는 이슈마다 운영에 반영하므로 이슈형, 기능 묶음을 요구사항부터 오픈까지 진행하는 고도화는 스프린트 또는 전체입니다. 나중에 kedovi approach 로 바꿉니다.',
      initialValue: a.approach || kit.TYPE_RULES.enhancement.approach,
      options: [{ value: 'issue', label: '이슈형 (운영 · 유지보수)', hint: '단계 대신 이슈 보드: 이슈마다 접수 · 분석 · 수정 · 검증 · 운영 반영' },
        { value: 'sprint', label: 'MVP · 스프린트 (고도화)', hint: '기능 단위로 데모하며 하나씩' },
        { value: 'full', label: '워터폴 · 전체 (고도화)', hint: '요구사항 → 설계 → 구현 → 테스트 → 오픈' }],
    }), set: (v) => { a.approach = v; } },
    // 분석·설계 워크스페이스에서 이어 만들기: 그 기획 · 이슈 repo 를 그대로 가져온다 (현행 repo 는 목록만)
    { when: () => a.type !== 'consulting', run: async () => yesNo({
      message: '분석·설계 워크스페이스에서 이어 만들까요?', hint: '분석 · 설계를 끝낸 워크스페이스가 있으면 그 기획 · 이슈 repo 를 그대로 가져옵니다. 요구사항 ID 가 이어집니다.', initialValue: !!a.from,
    }), set: (v) => { a.from = v === true ? a.from || ' ' : ''; } },
    { when: () => a.type !== 'consulting' && !!a.from, run: async () => input({
      message: '분석·설계 워크스페이스 폴더', placeholder: '예: ~/projects/shop-isp', initialValue: a.from.trim(),
      validate: (x) => { const d = path.resolve(expandHome(String(x || '').trim())); return x && kit.folderState(d) === 'workspace' ? undefined : `워크스페이스 폴더가 아닙니다 (workspace.json 이 없음): ${x || ''}`; },
    }), set: (v) => { a.from = path.resolve(expandHome(String(v).trim())); takeFrom(a, flow()); } },
    { when: () => !!flow().code, run: async () => collectAddresses({
      message: flow().code.message, hint: flow().code.hint, required: flow().code.required, allowNew: !!flow().code.allowNew, initial: a.code, others: othersOf('code'),
    }), set: (v) => { a.code = v; } },
    { run: async () => collectAddresses({
      message: '기획 repository 주소', hint: '요구사항의 근거가 되는 문서 repo 입니다. 분석 워크스페이스의 산출물 repo 가 로컬에만 있으면 기존 로컬 폴더 (뼈대는 kedovi init-docs).', required: false, allowNew: true, initial: a.docs, others: othersOf('docs'),
    }), set: (v) => { a.docs = v; } },
    { when: () => a.docs.length > 0, run: async () => yesNo({
      message: '기획 문서 사이트를 Pages 로 올릴까요?', hint: '기획 repo 의 docs-site/ 를 GitLab · GitHub Pages 로 공개합니다. 서버에 Pages · 러너가 있어야 합니다 (GitHub 비공개 repo 는 유료). 나중에 kedovi docs pages on | off 로 바꿀 수 있습니다.',
      initialValue: a.pages,
    }), set: (v) => { a.pages = v === true; } },
    { run: async () => collectAddresses({
      message: '이슈 repository 주소', hint: '이슈·확인 요청·테스트 결과 문서를 쓰는 repo 입니다.', required: false, allowNew: true, initial: a.issues, others: othersOf('issues'),
    }), set: (v) => { a.issues = v; } },
    { when: () => !!flow().legacy, run: async () => collectAddresses({
      message: flow().legacy.message, hint: flow().legacy.hint, required: flow().legacy.required, initial: a.legacy, others: othersOf('legacy'),
    }), set: (v) => { a.legacy = v; } },
    { when: () => unknownHosts().length > 0, run: async () => {
      for (const h of unknownHosts()) {
        const v = await choose({
          message: `${h} 의 협업 도구`, hint: '주소만으로는 GitHub 인지 GitLab 인지 알 수 없는 호스트입니다. MR·PR 규칙이 여기에 따라 붙습니다.',
          initialValue: a.hosts[h] || 'gitlab',
          options: [{ value: 'gitlab', label: 'GitLab', hint: 'MR 규칙·생성 스킬' }, { value: 'github', label: 'GitHub', hint: 'PR 규칙·생성 스킬' }, { value: 'none', label: '기타·없음', hint: '협업 규칙 없이' }],
        });
        if (v === BACK || clack().isCancel(v)) return v;
        a.hosts[h] = v;
      }
      return a.hosts;
    }, set: () => {} },
    { run: async () => {
      p.note(summary().join('\n'), '만들 내용');
      return yesNo({ message: '이대로 만들까요?', hint: '예를 누르면 워크스페이스를 만들고 repo 를 clone 합니다.' });
    }, set: (v) => { if (!v) { p.cancel('만들지 않았습니다'); process.exit(0); } } },
  ];

  const root = () => targetOf(a.title);
  // 주소별 협업 도구 — github.com·gitlab 이 든 호스트는 자동, 로컬 폴더는 그 origin, 나머지는 물어본 값
  const hostName = (v) => (String(v).match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i) || [])[1];
  const isRemote = (v) => /^(https?:\/\/|ssh:\/\/|git:\/\/|[^@\s/]+@[^:\s]+:)/.test(String(v));
  const hostFor = (v) => {
    if (String(v).startsWith(NEW_PREFIX)) return null; // 원격이 생기면 sync 가 주소로 정한다
    if (isRemote(v)) return kit.inferHost(v) || a.hosts[hostName(v)] || null;
    return kit.hostOf(cwd, { path: path.resolve(v) }) || null; // 로컬 폴더·bare repo 는 그 origin
  };
  const unknownHosts = () => [...new Set([...a.code, ...a.issues].filter((v) => isRemote(v) && !kit.inferHost(v)).map(hostName).filter(Boolean))];
  const repos = () => {
    const taken = [];
    const withHost = (list, kind) => parseRepoList(list, kind, root(), taken).map((r, i) => {
      if (kind === 'code' || kind === 'issues') { const h = hostFor(list[i]); if (h) r.host = h; }
      return r;
    });
    return [...(flow().code ? withHost(a.code, 'code') : []), ...withHost(a.docs, 'docs'), ...withHost(a.issues, 'issues'),
      ...(flow().legacy ? withHost(a.legacy, 'legacy') : [])];
  };
  const summary = () => {
    const typePack = kit.TYPE_RULES[a.type].pack;
    const rs = repos();
    return [
      `폴더   ${root()}`,
      `유형   ${kit.PROJECT_TYPES[a.type]}${['enhancement', 'new'].includes(a.type) && a.approach ? ` · 진행 방식 ${kit.APPROACHES[a.approach].split(' (')[0]}` : ''}`,
      ...(a.from ? [`이어 받음 ${a.from}`] : []),
      `규칙   core${typePack ? `, ${typePack} (유형)` : ''} + repo 마다 스택·협업 도구 규칙`,
      ...(rs.length ? rs.map((r) => `repos/${r.name.padEnd(16)} ${padTo(kit.REPO_KINDS[r.kind], 14)} ${padTo(r.host ? kit.HOSTS[r.host] : '', 7)} ← ${r.remote || r.path || '새로 만듦 (원격 없음, git init)'}`) : ['repo   (없음: 나중에 workspace.json 에 추가)']),
      ...(a.docs.length ? [`Pages  ${a.pages ? '켬: 기획 repo 에 원격에 맞는 CI 파일을 두고 docs-site/ 를 커밋한다' : '끔 (나중에 kedovi docs pages on)'}`] : []),
      '스택은 repo 를 받은 뒤 감지한다. 역할·브랜치는 workspace.json 에서 고친다',
    ];
  };

  const runnable = (k) => !steps[k].when || steps[k].when();
  let k = 0;
  while (k < steps.length) {
    if (!runnable(k)) { k++; continue; }
    const order = steps.map((s, i) => i).filter(runnable);
    PROGRESS = `${order.indexOf(k) + 1}/${order.length + postSteps(targetOf(a.title || given))}`;
    const v = await steps[k].run();
    if (v === BACK) {
      let prev = k - 1;
      while (prev >= 0 && !runnable(prev)) prev--;
      if (prev < 0) { p.cancel('취소했습니다'); process.exit(0); }
      k = prev;
      continue;
    }
    if (clack().isCancel(v)) { p.cancel('취소했습니다'); process.exit(0); }
    steps[k].set(v);
    k++;
  }

  // 확정 뒤에만 밖에 무언가를 만든다 — 뒤로 가거나 "아니오" 면 아무것도 남지 않는다
  const dir = root();
  // 진행 표시(spinner)는 쓰지 않는다: 생성 · clone 이 동기라 멈춘 것처럼 보인다. repo 는 하나씩 끝나는 대로 찍고 clone 중에는 진행 한 줄이 돈다
  const rs = repos();
  p.log.step(rs.some((r) => r.remote) ? `워크스페이스 생성 · repo clone (${rs.filter((r) => r.remote).length}개)` : '워크스페이스 생성');
  const log = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...x) => log.push(x.join(' '));
  let res;
  try { res = kit.initWorkspace({ dir, name: a.title, title: a.title, type: a.type, approach: ['enhancement', 'new'].includes(a.type) ? a.approach : undefined, packs: [], repos: rs, out: (l) => process.stdout.write(`${l}\n`) }); }
  finally { Object.assign(console, orig); }
  remember(dir);
  p.log.success(res.ok ? '생성 완료' : '생성은 했지만 확인할 것이 있습니다');
  if (res.approach) p.log.info(`진행 방식: ${kit.APPROACHES[res.approach]}. 바꾸기: kedovi approach ${Object.keys(kit.APPROACHES).filter((k) => k !== res.approach).join(' | ')}`);
  if (a.pages) {
    const tool = path.join(dir, 'packs', 'core', 'bin', 'docs-site.js');
    const r = fs.existsSync(tool) ? spawnSync(process.execPath, [tool, 'pages', 'on'], { cwd: dir, encoding: 'utf8' }) : null;
    if (r) p.log.info(`Pages\n${(r.stdout + r.stderr).trim()}\n기획 repo 의 바뀐 파일(CI · .gitignore)은 그 repo 에서 커밋 · push 한다`);
  }
  p.log.message(log.filter((l) => l.trim() && !l.includes('스택 감지')).join('\n'));
  // clone 은 인증을 묻지 않게 막고 돌린다 (진행 표시 뒤에서 멈추지 않게). 직접 git clone 하면 되는 repo 가 여기서 빠질 수 있어,
  // 받지 못한 repo 를 바로 보이고 인증을 물을 수 있는 git clone 으로 다시 받을지 묻는다 (스택 확인 전에)
  const failed = () => { try { return kit.loadWorkspace(dir).repos.filter((r) => r.remote && kit.repoSafe(r) && !fs.existsSync(path.join(dir, r.dir))); } catch { return []; } };
  if (failed().length) {
    const first = repoStatus(dir, res.repos || []);
    if (first) p.note(first.text, first.title);
    const again = await yesNo({ message: `받지 못한 repo ${failed().length}개를 지금 다시 받을까요?`, hint: 'git clone 을 그대로 실행합니다. 인증을 물으면 입력하세요. 아니오면 나중에 kedovi install.', initialValue: true });
    if (again === true) {
      for (const r of failed()) {
        p.log.step(`git clone ${r.remote}`);
        const c = spawnSync('git', ['clone', ...(r.branch ? ['-b', r.branch] : []), '--', r.remote, path.join(dir, r.dir)], { stdio: 'inherit' });
        const x = (res.repos || []).find((y) => y.name === r.name);
        if (c.status === 0 && x) Object.assign(x, { state: 'cloned', note: r.remote });
        if (c.status !== 0) p.log.warn(`${r.name}: 받지 못했습니다. 주소 · 권한을 확인한 뒤 kedovi install`);
      }
      runWorkspaceKit(dir, ['sync', '--quiet']); // 받은 repo 의 스택 감지 · 훅
    }
  }
  abortNote = `워크스페이스는 만들어졌습니다 (${dir}). 스택은 감지 결과대로 저장돼 있으니 kedovi detect 로 고치고, 에이전트는 kedovi agent 로 고르세요`;
  // 만든 뒤의 질문(스택 → 규칙 확인 → 에이전트)도 Esc 로 이전 화면에 돌아간다. 첫 화면에서 Esc 는 취소 (워크스페이스는 남는다)
  const preCount = steps.filter((s, i) => runnable(i)).length;
  const total = preCount + postSteps(dir);
  const remoteOf = () => spawnSync('git', ['-C', dir, 'remote'], { encoding: 'utf8' }).stdout.trim();
  let pushed = false;
  // n = 만든 뒤 몇 번째 질문인지 (쓰는 AI · 프로필 · 메인 모델 · 인자는 chooseAgent 안에서 3 · 4 · 5 · 6)
  // 워크스페이스 repo 는 작업 기록(handoffs/) · workspace.json 이 올라가므로 비공개여야 한다. 공개 repo 면 한 번 더 묻는다 (기본 아니오)
  const checkedPublic = new Set();
  const privateOk = async (url, onNo = '아니오면 주소를 다시 묻습니다.') => {
    checkedPublic.add(url);
    const pub = require(path.join(KIT_ROOT, 'packs', 'core', 'lib', 'visibility.js')).isPublic(url);
    if (pub === null) { p.log.warn('이 repo 가 공개인지 확인하지 못했습니다 (주소 · 네트워크). 공개 repo 면 작업 기록이 누구에게나 보이니 비공개인지 직접 확인하세요'); return true; }
    if (!pub) { p.log.info('비공개 repo 입니다 (로그인 없이 받을 수 없음)'); return true; }
    return yesNo({ message: '공개 repo 입니다. 그래도 워크스페이스 repo 로 쓸까요?', hint: `작업 기록(handoffs/: 명령 결과 · 로그 · 경로) · workspace.json(repo 주소 · 설정)이 누구에게나 보입니다. 비공개로 바꾼 뒤 다시 넣는 것을 권합니다. ${onNo}`, initialValue: false });
  };
  const after = [
    { n: 1, run: () => reviewStacks(dir, { force: true }) },
    { n: 2, run: async () => { // 규칙 확인 (선택) — 킷이 넣은 규칙 중 우리 팀에 안 맞는 것을 끈다. 나중에 kedovi rules
      for (;;) {
        const look = await yesNo({ message: '킷이 넣은 규칙을 지금 확인할까요?', hint: '팀에 맞지 않는 규칙을 끌 수 있습니다. 나중에 kedovi rules 로도 됩니다.', initialValue: false });
        if (look === BACK || clack().isCancel(look)) return BACK;
        if (look !== true) return true;
        if ((await chooseRules(dir)) !== BACK) return true; // 규칙 화면에서 Esc 면 이 질문으로
      }
    } },
    // 쓰는 AI · 팀 기본 프로필 · 메인 모델 · 이 PC 의 실행 인자 (3 · 4 · 5 · 6). 만든 사람이 바로 kedovi start 하므로 인자도 여기서 받는다
    { n: 3, run: () => chooseAgent(dir, { force: true, askArgs: true, profileScope: 'team', progress: { at: preCount + 3, total } }) },
    // 워크스페이스 repo 원격 — 여기까지 해야 팀원이 clone 할 수 있다
    ...(remoteOf() ? [] : [{ n: 7, run: async () => {
      let u;
      for (;;) {
        const url = await input({ message: '워크스페이스 repository 주소', hint: 'GitLab·GitHub 에 만든 빈 비공개 repo 주소 (작업 기록 handoffs/ · workspace.json 이 올라간다). 없으면 Enter (나중에 git remote add origin <주소>)', validate: (x) => (!x || kit.isGitUrl(String(x).trim()) ? undefined : 'git 주소 형식 (https://… 또는 git@…)') });
        if (url === BACK || clack().isCancel(url)) return BACK;
        u = String(url || '').trim();
        if (!u) break;
        const ok = await privateOk(u);
        if (ok === BACK || clack().isCancel(ok)) return BACK;
        if (ok) break;
      }
      if (u && !remoteOf()) { const r = spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', u], { encoding: 'utf8' }); if (r.status !== 0) p.log.warn(`원격을 못 붙였습니다: ${(r.stderr || '').trim()}`); }
      return true;
    } }]),
    { n: remoteOf() ? 7 : 8, run: async () => {
      if (!remoteOf()) return true;
      // 이미 원격이 있던 경우(clone 한 repo 에 만들었을 때)도 공개 repo 인지 본다. 주소 질문에서 확인한 주소면 다시 묻지 않는다
      const origin = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout.trim();
      if (origin && !checkedPublic.has(origin)) {
        const ok = await privateOk(origin, '아니오면 push 하지 않습니다.');
        if (ok === BACK || clack().isCancel(ok)) return BACK;
        if (!ok) { p.log.info('push 하지 않았습니다. repo 를 비공개로 바꾼 뒤 git push -u origin HEAD'); return true; }
      }
      const yes = await yesNo({ message: '지금 커밋·push 할까요?', hint: 'chore: init workspace 로 커밋하고 origin 에 push 합니다. 팀원은 그 뒤 clone 할 수 있습니다.' });
      if (yes === BACK || clack().isCancel(yes)) return BACK;
      if (yes !== true) return true;
      const g = (...x) => spawnSync('git', ['-C', dir, ...x], { encoding: 'utf8' });
      g('add', '-A');
      const c = g('commit', '-q', '-m', 'chore: init workspace');
      if (c.status !== 0 && !/nothing to commit/.test(`${c.stdout}${c.stderr}`)) { p.log.warn(`커밋하지 못했습니다: ${(c.stderr || c.stdout).trim().split('\n').slice(-3).join(' ')}`); return true; }
      const ps = g('push', '-u', 'origin', 'HEAD');
      if (ps.status !== 0) p.log.warn(`push 하지 못했습니다: ${(ps.stderr || '').trim().split('\n').slice(-2).join(' ')}. 나중에 git push -u origin HEAD`);
      else { pushed = true; p.log.success('커밋 · push 완료'); }
      return true;
    } },
  ];
  for (let i = 0; i < after.length;) {
    PROGRESS = `${preCount + after[i].n}/${total}`;
    const v = await after[i].run();
    if (v === BACK) { if (i === 0) ask(BACK); i--; continue; }
    i++;
  }
  PROGRESS = '';
  // 리더의 합류 기록 — 첫 커밋에 함께 올라가 팀 현황에 보인다 (팀원은 install 때 묻는다)
  const leadId = memberId(dir);
  if (leadId) {
    const f = path.join(dir, 'handoffs', leadId, 'TODO.md');
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `# TODO (${leadId})\n`); }
    // 만든 사람이 팀장 — 팀원 설정 수정을 막을 때(kedovi team edit deny) 이 사람만 설정을 바꾼다
    const wsFile = path.join(dir, 'workspace.json');
    const raw = JSON.parse(read(wsFile));
    if (!(raw.team && ((raw.team.admins || []).length || (raw.team.leads || []).length))) { const acct = detectAccount(dir); raw.team = { ...(raw.team || {}), leads: [acct ? { username: acct.username } : { username: leadId, source: 'git' }] }; if (acct) { writeLocal(dir, { me: { ...acct, checked: new Date().toISOString().slice(0, 10) } }); fs.writeFileSync(path.join(dir, 'handoffs', leadId, '.account'), `${acct.username}\n`); } fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n'); }
  }
  // repo 별 상태: clone 실패 · 빠진 repo 는 질문 화면들 뒤로 밀려 안 보이므로 끝에 다시 보인다 (다시 받기 = kedovi install, sync 는 받지 않는다)
  const repoNote = repoStatus(dir, res.repos || []);
  if (repoNote) p.note(repoNote.text, repoNote.title);
  const rel = path.relative(process.cwd(), dir);
  const hasRemote = remoteOf();
  p.note(pushed
    ? '팀원: 이 repo 를 clone 한 뒤 kedovi install · kedovi start'
    : hasRemote
      ? `아직 push 하지 않았습니다. 준비되면:\ngit add -A && git commit -m "chore: init workspace" && git push -u origin HEAD\n→ 팀원은 clone 한 뒤 kedovi install · kedovi start`
      : `원격이 없습니다. GitLab·GitHub 에 빈 repo 를 만든 뒤:\ngit remote add origin <주소> && git add -A && git commit -m "chore: init workspace" && git push -u origin HEAD`, '공유하기');
  p.outro(`다음: ${rel ? `cd ${rel} && ` : ''}kedovi start`);
}

/** init 끝 화면의 repo 상태 표 — 받은 결과와 지금 repos/ 를 맞춰 본다. 반환 { title, text } */
function repoStatus(dir, results) {
  let ws;
  try { ws = kit.loadWorkspace(dir); } catch { return null; }
  if (!(ws.repos || []).length) return null;
  const by = new Map(results.map((x) => [x.name, x]));
  const STATE = { ok: '있음', cloned: 'clone 함', linked: '링크', created: '새로 만듦', pending: '원격 대기', fail: '실패' };
  const rows = ws.repos.map((r) => {
    const x = by.get(r.name);
    const there = fs.existsSync(path.join(dir, r.dir));
    const state = there ? (x ? x.state : 'ok') : x && x.state === 'pending' ? 'pending' : 'fail';
    return { name: r.name, kind: kit.REPO_KINDS[r.kind] || r.kind, state, note: state === 'fail' ? (x && x.state === 'fail' ? x.note : '받지 못함 (repos/ 에 없음)') : '' };
  });
  const bad = rows.filter((r) => r.state === 'fail');
  const w = Math.max(...rows.map((r) => r.name.length));
  const line = (r) => `${r.state === 'fail' ? '✖' : r.state === 'pending' ? '…' : '✓'} ${r.name.padEnd(w)}  ${padTo(r.kind, 12)} ${STATE[r.state]}${r.note ? `: ${r.note}` : ''}`;
  // 많으면 문제 있는 것만 줄마다, 나머지는 개수로
  const shown = rows.length > 12 ? rows.filter((r) => r.state !== 'ok' && r.state !== 'cloned' && r.state !== 'linked' && r.state !== 'created') : rows;
  const okCount = rows.length - shown.length;
  return {
    title: bad.length ? `repo ${rows.length}개 중 ${bad.length}개 받지 못함` : `repo ${rows.length}개`,
    text: [...shown.map(line), ...(okCount ? [`✓ 나머지 ${okCount}개 받음`] : []),
      ...(bad.length ? ['', '인증 · 주소를 고친 뒤 워크스페이스에서 kedovi install (빠진 repo 만 받는다. kedovi sync 는 받지 않는다)'] : [])].join('\n'),
  };
}

/** repo 마다 스택 확정 — 감지가 맞으면 한 화면, 아니면 서버/클라이언트 → 플랫폼 → 프레임워크 → 세부 → DB 순으로 좁힌다.
 *  Esc 는 앞 repo 로, 첫 repo 에서 Esc 면 저장하지 않고 BACK 을 돌려준다 */
async function reviewStacks(root, { force = false, only = null } = {}) {
  const catalog = kit.loadCatalog(root);
  const layers = kit.loadLayers(root);
  const found = kit.detectRepos(root, { force, write: false, only });
  const languages = kit.loadLanguages(root);
  const hinted = kit.hintedCatalog(root); // 감지와 같은 힌트
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const codeRepos = (raw.repos || []).filter((r) => (r.kind || 'code') === 'code' && fs.existsSync(path.join(root, kit.repoRel(r))) && (!only || r.name === only));
  if (!codeRepos.length) return;
  const skipped = new Set();
  const before = new Map(codeRepos.map((r) => [r.name, JSON.stringify([...(r.stacks || [])].sort())])); // 화면 전 스택
  let i = 0;
  while (i < codeRepos.length) {
    const r = codeRepos[i];
    const d = found.find((x) => x.name === r.name);
    const detected = d ? d.stacks : r.stacks || [];
    const evidence = d && d.evidence.length ? ` (${[...new Set(d.evidence.map((e) => e.evidence))].join(', ')})` : '';
    const shown = d ? { stacks: detected } : { stacks: detected, stackPaths: r.stackPaths };
    if (d) kit.setStackPaths(shown, d.evidence);
    if (detected.length) {
      const v = await chooseInline({
        message: `${kit.repoRel(r)} 스택`,
        hint: `감지: ${kit.stacksLabel(catalog, detected, undefined, shown.stackPaths)}${evidence}${d && d.languages && d.languages.length ? ` · 언어 ${kit.labelLanguages(languages, d.languages)}` : ''}`,
        options: [{ value: 'ok', label: '맞음' }, { value: 'edit', label: '고치기' }, { value: 'skip', label: '건너뛰기' }], initialValue: 'ok',
      });
      if (v === BACK || clack().isCancel(v)) { if (i === 0) return BACK; i--; continue; }
      skipped.delete(r.name); // Esc 로 돌아와 다시 고른 경우
      if (v === 'ok') { r.stacks = detected; i++; continue; }
      if (v === 'skip') { r.stacks = []; skipped.add(r.name); i++; continue; } // 건너뛴 repo 는 언어 규칙도 붙이지 않는다 (아래에서 languages: false)
    }
    if (!detected.length && d && d.builds && d.builds.length) {
      p.log.warn(`${kit.repoRel(r)}: 빌드 파일(${d.builds.slice(0, 2).join(', ')})은 있는데 스택을 찾지 못했습니다.\n사내 라이브러리를 거쳐 프레임워크를 쓰는 경우입니다. 아래에서 직접 고르고, 다음 감지부터 자동으로 잡으려면\n${kit.HINT_HELP}`);
    }
    const picked = await stackWizard(kit.repoRel(r), catalog, layers, detected);
    if (picked === null) { if (detected.length) continue; if (i === 0) return BACK; i--; continue; } // 마법사 첫 화면에서 Esc: 확인 화면으로, 확인 화면이 없었으면 앞 repo 로
    r.stacks = picked;
    i++;
  }
  // 모듈 경로 — 고른 스택 중 감지로 모듈을 안 것만 남긴다 (직접 고른 스택은 repo 전체로 본다)
  for (const r of codeRepos) {
    const d = found.find((x) => x.name === r.name);
    if (d) kit.setStackPaths(r, d.evidence);
    else if (r.stackPaths) kit.setStackPaths(r, Object.entries(r.stackPaths).map(([id, modules]) => ({ id, modules })));
    // 언어는 고르지 않고 감지대로 다시 쓴다 (스택을 손으로 고쳤으면 그 스택 기준으로 플랫폼 폴더를 빼고 다시 센다).
    // 언어 규칙을 빼려면 kedovi rules off <ID> --repo (감지와 상관없이 남는다)
    const setLangs = (l) => { r.languages = l || []; }; // 빈 결과도 기록한다 (빈 repo 는 upgrade · detect 때 다시 감지)
    if (skipped.has(r.name)) r.languages = false; // 건너뛴 repo: 언어 규칙 없음 (upgrade 가 다시 채우지 않는다)
    else if (d && d.languages && JSON.stringify([...(r.stacks || [])].sort()) === JSON.stringify([...(d.stacks || [])].sort())) setLangs(d.languages);
    else if (Array.isArray(r.languages) && JSON.stringify([...(r.stacks || [])].sort()) === (before.get(r.name) || '')) { /* 스택을 바꾸지 않았으면 그대로 (다시 훑지 않는다) */ }
    else { const again = kit.repoLanguages(root, r, { catalog: hinted, languages }); if (again) setLangs(again); }
  }
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  runWorkspaceKit(root, ['sync']);
}

/** 단계식 스택 선택. Esc = 이전 단계, 첫 단계에서 Esc = 이전 화면(null) */
async function stackWizard(rel, catalog, layers, detected) {
  const has = (layer) => detected.some((id) => (catalog.find((c) => c.id === id) || {}).layer === layer);
  const clientLayers = ['frontend', 'desktop', 'mobile', 'watch', 'tv'];
  const st = {
    kind: has('backend') && clientLayers.some(has) ? 'both' : clientLayers.some(has) ? 'client' : has('backend') ? 'server' : has('infra') ? 'infra' : undefined,
    platforms: clientLayers.filter(has), picks: {}, children: {}, db: detected.filter((id) => (catalog.find((c) => c.id === id) || {}).layer === 'db'),
  };
  const topOf = (layer) => catalog.filter((c) => c.layer === layer && !c.parent);
  const kidsOf = (id) => catalog.filter((c) => c.parent === id);
  const withRules = (c) => (c.pack || kit.LAYER_PACKS[c.layer] ? '' : '전용 규칙 없음');
  const steps = [];
  steps.push({ run: () => choose({
    message: `${rel} 은(는) 무엇인가요?`, hint: '서버(백엔드)인지 클라이언트인지에 따라 붙는 규칙이 다릅니다.', initialValue: st.kind,
    options: [
      { value: 'server', label: '서버', hint: 'API·배치·백엔드' },
      { value: 'client', label: '클라이언트', hint: '웹·데스크톱·모바일·워치·TV' },
      { value: 'both', label: '서버 + 클라이언트', hint: '한 repo 에 둘 다' },
      { value: 'infra', label: '인프라만', hint: 'Docker·Kubernetes·Terraform·Ansible (배포 설정 repo)' },
      { value: 'none', label: '건너뛰기', hint: '스택 없이 공통 규칙만' },
    ],
  }), set: (v) => { st.kind = v; } });
  steps.push({ when: () => st.kind === 'client' || st.kind === 'both', run: () => chooseMany({
    message: '클라이언트 종류', hint: '해당하는 것을 모두 고르세요 (Flutter 처럼 여러 플랫폼이면 여러 개).', initialValues: st.platforms,
    options: clientLayers.map((l) => ({ value: l, label: layers[l] || l, hint: kit.LAYER_PACKS[l] ? '공통 규칙 있음' : '공통 규칙 아직 없음' })),
  }), set: (v) => { st.platforms = v; } });
  // 인프라(Dockerfile · 매니페스트 · IaC)는 서버 · 클라이언트 repo 에도 함께 있을 수 있어 건너뛰기가 아니면 묻는다
  const layerSteps = () => [...(st.kind === 'server' || st.kind === 'both' ? ['backend'] : []), ...(st.kind === 'client' || st.kind === 'both' ? st.platforms : []), ...(st.kind && st.kind !== 'none' ? ['infra'] : [])];
  for (const layer of ['backend', ...clientLayers, 'infra']) {
    steps.push({ when: () => layerSteps().includes(layer), run: () => chooseMany({
      message: layer === 'infra' ? '배포·인프라 도구' : `${layers[layer] || layer} 프레임워크`, hint: 'Space 로 고르고 Enter 로 확정 (아무것도 안 고르고 Enter 면 건너뜀)',
      // 세부만 잡힌 경우(Chart.yaml 만 있는 Helm)도 부모(Kubernetes)를 미리 골라 둔다. 안 그러면 세부 질문이 나오지 않아 빠진다
      initialValues: st.picks[layer] || topOf(layer).filter((c) => detected.includes(c.id) || kidsOf(c.id).some((k) => detected.includes(k.id))).map((c) => c.id),
      options: topOf(layer).map((c) => ({ value: c.id, label: c.label, hint: c.pack ? '전용 규칙' : withRules(c) || '공통 규칙만' })),
    }), set: (v) => { st.picks[layer] = v; } });
  }
  // 세부 프레임워크 — 고른 프레임워크마다 (예: Spring → MVC·WebFlux·Batch …)
  for (const parent of catalog.filter((c) => kidsOf(c.id).length)) {
    steps.push({ when: () => Object.values(st.picks).flat().includes(parent.id), run: () => chooseMany({
      message: `${parent.label} 세부`, hint: 'Space 로 고르고 Enter 로 확정 (아무것도 안 고르고 Enter 면 건너뜀)',
      initialValues: st.children[parent.id] || detected.filter((id) => kidsOf(parent.id).some((c) => c.id === id)),
      options: kidsOf(parent.id).map((c) => ({ value: c.id, label: c.label })),
    }), set: (v) => { st.children[parent.id] = v; } });
  }
  // IaC repo 도 DB 를 만들 수 있어 인프라만이어도 묻는다
  steps.push({ when: () => st.kind === 'server' || st.kind === 'both' || st.kind === 'infra', run: () => chooseMany({
    message: '쓰는 DB', hint: 'Space 로 고르고 Enter 로 확정 (아무것도 안 고르고 Enter 면 건너뜀)', initialValues: st.db,
    options: topOf('db').map((c) => ({ value: c.id, label: c.label, hint: c.pack ? '전용 규칙' : '공통 규칙만' })),
  }), set: (v) => { st.db = v; } });

  const runnable = (k) => !steps[k].when || steps[k].when();
  let k = 0;
  while (k < steps.length) {
    if (!runnable(k)) { k++; continue; }
    const v = await steps[k].run();
    if (v === BACK) { let prev = k - 1; while (prev >= 0 && !runnable(prev)) prev--; if (prev < 0) return null; k = prev; continue; }
    if (clack().isCancel(v)) return null;
    steps[k].set(v);
    if (st.kind === 'none') return [];
    k++;
  }
  const picks = layerSteps().flatMap((l) => st.picks[l] || []);
  const kids = picks.flatMap((id) => st.children[id] || []);
  return [...new Set([...picks, ...kids, ...(['server', 'both', 'infra'].includes(st.kind) ? st.db : [])])];
}
const stackLabelOf = (catalog, id) => (catalog.find((c) => c.id === id) || { label: id }).label;

// ───────────────────────── 팀 명단 · 합류 ─────────────────────────

/** 워크스페이스에서 쓰는 개발자 id — 핸드오프 폴더 이름과 같다 (워크스페이스 repo 의 git user.name) */
const memberId = (root) => (spawnSync('git', ['-C', root, 'config', 'user.name'], { encoding: 'utf8' }).stdout || '').trim();
function teamOf(root) {
  try { return JSON.parse(read(path.join(root, 'workspace.json'))).team || {}; } catch { return {}; }
}

/** 설정 잠금(팀원 설정 수정 불가)일 때 팀장만. 아니면 멈춘다. soft 면 경고하고 false */
function requireAdmin(root, what, { soft = false } = {}) {
  let st = { admin: true };
  try { st = kit.lockState(root, kit.loadWorkspace(root)); } catch { /* 옛 킷 */ }
  if (st.admin) return true;
  const t = teamOf(root);
  const leads = [...(t.leads || []), ...(t.admins || [])].map((x) => (typeof x === 'string' ? x : x.nickname || x.username));
  const msg = `팀원 설정 수정이 막혀 있습니다 (팀장: ${leads.join(', ')}). ${what} 은(는) 팀장에게 요청하세요`;
  if (soft) { p.log.warn(msg); return false; }
  fail(msg);
}

// 이 PC 사용자 확인 — 워크스페이스 repo 원격의 저장소 계정 username. ssh 면 ssh -T 인사말, https 면 gh · glab · git credential 의 사용자 이름
const NOT_USER = new Set(['oauth2', 'x-access-token', 'gitlab-ci-token', 'personalaccesstoken', 'token', 'git']);
/** why: 못 찾았을 때 이유를 쌓는다 (화면 없는 실행에서 한 줄로 알린다) */
function detectAccount(root, why = []) {
  const url = (spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout || '').trim();
  if (!url) { why.push('워크스페이스 repo 에 origin 원격이 없음'); return null; }
  const ssh = url.match(/^ssh:\/\/([\w.-]+)@([^:/]+)(?::(\d+))?\//) || url.match(/^([\w.-]+)@([^:/]+):/);
  // 로그인 창 · 브라우저가 뜨지 않게 (Git Credential Manager · askpass)
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  delete env.GIT_ASKPASS; delete env.SSH_ASKPASS;
  const missing = new Set();
  const run = (cmd, args, input) => { try { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, input, env }); if (r.error && r.error.code === 'ENOENT') missing.add(cmd); return `${r.stdout || ''}\n${r.stderr || ''}`; } catch { return ''; } };
  if (ssh && !/^https?:/.test(url)) {
    const [, user, host, port] = ssh;
    const out = run('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', ...(port ? ['-p', port] : []), `${user}@${host}`]);
    const m = out.match(/Hi ([\w.-]+)!/) || out.match(/Welcome to GitLab, @([\w.-]+)!/) || out.match(/logged in as ([\w.-]+)/i);
    if (m) return { username: m[1], host, source: 'ssh' };
    why.push(`ssh -T ${user}@${host}${port ? ` -p ${port}` : ''} 이 계정 이름을 돌려주지 않음 (키 등록 · 접속 확인)`);
    return null;
  }
  let host = '';
  try { host = new URL(url).hostname; } catch { why.push(`원격 주소를 읽지 못함 (${url})`); return null; }
  if (/github/.test(host)) {
    const u = run('gh', ['api', 'user', '--hostname', host, '--jq', '.login']).trim().split('\n')[0];
    if (/^[\w.-]+$/.test(u)) return { username: u, host, source: 'gh' };
    why.push(missing.has('gh') ? 'gh 없음' : `gh 로그인 안 됨 (gh auth login --hostname ${host})`);
  } else {
    const j = run('glab', ['api', 'user', '--hostname', host]);
    const m = j.match(/"username"\s*:\s*"([\w.-]+)"/);
    if (m) return { username: m[1], host, source: 'glab' };
    why.push(missing.has('glab') ? 'glab 없음' : `glab 로그인 안 됨 (glab auth login --hostname ${host})`);
  }
  const cred = run('git', ['-C', root, 'credential', 'fill'], `protocol=https\nhost=${host}\n\n`).match(/^username=(.+)$/m);
  if (cred && !NOT_USER.has(cred[1].trim().toLowerCase())) return { username: cred[1].trim(), host, source: 'git credential' };
  why.push(cred ? `git credential 의 사용자가 토큰 이름(${cred[1].trim()})` : 'git credential 에 저장된 사용자 없음');
  return null;
}

/** 이 PC 사용자 저장 (.agents/local.json me). 이미 있고 refresh 가 아니면 그대로. 못 찾으면 화면에서 한 번 묻는다 */
async function ensureAccount(root, { refresh = false, ask = process.stdin.isTTY } = {}) {
  const cur = readLocal(root).me;
  const today = new Date().toISOString().slice(0, 10);
  if (cur && cur.username && !refresh) return cur;
  // 못 찾은 기록이 있으면 7일 동안 다시 묻지 않는다 (start 마다 느려지지 않게. 다시: kedovi team whoami --refresh)
  if (cur && cur.source === 'none' && !refresh && (Date.now() - Date.parse(cur.checked || 0)) < 7 * 864e5) return null;
  const why = [];
  const found = detectAccount(root, why);
  let me = found ? { ...found, checked: today } : null;
  // 화면 없는 실행(에이전트 등)은 물을 수 없으니 이유를 한 줄 알린다
  if (!me && !ask) clack().log.warn(`저장소 계정을 읽지 못했습니다: ${why.join(' · ') || '이유 모름'}. 터미널에서 kedovi team whoami --refresh 를 직접 실행하면 입력해 적을 수 있습니다`);
  if (!me && ask) {
    clack().log.info('워크스페이스 원격에서 저장소 계정을 읽지 못했습니다. 팀장 · 담당 repo 판정에 쓰니 직접 적어 주세요 (나중에 다시 확인: kedovi team whoami --refresh)');
    const v = await clack().text({ message: '저장소 계정 username', placeholder: '예: hong01' });
    if (!clack().isCancel(v) && String(v || '').trim()) me = { username: String(v).trim(), host: '', source: 'input', checked: today };
  }
  if (!me) { if (ask) writeLocal(root, { me: { source: 'none', checked: today } }); return null; } // 물을 수 없던 실행(화면 없음)은 기록하지 않는다
  writeLocal(root, { me });
  return me;
}

/**
 * 계정을 찾으면: (1) 핸드오프 폴더에 계정을 적는다 (팀 현황이 git user.name 폴더 ↔ username 을 잇는다. 합류 기록 · 다음 핸드오프와 함께 커밋된다)
 * (2) 팀 설정에 이 PC 가 git user.name 으로 적혀 있으면 계정으로 바꾸는 명령을 알린다 (자동으로 고치지 않는다: 다른 사람이 이름만 바꿔 그 자리를 가져가지 못하게)
 */
function adoptAccount(root, username) {
  const gitName = memberId(root);
  if (!gitName || !username) return;
  const dir = path.join(root, 'handoffs', gitName);
  try { if (fs.existsSync(dir) && (fs.existsSync(path.join(dir, '.account')) ? read(path.join(dir, '.account')).trim() : '') !== username) fs.writeFileSync(path.join(dir, '.account'), `${username}\n`); } catch { /* 편의 */ }
  if (gitName === username) return;
  const t = teamOf(root);
  const all = [...(t.leads || []), ...(t.admins || []), ...(t.members || [])];
  if (all.some((x) => sameUser(x, username)) || !all.some((x) => sameUser(x, gitName))) return;
  const lead = [...(t.leads || []), ...(t.admins || [])].some((x) => sameUser(x, gitName));
  clack().log.info(lead
    ? `팀 설정의 팀장 ${gitName} 이(가) git user.name 으로 적혀 있습니다. 저장소 계정으로 바꾸세요: kedovi team lead add ${username} --nick <이름> 뒤 kedovi team lead remove ${gitName}`
    : `팀 설정에 ${gitName} 이(가) git user.name 으로 적혀 있습니다. 팀장에게 저장소 계정 ${username} 으로 바꿔 달라고 요청하세요 (kedovi team add ${username} --nick <이름> --repos …)`);
}

/** 사람 항목 다루기 — 문자열(옛 형식)도 객체로 맞춘다 */
const personOf = (x) => (typeof x === 'string' ? { username: x } : { ...x });
const sameUser = (x, u) => personOf(x).username === u;
function optVal(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

/** 리더용 — 명단 추가·삭제·보기, 명단 제한 켜기·끄기. workspace.json 을 고치고 commit · push 를 안내한다 */
function cmdTeamAdmin(root, [sub, ...ids]) {
  if (sub === 'whoami') return cmdWhoami(root, ids);
  if (['lead', 'leads', 'repos', 'nick'].includes(sub) || (sub === 'add' && (ids.includes('--nick') || ids.includes('--repos')))) return cmdTeamPeople(root, [sub, ...ids]);
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const team = raw.team || {};
  team.members = team.members || [];
  if (sub !== 'members' && !(sub === 'admins' && !ids.length)) requireAdmin(root, `kedovi team ${sub}`);
  if (sub === 'edit') {
    // 팀원 설정 수정 허용·불가. deny 면 팀장만 workspace.json·팩·생성물을 바꾸고, 팀원은 자기 handoffs/ 와 로드맵(handoffs/PLAN.md)만 커밋한다
    const v = ids[0];
    if (!['allow', 'deny'].includes(v)) fail('사용법: kedovi team edit allow|deny');
    const me = (readLocal(root).me || {}).username || memberId(root);
    if (!(team.leads || []).length && !(team.admins || []).length && me) team.leads = [{ username: me, ...((readLocal(root).me || {}).username ? {} : { source: 'git' }) }];
    const leadNames = [...(team.leads || []), ...(team.admins || [])].map((x) => personOf(x).nickname || personOf(x).username);
    if (v === 'deny' && !leadNames.length) fail('팀장이 없습니다. 먼저 kedovi team lead add <username>');
    team.lock = v === 'deny';
    raw.team = team;
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    runWorkspaceKit(root, ['sync', '--quiet']);
    console.log(v === 'deny' ? `✔ 팀원 설정 수정: 불가. 팀장(${leadNames.join(', ')})만 workspace.json · 팩 · 생성물을 바꾸고, 팀원은 자기 handoffs/ 와 로드맵(handoffs/PLAN.md)만 커밋한다` : '✔ 팀원 설정 수정: 허용 (누구나)');
    console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다. 서버에서 확실히 막으려면 README 의 GitLab 설정 참고');
    return;
  }
  if (sub === 'admins') {
    if (!ids.length) { console.log(`팀장: ${[...(team.leads || []), ...(team.admins || [])].map((x) => personOf(x).nickname || personOf(x).username).join(', ') || '(없음)'} · 팀원 설정 수정: ${team.lock ? '불가' : '허용'}`); return; }
    team.admins = [...new Set(ids)];
    raw.team = team;
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
    runWorkspaceKit(root, ['sync', '--quiet']);
    console.log(`✔ 팀장: ${team.admins.join(', ')}. workspace.json 을 commit · push 하면 팀에 적용됩니다`);
    return;
  }
  if (sub === 'members') {
    console.log(team.members.length ? `팀 명단 (${team.members.length}명): ${team.members.map((x) => { const q = personOf(x); return `${q.nickname ? `${q.nickname}(${q.username})` : q.username}${q.repos ? ` · 담당 ${q.repos.join(', ')}` : ''}`; }).join(', ')}${team.restrict ? '\n명단 제한: 켜짐. 명단 밖 사람은 kedovi start 가 멈춘다' : ''}` : '팀 명단이 비어 있습니다. kedovi team add <id> (id = 그 사람 워크스페이스의 git user.name)');
    return;
  }
  if (sub === 'restrict') {
    const on = ids[0];
    if (!['on', 'off'].includes(on)) fail('사용법: kedovi team restrict on|off');
    if (on === 'on' && !team.members.length) fail('명단이 비어 있습니다. 먼저 kedovi team add <id…>');
    team.restrict = on === 'on';
  } else {
    if (!ids.length) fail(`사용법: kedovi team ${sub} <id…>`);
    for (const id of ids) {
      if (sub === 'add' && !team.members.some((x) => sameUser(x, id))) team.members.push({ username: id }); // 새로 넣는 사람은 계정 username 항목 (문자열은 옛 git user.name 형식)
      if (sub === 'remove') team.members = team.members.filter((x) => !sameUser(x, id));
    }
    if (!team.members.length) delete team.restrict;
  }
  raw.team = team;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  console.log(`✔ 팀 명단: ${team.members.map((x) => personOf(x).nickname || personOf(x).username).join(', ') || '(없음)'}${team.restrict ? ' · 명단 제한 켜짐' : ''}`);
  console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다');
}

/** 팀 판정 모듈: 워크스페이스 것, 옛 워크스페이스면 킷 것 */
function teamMod(root) {
  const own = path.join(root, 'packs', 'core', 'lib', 'team.js');
  return require(fs.existsSync(own) ? own : path.join(KIT_ROOT, 'packs', 'core', 'lib', 'team.js'));
}

async function cmdWhoami(root, args) {
  if (args.includes('--refresh')) {
    const before = (readLocal(root).me || {}).username;
    const me = await ensureAccount(root, { refresh: true });
    if (me && me.username) adoptAccount(root, me.username);
    if ((me || {}).username !== before) runWorkspaceKit(root, ['sync', '--quiet']);
  }
  const ws = kit.loadWorkspace(root);
  const T = teamMod(root);
  const w = T.whoAmI(root, ws);
  const blocked = T.blockedRepos(root, ws);
  console.log(`이 PC 사용자: ${w.nickname ? `${w.nickname} · ` : ''}${w.username || '(모름)'} (확인: ${w.source})`);
  console.log(`역할: ${w.lead ? '팀장 (모든 repo · 설정 수정)' : w.person ? `팀원 · 담당 ${(w.repos || []).join(', ') || '없음'}` : '명단에 없음'}`);
  if (blocked.length) console.log(`고칠 수 없는 repo: ${blocked.join(', ')} (담당자 · 팀장에게 요청)`);
  if (w.source === 'git user.name' && !args.includes('--refresh')) console.log('  저장소 계정을 아직 확인하지 못했습니다: kedovi team whoami --refresh');
}

/** 팀장 · 팀원 · 담당 repo · 부를 이름 (workspace.json team.leads · members) */
function cmdTeamPeople(root, [sub, ...args]) {
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const team = raw.team || {};
  const ws = kit.loadWorkspace(root);
  const repoNames = new Set(ws.repos.map((r) => r.name));
  const nick = optVal(args, '--nick');
  const reposArg = optVal(args, '--repos');
  const pos = args.filter((a, i) => !a.startsWith('--') && !['--nick', '--repos'].includes(args[i - 1]));
  const show = () => {
    const T = teamMod(root);
    const { leads, members } = T.roster({ team });
    console.log(`팀장: ${leads.map((x) => `${T.callName(x)}(${x.username})`).join(', ') || '(없음)'}`);
    for (const m of members) console.log(`  팀원 ${T.callName(m)}(${m.username}) · 담당 ${(m.repos || []).join(', ') || '-'}`);
  };
  if (sub === 'leads') return show();
  requireAdmin(root, `kedovi team ${sub}`);
  const save = (msg) => { raw.team = team; fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n'); runWorkspaceKit(root, ['sync', '--quiet']); console.log(`✔ ${msg}`); show(); console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다'); };
  const checkRepos = (list) => { const bad = list.filter((x) => !repoNames.has(x)); if (bad.length) fail(`repos 에 없는 이름: ${bad.join(', ')} (있는 repo: ${[...repoNames].join(', ')})`); return list; };
  if (sub === 'lead') {
    const [act, user] = pos;
    if (!['add', 'remove'].includes(act) || !user) fail('사용법: kedovi team lead add|remove <username> [--nick 이름]');
    team.leads = (team.leads || []).map(personOf).filter((x) => x.username !== user);
    team.admins = (team.admins || []).filter((x) => x !== user);
    if (!team.admins.length) delete team.admins;
    if (act === 'add') team.leads.push({ username: user, ...(nick ? { nickname: nick } : {}) });
    if (act === 'remove' && !team.leads.length && !(team.admins || []).length && team.lock) fail('마지막 팀장은 뺄 수 없습니다 (설정 잠금이 켜져 있음). 다른 팀장을 먼저 넣으세요');
    return save(act === 'add' ? `팀장 추가: ${nick || user}` : `팀장에서 뺌: ${user}`);
  }
  const [user, val] = pos;
  if (!user) fail(`사용법: kedovi team ${sub === 'nick' ? 'nick <username> <이름>' : sub === 'repos' ? 'repos <username> <a,b|->' : 'add <username> [--nick 이름] [--repos a,b]'}`);
  team.members = (team.members || []).map(personOf);
  let m = team.members.find((x) => x.username === user);
  if (!m && sub !== 'nick') { m = { username: user }; team.members.push(m); }
  if (sub === 'nick') {
    if (!val) fail('사용법: kedovi team nick <username> <이름>');
    if ((team.admins || []).includes(user)) { team.admins = team.admins.filter((x) => x !== user); if (!team.admins.length) delete team.admins; team.leads = [...(team.leads || []), { username: user }]; } // 옛 팀장 → 팀장 항목으로
    const l = (team.leads || []).map(personOf).find((x) => x.username === user);
    if (l) { team.leads = team.leads.map((x) => (sameUser(x, user) ? { ...personOf(x), nickname: val } : x)); return save(`부를 이름: ${user} → ${val}`); }
    if (!m) fail(`${user} 은(는) 팀장 · 팀원 명단에 없습니다. 먼저 kedovi team add ${user} --nick ${val}`);
    m.nickname = val;
    return save(`부를 이름: ${user} → ${val}`);
  }
  if (nick) m.nickname = nick;
  const rv = sub === 'repos' ? val : reposArg;
  if (rv !== undefined) {
    if (rv === '-' || rv === '') delete m.repos; else m.repos = checkRepos(String(rv).split(',').map((x) => x.trim()).filter(Boolean));
  }
  return save(sub === 'repos' ? `${m.nickname || user} 담당: ${(m.repos || []).join(', ') || '없음'}` : `팀원: ${m.nickname || user}${m.repos ? ` · 담당 ${m.repos.join(', ')}` : ''}`);
}

/** 합류 기록 — install 때 묻고, 예면 handoffs/<id>/TODO.md 를 만들어 워크스페이스 repo 에 push. 팀 현황에 바로 보인다 */
async function joinTeam(root) {
  const me = memberId(root);
  if (!me) { p.log.warn('워크스페이스의 git user.name 이 없어 팀 합류 기록을 남기지 못했습니다. git config user.name <id> 후 kedovi install'); return; }
  const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  const team = teamOf(root);
  const meAcct = (readLocal(root).me || {}).username;
  if ((team.members || []).length && !team.members.some((x) => sameUser(x, me) || (meAcct && sameUser(x, meAcct))) && ![...(team.leads || []), ...(team.admins || [])].some((x) => sameUser(x, me) || (meAcct && sameUser(x, meAcct)))) {
    p.log.warn(`${me} 은(는) 팀 명단에 없습니다. 리더에게 명단 추가(kedovi team add ${me})를 요청하세요${team.restrict ? ' (명단 제한이 켜져 있어 그 전에는 kedovi start 가 멈춥니다)' : ''}`);
  }
  const rel = `handoffs/${me}/TODO.md`;
  git('fetch', '-q');
  const up = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}').stdout.trim();
  const listed = up ? git('-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', up, '--', `handoffs/${me}/`).stdout.trim() : '';
  if (listed) return; // 이미 합류 기록이 원격에 있다
  if (!up) { p.log.info('워크스페이스 repo 에 원격이 없어 팀 합류 기록은 건너뜁니다'); return; }
  const yes = await yesNo({ message: '팀에 합류 기록을 올릴까요?', hint: `handoffs/${me}/ 를 만들어 워크스페이스 repo 에 push 합니다. 팀 현황(kedovi team)에 바로 보입니다.` });
  if (yes === BACK || clack().isCancel(yes) || !yes) { p.log.info('합류 기록을 올리지 않았습니다. 첫 핸드오프를 push 하면 팀 현황에 보입니다'); return; }
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# TODO (${me})\n`);
  // 저장소 계정도 함께 (팀 현황이 git user.name 폴더 ↔ 명단 username 을 잇는다)
  const acct = (readLocal(root).me || {}).username;
  const accRel = `handoffs/${me}/.account`;
  if (acct) fs.writeFileSync(path.join(root, accRel), `${acct}\n`);
  const paths = acct ? [rel, accRel] : [rel];
  const steps = [['add', '--', ...paths], ['commit', '-q', '-m', `docs: ${me} 팀 합류`, '--', ...paths], ['pull', '-q', '--rebase', '--autostash'], ['push', '-q']];
  for (const st of steps) {
    const r = git(...st);
    if (r.status !== 0) { p.log.warn(`합류 기록을 올리지 못했습니다 (git ${st[0]}): ${(r.stderr || '').trim().split('\n').pop()}. 나중에 첫 핸드오프 때 함께 올라갑니다`); return; }
  }
  p.log.success(`팀 합류 기록을 올렸습니다: ${rel}`);
}

// ───────────────────────── 규칙 켜고 끄기 ─────────────────────────

const RULES_USAGE = 'kedovi rules [list | off <ID…> [--repo <이름,…>] | on <ID…> [--repo <이름,…>] | ondemand <ID…|repo-tasks> | always <ID…|repo-tasks>]';
const ruleMark = (r, st) => (r.required ? '필수' : st.replaced[r.id] ? '대체됨' : st.off.includes(r.id) ? '꺼짐' : '켜짐');

/** workspace.json rules 의 한 칸을 쓴다 (off · onDemand = 목록, offIn = { 규칙 ID: [repo…] }). 비면 지운다. sync: false 면 sync 하지 않는다 */
function saveRulesOff(root, value, key = 'off', { sync = true } = {}) {
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  raw.rules = { ...(raw.rules || {}), [key]: Array.isArray(value) ? [...new Set(value)].sort() : value };
  if (!(Array.isArray(raw.rules[key]) ? raw.rules[key].length : Object.keys(raw.rules[key] || {}).length)) delete raw.rules[key];
  if (!Object.keys(raw.rules).length) delete raw.rules;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return sync ? runWorkspaceKit(root, ['sync', '--quiet']) : true;
}

/** rules.offIn 을 목록 꼴로 읽는다 (손으로 쓴 "api" 꼴도) */
const readOffIn = (root) => Object.fromEntries(Object.entries((kit.loadWorkspace(root).rules || {}).offIn || {}).map(([k, v]) => [k, [].concat(v)]));

/** 킷이 넣은 규칙을 켜고 끈다 (필수 규칙·project 규칙·다른 규칙으로 대체된 규칙은 목록에 없다). repo 별로 꺼 둔 것(rules.offIn)은 그대로 두고 알린다. 반환: 저장했으면 true · BACK */
async function chooseRules(root) {
  const g = kit.generate(root);
  const offIn = readOffIn(root);
  const st = g.ruleState || { off: [], replaced: {} };
  const all = g.allRules || [];
  const fixed = all.filter((r) => r.required);
  const swapped = all.filter((r) => st.replaced[r.id]);
  p.note([
    `필수 (끌 수 없음): ${fixed.map((r) => r.title).join(' · ') || '없음'}`,
    ...(swapped.length ? [`project 규칙으로 대체됨: ${swapped.map((r) => `${r.id} → ${st.replaced[r.id]}`).join(' · ')}`] : []),
    ...(Object.keys(st.partial || {}).length ? [`일부 repo 에서만 대체됨: ${Object.entries(st.partial).map(([id, xs]) => `${id} (${xs.map((x) => x.repos.join(', ')).join(' · ')})`).join(' · ')}`] : []),
    ...(Object.keys(offIn).length ? [`repo 별로 꺼짐 (여기서 켜도 그대로, 되돌리기: kedovi rules on <ID> --repo <이름>): ${Object.entries(offIn).map(([id, n]) => `${id} (${n.join(', ')})`).join(' · ')}`] : []),
    '우리 방식으로 바꾸려면 packs/project/rules/<이름>.md 에 replaces: <규칙 ID> 를 적는다',
  ].join('\n'), '규칙');
  const options = all.filter((r) => !r.required && !st.replaced[r.id] && r.pack !== 'project')
    .map((r) => ({ value: r.id, label: `${r.pack} · ${r.title}`, hint: `${r.id} · ${r.load === 'always' ? '상시' : '필요할 때'}${r.scope === 'repo' ? ' · 해당 repo 만' : ''}${offIn[r.id] ? ` · ${offIn[r.id].join(', ')} 에서 꺼짐` : ''}` }));
  if (!options.length) { p.log.info('켜고 끌 규칙이 없습니다'); return false; }
  const on = await chooseMany({ message: '켤 규칙', hint: 'Space 로 켜고 끈다. 끈 규칙은 AGENTS.md 에서 빠진다 (팀 전체, commit · push 하면 적용).', options, initialValues: options.map((o) => o.value).filter((id) => !st.off.includes(id)) });
  if (on === BACK || clack().isCancel(on)) return BACK;
  const off = options.map((o) => o.value).filter((id) => !on.includes(id));
  saveRulesOff(root, off);
  p.log.success(off.length ? `규칙 ${off.length}개를 껐습니다: ${off.join(', ')}. workspace.json 을 commit · push 하면 팀에 적용됩니다` : '모든 규칙이 켜져 있습니다');
  return true;
}

async function cmdRules(argv = []) {
  const root = locateWorkspace();
  // --repo a,b 또는 --repo=a,b (off · on 에만)
  if (argv.filter((x) => x === '--repo' || x.startsWith('--repo=')).length > 1) fail('--repo 는 한 번만 씁니다 (여러 repo 는 --repo a,b)');
  const repoAt = argv.findIndex((x) => x === '--repo' || x.startsWith('--repo='));
  const repoArg = repoAt < 0 ? null : argv[repoAt].startsWith('--repo=') ? argv[repoAt].slice(7) : String(argv[repoAt + 1] || '');
  const onlyRepos = repoAt < 0 ? null : repoArg.split(',').map((x) => x.trim()).filter(Boolean);
  const [sub, ...ids] = repoAt < 0 ? argv : argv.filter((_, i) => i !== repoAt && !(i === repoAt + 1 && argv[repoAt] === '--repo'));
  if (onlyRepos && !['off', 'on'].includes(sub)) fail(`--repo 는 off · on 에만 씁니다. 사용법: ${RULES_USAGE}`);
  const g = kit.generate(root);
  const all = g.allRules || [];
  const st = g.ruleState || { off: [], replaced: {} };
  if ((sub === 'off' || sub === 'on') && onlyRepos) {
    // repo 별 끄기 · 켜기 (rules.offIn). 스택 · 언어 팩 규칙처럼 repo 에 걸리는 규칙만
    requireAdmin(root, '규칙 켜고 끄기');
    if (!ids.length || !onlyRepos.length) fail(`사용법: ${RULES_USAGE}`);
    const raw = JSON.parse(read(path.join(root, 'workspace.json')));
    const ruleRepos = (raw.repos || []).filter((r) => ['code', 'issues'].includes(r.kind || 'code')).map((r) => r.name); // 규칙이 걸리는 repo (코드 · 이슈)
    if (sub === 'off') for (const n of onlyRepos) if (!ruleRepos.includes(n)) fail(`코드 · 이슈 repo 가 아닙니다: ${n} (있는 것: ${ruleRepos.join(', ') || '없음'})`);
    const offIn = readOffIn(root);
    if (sub === 'on') for (const id of ids) {
      const notOff = onlyRepos.filter((n) => !(offIn[id] || []).includes(n));
      if (notOff.length) fail(`${id} 는 ${notOff.join(', ')} 에서 꺼져 있지 않습니다 (repo 별로 꺼진 곳: ${(offIn[id] || []).join(', ') || '없음'})`);
    }
    for (const id of ids) {
      const r = all.find((x) => x.id === id);
      if (sub === 'on' && offIn[id] && (!r || r.scope !== 'repo' || r.agents !== 'all' || st.off.includes(id))) { // 없어졌거나 범위가 바뀐 규칙의 남은 기록은 지운다
        offIn[id] = offIn[id].filter((n) => !onlyRepos.includes(n));
        if (!offIn[id].length) delete offIn[id];
        continue;
      }
      if (!r) fail(`없는 규칙입니다: ${id} (kedovi rules list 로 확인)`);
      if (r.required) fail(`${id}(${r.title}) 는 필수 규칙이라 끌 수 없습니다`);
      if (r.scope !== 'repo') fail(`${id} 는 워크스페이스 전체 규칙이라 repo 별로 끌 수 없습니다 (--repo 없이 kedovi rules off ${id})`);
      if (r.agents !== 'all') fail(`${id} 는 Claude 전용 규칙이라 repo 별로 끌 수 없습니다 (--repo 없이 kedovi rules off ${id})`);
      if (st.off.includes(id)) fail(`${id} 는 ${st.replaced[id] ? `${st.replaced[id]} 로 대체돼` : '워크스페이스 전체에서 꺼져'} 있습니다. repo 별로 바꿀 것이 없습니다${st.replaced[id] ? '' : ` (전체 켜기: kedovi rules on ${id})`}`);
      const applies = kit.ruleRepos(r, g.repoMap || {});
      const stray = onlyRepos.filter((n) => !applies.includes(n));
      if (sub === 'off' && stray.length) fail(`${id} 는 ${stray.join(', ')} 에 걸리지 않는 규칙입니다 (걸리는 repo: ${applies.join(', ') || '없음'})`);
      const cur = new Set(offIn[id] || []);
      for (const n of onlyRepos) { if (sub === 'off') cur.add(n); else cur.delete(n); }
      if (cur.size) offIn[id] = [...cur].sort(); else delete offIn[id];
    }
    const ok = saveRulesOff(root, offIn, 'offIn');
    console.log(`✔ repo 별로 끈 규칙: ${Object.entries(offIn).map(([id, names]) => `${id} (${names.join(', ')})`).join(' · ') || '없음'}. workspace.json 을 commit · push 하면 팀에 적용됩니다`);
    process.exit(ok ? 0 : 1);
  }
  if (sub === 'off' || sub === 'on') {
    requireAdmin(root, '규칙 켜고 끄기');
    if (!ids.length) fail(`사용법: ${RULES_USAGE}`);
    const off = new Set(st.off.filter((id) => !st.replaced[id]));
    for (const id of ids) {
      const r = all.find((x) => x.id === id);
      if (!r) fail(`없는 규칙입니다: ${id} (kedovi rules list 로 확인)`);
      if (r.required) fail(`${id}(${r.title}) 는 필수 규칙이라 끌 수 없습니다`);
      if (sub === 'off') off.add(id); else off.delete(id);
    }
    if (sub === 'on') { // repo 별로 꺼 둔 기록도 지운다 (모든 repo 에서 켜기)
      const offIn = readOffIn(root);
      const had = ids.filter((id) => offIn[id]);
      if (had.length) { for (const id of had) delete offIn[id]; saveRulesOff(root, offIn, 'offIn', { sync: false }); console.log(`  repo 별로 꺼 둔 기록도 지웠습니다: ${had.join(', ')} (모든 repo 에서 켜짐)`); }
    }
    const ok = saveRulesOff(root, [...off]);
    console.log(`✔ 꺼진 규칙: ${[...off].join(', ') || '없음'}. workspace.json 을 commit · push 하면 팀에 적용됩니다`);
    process.exit(ok ? 0 : 1);
  }
  if (sub === 'ondemand' || sub === 'always') {
    // 상시 규칙을 필요할 때만 읽게 → AGENTS.md 가 작아진다 (repo-tasks = 「repo 별 작업 규칙」의 작업별 표)
    requireAdmin(root, '규칙 읽는 시점 바꾸기');
    if (!ids.length) fail(`사용법: ${RULES_USAGE}`);
    const lazy = new Set(((kit.loadWorkspace(root).rules || {}).onDemand) || []);
    for (const id of ids) {
      if (id !== 'repo-tasks') {
        const r = all.find((x) => x.id === id);
        if (!r) fail(`없는 규칙입니다: ${id} (kedovi rules list 로 확인)`);
        if (r.required) fail(`${id}(${r.title}) 는 필수 규칙이라 상시로 둡니다`);
        if (sub === 'ondemand' && r.load !== 'always' && !lazy.has(id)) fail(`${id} 는 이미 필요할 때 읽는 규칙입니다`);
      }
      if (sub === 'ondemand') lazy.add(id); else lazy.delete(id);
    }
    const ok = saveRulesOff(root, [...lazy], 'onDemand');
    console.log(`✔ 필요할 때 읽는 것으로 바꾼 규칙: ${[...lazy].join(', ') || '없음'}. workspace.json 을 commit · push 하면 팀에 적용됩니다`);
    process.exit(ok ? 0 : 1);
  }
  if (sub === 'list' || !process.stdin.isTTY) {
    const w = Math.max(...all.map((r) => r.id.length));
    const lazy = st.onDemand || [];
    for (const r of all) console.log(`${padTo(ruleMark(r, st), 8)} ${r.id.padEnd(w)}  ${r.title} (${r.load === 'always' ? '상시' : lazy.includes(r.id) ? '필요할 때, ondemand 로 바꿈' : '필요할 때'})${st.replaced[r.id] ? ` → ${st.replaced[r.id]} 가 대신` : ''}${((st.partial || {})[r.id] || []).map((x) => ` → ${x.repos.join(', ')} 에서만 ${x.by} 가 대신`).join('')}`);
    if (lazy.includes('repo-tasks')) console.log(`${''.padEnd(8)} ${'repo-tasks'.padEnd(w)}  repo 별 작업별 표를 .agents/rules/repo-tasks.md 로 뺌`);
    const offIn = readOffIn(root);
    if (Object.keys(offIn).length) console.log(`\nrepo 별로 끈 규칙: ${Object.entries(offIn).map(([id, names]) => `${id} (${names.join(', ')})`).join(' · ')}`);
    console.log(`\n끄기: kedovi rules off <ID> [--repo <이름,…>] · 켜기: kedovi rules on <ID> [--repo <이름,…>] · 바꾸기: packs/project/rules 에 replaces: <ID> (repos: <이름,…> 면 그 repo 만)`);
    console.log('AGENTS.md 줄이기: kedovi rules ondemand <ID | repo-tasks> (필요할 때만 읽게) · 되돌리기: kedovi rules always <ID | repo-tasks>');
    return;
  }
  requireAdmin(root, '규칙 켜고 끄기');
  clack();
  p.intro(' kedovi rules ');
  await chooseRules(root);
  p.outro('완료');
}

// ───────────────────────── repo add ─────────────────────────

const REPO_USAGE = 'kedovi repo add [<git 주소 | 폴더 | 새로 만들 이름>] [--kind code|docs|issues|legacy] [--group <그룹>] · kedovi repo move <이름> --group <그룹>|--no-group · kedovi repo remove <이름> [--delete] · kedovi repo guides [<이름> follow|kit|ignore] [--rescan]';

/** 워크스페이스에 repo 를 더한다 — clone · 링크 · (이름만 주면) repos/<이름> 에 새로 만들기 → 스택 확인 → sync */
/** repo 빼기: workspace.json repos(와 리뷰 대상 목록)에서 지우고 sync. 폴더는 --delete 일 때만, 커밋 안 한 변경 · push 안 한 커밋이 없을 때 지운다 */
function cmdRepoRemove(rest) {
  const name = rest.find((x) => !x.startsWith('--'));
  if (!name) fail(`사용법: ${REPO_USAGE}`);
  const root = locateWorkspace();
  requireAdmin(root, 'repo 제거');
  const wsFile = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(wsFile));
  const names = (raw.repos || []).map((r) => r.name);
  if (!names.includes(name)) fail(`workspace.json 에 없는 repo 입니다: ${name} (있는 것: ${names.join(', ') || '없음'})`);
  // project 규칙의 repos: 에 이 repo 가 있으면 빼면 sync 가 실패한다. 바꾸기 전에 멈추고 고칠 파일을 알린다
  const pinned = kit.projectRulesPinning(root, name);
  if (pinned.length) fail(`${pinned.join(', ')} 가 repos: 로 ${name} 를 가리킵니다. 그 줄에서 ${name} 를 빼거나 규칙을 지운 뒤 다시 하세요`);
  const rel = kit.repoRel(raw.repos.find((r) => r.name === name));
  const dir = path.join(root, rel);
  let folder = fs.existsSync(dir) ? '그대로 둠 (지우려면 --delete)' : '없음';
  if (rest.includes('--delete') && !kit.repoSafe(raw.repos.find((r) => r.name === name))) fail(`repo 이름 · 그룹이 규칙에 맞지 않아 폴더를 지우지 않습니다: ${name} (--delete 없이 목록에서만 빼세요)`);
  if (rest.includes('--delete') && fs.existsSync(dir)) {
    if (fs.lstatSync(dir).isSymbolicLink()) { fs.unlinkSync(dir); folder = '링크 지움 (원래 폴더는 그대로)'; } else {
      const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
      const dirty = (git('status', '--porcelain').stdout || '').trim();
      const ahead = git('rev-list', '--count', '@{u}..HEAD');
      const unpushed = ahead.status === 0 ? Number(ahead.stdout.trim()) : (git('rev-parse', 'HEAD').status === 0 ? -1 : 0);
      if (dirty || unpushed) fail(`${rel} 에 ${dirty ? '커밋 안 한 변경' : ''}${dirty && unpushed ? ' · ' : ''}${unpushed > 0 ? `push 안 한 커밋 ${unpushed}개` : unpushed < 0 ? '원격 없는 커밋' : ''}이 있어 지우지 않았습니다. 정리한 뒤 다시 하거나 --delete 없이 목록에서만 빼세요`);
      fs.rmSync(dir, { recursive: true, force: true });
      folder = '지움';
    }
  }
  raw.repos = raw.repos.filter((r) => r.name !== name);
  const en = (raw.agents || {}).enforce;
  if (en && Array.isArray(en.reviewRepos)) { en.reviewRepos = en.reviewRepos.filter((r) => r !== name); if (!en.reviewRepos.length) delete en.reviewRepos; }
  fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
  const offIn = readOffIn(root); // repo 별로 꺼 둔 규칙 기록에서 이 repo 를 뺀다
  for (const id of Object.keys(offIn)) { offIn[id] = offIn[id].filter((n) => n !== name); if (!offIn[id].length) delete offIn[id]; }
  const ok = saveRulesOff(root, offIn, 'offIn');
  // 사람이 쓴 문서에 남은 이름 (생성물 · repos/ 밖) — 고치는 건 사람 몫이라 알리기만 한다
  const left = (spawnSync('git', ['-C', root, 'grep', '-l', '-F', '-e', name, '--', '*.md', ':!repos', ':!AGENTS.md', ':!CLAUDE.md', ':!.agents', ':!.claude', ':!.codex', ':!handoffs'], { encoding: 'utf8' }).stdout || '').trim().split('\n').filter(Boolean);
  console.log(`✔ repo 뺌: ${name} · 폴더 ${folder}`);
  if (left.length) console.log(`  이 이름이 남은 문서: ${left.join(', ')} (필요하면 고치세요)`);
  console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다 (팀원 PC 의 repos/ 폴더는 그대로 남습니다)');
  if (!ok) process.exit(1);
}

/** repo 안에 원래 있던 AI 지침 보기 · 따르는 방식 정하기 · 다시 훑기 (repos[].guides · guidesMode) */
function cmdRepoGuides(rest) {
  const root = locateWorkspace();
  let wsKit = {};
  try { wsKit = require(path.join(root, 'bin', 'kit.js')); } catch { /* 없음 */ }
  if (typeof wsKit.scanGuides !== 'function') fail('이 워크스페이스의 킷은 repo 지침을 모릅니다. kedovi upgrade 후 다시 하세요');
  const wsFile = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(wsFile));
  const repos = (raw.repos || []).filter((r) => ['code', 'issues'].includes(r.kind || 'code'));
  const args = rest.filter((x) => !x.startsWith('--'));
  const modes = wsKit.GUIDE_MODES;
  const save = () => { fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n'); return runWorkspaceKit(root, ['sync', '--quiet']); };
  const pick = (name) => { const r = repos.find((x) => x.name === name); if (!r) fail(`코드 · 이슈 repo 가 아닙니다: ${name} (있는 것: ${repos.map((x) => x.name).join(', ') || '없음'})`); return r; };
  if (rest.includes('--rescan')) {
    requireAdmin(root, 'repo 지침 다시 훑기');
    const targets = args.length ? args.map(pick) : repos;
    const lines = [];
    for (const r of targets) {
      const g = wsKit.scanGuides(path.join(root, kit.repoRel(r)));
      if (!g) { lines.push(`  ${r.name}: 폴더 없음 (kedovi install 뒤 다시)`); continue; }
      r.guides = g;
      lines.push(`  ${r.name}: ${g.length ? g.join(', ') : '없음'}`);
    }
    const ok = save();
    console.log(`✔ repo 지침을 다시 훑었습니다\n${lines.join('\n')}\n  workspace.json 이 바뀌었으면 commit · push 하면 팀에 적용됩니다`);
    if (!ok) process.exit(1);
    return;
  }
  if (args.length >= 2) {
    const [name, mode] = args;
    if (!wsKit.isGuideMode(mode)) fail(`방식은 ${Object.keys(modes).map((k) => `${k}(${modes[k]})`).join(' · ')} 중 하나`);
    requireAdmin(root, 'repo 지침 방식 바꾸기');
    const r = pick(name);
    if (mode === 'follow') delete r.guidesMode; else r.guidesMode = mode;
    { const g = wsKit.scanGuides(path.join(root, kit.repoRel(r))); if (g) r.guides = g; } // 방식을 바꿀 때는 늘 다시 훑는다
    const ok = save();
    console.log(`✔ ${name}: ${modes[mode]}${Array.isArray(r.guides) && !r.guides.length ? ' (지금은 지침 파일이 없습니다. 생기면 sync 가 알립니다)' : ''}`);
    console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다');
    if (!ok) process.exit(1);
    return;
  }
  if (!repos.length) { console.log('코드 · 이슈 repo 가 없습니다'); return; }
  const shown = args.length === 1 ? [pick(args[0])] : repos;
  const w = Math.max(...shown.map((r) => r.name.length));
  for (const r of shown) {
    const mode = wsKit.isGuideMode(r.guidesMode) ? r.guidesMode : 'follow';
    const g = Array.isArray(r.guides) ? (r.guides.length ? r.guides.join(', ') : '없음') : '아직 훑지 않음 (repo 를 받은 뒤 sync 가 훑는다)';
    console.log(`${r.name.padEnd(w)}  ${modes[mode].padEnd(8)}  ${g}`);
  }
  console.log('\n방식: follow = repo 지침 우선 (기본) · kit = 킷 규칙 우선 · ignore = 무시. 바꾸기: kedovi repo guides <이름> <방식> · 다시 훑기: kedovi repo guides --rescan');
}

const GROUP_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._][A-Za-z0-9._-]*$/; // bin/kit.js REPO_SEG 와 같다 ('.' · '..' · '-' 로 시작 금지)
const NEW_GROUP = Symbol('new-group');
/** 이 워크스페이스의 킷(bin/kit.js)이 그룹 폴더를 아는지 — 모르면 install 이 repos/<이름> 에 받아 버린다 */
function requireGroups(root) {
  let ok = false;
  try { ok = typeof require(path.join(root, 'bin', 'kit.js')).repoRel === 'function'; } catch { /* 없음 */ }
  if (!ok) fail('이 워크스페이스의 킷은 그룹 폴더(--group)를 모릅니다. kedovi upgrade 후 다시 하세요');
}

/** repo 를 그룹 폴더로 옮긴다: 폴더 이동 → workspace.json group → 사람이 쓴 문서의 경로 → sync */
function cmdRepoMove(rest) {
  const name = rest.find((x, i) => !x.startsWith('--') && rest[i - 1] !== '--group');
  const gi = rest.indexOf('--group');
  const group = rest.includes('--no-group') ? '' : gi >= 0 ? rest[gi + 1] : undefined;
  if (!name || group === undefined || (gi >= 0 && (!group || group.startsWith('--')))) fail(`사용법: ${REPO_USAGE}`);
  const root = locateWorkspace();
  requireAdmin(root, 'repo 옮기기');
  const wsFile = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(wsFile));
  const repo = (raw.repos || []).find((r) => r.name === name);
  if (!repo) fail(`workspace.json 에 없는 repo 입니다: ${name} (있는 것: ${(raw.repos || []).map((r) => r.name).join(', ') || '없음'})`);
  if (group && !GROUP_NAME.test(group)) fail(`그룹 이름은 영문·숫자·._- 만 (한 단계): ${group}`);
  if (group && raw.repos.some((r) => !r.group && r.name === group)) fail(`그룹 '${group}' 이 그룹 없는 repo 이름과 같아 폴더가 겹칩니다`);
  if ((repo.group || '') === group) { console.log(`이미 ${kit.repoRel(repo)} 입니다`); return; }
  if (group) requireGroups(root);
  const from = kit.repoRel(repo);
  const to = kit.repoRel({ ...repo, group });
  const src = path.join(root, from), dst = path.join(root, to);
  if (fs.existsSync(dst)) fail(`${to} 가 이미 있습니다. 비우거나 다른 그룹을 고르세요`);
  let folder = '없음 (kedovi install 때 새 위치로 받습니다)';
  let isLink = false;
  try { isLink = fs.lstatSync(src).isSymbolicLink(); } catch { /* 없음 */ }
  if (isLink) { fs.unlinkSync(src); folder = '링크 지움 (sync 뒤 install 이 새 위치에 다시 링크)'; }
  else if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    folder = '옮김';
  }
  // 빈 그룹 폴더는 지운다
  const oldParent = path.dirname(src);
  if (repo.group && oldParent !== path.join(root, kit.REPOS_DIR)) { try { fs.rmdirSync(oldParent); } catch { /* 비어 있지 않음 */ } }
  if (group) repo.group = group; else delete repo.group;
  fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
  // 사람이 쓴 문서 (워크스페이스 git 의 md · 생성물 · handoffs 제외) 의 옛 경로를 바꾼다
  const re = new RegExp(`(?<![\\w.-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g');
  const listed = (spawnSync('git', ['-C', root, 'grep', '-l', '-F', '-e', from, '--', '*.md', ':!repos', ':!AGENTS.md', ':!CLAUDE.md', ':!.agents', ':!.claude', ':!.codex', ':!handoffs'], { encoding: 'utf8' }).stdout || '').trim().split('\n').filter(Boolean);
  const fixed = [];
  for (const f of listed) {
    const file = path.join(root, f);
    const cur = read(file);
    const next = cur.replace(re, to);
    if (next !== cur) { fs.writeFileSync(file, next); fixed.push(f); }
  }
  const ok = runWorkspaceKit(root, isLink ? ['install'] : ['sync', '--quiet']);
  console.log(`✔ repo 옮김: ${from} → ${to} · 폴더 ${folder}`);
  if (fixed.length) console.log(`  문서 경로 고침: ${fixed.join(', ')}`);
  console.log('  workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다 (팀원 PC 는 kedovi repo move 를 같이 하거나, 옛 폴더를 지우고 kedovi install)');
  console.log('  열려 있는 IDE · 터미널은 새 경로로 다시 엽니다');
  if (!ok) process.exit(1);
}

async function cmdRepo(argv = []) {
  const [sub, ...rest] = argv;
  if (sub === 'remove' || sub === 'rm') return cmdRepoRemove(rest);
  if (sub === 'guides') return cmdRepoGuides(rest);
  if (sub === 'move' || sub === 'mv') return cmdRepoMove(rest);
  if (sub !== 'add') fail(`사용법: ${REPO_USAGE}`);
  const root = locateWorkspace();
  requireAdmin(root, 'repo 추가');
  const wsFile = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(wsFile));
  const names = (raw.repos || []).map((r) => r.name);
  const ki = rest.indexOf('--kind');
  const gi = rest.indexOf('--group');
  let kind = ki >= 0 ? rest[ki + 1] : null;
  let group = gi >= 0 ? rest[gi + 1] : undefined;
  if (gi >= 0 && (!group || group.startsWith('--'))) fail(`--group 뒤에 그룹 이름을 주세요. 사용법: ${REPO_USAGE}`);
  let value = rest.filter((x, i) => !x.startsWith('--') && (ki < 0 || i !== ki + 1) && (gi < 0 || i !== gi + 1))[0] || null;
  const tty = process.stdin.isTTY;
  if (tty) { clack(); p.intro(' kedovi repo add '); }
  if (!kind) {
    kind = tty ? ask(await choose({ message: 'repo 종류', hint: '종류에 따라 에이전트가 쓰는 방식이 다릅니다 (코드 = 고침, 기획·레거시 = 읽기 전용, 이슈 = 문서 작성).', initialValue: 'code',
      options: Object.entries(kit.REPO_KINDS).map(([k, label]) => ({ value: k, label })) })) : 'code';
  }
  if (!kit.REPO_KINDS[kind]) fail(`--kind 는 ${Object.keys(kit.REPO_KINDS).join(' | ')} 중 하나`);
  const allowNew = kind !== 'legacy'; // 레거시는 이미 있는 소스라 새로 만들 수 없다
  let picked = false;
  if (!value) {
    if (!tty) fail(`사용법: ${REPO_USAGE}`);
    picked = true;
    value = ask(await askRepo({ message: 'repository', hint: '원격 없이 로컬에만 있는 repo 는 기존 로컬 폴더로 넣습니다 (링크).', allowNew, taken: [...names] }));
  }
  // 화면에서 고른 값은 이미 검사했다 (방식별). 인자로 준 값만 자동 판별해 검사한다
  const entryValue = picked || String(value).startsWith(NEW_PREFIX) ? value : asEntry(String(value).trim(), allowNew);
  const err = picked ? null : validateOne([], true, allowNew)(String(entryValue).replace(NEW_PREFIX, ''));
  if (err && !String(entryValue).startsWith(NEW_PREFIX)) fail(err);
  const [repo] = parseRepoList([entryValue], kind, root, [...names]);
  if (names.includes(repo.name)) fail(`이미 있는 repo 이름입니다: ${repo.name} (그룹이 달라도 이름은 하나만)`);
  // 그룹 폴더 repos/<그룹>/<이름>: 이미 그룹을 쓰는 워크스페이스면 대화형에서 고른다
  const groups = [...new Set((raw.repos || []).map((r) => r.group).filter(Boolean))];
  if (group === undefined && tty && groups.length) {
    const v = ask(await choose({ message: '그룹 폴더', hint: `repos/<그룹>/${repo.name} 에 받습니다. 그룹 없음 = repos/${repo.name}`, initialValue: groups[0],
      options: [...groups.map((g) => ({ value: g, label: g })), { value: '', label: '그룹 없음' }, { value: NEW_GROUP, label: '새 그룹' }] }));
    group = v === NEW_GROUP ? ask(await input({ message: '새 그룹 이름', hint: '영문·숫자·._- (예: server · client · plans)', validate: (x) => (GROUP_NAME.test(String(x || '').trim()) ? undefined : '영문·숫자·._- 만') })).trim() : v;
  }
  if (group) {
    if (!GROUP_NAME.test(group)) fail(`그룹 이름은 영문·숫자·._- 만 (한 단계): ${group}`);
    if (names.includes(group)) fail(`그룹 '${group}' 이 그룹 없는 repo 이름과 같아 폴더가 겹칩니다`);
    requireGroups(root);
    repo.group = group;
  }
  if (repo.local) {
    const ver = (raw.kit || {}).version || '0.0.0';
    const [a, b] = ver.split('.').map(Number);
    if (a === 0 && b < 14) fail(`이 워크스페이스(킷 ${ver})는 원격 없는 repo 를 모릅니다. kedovi upgrade 후 다시 하세요`);
    if (!NEW_NAME.test(repo.name)) fail(`이름은 영문·숫자·._- 만: ${repo.name}`);
  }
  if ((kind === 'code' || kind === 'issues') && repo.remote) {
    const h = kit.inferHost(repo.remote);
    if (h) repo.host = h;
    else if (tty) {
      const v = ask(await choose({ message: '이 repo 의 협업 도구', hint: '주소만으로는 GitHub 인지 GitLab 인지 알 수 없습니다. MR·PR 규칙이 여기에 따라 붙습니다.', initialValue: 'gitlab',
        options: [{ value: 'gitlab', label: 'GitLab' }, { value: 'github', label: 'GitHub' }, { value: 'none', label: '기타·없음' }] }));
      repo.host = v;
    }
  }
  raw.repos = [...(raw.repos || []), repo];
  fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
  if (repo.local) {
    // 이 PC 에서만 만든다 — 팀원 PC 는 원격이 생길 때까지 기다린다 (install 이 "아직 원격 없음")
    const dir = path.join(root, kit.repoRel(repo));
    fs.mkdirSync(dir, { recursive: true });
    spawnSync('git', ['init', '-q', dir]);
  }
  const ok = runWorkspaceKit(root, ['install']);
  if (tty && kind === 'code' && (await reviewStacks(root, { force: true, only: repo.name })) === BACK) p.log.info('스택은 감지 결과대로 두었습니다. kedovi detect 로 고칠 수 있습니다');
  const lines = [`${kit.repoRel(repo)} (${kit.REPO_KINDS[kind]}) ← ${repo.remote || repo.path || '새로 만듦 (원격 없음)'}`,
    'workspace.json 이 바뀌었습니다. commit · push 하면 팀원이 kedovi install 로 받습니다.'];
  if (repo.local && kind === 'docs') lines.push(`기획 repo 뼈대(폴더 · 견본)가 필요하면: kedovi init-docs ${kit.repoRel(repo)}`);
  if (repo.local) lines.push(`원격 저장소를 만든 뒤: git -C ${kit.repoRel(repo)} remote add origin <주소> && git -C ${kit.repoRel(repo)} push -u origin HEAD`,
    '그다음 sync(세션 시작 때 자동)가 workspace.json 에 주소를 채웁니다. 그 workspace.json 을 commit · push 하세요.');
  if (tty) { p.note(lines.join('\n'), '추가함'); p.outro(ok ? '완료' : '확인할 것이 있습니다'); } else console.log(lines.join('\n'));
  if (!ok) process.exit(1);
}

async function cmdDetect(argv = []) {
  const root = locateWorkspace();
  // 힌트 추가는 화면 없이 엔진에 넘긴다 — 추가 후 다시 감지해 결과를 보여 준다
  requireAdmin(root, '스택 감지·수정');
  if (argv.includes('--hint')) process.exit(runWorkspaceKit(root, ['detect', ...argv]) ? 0 : 1);
  if (process.stdin.isTTY) { clack(); p.intro(' kedovi detect '); if ((await reviewStacks(root, { force: true })) === BACK) return p.cancel('취소했습니다'); return p.outro('완료: AGENTS.md 의 repo 별 작업 규칙이 갱신됐습니다'); }
  process.exit(runWorkspaceKit(root, ['detect', '--force']) ? 0 : 1);
}

// ───────────────────────── models (역할별 모델) ─────────────────────────

/** 역할·도구별 모델을 보고 고친다. 팀 기본값 = workspace.json agents, 내 PC = .agents/local.json agents */
/** 퇴역 모델을 대체 모델로 바꾼다 (팀 기본값·이 PC 설정 모두) */
function migrateModels(root) {
  const audit = kit.auditModels(root, kit.loadWorkspace(root)).filter((a) => a.replacement);
  if (!audit.length) { console.log('✔ 바꿀 퇴역 모델이 없습니다'); return 0; }
  const edit = (file, key) => {
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(read(file));
    for (const a of audit.filter((x) => x.where === key)) {
      let node = raw.agents;
      for (const k of a.path.slice(0, -1)) node = node[k];
      node[a.path[a.path.length - 1]] = a.replacement;
      console.log(`  ${key} agents.${a.path.join('.')}: ${a.id} → ${a.replacement}`);
    }
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  };
  edit(path.join(root, 'workspace.json'), 'workspace.json');
  edit(localConfigPath(root), '.agents/local.json');
  runWorkspaceKit(root, ['sync']);
  if (audit.some((a) => a.where === 'workspace.json')) console.log('  → workspace.json 이 바뀌었습니다. commit · push 하면 팀에 적용됩니다');
  return audit.length;
}

/**
 * 화면 없이 모델 바꾸기 (AI 가 대신 실행할 때) — 반환: 처리했으면 true
 *   kedovi models profile [rich|standard|lean|team] [--team]         프로필 (team = 이 PC 값 지우고 팀 기본 따름, 호환: - · 팀). 이 PC 값은 팀보다 낮은 것만. 인자 없이 실행하면 화면에서 고른다
 *   kedovi models set <main|crossReview|역할> <claude|codex> <모델|-> [--team] [--effort <e>]   모델 (- = 직접 지정 지우기, 위임은 codex:<모델>)
 *   kedovi models allow-higher on|off                                 팀원이 팀보다 높은 프로필을 둘 수 있게 (workspace.json agents.allowHigherProfile, 팀장)
 */
async function modelsCommand(root, argv) {
  const [sub, ...rest] = argv;
  if (!['profile', 'set', 'allow-higher'].includes(sub)) return false;
  if (sub === 'allow-higher') {
    let onOff = rest[0];
    if (!onOff && process.stdin.isTTY) {
      clack();
      const { profile } = kit.resolveModels(root, kit.loadWorkspace(root));
      onOff = await chooseInline({ message: '팀원이 팀보다 높은 프로필을 써도 되나요?', hint: '허용하지 않으면 이 PC 프로필은 팀과 같거나 낮은 것만 적용됩니다.',
        options: [{ value: 'off', label: '아니오 (팀과 같거나 낮은 것만)' }, { value: 'on', label: '예 (높은 프로필도 허용)' }], initialValue: profile.allowHigher ? 'on' : 'off' });
      if (onOff === BACK) return true;
    }
    if (!['on', 'off'].includes(onOff)) fail('사용법: kedovi models allow-higher on|off (인자 없이 실행하면 화면에서 고른다)');
    rest[0] = onOff;
    requireAdmin(root, '팀 프로필 허용 범위 변경');
    const wsFile = path.join(root, 'workspace.json');
    const raw = JSON.parse(read(wsFile));
    raw.agents = { ...(raw.agents || {}) };
    if (rest[0] === 'on') raw.agents.allowHigherProfile = true; else delete raw.agents.allowHigherProfile;
    fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
    runWorkspaceKit(root, ['sync', '--quiet']);
    console.log(`✔ 팀원의 이 PC 프로필: ${rest[0] === 'on' ? '팀보다 높은 프로필도 허용' : '팀과 같거나 낮은 것만'} (workspace.json, commit · push 하면 팀 적용)`);
    return true;
  }
  const team = rest.includes('--team');
  const ei = rest.indexOf('--effort');
  const effort = ei >= 0 ? rest[ei + 1] : null;
  const args = rest.filter((x, i) => x !== '--team' && !(ei >= 0 && (i === ei || i === ei + 1)));
  if (team) requireAdmin(root, '팀 기본 모델 변경');
  const cat = modelCatalog(root);
  const where = team ? '팀 기본값(workspace.json, commit · push 하면 팀 적용)' : '이 PC(.agents/local.json)';
  if (sub === 'profile') {
    let v = args[0];
    const pfs = Object.keys(cat.profiles || {});
    const CLEAR = ['team', '-', '팀']; // 이 PC 값 지우고 팀 따름 (- 와 팀 은 호환)
    if (!v && process.stdin.isTTY) {
      // 인자 없이 실행: 화면에서 고른다. 이 PC 범위는 팀과 같거나 낮은 프로필만 보인다
      clack();
      const tool = readLocal(root).agent || 'claude';
      p.note(profileTable(cat, tool, listRoles(root), accessOf(root)), `${AGENTS[tool].label} 로 실행할 때의 추천 모델`);
      const picked = await chooseProfile(root, tool, team ? 'team' : 'local', team ? undefined : (readLocal(root).agents || {}).profile || '', { roles: false });
      if (picked === BACK || clack().isCancel(picked)) return true;
      v = picked === '' ? 'team' : picked;
    }
    if (!v || (!pfs.includes(v) && !(CLEAR.includes(v) && !team))) fail(`사용법: kedovi models profile [${pfs.join('|')}${team ? '' : '|team'}] [--team]  (인자 없이 실행하면 화면에서 고른다. team = 이 PC 값 지우고 팀 따름)`);
    const clear = CLEAR.includes(v);
    if (!team && !clear && !profileAllowed(root, cat, v)) {
      const { profile } = kit.resolveModels(root, kit.loadWorkspace(root));
      fail(`이 PC 프로필은 팀 프로필(${kit.profileLabel(cat, profile.team)})과 같거나 낮은 것만 됩니다. 팀 값을 올리려면 kedovi models profile ${v} --team, 팀원에게 높은 프로필을 허용하려면 kedovi models allow-higher on (팀장)`);
    }
    saveProfile(root, team ? 'team' : 'local', clear ? '' : v);
  } else {
    const [role, tool, model] = args;
    const roles = listRoles(root).map((r) => r.name);
    if (!role || !['main', 'crossReview', ...roles].includes(role) || !AGENTS[tool] || model === undefined) fail(`사용법: kedovi models set <main|crossReview|${roles.join('|')}> <claude|codex> <모델|-> [--team] [--effort <e>]`);
    if (role === 'main' && kit.splitModel(model, tool).delegated) fail('메인은 실행 도구의 모델이어야 합니다 (위임 불가)');
    const agents = JSON.parse(JSON.stringify(readPicks(root, team ? 'team' : 'local')));
    let node = agents;
    for (const k of role === 'main' || role === 'crossReview' ? [role] : ['roles', role]) node = node[k] = node[k] || {};
    if (model === '-') delete node[tool]; else node[tool] = model;
    if (effort) node.effort = { ...(typeof node.effort === 'object' ? node.effort : {}), [tool]: effort };
    writePicks(root, team ? 'team' : 'local', agents);
  }
  runWorkspaceKit(root, ['sync', '--quiet']);
  const { effective } = kit.resolveModels(root, kit.loadWorkspace(root));
  console.log(`✔ ${where} 에 저장했습니다`);
  const notice = kit.profileNotice(root, kit.loadWorkspace(root));
  if (notice) console.log(`  ${notice}`);
  console.log(JSON.stringify({ main: effective.main, crossReview: effective.crossReview, roles: effective.roles }, null, 2));
  if (kit.auditModels) for (const a of kit.auditModels(root, kit.loadWorkspace(root))) console.log(`  ${a.message}`);
  return true;
}

const AI_USAGE = 'kedovi ai [show | direct <claude,gpt> | plan claude|gpt <요금제> | gateway [--url <주소> --key-env <변수>] | refresh | compose mix|vendor|single | main claude|gpt] [--team]';
const ROOM_TEXT = { tight: '빠듯', ample: '넉넉', metered: '종량' };

/** 이 PC 의 시작 도구가 연결 방식과 안 맞으면 맞춘다 (직접 연결인데 그 회사를 안 쓰는 경우). 반환: 바꾼 도구 · null */
function fitStartTool(root) {
  const a = accessOf(root);
  const cur = readLocal(root).agent;
  const vendorOk = (t) => a.connection === 'gateway' ? t === 'claude' || a.main !== 'codex' : a.vendors.includes(t);
  if (cur && vendorOk(cur)) return null;
  const tool = kit.startToolOf(a);
  writeLocal(root, { agent: tool, args: cur === tool ? readLocal(root).args || [] : [] });
  return tool;
}

function showAccess(root) {
  const a = accessOf(root);
  const { run, runWarnings } = kit.resolveModels(root, kit.loadWorkspace(root));
  const agent = readLocal(root).agent || kit.startToolOf(a);
  const roleOf = (x) => { const sp = kit.splitModel((x || {})[agent], agent); return sp.delegated ? `${sp.tool}:${sp.model} (위임)` : sp.model || '메인과 같게'; };
  console.log(JSON.stringify({
    summary: accessSummary(a), connection: a.connection, vendors: a.vendors, compose: a.compose, main: a.main,
    gateway: a.gateway ? { url: a.gateway.url, source: a.gateway.source, keyEnv: a.gateway.keyEnv || null, models: (a.gateway.models || []).length, checked: a.gateway.checked || null } : null,
    plans: (() => { const ws = kit.loadWorkspace(root); const c = kit.loadCatalogFor(root, ws).cat; const r = kit.vendorRooms(c, a, kit.teamOptions(ws, readLocal(root).agents || {}).plans); const d = kit.detectPlans(c); return Object.fromEntries(['claude', 'codex'].map((v) => [v, { plan: r[v].plan, label: r[v].label, room: r[v].room ? ROOM_TEXT[r[v].room] : '모름', login: d[v].id || d[v].raw || null }])); })(),
    startTool: agent, mainModel: (run.main || {})[agent] || '도구 기본',
    roles: Object.fromEntries(Object.entries(run.roles || {}).map(([n, x]) => [n, roleOf(x)])),
    crossReview: (run.crossReview || {})[OTHER[agent]] || '쓰지 않음',
    warnings: runWarnings,
  }, null, 2));
  // 정하지 않았는데 이 PC 의 Claude Code · Codex 가 게이트웨이로 이어져 있으면: 실제 연결과 저장값이 다르다
  const found = a.set ? [] : gateway.detect();
  if (found.length) console.warn(`⚠ 연결 방식을 정하지 않아 서비스 직접으로 봅니다. 이 PC 는 게이트웨이 ${found[0].url} 로 이어져 있습니다 (${found[0].source}). 맞추기: kedovi ai gateway`);
}

async function cmdAi(argv = []) {
  const root = locateWorkspace();
  const team = argv.includes('--team');
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const args = argv.filter((x, i) => !x.startsWith('--') && !['--url', '--key-env'].includes(argv[i - 1]));
  const [sub, arg] = args;
  if (!sub || sub === 'show') {
    if (!sub && process.stdin.isTTY && !team) {
      clack();
      const a = ask(await chooseAccess(root));
      const moved = fitStartTool(root);
      runWorkspaceKit(root, ['sync', '--quiet']);
      p.log.success(`저장: ${accessSummary(a)} (이 PC 전용)`);
      if (moved) p.log.info(`시작 도구를 ${AGENTS[moved].label} 로 바꿨습니다`);
      return p.outro('역할 모델 표는 kedovi models 로 봅니다');
    }
    return showAccess(root);
  }
  if (team) requireAdmin(root, '팀 기본 연결 방식 변경');
  const scope = team ? 'team' : 'local';
  // 요금제 — 연결 방식(access)과 따로 agents.plans 에 둔다 (회사마다 이 PC 값이 팀 기본값보다 우선)
  if (sub === 'plan') {
    const v = ({ claude: 'claude', anthropic: 'claude', gpt: 'codex', openai: 'codex', codex: 'codex', chatgpt: 'codex' })[String(arg || '').toLowerCase()];
    const id = args[2];
    const list = ((kit.loadCatalogFor(root, kit.loadWorkspace(root)).cat.plans || {})[v]) || [];
    if (!v || !list.some((x) => x.id === id)) fail(`사용법: kedovi ai plan claude|gpt <요금제> [--team]. ${v ? `${v === 'codex' ? 'ChatGPT' : 'Claude'} 요금제: ${list.map((x) => `${x.id}(${x.label} · ${ROOM_TEXT[x.room]})`).join(', ')}` : ''}`);
    if (team) { const f = path.join(root, 'workspace.json'); const w = JSON.parse(read(f)); w.agents = { ...(w.agents || {}), plans: { ...((w.agents || {}).plans || {}), [v]: id } }; fs.writeFileSync(f, `${JSON.stringify(w, null, 2)}\n`); }
    else { const a = readLocal(root).agents || {}; writeLocal(root, { agents: { ...a, plans: { ...(a.plans || {}), [v]: id } } }); }
    runWorkspaceKit(root, ['sync', '--quiet']);
    const pl = list.find((x) => x.id === id);
    console.log(`✔ ${v === 'codex' ? 'ChatGPT' : 'Claude'} 요금제: ${pl.label} (${ROOM_TEXT[pl.room]}) · ${team ? '팀 기본값(workspace.json, commit · push 하면 팀 적용. 이 PC 값이 있는 사람은 그 값이 우선)' : '이 PC(.agents/local.json)'}`);
    return;
  }
  let raw = {};
  try { raw = team ? (JSON.parse(read(path.join(root, 'workspace.json'))).agents || {}).access || {} : (readLocal(root).agents || {}).access || {}; } catch { /* 없음 */ }
  const next = { ...raw };
  const vendorId = (x) => ({ claude: 'claude', anthropic: 'claude', gpt: 'codex', openai: 'codex', codex: 'codex' })[String(x).toLowerCase()];
  if (sub === 'direct') {
    const vendors = [...new Set(String(arg || '').split(',').map(vendorId))];
    if (!vendors.length || vendors.includes(undefined)) fail(`사용법: kedovi ai direct <claude|gpt|claude,gpt>`);
    Object.assign(next, { connection: 'direct', vendors });
    delete next.gateway; delete next.main;
  } else if (sub === 'gateway' || sub === 'refresh') {
    let g;
    if (val('--url')) {
      const url = String(val('--url')).replace(/\/+$/, '').replace(/\/v1$/, '');
      // 키 환경변수를 안 주면 이 PC 설정에서 같은 주소를 찾아 그 키 이름을 쓴다 (ANTHROPIC_AUTH_TOKEN 등)
      const same = gateway.detect().find((x) => x.url === url);
      const keyName = val('--key-env') || (same && same.keyName) || null;
      if (!val('--key-env') && keyName) console.log(`키 환경변수: ${keyName} (${same.source} 에서 찾음)`);
      g = { url, source: '직접 입력', keyName, key: keyName ? process.env[keyName] || (same && same.keyName === keyName ? same.key : null) : null, aliases: !!(same && same.aliases) };
    } else {
      const saved = sub === 'refresh' ? (raw.gateway || accessOf(root).gateway) : null;
      if (sub === 'refresh' && !saved) fail('게이트웨이 설정이 없습니다. kedovi ai gateway 로 먼저 정하세요');
      const found = gateway.detect();
      g = saved ? found.find((x) => x.url === saved.url) || { url: saved.url, source: saved.source || '저장된 설정', keyName: saved.keyEnv || null, key: saved.keyEnv ? process.env[saved.keyEnv] || null : null, aliases: !!saved.aliases } : found[0];
      if (!g) fail('이 PC 에서 게이트웨이 설정을 찾지 못했습니다. kedovi ai gateway --url <주소> --key-env <키가 든 환경변수 이름>');
      if (saved && !found.includes(g) && g.key && !(await trustGateway(root, { url: g.url, keyEnv: g.keyName }))) g = { ...g, key: null };
    }
    if (g.key && !gateway.safeUrl(g.url)) { console.warn(`⚠ 게이트웨이 주소가 https 가 아니라 키 없이 조회합니다: ${g.url}`); g = { ...g, key: null }; }
    const r = await gateway.listModels(g.url, g.key);
    if (!r.ok) console.warn(`⚠ 모델 목록 조회 실패 (${r.error}). 킷 기본 모델 이름으로 진행합니다. 나중에 kedovi ai refresh`);
    next.connection = 'gateway';
    next.gateway = gateway.toSaved(g, r.ok ? r.models : ((raw.gateway || {}).models || []));
    delete next.vendors;
    if (r.ok) console.log(`✔ 게이트웨이 ${g.url}: 모델 ${r.models.length}개\n${gatewayNote(r.models)}`);
  } else if (sub === 'compose') {
    if (!['mix', 'vendor', 'single'].includes(arg)) fail('사용법: kedovi ai compose mix|vendor|single (섞기 · 한 회사만 · 단일 모델)');
    next.compose = arg;
  } else if (sub === 'main') {
    const v = vendorId(arg);
    if (!v) fail('사용법: kedovi ai main claude|gpt (게이트웨이에서 Claude Code 메인 모델 회사)');
    if (kit.normalizeAccess(next).connection !== 'gateway' && v === 'codex') fail('GPT 메인을 Claude Code 로 돌리는 것은 게이트웨이에서만 됩니다. GPT 만 쓰면 kedovi ai direct gpt (Codex 로 시작)');
    next.main = v;
  } else fail(`사용법: ${AI_USAGE}`);
  saveAccess(root, scope, next);
  const moved = team ? null : fitStartTool(root);
  runWorkspaceKit(root, ['sync', '--quiet']);
  console.log(`✔ ${team ? '팀 기본값(workspace.json, commit · push 하면 팀 적용. 이 PC 값이 있는 사람은 그 값이 우선)' : '이 PC(.agents/local.json)'} 에 저장했습니다: ${accessSummary(kit.normalizeAccess(next))}`);
  if (moved) console.log(`  시작 도구를 ${AGENTS[moved].label} 로 바꿨습니다`);
  showAccess(root);
}

/** 팀 구성 옵션 — 모드 · 역할별 선호 모델. 팀(workspace.json agents, --team) · 이 PC(.agents/local.json agents). 요금제는 kedovi ai (plan) */
/** 진행 방식 (workspace.json project.approach): 스프린트 · 전체 · 이슈형. 바꾸면 sync 하고, 로드맵이 기본 단계 그대로면 새 뼈대로 (이슈형이면 고친 로드맵에도 이슈 보드를 끼운다) */
function cmdApproach(argv) {
  const root = locateWorkspace();
  const wsFile = path.join(root, 'workspace.json');
  const cur = (JSON.parse(read(wsFile)).project || {}).approach;
  const want = argv[0];
  if (!want) {
    console.log(`진행 방식: ${cur ? kit.APPROACHES[cur] || cur : '정하지 않음 (전체처럼 동작)'}`);
    for (const [k, v] of Object.entries(kit.APPROACHES)) console.log(`  kedovi approach ${k.padEnd(12)} ${v}`);
    return;
  }
  if (!kit.APPROACHES[want]) fail(`사용법: kedovi approach [${Object.keys(kit.APPROACHES).join('|')}]`);
  const wsKit = read(path.join(root, 'bin', 'kit.js'));
  if (!wsKit.includes('APPROACHES') || (want === 'issue' && !/issue: '이슈형/.test(wsKit))) fail('이 워크스페이스의 킷이 이 진행 방식을 모릅니다. kedovi upgrade 를 먼저 하세요');
  requireAdmin(root, '진행 방식 변경');
  const w = JSON.parse(read(wsFile));
  w.project = { ...(w.project || {}), approach: want };
  fs.writeFileSync(wsFile, `${JSON.stringify(w, null, 2)}\n`);
  if (!runWorkspaceKit(root, ['sync', '--quiet'])) process.exit(1);
  const planMade = kit.ensurePlan(root, { sw: true });
  console.log(`✔ 진행 방식: ${kit.APPROACHES[want]} (workspace.json. commit·push 하면 팀 적용)`);
  console.log(planMade ? `  로드맵 ${planMade.replace(/^✔ /, '')}` : '  로드맵(handoffs/PLAN.md)은 그대로 둡니다 (이미 이 진행 방식의 모양이거나, 고친 적 · 끝낸 단계가 있음). 필요하면 에이전트에게 진행 방식에 맞게 고쳐 달라고 하세요');
}

/**
 * 유형 바꾸기 (팀장): 분석·설계를 끝내고 같은 워크스페이스에서 구축 · 고도화로 넘어갈 때 등.
 * 유형 팩 교체 · 필수 repo(현행 repo 중 고칠 것을 개발 repo 로) · 진행 방식 · 로드맵(새 뼈대, 지난 로드맵은 아래에 남김) → sync
 */
async function cmdType(argv) {
  const root = locateWorkspace();
  const wsFile = path.join(root, 'workspace.json');
  const w = JSON.parse(read(wsFile));
  const cur = (w.project || {}).type;
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const want = argv.find((x, i) => !x.startsWith('--') && !['--approach', '--code'].includes(argv[i - 1]));
  if (!want) {
    console.log(`유형: ${kit.PROJECT_TYPES[cur] || cur || '정하지 않음'}`);
    for (const [k, v] of Object.entries(kit.PROJECT_TYPES)) console.log(`  kedovi type ${k.padEnd(14)} ${v}`);
    console.log('  옵션: --approach sprint|full|issue · --code <현행 repo 이름,…> (개발 repo 로 바꿀 것)');
    return;
  }
  if (!kit.PROJECT_TYPES[want]) fail(`사용법: kedovi type [${Object.keys(kit.PROJECT_TYPES).join('|')}] [--approach ${Object.keys(kit.APPROACHES).join('|')}] [--code <이름,…>]`);
  if (want === cur) { console.log(`이미 ${kit.PROJECT_TYPES[cur]} 입니다`); return; }
  if (!/issue: '이슈형/.test(read(path.join(root, 'bin', 'kit.js')))) fail('이 워크스페이스의 킷이 오래됐습니다. kedovi upgrade 를 먼저 하세요');
  requireAdmin(root, '유형 변경');
  const tty = process.stdin.isTTY;
  if (tty) { clack(); p.intro(' kedovi type '); }
  const rule = kit.TYPE_RULES[want];
  // 필수 repo: 개발 repo 가 필요한 유형인데 없으면 현행(레거시) repo 중 고칠 것을 개발 repo 로
  const repos = w.repos || [];
  let toCode = String(opt('code') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const legacy = repos.filter((r) => r.kind === 'legacy');
  if (!toCode.length && tty && legacy.length && (rule.requires.includes('code') || want === 'new')) {
    const v = await chooseMany({ message: '고칠 repo (현행 → 개발 repo)', hint: '고른 repo 는 에이전트가 고치는 개발 repo 가 되고, 나머지는 읽기 전용 현행 소스로 남습니다.',
      options: legacy.map((r) => ({ value: r.name, label: r.name, hint: kit.repoRel(r) })), initialValues: [] });
    if (v === BACK || clack().isCancel(v)) { p.cancel('취소했습니다'); process.exit(0); }
    toCode = v;
  }
  for (const n of toCode) if (!repos.some((r) => r.name === n)) fail(`없는 repo 입니다: ${n}`);
  for (const r of repos) if (toCode.includes(r.name)) { r.kind = 'code'; if (/AS-IS|읽기 전용/.test(r.role || '')) delete r.role; }
  // 진행 방식
  let approach = opt('approach');
  if (approach && !kit.APPROACHES[approach]) fail(`--approach 는 ${Object.keys(kit.APPROACHES).join(' | ')} 중 하나`);
  if (!approach && tty) {
    const v = await choose({ message: '진행 방식', hint: '로드맵 모양이 정해집니다. 나중에 kedovi approach 로 바꿉니다.', initialValue: rule.approach,
      options: Object.entries(kit.APPROACHES).map(([value, label]) => ({ value, label })) });
    if (v === BACK || clack().isCancel(v)) { p.cancel('취소했습니다'); process.exit(0); }
    approach = v;
  }
  approach = approach || rule.approach;
  // 유형 팩 교체 (옛 유형 팩을 빼고 새 유형 팩 · 기본 팩을 켠다)
  const oldPack = (kit.TYPE_RULES[cur] || {}).pack;
  const packs = (w.packs || []).filter((x) => x !== oldPack || x === rule.pack);
  for (const pk of [rule.pack, ...(rule.defaults || [])]) if (pk && !packs.includes(pk) && fs.existsSync(path.join(root, 'packs', pk, 'pack.json'))) packs.splice(Math.max(0, packs.indexOf('project')), 0, pk);
  w.packs = packs;
  w.project = { ...(w.project || {}), type: want, approach };
  w.repos = repos;
  fs.writeFileSync(wsFile, `${JSON.stringify(w, null, 2)}\n`);
  // 로드맵: 새 뼈대, 지난 로드맵은 아래 「지난 로드맵」 절에 남긴다 (단계 이름을 ### 로 내려 새 로드맵으로 읽히지 않게)
  const planFile = path.join(root, 'handoffs', 'PLAN.md');
  const old = fs.existsSync(planFile) ? read(planFile) : null;
  if (old) fs.unlinkSync(planFile);
  if (!runWorkspaceKit(root, ['sync', '--quiet'])) process.exit(1);
  kit.ensurePlan(root);
  // 분석·설계 → 신규 구축: 무엇을 만들지는 분석·설계 산출물이 이미 정했다. 아이디어 단계는 건너뛴 것으로 두고 다음 단계부터
  if (cur === 'consulting' && want === 'new' && fs.existsSync(planFile)) {
    const P = require(path.join(root, 'packs', 'core', 'lib', 'plan.js'));
    if (P.IDEA_STAGE) fs.writeFileSync(planFile, read(planFile).replace(`| 1 | ${P.IDEA_STAGE} | ▶ | | |`, `| 1 | ${P.IDEA_STAGE} | ✔ 건너뜀 (분석·설계 산출물) | | |`).replace(/\| 2 \| ([^|]+) \| ○ \|/, '| 2 | $1 | ▶ |'));
  }
  if (old && fs.existsSync(planFile)) {
    const body = old.split('\n').filter((l) => !/^#\s/.test(l) && !l.includes('<!-- kedovi:preset')).map((l) => l.replace(/^##\s/, '### '));
    fs.writeFileSync(planFile, `${read(planFile).trimEnd()}\n\n## 지난 로드맵 (${kit.PROJECT_TYPES[cur] || cur}, ~${new Date().toISOString().slice(0, 10)}. 읽지 않는다)\n\n${body.join('\n').trim()}\n`);
  }
  const lines = [`✔ 유형: ${kit.PROJECT_TYPES[cur] || cur} → ${kit.PROJECT_TYPES[want]} · 진행 방식 ${kit.APPROACHES[approach].split(' (')[0]}`,
    `  팩: ${packs.filter((x) => x !== 'core' && x !== 'project').join(', ') || '(core 만)'}`,
    ...(toCode.length ? [`  개발 repo 로: ${toCode.join(', ')}`] : []),
    `  로드맵: handoffs/PLAN.md 새 뼈대${old ? ' (지난 로드맵은 아래 「지난 로드맵」 절에 남김)' : ''}`];
  const has = (k) => repos.some((r) => r.kind === k);
  if (toCode.length) lines.push('  개발 repo 로 바꾼 repo 의 스택 확인: kedovi detect');
  if (rule.requires.includes('code') && !has('code')) lines.push('  ⚠ 개발 repo 가 없습니다. kedovi repo add 로 더하거나 kedovi type 을 다시 해 현행 repo 를 고르세요');
  if (rule.requires.includes('legacy') && !has('legacy')) lines.push('  ⚠ 이 유형은 레거시(AS-IS) repo 가 필요합니다. kedovi repo add --kind legacy');
  lines.push('  workspace.json · handoffs/PLAN.md 를 commit · push 하면 팀에 적용됩니다');
  if (tty) p.outro(lines.join('\n')); else console.log(lines.join('\n'));
}

/** 답변 첫 줄 시각 표시 (chat.timestamp): 이 PC(.agents/local.json) → 팀(workspace.json, --team) → 기본 켜짐. 훅 prompt-time.js 가 읽는다 */
function cmdTimestamp(argv) {
  const root = locateWorkspace();
  const team = argv.includes('--team');
  const [want] = argv.filter((a) => a !== '--team');
  const wsFile = path.join(root, 'workspace.json');
  const val = (o) => (typeof ((o || {}).chat || {}).timestamp === 'boolean' ? o.chat.timestamp : undefined);
  const word = (v) => (v === undefined ? '-' : v ? '켜짐' : '꺼짐');
  const show = () => {
    const t = val(JSON.parse(read(wsFile)));
    const m = val(readLocal(root));
    const now = m !== undefined ? m : t !== undefined ? t : true;
    console.log(`답변 첫 줄 시각 표시 (Claude Code): ${now ? '켜짐' : '꺼짐'}  (이 PC ${word(m)} · 팀 ${word(t)} · 기본 켜짐)`);
    console.log('  바꾸기: kedovi timestamp on|off · 팀 기본값: --team (팀장) · 이 PC 값 지우기: kedovi timestamp team');
  };
  if (!want) return show();
  if (!['on', 'off', 'team'].includes(want) || (want === 'team' && team)) fail('사용법: kedovi timestamp [on|off] [--team] · team (이 PC 값을 지워 팀 값을 따름)');
  if (!fs.existsSync(path.join(root, 'packs', 'core', 'hooks', 'prompt-time.js'))) fail('이 워크스페이스의 킷이 시각 표시를 모릅니다. kedovi upgrade 를 먼저 하세요');
  if (team) {
    requireAdmin(root, '시각 표시 팀 기본값 변경');
    const w = JSON.parse(read(wsFile));
    w.chat = { ...(w.chat || {}), timestamp: want === 'on' };
    fs.writeFileSync(wsFile, `${JSON.stringify(w, null, 2)}\n`);
  } else {
    const chat = { ...(readLocal(root).chat || {}) };
    if (want === 'team') delete chat.timestamp; else chat.timestamp = want === 'on';
    writeLocal(root, { chat });
  }
  console.log(`✔ ${team ? '팀 기본값(workspace.json. commit·push 하면 팀 적용)' : '이 PC(.agents/local.json)'} 에 저장했습니다. 다음 요청부터 적용`);
  show();
}

// ───────── 응답 언어 · 대화 스타일 (kedovi prefs) ─────────
const chatPrefs = require(path.join(KIT_ROOT, 'packs', 'core', 'lib', 'chatprefs.js'));
const MERMAID_PLUGIN = { id: 'claude-mermaid@claude-mermaid', marketplace: 'veelenga/claude-mermaid', repo: 'https://github.com/veelenga/claude-mermaid' };

/** claude-mermaid 플러그인이 이 PC 의 Claude Code 에 설치됐나 (null = 확인 못 함) */
function mermaidInstalled() {
  if (!hasCommand('claude')) return null;
  try {
    const r = spawnSync(findCli('claude'), ['plugin', 'list'], { encoding: 'utf8', timeout: 15000 });
    if (r.status !== 0) return null;
    return /claude-mermaid/.test(`${r.stdout}${r.stderr}`);
  } catch { return null; }
}

/** claude-mermaid 설치 (Claude Code CLI 의 plugin 명령). 반환: 성공 여부 */
function installMermaid() {
  const cli = findCli('claude');
  if (!cli) { console.error('Claude Code(claude) 가 없어 설치하지 못했습니다'); return false; }
  for (const args of [['plugin', 'marketplace', 'add', MERMAID_PLUGIN.marketplace], ['plugin', 'install', MERMAID_PLUGIN.id]]) {
    const r = spawnSync(cli, args, { stdio: 'inherit', timeout: 120000 });
    if (r.status !== 0 && args[1] !== 'marketplace') return false; // 마켓플레이스가 이미 있으면 실패해도 이어 간다
  }
  return true;
}

function showPrefs(root) {
  const r = chatPrefs.resolve(root);
  const where = { local: '이 PC', team: '팀', default: '기본' };
  const L = (k) => (k ? chatPrefs.LANGUAGES[k].label : '-');
  const S = (k) => (k ? chatPrefs.STYLES[k].label : '-');
  console.log(`응답 언어: ${L(r.language)} (${where[r.from.language]})  · 이 PC ${L(r.local.language)} · 팀 ${L(r.team.language)}`);
  console.log(`대화 스타일: ${S(r.style)} (${where[r.from.style]})  · 이 PC ${S(r.local.style)} · 팀 ${S(r.team.style)}`);
  const m = mermaidInstalled();
  console.log(`그림 미리보기(claude-mermaid): ${m === null ? '확인 못 함 (Claude Code 없음)' : m ? '설치됨: 세션에 mermaid_preview 가 있으면 브라우저로 띄움' : '없음: 텍스트 그림으로 (설치: kedovi prefs mermaid install)'}`);
  console.log('  바꾸기: kedovi prefs language ko|en · kedovi prefs style learn|normal|expert · 이 PC 값 지우기: team · 팀 기본값: --team (팀장)');
}

/** 저장 → sync. key = language | style, value = 값 | 'team'(이 PC 값 지우기) */
function savePref(root, key, value, team) {
  if (team) {
    requireAdmin(root, '응답 언어 · 대화 스타일 팀 기본값 변경');
    const wsFile = path.join(root, 'workspace.json');
    const w = JSON.parse(read(wsFile));
    w.chat = { ...(w.chat || {}), [key]: value };
    fs.writeFileSync(wsFile, `${JSON.stringify(w, null, 2)}\n`);
  } else {
    const chat = { ...(readLocal(root).chat || {}) };
    if (value === 'team') delete chat[key]; else chat[key] = value;
    writeLocal(root, { chat });
  }
}

/** 설치 화면 질문: 응답 언어 → 대화 스타일 → (Claude 이고 플러그인이 없으면) 그림 미리보기. onlyMissing 이면 이 PC 값이 없는 것만 묻는다 */
async function choosePrefs(root, { onlyMissing = false } = {}) {
  const r = chatPrefs.resolve(root);
  if (!onlyMissing || !r.local.language) {
    const v = ask(await choose({ message: '응답 언어', hint: 'AI 가 답하는 언어입니다. 진행 알림 · 중간 설명 · 결과 보고까지 이 언어로 씁니다. 나중에 kedovi prefs language 로 바꿉니다.', initialValue: r.language,
      options: Object.entries(chatPrefs.LANGUAGES).map(([value, x]) => ({ value, label: x.label })) }));
    savePref(root, 'language', v, false);
  }
  if (!onlyMissing || !r.local.style) {
    const v = ask(await choose({ message: '대화 스타일', hint: '설명을 얼마나 자세히 할지 정합니다. 나중에 kedovi prefs style 로 바꿉니다.', initialValue: r.style,
      options: Object.entries(chatPrefs.STYLES).map(([value, x]) => ({ value, label: x.label, hint: x.hint })) }));
    savePref(root, 'style', v, false);
  }
  const conf = readLocal(root);
  if (conf.agent === 'claude' && !conf.mermaidAsked && mermaidInstalled() === false) {
    const yes = ask(await yesNo({ message: '그림을 브라우저로 띄우는 claude-mermaid 플러그인을 설치할까요?', hint: `커뮤니티 플러그인(${MERMAID_PLUGIN.repo})입니다. 없으면 터미널에 텍스트 그림으로 그립니다. 나중에 kedovi prefs mermaid install.`, initialValue: false }));
    writeLocal(root, { mermaidAsked: true });
    if (yes && installMermaid()) p.log.success('claude-mermaid 를 설치했습니다. 새 세션부터 적용됩니다');
  }
  runWorkspaceKit(root, ['sync', '--quiet']);
}

/** kedovi prefs [language|style <값|team> [--team] | mermaid [install] | setup] */
async function cmdPrefs(argv) {
  const root = locateWorkspace();
  const team = argv.includes('--team');
  const [what, want] = argv.filter((a) => a !== '--team');
  if (!fs.existsSync(path.join(root, 'packs', 'core', 'lib', 'chatprefs.js'))) fail('이 워크스페이스의 킷이 응답 언어 · 대화 스타일을 모릅니다. kedovi upgrade 를 먼저 하세요');
  const usage = '사용법: kedovi prefs [language ko|en|team · style learn|normal|expert|team] [--team] · mermaid [install] · setup';
  if (!what) return showPrefs(root);
  if (what === 'setup') {
    if (!process.stdin.isTTY) fail('setup 은 터미널에서만 됩니다. 채팅에서는 kedovi prefs language · style');
    clack();
    await choosePrefs(root);
    p.outro('저장했습니다. 언어 줄은 다음 요청부터, 출력 스타일은 새 세션부터 적용됩니다');
    return showPrefs(root);
  }
  if (what === 'mermaid') {
    if (want === 'install') { if (!installMermaid()) fail('claude-mermaid 설치에 실패했습니다. Claude Code 안에서 /plugin marketplace add veelenga/claude-mermaid → /plugin install claude-mermaid@claude-mermaid'); console.log('✔ claude-mermaid 를 설치했습니다. 새 세션부터 적용됩니다'); return; }
    if (want) fail(usage);
    const m = mermaidInstalled();
    console.log(m ? '✔ claude-mermaid 설치됨' : m === false ? '없음: kedovi prefs mermaid install' : '확인 못 함 (Claude Code 없음)');
    console.log(`  ${MERMAID_PLUGIN.repo} (커뮤니티 플러그인). 세션에 mermaid_preview 도구가 있으면 그림을 브라우저로 띄우고, 없으면 텍스트 그림으로 그립니다`);
    return;
  }
  const valid = what === 'language' ? chatPrefs.LANGUAGES : what === 'style' ? chatPrefs.STYLES : null;
  if (!valid || !want || !(valid[want] || (want === 'team' && !team))) fail(usage);
  savePref(root, what, want, team);
  runWorkspaceKit(root, ['sync', '--quiet']);
  console.log(`✔ ${team ? '팀 기본값(workspace.json. commit·push 하면 팀 적용)' : '이 PC(.agents/local.json)'} 에 저장했습니다. 언어 줄은 다음 요청부터, 출력 스타일은 새 세션부터`);
  showPrefs(root);
}

function cmdTeamMode(argv) {
  const root = locateWorkspace();
  const team = argv.includes('--team');
  const args = argv.filter((a) => a !== '--team');
  const wsFile = path.join(root, 'workspace.json');
  const VENDOR = { claude: 'Claude', codex: 'GPT' };
  const show = () => {
    const w = JSON.parse(read(wsFile));
    const t = w.agents || {};
    const l = readLocal(root).agents || {};
    const o = kit.teamOptions(w, l);
    const plans = (kit.loadCatalogFor(root, w).cat.plans) || {};
    const plan = (x) => Object.entries(x || {}).map(([k, v]) => { const pl = (plans[k] || []).find((y) => y.id === v); return `${VENDOR[k] || k} ${pl ? `${pl.label}(${ROOM_TEXT[pl.room]})` : v}`; }).join(' · ') || '-';
    const line = (x) => `모드 ${x.mode === 'auto' ? '자동' : x.mode === 'fixed' ? '고정' : '-'} · 요금제 ${plan(x.plans)} · 선호 ${Object.entries(x.prefer || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '-'}`;
    console.log(`팀 구성\n  지금 적용  ${line(o)}\n  팀 기본값  ${line({ mode: t.mode || (t.mode === undefined ? 'fixed' : ''), plans: t.plans, prefer: t.prefer })}\n  이 PC      ${line({ mode: l.mode, plans: l.plans, prefer: l.prefer })}`);
    const en = kit.resolveModels(root, w);
    const EN = { off: '끔', warn: '알림', block: '막기' };
    const enLine = (k) => `${EN[en.enforce[k]]}${en.enforce[k] !== en.teamEnforce[k] ? ` (팀 ${EN[en.teamEnforce[k]]} 보다 세게 한 이 PC 값)` : ''}`;
    console.log(`  이름 없는 역할 에이전트 (팀 모드)  ${enLine('teammateName')} · 바꾸기: kedovi team-mode enforce name off|warn|block [--team]`);
    console.log(`  첫 역할 에이전트 때 구성표 알림  ${enLine('rosterAnnounce')} · 바꾸기: kedovi team-mode enforce roster off|warn [--team]`);
    console.log(`  commit · push 전 리뷰 확인  ${enLine('reviewBeforePush')} · 대상 ${en.review.repos.join(', ')} · 기준 ${en.review.minLines}줄${en.review.paths.length ? ` · 경로 ${en.review.paths.join(', ')}` : ''} · 바꾸기: kedovi team-mode enforce review off|warn|block [--repos a,b|*] [--min-lines N] [--paths p1,p2] [--team] · 상태: kedovi review status`);
    console.log(`  대기로 오래 남은 팀원 (팀 모드)  ${enLine('idleTeammates')} · 대기 ${en.idle.after}분 넘으면 · 같은 팀원은 ${en.idle.remind}분 뒤 다시 · 바꾸기: kedovi team-mode enforce idle off|warn|block [--after 분] [--remind 분] [--team]`);
    console.log(`  기다리며 멈출 때 상태 줄  ${enLine('waitStatus')} · 팀원 · 백그라운드 작업이 남았는데 답변에 「지금 도는 것:」 줄이 없으면 · 바꾸기: kedovi team-mode enforce status off|block [--team]`);
    console.log(`  결정 질문을 글로 끝낼 때  ${enLine('decisionAsk')} · 질문 창 없이 번호 선택지로 물으면 한 번 막고 질문 창으로 · 바꾸기: kedovi team-mode enforce ask off|block [--team]`);
    console.log(`  오래 일하는 팀원 · 위임  ${enLine('longRunning')} · ${en.longRun.after}분 넘으면 계속할지 묻게 · 바꾸기: kedovi team-mode enforce run off|warn|block [--after 분] [--team]`);
    console.log(`  착수 전 확인  ${enLine('planFirst')} · 요청마다 코드 repo 첫 수정 전에 답변에 「착수 전 확인:」 이 없으면 · 바꾸기: kedovi team-mode enforce plan off|warn|block [--team]`);
    console.log(`  리뷰 전 검사  ${enLine('checkBeforeReview')} · 리뷰를 맡기는 지시서에 「검사: <명령> 통과」 줄이 없으면 · 바꾸기: kedovi team-mode enforce check off|warn|block [--team]`);
    console.log('  요금제 바꾸기: kedovi ai (화면) · kedovi ai plan claude|gpt <요금제>');
    console.log('  자세히: CLAUDE.local.md · AGENTS.override.md 의 「팀 구성」 (역할 목록 · 쓸 수 있는 모델)');
  };
  if (!args.length) return show();
  if (team) requireAdmin(root, '팀 구성 기본값 변경');
  const edit = (fn) => {
    if (team) { const w = JSON.parse(read(wsFile)); w.agents = fn({ ...(w.agents || {}) }); fs.writeFileSync(wsFile, `${JSON.stringify(w, null, 2)}\n`); }
    else { const l = readLocal(root); writeLocal(root, { agents: fn({ ...(l.agents || {}) }) }); }
  };
  const optAt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const [cmd, a1, a2] = args;
  if (cmd === 'auto' || cmd === 'fixed') edit((x) => ({ ...x, mode: cmd }));
  else if (cmd === 'prefer') {
    if (!a1 || !a2 || (a2 !== '-' && !/^(claude|codex):\S+$/.test(a2))) fail('사용법: kedovi team-mode prefer <역할> <claude|codex>:<모델> [--team]  (지우기: prefer <역할> -)');
    edit((x) => { const pr = { ...(x.prefer || {}) }; if (a2 === '-') delete pr[a1]; else pr[a1] = a2; const y = { ...x, prefer: pr }; if (!Object.keys(pr).length) delete y.prefer; return y; });
  } else if (cmd === 'enforce') {
    const key = { name: 'teammateName', roster: 'rosterAnnounce', review: 'reviewBeforePush', idle: 'idleTeammates', status: 'waitStatus', ask: 'decisionAsk', run: 'longRunning', check: 'checkBeforeReview', plan: 'planFirst' }[a1];
    if ((a1 === 'status' || a1 === 'ask') && a2 === 'warn') fail(`사용법: kedovi team-mode enforce ${a1} off|block [--team]  (멈출 때 한 번 막거나 끈다)`);
    const lv = (v) => kit.ENFORCE_LEVELS.indexOf(v);
    if (!key || lv(a2) < 0 || lv(a2) > lv(kit.ENFORCE_DEFAULTS[key].max)) fail('사용법: kedovi team-mode enforce name off|warn|block · roster off|warn · review off|warn|block [--repos a,b|*] [--min-lines N] [--paths p1,p2] · idle off|warn|block [--after 분] [--remind 분] · status off|block · ask off|block · run off|warn|block [--after 분] · check off|warn|block · plan off|warn|block [--team]  (name: 팀 모드에서 이름 없는 역할 에이전트 · roster: 첫 역할 에이전트 때 구성표 알림 · review: commit · push 전 리뷰 확인 · idle: 대기로 오래 남은 팀원 알림 · status: 남은 것이 있는 채 멈출 때 상태 줄 · ask: 결정 질문을 글로 끝낼 때 · run: 오래 일하는 팀원 · 위임 · check: 리뷰 전 검사 · plan: 코드 수정 전 착수 전 확인)');
    const teamNow = kit.resolveModels(root, JSON.parse(read(wsFile))).teamEnforce[key];
    if (!team && lv(a2) < lv(teamNow)) fail(`이 PC 값은 팀 값(${teamNow})보다 세게만 둘 수 있습니다. 팀 값을 바꾸려면 팀장이 kedovi team-mode enforce ${a1} ${a2} --team`);
    // 리뷰 확인의 대상 · 기준은 팀 값만
    const extra = {};
    if (a1 === 'review') {
      const list = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);
      if (optAt('--repos') !== undefined) extra.reviewRepos = list(optAt('--repos'));
      if (optAt('--min-lines') !== undefined) { const n = Number(optAt('--min-lines')); if (!Number.isInteger(n) || n < 0) fail('--min-lines 는 0 이상의 정수'); extra.reviewMinLines = n; }
      if (optAt('--paths') !== undefined) extra.reviewPaths = optAt('--paths') === '-' ? [] : list(optAt('--paths'));
      if (Object.keys(extra).length && !team) fail('리뷰 확인의 대상(--repos) · 기준 줄 수(--min-lines) · 경로(--paths)는 팀 값입니다. --team 을 붙이세요 (팀장)');
      const known = (JSON.parse(read(wsFile)).repos || []).map((r) => r.name);
      const bad = (extra.reviewRepos || []).filter((n) => n !== '*' && !known.includes(n));
      if (bad.length) fail(`workspace.json repos 에 없는 이름: ${bad.join(', ')} (있는 것: ${known.join(', ') || '없음'})`);
    }
    if (a1 === 'idle') {
      for (const [opt, field] of [['--after', 'idleMinutes'], ['--remind', 'idleRemindMinutes']]) {
        if (optAt(opt) === undefined) continue;
        const n = Number(optAt(opt));
        if (!Number.isInteger(n) || n < 1) fail(`${opt} 는 1 이상의 정수(분)`);
        extra[field] = n;
      }
      if (Object.keys(extra).length && !team) fail('대기 상한(--after) · 다시 알리는 간격(--remind)은 팀 값입니다. --team 을 붙이세요 (팀장)');
    }
    if (a1 === 'run' && optAt('--after') !== undefined) {
      const n = Number(optAt('--after'));
      if (!Number.isInteger(n) || n < 1) fail('--after 는 1 이상의 정수(분)');
      if (!team) fail('실행 상한(--after)은 팀 값입니다. --team 을 붙이세요 (팀장)');
      extra.runMinutes = n;
    }
    edit((x) => ({ ...x, enforce: { ...(x.enforce || {}), [key]: a2, ...extra } }));
  } else fail('사용법: kedovi team-mode [auto|fixed] · prefer <역할> <claude|codex>:<모델>|- · enforce name off|warn|block · enforce roster off|warn · enforce review off|warn|block · enforce idle off|warn|block · enforce status off|block · enforce ask off|block · enforce run off|warn|block · enforce check off|warn|block · enforce plan off|warn|block · [--team]');
  runWorkspaceKit(root, ['sync', '--quiet']);
  console.log(`✔ ${team ? '팀 기본값(workspace.json. commit·push 하면 팀 적용)' : '이 PC(.agents/local.json)'} 에 저장했습니다`);
  show();
}

/**
 * 지금 쓰는 모델 표 — 팀 구성 옵션 · 프로필 · 상한 · 역할 × 도구(등급 · 출처). 화면(p.note)과 화면 없는 실행이 같은 표를 쓴다.
 * 출처: 프로필 = 킷 기본(성향) · 팀 = workspace.json agents · 이 PC = .agents/local.json agents
 */
function modelRows(root, cat, roles) {
  const ws = kit.loadWorkspace(root);
  const { effective, profile, limits, teamLimits } = kit.resolveModels(root, ws);
  const localAgents = readLocal(root).agents || {};
  const teamAgents = ws.agents || {};
  const opts = kit.teamOptions(ws, localAgents);
  const src = (localNode, teamNode, t) => (localNode && localNode[t] !== undefined ? ' (이 PC)' : teamNode && teamNode[t] !== undefined ? ' (팀)' : '');
  const pfLabel = (n) => ((cat.profiles || {})[n] || {}).label || n;
  const VENDOR = { claude: 'Claude', codex: 'GPT' };
  const cell = (t, node, local, team, blank) => modelLabel(cat, t, node && node[t], blank) + effortTag(t, node) + src(local, team, t);
  return [
    `팀 구성: ${opts.mode === 'auto' ? '자동 (리더가 작업마다 역할·모델 선택, 아래는 기본값)' : '고정 (아래 모델대로)'} · 요금제 ${(() => { const r = kit.vendorRooms(kit.loadCatalogFor(root, ws).cat, kit.normalizeAccess({ ...((ws.agents || {}).access || {}), ...(localAgents.access || {}) }), opts.plans); return ['claude', 'codex'].filter((v) => r[v].room).map((v) => `${VENDOR[v]} ${r[v].label}(${ROOM_TEXT[r[v].room]})`).join(' · ') || '모름'; })()}${Object.keys(opts.prefer).length ? ` · 선호 ${Object.entries(opts.prefer).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}  (kedovi team-mode)`,
    ...(profile && profile.team ? [`성향(프로필): 팀 ${pfLabel(profile.team)}${profile.local ? ` · 이 PC ${pfLabel(profile.local)} (팀 대신)` : ''}${profile.blocked ? ` · 이 PC 값 ${pfLabel(profile.blocked)} 은 팀보다 높아 적용하지 않음 (kedovi models profile team 으로 지우기)` : ''}${profile.allowHigher ? ' · 팀원의 높은 프로필 허용' : ''}`,
      `상한: 동시 ${limits.parallel} · 모두 ${limits.total}${limits.parallel !== teamLimits.parallel || limits.total !== teamLimits.total ? ` (팀 ${teamLimits.parallel} · ${teamLimits.total})` : ''}`] : []),
    '',
    `${padTo('역할', 12)}${padTo('등급', 10)}${padTo('Claude Code', 33)}Codex`,
    `${padTo('메인', 12)}${padTo('', 10)}${padTo(cell('claude', effective.main, localAgents.main, teamAgents.main, '도구 기본'), 33)}${cell('codex', effective.main, localAgents.main, teamAgents.main, '도구 기본')}`,
    ...roles.map((r) => {
      const e = (effective.roles || {})[r.name] || {};
      const l = (localAgents.roles || {})[r.name];
      const t = (teamAgents.roles || {})[r.name];
      return `${padTo(r.title || r.name, 12)}${padTo(r.grade || '-', 10)}${padTo(cell('claude', e, l, t), 33)}${cell('codex', e, l, t)}`;
    }),
    `${padTo('교차 검토', 12)}${padTo('', 10)}${padTo(cell('claude', effective.crossReview, localAgents.crossReview, teamAgents.crossReview, '도구 기본'), 33)}${cell('codex', effective.crossReview, localAgents.crossReview, teamAgents.crossReview)}`,
    '', '출처 표시 없음 = 성향(프로필, 킷 기본) · (팀) = workspace.json · (이 PC) = .agents/local.json. 역할 등급은 역할 정의의 grade',
  ];
}

async function cmdModels(argv = []) {
  const root = locateWorkspace();
  if (argv.includes('--migrate')) { migrateModels(root); return; }
  if (await modelsCommand(root, argv)) return;
  if (argv.includes('--json')) {
    const { team, effective } = kit.resolveModels(root, kit.loadWorkspace(root));
    console.log(JSON.stringify({ team, effective, options: kit.teamOptions(kit.loadWorkspace(root), readLocal(root).agents || {}) }, null, 2));
    return;
  }
  if (!process.stdin.isTTY) { console.log(modelRows(root, modelCatalog(root), listRoles(root)).join('\n')); return; }
  clack();
  p.intro(' kedovi models ');
  const cat = modelCatalog(root);
  const roles = listRoles(root);
  const wsFile = path.join(root, 'workspace.json');
  for (;;) {
    const rows = modelRows(root, cat, roles);
    p.note(rows.join('\n'), '지금 쓰는 모델');
    const what = await choose({
      message: '무엇을 바꿀까요?', hint: '역할 에이전트는 팀 작업(team 스킬)에서 리드가 일을 나눠 맡길 때 쓰입니다.',
      options: [...(cat.profiles ? [{ value: 'profile', label: '프로필 바꾸기', hint: '예산에 맞춰 메인·역할 모델을 한 번에' }] : []),
        { value: 'roles', label: '역할별로 한 번에 고르기', hint: '메인·역할·교차 검토 모델을 차례로' },
        ...roles.map((r) => ({ value: `role:${r.name}`, label: `${r.title || r.name} 에이전트`, hint: r.description.slice(0, 50) })),
        { value: 'main', label: '메인 모델 (팀 기본값)', hint: '개인 메인 모델은 kedovi agent' },
        { value: 'cross', label: '교차 검토 모델', hint: '다른 도구에게 검토를 맡길 때' },
        { value: 'done', label: '끝내기' }],
    });
    if (what === BACK || what === 'done') break;
    if (what === 'profile' || what === 'roles') {
      const scope = await chooseInline({
        message: '적용 범위', hint: '팀 기본값은 workspace.json 에 저장돼 commit·push 하면 팀 전체에 적용됩니다.',
        options: [{ value: 'local', label: '내 PC 만' }, { value: 'team', label: '팀 기본값' }], initialValue: 'local',
      });
      if (scope === BACK) continue;
      if (scope === 'team' && !requireAdmin(root, '팀 기본 모델 변경', { soft: true })) continue;
      const local = readLocal(root);
      const cur = scope === 'team' ? profile.team : (local.agents || {}).profile || '';
      let tool = local.agent || 'claude';
      let v = what === 'roles' ? '__roles' : await chooseProfile(root, tool, scope, cur);
      if (v === BACK) continue;
      if (v === '__roles') {
        if (what === 'roles') {
          tool = await chooseInline({ message: '어느 도구의 역할', hint: '교차 검토는 상대 도구의 모델을 고릅니다.', options: [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }], initialValue: tool });
          if (tool === BACK) continue;
        } else {
          const base = await chooseProfile(root, tool, scope, cur, { roles: false, message: '기준 프로필', hint: '역할마다 "프로필대로" 를 고르면 이 프로필 값을 씁니다.' });
          if (base === BACK) continue;
          saveProfile(root, scope, base);
        }
        v = await chooseRoleModels(root, tool, scope);
        if (v === BACK) continue;
        runWorkspaceKit(root, ['sync', '--quiet']);
        p.log.success(`${scope === 'team' ? '팀 기본값(workspace.json. commit·push 하면 팀 적용)' : '이 PC 설정(.agents/local.json)'} 에 저장했습니다 (${v}개 바뀜)`);
        continue;
      }
      saveProfile(root, scope, v);
      runWorkspaceKit(root, ['sync', '--quiet']);
      p.log.success(scope === 'team' ? '팀 기본 프로필을 바꿨습니다 (workspace.json. commit·push 하면 팀 적용). 역할별로 직접 고른 모델은 그대로 우선합니다' : '이 PC 프로필을 바꿨습니다 (.agents/local.json). 역할별로 직접 고른 모델은 그대로 우선합니다');
      continue;
    }
    const tool = await chooseInline({ message: '어느 도구의 모델', options: [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }], initialValue: 'claude' });
    if (tool === BACK) continue;
    const scope = what === 'main' || what === 'cross' ? 'team' : await chooseInline({
      message: '적용 범위', hint: '팀 기본값은 workspace.json 에 저장돼 commit·push 하면 팀 전체에 적용됩니다.',
      options: [{ value: 'local', label: '내 PC 만' }, { value: 'team', label: '팀 기본값' }], initialValue: 'local',
    });
    if (scope === BACK) continue;
    if (scope === 'team' && !requireAdmin(root, '팀 기본 모델 변경', { soft: true })) continue;
    const key = what === 'main' ? ['main'] : what === 'cross' ? ['crossReview'] : ['roles', what.slice(5)];
    const cur = key.reduce((o, k) => (o || {})[k], scope === 'team' ? team : effective);
    const model = await chooseModel(cat, tool, { message: `${AGENTS[tool].label} 모델`, current: (cur || {})[tool] || '', delegate: key[0] === 'roles',
      blankLabel: key[0] === 'roles' ? '메인과 같게' : '도구 기본', blankHint: key[0] === 'roles' ? 'inherit' : '따로 정하지 않는다' });
    if (model === BACK) continue;
    // 저장 — 팀이면 workspace.json, 개인이면 .agents/local.json
    if (scope === 'team') {
      const raw = JSON.parse(read(wsFile));
      raw.agents = raw.agents || {};
      let node = raw.agents;
      for (const k of key) node = node[k] = node[k] || {};
      node[tool] = model;
      fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
    } else {
      const local = readLocal(root);
      local.agents = local.agents || {};
      let node = local.agents;
      for (const k of key) node = node[k] = node[k] || {};
      node[tool] = model;
      writeLocal(root, { agents: local.agents });
    }
    runWorkspaceKit(root, ['sync']);
    p.log.success(`${scope === 'team' ? '팀 기본값(workspace.json. commit·push 하면 팀 적용)' : '이 PC 설정(.agents/local.json)'} 에 저장했습니다`);
  }
  p.outro('완료');
}

// 역할 순서 — 일이 흐르는 순서. 목록에 없는 역할(project 팩이 더한 것)은 뒤에 이름순
const ROLE_ORDER = ['analyst', 'architect', 'spec-writer', 'implementer', 'reviewer', 'tester', 'documenter'];

/** 역할 목록 — 쓰는 팩들의 agents 폴더 기준 */
function listRoles(root) {
  const out = new Map();
  const ws = JSON.parse(read(path.join(root, 'workspace.json')));
  for (const pk of [...(ws.packs || [])]) {
    const dir = path.join(root, 'packs', pk, 'agents');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const m = read(path.join(dir, f)).match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      const meta = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([a-z]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].replace(/^["']|["']$/g, '')]));
      if (meta.name) out.set(meta.name, meta);
    }
  }
  const rank = (n) => (ROLE_ORDER.includes(n) ? ROLE_ORDER.indexOf(n) : ROLE_ORDER.length);
  return [...out.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

// ───────────────────────── init-docs ─────────────────────────

function initDocsRepo(dst) {
  if (fs.existsSync(path.join(dst, 'README.md'))) fail(`${dst} 에 이미 README.md 가 있습니다. 빈 폴더에 만드세요`);
  const src = path.join(KIT_ROOT, 'templates', 'docs-repo');
  const walk = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name === '.DS_Store') continue;
      if (e.isDirectory()) walk(path.join(from, e.name), path.join(to, e.name));
      else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name === 'gitignore' ? '.gitignore' : e.name)); // 템플릿의 gitignore → .gitignore (npm 패키지에서 .gitignore 가 빠지므로 점 없이 둔다)
    }
  };
  walk(src, dst);
  // Pages CI 는 core 팩의 견본 하나가 정본이다. 새 repo 는 원격을 모르므로 GitLab · GitHub 둘 다 두고, kedovi docs pages on 이 원격에 맞는 것만 남긴다.
  // docs-site/ 를 커밋하기 전에는 어느 쪽도 돌지 않는다
  const ci = path.join(KIT_ROOT, 'packs', 'core', 'assets', 'pages');
  if (fs.existsSync(path.join(ci, 'gitlab-ci.yml'))) fs.copyFileSync(path.join(ci, 'gitlab-ci.yml'), path.join(dst, '.gitlab-ci.yml'));
  if (fs.existsSync(path.join(ci, 'github-pages.yml'))) { fs.mkdirSync(path.join(dst, '.github', 'workflows'), { recursive: true }); fs.copyFileSync(path.join(ci, 'github-pages.yml'), path.join(dst, '.github', 'workflows', 'pages.yml')); }
  // 화면설계서 장 양식은 screens 팩의 견본 하나가 정본이다 (복사본을 템플릿에 따로 두지 않는다)
  const sheet = path.join(KIT_ROOT, 'packs', 'screens', 'assets', 'storyboard', 'template.html');
  if (fs.existsSync(sheet)) fs.copyFileSync(sheet, path.join(dst, '30-screens', '_template.html'));
  // 테이블 정의서 양식도 datamodel 팩의 견본 하나가 정본이다
  const table = path.join(KIT_ROOT, 'packs', 'datamodel', 'assets', 'erd', 'template.md');
  if (fs.existsSync(table)) fs.copyFileSync(table, path.join(dst, '40-data', '_template.md'));
  // 시스템 구성도 양식은 core 팩 architecture 견본 하나가 정본이다 (서버 아키텍처: 단계별 구성도 · 서비스 · DB · 미들웨어 · 외부 · 서버 사양)
  const arch = path.join(KIT_ROOT, 'packs', 'core', 'assets', 'architecture', 'template.md');
  // 견본 값(서버 이름 · 사양)은 예시라고 밝힌다
  if (fs.existsSync(arch)) fs.writeFileSync(path.join(dst, '10-system', 'architecture.md'), fs.readFileSync(arch, 'utf8').replace(/\r\n/g, '\n')
    .replace(/^# 시스템 구성$/m, '# 시스템 구성도').replace(/^> 상태: 초안$/m, '> 상태: 초안 · 아래 서비스 이름 · 버전 · 서버 사양은 견본이다. 프로젝트 값으로 바꾸거나 지운다'));
  // 규모 · 비기능 문서 양식도 core 팩 견본 하나가 정본이다 (「과하다 · 필요 없다」 판단의 근거)
  const scale = path.join(KIT_ROOT, 'packs', 'core', 'assets', 'scale', 'template.md');
  if (fs.existsSync(scale)) fs.copyFileSync(scale, path.join(dst, '00-overview', 'scale.md'));
  if (!fs.existsSync(path.join(dst, '.git'))) {
    try { execFileSync('git', ['init', '-q', dst]); } catch { /* git 없음 — 폴더만 */ }
  }
  return dst;
}

function cmdInitDocs(argv) {
  const dst = path.resolve(argv[0] || '.');
  initDocsRepo(dst);
  console.log(`✔ 기획 repo 생성: ${dst}\n  워크스페이스 workspace.json repos 에 { "kind": "docs", "mdPath": "md", "remote": "<git 주소>" } 로 등록하세요`);
}

// ───────────────────────── install · start ─────────────────────────

async function cmdInstall() {
  const root = locateWorkspace();
  console.log(`워크스페이스: ${root}`);
  const ok = runWorkspaceKit(root, ['install']);
  if (process.stdin.isTTY) {
    clack();
    ask(await chooseAgent(root, { force: !readLocal(root).agent ? true : false, progress: true }));
    await choosePrefs(root, { onlyMissing: true });
    await ensureAccount(root);
    await joinTeam(root);
    const cur = readLocal(root);
    p.outro(`메인 에이전트: ${AGENTS[cur.agent].label}${cur.args && cur.args.length ? ` (${cur.args.join(' ')})` : ''}: 바꾸려면 kedovi agent`);
  }
  process.exit(ok ? 0 : 1);
}

async function cmdStart(argv) {
  const root = locateWorkspace();
  // 리더가 명단 제한을 켰으면 명단에 없는 사람은 시작하지 않는다 (안전장치 — 권한 통제는 GitLab·GitHub 멤버로)
  const team = teamOf(root);
  // 팀이 있으면 이 PC 사용자(저장소 계정)를 한 번 확인해 둔다 — 팀장 · 담당 repo 판정과 nickname 부르기에 쓴다
  if ((team.leads || []).length || (team.members || []).length || (team.admins || []).length) {
    const before = (readLocal(root).me || {}).username;
    const acct = await ensureAccount(root);
    if (acct && acct.username) adoptAccount(root, acct.username); // 핸드오프 폴더의 .account 가 없으면 만든다
    // 계정이 새로 잡혔거나 팀 설정(담당 repo 등)이 git pull 로 바뀌었으면 이 PC 의 편집 금지 · 지침을 다시 맞춘다
    const hash = require('crypto').createHash('sha1').update(JSON.stringify(team)).digest('hex').slice(0, 12);
    if ((acct && acct.username !== before) || readLocal(root).teamHash !== hash) { runWorkspaceKit(root, ['sync', '--quiet']); writeLocal(root, { teamHash: hash }); }
  }
  if (team.restrict && (team.members || []).length) {
    const me = memberId(root);
    const acct = (readLocal(root).me || {}).username;
    if (!me && !acct) fail('이 워크스페이스는 팀 명단에 있는 사람만 시작합니다. 먼저 kedovi team whoami --refresh 로 저장소 계정을 확인하세요');
    const listed = [...team.members, ...(team.leads || []), ...(team.admins || [])].some((x) => sameUser(x, me) || (acct && sameUser(x, acct)));
    if (!listed) fail(`${acct || me} 은(는) 이 워크스페이스 팀 명단에 없습니다. 팀장에게 명단 추가(kedovi team add ${acct || me} --nick 이름)를 요청하세요 (명단: ${team.members.map((x) => personOf(x).nickname || personOf(x).username).join(', ')})`);
  }
  const dash = argv.indexOf('--');
  const extra = dash >= 0 ? argv.slice(dash + 1) : [];
  const flags = dash >= 0 ? argv.slice(0, dash) : argv;
  // 지난 대화 이어서 — -c 마지막 대화 · -r [ID] 그 세션 또는 목록. 에이전트마다 옵션이 달라 아래에서 바꿔 넘긴다
  const resumeAt = flags.findIndex((x) => x === '-r' || x === '--resume');
  const resume = flags.some((x) => x === '-c' || x === '--continue') ? { last: true }
    : resumeAt >= 0 ? { id: flags[resumeAt + 1] && !flags[resumeAt + 1].startsWith('-') ? flags[resumeAt + 1] : null } : null;
  let conf = readLocal(root);
  const once = flags.includes('--codex') ? 'codex' : flags.includes('--claude') ? 'claude' : null;
  if (!once && !conf.agent) {
    if (!process.stdin.isTTY) fail('메인 에이전트가 정해지지 않았습니다. kedovi install 또는 kedovi start --claude|--codex');
    conf = ask(await chooseAgent(root, { force: true }));
  }
  // 배포된 새 버전 알림 — npm 레지스트리의 최신 버전이 이 PC 설치본보다 새로우면 (하루 한 번 · 2초 · 실패하면 조용히)
  try {
    const latest = await latestPublished();
    const installed = JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version;
    if (latest && semverGt(latest, installed)) console.warn(`⚠ kedovi ${latest} 이 나왔습니다 (이 PC ${installed}). npm i -g ${PKG_NAME} → 워크스페이스에서 kedovi upgrade → commit · push`);
  } catch { /* 확인 실패: 시작을 막지 않는다 */ }
  // 킷 버전 비교: 설치된 kedovi 가 이 워크스페이스보다 새로우면 올릴지 묻는다 (화면 · 올릴 수 있을 때). 아니면 알리기만
  try {
    const installed = installedVersion();
    const used = wsVersion(root);
    if (used && semverGt(installed, used)) {
      const block = upgradeBlocker(root);
      if (process.stdin.isTTY && !block) {
        clack();
        const v = ask(await choose({ message: '킷 새 버전을 지금 올릴까요', hint: `설치 ${installed} · 이 워크스페이스 ${used}. 올리면 bin · 팩 · 생성물이 바뀌고, 끝난 뒤 commit · push 하면 팀에 반영됩니다.`, initialValue: 'up',
          options: [{ value: 'up', label: '지금 올리고 시작 (권장)' }, { value: 'skip', label: '이번엔 그대로 시작' }] }));
        if (v === 'up') {
          const r = spawnSync(process.execPath, [path.join(KIT_ROOT, 'bin', 'kedovi.js'), 'upgrade'], { cwd: root, stdio: 'inherit' });
          if (r.status === 0) console.log(`✔ ${installed} 로 올렸습니다. 팀에 반영: git add -A && git commit -m "chore: kedovi ${installed}" && git push`);
          else console.warn('⚠ 업그레이드가 실패해 그대로 시작합니다 (위 출력 확인)');
        }
      } else console.warn(`⚠ 킷 새 버전 ${installed} (이 워크스페이스 ${used}). ${block ? `지금 올리지 않음: ${block}` : 'kedovi upgrade 후 commit · push 하면 팀에 반영됩니다'}`);
    } else if (used && semverGt(used, installed)) console.warn(`⚠ 이 워크스페이스는 킷 ${used} 로 올라가 있습니다 (이 PC ${installed}). npm i -g ${PKG_NAME}`);
  } catch { /* 버전 정보 없음: 시작을 막지 않는다 */ }
  const agent = once || conf.agent;
  const a = AGENTS[agent];
  if (!a) fail(`알 수 없는 에이전트: ${agent}`);
  if (!hasCommand(a.command)) fail(`${a.command} 가 설치돼 있지 않습니다. ${a.install}`);

  // 빠진 repo 가 있으면 알리기만 한다 (clone 은 오래 걸릴 수 있어 start 가 하지 않는다)
  try {
    const ws = kit.loadWorkspace(root);
    const absent = ws.repos.filter((r) => !fs.existsSync(path.join(root, r.dir)));
    const waiting = absent.filter((r) => r.local && !r.remote && !r.path).map((r) => r.name); // 다른 팀원이 새로 만들어 아직 원격이 없다
    const missing = absent.filter((r) => !waiting.includes(r.name)).map((r) => r.name);
    if (missing.length) console.warn(`⚠ repos/ 에 없는 repo: ${missing.join(', ')}. kedovi install`);
    if (waiting.length) console.warn(`… 아직 원격이 없는 repo: ${waiting.join(', ')}. 만든 사람이 push 하면 git pull → kedovi install`);
  } catch { /* workspace.json 문제는 에이전트 훅이 알린다 */ }

  // 메인 모델 = 프로필·팀·개인 설정을 합친 값. 전역 설정(ANTHROPIC_MODEL 등)이 워크스페이스 설정보다 앞서므로 항상 넘긴다
  // run = 연결 방식(kedovi ai)을 반영한 값: 게이트웨이면 게이트웨이 모델 이름, GPT 메인(게이트웨이 + Claude Code)도 여기서
  let personalModel;
  let mainEffort = null;
  try {
    const m = kit.resolveModels(root, kit.loadWorkspace(root));
    const runMain = (m.run || m.effective).main || {};
    personalModel = runMain[agent];
    mainEffort = kit.effortOf(runMain, agent);
    const notice = kit.profileNotice(root, kit.loadWorkspace(root));
    if (notice) console.log(`… ${notice}`);
  } catch { personalModel = ((conf.agents || {}).main || {})[agent]; }
  // 게이트웨이 연결 — Claude Code 가 이미 그 게이트웨이로 설정돼 있으면 그대로, 아니면 저장한 주소와 키 환경변수로 잇는다 (키 값은 저장하지 않는다)
  const env = { ...process.env };
  const access = accessOf(root);
  if (access.connection === 'gateway' && access.gateway && access.gateway.url) {
    const gw = access.gateway;
    const ready = gateway.detect().some((x) => x.url === gw.url && (agent === 'claude' ? !x.source.startsWith('Codex') : x.source.startsWith('Codex')));
    if (!ready && agent === 'claude') {
      if (gw.keyEnv && process.env[gw.keyEnv]) { if (await trustGateway(root, gw)) { env.ANTHROPIC_BASE_URL = gw.url; env.ANTHROPIC_AUTH_TOKEN = process.env[gw.keyEnv]; } }
      else console.warn(`⚠ Claude Code 가 게이트웨이(${gw.url})로 설정돼 있지 않습니다. 키가 든 환경변수를 정하세요: kedovi ai gateway --url ${gw.url} --key-env <변수>`);
    }
    if (!ready && agent === 'codex') console.warn(`⚠ Codex 설정(~/.codex/config.toml)에 게이트웨이 model_provider 가 없습니다. 게이트웨이 안내대로 Codex 를 설정하세요`);
  } else if (access.connection === 'direct' && !access.vendors.includes(agent)) {
    console.warn(`⚠ 이 PC 설정은 ${agent === 'claude' ? 'Claude' : 'GPT'} 를 쓰지 않는다고 돼 있습니다 (kedovi ai show). 이번만 이 도구로 시작합니다`);
  }
  const effortArgs = !mainEffort || extra.some((x) => x === '--effort' || /model_reasoning_effort/.test(x)) ? []
    : agent === 'claude' ? ['--effort', mainEffort] : ['-c', `model_reasoning_effort="${mainEffort}"`];
  // 첫 메시지 = 브리핑 (packs/core/bin/brief.js). --no-brief · .agents/local.json brief:false · 비대화형(-p) · 이어하기(-c · -r) 면 넣지 않는다
  const skipBrief = !!resume || flags.includes('--no-brief') || conf.brief === false || extra.some((x) => ['-p', '--print', '-c', '--continue', '-r', '--resume'].includes(x));
  const brief = skipBrief ? '' : briefPrompt(root);
  // Claude: --continue · --resume [ID] / Codex: resume 하위 명령이 맨 앞 (resume 도 -m · -c 를 받는다)
  const resumeArgs = !resume ? [] : agent === 'claude' ? (resume.last ? ['--continue'] : ['--resume', ...(resume.id ? [resume.id] : [])])
    : ['resume', ...(resume.last ? ['--last'] : resume.id ? [resume.id] : [])];
  // Codex 는 웹 검색이 기본으로 꺼져 있다 → --search 를 붙여 Claude 와 맞춘다 (common-practice 스킬 · 근거 확인). 끄기: workspace.json agents.webSearch: false
  let webSearch = true;
  try { webSearch = (JSON.parse(read(path.join(root, 'workspace.json'))).agents || {}).webSearch !== false; } catch { /* 기본 켬 */ }
  const searchArgs = agent === 'codex' && webSearch && ![...(conf.args || []), ...extra].includes('--search') ? ['--search'] : [];
  const args = [...(agent === 'codex' ? resumeArgs : []), ...searchArgs, ...(personalModel && !extra.some((x) => x === a.modelFlag || x === '--model' || x === '-m') ? [a.modelFlag, personalModel] : []), ...effortArgs,
    ...(once && once !== conf.agent ? [] : conf.args || []), ...(agent === 'claude' ? resumeArgs : []), ...extra, ...(brief ? [brief] : [])];
  // 양방향 텔레그램 채널 — 이 PC 에서 켰고(kedovi notify my channel on) Claude Code 로 시작할 때만. 준비가 안 됐으면 알리고 빼고 시작한다
  if (agent === 'claude' && (conf.notify || {}).channel === true && !flags.includes('--no-channel') && !extra.includes('--channels')) {
    let check = { ready: false, problems: ['이 워크스페이스에 채널 도구가 없다 (kedovi upgrade)'] };
    let plugin = 'telegram@claude-plugins-official';
    try {
      const nl = require(path.join(root, 'packs', 'core', 'lib', 'notify.js'));
      if (nl.channelCheck) { check = nl.channelCheck(root, findCli); plugin = nl.CHANNEL_PLUGIN; env.TELEGRAM_STATE_DIR = nl.channelDir(root); } // 프로젝트마다 다른 봇 · 상태 폴더
      // 팀원 세션은 리더 환경을 물려받아 같은 봇 서버를 띄우고 리더 서버를 끈다: PATH 앞의 bun 대리 실행이 --channels 세션만 띄우게 한다
      const shim = check.ready && nl.channelShim ? nl.channelShim(root, findCli('bun')) : null;
      if (shim) env.PATH = [shim, ...String(env.PATH || '').split(path.delimiter).filter((d) => d && d !== shim)].join(path.delimiter);
    } catch { /* 옛 워크스페이스 */ }
    if (check.ready) { args.splice(agent === 'codex' ? resumeArgs.length : 0, 0, '--channels', `plugin:${plugin}`); env.KEDOVI_CHANNEL = '1'; }
    else {
      delete env.TELEGRAM_STATE_DIR;
      console.warn(`⚠ 텔레그램 채널 없이 시작합니다: ${check.problems.join(' · ')}. kedovi notify my channel status`);
    }
  }
  const office = flags.includes('--pixel-agents') ? startPixelAgents(root, agent) : null;
  const shown = brief ? [...args.slice(0, -1), brief === '세션 브리핑' ? '세션 브리핑' : '+ 브리핑'] : args;
  console.log(`▶ ${a.label}: ${root}${shown.length ? `  (${shown.join(' ')})` : ''}`);
  const r = spawnSync(findCli(a.command) || a.command, args, { cwd: root, stdio: 'inherit', env });
  if (office) office.stop();
  process.exit(r.status == null ? 1 : r.status);
}

/**
 * --pixel-agents: 사용자가 설치한 pixel-agents(npm i -g pixel-agents)가 있으면 그 서버를 워크스페이스에서 띄우고 브라우저로 연다.
 * 없으면 알리고 빼고 시작한다. 띄운 서버는 세션이 끝나면 함께 끈다. 훅 설치 동의는 처음 열 때 그 화면이 묻는다
 */
function startPixelAgents(root, agent) {
  const cli = findCli('pixel-agents');
  if (!cli) { console.warn('⚠ pixel-agents 가 설치돼 있지 않아 화면 없이 시작합니다. 설치: npm i -g pixel-agents'); return null; }
  if (agent !== 'claude') console.warn('⚠ Pixel Agents 는 Claude Code 세션만 보여 줍니다. Codex 세션은 화면에 나오지 않습니다');
  const log = path.join(require('os').tmpdir(), `kedovi-pixel-agents-${process.pid}.log`);
  let child;
  try {
    const fd = fs.openSync(log, 'w');
    // 따로 프로세스 그룹: 에이전트 화면의 Ctrl+C 가 서버까지 끄지 않게
    child = require('child_process').spawn(cli, [], { cwd: root, detached: true, stdio: ['ignore', fd, fd], shell: process.platform === 'win32' });
    fs.closeSync(fd);
  } catch (e) { console.warn(`⚠ Pixel Agents 를 띄우지 못했습니다: ${e.message}`); return null; }
  const wait = new Int32Array(new SharedArrayBuffer(4));
  let url = null;
  for (let i = 0; i < 60 && !url; i++) { // 최대 15초
    Atomics.wait(wait, 0, 0, 250);
    let text = '';
    try { text = read(log); } catch { /* 아직 없음 */ }
    url = (text.match(/https?:\/\/[^\s]+\?token=[\w-]+/) || [])[0] || null;
    if (!url && child.exitCode !== null) break;
  }
  const stop = () => {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid); } catch { /* 이미 끝남 */ }
    try { fs.unlinkSync(log); } catch { /* 없음 */ }
  };
  if (!url) { console.warn(`⚠ Pixel Agents 주소를 받지 못해 화면 없이 시작합니다 (로그 ${log})`); stop(); return null; }
  const opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { require('child_process').spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* 주소는 아래에 찍는다 */ }
  console.log(`▶ Pixel Agents: ${url}  (세션이 끝나면 함께 끕니다)`);
  return { stop };
}

/**
 * 세션 첫 메시지. 브리핑 본문은 세션 시작 훅(packs/core/hooks/session-brief.js)이 컨텍스트로 넘기므로 "세션 브리핑" 한 줄만 보낸다 (전문을 첫 메시지로 넣으면 화면에 그대로 찍힌다).
 * 훅이 없는 옛 워크스페이스(upgrade 전)는 브리핑 도구 출력에 지시를 붙여 전문을 보낸다. 도구가 없거나 실패하면 빈 문자열
 */
function briefPrompt(root) {
  if (fs.existsSync(path.join(root, 'packs', 'core', 'hooks', 'session-brief.js'))) return '세션 브리핑';
  const tool = [path.join(root, 'packs', 'core', 'bin', 'brief.js'), path.join(KIT_ROOT, 'packs', 'core', 'bin', 'brief.js')].find((f) => fs.existsSync(f));
  if (!tool) return '';
  const r = spawnSync(process.execPath, [tool], { cwd: root, encoding: 'utf8' });
  const text = (r.stdout || '').trim();
  if (r.status !== 0 || !text) return '';
  return `세션 브리핑이다. 아래 내용을 설명을 보태지 말고 짧은 표나 목록으로 그대로 보여 준 뒤(로드맵 흐름도 코드 블록과 단계 표는 바꾸지 말고 그대로), "무엇부터 할까요?" 한 줄만 묻는다. 이전 작업을 잇자고 하면 resume 스킬을 따른다.\n\n${text}`;
}

// ───────────────────────── remove ─────────────────────────

const gitOut = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** 지우면 사라지는 작업이 있는지 — 미커밋 변경, 원격에 없는 커밋, stash. 원격이 아예 없으면 따로 표시 */
function unsavedWork(dir) {
  if (gitOut(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { git: false, issues: [] };
  const issues = [];
  const dirty = (gitOut(dir, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length;
  if (dirty) issues.push(`커밋 안 한 변경 ${dirty}개`);
  const hasRemote = !!gitOut(dir, ['remote']);
  const hasCommits = gitOut(dir, ['rev-parse', '--verify', '-q', 'HEAD']) !== null;
  if (hasRemote && hasCommits) {
    const ahead = (gitOut(dir, ['log', '--branches', '--not', '--remotes', '--oneline']) || '').split('\n').filter(Boolean).length;
    if (ahead) issues.push(`push 안 한 커밋 ${ahead}개`);
  }
  const stash = (gitOut(dir, ['stash', 'list']) || '').split('\n').filter(Boolean).length;
  if (stash) issues.push(`stash ${stash}개`);
  return { git: true, hasRemote, hasCommits, issues };
}

// ───────────────────────── reset ─────────────────────────

const RESET_ITEMS = [
  { value: 'local', label: '이 PC 설정', hint: '.agents/local.json: 메인 에이전트 · 인자 · 모델 프로필 · 역할 상한 · 응답 언어 · 대화 스타일 · 알림 · 채널 · 질문 방식' },
  { value: 'channel', label: '텔레그램 채널', hint: '이 프로젝트 봇 상태 폴더 · 플러그인 설치(local)' },
  { value: 'state', label: '세션 임시 기록', hint: '위임 작업 결과 · 훅 상태 (워크스페이스 밖 임시 폴더)' },
  { value: 'guide', label: '개인 지침', hint: '.agents/local.md (직접 쓴 내용이 지워진다)' },
  { value: 'secrets', label: '텔레그램 토큰', hint: '~/.config/kedovi/telegram.env (이 PC 의 모든 워크스페이스 공통)' },
];
const RESET_USAGE = `kedovi reset [${RESET_ITEMS.map((x) => x.value).join(',')} | --all] [--yes]`;

/**
 * 이 PC 의 개인 설정을 처음(kedovi install 직후) 상태로 되돌린다. 팀 설정(workspace.json · 팩) · repos/ · 핸드오프는 건드리지 않는다.
 * 워크스페이스를 통째로 지우는 것은 kedovi remove
 */
async function cmdReset(argv) {
  const root = locateWorkspace();
  const names = RESET_ITEMS.map((x) => x.value);
  const given = argv.includes('--all') ? names : (argv.find((x) => !x.startsWith('-')) || '').split(',').map((x) => x.trim()).filter(Boolean);
  const bad = given.filter((x) => !names.includes(x));
  if (bad.length) fail(`모르는 항목: ${bad.join(', ')}. 사용법: ${RESET_USAGE}`);
  let pick = given;
  const tty = process.stdin.isTTY;
  if (tty) { clack(); p.intro(' kedovi reset '); }
  if (!pick.length) {
    if (!tty) fail(`사용법: ${RESET_USAGE}`);
    pick = ask(await chooseMany({ message: '무엇을 초기화할까요?', hint: '이 PC 의 개인 설정만 처음 상태로 되돌립니다. 팀 설정(workspace.json · 팩) · repos/ · 핸드오프는 그대로.', options: RESET_ITEMS, initialValues: ['local', 'channel', 'state'] }));
    if (!pick.length) { p.outro('아무것도 바꾸지 않았습니다'); return; }
  }
  if (!argv.includes('--yes')) {
    if (!tty) fail('화면 없이 할 때는 --yes 를 붙입니다 (지운 것은 되돌릴 수 없다)');
    const sure = ask(await yesNo({ message: '선택한 항목을 초기화할까요?', hint: pick.map((v) => RESET_ITEMS.find((x) => x.value === v).label).join(' · '), initialValue: false }));
    if (!sure) { p.outro('취소했습니다'); return; }
  }
  const tool = path.join(root, 'packs', 'core', 'bin', 'notify.js');
  const notifyTool = (args) => fs.existsSync(tool) && spawnSync(process.execPath, [tool, ...args], { cwd: root, stdio: 'inherit' });
  const done = [];
  // 순서: 채널(로컬 설정을 읽는다) → 토큰 → 임시 기록 → 개인 지침 → 이 PC 설정 → sync
  if (pick.includes('channel')) { notifyTool(['channel', 'remove']); done.push('텔레그램 채널'); }
  if (pick.includes('secrets')) { notifyTool(['remove']); notifyTool(['remove', '--team']); done.push('텔레그램 토큰'); }
  if (pick.includes('state')) {
    try { const sd = require(path.join(root, 'packs', 'core', 'lib', 'workspace.js')).stateDir(root); fs.rmSync(sd, { recursive: true, force: true }); done.push('세션 임시 기록'); } catch { /* 옛 워크스페이스 */ }
  }
  if (pick.includes('guide')) { fs.rmSync(path.join(root, '.agents', 'local.md'), { force: true }); done.push('개인 지침'); }
  if (pick.includes('local')) { fs.rmSync(localConfigPath(root), { force: true }); done.push('이 PC 설정'); }
  runWorkspaceKit(root, ['sync', '--quiet']); // 개인 지침 · 에이전트 파일 · 편집 금지 설정을 다시 만든다
  const msg = `초기화했습니다: ${done.join(' · ')}.${pick.includes('local') ? ' 다음 kedovi start 때 연결 방식 · 메인 에이전트를 다시 묻습니다' : ''}`;
  if (tty) p.outro(msg); else console.log(`✔ ${msg}`);
}

async function cmdRemove(argv) {
  const force = argv.includes('--force');
  const ci = argv.indexOf('--confirm');
  const confirmName = ci >= 0 ? argv[ci + 1] : null;
  const target = argv.find((x, i) => !x.startsWith('-') && !(ci >= 0 && i === ci + 1));
  let root;
  if (target) {
    const hits = liveRegistry().filter((w) => w.name === target || path.basename(w.path) === target);
    if (!hits.length) fail(`목록에 ${target} 워크스페이스가 없습니다. kedovi list 로 확인하거나, 그 폴더에서 kedovi remove`);
    if (hits.length > 1) fail(`${target} 이름의 워크스페이스가 여러 개입니다. 지울 폴더로 이동해서 kedovi remove:\n  ${hits.map((w) => w.path).join('\n  ')}`);
    root = hits[0].path;
  } else {
    root = kit.findRoot();
    if (!root) fail('여기는 킷으로 만든 워크스페이스가 아닙니다. 지우려면 그 워크스페이스 루트에서 kedovi remove, 또는 어디서든 kedovi remove <이름> (이름은 kedovi list 로 확인)');
  }
  const name = workspaceName(root);
  let ws;
  try { ws = kit.loadWorkspace(root); } catch { ws = { repos: [] }; }

  const rows = [];
  let blocked = false;
  // repos/ — 링크는 링크만 지우고 대상 폴더는 건드리지 않는다
  for (const r of ws.repos) {
    const dir = path.join(root, r.dir);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { continue; }
    if (st.isSymbolicLink()) { rows.push(`  ${r.dir}  링크만 지움 (대상 ${r.path} 는 그대로)`); continue; }
    const u = unsavedWork(dir);
    if (u.issues.length) { blocked = true; rows.push(`⚠ ${r.dir}  ${u.issues.join(', ')}`); }
    else rows.push(`  ${r.dir}  ${u.git ? '저장 안 된 작업 없음' : 'git 아님'}`);
  }
  // 워크스페이스 자신 — 원격이 없으면(테스트용) 경고만, 원격이 있으면 막는다
  const self = unsavedWork(root);
  if (self.git && self.hasRemote && self.issues.length) { blocked = true; rows.push(`⚠ 워크스페이스 자체  ${self.issues.join(', ')}`); }
  else if (self.git && !self.hasRemote) rows.push('  워크스페이스 자체  원격 없음. 이 PC 에만 있는 기록(handoffs 등)이 사라진다');
  else rows.push('  워크스페이스 자체  저장 안 된 작업 없음');

  console.log(`지울 워크스페이스: ${root}  (.git·README·LICENSE 는 남기고 .gitignore 는 킷이 넣은 줄만 걷어 낸다)\n${rows.join('\n')}`);
  if (blocked && !force) fail('저장 안 된 작업이 있어 멈췄습니다. 커밋·push 하거나, 버려도 되면 kedovi remove --force');

  if (process.stdin.isTTY && !confirmName) {
    clack();
    const yes = ask(await yesNo({ message: target ? `${root} 를 지울까요?` : '이 워크스페이스를 지울까요?', hint: '.git·README·LICENSE 는 남기고 .gitignore 는 킷이 넣은 줄만 걷어 냅니다.', initialValue: false }));
    if (!yes) { p.cancel('지우지 않았습니다'); return; }
  } else {
    if (confirmName !== name && confirmName !== path.basename(root)) fail(`비대화형에서는 --confirm ${name} 이 필요합니다`);
  }

  // clone 해 온 repo 의 뼈대(.git·README·LICENSE·.gitignore)는 남긴다 — 그 자리에서 바로 kedovi init 을 다시 할 수 있게
  const keep = /^(\.git|\.gitignore|\.gitattributes|readme(\.[a-z]+)?|license(\.[a-z]+)?|changelog(\.[a-z]+)?)$/i;
  for (const e of fs.readdirSync(root)) if (!keep.test(e)) fs.rmSync(path.join(root, e), { recursive: true, force: true });
  // .gitignore: 킷이 넣은 줄(생성 블록 · 템플릿 기본 줄)만 걷어 낸다. 남는 줄이 없으면 파일도 지운다 (clone 직후 상태로)
  const gi = path.join(root, '.gitignore');
  if (fs.existsSync(gi)) {
    const text = read(gi).replace(/^# >>> kit[^\n]*\n[\s\S]*?^# <<< kit <<<[^\n]*\n?/m, '');
    let tpl = [];
    try { tpl = read(path.join(KIT_ROOT, 'templates', 'workspace', 'gitignore')).split('\n').map((l) => l.trim()).filter(Boolean); } catch { /* 템플릿 없음 */ }
    const rest = text.split('\n').filter((l) => !tpl.includes(l.trim()));
    if (rest.some((l) => l.trim())) fs.writeFileSync(gi, `${rest.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`);
    else fs.rmSync(gi, { force: true });
  }
  writeRegistry(readRegistry().filter((w) => w.path !== root));
  console.log(`✔ 비웠습니다: ${root}\n  다시 만들려면 이 폴더에서 kedovi init`);
}

// ───────────────────────── 워크스페이스 도구 ─────────────────────────

/** 워크스페이스의 packs/core/bin/<도구> 를 그대로 돈다 (도구는 워크스페이스 버전을 쓴다) */
function runWsTool(file, args, pack = 'core') {
  const root = locateWorkspace();
  const tool = path.join(root, 'packs', pack, 'bin', file);
  if (!fs.existsSync(tool)) fail(pack !== 'core' && !fs.existsSync(path.join(root, 'packs', pack)) ? `이 워크스페이스에는 ${pack} 팩이 없습니다. 켜기: kedovi upgrade --add ${pack}` : `이 워크스페이스에는 ${file} 도구가 없습니다. kedovi upgrade 후 다시 하세요`);
  const version = JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version;
  const r = spawnSync(process.execPath, [tool, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, KEDOVI_VERSION: version } });
  return process.exit(r.status == null ? 1 : r.status);
}

const NOTIFY_USAGE = `사용법
  kedovi notify setup                   설정 화면 (아래 항목을 골라서 바꾼다)
  kedovi notify                         지금 설정
  kedovi notify my setup [--new]        개인 봇 연결 (봇에게 먼저 아무 말이나 보낸다. 토큰은 숨김 입력, --new 는 봇 바꾸기)
  kedovi notify my level all|decisions|progress|off   알림 수준 (전체 · 결과와 결정 · 진행 현황 · 끄기)
  kedovi notify my away on|off          자리 비움 (결정을 텔레그램 버튼 질문으로, 버튼 · 번호 · 글로 답)
  kedovi notify my remote done|quiet|send   리모트 컨트롤(Claude 앱) 연결 중 텔레그램: 작업 끝만(기본) · 쉼 · 모두
  kedovi notify my desk <초>|off        PC 앞이면 끝남 · 위임 끝 · 음성 생략 (이 안에 키보드 · 마우스를 만졌을 때, 기본 120초 · macOS)
  kedovi notify my voice on|off · scope both|decisions|done|all · name <목소리> · test   음성 알림 (결정 질문 · 끝남 보고를 읽어 보냄)
  kedovi notify my on [--min <초>] · off · reset · test
  kedovi notify my channel on [--new]|off|status   양방향 대화 (기본 꺼짐. 이 프로젝트 전용 봇 → Claude Code 세션. 봇 토큰은 숨김 입력)
  kedovi notify my channel ask dialog|text   질문 방식: 선택지 창(기본) · 텔레그램 버튼 질문(= 자리 비움)
  kedovi notify my channel progress <분|off>   입력 없이 오래 작업하면 진행 현황 (기본 5분)
  kedovi notify team setup [--new]      팀 봇 연결 (팀장에게 받은 토큰을 숨김 입력에)
  kedovi notify team chat <그룹방 ID|off>   팀 방 지정 (팀 설정: commit · push)
  kedovi notify team announce "<내용>" · test`;

/** 알림 설정 화면 — 현재 값을 보여 주고 항목을 골라 바꾼다. 실제 변경은 워크스페이스의 notify.js 가 한다 (명령과 같은 동작) */
async function cmdNotifySetup() {
  const root = locateWorkspace();
  const tool = path.join(root, 'packs', 'core', 'bin', 'notify.js');
  const libFile = path.join(root, 'packs', 'core', 'lib', 'notify.js');
  if (!fs.existsSync(tool) || !fs.existsSync(libFile)) fail('이 워크스페이스에는 알림 도구가 없습니다. kedovi upgrade 후 다시 하세요');
  const version = JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version;
  // input 을 주면 표준 입력으로 넘긴다 (봇 토큰: 인자로 넘기면 프로세스 목록에 보인다)
  const runTool = (args, input) => spawnSync(process.execPath, [tool, ...args], { cwd: root, stdio: input == null ? 'inherit' : ['pipe', 'inherit', 'inherit'], input: input == null ? undefined : `${input}\n`, env: { ...process.env, KEDOVI_VERSION: version } }).status === 0;
  clack();
  p.intro(' kedovi notify setup ');
  for (;;) {
    delete require.cache[require.resolve(libFile)];
    const nl = require(libFile);
    let ws = {};
    try { ws = kit.loadWorkspace(root); } catch { /* 없음 */ }
    const me = nl.personal(root, ws);
    const team = nl.team(root, ws);
    const local = nl.readLocal(root).notify || {};
    const channel = nl.channelOn ? nl.channelOn(root) : false;
    const prog = Number(local.channelProgress != null ? local.channelProgress : 5);
    const options = [
      { value: 'level', label: '알림 수준', hint: `${nl.LEVEL_LABEL ? nl.LEVEL_LABEL[me.level] : (me.events.length ? '켜짐' : '꺼짐')}${me.source === 'team' ? ' (팀 기본)' : ''}` },
      { value: 'channel', label: '양방향 대화 (텔레그램 채널)', hint: channel ? `켜짐${nl.channelToken && nl.channelToken(root) ? '' : ' · 봇 없음'}` : '꺼짐' },
      ...(channel ? [{ value: 'away', label: '자리 비움', hint: me.away ? '켜짐: 결정은 텔레그램 버튼 질문' : '꺼짐: 질문은 터미널 선택지 창' }] : []),
      { value: 'bot', label: '개인 알림 봇', hint: me.token && me.chat ? `연결됨 · 채팅 ${me.chat}` : '없음' },
      { value: 'team', label: '팀 방 알림', hint: team.chat ? `팀 방 ${team.chat}${team.token ? '' : ' · 팀 봇 없음'}` : '없음' },
      { value: 'advanced', label: '고급', hint: `결과 기준 ${me.minSeconds}초 · 진행 현황 ${prog ? `${prog}분` : '끔'}` },
      { value: 'test', label: '시험 메시지 보내기', hint: '지금 설정으로 한 통' },
      { value: 'clear', label: '알림 설정 모두 지우기', hint: '이 워크스페이스의 알림 · 채널 설정과 개인 봇' },
      { value: 'done', label: '끝' },
    ];
    const pick = await choose({ message: '무엇을 설정할까요?', hint: '바꾸면 바로 적용됩니다. 진행 중인 세션은 다음 요청부터.', options, initialValue: 'done' });
    if (pick === BACK || pick === 'done' || clack().isCancel(pick)) break;
    if (pick === 'bot' && me.token && me.chat) {
      const b = await choose({ message: '개인 알림 봇', initialValue: 'change', options: [
        { value: 'change', label: '바꾸기', hint: '다른 봇 토큰으로' }, { value: 'remove', label: '제거', hint: '토큰 · 채팅 ID 를 지운다 (이 PC 의 모든 워크스페이스 공통)' }] });
      if (b === BACK) continue;
      if (b === 'remove') { runTool(['remove']); continue; }
    }
    if (pick === 'bot') {
      const token = await input({ message: '개인 봇 토큰', hint: '텔레그램 @BotFather 에서 /newbot 으로 만든 봇의 토큰. 만든 봇에게 아무 말이나 먼저 보내 둡니다. 입력은 가려집니다.', placeholder: '123456789:AA…', secret: true });
      if (token !== BACK && String(token || '').trim()) runTool(['setup', '--new'], String(token).trim());
    } else if (pick === 'level') {
      const lv = await choose({ message: '알림 수준', hint: '텔레그램으로 얼마나 받을지. 채널 끊김 경고는 끄기에서도 간다.', initialValue: me.level || 'decisions', options: [
        { value: 'all', label: '전체', hint: '터미널 요청의 질문 · 답 전문 · 에이전트 시작 · 끝 · 진행 현황 · 결정 대기' },
        { value: 'decisions', label: '결과와 결정 (권장)', hint: '오래 걸린 요청의 답 앞부분 · 질문 · 권한 확인' },
        { value: 'progress', label: '진행 현황', hint: '에이전트 시작 · 끝 · 진행 현황 · 끝남 한 줄 · 결정 대기 한 줄' },
        { value: 'off', label: '끄기' }] });
      if (lv !== BACK) runTool(['level', lv]);
    } else if (pick === 'away') {
      const aw = await choose({ message: '자리 비움', initialValue: me.away ? 'on' : 'off', options: [
        { value: 'on', label: '켜기', hint: '결정을 텔레그램 버튼 질문으로 (버튼 · 번호 · ✏️ 직접 입력) · 결과는 시간과 상관없이' },
        { value: 'off', label: '끄기', hint: '질문은 터미널 선택지 창 (방향키 · 직접 입력)' }] });
      if (aw !== BACK) runTool(['away', aw]);
    } else if (pick === 'advanced') {
      const ad = await choose({ message: '고급', options: [
        { value: 'min', label: '결과 알림 기준', hint: `지금 ${me.minSeconds}초 넘게 걸린 요청만 (자리 비움이면 모두)` },
        { value: 'desk', label: 'PC 앞이면 생략', hint: me.deskSeconds ? `지금 ${me.deskSeconds}초 안에 키보드 · 마우스를 만졌으면 끝남 알림 생략` : '지금 끔 (늘 보냄)' },
        { value: 'progress', label: '진행 현황 간격', hint: prog ? `지금 ${prog}분` : '지금 끔' }] });
      if (ad === BACK) continue;
      if (ad === 'desk') {
        const d = await choose({ message: 'PC 앞이면 생략', hint: '이 시간 안에 키보드 · 마우스를 만졌으면 끝남 · 위임 끝 · 음성을 보내지 않습니다. 질문 · 권한 대기는 보냅니다 (macOS).', initialValue: [60, 120, 300].includes(me.deskSeconds) ? me.deskSeconds : me.deskSeconds ? 120 : 0, options: [
          ...[60, 120, 300].map((x) => ({ value: x, label: `${x < 120 ? `${x}초` : `${x / 60}분`} 안에 만졌으면` })), { value: 0, label: '끄기 (늘 보냄)' }] });
        if (d !== BACK) runTool(['desk', d ? String(d) : 'off']);
      } else if (ad === 'min') {
        const m = await choose({ message: '결과 알림 기준', hint: '이보다 짧게 끝난 요청은 결과를 보내지 않습니다.', initialValue: [0, 30, 60, 120, 300].includes(me.minSeconds) ? me.minSeconds : 60, options: [0, 30, 60, 120, 300].map((x) => ({ value: x, label: x ? `${x < 60 ? `${x}초` : `${x / 60}분`} 넘게 걸리면` : '모든 요청' })) });
        if (m !== BACK) runTool(['min', String(m)]);
      } else {
        const g = await choose({ message: '진행 현황 알림', hint: '알림 수준이 전체 · 진행 현황일 때, 사용자 입력 없이 오래 작업하면 지금 하는 일을 보낸다.', initialValue: [5, 10, 15, 30].includes(prog) ? prog : prog ? 5 : 0, options: [
          ...[5, 10, 15, 30].map((x) => ({ value: x, label: `${x}분마다` })), { value: 0, label: '끄기' }] });
        if (g !== BACK) runTool(['channel', 'progress', g ? String(g) : 'off']);
      }
    } else if (pick === 'channel') {
      if (channel) {
        const c = await choose({ message: '양방향 대화', initialValue: 'check', options: [
          { value: 'check', label: '다시 점검', hint: 'Bun · 플러그인 · 봇 · 허용 목록을 확인하고 고친다' },
          { value: 'token', label: '봇 바꾸기', hint: '이 프로젝트 전용 봇 토큰을 새로' }, { value: 'off', label: '끄기', hint: '봇 · 설치는 남겨 둔다' },
          { value: 'remove', label: '제거', hint: '끄기 + 이 프로젝트 봇 토큰 · 허용 목록 · 플러그인 설치(local) 삭제' }] });
        if (c === BACK) continue;
        if (c === 'off') runTool(['channel', 'off']);
        else if (c === 'remove') runTool(['channel', 'remove']);
        else if (c === 'check') runTool(['channel', 'on']);
        else {
          const t = await input({ message: '이 프로젝트 봇 토큰', hint: '프로젝트마다 다른 봇. 다른 프로젝트가 쓰는 봇은 거부됩니다. 입력은 가려집니다.', placeholder: '123456789:AA…', secret: true });
          if (t !== BACK && String(t || '').trim()) runTool(['channel', 'on', '--new'], String(t).trim());
        }
      } else {
        const t = await input({ message: '이 프로젝트 봇 토큰', hint: '텔레그램 메시지가 Claude Code 세션으로 들어오고 답이 온다. 프로젝트마다 다른 봇 (Bun · claude.ai 로그인 필요). 비우면 이미 등록된 봇. 입력은 가려집니다.', placeholder: '123456789:AA… (비우면 등록된 봇)', secret: true });
        if (t === BACK) continue;
        if (String(t || '').trim()) runTool(['channel', 'on', '--new'], String(t).trim()); else runTool(['channel', 'on'], '');
      }
    } else if (pick === 'team') {
      const tm = await choose({ message: '팀 방 알림', hint: '핸드오프 push · 설정 변경 push · 공지를 팀 그룹방으로.', initialValue: team.token ? 'chat' : 'bot', options: [
        { value: 'bot', label: '팀 봇 연결', hint: '팀장에게 받은 팀 봇 토큰' },
        { value: 'chat', label: '팀 방 지정', hint: '팀 설정 (workspace.json, commit · push)' },
        { value: 'off', label: '팀 방 알림 끄기', hint: '팀 설정' },
        ...(team.token ? [{ value: 'remove', label: '팀 봇 제거', hint: '이 PC 의 팀 봇 토큰을 지운다' }] : [])] });
      if (tm === BACK) continue;
      if (tm === 'off') runTool(['team-chat', 'off']);
      else if (tm === 'remove') runTool(['remove', '--team']);
      else {
        const v = await input(tm === 'bot'
          ? { message: '팀 봇 토큰', hint: '팀장에게 받은 토큰. 봇을 팀 방에 초대하고 방에서 아무 말이나 해 두면 방 ID 를 보여 준다. 입력은 가려집니다.', placeholder: '123456789:AA…', secret: true }
          : { message: '팀 방 ID', hint: '팀 봇 연결 때 보여 준 그룹방 ID (-100…).', placeholder: '-100…' });
        if (v !== BACK && String(v || '').trim()) { if (tm === 'bot') runTool(['setup', '--team', '--new'], String(v).trim()); else runTool(['team-chat', String(v).trim()]); }
      }
    } else if (pick === 'clear') {
      const sure = await yesNo({ message: '알림 설정을 모두 지울까요?', hint: '이 워크스페이스의 자동 알림 · 양방향 채널(봇 · 상태 폴더 · 플러그인)과 개인 봇 토큰을 지웁니다. 팀 설정(workspace.json)은 그대로.', initialValue: false });
      if (sure !== true) continue;
      runTool(['channel', 'remove']);
      runTool(['reset']);
      runTool(['remove']);
    } else if (pick === 'test') {
      runTool(['test']);
      if (team.chat && team.token) runTool(['test', '--team']);
    }
  }
  p.outro('완료');
}

/** kedovi notify my|team <명령> → notify.js 인자. 옛 꼴(setup --team · team-chat …)도 그대로 받는다 */
function notifyArgs(rest) {
  const [scope, sub, ...more] = rest;
  if (!scope) return ['status'];
  if (scope === 'help' || scope === '--help') { console.log(NOTIFY_USAGE); process.exit(0); }
  if (scope === 'my') {
    if (!sub) return ['status'];
    if (['setup', 'on', 'off', 'reset', 'test', 'status', 'channel', 'level', 'away', 'voice', 'min', 'desk', 'remove'].includes(sub)) return [sub, ...more];
  } else if (scope === 'team') {
    if (!sub || sub === 'status') return ['status'];
    if (sub === 'setup') return ['setup', '--team', ...more];
    if (sub === 'chat') return ['team-chat', ...more];
    if (sub === 'announce') return ['announce', ...more];
    if (sub === 'test') return ['test', '--team', ...more];
  } else return rest;
  console.log(NOTIFY_USAGE);
  process.exit(1);
}

// ───────────────────────── upgrade 요약 ─────────────────────────

/** CHANGELOG.md → [{ version, rows: [[구분, 내용]] }] */
function changelog() {
  let text = '';
  try { text = read(path.join(KIT_ROOT, 'CHANGELOG.md')); } catch { return []; }
  return text.split(/^## /m).slice(1).map((sec) => ({
    version: sec.split('\n')[0].trim(),
    rows: sec.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.replace(/\\\|/g, '\u0000').split('|').slice(1, -1).map((c) => c.trim().replace(/\u0000/g, '|').replace(/`/g, ''))).slice(1),
  }));
}

const verNum = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
const verGt = (a, b) => { const x = verNum(a); const y = verNum(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/** 올린 버전 · 버전별 변경 내용 · 바뀐 파일 · 다음 할 일 */
function upgradeSummary(root, from) {
  let to = '';
  try { to = (JSON.parse(read(path.join(root, 'workspace.json'))).kit || {}).version; } catch { return; }
  const line = '─'.repeat(60);
  console.log(`\n${line}\n kedovi ${from && from !== to ? `${from} → ${to}` : `${to} (이미 이 버전)`}\n${line}`);
  const notes = changelog().filter((c) => (!from || verGt(c.version, from)) && !verGt(c.version, to));
  for (const c of notes) {
    console.log(`\n ${c.version}`);
    const w = Math.max(...c.rows.map((r) => width(r[0]))) + 2;
    for (const [k, v] of c.rows) console.log(`   ${padTo(k, w)}${v}`);
  }
  // 바뀐 파일 — 워크스페이스 git 기준으로 묶어서
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout || '';
  const rows = st.split('\n').filter((l) => l.length > 3);
  // 생성 사이트(kedovi docs build 의 docs-site/)를 아직 커밋한 적이 없으면 git add -A 에 섞이지 않게 따로 안내한다
  const site = rows.filter((l) => /^(docs-site|html)\//.test(l.slice(3)));
  const newSite = site.length > 0 && site.every((l) => l.startsWith('??'));
  const files = rows.filter((l) => !(newSite && site.includes(l))).map((l) => l.slice(3));
  if (newSite) console.log(`\n 생성 사이트 docs-site/ ${site.length}개는 아직 커밋한 적이 없습니다. Pages 로 올릴 때만 커밋한다 (켜기: kedovi docs pages on, 안 올리면: kedovi docs pages off)`);
  if (files.length) {
    const group = (f) => (f.startsWith('packs/') ? `packs/${f.split('/')[1]}` : f.startsWith('bin/') ? 'bin/' : /^(AGENTS|CLAUDE)\.md$|^\.(claude|codex|agents|githooks)\//.test(f) ? '생성물' : f);
    const counts = {};
    for (const f of files) counts[group(f)] = (counts[group(f)] || 0) + 1;
    console.log(`\n 바뀐 파일 ${files.length}개: ${Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} ${n}` : k)).join(' · ')}`);
    console.log(`\n 다음: git add -A${newSite ? " -- . ':!html'" : ''} && git commit -m "chore: kedovi ${to}" && git push  (팀원은 git pull)`);
  } else console.log('\n 바뀐 파일 없음');
}

// ───────────────────────── 진입 ─────────────────────────

/** 도움말 분류: [제목, 한 줄 설명, 명령(첫 낱말 · 「team-mode enforce」 처럼 두 낱말)]. 도움말 머리의 명령은 모두 어딘가에 들어가야 한다 (npm test) */
const HELP_GROUPS = [
  ['시작 · 설치', '워크스페이스 만들기 · 받기 · 작업 시작 · 킷 새 버전', ['init', 'init-docs', 'install', 'start', 'upgrade', 'list', 'remove', 'help']],
  ['AI · 모델', '연결 방식 · 메인 에이전트 · 모델 프로필 · 응답 언어 · 대화 스타일', ['agent', 'ai', 'models', 'prefs', 'timestamp']],
  ['프로젝트 설정', '유형 · 진행 방식 · repo · 스택 · 규칙 · 생성물', ['type', 'approach', 'repo', 'detect', 'rules', 'sync', 'check', 'doctor', 'packs', 'reset']],
  ['팀', '팀 현황 · 명단 · 팀 구성', ['team', 'team-mode']],
  ['팀 규칙 점검', '리뷰 확인 · 훅이 알리거나 막는 수준', ['review', 'team-mode enforce']],
  ['진행 · 기록', '로드맵 · 핸드오프 · 현황판 · 위임 · 토론 · 옛 작업 가져오기', ['plan', 'handoff', 'board', 'delegate', 'debate', 'import', 'tidy']],
  ['문서', '문서 사이트 · ID 찾기 · 화면설계서 · 데이터 설계 검사', ['docs', 'screens', 'datamodel']],
  ['알림 · 연동', '텔레그램 · 비밀값 · GitLab', ['notify', 'secret', 'gitlab']],
];
const HELP_COMMON = [['init', '새 워크스페이스 만들기'], ['install', '받은 워크스페이스 준비 (repos clone · 훅)'], ['start', '작업 시작'], ['upgrade', '킷 새 버전 반영'], ['doctor', '환경 점검']];

/** 도움말 머리(이 파일 첫 주석)의 명령: { use: 「kedovi …」 사용법, desc: 설명, words, group: HELP_GROUPS 번호(없으면 -1) } */
function helpEntries() {
  const lines = read(__filename).split('\n');
  const head = lines.slice(2, lines.indexOf(' */')).map((l) => l.replace(/^ \* ?/, ''));
  const out = [];
  for (const l of head) {
    const m = /^\s{0,4}kedovi ([a-z].*)$/.exec(l);
    if (m) {
      const [use, ...d] = m[1].split(/\s{3,}/);
      out.push({ use: `kedovi ${use.trim()}`, desc: d.join(' ').trim() });
    } else if (/^\s{5,}\S/.test(l) && out.length) out[out.length - 1].desc = `${out[out.length - 1].desc} ${l.trim()}`.trim();
  }
  return out.map((e) => {
    const words = e.use.split(/\s+/).slice(1);
    let group = -1, len = 0;
    HELP_GROUPS.forEach(([, , keys], i) => keys.forEach((k) => {
      const kw = k.split(' ');
      if (kw.length > len && kw.every((w, j) => words[j] === w)) { group = i; len = kw.length; }
    }));
    return { ...e, words, group };
  });
}

/** 터미널 폭에 맞춰 낱말 단위로 줄바꿈 (한글 2칸) */
function wrapText(text, max, indent) {
  const lines = [];
  let cur = '';
  for (const w of String(text).split(' ')) {
    if (cur && width(cur) + 1 + width(w) > max) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => indent + l);
}
const helpCols = () => Math.max(60, Math.min(process.stdout.columns || 100, 110));

/** 명령 하나: 사용법(청록) 한 줄 이상 + 설명(들여 쓴 줄) */
function fmtEntry(e) {
  const { styleText } = require('util');
  const w = helpCols();
  return [...wrapText(e.use, w - 2, '  ').map((l) => styleText('cyan', l)), ...(e.desc ? wrapText(e.desc, w - 6, '      ') : [])].join('\n');
}

/** 「kedovi <명령> --help」: 그 명령의 줄만 (「kedovi sync | check」 처럼 묶인 줄도) */
function usageOf(cmd) {
  const re = new RegExp(`^kedovi (?:[a-z-]+ \\| )*${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
  return helpEntries().filter((e) => re.test(e.use)).map(fmtEntry).join('\n\n');
}

function helpGroup(i, entries = helpEntries()) {
  const { styleText } = require('util');
  const [title, sub] = HELP_GROUPS[i];
  return `\n${styleText('bold', `${i + 1}. ${title}`)}  ${styleText('gray', sub)}\n\n${entries.filter((e) => e.group === i).map(fmtEntry).join('\n\n')}\n`;
}

function helpOverview({ menu = false } = {}) {
  const { styleText } = require('util');
  const ver = JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version;
  const out = [`${styleText('bold', 'kedovi')} ${ver}  AI 협업 워크스페이스 명령`, '', styleText('bold', '자주 쓰는 명령')];
  const c1 = Math.max(...HELP_COMMON.map(([c]) => width(c))) + 10;
  for (const [c, d] of HELP_COMMON) out.push(`  ${styleText('cyan', padTo(`kedovi ${c}`, c1))}${d}`);
  if (!menu) {
    out.push('', `${styleText('bold', '분류별 명령')}  ${styleText('gray', 'kedovi help <번호>')}`);
    const c2 = Math.max(...HELP_GROUPS.map(([t]) => width(t))) + 3;
    HELP_GROUPS.forEach(([t, , keys], i) => {
      const [first, ...more] = wrapText(keys.join(' · '), helpCols() - c2 - 7, '');
      out.push(`  ${i + 1}  ${padTo(t, c2)}${styleText('gray', first)}`, ...more.map((l) => `${' '.repeat(c2 + 5)}${styleText('gray', l)}`));
    });
    out.push('', styleText('gray', '자세히: kedovi help <번호|명령> · kedovi <명령> --help · 전체: kedovi help --all'));
  }
  return out.join('\n');
}

/** kedovi help [번호|분류|명령|--all]. 인자 없이 터미널이면 분류를 골라 들어가는 화면 */
async function cmdHelp(rest) {
  const entries = helpEntries();
  const arg = rest.find((x) => !x.startsWith('-'));
  if (rest.includes('--all')) return console.log(HELP_GROUPS.map((_, i) => helpGroup(i, entries)).join(''));
  if (arg) {
    const n = /^\d+$/.test(arg) ? Number(arg) - 1 : HELP_GROUPS.findIndex(([t]) => t.replace(/\s/g, '').includes(arg.replace(/\s/g, '')));
    if (n >= 0 && n < HELP_GROUPS.length) return console.log(helpGroup(n, entries));
    const u = usageOf(arg);
    if (u) return console.log(u);
    console.error(`✖ 모르는 분류 · 명령: ${arg}\n`);
    console.log(helpOverview());
    return process.exit(1);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return console.log(helpOverview());
  console.log(helpOverview({ menu: true }));
  let last;
  for (;;) {
    const v = await choose({
      message: '분류를 고르세요',
      hint: '명령 하나만: kedovi <명령> --help',
      initialValue: last,
      options: [...HELP_GROUPS.map(([t, sub], i) => ({ value: i, label: `${i + 1}. ${t}`, hint: sub })), { value: 'all', label: '전체 보기', hint: '모든 분류를 한 번에' }, { value: 'quit', label: '끝내기' }],
    });
    if (v === BACK || clack().isCancel(v) || v === 'quit') return;
    last = v;
    console.log(v === 'all' ? HELP_GROUPS.map((_, i) => helpGroup(i, entries)).join('') : helpGroup(v, entries));
  }
}

/** 상태를 바꾸는 명령: 모르는 옵션이면 실행하지 않는다 (오타 · 다른 명령의 옵션으로 엉뚱하게 돌지 않게) */
const KNOWN_OPTS = { upgrade: ['--add', '--all', '--scan', '--yes'], reset: ['--yes', '--all'], install: [], setup: [] };

/** Node 버전과 상관없는 kedovi 명령 (고정 위치 실행 파일 + PATH). 처음 한 번만 알린다 */
function ensureGlobalShim() {
  try {
    const r = require('./global-shim').ensure({ kit: path.join(KIT_ROOT, 'bin', 'kedovi.js'), pkg: JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).name });
    if (r && r.pathAdded.length) console.error(`ℹ Node 버전이 바뀌어도 kedovi 명령이 동작하도록 ${r.file} 를 두고 ${r.pathAdded.join(' · ')} 의 PATH 에 넣었습니다. 새 터미널부터 적용됩니다.`);
    else if (r && r.note && r.changed) console.error(`ℹ ${r.note}`);
  } catch { /* 편의 기능: 못 해도 명령은 계속 */ }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  ensureGlobalShim();
  noticeNewInstall(cmd);
  // 모든 하위 명령: --help · -h 면 사용법만 (start 의 「--」 뒤는 에이전트 인자라 보지 않는다)
  const own = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return cmdHelp(rest);
  if (!cmd.startsWith('-') && (own.includes('--help') || own.includes('-h'))) {
    const u = usageOf(cmd);
    console.log(u || `kedovi ${cmd}: 따로 적힌 사용법이 없습니다. 전체 명령: kedovi help`);
    process.exit(0);
  }
  if (KNOWN_OPTS[cmd]) {
    const bad = own.filter((x) => x.startsWith('-') && !KNOWN_OPTS[cmd].includes(x));
    if (bad.length) fail(`kedovi ${cmd}: 모르는 옵션 ${bad.join(' ')} 이라 실행하지 않았습니다.${usageOf(cmd) ? `\n${usageOf(cmd)}` : ''}`);
  }
  switch (cmd) {
    case 'init': return cmdInit(rest);
    case 'init-docs': return cmdInitDocs(rest);
    case 'install': case 'setup': return cmdInstall();
    case 'start': return cmdStart(rest);
    case 'remove': return cmdRemove(rest);
    case 'reset': return cmdReset(rest);
    case 'list': case 'ls': return cmdList();
    case 'detect': return cmdDetect(rest);
    case 'repo': return cmdRepo(rest);
    case 'rules': return cmdRules(rest);
    case 'team': {
      // 팀 현황 · 한 사람 자세히 · 인수 — 워크스페이스의 도구를 그대로 돈다 (에이전트 없이 리더가 본다)
      const root = locateWorkspace();
      const tool = path.join(root, 'packs', 'core', 'bin', 'team-status.js');
      if (!fs.existsSync(tool)) fail('이 워크스페이스에는 팀 현황 도구가 없습니다. kedovi upgrade 후 다시 하세요');
      if (['add', 'remove', 'restrict', 'members', 'edit', 'admins', 'lead', 'leads', 'repos', 'nick', 'whoami'].includes(rest[0])) return cmdTeamAdmin(root, rest);
      const [id, ...more] = rest;
      const toolArgs = !id || id.startsWith('--') ? rest : more.includes('--take') ? ['--take', id, '--items', more[more.indexOf('--take') + 1] || ''] : ['--id', id, ...more];
      const r = spawnSync(process.execPath, [tool, ...toolArgs], { cwd: root, stdio: 'inherit' });
      return process.exit(r.status == null ? 1 : r.status);
    }
    case 'models': return cmdModels(rest);
    case 'ai': return cmdAi(rest);
    case 'agent': {
      const root = locateWorkspace();
      // 화면 없이 (AI 가 대신 실행할 때): kedovi agent --claude|--codex [--args "<인자>"]. 프로필은 kedovi models profile
      const pick = rest.includes('--codex') ? 'codex' : rest.includes('--claude') ? 'claude' : null;
      if (pick || !process.stdin.isTTY) {
        if (!pick) fail('사용법: kedovi agent --claude|--codex [--args "<인자>"]');
        if (rest.includes('--profile')) fail('내 프로필은 kedovi models profile [이름|team] 으로 둡니다 (팀보다 낮은 것만)');
        const val = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
        const cur = readLocal(root);
        const conf = { agent: pick, args: val('--args') !== undefined ? String(val('--args')).split(/\s+/).filter(Boolean) : cur.agent === pick ? cur.args || [] : [] };
        writeLocal(root, conf);
        runWorkspaceKit(root, ['sync', '--quiet']);
        console.log(`✔ 메인 에이전트: ${AGENTS[pick].label}${conf.args.length ? ` (${conf.args.join(' ')})` : ''}. 다음 kedovi start 부터 적용`);
        return;
      }
      clack(); ask(await chooseAgent(root, { force: true, progress: true })); return p.outro('완료');
    }
    case 'sync': case 'check': return process.exit(runWorkspaceKit(locateWorkspace(), [cmd]) ? 0 : 1);
    case 'packs': return process.exit(runWorkspaceKit(kit.findRoot() || KIT_ROOT, ['packs']) ? 0 : 1);
    case 'upgrade': {
      if (rest.includes('--all')) return cmdUpgradeAll(rest);
      const root = locateWorkspace();
      requireAdmin(root, '킷 업그레이드');
      const addAt = rest.indexOf('--add');
      const args = ['upgrade', '--from', KIT_ROOT, ...(addAt >= 0 ? ['--add', rest[addAt + 1]] : [])];
      const from = ((kit.loadWorkspace(root) || {}).kit || {}).version;
      if (!runWorkspaceKit(root, args)) process.exit(1);
      // 요약은 전역 kedovi 이 찍는다 (upgrade 를 도는 건 워크스페이스의 옛 kit.js 라 새 형식을 모른다)
      process.on('exit', (code) => { if (code === 0) upgradeSummary(root, from); });
      // 옛 유형 옮기기 (유지보수 → 운영·고도화). upgrade 를 도는 옛 kit.js 는 모르는 일이라 여기서
      // 로드맵이 없는 워크스페이스는 종류별 기본 단계로 만든다 (옛 kit.js 의 upgrade 는 모르는 일이라 여기서)
      const planMade = kit.ensurePlan(root);
      if (planMade) console.log(`  로드맵 ${planMade.replace(/^✔ /, '')}`);
      // 스택이 이미 정해진 repo 는 다시 감지하지 않는다. 새 킷이 더 잡는 스택(예: 인프라)이 있으면 알린다 (바꾸지는 않는다)
      try {
        const now = new Map(((kit.loadWorkspace(root) || {}).repos || []).map((r) => [r.name, r.stacks || []]));
        const fresh = kit.detectRepos(root, { force: true, write: false, languages: false }).map((d) => [d.name, (d.stacks || []).filter((id) => !(now.get(d.name) || []).includes(id))]).filter(([, l]) => l.length);
        if (fresh.length) console.log(`  새로 감지되는 스택: ${fresh.map(([n, l]) => `${n} ${l.join(', ')}`).join(' · ')}. 필요하면 kedovi detect 화면에서 확인해 더한다 (일부러 뺀 것이면 무시)`);
      } catch { /* 감지는 부가 기능 */ }
      const moved = kit.migrateTypes(root);
      if (moved) { console.log(`  ${moved}`); if (!runWorkspaceKit(root, ['sync'])) process.exit(1); }
      // 옛 워크스페이스 — 멀티모듈 repo 의 모듈 경로를 채운다 (upgrade 를 도는 옛 kit.js 는 모르는 일이라 여기서)
      // 그 사이 유형 기본값이 된 팩(예: 0.33 의 screens · 0.36 의 datamodel)은 켜지 않고 알린다
      const offPacks = kit.missingTypePacks(kit.loadWorkspace(root) || {}, KIT_ROOT);
      if (offPacks.length) console.log(`  이 유형의 기본 팩인데 꺼져 있음: ${offPacks.join(', ')}. 켜려면 kedovi upgrade --add ${offPacks.join(',')} (일부러 뺀 것이면 무시)`);
      // 진행 방식을 정하지 않은 옛 워크스페이스는 그대로(전체처럼) 두고 고르는 법만 알린다
      // 0.63: 운영·고도화의 운영 · 유지보수는 이슈형으로 (기존 워크스페이스는 그대로 두고 한 번 알린다)
      const pj = (kit.loadWorkspace(root) || {}).project || {};
      const older = (v) => { const [a1, b1] = String(v || '0.0').split('.').map(Number); return a1 === 0 && b1 < 63; };
      if (pj.type === 'enhancement' && pj.approach !== 'issue' && older(from)) console.log('  운영·고도화: 이슈마다 운영에 반영하는 운영 · 유지보수면 kedovi approach issue (로드맵이 단계 대신 이슈 보드가 된다). 기능 묶음을 오픈까지 진행하는 고도화면 그대로');
      if (!((kit.loadWorkspace(root) || {}).project || {}).approach) console.log('  진행 방식: 정하지 않음 (전체처럼 동작). 최소 기능부터 스프린트로 붙이려면 kedovi approach sprint, 지금 방식으로 정해 두려면 kedovi approach full');
      const filled = kit.fillStackPaths(root);
      if (filled.length) console.log(`  모듈 경로 기록: ${filled.join(', ')}`);
      // 0.73: repo 언어 감지 (언어별 클린코드 규칙)
      const langs = kit.fillLanguages(root);
      if (langs.length) console.log(`  언어 감지: ${langs.map((x) => `${x.name} ${kit.labelLanguages(kit.loadLanguages(root), x.languages)}`).join(' · ')}. 언어별 클린 코드 규칙이 붙습니다 (한 repo 에서 빼기: kedovi rules off <ID> --repo <이름>)`);
      if (filled.length || langs.length) return process.exit(runWorkspaceKit(root, ['sync']) ? 0 : 1);
      return process.exit(0);
    }
    case 'doctor': return runWsTool('doctor.js', []);
    case 'notify':
      if (rest[0] === 'setup' && rest.length === 1 && process.stdin.isTTY) return cmdNotifySetup();
      return runWsTool('notify.js', notifyArgs(rest));
    case 'handoff': return runWsTool('handoff.js', rest);
    case 'plan': return runWsTool('plan.js', rest);
    case 'docs': return runWsTool('docs-site.js', rest);
    case 'delegate': return runWsTool('delegate.js', rest.length ? rest : ['list']);
    case 'debate': return runWsTool('debate.js', rest.length ? rest : ['list']);
    case 'board': return runWsTool('board.js', rest);
    case 'tidy': return runWsTool('tidy.js', rest);
    case 'screens': return rest[0] === 'compare' ? runWsTool('compare-screens.js', rest.slice(1), 'screens') : runWsTool('check-screens.js', rest.filter((x) => x !== 'check'), 'screens');
    case 'datamodel': return runWsTool('check-datamodel.js', rest.filter((x) => x !== 'check'), 'datamodel');
    case 'team-mode': return cmdTeamMode(rest);
    case 'approach': return cmdApproach(rest);
    case 'type': return cmdType(rest);
    case 'timestamp': return cmdTimestamp(rest);
    case 'prefs': return cmdPrefs(rest);
    case 'gitlab': return runWsTool('gitlab-mr.js', rest, 'gitlab');
    case 'review': return runWsTool('review.js', rest);
    case 'import': return runWsTool('import-scan.js', rest.map((a) => (a.startsWith('--') ? a : path.resolve(a)))); // 도구는 워크스페이스 루트에서 돈다
    case 'secret': case 'secrets': {
      // 워크스페이스 밖에서도 (--global). 워크스페이스에 도구가 없으면(옛 버전) 이 킷의 것을 쓴다. 숨김 입력이 있어 터미널을 그대로 넘긴다
      const root = kit.findRoot();
      let tool = root && path.join(root, 'packs', 'core', 'bin', 'secret.js');
      if (!tool || !fs.existsSync(tool)) tool = path.join(KIT_ROOT, 'packs', 'core', 'bin', 'secret.js');
      const r = spawnSync(process.execPath, [tool, ...rest], { stdio: 'inherit' });
      return process.exit(r.status == null ? 1 : r.status);
    }
    case '--version': case '-v':
      return console.log(JSON.parse(read(path.join(KIT_ROOT, 'package.json'))).version);
    default:
      console.error(`✖ 모르는 명령: ${cmd}\n`);
      console.log(helpOverview());
      process.exit(1);
  }
}

main().catch((e) => fail(e.stack || e.message));
