#!/usr/bin/env node
/**
 * 문서 사이트 앱 브라우저 시험 (킷 개발용, `npm run test:site`). `npm test` 는 화면을 보지 않으므로 화면을 고치면 이것을 돌린다.
 *
 * 임시 폴더에 킷 가이드와 시험 기획 repo(화면설계서 · 데이터 설계 포함) 사이트를 만들고, 이 PC 의 Chrome 을 화면 없이 띄워 본다.
 * 브라우저: 설치된 Google Chrome (channel chrome). 다른 Chromium 은 KEDOVI_CHROME=<실행 파일 경로>.
 * 보는 것: 새로고침 없는 이동 · 상단 탭 · 뒤로 가기 · 같은 쪽 다시 누름 · 검색 창 · 그림 · 확대 · 테마 · 목차 · 전체 인쇄 · 좁은 화면 서랍 ·
 *          file:// · 필기(마우스 · 손가락 · 두 손가락 이동 · 펜 · 지우개 끌기 · 쪽마다 저장) · 근거 패널(iframe) ·
 *          ERD 뷰어(영역 개요 · 표 · 상세 · 검색 · 확대 · 스키마 · 내보내기) · 화면설계서 뷰어(썸네일 · 넘기기 · 내부 정보 · 근거 패널 · 발표) ·
 *          프로젝트 사이트(빌드 DB 시험 재료 bin/fixtures): 대시보드 · 탭별 메뉴 · 기능 머리 · 바뀐 문서 · 관계 서랍 · 의견 서랍 · 글자 골라 의견 · 멘션 · 나 · 가상 화면 전부 ·
 *          쓰기 보고서 화면(표본으로 열기 · 테이블 고르기 · 행 수 · 더 보기 · 검색 · 시험 고르기 · 주소 유지 · 위험 표시 · 데이터 없음)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const KIT = path.resolve(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.error('✖ playwright-core 가 없습니다: 킷 repo 에서 npm install'); process.exit(1); }

/** 사이트 폴더에 { 경로: 내용 } 쓰기 */
function write(dir, pages) {
  for (const [p, c] of Object.entries(pages)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), c); }
}
/** 시험 기획 repo: 기능 정의 · 화면설계서 장(근거 FN-001) · 테이블 정의서 → 사이트 */
function fixture(tmp) {
  const repo = path.join(tmp, 'plans');
  const sheet = fs.readFileSync(path.join(KIT, 'packs', 'screens', 'assets', 'storyboard', 'template.html'), 'utf8').replace(/REQ-000/g, 'FN-001');
  write(repo, {
    'README.md': '# 시험 기획\n\n본문\n',
    '40-functions.md': '# 기능 정의\n\n| ID | 기능 |\n|---|---|\n| FN-001 | 로그인 |\n| FN-002 | 주문 |\n',
    '02-screens/web.html': sheet,
    '06-data/shop.md': fs.readFileSync(path.join(KIT, 'packs', 'datamodel', 'assets', 'erd', 'template.md'), 'utf8'),
  });
  const DS = require('../packs/core/bin/docs-site');
  const res = DS.generate({ name: 'plans', dir: repo }, null, 'docs-site');
  const out = path.join(repo, 'docs-site');
  write(out, res.pages);
  return out;
}
function serve(dir) {
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return new Promise((ok) => {
    const s = http.createServer((q, r) => {
      let f = path.join(dir, decodeURIComponent(new URL(q.url, 'http://x').pathname));
      if (f.endsWith(path.sep)) f = path.join(f, 'index.html');
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'text/html; charset=utf-8' }); r.end(d); });
    }).listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() }));
  });
}

const results = [];
async function check(name, fn) {
  try { const v = await fn(); results.push([true, name, v == null ? '' : String(v)]); console.log(`✔ ${name}${v == null ? '' : `  ${v}`}`); }
  catch (e) { results.push([false, name, e.message]); console.log(`✖ ${name}  ${e.message.split('\n')[0]}`); }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-site-test-'));
  const guide = path.join(tmp, 'guide');
  write(guide, require('./docs').site().pages);
  const plans = fixture(tmp);
  const proj = require('./fixtures/project-site').build(path.join(tmp, 'project'), 'site');
  const PF = require('./fixtures/profiles');
  const enh = require('./fixtures/project-site').build(path.join(tmp, 'enh'), 'site', PF.enhancement(), { labels: { 기능: '개선' } });
  const G = await serve(guide), F = await serve(plans), PJ = await serve(proj), EN = await serve(enh);
  const browser = await chromium.launch(process.env.KEDOVI_CHROME ? { executablePath: process.env.KEDOVI_CHROME } : { channel: 'chrome' }).catch((e) => {
    console.error(`✖ Chrome 을 띄우지 못했습니다 (${e.message.split('\n')[0]}). Google Chrome 을 설치하거나 KEDOVI_CHROME=<Chromium 경로>`);
    process.exit(1);
  });
  const errors = [];
  const page = async (opt) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, ...opt });
    await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
    const p = await ctx.newPage();
    const go = p.goto.bind(p);
    p.goto = async (u) => { const r = await go(u); if (!/erd\.html|02-screens|write-report/.test(u)) await p.waitForSelector('html.ds-app'); return r; };
    p.on('pageerror', (e) => errors.push(e.message));
    return p;
  };
  const p = await page();
  const st = () => p.evaluate(() => ({ path: decodeURIComponent(location.pathname), h1: (document.querySelector('article h1') || {}).textContent, on: (document.querySelector('.nav-link.on') || {}).textContent, mark: window.__mark }));

  await p.goto(`${G.url}index.html`);
  await p.waitForSelector('nav.side .nav-link');
  await p.evaluate(() => { window.__mark = 1; });
  await check('새로고침 없는 이동', async () => {
    await p.click('nav.side a.nav-link:has-text("빠른 시작")');
    await p.waitForFunction(() => /quickstart/.test(location.pathname));
    const s = await st();
    ok(s.mark === 1, '쪽을 새로 읽었다'); ok(s.on === '빠른 시작', `메뉴 표시 ${s.on}`); ok(/빠른 시작/.test(s.h1), `제목 ${s.h1}`);
    return s.path;
  });
  await check('상단 탭 = 묶음 · 왼쪽 메뉴 = 지금 탭', async () => {
    const tabs = await p.evaluate(() => [...document.querySelectorAll('header .tab')].map((a) => a.textContent));
    const groups = JSON.parse(fs.readFileSync(path.join(KIT, 'docs-site.json'), 'utf8')).groups.map((g) => g.group);
    ok(JSON.stringify(tabs) === JSON.stringify(groups), `탭 ${tabs} ≠ 묶음 ${groups}`);
    ok(await p.evaluate(() => (document.querySelector('header .tab.on') || {}).textContent) === '시작', '시작 탭 선택 표시');
    ok(!(await p.$('header .search input')), '머리 줄 가운데 검색칸이 남음');
    await p.click('header .tab:has-text("쓰는 법")'); await p.waitForFunction(() => /workflow/.test(location.pathname));
    const r = await p.evaluate(() => [document.querySelector('header .tab.on').textContent, [...document.querySelectorAll('nav.side .nav-link')].some((a) => a.textContent === '명령'), [...document.querySelectorAll('nav.side .nav-link')].some((a) => a.textContent === '빠른 시작'), window.__mark]);
    ok(r[0] === '쓰는 법' && r[1] && !r[2] && r[3] === 1, JSON.stringify(r));
    await p.goBack(); await p.waitForFunction(() => /quickstart/.test(location.pathname));
    return tabs.join(' · ');
  });
  await check('뒤로 가기', async () => {
    await p.goBack(); await p.waitForFunction(() => /index\.html$/.test(location.pathname));
    const s = await st(); ok(s.mark === 1 && s.on === '소개', JSON.stringify(s));
  });
  await check('긴 쪽 → 짧은 쪽: 아래에 빈 공간이 남지 않음', async () => {
    await p.goto(`${G.url}docs/docs-site.html`); await p.waitForTimeout(300);
    await p.click('header .tab:has-text("설정")'); await p.waitForFunction(() => !/docs-site\.html/.test(location.pathname));
    await p.click('nav.side a.nav-link:has-text("예산")'); await p.waitForFunction(() => /budget/.test(location.pathname)); await p.waitForTimeout(300);
    // 쪽 높이 = 창 높이와 (본문 끝 + 이전/다음) 중 큰 쪽. 필기 층이 옛 쪽 높이를 끌고 오면 훨씬 길어진다
    const r = await p.evaluate(() => [document.documentElement.scrollHeight, document.querySelector('main').getBoundingClientRect().bottom + scrollY, innerHeight]);
    ok(r[0] <= Math.max(r[2], r[1]) + 2, `쪽 높이 ${r[0]} · 본문 끝 ${Math.round(r[1])} · 창 ${r[2]}`);
    await p.goto(`${G.url}index.html`); await p.waitForSelector('html.ds-app'); await p.evaluate(() => { window.__mark = 1; });
    return `쪽 ${r[0]}px`;
  });
  await check('같은 쪽 다시 누름 = 다시 읽지 않음', async () => {
    await p.click('nav.side a.nav-link:has-text("소개")'); await p.waitForTimeout(300);
    ok((await st()).mark === 1, '다시 읽었다');
  });
  await check('검색 창 (돋보기 · ⌘K · 본문)', async () => {
    await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(100);
    const y0 = await p.evaluate(() => scrollY);
    await p.keyboard.press('Meta+k'); await p.waitForSelector('.sp-veil #q');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'q'), '⌘K 로 열면 입력칸에 커서');
    await p.keyboard.press('Escape'); await p.waitForFunction(() => !document.querySelector('.sp-veil'));
    await p.click('#search-btn'); await p.waitForSelector('.sp-veil #q');
    await p.keyboard.type('프로필'); await p.keyboard.press('Backspace'); await p.keyboard.type('필');
    ok(await p.evaluate(() => scrollY) === y0, `글자를 칠 때 화면이 움직임 (${y0} → ${await p.evaluate(() => scrollY)})`);
    await p.waitForFunction(() => [...document.querySelectorAll('#results .kind')].some((k) => k.textContent === '본문'));
    const n = await p.evaluate(() => [...document.querySelectorAll('#results .kind')].filter((k) => k.textContent === '본문').length);
    const crumb = await p.evaluate(() => (document.querySelector('#results .sp-item .c') || {}).textContent || '');
    ok(/›/.test(crumb), `결과 위치 줄 ${crumb}`);
    await p.click('.chips .chip:has-text("본문")'); await p.waitForTimeout(100);
    ok(await p.evaluate(() => [...document.querySelectorAll('#results .kind')].every((k) => k.textContent === '본문')), '종류 칩 거르기');
    await p.keyboard.press('Escape');
    ok(!(await p.$('.sp-veil')), 'Esc 로 안 닫힘');
    return `본문 결과 ${n}`;
  });
  await check('그림 · 확대 · 테마', async () => {
    await p.click('header .tab:has-text("쓰는 법")'); await p.waitForFunction(() => /workflow/.test(location.pathname));
    await p.click('nav.side a.nav-link:has-text("1. 전체 그림")');
    await p.waitForFunction(() => document.querySelector('pre.mermaid svg'), null, { timeout: 15000 });
    ok((await st()).mark === 1, '쪽을 새로 읽었다');
    await p.click('.diagram button.mm-zoom', { force: true });
    await p.waitForSelector('.mm-overlay svg'); await p.keyboard.press('Escape');
    ok(!(await p.$('.mm-overlay')), '확대 창이 안 닫힘');
    await p.click('#theme');
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelector('pre.mermaid svg'));
    await p.click('#theme');
  });
  await check('목차 따라가기', async () => {
    await p.goto(`${G.url}docs/team-models.html`); await p.waitForSelector('#toc a');
    await p.click('#toc a >> nth=1'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => [decodeURIComponent(location.hash), (document.querySelector('#toc a.on') || {}).textContent, Math.round(document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect().top)]);
    ok(r[0].slice(1).length && r[1], JSON.stringify(r));
    ok(r[2] >= 60, `제목이 머리 줄에 가림 (위치 ${r[2]}px)`);
    return r[1];
  });
  await check('전체 인쇄', async () => {
    await p.goto(`${G.url}print-all.html`);
    await p.waitForFunction(() => window.__printed, null, { timeout: 20000 });
    return `${await p.evaluate(() => document.querySelectorAll('.print-doc').length)}개 문서`;
  });
  await check('필기: 마우스 · 쪽마다 저장 · 지우개 끌기', async () => {
    await p.goto(`${G.url}docs/docs-site.html`); await p.waitForSelector('#ink');
    await p.evaluate(() => localStorage.clear());
    await p.click('#ink');
    const line = async (y) => { await p.mouse.move(600, y); await p.mouse.down(); for (let i = 1; i <= 15; i++) await p.mouse.move(600 + i * 12, y + Math.sin(i / 2) * 8); await p.mouse.up(); };
    await line(400); await line(500);
    ok(await p.evaluate(() => document.querySelectorAll('.ink-layer path').length) === 2, '획 2개가 아님');
    await p.click('nav.side a.nav-link:has-text("명령")'); await p.waitForFunction(() => /commands/.test(location.pathname));
    ok(await p.evaluate(() => document.documentElement.classList.contains('ink-on') && document.querySelectorAll('.ink-layer path').length === 0), '다른 쪽에 획이 보이거나 필기가 꺼짐');
    await p.goBack(); await p.waitForFunction(() => /docs-site\.html/.test(location.pathname));
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.querySelectorAll('.ink-layer path').length) === 2, '돌아와서 획이 없음');
    await p.click('.ink-bar button[title="지우개"]');
    await p.mouse.move(650, 300); await p.mouse.down(); await p.mouse.move(660, 620, { steps: 12 }); await p.mouse.up();
    ok(await p.evaluate(() => document.querySelectorAll('.ink-layer path').length) === 0, '끌어서 지워지지 않음');
    await p.click('.ink-bar button[title="펜"]');
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => !document.documentElement.classList.contains('ink-on')), 'Esc 로 안 꺼짐');
  });

  const t = await page({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true });
  await check('필기: 한 손가락 = 필기 · 두 손가락 = 이동 (펜 없음)', async () => {
    await t.goto(`${G.url}docs/docs-site.html`); await t.waitForSelector('#ink');
    await t.evaluate(() => localStorage.clear()); await t.reload(); await t.waitForSelector('#ink');
    await t.tap('#ink');
    const cdp = await t.context().newCDPSession(t);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
    await T('touchStart', [[500, 900]]); for (let i = 1; i <= 6; i++) await T('touchMove', [[500 + i * 30, 900 - i * 20]]); await T('touchEnd', []);
    await t.waitForTimeout(150);
    ok(await t.evaluate(() => document.querySelectorAll('.ink-layer path').length) === 1, '한 손가락 획이 없음');
    const y0 = await t.evaluate(() => scrollY);
    await T('touchStart', [[400, 1000], [600, 1000]]); for (let i = 1; i <= 8; i++) await T('touchMove', [[400, 1000 - i * 60], [600, 1000 - i * 60]]); await T('touchEnd', []);
    await t.waitForTimeout(700);
    const r = await t.evaluate(() => [document.querySelectorAll('.ink-layer path').length, scrollY]);
    ok(r[0] === 1, `두 손가락이 획을 남김 (${r[0]})`); ok(r[1] - y0 > 200, `이동이 작음 (${r[1] - y0})`);
    return `${Math.round(r[1] - y0)}px 이동`;
  });
  await check('필기: 펜이 닿으면 펜 = 필기 · 손가락 = 브라우저 스크롤', async () => {
    await t.evaluate(() => {
      const l = document.querySelector('.ink-layer'), r = l.getBoundingClientRect();
      const ev = (type, x, y) => l.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'pen', pressure: 0.6, clientX: r.left + x, clientY: r.top + y, bubbles: true }));
      ev('pointerdown', 100, 300); for (let i = 1; i < 10; i++) ev('pointermove', 100 + i * 15, 300 + i * 5); ev('pointerup', 250, 350);
    });
    const r = await t.evaluate(() => [document.documentElement.classList.contains('ink-pen'), document.querySelectorAll('.ink-layer path').length, getComputedStyle(document.querySelector('.ink-layer')).touchAction]);
    ok(r[0] && r[1] === 2, JSON.stringify(r)); ok(/pan-x pan-y/.test(r[2]), `touch-action ${r[2]}`);
  });

  const m = await page({ viewport: { width: 390, height: 800 } });
  await check('좁은 화면 서랍', async () => {
    await m.goto(`${G.url}index.html`); await m.waitForSelector('#menu');
    await m.click('#menu');
    await m.waitForFunction(() => document.body.classList.contains('nav-open'), null, { timeout: 3000 }).catch(() => {});
    ok(await m.evaluate(() => document.body.classList.contains('nav-open') && document.querySelectorAll('nav.side .nav-tabs .nav-tab').length > 1 && !document.querySelector('header .tabs')), '서랍 · 서랍 안 탭 목록');
    const top = await m.evaluate(() => [document.querySelector('#menu').getBoundingClientRect().top, document.querySelector('#theme').getBoundingClientRect().top]);
    ok(Math.abs(top[0] - top[1]) < 8, `머리 줄 단추가 두 줄 (${top})`);
    await m.click('nav.side a.nav-link:has-text("빠른 시작")'); await m.waitForFunction(() => /quickstart/.test(location.pathname));
    ok(await m.evaluate(() => !document.body.classList.contains('nav-open')), '고른 뒤 서랍이 안 닫힘');
  });
  await check('file:// 로 열기', async () => {
    const f = await page();
    await f.goto(`file://${guide}/index.html`); await f.waitForSelector('nav.side .nav-link');
    await f.click('nav.side a.nav-link:has-text("빠른 시작")'); await f.waitForFunction(() => /quickstart/.test(location.pathname));
    ok(await f.evaluate(() => (document.querySelector('.nav-link.on') || {}).textContent === '빠른 시작'), '메뉴 표시');
  });
  await check('근거 패널 (화면설계서 → 문서, iframe 안은 본문만)', async () => {
    await p.goto(`${F.url}02-screens/web.html`); await p.waitForSelector('a.sb-ref');
    await p.evaluate(() => document.querySelector('a.sb-ref').click());
    await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some((x) => /40-functions/.test(x.src)));
    const fr = await (await p.waitForSelector('iframe[src*="40-functions"]')).contentFrame();
    await fr.waitForSelector('article h1');
    const r = await fr.evaluate(() => [document.documentElement.classList.contains('embedded'), !document.querySelector('header'), !!document.querySelector('tr.ds-hit')]);
    ok(r.every(Boolean), JSON.stringify(r));
  });
  await check('ERD 뷰어 (영역 개요 · 표 · 상세 · 검색 · 확대 · 스키마 · 내보내기)', async () => {
    await p.goto(`${F.url}06-data/shop.html`); await p.waitForSelector('.nav-act');
    await p.click('.nav-act[title="ERD 보기"]'); await p.waitForFunction(() => /erd\.html/.test(location.pathname));
    await p.waitForSelector('html.erd-ready', { timeout: 20000 });
    ok(await p.evaluate(() => document.querySelectorAll('#vp .card').length) > 0, '영역 개요 카드가 없음');
    await p.click('#vp .card >> nth=0');
    await p.waitForFunction(() => document.querySelectorAll('#vp .tb').length > 0, null, { timeout: 15000 });
    await p.click('#list a >> nth=0'); await p.waitForTimeout(500);
    ok(await p.evaluate(() => document.querySelector('#detail').classList.contains('open') && !!document.querySelector('#detail h3')), '상세가 안 열림');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.querySelector('#detail').classList.contains('open')), 'Esc 로 안 닫힘');
    await p.fill('#q', 'order'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.querySelectorAll('#vp .tb.hit, #vp .tb.dim').length) > 0, '검색 강조가 없음');
    await p.fill('#q', '');
    const z0 = await p.textContent('#zoom'); await p.click('#zin'); await p.waitForTimeout(200);
    ok(z0 !== await p.textContent('#zoom'), '확대 비율이 그대로');
    await p.click('#schemaBtn'); ok(await p.isVisible('#schemaList label'), '스키마 메뉴'); await p.click('#q');
    await p.click('#export');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportMenu button >> nth=0')]);
    ok(/\.sql$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    return `표 ${await p.evaluate(() => document.querySelectorAll('#vp .tb').length)}`;
  });
  await check('ERD 선 고르기 · 논리 참조 배치 힌트', async () => {
    // 관계 배치 + 논리 참조 켬: 배치를 다시 계산하고(캐시 키에 lrefs), 논리 참조 선은 한 번씩만 그린다
    const lay = await p.evaluate(async () => {
      const E = window.ERD, st = E.st;
      st.arrange = 'rel'; st.overview = false; st.lrefs = false; await E.layout();
      const n0 = st.cache.size; st.lrefs = true; await E.layout();
      const want = E.lrels.filter((r) => r.from !== r.to && st.pos.has(r.from) && st.pos.has(r.to)).length;
      return { grew: st.cache.size > n0, lg: document.querySelectorAll('#vp path.ed.lg').length, want };
    });
    ok(lay.grew, '논리 참조를 켜도 배치를 다시 계산하지 않음');
    ok(lay.lg === lay.want, `논리 참조 선 ${lay.lg}개 (기대 ${lay.want}, 이중 표시 없어야 함)`);
    // 선 누르기: 두 테이블 · 컬럼 · 그 선만 진하게, 나머지 흐리게
    await p.evaluate(() => { const h = [...document.querySelectorAll('#vp path.edhit')].find((x, i, a) => a.length); h.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await p.waitForTimeout(200);
    const s1 = await p.evaluate(() => ({ rsel: document.querySelectorAll('#vp .tb.rsel').length, dim: document.querySelectorAll('#vp .tb.dim').length, on: document.querySelectorAll('#vp path.ed.on').length, hl: document.querySelectorAll('#vp .hlc').length, tb: document.querySelectorAll('#vp .tb').length }));
    ok(s1.rsel === 2 && s1.on === 1 && s1.hl >= 1 && s1.dim === s1.tb - 2, JSON.stringify(s1));
    // 테이블을 누르면 관계 선택이 풀리고 표 선택
    await p.evaluate(() => document.querySelector('#vp .tb').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.querySelector('#vp .tb.rsel') && !!document.querySelector('#vp .tb.sel')), '테이블 누르기로 관계 선택이 안 풀림');
    // 선을 다시 고른 뒤 빈 곳을 누르면 모두 풀린다
    await p.evaluate(() => document.querySelector('#vp path.edhit').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await p.waitForTimeout(150);
    await p.evaluate(() => { const st = document.querySelector('#stage'); const o = { bubbles: true, pointerId: 9, clientX: 5, clientY: 300, button: 0, pointerType: 'mouse' }; st.dispatchEvent(new PointerEvent('pointerdown', o)); st.dispatchEvent(new PointerEvent('pointerup', o)); });
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => !document.querySelector('#vp .tb.rsel, #vp .tb.sel, #vp .tb.dim')), '빈 곳 누르기로 안 풀림');
    return `선 고르기 · 논리 참조 ${lay.lg}`;
  });
  await check('화면설계서 뷰어 (썸네일 · 넘기기 · 내부 정보 · 근거 패널 · 발표)', async () => {
    await p.goto(`${F.url}02-screens/web.html`); await p.waitForSelector('.sb-thumb');
    const st = () => p.evaluate(() => ({ count: document.querySelector('.sb-count').textContent, thumbs: document.querySelectorAll('.sb-thumb').length, dev: document.body.classList.contains('sb-dev-on'), panel: document.body.classList.contains('sb-panel-on'), present: document.body.classList.contains('sb-present') }));
    const a = await st();
    ok(a.thumbs === await p.evaluate(() => document.querySelectorAll('.sb-main section.sheet').length), '썸네일 수');
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
    ok((await st()).count.startsWith('2 /'), '→ 로 안 넘어감');
    await p.keyboard.press('i'); await p.waitForTimeout(100);
    ok((await st()).dev !== a.dev, 'I 로 내부 정보가 안 바뀜');
    await p.keyboard.press('i');
    await p.waitForSelector('a.sb-ref');
    await p.evaluate(() => document.querySelector('a.sb-ref').click()); await p.waitForTimeout(300);
    ok((await st()).panel && await p.evaluate(() => /40-functions/.test(document.querySelector('.sb-panel-frame').src)), '근거 패널');
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(!(await st()).panel, 'Esc 로 패널이 안 닫힘');
    await p.keyboard.press('f'); await p.waitForTimeout(300);
    ok((await st()).present, '발표가 안 켜짐');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(!(await st()).present, '발표가 안 끝남');
  });
  await check('쓰기 보고서 화면 (테이블 · 행 수 · 더 보기 · 검색 · 시험 고르기 · 주소 유지)', async () => {
    const WR = path.join(KIT, 'packs', 'core', 'assets', 'write-report');
    const dir = path.join(tmp, 'write-report');
    fs.mkdirSync(dir, { recursive: true });
    const data = require(path.join(WR, 'sample', 'make-sample.js')).makeSample();
    fs.writeFileSync(path.join(dir, 'index.html'), require(path.join(WR, 'sample', 'build-sample.js')).render(fs.readFileSync(path.join(WR, 'viewer.html'), 'utf8'), data));
    const url = `file://${dir}/index.html`;
    await p.goto(url); await p.waitForSelector('html.wr-ready');
    // 기대 행 수: rows 하나 = 한 행, rows 없는 쓰기 = 한 행
    const want = (key, id) => data.tests.filter((t) => !id || t.id === id).flatMap((t) => t.writes).filter((w) => w.table === key).reduce((a, w) => a + (w.rows && w.rows.length ? w.rows.length : 1), 0);
    const big = Object.keys(data.catalog).flatMap((s) => Object.keys(data.catalog[s]).map((t) => `${s}.${t}`)).sort((a, b) => want(b) - want(a))[0];
    ok(want(big) > 600, `표본에 큰 테이블이 없음 (${big} ${want(big)})`);
    const t0 = Date.now();
    await p.click(`#tables .item[data-k="${big}"]`); await p.waitForSelector('#tb tr.r');
    const ms = Date.now() - t0;
    const nRows = () => p.evaluate(() => document.querySelectorAll('#tb tr.r').length);
    ok(await nRows() === 300, `처음 300행이 아님 (${await nRows()})`);
    const cols = await p.evaluate(() => document.querySelectorAll('#grid thead th').length);
    const [sch, tb] = big.split('.');
    ok(cols === data.catalog[sch][tb].columns.length + 5, `열 머리 ${cols} (컬럼 ${data.catalog[sch][tb].columns.length} + 5)`);
    await p.click('#moreBtn'); ok(await nRows() === 600, `더 보기 뒤 ${await nRows()}`);
    await p.click('#allBtn'); ok(await nRows() === want(big), `모두 ${await nRows()} (기대 ${want(big)})`);
    ok(!(await p.$('#moreBtn')), '다 보였는데 더 보기가 남음');
    // 머리 · 작업 열 고정: 오른쪽 끝으로 밀어도 작업 열이 왼쪽에 남는다
    await p.evaluate(() => { const g = document.querySelector('#grid'); g.scrollLeft = g.scrollWidth; g.scrollTop = 2000; });
    const fx = await p.evaluate(() => { const g = document.querySelector('#grid').getBoundingClientRect(); const a = document.querySelector('#tb tr.r td.fx1').getBoundingClientRect(); const h = document.querySelector('#grid thead th').getBoundingClientRect(); return [Math.round(a.left - g.left), Math.round(h.top - g.top)]; });
    ok(fx[0] < 80 && fx[1] <= 1, `고정 열 · 머리가 밀림 (${fx})`);
    // 행 펼치기
    await p.click('#tb tr.r >> nth=0'); ok(await p.evaluate(() => !!document.querySelector('#tb tr.det')), '행을 눌러도 안 펼쳐짐');
    // 주소 유지 (새로고침)
    ok(await p.evaluate(() => location.hash) === `#tbl=${encodeURIComponent(big)}`, `주소 ${await p.evaluate(() => location.hash)}`);
    await p.reload(); await p.waitForSelector('#tb tr.r');
    ok(await p.evaluate(() => document.querySelector('#tables .item.on').dataset.k) === big, '새로고침 뒤 테이블이 안 남음');
    // 테이블 검색 (컬럼 이름으로도) · 쓴 테이블만
    await p.fill('#q', 'avg_price'); await p.waitForTimeout(200);
    const hit = await p.evaluate(() => [...document.querySelectorAll('#tables .item')].map((x) => x.dataset.k));
    ok(hit.length >= 1 && hit.every((k) => { const [s, t] = k.split('.'); return k.includes('avg_price') || data.catalog[s][t].columns.some((c) => c.name.includes('avg_price')); }), `검색 결과 ${hit}`);
    await p.fill('#q', ''); await p.waitForTimeout(150);
    const nAll = Object.values(data.catalog).reduce((a, s) => a + Object.keys(s).length, 0);
    const w0 = await p.evaluate(() => document.querySelectorAll('#tables .item').length);
    await p.click('#onlyW');
    const w1 = await p.evaluate(() => document.querySelectorAll('#tables .item').length);
    ok(w1 === nAll && w0 < nAll, `쓴 테이블만 ${w0} → 전체 ${w1} (카탈로그 ${nAll})`);
    await p.click('#onlyW');
    // 시험 고르기 → 그 시험의 행만 · 주소에 시험
    // 22003 = 숫자 넘침: 표본의 numeric 넘침 위험 행이 이 시험에 있다
    const one = data.tests.find((t) => t.writes.some((w) => w.result && w.result.error === '22003' && w.rows));
    ok(one, '표본에 숫자 넘침(22003) 시험이 없음');
    const tk = one.writes.find((w) => w.result.error === '22003').table;
    await p.fill('#tq', one.name); await p.waitForTimeout(200);
    await p.click(`#tests .item[data-t="${one.id}"]`); await p.click(`#tables .item[data-k="${tk}"]`); await p.waitForSelector('#tb tr.r');
    ok(await nRows() === want(tk, one.id), `시험별 행 ${await nRows()} (기대 ${want(tk, one.id)})`);
    ok(await p.evaluate(() => document.querySelectorAll('#tb .err').length) > 0, '실패 표시가 없음');
    await p.reload(); await p.waitForSelector('#tb tr.r');
    ok(await p.evaluate(() => [document.querySelector('#tests .item.on').dataset.t, document.querySelector('#tables .item.on').dataset.k]).then((r) => r[0] === one.id && r[1] === tk), '새로고침 뒤 시험 · 테이블이 안 남음');
    // 위험 표시 · 다크 전환 · 데이터 없음
    const risky = await p.evaluate(() => document.querySelectorAll('#tb td.risk').length);
    ok(risky > 0, '타입 범위 위험 표시가 없음');
    // 좁은 화면: 왼쪽 패널은 서랍, 테이블을 고르면 닫힌다
    await m.goto(`${url}#tbl=${encodeURIComponent(big)}`); await m.waitForSelector('#tb tr.r');
    ok(await m.evaluate(() => document.querySelector('#side').getBoundingClientRect().right <= 0 && document.documentElement.scrollWidth <= innerWidth), '좁은 화면에서 패널이 가리거나 쪽이 넘침');
    await m.click('#menu'); await m.waitForTimeout(250);
    await m.click(`#tables .item[data-k="${tk}"]`); await m.waitForTimeout(250);
    ok(await m.evaluate(() => !document.body.classList.contains('nav-open') && document.querySelector('#side').getBoundingClientRect().right <= 0), '고른 뒤 서랍이 안 닫힘');
    await p.click('#theme'); ok(await p.evaluate(() => !!document.documentElement.dataset.theme), '테마 단추');
    await p.click('#tests .item[data-t=""]'); ok(await p.evaluate(() => !/t=/.test(location.hash)), '전체로 돌아가도 주소에 시험이 남음');
    fs.writeFileSync(path.join(dir, 'empty.html'), fs.readFileSync(path.join(WR, 'viewer.html')));
    await p.goto(`file://${dir}/empty.html`); await p.waitForSelector('.empty h3');
    ok(/보고서 데이터가 없습니다/.test(await p.textContent('.empty h3')), '데이터 없음 안내');
    return `${big} ${want(big)}행 · 첫 화면 ${ms}ms · 위험 칸 ${risky}`;
  });

  /* ── 프로젝트 사이트 (docs-site.json "project": true + 빌드 DB) ── */
  const NS = 'kedovi-site:주문 관리:';
  const pj = await page();
  await pj.context().addInitScript((ns) => { if (!sessionStorage.getItem('t-init')) { sessionStorage.setItem('t-init', '1'); localStorage.setItem(ns + 'last', JSON.stringify('2026-11-20T00:00:00+09:00')); localStorage.setItem(ns + 'me', JSON.stringify('kim')); } }, NS);
  await check('킷 문서 사이트에는 나 · 멘션 · 의견이 없음', async () => {
    await p.goto(`${G.url}index.html`);
    ok(!(await p.$('#me-btn')) && !(await p.$('#inbox-btn')) && !(await p.$('.cmt-btn')), '프로젝트 전용 단추가 보임');
  });
  await check('프로젝트: 대시보드 (빌드 DB)', async () => {
    await pj.goto(`${PJ.url}index.html`); await pj.waitForSelector('.dash .stat');
    const r = await pj.evaluate(() => ({ tabs: [...document.querySelectorAll('header .tab')].map((a) => a.textContent), stats: document.querySelectorAll('.dash .stat').length, feats: document.querySelectorAll('.dash .board .feat').length, gos: document.querySelectorAll('.dash .go').length, rowLinks: document.querySelectorAll('.dash .dl > a:not(.go)').length, cur: (document.querySelector('header .tab.on') || {}).textContent }));
    ok(r.tabs.join() === '개요,설계,기능,테스트,일정,이슈,자료실', `탭 ${r.tabs}`);
    ok(r.stats === 4 && r.feats === 4 && r.gos > 8 && r.rowLinks === 0 && r.cur === '개요', JSON.stringify(r));
    return `기능 ${r.feats} · 바로가기 ${r.gos}`;
  });
  await check('프로젝트: 기능 탭 (마일스톤 묶음 · 단계 줄 · 마일스톤 칩 · 절 이동)', async () => {
    await pj.click('header .tab:has-text("기능")'); await pj.waitForSelector('nav.side .nav-ms');
    const side = await pj.evaluate(() => ({ ms: [...document.querySelectorAll('nav.side .nav-ms span')].map((x) => x.textContent), go: document.querySelectorAll('nav.side .nav-ms .go').length, feats: document.querySelectorAll('nav.side .nav-link.feat').length }));
    ok(side.ms.join() === '1차 오픈,2차 · 정산' && side.go === 2 && side.feats === 4, JSON.stringify(side));
    await pj.click('nav.side .nav-link.feat:has-text("주문 관리")'); await pj.waitForSelector('.feat-head');
    const h = await pj.evaluate(() => ({ cur: (document.querySelector('.feat-head .step.cur') || {}).textContent, ms: (document.querySelector('.feat-head .mschip') || {}).textContent, secs: [...document.querySelectorAll('.feat-head .subtabs a')].map((a) => a.textContent) }));
    ok(h.cur === '구현' && /1차 오픈 · 12월 12일/.test(h.ms) && h.secs.join() === '명세,설계,검증', JSON.stringify(h));
  });
  await check('프로젝트: 바뀐 점 보기 (「새로」 크기 · 띠 · 합쳐 보기 · 커밋별 · 최근 바뀐 문서)', async () => {
    await pj.waitForSelector('.chgbar .chg-diff', { timeout: 5000 });
    const nb = await pj.evaluate(() => { const b = document.querySelector('nav.side .newb'); const r = b.getBoundingClientRect(); return { h: r.height, fs: parseFloat(getComputedStyle(b).fontSize), bw: parseFloat(getComputedStyle(b).borderTopWidth) || 0 }; });
    ok(nb.h <= 16 && nb.fs <= 11 && nb.bw === 0, `「새로」 가 큼 ${JSON.stringify(nb)}`);
    await pj.click('.chgbar .chg-diff'); await pj.waitForSelector('.drawer.wide .df-row', { timeout: 5000 });
    const sum = await pj.evaluate(() => ({ add: document.querySelectorAll('.drawer .df-row.add').length, del: document.querySelectorAll('.drawer .df-row.del').length, fold: document.querySelectorAll('.drawer .df-fold').length, cs: document.querySelectorAll('.drawer .df-cs .df-c').length, range: document.querySelector('.drawer .df-range').value, mark: document.querySelectorAll('.drawer .df-row mark').length, w: document.querySelector('.drawer').getBoundingClientRect().width }));
    // 지난 방문(11-20) 뒤 커밋 2: 재고 행 더함 · 「출고 전」 더함 (글자 강조) · 같은 줄은 접힘
    ok(sum.cs === 2 && sum.range === 'since' && sum.add >= 2 && sum.del >= 1 && sum.fold >= 1 && sum.mark >= 1 && sum.w > 500, `합쳐 보기 ${JSON.stringify(sum)}`);
    const n0 = await pj.evaluate(() => document.querySelectorAll('.drawer .df-row').length);
    await pj.click('.drawer .df-fold'); ok(await pj.evaluate(() => document.querySelectorAll('.drawer .df-row').length) > n0, '같은 줄 펼치기');
    await pj.click('.drawer .subtabs button:has-text("커밋별")');
    const each = await pj.evaluate(() => [...document.querySelectorAll('.drawer .df-each')].map((x) => [x.querySelector('.df-c code').textContent, x.querySelectorAll('.df-row.add').length, x.querySelectorAll('.df-row.del').length]));
    ok(each.length === 2 && each[0][0] === 'c3c3c3c' && each[1][0] === 'b2b2b2b' && each.every((e) => e[1] >= 1), `커밋별 ${JSON.stringify(each)}`);
    await pj.selectOption('.drawer .df-range', 'all');
    const all = await pj.evaluate(() => document.querySelectorAll('.drawer .df-each').length);
    ok(all === 3, `남은 기록 전체 ${all}`);
    await pj.keyboard.press('Escape'); await pj.waitForTimeout(100);
    ok(!(await pj.$('.drawer')), 'Esc 로 안 닫힘');
    // 최근 바뀐 문서: 행 끝 아이콘으로 같은 서랍
    const back = await pj.evaluate(() => location.href);
    await pj.goto(`${PJ.url}_/recent.html`); await pj.waitForSelector('.df-go');
    await pj.click('tr:has-text("주문 관리") .df-go >> nth=0'); await pj.waitForSelector('.drawer.wide .df-row');
    const none = await pj.evaluate(() => [...document.querySelectorAll('.df-go')].length);
    await pj.keyboard.press('Escape');
    await pj.click('tr:has-text("요구사항") .df-go >> nth=0'); ok(await pj.waitForSelector('.drawer.wide .kempty:has-text("이전 판이 없습니다")', { timeout: 5000 }).then(() => true, () => false), '지난 판 없는 문서 안내');
    await pj.keyboard.press('Escape');
    await pj.goto(back); await pj.waitForSelector('.chgbar');
    return `+${sum.add} −${sum.del} · 커밋별 ${each.length} · 아이콘 ${none}`;
  });
  await check('프로젝트: 지난 방문 이후 바뀐 문서 · 바뀐 줄 · 확인함', async () => {
    await pj.waitForSelector('tr.ds-chg', { timeout: 5000 }).catch(() => {});
    const a = await pj.evaluate(() => [!!document.querySelector('.chgbar'), document.querySelectorAll('tr.ds-chg').length, !!document.querySelector('nav.side .nav-link.on .newb')]);
    ok(a[0] && a[1] >= 1 && a[2], `띠 · 바뀐 줄 · 새로 ${a}`);
    await pj.click('.chgbar .chg-ok'); await pj.waitForTimeout(150);
    const b = await pj.evaluate(() => [!!document.querySelector('.chgbar'), document.querySelectorAll('tr.ds-chg').length, !!document.querySelector('nav.side .nav-link.on .newb')]);
    ok(!b[0] && b[1] === 0 && !b[2], `확인함 뒤 ${b}`);
    return `바뀐 줄 ${a[1]}`;
  });
  await check('프로젝트: ID 칩 → 관계 서랍', async () => {
    await pj.click('button.ds-def:has-text("FN-024")'); await pj.waitForSelector('.drawer .rel-chain');
    const t = await pj.evaluate(() => document.querySelector('.drawer').textContent);
    ok(/REQ-008/.test(t) && /API-ORD-05/.test(t) && /orders/.test(t) && /#41/.test(t), t.slice(0, 200));
    await pj.keyboard.press('Escape'); await pj.waitForTimeout(100);
    ok(!(await pj.$('.drawer')), 'Esc 로 안 닫힘');
  });
  await check('프로젝트: 의견 서랍 · 밑줄 · @멘션 입력', async () => {
    ok(await pj.evaluate(() => document.querySelector('.cmt-btn').textContent.trim()) === '2', '의견 수');
    ok(await pj.evaluate(() => !!document.querySelector('.ds-body mark.cmark')), '의견 있는 글자 밑줄');
    await pj.click('.cmt-btn'); await pj.waitForSelector('.drawer .cm');
    ok(await pj.evaluate(() => document.querySelectorAll('.drawer .cm').length) === 2, '의견 2개');
    await pj.click('.drawer textarea'); await pj.keyboard.type('확인 부탁 @l');
    await pj.waitForSelector('.drawer .atlist .at-opt');
    ok(await pj.evaluate(() => [...document.querySelectorAll('.atlist .at-opt b')].map((b) => b.textContent).join()) === '@lee', '멘션 목록 거르기');
    await pj.keyboard.press('Enter');
    ok(/@lee $/.test(await pj.evaluate(() => document.querySelector('.drawer textarea').value)), '멘션 넣기');
    ok(/GitLab 에서 쓰기/.test(await pj.evaluate(() => document.querySelector('.drawer .cbox .abtn.pri').textContent)), '토큰 없는 정적 사이트 = 원격 화면으로');
    await pj.click('.drawer .rel-x');
  });
  await check('프로젝트: 글자를 골라 「의견 달기」', async () => {
    await pj.evaluate(() => {
      const td = [...document.querySelectorAll('.ds-body td')].find((x) => /송장 번호 입력/.test(x.textContent));
      const r = document.createRange(); r.selectNodeContents(td); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      td.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await pj.waitForSelector('.selbtn'); await pj.click('.selbtn');
    await pj.waitForSelector('.drawer .cbox .cq');
    ok(/송장 번호 입력/.test(await pj.evaluate(() => document.querySelector('.drawer .cbox .cq').textContent)), '고른 글자가 인용으로');
    await pj.click('.drawer .rel-x');
  });
  await check('프로젝트: 멘션 알림함', async () => {
    ok(await pj.evaluate(() => (document.querySelector('#inbox-n') || {}).textContent) === '2', '안 읽은 멘션 수');
    await pj.click('#inbox-btn'); await pj.waitForSelector('.inbox .ib-i');
    ok(await pj.evaluate(() => document.querySelectorAll('.inbox .ib-i.new').length) === 2, '알림함 목록');
    await pj.click('.inbox .lbtn:has-text("모두 읽음")'); await pj.waitForTimeout(100);
    ok(!(await pj.$('#inbox-n')), '모두 읽음 뒤에도 수가 남음');
    await pj.keyboard.press('Escape');
  });
  await check('프로젝트: 검색 창 (종류 칩 · 탭 › 기능 › 문서)', async () => {
    await pj.click('#search-btn'); await pj.waitForSelector('.sp-veil #q');
    await pj.keyboard.type('FN-024'); await pj.waitForTimeout(150);
    const r = await pj.evaluate(() => { const it = document.querySelector('#results .sp-item'); return { id: it && it.querySelector('.idc') && it.querySelector('.idc').textContent, c: it && it.querySelector('.c').textContent, chips: [...document.querySelectorAll('.chips .chip')].map((c) => c.textContent) }; });
    ok(r.id === 'FN-024' && /^명세기능 › 003 주문 관리 › 명세$/.test(r.c) && r.chips.includes('API') && r.chips.includes('이슈'), JSON.stringify(r));
    await pj.keyboard.press('Enter'); await pj.waitForFunction(() => /003/.test(decodeURIComponent(location.pathname)) && location.hash === '#FN-024');
  });
  await check('프로젝트: 나 공간 · 즐겨찾기 · 메모', async () => {
    await pj.click('.star-btn'); await pj.click('.memo-btn'); await pj.fill('.memo textarea', '취소 사유 목록 다시 보기'); await pj.click('.memo .abtn.pri');
    await pj.click('#me-btn'); await pj.waitForFunction(() => /_\/me\.html/.test(location.pathname));
    ok(await pj.evaluate(() => (document.querySelector('#me-btn') || {}).getAttribute('aria-current') === 'true' && !document.querySelector('header .tab.on') && /kim/.test(document.querySelector('.prof h1').textContent)), '나 표시');
    const me = await pj.evaluate(() => window.DS_NAV.me.map((x) => x.p));
    const out = [];
    for (const u of me) {
      await pj.goto(`${PJ.url}${u}`); await pj.waitForSelector('.view h1');
      const bad = await pj.evaluate(() => /이 판의 사이트에 없습니다|읽지 못했습니다/.test(document.querySelector('main').textContent));
      ok(!bad, `${u} 가 안 그려짐`);
      out.push(await pj.evaluate(() => document.querySelector('.view h1').textContent));
    }
    await pj.goto(`${PJ.url}_/me/saved.html`); await pj.waitForSelector('.view h1');
    ok(/003 주문 관리/.test(await pj.evaluate(() => document.querySelector('.dcard').textContent)), '즐겨찾기에 없음');
    await pj.goto(`${PJ.url}_/me/memos.html`); await pj.waitForSelector('.view h1');
    ok(/취소 사유 목록 다시 보기/.test(await pj.evaluate(() => document.querySelector('main').textContent)), '메모가 없음');
    await pj.goto(`${PJ.url}_/me/settings.html`); await pj.waitForSelector('.kv.conn');
    ok(/정적 사이트/.test(await pj.evaluate(() => document.querySelector('.kv.conn').textContent)), '연결 상태');
    return out.join(' · ');
  });
  await check('프로젝트: 가상 화면 전부 (빈 상태 포함) · 간트 · API', async () => {
    const pages = await pj.evaluate(() => { const o = []; const w = (xs) => xs.forEach((x) => { if (x.items) w(x.items); else if (x.v) o.push(x.p); }); window.DS_NAV.groups.forEach((g) => w(g.items)); return o; });
    for (const u of pages) {
      await pj.goto(`${PJ.url}${u}`); await pj.waitForSelector('.view h1');
      ok(!(await pj.evaluate(() => /이 판의 사이트에 없습니다|읽지 못했습니다/.test(document.querySelector('main').textContent))), `${u} 가 안 그려짐`);
    }
    await pj.goto(`${PJ.url}_/gantt.html`); await pj.waitForSelector('.gantt-box svg .bar-wrapper', { timeout: 15000 });
    await pj.goto(`${PJ.url}_/api.html`); await pj.waitForSelector('.vframe.api iframe');
    await pj.goto(`${PJ.url}_/table.html?id=orders`); await pj.waitForSelector('.tbl-sec table');
    await pj.goto(`${PJ.url}_/board/post.html?id=${encodeURIComponent('#60')}`); await pj.waitForSelector('.post-body');
    return `${pages.length}쪽`;
  });
  await check('프로젝트: 일정 › 백로그 (PLAN.md 백로그 · 추가한 날)', async () => {
    await pj.goto(`${PJ.url}_/backlog.html`); await pj.waitForSelector('.view h1');
    const t = await pj.evaluate(() => document.querySelector('main').textContent);
    ok(/엑셀로 주문 내보내기/.test(t) && /11-20/.test(t) && /정산서 메일 발송/.test(t), t.slice(0, 160));
    ok(await pj.evaluate(() => [...document.querySelectorAll('nav.side a')].some((a) => /백로그/.test(a.textContent))), '일정 사이드에 백로그 없음');
  });
  await check('프로젝트: 빈 DB 상태 화면 (흔적 없이)', async () => {
    const empty = { version: 2, layout: 'workspace', title: '빈 프로젝트', project: { title: '빈 프로젝트' }, stages: ['명세', '설계', '구현', '검증', '배포'], features: [], milestones: [], docs: [], ids: {}, relations: {}, changes: [], team: { members: [] }, issues: { items: [] }, workItems: [], board: [], files: [], comments: {}, remote: { kind: null }, apis: [] };
    const e = await page();
    await e.route('**/assets/site-db.json*', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(empty) }));
    for (const u of ['index.html', '_/gantt.html', '_/issues.html', '_/board.html', '_/api.html', '_/team.html', '_/backlog.html']) {
      await e.goto(`${PJ.url}${u}`); await e.waitForSelector('.view h1');
      const t = await e.evaluate(() => document.querySelector('main').textContent);
      ok(!/undefined|null|NaN|숨김|숨겼|뺐/.test(t), `${u}: ${t.slice(0, 120)}`);
      ok(await e.evaluate(() => document.querySelectorAll('.kempty, .vnote').length) > 0, `${u} 빈 상태 화면 없음`);
    }
    await e.close();
  });

  /* ── 프로필 (유형 · 분야): 빌드 DB profile · metrics · interfaces · 기능 tiers/hw/risks/ifs/bal (시험 재료 bin/fixtures/profiles.js) ── */
  await check('프로필 없음: 지금 화면 그대로 (중심 점 · 검증 단계 줄 · 유형 칸 없음 · API 명세)', async () => {
    await pj.goto(`${PJ.url}index.html`); await pj.waitForSelector('.dash .stat');
    ok(await pj.evaluate(() => !document.querySelector('.main-dot') && !document.querySelector('.tier-card') && !document.querySelector('.stat.none')), '프로필 화면 요소가 보임');
    await pj.goto(`${PJ.url}_/api.html`); await pj.waitForSelector('.view h1');
    ok(await pj.evaluate(() => document.querySelector('.view h1').textContent === 'API 명세' && [...document.querySelectorAll('nav.side .nav-t')].some((x) => x.textContent === 'API')), 'API 명세 이름이 바뀜');
    await pj.goto(`${PJ.url}_/team.html`); await pj.waitForSelector('.view h1');
    ok(!/유형 · 분야/.test(await pj.evaluate(() => document.querySelector('main').textContent)), '유형 · 분야 칸이 보임');
    await p.goto(`${G.url}index.html`);
    ok(!(await p.$('.main-dot')), '킷 문서 사이트에 중심 점');
  });
  await check('프로필 운영 · 유지보수: 탭 이름 「개선」 · 중심 탭 점 · 숫자 칸 (빈 값 안내) · 검증 단계 줄', async () => {
    const e = await page();
    await e.goto(`${EN.url}index.html`); await e.waitForSelector('.dash .stat');
    const r = await e.evaluate(() => ({
      tabs: [...document.querySelectorAll('header .tab')].map((a) => a.textContent),
      dots: [...document.querySelectorAll('header .tab .main-dot')].map((d) => d.closest('.tab').dataset.group),
      labels: [...document.querySelectorAll('.dash .stat .sl')].map((x) => x.textContent),
      vals: [...document.querySelectorAll('.dash .stat .sv')].map((x) => x.textContent),
      none: document.querySelectorAll('.dash .stat.none').length,
      steps: [...document.querySelectorAll('.tier-track .step')].map((x) => x.className.replace('step ', '')),
      text: document.querySelector('main').textContent,
    }));
    ok(r.tabs.join() === '개요,설계,개선,테스트,일정,이슈,자료실', `탭 ${r.tabs}`);
    ok(r.dots.join() === '이슈', `중심 점 ${r.dots}`);
    ok(r.labels.join() === '열린 결함,평균 처리 시간,이번 주 운영 반영,처리 기한 넘김', `칸 ${r.labels}`);
    ok(r.vals[0] === '3' && r.vals[1] === '2.5일' && r.vals[2] === '아직 없음' && r.none === 2, `값 ${r.vals}`);
    ok(!/undefined|null|NaN|숨김|숨겼|뺐/.test(r.text), r.text.slice(0, 160));
    ok(r.steps.join() === 'done,cur,wait', `검증 단계 ${r.steps}`);
    await e.click('header .tab[data-group="기능"]'); await e.waitForSelector('nav.side .nav-ms');
    ok(await e.evaluate(() => document.querySelector('nav.side .side-head-title').textContent === '개선' && /^개선/.test(document.querySelector('.crumb').textContent)), '메뉴 머리 · 위치 이름');
    await e.close();
    return r.vals.join(' · ');
  });
  await check('프로필 게임: 기능 화면 밸런스 표 칩 · 표로 가기 · 관계 서랍', async () => {
    const e = await page();
    await e.route('**/assets/site-db.json*', (q) => q.fulfill({ contentType: 'application/json', body: JSON.stringify(PF.game()) }));
    await e.goto(`${PJ.url}${encodeURI('기능/002-상품관리.html')}`); await e.waitForSelector('.feat-links .fl-bal');
    const r = await e.evaluate(() => ({ ids: [...document.querySelectorAll('.fl-bal .idc')].map((x) => x.textContent), go: [...document.querySelectorAll('.fl-bal .go')].map((a) => decodeURIComponent(a.getAttribute('href'))), hw: !!document.querySelector('.fl-hw'), tiers: document.querySelectorAll('.ds-tiers tbody tr').length }));
    ok(r.ids.join() === 'BAL-001,BAL-002' && r.go.length === 2 && /설계\/밸런스\/README\.html#BAL-001$/.test(r.go[0]) && !r.hw, JSON.stringify(r));
    ok(r.tiers === 3, `검증 표 줄 ${r.tiers}`);
    await e.click('.fl-bal .idc:has-text("BAL-001")'); await e.waitForSelector('.drawer .rel-chain');
    const t = await e.evaluate(() => [...document.querySelectorAll('.drawer .rel-row')].map((x) => x.textContent).join('|'));
    ok(/밸런스 표BAL-001/.test(t) && /FN-010/.test(t) && !/보드 판/.test(t), t.slice(0, 200));
    await e.close();
  });
  await check('프로필 장치: 보드 판 · 위험 · 인터페이스 칩 · 검증 단계 표 · 대시보드 단계 줄', async () => {
    const e = await page();
    await e.route('**/assets/site-db.json*', (q) => q.fulfill({ contentType: 'application/json', body: JSON.stringify(PF.device()) }));
    await e.goto(`${PJ.url}${encodeURI('기능/003-주문관리.html')}`); await e.waitForSelector('.feat-links .fl-hw');
    await e.waitForSelector('.ds-tiers tbody tr');
    const r = await e.evaluate(() => ({
      hw: [...document.querySelectorAll('.fl-hw .idc')].map((x) => x.textContent), risks: [...document.querySelectorAll('.fl-risks .idc')].map((x) => x.textContent), ifs: [...document.querySelectorAll('.fl-ifs .idc')].map((x) => x.textContent),
      rows: [...document.querySelectorAll('.ds-tiers tbody tr')].map((tr) => tr.cells[0].textContent + '=' + tr.cells[1].querySelector('.state').className.replace('state ', '')),
      after: (() => { const h = [...document.querySelectorAll('.ds-body h2')].find((x) => /^검증/.test(x.textContent)); return !!h && h.nextElementSibling.classList.contains('ds-tiers-cap'); })(),
    }));
    ok(r.hw.join() === 'HW-B2' && r.risks.join() === 'HAZ-003,RC-003-1' && r.ifs.join() === 'IF-BLE-01', JSON.stringify(r));
    ok(r.rows.length === 4 && /=done$/.test(r.rows[0]) && /=bad$/.test(r.rows[2]) && /^HIL .*=wait$/.test(r.rows[3]) && r.after, JSON.stringify(r.rows));
    await e.click('.fl-hw .idc'); await e.waitForSelector('.drawer .rel-chain');
    const t = await e.evaluate(() => document.querySelector('.drawer').textContent);
    ok(/보드 판HW-B2/.test(t) && /위험 · 대책HAZ-003RC-003-1/.test(t) && /인터페이스IF-BLE-01/.test(t) && /메인 보드 B2/.test(t), t.slice(0, 240));
    await e.keyboard.press('Escape');
    await e.goto(`${PJ.url}index.html`); await e.waitForSelector('.tier-track .step');
    const d = await e.evaluate(() => ({ steps: [...document.querySelectorAll('.tier-track .step')].map((x) => x.className.replace('step ', '')), vals: [...document.querySelectorAll('.dash .stat .sv')].map((x) => x.textContent), dot: [...document.querySelectorAll('header .tab .main-dot')].map((x) => x.closest('.tab').dataset.group) }));
    ok(d.steps.join() === 'done,cur,bad,cur' && d.vals[0] === '18일' && !/아직 없음/.test(d.vals[3]) && d.dot.join() === '기능', JSON.stringify(d));
    await e.goto(`${PJ.url}_/team.html`); await e.waitForSelector('.view h1');
    const tm = await e.evaluate(() => document.querySelector('.kv').textContent);
    ok(/유형신규 구축/.test(tm) && /분야웨어러블 · 장치/.test(tm) && /사람 관문하드웨어 기동/.test(tm) && /에이전트 도구 추천Nordic nRF Connect MCP/.test(tm) && /진행 방식기능 단위/.test(tm), tm.slice(0, 200));
    await e.close();
    return d.steps.join(' ');
  });
  await check('프로필 인터페이스 명세: AsyncAPI 표 · YAML 파일 링크 · OpenAPI 는 Scalar · 옛 주소 그대로', async () => {
    const e = await page();
    await e.route('**/assets/site-db.json*', (q) => q.fulfill({ contentType: 'application/json', body: JSON.stringify(PF.device()) }));
    await e.goto(`${PJ.url}_/api.html`); await e.waitForSelector('.view table');
    const r = await e.evaluate(() => ({ h1: document.querySelector('.view h1').textContent, nav: [...document.querySelectorAll('nav.side .nav-link.on .nav-t')].map((x) => x.textContent), crumb: document.querySelector('.vcrumb').textContent, chips: [...document.querySelectorAll('.view .vchip')].map((x) => x.textContent), rows: [...document.querySelectorAll('.view table tbody tr')].map((tr) => tr.textContent) }));
    ok(r.h1 === '인터페이스 명세' && r.nav.join() === '인터페이스 명세' && r.crumb === '설계 › 인터페이스 명세', JSON.stringify(r));
    ok(r.chips.join() === 'band-fw · AsyncAPI,band-gw · AsyncAPI,order-api · OpenAPI', `칩 ${r.chips}`);
    ok(r.rows.length === 3 && /band\/\{id\}\/sleep보냄SleepSamplets/.test(r.rows[0]) && /받음SetAlarm/.test(r.rows[2]), JSON.stringify(r.rows));
    await e.click('.view .vchip:has-text("band-gw")'); await e.waitForSelector('.view .kempty a');
    ok(/band-gw\.yaml$/.test(await e.evaluate(() => document.querySelector('.view .kempty a').getAttribute('href'))), 'YAML 파일 링크');
    await e.click('.view .vchip:has-text("order-api")'); await e.waitForSelector('.vframe.api iframe');
    await e.close();
  });
  await check('프로젝트: 로컬 서버 쓰기 경로 (/_api/whoami · /_api/comment)', async () => {
    const l = await page();
    let sent = null;
    await l.route('**/_api/whoami', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, me: { id: 'lee', name: '이서연' }, remote: null, canWrite: true, where: 'local' }) }));
    await l.route('**/_api/comment', (r) => { sent = JSON.parse(r.request().postData()); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, where: 'local' }) }); });
    await l.goto(`${PJ.url}${encodeURI('기능/003-주문관리.html')}`); await l.waitForSelector('.cmt-btn');
    await l.waitForFunction(() => /lee/.test(document.querySelector('#me-btn').textContent));
    await l.click('.cmt-btn'); await l.waitForSelector('.drawer textarea');
    await l.fill('.drawer textarea', '@kim 확인했습니다');
    await l.click('.drawer .cbox .abtn.pri'); await l.waitForSelector('.drawer .cm.pend');
    ok(sent && sent.page === '기능/003-주문관리.html' && sent.text === '@kim 확인했습니다', JSON.stringify(sent));
    ok(await l.evaluate(() => document.querySelector('.cmt-btn').textContent.trim()) === '3', '보낸 의견이 수에 안 더해짐');
    await l.close();
  });
  await check('스크립트 오류 없음', async () => { ok(!errors.length, errors.slice(0, 3).join(' | ')); });

  await browser.close(); G.close(); F.close(); PJ.close(); EN.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = results.filter((r) => !r[0]).length;
  console.log(bad ? `\n✖ ${bad}개 실패 (${results.length}개 중)` : `\n✔ 전부 통과 (${results.length}개)`);
  process.exit(bad ? 1 : 0);
})();
