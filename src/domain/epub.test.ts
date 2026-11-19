import { describe, expect, it } from 'vitest';

import { parseEpub, stripHtml } from './epub';
import { buildSampleEpub } from '../../tests/fixtures/sample-epub';
import { createJszipEpubDeps } from '@/adapters/epub';

describe('stripHtml', () => {
  it('块级标签转换行、实体还原', () => {
    expect(stripHtml('<p>A</p><p>B</p>')).toBe('A\nB\n');
    expect(stripHtml('A &amp; B')).toBe('A & B');
  });
});

describe('parseEpub', () => {
  it('解析书名与 spine 章节（fixture EPUB）', async () => {
    const bytes = await buildSampleEpub();
    const result = await parseEpub(createJszipEpubDeps(bytes), bytes);
    expect(result.bookTitle).toBe('山河故人');
    expect(result.chapters.map((c) => c.title)).toEqual(['第一章 重逢', '第二章 别离']);
    expect(result.chapters[0].text).toContain('清晨的雾还没有散去');
    expect(result.chapters[1].text).toContain('那天的雨下了整夜');
  });

  it('损坏容器给出明确错误', async () => {
    const bytes = new TextEncoder().encode('not a zip');
    await expect(parseEpub(createJszipEpubDeps(bytes), bytes)).rejects.toThrow(/EPUB|zip|缺少/i);
  });
});

describe('v0.10.0 zip bomb 上限', () => {
  function fakeDeps(files: Record<string, string>) {
    return {
      readFile: async (path: string) => {
        const content = files[path];
        if (content === undefined) throw new Error(`缺少文件 ${path}`);
        return content;
      },
      exists: async (path: string) => path in files,
    };
  }

  function minimalEpubFiles(extraSpine: Record<string, string> = {}) {
    return {
      'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf':
        '<?xml version="1.0"?><package><metadata><dc:title>测试书</dc:title></metadata><manifest><item id="c1" href="c1.xhtml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      'OEBPS/c1.xhtml': '<html><body><p>正文内容。</p></body></html>',
      ...extraSpine,
    };
  }

  it('单文件超字符上限：明确报错中止', async () => {
    const files = minimalEpubFiles();
    files['OEBPS/c1.xhtml'] = `<html><body>${'<p>字</p>'.repeat(2_000_000)}</body></html>`;
    await expect(parseEpub(fakeDeps(files), new Uint8Array(0))).rejects.toThrow('单文件解压体积异常');
  });

  it('累计超总上限：明确报错中止', async () => {
    // 构造 5 个 3M 字符文件：单文件未超、累计超 12M
    const spine: Record<string, string> = {};
    let manifest = '';
    let itemrefs = '';
    for (let i = 1; i <= 5; i++) {
      spine[`OEBPS/c${i}.xhtml`] = `<html><body>${'字'.repeat(3_000_000)}</body></html>`;
      manifest += `<item id="c${i}" href="c${i}.xhtml"/>`;
      itemrefs += `<itemref idref="c${i}"/>`;
    }
    const files = {
      'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
      'OEBPS/content.opf': `<?xml version="1.0"?><package><metadata><dc:title>大书</dc:title></metadata><manifest>${manifest}</manifest><spine>${itemrefs}</spine></package>`,
      ...spine,
    };
    await expect(parseEpub(fakeDeps(files), new Uint8Array(0))).rejects.toThrow('总解压体积超出上限');
  });

  it('正常小文件不受影响', async () => {
    const result = await parseEpub(fakeDeps(minimalEpubFiles()), new Uint8Array(0));
    expect(result.bookTitle).toBe('测试书');
    expect(result.chapters.length).toBe(1);
  });
});
