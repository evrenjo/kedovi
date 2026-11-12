// trace.js · Recorder.java 점검: 찾기 함수(패키지 · 클래스 · 모듈 · Spring Boot 버전) + JDK 가 있으면 작은 Java 프로그램을 실제로 기록. 실행: node trace.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const T = require('./trace');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-trace-'));
const put = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

// ── 찾기 ──
put('settings.gradle', "include 'app'\n");
put('build.gradle', "plugins { id 'org.springframework.boot' version '3.5.5' }\n");
put('app/build.gradle', '');
const svc = put('app/src/main/java/com/acme/shop/order/OrderService.java', 'package com.acme.shop.order;\nclass OrderService {}\n');
put('app/src/main/java/com/acme/shop/web/OrderController.java', 'package com.acme.shop.web;\nclass OrderController {}\n');
const testFile = put('app/src/test/java/com/acme/shop/OrderTraceTest.java', 'package com.acme.shop;\nclass OrderTraceTest {}\n');
put('app/build/generated/Ignored.java', 'package gen;\n');
assert.strictEqual(T.buildTool(tmp), 'gradle');
assert.deepStrictEqual(T.basePackages(tmp), ['com.acme.shop'], '소스 공통 패키지');
assert.ok(!T.sourceFiles(tmp).some((f) => f.includes(`${path.sep}build${path.sep}`)), '빌드 결과 폴더 제외');
assert.deepStrictEqual(T.findClass(tmp, 'OrderTraceTest'), { fqcn: 'com.acme.shop.OrderTraceTest', file: testFile });
assert.strictEqual(T.findClass(tmp, 'com.other.OrderTraceTest'), null, '패키지가 다르면 없음');
assert.strictEqual(T.gradleProject(tmp, testFile), ':app', '하위 프로젝트');
assert.strictEqual(T.gradleProject(tmp, path.join(tmp, 'Root.java')), '');
assert.strictEqual(T.bootMajor(tmp), 3);
assert.match(T.sqlStarter(3), /datasource-proxy-spring-boot-starter:1\.12\./);
assert.match(T.sqlStarter(4), /:2\./);
assert.match(T.sqlStarter(2), /:1\.8\./);
const mapped = T.mapSources(tmp, { steps: [{ src: 'com/acme/shop/order/OrderService.java' }, { src: 'x/Missing.java' }] });
assert.deepStrictEqual(Object.keys(mapped), ['com/acme/shop/order/OrderService.java']);
assert.strictEqual(mapped['com/acme/shop/order/OrderService.java'].path, path.relative(tmp, svc).split(path.sep).join('/'));
fs.writeFileSync(path.join(tmp, 'pom.xml'), '<parent><artifactId>spring-boot-starter-parent</artifactId>\n<version>2.7.18</version></parent>');
fs.rmSync(path.join(tmp, 'build.gradle'));
assert.strictEqual(T.bootMajor(tmp), 2, 'Maven 부모 버전');
assert.deepStrictEqual(T.summary({ steps: [{ k: 'line', call: true }, { k: 'line' }, { k: 'sql', x: { qs: [{}, {}] } }, { k: 'ex' }] }), { calls: 1, lines: 2, sql: 2, ex: 1 });
assert.match(T.urlOf('/w', 8700, '/w/.agents/traces/2026-01-02/0930-a.json'), /^http:\/\/127\.0\.0\.1:8700\/traces\/2026-01-02\/0930-a\.html$/);

// ── 실제 기록 (JDK 가 있을 때) ──
const javac = spawnSync('javac', ['-version'], { encoding: 'utf8' });
if (javac.status !== 0) {
  console.log('trace.test.js: 찾기 통과 · JDK 없음, 실제 기록은 건너뜀');
  process.exit(0);
}
const src = put('demo/src/demo/shop/OrderService.java', `package demo.shop;

import java.math.BigDecimal;
import java.util.*;

public class OrderService {
  static class Item { String name; BigDecimal price; int qty; Item(String n, String p, int q) { name = n; price = new BigDecimal(p); qty = q; } }
  enum Status { NEW, PAID }

  public Map<String, Object> place(String user, List<Item> items) {
    String password = "hunter2";
    BigDecimal total = BigDecimal.ZERO;
    for (Item it : items) {
      total = total.add(price(it));
    }
    Status st = total.compareTo(new BigDecimal("10")) > 0 ? Status.PAID : Status.NEW;
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("user", user);
    out.put("total", total);
    out.put("status", st);
    try {
      check(total);
    } catch (IllegalStateException e) {
      out.put("warn", e.getMessage());
    }
    return out;
  }

  BigDecimal price(Item it) {
    BigDecimal line = it.price.multiply(BigDecimal.valueOf(it.qty));
    return line;
  }

  void check(BigDecimal total) {
    if (total.signum() > 0) throw new IllegalStateException("검사 " + total);
  }

  public static void main(String[] a) {
    List<Item> items = new ArrayList<>();
    for (int i = 0; i < 12; i++) items.add(new Item("item" + i, "1.50", i % 3 + 1));
    System.out.println(new OrderService().place("kim", items).size());
  }
}
`);
const out = path.join(tmp, 'demo', 'out');
assert.strictEqual(spawnSync('javac', ['-g', '-d', out, src]).status, 0, 'javac');
const port = 20000 + Math.floor(Math.random() * 20000);
const app = spawn('java', [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:${port}`, '-cp', out, 'demo.shop.OrderService'], { stdio: 'ignore' });
const raw = path.join(tmp, 'raw.json');
const rec = spawnSync('java', ['--add-modules', 'jdk.jdi', path.join(__dirname, '..', 'assets', 'java', 'Recorder.java'), '--port', String(port), '--include', 'demo.shop', '--out', raw, '--entry', 'demo.shop.OrderService#place', '--max-hits', '3', '--attach-timeout', '60'], { encoding: 'utf8', timeout: 120000 });
app.kill();
assert.strictEqual(rec.status, 0, rec.stderr);
const tr = JSON.parse(fs.readFileSync(raw, 'utf8'));
const st = tr.steps;
const calls = st.filter((s) => s.call);
assert.strictEqual(calls[0].m, 'place', '시작 메서드부터');
assert.strictEqual(calls[0].args.user, 'kim', '인자');
assert.strictEqual(calls[0].args.items.n, 12, '목록 크기');
assert.strictEqual(calls[0].after.password, '***', '비밀번호 가림');
assert.ok(st.some((s) => s.after && s.after.total && s.after.total.v === '1.50'), 'BigDecimal 값 · 줄 실행 뒤 값');
const price = calls.filter((s) => s.m === 'price');
assert.strictEqual(price.length, 3, `반복 상한 뒤 부른 함수는 접음 (${price.length})`);
assert.ok(price.every((s) => s.p === calls[0].c && s.site >= 0), '부른 곳 연결');
assert.ok(st.some((s) => s.skippedCalls > 0) && st.some((s) => s.skipped > 0), '생략 수');
assert.ok(st.some((s) => s.k === 'return' && s.ret && s.ret.v === '4.50'), '반환값');
assert.ok(st.some((s) => s.after && s.after.st && s.after.st.v === 'PAID'), 'enum');
const ex = st.find((s) => s.k === 'ex');
assert.ok(ex && ex.x.type === 'java.lang.IllegalStateException' && /검사/.test(ex.x.msg) && /OrderService:\d+/.test(ex.x.caught), '예외 · 잡은 곳');
assert.ok(st.some((s) => s.after && s.after.e && s.after.e.msg && !s.after.e.f), '예외 객체는 메시지만');
const last = st[st.length - 1];
assert.ok(last.k === 'return' && last.ret.entries.length === 4 && last.ret.entries[0][0] === 'user', '맵 순서 · 마지막 반환');
assert.ok(!calls.some((s) => s.m === '<init>' && /Status/.test(s.cls)), 'enum 생성자는 건너뜀');
console.log(`trace.test.js: 찾기 · 실제 기록(단계 ${st.length}) 통과`);
fs.rmSync(tmp, { recursive: true, force: true });
