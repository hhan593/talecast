import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // domain 与纯函数适配器（如 SSE 解析）在 Node 环境测试；RN 依赖不进入测试环境
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
