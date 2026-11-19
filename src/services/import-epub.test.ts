import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { createJszipEpubDeps } from '@/adapters/epub';
import { parseEpub } from '@/domain/epub';
import { createImportService } from './import';
import {
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeSourceFileStore,
} from './fakes';

async function buildEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>示例书</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
  );
  zip.file('c1.xhtml', '<html><body><h1>第一章</h1><p>正文内容。</p></body></html>');
  return zip.generateAsync({ type: 'uint8array' });
}

async function setup() {
  const project = { id: 'p1', title: '示例', description: '', tags: [], revision: 0, createdAt: 1, updatedAt: 1 };
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const importService = createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: new FakeReceiptStore(),
    epubParser: {
      parseEpub: (bytes) => parseEpub(createJszipEpubDeps(bytes), bytes),
    },
  });
  return { project, library, files, importService };
}

describe('EPUB 导入', () => {
  it('解析 spine 章节，走同一发布管线', async () => {
    const s = await setup();
    const bytes = await buildEpub();
    const result = await s.importService.importSource({
      commandId: 'c-epub',
      projectId: 'p1',
      fileName: 'book.epub',
      bytes,
    });
    if (!result.ok) {
      console.log('RESULT-ERROR:', JSON.stringify(result.error));
      throw new Error(result.error.message);
    }
    expect(result.value.chapters.map((c) => c.title)).toEqual(['第一章']);
    const text = await s.files.readDecodedText(result.value.source.textSha256);
    expect(text).toContain('第一章');
    expect(text).toContain('正文内容。');
  });
});
