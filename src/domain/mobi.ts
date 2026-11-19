/**
 * MOBI/AZW3 解析（docs/design/2026-11-20-v0.10-v0.16-roadmap.md v0.14.0）：
 * 自研实现（不依赖不可靠的 mobi 包）——PalmDB 头 → MOBI 头 → PalmDOC 解压 → HTML 去标签（复用 epub.stripHtml）。
 * 纯函数 + 测试 round-trip（自研 compress 按规范反向生成样本）。
 * AZW3（KF8）与 MOBI6 共享 text records 结构：按 MOBI 头 text record 范围提取；解析失败抛明确错误。
 */

export interface MobiChapter {
  title: string;
  text: string;
}

export interface MobiParseResult {
  bookTitle: string;
  chapters: MobiChapter[];
}

/** PalmDB 记录切分：78B 头 + 记录偏移表 */
export function splitPalmDbRecords(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length < 78) throw new Error('文件过小，不是 PalmDB 格式');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numRecords = view.getUint16(76);
  if (numRecords === 0 || numRecords > 8192) throw new Error('PalmDB 记录数异常');
  const offsets: number[] = [];
  for (let i = 0; i < numRecords; i++) {
    const entry = 78 + i * 8;
    if (entry + 4 > bytes.length) throw new Error('PalmDB 记录表损坏');
    offsets.push(view.getUint32(entry));
  }
  const records: Uint8Array[] = [];
  for (let i = 0; i < numRecords; i++) {
    const start = offsets[i];
    const end = i + 1 < numRecords ? offsets[i + 1] : bytes.length;
    if (start > end || end > bytes.length) throw new Error('PalmDB 记录边界异常');
    records.push(bytes.subarray(start, end));
  }
  return records;
}

/** 解析 record 0 的 PalmDOC + MOBI 头（压缩方式 / 文本记录数 / 编码 / 首条非文本记录索引） */
export interface MobiHeader {
  compression: number; // 1 = 未压缩, 2 = PalmDOC, 17480 = HUFF/CDIC
  textRecordCount: number;
  encoding: number; // 1252 / 65001(UTF-8)
  textLength: number;
}

export function parseMobiHeader(record0: Uint8Array): MobiHeader {
  if (record0.length < 16) throw new Error('PalmDOC 头损坏');
  const view = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
  const compression = view.getUint16(0);
  const textLength = view.getUint32(4);
  const textRecordCount = view.getUint16(8);
  const encryption = view.getUint16(12);
  if (encryption !== 0) throw new Error('该 MOBI 文件已加密，暂不支持');
  // MOBI magic 校验（可选：PalmDOC-only 文件没有 MOBI 头）
  let encoding = 65001;
  if (record0.length >= 20 && record0[16] === 0x4d && record0[17] === 0x4f && record0[18] === 0x42 && record0[19] === 0x49) {
    if (record0.length >= 28) {
      const mobiHeaderLength = view.getUint32(20);
      if (mobiHeaderLength >= 20 && record0.length >= 16 + mobiHeaderLength + 4) {
        encoding = view.getUint32(28);
      }
    }
  }
  return { compression, textRecordCount, encoding, textLength };
}

/**
 * PalmDOC LZ77 解压（MobileRead PalmDOC 规范）：
 * - 0x00：字面量 0x00（后随 0x51 'Q' 表示字面量 Q 的转义）
 * - 1-0x08：字面量串（该值个数字节）
 * - 0x09-0x7F：字面量（该值本身）
 * - 0x80-0xBF 与下一字节组成 14 位：distance=(14位)>>2, length=(末2位)+3
 * - 0xC0-0xC1：整词重复（0xC0）与词间空白（0xC1）
 * - 0xC2-0xFF 与下一字节：distance=((c&0x3F)<<2)|(b>>2), length=(b&0x3)+3
 */
export function palmdocDecompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    i += 1;
    if (c === 0x00) {
      if (i < data.length && data[i] === 0x51) {
        out.push(0x51); // 'Q' 转义
        i += 1;
      } else {
        out.push(0x00);
      }
      continue;
    }
    if (c <= 0x08) {
      for (let j = 0; j < c && i < data.length; j++) {
        out.push(data[i]);
        i += 1;
      }
      continue;
    }
    if (c <= 0x7f) {
      out.push(c);
      continue;
    }
    if (c <= 0xbf) {
      if (i >= data.length) break;
      // 12 位距离：c 低 6 位 + 下一字节高 6 位（标志位 0x80-0xBF 不进距离）
      const distance = ((c & 0x3f) << 6) | (data[i] >> 2);
      const length = (data[i] & 0x03) + 3;
      i += 1;
      for (let j = 0; j < length; j++) {
        out.push(out[out.length - distance]);
      }
      continue;
    }
    if (c === 0xc0 || c === 0xc1) {
      // 整词重复 / 词间空白：两字节 big-endian distance，length=3+(b&0x3)
      if (i + 1 >= data.length) break;
      const distance = (data[i] << 8) | data[i + 1];
      const length = 3 + (data[i + 1] & 0x03);
      i += 2;
      if (c === 0xc1) {
        out.push(0x20);
        for (let j = 0; j < length; j++) out.push(out[out.length - distance]);
      } else {
        for (let j = 0; j < length; j++) out.push(out[out.length - distance]);
      }
      continue;
    }
    // 0xC2-0xFF
    if (i >= data.length) break;
    const distance = ((c & 0x3f) << 2) | (data[i] >> 2);
    const length = 3 + (data[i] & 0x03);
    i += 1;
    for (let j = 0; j < length; j++) {
      out.push(out[out.length - distance]);
    }
  }
  return new Uint8Array(out);
}

/** 测试辅助压缩器：全字面量流（正确性优先；生产路径只有解压器，其回引分支由手工向量测试覆盖） */
export function palmdocCompressForTest(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte >= 0x09 && byte <= 0x7f && byte !== 0x51) out.push(byte);
    else if (byte === 0x00) out.push(0x00);
    else {
      // 0x00-0x08 / 0x51 特例 / 高位字节：1 字节计数串
      out.push(0x01, byte);
    }
  }
  return new Uint8Array(out);
}

/** MOBI 正文记录拼接 → HTML 全文（textLength 截尾） */
export function extractMobiHtml(bytes: Uint8Array): { html: string; bookTitle: string; encoding: number } {
  const records = splitPalmDbRecords(bytes);
  const header = parseMobiHeader(records[0]);
  if (header.compression === 17480) {
    throw new Error('该 MOBI 使用 HUFF/CDIC 压缩，暂不支持');
  }
  const parts: Uint8Array[] = [];
  for (let i = 1; i <= header.textRecordCount && i < records.length; i++) {
    const record = records[i];
    parts.push(
      header.compression === 2 ? palmdocDecompress(record) : record,
    );
  }
  // 拼接并按 textLength 截尾（MOBI 记录尾部可能含导航数据）
  let total = 0;
  let htmlBytes = new Uint8Array(header.textLength);
  for (const part of parts) {
    const take = Math.min(part.length, header.textLength - total);
    htmlBytes.set(part.subarray(0, take), total);
    total += take;
    if (total >= header.textLength) break;
  }
  const html =
    header.encoding === 1252
      ? latin1Decode(htmlBytes)
      : new TextDecoder('utf-8', { fatal: false }).decode(htmlBytes);
  return { html, bookTitle: extractMobiTitle(records, header.encoding), encoding: header.encoding };
}

function latin1Decode(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** MOBI 标题：EXTH 记录 (type 503) 优先，回退 PalmDB 32 字节名 */
function extractMobiTitle(records: Uint8Array[], encoding: number): string {
  const record0 = records[0];
  try {
    const view = new DataView(record0.buffer, record0.byteOffset, record0.byteLength);
    if (record0.length >= 20 && record0[16] === 0x4d && record0[17] === 0x4f && record0[18] === 0x42 && record0[19] === 0x49) {
      const mobiHeaderLength = view.getUint32(20);
      // EXTH 解析：MOBI header 后紧跟 EXTH（magic 'EXTH'）——按字段定位
      const exthOffset = 16 + mobiHeaderLength + 4;
      if (
        exthOffset + 12 <= record0.length &&
        record0[exthOffset] === 0x45 && record0[exthOffset + 1] === 0x58 &&
        record0[exthOffset + 2] === 0x54 && record0[exthOffset + 3] === 0x48
      ) {
        const count = view.getUint32(exthOffset + 8);
        let cursor = exthOffset + 12;
        for (let i = 0; i < count && cursor + 8 <= record0.length; i++) {
          const type = view.getUint32(cursor);
          const length = view.getUint32(cursor + 4);
          if (length < 12 || cursor + length > record0.length) break;
          if (type === 503) {
            const valueBytes = record0.subarray(cursor + 8, cursor + length);
            const title =
              encoding === 1252 ? latin1Decode(valueBytes) : new TextDecoder('utf-8', { fatal: false }).decode(valueBytes);
            if (title.trim().length > 0) return title.trim();
          }
          cursor += length;
        }
      }
    }
  } catch {
    // 标题解析失败回退
  }
  const nameBytes = record0.subarray(0, 32);
  const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes).replace(/\0+$/, '').trim();
  return name.length > 0 ? name : '未命名';
}

/** MOBI → 结构化文本（章节切分复用 TXT 导入的正则候选由上游处理） */
export function parseMobi(bytes: Uint8Array, stripHtmlImpl: (html: string) => string): MobiParseResult {
  const { html, bookTitle } = extractMobiHtml(bytes);
  const text = stripHtmlImpl(html)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  if (text.length === 0) throw new Error('MOBI 内没有可提取的文本内容');
  // 无结构化章节（MOBI HTML 无稳定标题标记），整本作为单章，由上游"重新分章"提候选
  return {
    bookTitle,
    chapters: [{ title: bookTitle.slice(0, 12) || '全文', text }],
  };
}
