#!/usr/bin/env node
/**
 * 쓰기 보고서 화면 표본 만들기 (킷 개발용).
 * make-sample.js 의 데이터(또는 준 index.json)를 viewer.html 의 데이터 자리에 넣어 <출력 폴더>/index.html 한 파일을 만들고,
 * 같은 데이터를 <출력 폴더>/sample.json 으로도 쓴다 (viewer.html?data=sample.json 개발용).
 * 기록기(Java · Python · Node)가 하는 자리 바꾸기와 같은 규칙이다 (FORMAT.md 「화면 만들기」).
 *
 *   node build-sample.js [출력 폴더] [index.json]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARK = '/*__WRITE_REPORT_DATA__*/null';

/** viewer.html 내용 + 색인 데이터(객체 또는 JSON 문자열) → index.html 내용 */
function render(viewer, data) {
  const parts = viewer.split(MARK);
  if (parts.length !== 2) throw new Error(`viewer.html 에 데이터 자리가 ${parts.length - 1}개 (1개여야 함)`);
  const json = (typeof data === 'string' ? JSON.stringify(JSON.parse(data)) : JSON.stringify(data))
    .replace(/<\//g, '<\\/');
  // String.replace 의 치환 문자열은 $& 같은 패턴을 해석하므로 split · join 으로 붙인다
  return parts[0] + json + parts[1];
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'write-report-sample'));
  const data = process.argv[3] ? JSON.parse(fs.readFileSync(path.resolve(process.argv[3]), 'utf8')) : require('./make-sample').makeSample();
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'viewer.html'), 'utf8');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), render(viewer, data));
  fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(out, 'viewer.html'), viewer);
  console.log(path.join(out, 'index.html'));
}

module.exports = { render, MARK };
