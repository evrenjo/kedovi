// FSD 레이어 경계 검사 (kedovi archrules react 로 만든 파일, 프로젝트에 맞게 고쳐 쓴다).
// eslint.config.js 에서: import boundaries from './eslint.boundaries.config.js'; export default [...기존설정, ...boundaries];
// 필요: npm i -D eslint-plugin-boundaries@^7 (TypeScript 경로 해석은 eslint-import-resolver-typescript)
import boundaries from 'eslint-plugin-boundaries';

const SRC = '__SRC_DIR__';
// 생성 API 코드 폴더 (OpenAPI 생성기 출력). 여기의 값(함수 · 훅)은 각 slice 의 api 세그먼트에서만 import 한다
const GENERATED_API = '__GENERATED_API_DIR__';

// 위에서 아래로만 import 한다: app → pages → widgets → features → entities → shared
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const SLICED = ['pages', 'widgets', 'features', 'entities'];
const below = (layer) => LAYERS.slice(LAYERS.indexOf(layer) + 1);
// 다른 slice 는 루트 index.ts 로만 (공개 API)
const PUBLIC = '{index.ts,index.tsx}';

export default [
  {
    files: [`${SRC}/**/*.{ts,tsx}`],
    plugins: { boundaries },
    settings: {
      'boundaries/include': [`${SRC}/**/*`],
      'boundaries/elements': [
        // 생성 API 를 shared 보다 먼저 둔다 (먼저 맞는 요소로 분류된다)
        { type: 'generated-api', pattern: GENERATED_API },
        { type: 'app', pattern: `${SRC}/app` },
        ...SLICED.map((type) => ({ type, pattern: `${SRC}/${type}/*`, capture: ['slice'] })),
        { type: 'shared', pattern: `${SRC}/shared/*`, capture: ['segment'] },
      ],
    },
    rules: {
      'boundaries/dependencies': ['error', {
        default: 'disallow',
        // 마지막에 맞는 정책이 이긴다. 같은 요소(같은 slice) 안의 import 는 검사하지 않는다
        policies: [
          // 아래 레이어: slice 는 index 로만, shared 는 세그먼트 어디든
          ...LAYERS.filter((layer) => layer !== 'shared').map((layer) => ({
            from: { element: { type: layer } },
            allow: {
              to: [
                ...below(layer).filter((x) => x !== 'shared').map((type) => ({ element: { type, fileInternalPath: PUBLIC } })),
                { element: { type: 'shared' } },
              ],
            },
          })),
          { from: { element: { type: 'shared' } }, allow: { to: { element: { type: 'shared' } } } },
          // 생성 API: 타입은 어디서든
          { allow: { to: { element: { type: 'generated-api' } }, dependency: { kind: 'type' } } },
          // 생성 API 값: slice 의 api 세그먼트와 shared/api 에서만
          { from: { element: { type: SLICED, fileInternalPath: 'api/**' } }, allow: { to: { element: { type: 'generated-api' } } } },
          { from: { element: { type: 'shared', captured: { segment: 'api' } } }, allow: { to: { element: { type: 'generated-api' } } } },
          // ui 세그먼트는 생성 API 값을 import 하지 않는다 (데이터는 model · api 의 훅으로)
          {
            from: { element: { fileInternalPath: 'ui/**' } },
            disallow: { to: { element: { type: 'generated-api' } }, dependency: { kind: 'value' } },
            message: 'ui 는 생성 API 값을 직접 import 하지 않는다. 같은 slice 의 api · model 훅을 쓴다 (타입 import 는 된다)',
          },
          // shared 의 api 밖 세그먼트도 생성 endpoint 값을 쓰지 않는다
          {
            from: { element: { type: 'shared', captured: { segment: '!api' } } },
            disallow: { to: { element: { type: 'generated-api' } }, dependency: { kind: 'value' } },
            message: 'shared 는 api 세그먼트에서만 생성 endpoint 값을 쓴다',
          },
        ],
      }],
    },
  },
];
