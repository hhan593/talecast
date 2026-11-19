import JSZip from 'jszip';

import { parseEpub, type EpubDeps } from '@/domain/epub';

/** 解压防护上限（v0.10.0）：条目数与总解压字节数，防 zip bomb */
const MAX_EPUB_ENTRIES = 4096;
const MAX_EPUB_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/** jszip 适配：EPUB 字节 → 解压读取（domain/epub 的注入实现） */
export function createJszipEpubDeps(epubBytes: Uint8Array): EpubDeps {
  let zipPromise: Promise<JSZip> | null = null;
  const load = async (): Promise<JSZip> => {
    if (!zipPromise) {
      zipPromise = JSZip.loadAsync(epubBytes).then((zip) => {
        const entries = Object.values(zip.files);
        if (entries.length > MAX_EPUB_ENTRIES) {
          throw new Error('EPUB 条目数超出上限，疑似异常文件');
        }
        // JSZip 内部字段：dir 条目无尺寸；缺失按 0 计（domain 层字符上限兜底）
        let total = 0;
        for (const entry of entries) {
          const size = (entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
          total += size;
          if (total > MAX_EPUB_UNCOMPRESSED_BYTES) {
            throw new Error('EPUB 总解压体积超出上限，疑似异常文件');
          }
        }
        return zip;
      });
    }
    return zipPromise;
  };
  return {
    async readFileBytes(path: string): Promise<Uint8Array> {
      const zip = await load();
      const entry = zip.file(path);
      if (!entry) throw new Error(`EPUB 内缺少文件：${path}`);
      return entry.async('uint8array');
    },
    async readFile(path: string): Promise<string> {
      const zip = await load();
      const entry = zip.file(path);
      if (!entry) throw new Error(`EPUB 内缺少文件：${path}`);
      return entry.async('string');
    },
    async exists(path: string): Promise<boolean> {
      const zip = await load();
      return zip.file(path) !== null;
    },
  };
}
