/**
 * 구조 검사 · component-web (kedovi archrules nestjs 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다)
 * 실행: npx depcruise __SRC__ --config .dependency-cruiser.cjs   (필요: npm i -D dependency-cruiser)
 * 방향: web → feature → shared. 화면(web/views/<화면 경로>) · API 묶음(web/api/<묶음>)끼리 모른다. 공통은 customer/<고객> 을 모른다
 */
const SRC = '__SRC__';
// 고객사 접두(customer/<고객>/)는 대안으로 쓴다. 선택 그룹 안에 반복을 넣으면 dependency-cruiser 가 위험한 정규식으로 거부한다
const under = (dirs) => `(${dirs}|customer/[^/]+/(${dirs}))`;

module.exports = {
  forbidden: [
    {
      name: 'feature-no-web',
      comment: 'feature 는 web 을 import 하지 않는다 (방향은 web → feature → shared)',
      severity: 'error',
      from: { path: `^${SRC}/${under('feature')}/` },
      to: { path: `^${SRC}/${under('web')}/` },
    },
    {
      name: 'config-shared-no-feature-web',
      comment: 'config · shared 는 feature · web 을 import 하지 않는다',
      severity: 'error',
      from: { path: `^${SRC}/${under('config|shared')}/` },
      to: { path: `^${SRC}/${under('feature|web')}/` },
    },
    {
      name: 'web-units-independent',
      comment: '화면 · API 묶음끼리 import 하지 않는다 (같은 폴더와 그 dto/ 만). 함께 쓰는 것은 feature 나 shared 로',
      severity: 'error',
      from: { path: `^${SRC}/(web/(views|api)/.+?|customer/[^/]+/web/(views|api)/.+?)(/dto)?/[^/]+$` },
      to: { path: `^${SRC}/${under('web')}/`, pathNot: `^${SRC}/$1/` },
    },
    {
      name: 'web-no-feature-repository',
      comment: 'web 은 기능의 module · service · DTO 를 쓰고 저장소를 직접 import 하지 않는다',
      severity: 'error',
      from: { path: `^${SRC}/${under('web')}/` },
      to: { path: `^${SRC}/${under('feature')}/.+\\.repository\\.ts$` },
    },
    {
      name: 'common-no-customer',
      comment: '공통 코드는 customer 를 import 하지 않는다. 공통이 인터페이스를 정하고 고객사가 구현한다',
      severity: 'error',
      from: { path: `^${SRC}/(feature|web|config|shared)/` },
      to: { path: `^${SRC}/customer/` },
    },
    {
      name: 'customer-no-other-customer',
      comment: '고객사끼리 import 하지 않는다',
      severity: 'error',
      from: { path: `^${SRC}/customer/([^/]+)/` },
      to: { path: `^${SRC}/customer/`, pathNot: `^${SRC}/customer/$1/` },
    },
    {
      name: 'no-controller-in-feature',
      comment: '기능 안에 *.controller.ts 를 두지 않는다. 진입점은 web/views/<화면>/ (화면이 부르지 않는 API 는 web/api/<묶음>/). 컨트롤러가 무엇이든 import 하면 걸린다',
      severity: 'error',
      from: { path: `^${SRC}/${under('feature')}/.+\\.controller\\.ts$` },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(spec|test)\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
