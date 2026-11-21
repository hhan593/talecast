/**
 * web 预览静态服务（issue #93）：对 `npx expo export -p web` 产出的 dist/ 提供
 * 带 COOP/COEP 跨源隔离头的静态服务——expo-sqlite web 的 SharedArrayBuffer
 * 必须在隔离上下文里才能初始化（dev server 的 index.html 绕过 enhanceMiddleware，
 * 所以预览走「export + 本服务」而不是 `pnpm web`）。
 *
 * 用法：npx expo export -p web && node scripts/serve-web.mjs [port=8090]
 * 或：pnpm web:preview
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const PORT = Number(process.argv[2] ?? 8090);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const server = createServer(async (req, res) => {
  // 跨源隔离：SharedArrayBuffer 的前提（expo-sqlite web worker）
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');

  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(decodeURIComponent(url.pathname));
    if (file === '/' || file === '\\') file = '/index.html';
    // SPA 兜底：非资源路径回落 index.html（expo-router 客户端路由接管）
    const target = extname(file) === '' ? join(DIST, 'index.html') : join(DIST, file);
    if (!target.startsWith(DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`TaleCast web 预览: http://localhost:${PORT}（COOP/COEP 已启用，SQLite 可用）`);
});
