import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = tsFiles(ROOT);

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf-8');
  const specs: string[] = [];
  const re = /(?:from\s+|import\s*\()['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) specs.push(m[1]);
  return specs;
}

describe('架构依赖方向守卫', () => {
  it('domain 不 import services / adapters / hooks / components / container', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (/\.test\.tsx?$/.test(file)) continue; // 测试文件合法跨层接线（集成验证），不参与守卫
      if (!file.includes(`${'domain'}/`) && !file.endsWith(`/${'domain'}`)) continue;
      for (const spec of importsOf(file)) {
        if (/@\/(services|adapters|hooks|components|container)(\/|$)/.test(spec)) {
          violations.push(`${file.replace(ROOT, 'src')} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('app 路由与 components 不直接 import services / adapters', () => {
    const appRoot = join(process.cwd(), 'app');
    const uiFiles = [...tsFiles(appRoot), ...files.filter((f) => f.includes('/components/'))];
    const violations: string[] = [];
    for (const file of uiFiles) {
      if (/\.test\.tsx?$/.test(file)) continue;
      for (const spec of importsOf(file)) {
        if (/@\/(services|adapters)(\/|$)/.test(spec)) {
          violations.push(`${file} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('services 不 import adapters（跨层常量走 domain/contracts）', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (/\.test\.tsx?$/.test(file)) continue;
      if (!file.includes(`${'services'}/`)) continue;
      for (const spec of importsOf(file)) {
        if (/@\/adapters(\/|$)/.test(spec)) {
          violations.push(`${file.replace(ROOT, 'src')} → ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
