/* ERD 뷰어 Export · SQL DDL: 정의서 모델 → CREATE 문 (검토용). 브라우저(window.ERD_DDL)와 Node(require) 둘 다 쓴다 */
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.ERD_DDL = f(); })(this, function () {
  'use strict';
  var NAMES = { postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', oracle: 'Oracle', mssql: 'SQL Server', sqlite: 'SQLite' };
  var ALIAS = { postgres: 'postgresql', pg: 'postgresql', sqlserver: 'mssql', 'sql server': 'mssql', maria: 'mariadb', sqlite3: 'sqlite' };
  var REF = /^(\w+)\.(\w+)\.(\w+)$/;
  var LREF = /^(\w+)\.(\w+)(?:\.(\w+))?$/;

  function dialectOf(v) {
    var d = String(v || '').trim().toLowerCase();
    d = ALIAS[d] || d;
    return NAMES[d] ? d : 'postgresql';
  }

  /**
   * M = { title, tables }, schemas = 내보낼 스키마, o = { dialect, fkInDb, now }
   * 타입은 정의서에 적은 그대로 옮긴다 (DB 종류에 맞는 타입을 정의서에 쓴다)
   */
  function ddl(M, schemas, o) {
    o = o || {};
    var d = dialectOf(o.dialect);
    var my = d === 'mysql' || d === 'mariadb';
    var lite = d === 'sqlite';
    var q = function (s) { return String(s).replace(/'/g, "''"); };
    var note = function (a, b) { return [a, b].filter(Boolean).join(': '); };
    var tabs = M.tables.filter(function (t) { return schemas.indexOf(t.schema) >= 0; });
    var out = [
      '-- ' + M.title + ' · ' + NAMES[d] + ' DDL',
      '-- 검토용. 실제 변경은 마이그레이션 도구로 (packs/db/rules/20-schema-change.md)',
      '-- 정의서(md) 기준' + (o.now ? ' · 생성 ' + o.now : '') + ' · 스키마 ' + schemas.join(', ') + ' · 테이블 ' + tabs.length,
      '',
    ];
    schemas.forEach(function (s) {
      if (d === 'postgresql') out.push('CREATE SCHEMA IF NOT EXISTS ' + s + ';');
      else if (my) out.push('CREATE DATABASE IF NOT EXISTS ' + s + ';');
      else if (d === 'mssql') out.push("IF SCHEMA_ID(N'" + q(s) + "') IS NULL EXEC('CREATE SCHEMA " + s + "');");
      else if (lite) out.push('-- 스키마 ' + s + ': SQLite 는 main 이거나 ATTACH DATABASE 로 붙인 DB 이름이다');
      else out.push('-- 스키마(사용자) ' + s + ' 는 DBA 가 만든다 (CREATE USER)');
    });
    out.push('');
    var fks = [];
    var lrefs = [];
    tabs.forEach(function (t) {
      out.push('-- ' + note(t.logical || t.name, t.desc) + (t.fns && t.fns.length ? ' (' + t.fns.join(', ') + ')' : ''));
      if (t.partition || t.retention) out.push('-- ' + [t.partition ? '파티션: ' + t.partition : '', t.retention ? '보존: ' + t.retention : ''].filter(Boolean).join(' · ') + ' (파티션 · 보존은 마이그레이션에서 정한다)');
      var lines = t.columns.map(function (c) {
        var cm = my && (c.logical || c.desc) ? " COMMENT '" + q(note(c.logical, c.desc)) + "'" : '';
        // SQLite 는 주석 문법이 없어 컬럼 위에 SQL 주석으로 남긴다
        if (lite && (c.logical || c.desc)) return '  -- ' + note(c.logical, c.desc).replace(/\n/g, ' ') + '\n  ' + c.name + ' ' + c.type + (c.nullable ? '' : ' NOT NULL');
        return '  ' + c.name + ' ' + c.type + (c.nullable ? '' : ' NOT NULL') + cm;
      });
      var pk = t.columns.filter(function (c) { return c.pk; }).map(function (c) { return c.name; });
      if (pk.length) lines.push('  CONSTRAINT pk_' + t.name + ' PRIMARY KEY (' + pk.join(', ') + ')');
      t.columns.filter(function (c) { return c.uk && !c.pk; }).forEach(function (c) { lines.push('  CONSTRAINT uk_' + t.name + '_' + c.name + ' UNIQUE (' + c.name + ')'); });
      // SQLite 는 ALTER TABLE 로 외래키를 더할 수 없어 CREATE TABLE 안에 둔다 (참조 대상은 스키마 없이 테이블 이름만)
      if (lite && o.fkInDb !== false) t.columns.filter(function (c) { return c.fk && REF.test(c.ref); }).forEach(function (c) { var m = REF.exec(c.ref); lines.push('  CONSTRAINT fk_' + t.name + '_' + c.name + ' FOREIGN KEY (' + c.name + ') REFERENCES ' + m[2] + ' (' + m[3] + ')'); });
      out.push('CREATE TABLE ' + t.id + ' (', lines.join(',\n'), ')' + (my && (t.logical || t.desc) ? " COMMENT='" + q(note(t.logical, t.desc)) + "'" : '') + ';');
      if (d === 'postgresql' || d === 'oracle') {
        if (t.logical || t.desc) out.push('COMMENT ON TABLE ' + t.id + " IS '" + q(note(t.logical, t.desc)) + "';");
        t.columns.forEach(function (c) { if (c.logical || c.desc) out.push('COMMENT ON COLUMN ' + t.id + '.' + c.name + " IS '" + q(note(c.logical, c.desc)) + "';"); });
      } else if (d === 'mssql') {
        var prop = function (text, col) { return "EXEC sp_addextendedproperty N'MS_Description', N'" + q(text) + "', N'SCHEMA', N'" + t.schema + "', N'TABLE', N'" + t.name + "'" + (col ? ", N'COLUMN', N'" + col + "'" : '') + ';'; };
        if (t.logical || t.desc) out.push(prop(note(t.logical, t.desc)));
        t.columns.forEach(function (c) { if (c.logical || c.desc) out.push(prop(note(c.logical, c.desc), c.name)); });
      }
      out.push('');
      if (!lite || o.fkInDb === false) t.columns.filter(function (c) { return c.fk; }).forEach(function (c) {
        var m = REF.exec(c.ref);
        if (m) fks.push({ t: t, c: c, ref: m[1] + '.' + m[2], rc: m[3], inScope: schemas.indexOf(m[1]) >= 0 });
      });
      t.columns.filter(function (c) { return c.lref && !c.fk && LREF.test(c.ref); }).forEach(function (c) { lrefs.push(t.id + '.' + c.name + ' -> ' + c.ref); });
    });
    if (fks.length) out.push(o.fkInDb === false ? '-- 외래키: DB 에 걸지 않는다 (프로젝트 컨벤션). 관계는 아래와 같다' : '-- 외래키 (테이블을 모두 만든 뒤)');
    fks.forEach(function (f) {
      var line = 'ALTER TABLE ' + f.t.id + ' ADD CONSTRAINT fk_' + f.t.name + '_' + f.c.name + ' FOREIGN KEY (' + f.c.name + ') REFERENCES ' + f.ref + ' (' + f.rc + ');';
      if (o.fkInDb === false) out.push('-- ' + line);
      else out.push(f.inScope ? line : '-- 참조 대상 스키마가 내보내기 범위 밖: ' + line);
    });
    if (lrefs.length) {
      out.push('', '-- 논리 참조: DB 외래키 없이 앱이 지킨다 (정의서 참조 칸의 「논리:」)');
      lrefs.forEach(function (x) { out.push('--   ' + x); });
    }
    return out.join('\n') + '\n';
  }

  return { ddl: ddl, dialectOf: dialectOf, NAMES: NAMES };
});
