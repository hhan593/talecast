import JSZip from 'jszip';

import { parseEpub, type EpubDeps } from '@/domain/epub';

/** jszip 适配：EPUB 字节 → 解压读取（domain/epub 的注入实现） */
export function createJszipEpubDeps(epubBytes: Uint8Array): EpubDeps {
  let zipPromise: Promise<JSZip> | null = null;
  const load = async (): Promise<JSZip> => {
    if (!zipPromise) zipPromise = JSZip.loadAsync(epubBytes);
    return zipPromise;
  };
  return {
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
