import { describe, expect, it } from 'vitest';

import { ERRORS } from './errors';

describe('errors 文案表（issue #82）', () => {
  it('每个键 zh/en 齐备、code 合法', () => {
    const legalCodes = ['busy', 'not_found', 'invalid', 'conflict', 'storage', 'network', 'unknown'];
    for (const [key, entry] of Object.entries(ERRORS)) {
      expect(legalCodes, key).toContain(entry.code);
      expect(typeof entry.zh === 'string' ? entry.zh : entry.zh({}), key).not.toBe('');
      expect(typeof entry.en === 'string' ? entry.en : entry.en({}), key).not.toBe('');
    }
  });

  it('模板条目的参数插值正常工作', () => {
    expect(ERRORS.fileTooLarge.zh({ size: '3.2' })).toContain('3.2');
    expect(ERRORS.fileTooLarge.en({ size: '3.2' })).toContain('3.2');
    expect(ERRORS.alreadyImported.zh({ name: '书名' })).toContain('书名');
  });

  it('共享键：相同语义的错误复用同一文案（跨服务一致）', () => {
    // bookMissing / characterMissing / chapterMissing 等被多个服务共享
    expect(Object.values(ERRORS).filter((e) => e.code === 'not_found').length).toBeGreaterThan(3);
  });
});
