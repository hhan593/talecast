// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // eslint-plugin-react-hooks v7 内置的 React Compiler 语义规则（refs / set-state-in-effect /
    // purity 等）在 RN 惯用模式下大量误报：useRef(new Animated.Value).current 惰性初始化、
    // ref 回调桥赋值、onScroll listener 读 ref 等均为 RN 社区标准写法。
    // 降级为 warning 观察并记录（路线图 v0.15 §lint 清零），不阻塞门禁。
    plugins: { 'react-hooks': require('eslint-plugin-react-hooks') },
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/no-deriving-state-in-effects': 'warn',
      'react-hooks/memoized-effect-dependencies': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/gating': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/void-use-memo': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/exhaustive-effect-dependencies': 'warn',
      'react-hooks/capitalized-calls': 'warn',
      'react-hooks/memo-dependencies': 'warn',
    },
  },
]);
