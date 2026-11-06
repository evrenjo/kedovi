/**
 * 작은 YAML 읽기 (외부 API 동작 장부용). Node 기본 모듈만 · 의존성 없음.
 * kedovi apiledger 와, repo 에 복사되는 Node 스텁(test/api-ledger/yaml-lite.cjs)이 같은 파일을 쓴다.
 *
 * 되는 것: 블록 맵 · 블록 목록(- 항목, - 키: 값) · 흐름 { } [ ] · 따옴표 문자열 · 숫자 · true/false · null/~ ·
 *          블록 글 | |- > >- · 주석(#). 안 되는 것: 앵커(&, *) · 태그(!!) · 여러 문서(---) · 복합 키.
 * 틀린 줄은 Error(줄 번호 포함)로 던진다.
 */
'use strict';

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).replace(/\s+$/, '');
  }
  return line.replace(/\s+$/, '');
}

function scalar(raw, ln) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (s[0] === '"' || s[0] === "'" || s[0] === '{' || s[0] === '[') {
    const r = flow(s, 0, ln);
    if (s.slice(r.end).trim()) throw new Error(`${ln}행: 값 뒤에 남은 글자 "${s.slice(r.end).trim()}"`);
    return r.value;
  }
  if (/^[-+]?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  return s;
}

/** 흐름 값 하나를 읽는다 (따옴표 · { } · [ ] · 일반 글). 반환 { value, end } */
function flow(s, i, ln) {
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  ws();
  const c = s[i];
  if (c === '"') {
    let out = '';
    for (i++; i < s.length; i++) {
      if (s[i] === '\\') {
        const n = s[++i];
        const map = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0' };
        if (n === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; } else out += map[n] != null ? map[n] : n;
      } else if (s[i] === '"') return { value: out, end: i + 1 };
      else out += s[i];
    }
    throw new Error(`${ln}행: 닫는 " 가 없습니다`);
  }
  if (c === "'") {
    let out = '';
    for (i++; i < s.length; i++) {
      if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i++; } else return { value: out, end: i + 1 }; } else out += s[i];
    }
    throw new Error(`${ln}행: 닫는 ' 가 없습니다`);
  }
  if (c === '[') {
    const arr = [];
    i++; ws();
    if (s[i] === ']') return { value: arr, end: i + 1 };
    for (;;) {
      const r = flow(s, i, ln); arr.push(r.value); i = r.end; ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === ']') return { value: arr, end: i + 1 }; continue; }
      if (s[i] === ']') return { value: arr, end: i + 1 };
      throw new Error(`${ln}행: [ ] 목록이 닫히지 않았습니다`);
    }
  }
  if (c === '{') {
    const obj = {};
    i++; ws();
    if (s[i] === '}') return { value: obj, end: i + 1 };
    for (;;) {
      const k = flowKey(s, i, ln); i = k.end; ws();
      if (s[i] !== ':') throw new Error(`${ln}행: { } 안 "${k.value}" 뒤에 : 가 없습니다`);
      i++;
      const r = flow(s, i, ln); obj[k.value] = r.value; i = r.end; ws();
      if (s[i] === ',') { i++; ws(); if (s[i] === '}') return { value: obj, end: i + 1 }; continue; }
      if (s[i] === '}') return { value: obj, end: i + 1 };
      throw new Error(`${ln}행: { } 맵이 닫히지 않았습니다`);
    }
  }
  // 일반 글: , ] } 앞까지 (흐름 안) 또는 끝까지
  let j = i;
  while (j < s.length && !',]}'.includes(s[j])) j++;
  return { value: scalar(s.slice(i, j), ln), end: j };
}

function flowKey(s, i, ln) {
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] === '"' || s[i] === "'") return flow(s, i, ln);
  let j = i;
  while (j < s.length && s[j] !== ':' && s[j] !== ',' && s[j] !== '}') j++;
  return { value: s.slice(i, j).trim(), end: j };
}

/** "키: 값" 나누기 (키는 따옴표 가능). 맵 줄이 아니면 null */
function splitKey(text) {
  let m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(\s+|$)(.*)$/.exec(text);
  if (m) return { key: scalar(m[1], 0), rest: m[3] };
  m = /^([^\s"'{[\]#,&*!|>-][^:#]*?|-[^\s:][^:#]*?)\s*:(\s+|$)(.*)$/.exec(text);
  if (m) return { key: m[1].trim(), rest: m[3] };
  return null;
}

function parse(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map((raw, idx) => ({ raw, ln: idx + 1 }));
  const items = [];
  for (const l of lines) {
    if (/^\s*---\s*$/.test(l.raw) && !items.length) continue;
    if (/\t/.test(l.raw.match(/^\s*/)[0])) throw new Error(`${l.ln}행: 들여쓰기에 탭을 쓸 수 없습니다`);
    items.push({ ...l, indent: l.raw.match(/^ */)[0].length, text: stripComment(l.raw).trim() });
  }
  let p = 0;
  const skip = () => { while (p < items.length && !items[p].text) p++; };

  /** 블록 글 (| >) : 다음 줄들 중 parentIndent 보다 깊은 것 */
  function blockText(mode, parentIndent) {
    const out = [];
    let ind = null;
    while (p < items.length) {
      const it = items[p];
      if (it.raw.trim() === '') { out.push(''); p++; continue; }
      if (it.indent <= parentIndent) break;
      if (ind == null) ind = it.indent;
      out.push(it.raw.slice(ind));
      p++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    const keep = !/-$/.test(mode);
    const body = /^>/.test(mode) ? out.join('\n').replace(/([^\n])\n(?!\n)/g, '$1 ') : out.join('\n');
    return body + (keep && out.length ? '\n' : '');
  }

  /** 값 자리: 같은 줄 rest 가 비면 다음 줄 블록 */
  function valueAfter(rest, parentIndent, ln) {
    const r = rest.trim();
    if (/^[|>][-+]?$/.test(r)) return blockText(r, parentIndent);
    if (r !== '') return scalar(r, ln);
    skip();
    if (p >= items.length || items[p].indent <= parentIndent) {
      // "키:" 다음 줄에 같은 들여쓰기의 "- " 목록이 오는 것도 YAML 이 허용한다
      if (p < items.length && items[p].indent === parentIndent && /^-(\s|$)/.test(items[p].text)) return block(parentIndent);
      return null;
    }
    return block(items[p].indent);
  }

  function block(indent) {
    skip();
    const first = items[p];
    if (/^-(\s|$)/.test(first.text)) {
      const arr = [];
      while (p < items.length) {
        skip();
        if (p >= items.length) break;
        const it = items[p];
        if (it.indent < indent) break;
        if (it.indent > indent) throw new Error(`${it.ln}행: 들여쓰기가 맞지 않습니다`);
        if (!/^-(\s|$)/.test(it.text)) break;
        const rest = it.text.replace(/^-\s*/, '');
        p++;
        if (rest === '') { arr.push(valueAfter('', indent, it.ln)); continue; }
        const kv = splitKey(rest);
        if (kv && !/^[{["']/.test(rest)) {
          // "- 키: 값" 다음 줄들은 대시 뒤 칸에 맞춘 맵
          const inner = indent + (it.text.length - rest.length);
          const obj = {};
          obj[kv.key] = valueAfter(kv.rest, inner, it.ln);
          skip();
          if (p < items.length && items[p].indent === inner && !/^-(\s|$)/.test(items[p].text)) Object.assign(obj, mapAt(inner));
          else if (p < items.length && items[p].indent === inner && /^-(\s|$)/.test(items[p].text) && obj[kv.key] == null) obj[kv.key] = block(inner);
          if (p < items.length && items[p].indent > indent && items[p].indent !== inner && items[p].text) throw new Error(`${items[p].ln}행: 들여쓰기가 맞지 않습니다`);
          arr.push(obj);
        } else if (/^[|>][-+]?$/.test(rest)) arr.push(blockText(rest, indent));
        else arr.push(scalar(rest, it.ln));
      }
      return arr;
    }
    return mapAt(indent);
  }

  function mapAt(indent) {
    const obj = {};
    while (p < items.length) {
      skip();
      if (p >= items.length) break;
      const it = items[p];
      if (it.indent < indent) break;
      if (it.indent > indent) throw new Error(`${it.ln}행: 들여쓰기가 맞지 않습니다`);
      if (/^-(\s|$)/.test(it.text)) break;
      const kv = splitKey(it.text);
      if (!kv) throw new Error(`${it.ln}행: "키: 값" 형식이 아닙니다: ${it.text}`);
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) throw new Error(`${it.ln}행: 키 "${kv.key}" 가 겹칩니다`);
      p++;
      obj[kv.key] = valueAfter(kv.rest, indent, it.ln);
    }
    return obj;
  }

  skip();
  if (p >= items.length) return null;
  const top = items[p];
  if (!/^-(\s|$)/.test(top.text) && !splitKey(top.text)) {
    const v = scalar(top.text, top.ln); p++; skip();
    if (p < items.length) throw new Error(`${items[p].ln}행: 문서 끝 뒤에 남은 줄`);
    return v;
  }
  const v = block(top.indent);
  skip();
  if (p < items.length) throw new Error(`${items[p].ln}행: 들여쓰기가 맞지 않습니다`);
  return v;
}

module.exports = { parse };
