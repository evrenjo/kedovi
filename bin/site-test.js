#!/usr/bin/env node
/**
 * 문서 사이트 앱 브라우저 시험 (킷 개발용, `npm run test:site`). `npm test` 는 화면을 보지 않으므로 화면을 고치면 이것을 돌린다.
 *
 * 임시 폴더에 킷 가이드와 시험 기획 repo(화면설계서 · 데이터 설계 포함) 사이트를 만들고, 이 PC 의 Chrome 을 화면 없이 띄워 본다.
 * 브라우저: 설치된 Google Chrome (channel chrome). 다른 Chromium 은 KEDOVI_CHROME=<실행 파일 경로>.
 * 보는 것: 새로고침 없는 이동 · 뒤로 가기 · 같은 쪽 다시 누름 · 본문 검색 · 그림 · 확대 · 테마 · 목차 · 전체 인쇄 · 좁은 화면 서랍 ·
 *          file:// · 필기(마우스 · 손가락 · 두 손가락 이동 · 펜 · 지우개 끌기 · 쪽마다 저장) · 근거 패널(iframe) ·
 *          ERD 뷰어(영역 개요 · 표 · 상세 · 검색 · 확대 · 스키마 · 내보내기) · 화면설계서 뷰어(썸네일 · 넘기기 · 내부 정보 · 근거 패널 · 발표) ·
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
  const G = await serve(guide), F = await serve(plans);
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
  await check('뒤로 가기', async () => {
    await p.goBack(); await p.waitForFunction(() => /index\.html$/.test(location.pathname));
    const s = await st(); ok(s.mark === 1 && s.on === '소개', JSON.stringify(s));
  });
  await check('긴 쪽 → 짧은 쪽: 아래에 빈 공간이 남지 않음', async () => {
    await p.goto(`${G.url}docs/docs-site.html`); await p.waitForTimeout(300);
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
  await check('본문 검색', async () => {
    await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(100);
    const y0 = await p.evaluate(() => scrollY);
    await p.click('#q'); await p.keyboard.type('프로필'); await p.keyboard.press('Backspace'); await p.keyboard.type('필');
    ok(await p.evaluate(() => scrollY) === y0, `글자를 칠 때 화면이 움직임 (${y0} → ${await p.evaluate(() => scrollY)})`);
    await p.waitForFunction(() => [...document.querySelectorAll('#results .kind')].some((k) => k.textContent === '본문'));
    const n = await p.evaluate(() => [...document.querySelectorAll('#results .kind')].filter((k) => k.textContent === '본문').length);
    await p.keyboard.press('Escape');
    return `본문 결과 ${n}`;
  });
  await check('그림 · 확대 · 테마', async () => {
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
    await p.click('nav.side a.nav-link:has-text("빠른 시작")'); await p.waitForFunction(() => /quickstart/.test(location.pathname));
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
    ok(await m.evaluate(() => document.body.classList.contains('nav-open') && !!document.querySelector('nav.side .search input')), '서랍 · 검색창');
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
    await p.goto(`${F.url}index.html`); await p.waitForSelector('.nav-act');
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
  await check('스크립트 오류 없음', async () => { ok(!errors.length, errors.slice(0, 3).join(' | ')); });

  await browser.close(); G.close(); F.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  const bad = results.filter((r) => !r[0]).length;
  console.log(bad ? `\n✖ ${bad}개 실패 (${results.length}개 중)` : `\n✔ 전부 통과 (${results.length}개)`);
  process.exit(bad ? 1 : 0);
})();
