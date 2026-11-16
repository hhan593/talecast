/**
 * 不可变来源与导入规则（docs/plan.md 4.1.2 / 5.3 导入流程）。
 * 原文不可变：原始字节按哈希落盘，解码文本单独保存，任何编辑都不改写来源。
 * 双哈希 = raw_sha256（原始字节身份）+ text_sha256（解码文本身份）。
 * 章节以解码文本的字符偏移（JS 字符串索引）表达，基准是解码后的全文。
 */

import { utf8Bytes } from './hash';

/**
 * 严格 UTF-8 校验：拒绝 GB18030/GBK 等（首版明确拒绝并提示转码，docs/plan.md 4.2）。
 * 覆盖超长编码、代理区、越界码点等全部非法形态。
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i];
    if (b <= 0x7f) {
      i += 1;
      continue;
    }
    let continuation = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) {
      continuation = 1;
    } else if (b === 0xe0) {
      continuation = 2;
      lo = 0xa0; // 防超长
    } else if (b >= 0xe1 && b <= 0xec) {
      continuation = 2;
    } else if (b === 0xed) {
      continuation = 2;
      hi = 0x9f; // 防代理区
    } else if (b >= 0xee && b <= 0xef) {
      continuation = 2;
    } else if (b === 0xf0) {
      continuation = 3;
      lo = 0x90; // 防超长
    } else if (b >= 0xf1 && b <= 0xf3) {
      continuation = 3;
    } else if (b === 0xf4) {
      continuation = 3;
      hi = 0x8f; // 防越界（> U+10FFFF）
    } else {
      return false; // 0x80-0xC1、0xF5-0xFF 非法首字节
    }
    if (i + continuation >= n) return false;
    for (let k = 1; k <= continuation; k++) {
      const c = bytes[i + k];
      const min = k === 1 ? lo : 0x80;
      const max = k === 1 ? hi : 0xbf;
      if (c < min || c > max) return false;
    }
    i += continuation + 1;
  }
  return true;
}

/** 校验后的解码；调用方必须先用 isValidUtf8 放行（导入流程保证顺序） */
export function decodeUtf8(bytes: Uint8Array): string {
  if (!isValidUtf8(bytes)) {
    throw new Error('不是有效的 UTF-8 字节序列');
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return utf8Bytes(text);
}

/** 首版单文件上限：16MB（docs/plan.md 4.2 不做 128MiB/一万章大容量目标） */
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export function checkImportSize(byteSize: number): boolean {
  return byteSize <= MAX_IMPORT_BYTES;
}

export interface Paragraph {
  /** 段落文本（不含换行） */
  text: string;
  /** 段落在全文中的起始字符偏移（含章节基准） */
  startOffset: number;
  endOffset: number;
}

/** 章节正文按空行/换行分段；偏移为全文绝对偏移，供阅读位置与高亮映射 */
export function splitParagraphs(chapterText: string, chapterStartOffset: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let offset = 0;
  for (;;) {
    const newline = chapterText.indexOf('\n', offset);
    const lineEnd = newline === -1 ? chapterText.length : newline;
    const raw = chapterText.slice(offset, lineEnd);
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const lead = raw.length - raw.trimStart().length;
      paragraphs.push({
        text: trimmed,
        startOffset: chapterStartOffset + offset + lead,
        endOffset: chapterStartOffset + offset + lead + trimmed.length,
      });
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return paragraphs;
}
