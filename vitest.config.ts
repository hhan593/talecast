import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // domain 与纯函数适配器（如 SSE 解析）在 Node 环境测试；RN 依赖不进入测试环境
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // react-test-renderer（hook 测试基建）其 CJS 产物带 @flow 注释，rolldown 主动拒绝解析；
    // inline 进转换管线后由 esbuild 处理（产物本身是合法 JS）
    server: { deps: { inline: [/react-test-renderer/] } },
  },
});
