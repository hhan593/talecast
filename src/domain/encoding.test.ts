import { describe, expect, it } from 'vitest';

import {
  detectBom,
  detectEncoding,
  decodeSourceText,
  SOURCE_ENCODINGS,
  type SourceEncoding,
} from './encoding';

/** 用 @exodus/bytes 的底层编码器生成真实 legacy 字节（标准 TextEncoder 按规范只出 UTF-8） */
async function encode(text: string, encoding: SourceEncoding): Promise<Uint8Array> {
  if (encoding === 'utf-8') return new TextEncoder().encode(text);
  if (encoding === 'windows-1252') {
    // 仅测试所需字符；完整表由生产解码器提供
    const map: Record<string, number> = { é: 0xe9, '—': 0x97, '“': 0x93, '”': 0x94 };
    return Uint8Array.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
  }
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    const units: number[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp > 0xffff) units.push(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
      else units.push(cp);
    }
    const out = new Uint8Array(units.length * 2);
    units.forEach((unit, i) => {
      out[i * 2] = encoding === 'utf-16le' ? unit & 0xff : unit >> 8;
      out[i * 2 + 1] = encoding === 'utf-16le' ? unit >> 8 : unit & 0xff;
    });
    return out;
  }
  const { createMultibyteEncoder } = await import('@exodus/bytes/multi-byte.js');
  return Uint8Array.from(createMultibyteEncoder(encoding)(text));
}

describe('TXT 编码识别与解码', () => {
  it('BOM 优先：UTF-8 / UTF-16LE / UTF-16BE，解码后无 BOM 字符', async () => {
    const utf8 = await encode('\ufeff第一章', 'utf-8');
    expect(detectBom(utf8)).toEqual({ encoding: 'utf-8', length: 3 });
    expect(decodeSourceText(utf8).text).toBe('第一章');

    const utf16le = await encode('\ufeff第一章', 'utf-16le');
    expect(detectBom(utf16le)).toEqual({ encoding: 'utf-16le', length: 2 });
    expect(detectEncoding(utf16le).encoding).toBe('utf-16le');
    expect(decodeSourceText(utf16le).text).toBe('第一章');

    const utf16be = await encode('\ufeff第一章', 'utf-16be');
    expect(detectBom(utf16be)).toEqual({ encoding: 'utf-16be', length: 2 });
    expect(decodeSourceText(utf16be).text).toBe('第一章');
  });

  it('无 BOM 的严格 UTF-8 直接确认', async () => {
    const bytes = await encode('第一章\n林晚走了进来。', 'utf-8');
    const detection = detectEncoding(bytes);
    expect(detection).toEqual({ encoding: 'utf-8', bom: false, confidence: 'certain' });
    expect(decodeSourceText(bytes).text).toContain('林晚');
  });

  it('GB18030/GBK、Big5、Shift_JIS 真实字节自动识别', async () => {
    const gbk = await encode('第一章 他回来了。\n她冷冷开口。', 'gb18030');
    expect(detectEncoding(gbk).encoding).toBe('gb18030');
    expect(decodeSourceText(gbk).text).toContain('她冷冷开口');

    const big5 = await encode('第一章 他回來了。\n她冷冷開口。', 'big5');
    expect(detectEncoding(big5).encoding).toBe('big5');
    expect(decodeSourceText(big5).text).toContain('她冷冷開口');

    const sjis = await encode('第一章\n彼女が来た。', 'shift_jis');
    expect(detectEncoding(sjis).encoding).toBe('shift_jis');
    expect(decodeSourceText(sjis).text).toContain('彼女');
  });

  it('Windows-1252 西欧重音字可解码，且不会把中文误判成它', async () => {
    const western = await encode('Chapitre éé — “Bon”', 'windows-1252');
    expect(detectEncoding(western).encoding).toBe('windows-1252');
    expect(decodeSourceText(western).text).toContain('Chapitre');

    const gbk = await encode('第一章 中国 小说', 'gb18030');
    expect(detectEncoding(gbk).encoding).toBe('gb18030');
  });

  it('手动选择覆盖自动识别（含误导性字节）', () => {
    // 这批字节按 GBK 解是乱码，但用户明确指定 windows-1252 时必须照办
    const bytes = new Uint8Array([0xd6, 0xd0, 0xb9, 0xfa]);
    const manual = decodeSourceText(bytes, 'windows-1252');
    expect(manual.detection.encoding).toBe('windows-1252');
    expect(manual.text).toBe('ÖÐ¹ú');
    expect(detectEncoding(bytes).encoding).toBe('gb18030');
  });

  it('空文件不误报编码；规范编码列表齐全', () => {
    expect(detectEncoding(new Uint8Array()).encoding).toBe('utf-8');
    expect(SOURCE_ENCODINGS).toContain('gb18030');
    expect(SOURCE_ENCODINGS).toContain('utf-16be');
  });
});
