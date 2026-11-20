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

  it('app 路由与 components 不直接 import services / adapters；hooks 不 import adapters', () => {
    // app/components：禁止 services 与 adapters（只经 hooks）
    // hooks：允许 services（其职责即服务入口），禁止 adapters
    const appRoot = join(process.cwd(), 'app');
    const appAndComponents = [
      ...tsFiles(appRoot),
      ...files.filter((f) => f.includes('/components/')),
    ].filter((f) => !/\.test\.tsx?$/.test(f));
    const hookFiles = files.filter((f) => f.includes(`${'hooks'}/`));
    const violations: string[] = [];
    for (const file of appAndComponents) {
      for (const spec of importsOf(file)) {
        if (/@\/(services|adapters)(\/|$)/.test(spec)) {
          violations.push(`${file.replace(process.cwd(), '')} → ${spec}`);
        }
      }
    }
    for (const file of hookFiles) {
      for (const spec of importsOf(file)) {
        if (/@\/adapters(\/|$)/.test(spec)) {
          violations.push(`${file.replace(process.cwd(), '')} → ${spec}`);
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

  it('track-player 原生补丁保留 RN 0.88 新架构必需的三处修复', () => {
    const patch = readFileSync(
      join(process.cwd(), 'patches/react-native-track-player@4.1.2.patch'),
      'utf-8',
    );
    // Kotlin 表达式体 = scope.launch 会反射成 Job 返回类型，TurboModule 拒绝整个模块
    expect(patch.match(/^\+.*\) \{$/gm)?.length ?? 0).toBeGreaterThanOrEqual(36);
    expect(patch).toContain('scope.launch {');
    // MusicService 不能再走 ReactNativeHost（RN 0.88 bridgeless 直接抛错）
    expect(patch).toContain('+        reactContext');
    expect(patch).not.toContain('+        reactNativeHost.reactInstanceManager.currentReactContext');
    // 历史修复：nullable originalItem 不能传给 Arguments.fromBundle
    expect(patch).toContain('originalItem?.let');
  });
});
