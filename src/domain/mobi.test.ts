import { describe, expect, it } from 'vitest';

import {
  extractMobiHtml,
  palmdocCompressForTest,
  palmdocDecompress,
  parseMobi,
  parseMobiHeader,
  splitPalmDbRecords,
} from './mobi';

/** 测试夹具构建：PalmDB 容器（type=BOOK creator=MOBI）+ record0（PalmDOC+MOBI 头）+ 文本记录 */
function buildMobiFixture(html: string, title: string, compression: 1 | 2): Uint8Array {
  const encoder = new TextEncoder();
  const htmlBytes = encoder.encode(html);
  const textRecordCount = 1;
  // record0：PalmDOC 16B + MOBI 头（len=24）+ EXTH（标题）
  const mobiHeaderLength = 24;
  const titleBytes = encoder.encode(title);
  const exthLength = 12 + 8 + titleBytes.length;
  const record0Length = 16 + mobiHeaderLength + 4 + exthLength;
  const record0 = new Uint8Array(record0Length);
  const view = new DataView(record0.buffer);
  view.setUint16(0, compression); // compression
  view.setUint32(4, htmlBytes.length); // textLength
  view.setUint16(8, textRecordCount);
  view.setUint16(12, 0); // encryption
  record0[16] = 0x4d; record0[17] = 0x4f; record0[18] = 0x42; record0[19] = 0x49; // 'MOBI'
  view.setUint32(20, mobiHeaderLength);
  view.setUint32(28, 65001); // encoding = UTF-8
  // EXTH
  const exthOffset = 16 + mobiHeaderLength + 4;
  record0[exthOffset] = 0x45; record0[exthOffset + 1] = 0x58; record0[exthOffset + 2] = 0x54; record0[exthOffset + 3] = 0x48; // 'EXTH'
  view.setUint32(exthOffset + 4, exthLength);
  view.setUint32(exthOffset + 8, 1); // 1 条记录
  view.setUint32(exthOffset + 12, 503); // type = updated title
  view.setUint32(exthOffset + 16, 8 + titleBytes.length);
  record0.set(titleBytes, exthOffset + 20);

  const textRecord = compression === 2 ? palmdocCompressForTest(htmlBytes) : htmlBytes;

  // PalmDB：78B 头 + 2 条记录偏移
  const recordCount = 2;
  const total = 78 + recordCount * 8 + record0.length + textRecord.length;
  const out = new Uint8Array(total);
  const dbView = new DataView(out.buffer);
  out.set(encoder.encode('TESTBOOK'), 0);
  out.set(encoder.encode('BOOK'), 60);
  out.set(encoder.encode('MOBI'), 64);
  dbView.setUint16(76, recordCount);
  let cursor = 78 + recordCount * 8;
  dbView.setUint32(78, cursor); // record0 offset
  cursor += record0.length;
  dbView.setUint32(86, cursor); // record1 offset
  out.set(record0, 78 + recordCount * 8);
  out.set(textRecord, 78 + recordCount * 8 + record0.length);
  return out;
}

describe('v0.14.0 MOBI 解析', () => {
  const html = '<html><body><p>第一段落。</p><p>第二段落，内容更长一些。</p></body></html>';

  it('PalmDB 记录切分：两条记录边界正确', () => {
    const bytes = buildMobiFixture(html, '测试书', 1);
    const records = splitPalmDbRecords(bytes);
    expect(records.length).toBe(2);
    expect(records[0][16]).toBe(0x4d);
  });

  it('MOBI 头：压缩方式/记录数/编码', () => {
    const bytes = buildMobiFixture(html, '测试书', 2);
    const records = splitPalmDbRecords(bytes);
    const header = parseMobiHeader(records[0]);
    expect(header.compression).toBe(2);
    expect(header.textRecordCount).toBe(1);
    expect(header.encoding).toBe(65001);
  });

  it('字面量 round-trip：含 0x00/0x51/0x01-0x08/高位字节', () => {
    const original = new TextEncoder().encode(
      '乱七八糟的中文内容。abcabcabcabcabc\u00e9\u00ff 高位字节。\u0000\u0051\u0002',
    );
    const compressed = palmdocCompressForTest(original);
    const decompressed = palmdocDecompress(compressed);
    expect(Array.from(decompressed)).toEqual(Array.from(original));
  });

  it('回引分支规范向量：0x80-0xBF pair>>3 11 位距离（libmobi 公式）', () => {
    // 'abc' + 0x80,0x0F：pair=0x800F → distance=(0x800F>>3)&0x7FF=1, length=(0x0F&7)+3=10
    // → 'abccccccccccc'（重叠复制周期 1）
    const stream = new Uint8Array([0x61, 0x62, 0x63, 0x80, 0x0f]);
    const out = palmdocDecompress(stream);
    expect(new TextDecoder().decode(out)).toBe('abccccccccccc');
  });

  it('损坏回引向量：距离超出已输出长度 → 拒绝整流（libmobi 同语义）', () => {
    // 'abcdefgh' + 0x84,0x1B：pair=0x841B → distance=(0x841B>>3)&0x7FF=131
    // 131 > 已输出 8 字节 → 越界，返回空流而非复制未定义内存
    const stream = new Uint8Array([0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x84, 0x1b]);
    const out = palmdocDecompress(stream);
    expect(out.length).toBe(0);
  });

  it('0xC0-0xFF：空格 + (byte^0x80) 两字符（calibre b\' A\'→0xc1 可证）', () => {
    const stream = new Uint8Array([0xc1, 0xc2, 0xdf]);
    const out = palmdocDecompress(stream);
    expect(new TextDecoder().decode(out)).toBe(' A B _');
  });

  it('字面量转义向量：0x00 0x51 → Q', () => {
    // 'a' + 0x00 转义 'Q' + 'b' → 'aQb'
    const stream = new Uint8Array([0x61, 0x00, 0x51, 0x62]);
    const out = palmdocDecompress(stream);
    expect(new TextDecoder().decode(out)).toBe('aQb');
  });

  it('未压缩 MOBI：全文提取 + EXTH 标题', () => {
    const bytes = buildMobiFixture(html, '测试书', 1);
    const { html: extracted, bookTitle } = extractMobiHtml(bytes);
    expect(bookTitle).toBe('测试书');
    expect(extracted).toContain('第一段落。');
  });

  it('parseMobi：HTML 去标签 → 单章结构', () => {
    const bytes = buildMobiFixture(html, '测试书', 2);
    const result = parseMobi(bytes, (input) => input.replace(/<[^>]+>/g, ''));
    expect(result.bookTitle).toBe('测试书');
    expect(result.chapters[0].text).toContain('第一段落。');
    expect(result.chapters[0].text).toContain('第二段落');
  });

  it('加密文件明确报错', () => {
    const bytes = buildMobiFixture(html, '测试书', 1);
    const view = new DataView(bytes.buffer);
    // record0 encryption 字段置 1
    const record0Offset = view.getUint32(78);
    view.setUint16(record0Offset + 12, 1);
    expect(() => parseMobi(bytes, (input) => input)).toThrow('加密');
  });
});

describe('issue #34 损坏头防护', () => {
  it('textLength 超上限：明确报错而非 OOM', () => {
    const bytes = buildMobiFixture('<p>x</p>', '测试书', 1);
    const view = new DataView(bytes.buffer);
    const record0Offset = view.getUint32(78);
    view.setUint32(record0Offset + 4, 0xfffffff0); // 声明近 4GiB（Uint32 内）
    expect(() => extractMobiHtml(bytes)).toThrow('正文长度异常');
  });
});
