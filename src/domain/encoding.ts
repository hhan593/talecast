/**
 * TXT 导入编码识别与解码（v0.17.0）。
 * Hermes 的原生 TextDecoder 只支持 UTF-8；@exodus/bytes 实现 WHATWG 编码标准且在 Hermes 上测试过，
 * 本模块是唯一解码入口：BOM 优先 → 严格 UTF-8 → 启发式评分（CJK/中文标点/替换字符/控制字符）。
 */

import { TextDecoder } from '@exodus/bytes/encoding.js';

/** UI 与 storage 共用的规范编码名（WHATWG label，避免 GBK/GB2312 等 alias 分散） */
export const SOURCE_ENCODINGS = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'gb18030',
  'big5',
  'shift_jis',
  'euc-jp',
  'windows-1252',
] as const;

export type SourceEncoding = (typeof SOURCE_ENCODINGS)[number];

/** auto=自动识别；其余为手动指定 */
export type EncodingChoice = 'auto' | SourceEncoding;

export interface EncodingDetection {
  encoding: SourceEncoding;
  /** 有 BOM 时为真；BOM 解码后自动剥离 */
  bom: boolean;
  /** 自动识别的把握（UI 文案用） */
  confidence: 'certain' | 'likely' | 'guess';
}

export const ENCODING_LABELS: Record<SourceEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
  gb18030: 'GB18030 / GBK / GB2312',
  big5: 'Big5（繁体）',
  shift_jis: 'Shift_JIS（日文）',
  'euc-jp': 'EUC-JP（日文）',
  'windows-1252': 'Windows-1252（西欧）',
};

/** BOM 嗅探：UTF-8 / UTF-16LE / UTF-16BE；UTF-32 不在支持列表内，不误判 */
export function detectBom(bytes: Uint8Array): { encoding: SourceEncoding; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    // UTF-32LE 的 BOM 是 FF FE 00 00；不支持，按两字节 UTF-16LE 处理会在正文里留下 NUL
    if (bytes.length < 4 || bytes[2] !== 0x00 || bytes[3] !== 0x00) {
      return { encoding: 'utf-16le', length: 2 };
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', length: 2 };
  return null;
}

/** 严格 UTF-8 校验（与 domain/source.ts 同规则，独立实现避免编码模块反向依赖） */
function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b <= 0x7f) {
      i += 1;
      continue;
    }
    let continuation = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) continuation = 1;
    else if (b === 0xe0) { continuation = 2; lo = 0xa0; }
    else if (b >= 0xe1 && b <= 0xec) continuation = 2;
    else if (b === 0xed) { continuation = 2; hi = 0x9f; }
    else if (b >= 0xee && b <= 0xef) continuation = 2;
    else if (b === 0xf0) { continuation = 3; lo = 0x90; }
    else if (b >= 0xf1 && b <= 0xf3) continuation = 3;
    else if (b === 0xf4) { continuation = 3; hi = 0x8f; }
    else return false;
    if (i + continuation >= bytes.length) return false;
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

/** 高频简繁体字：短样本下仅靠 CJK 数量无法区分 GB18030 / Big5 / Shift_JIS */
const COMMON_HAN = new Set(
  '的一是在不了有和人这中大为一个国上以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指幾千万兩國學會東說明時語無爲與這裏來個們說對開關點問題應該發現還沒有從現在前後事情可可以因為所以但是就是不知道自己什麼怎麼樣一個地方'
    .split(''),
);

/** 用候选编码解码前 32KB 评分：中文小说应出现大量常见汉字且几乎没有替换符/控制符 */
function scoreDecoded(text: string): number {
  let score = 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x4e00 && cp <= 0x9fff) {
      cjk += 1;
      score += COMMON_HAN.has(ch) ? 6 : 2;
    } else if (cp === 0xfffd) score -= 30;
    else if (cp >= 0x3000 && cp <= 0x303f) score += 3; // 中文标点（含全角空格）
    else if (cp >= 0xff01 && cp <= 0xff65) score += 2; // 全角标点
    else if (ch === '\n') score += 2;
    else if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) score -= 20;
    else if (cp >= 0x20 && cp <= 0x7e) score += 0.2;
    else if (cp >= 0x00a0 && cp <= 0x024f) score += 0.5; // 西欧重音字母
  }
  return score + Math.min(cjk, 200) * 0.5;
}

function decodeSample(bytes: Uint8Array, encoding: SourceEncoding): string {
  const sample = bytes.length <= 32_768 ? bytes : bytes.subarray(0, 32_768);
  return new TextDecoder(encoding).decode(sample);
}

/**
 * 自动识别 TXT 编码。无 BOM 时 UTF-8 严格校验优先；其余按多候选评分。
 * 启发式不是 100% 可靠（尤其极短文本/纯英文），UI 必须允许手动覆盖。
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  const bom = detectBom(bytes);
  if (bom) return { encoding: bom.encoding, bom: true, confidence: 'certain' };
  if (bytes.length === 0) return { encoding: 'utf-8', bom: false, confidence: 'guess' };
  if (isValidUtf8(bytes)) return { encoding: 'utf-8', bom: false, confidence: 'certain' };

  const candidates: SourceEncoding[] = ['gb18030', 'big5', 'shift_jis', 'euc-jp', 'utf-16le', 'utf-16be', 'windows-1252'];
  let best: SourceEncoding = 'gb18030'; // 中文小说最常见，作为无信号时的默认值
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  for (const candidate of candidates) {
    let score: number;
    try {
      score = scoreDecoded(decodeSample(bytes, candidate));
    } catch {
      score = -Infinity;
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = candidate;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  const confidence = bestScore <= 0 ? 'guess' : bestScore - Math.max(secondScore, 0) >= 20 ? 'likely' : 'guess';
  return { encoding: best, bom: false, confidence };
}

/** 按选择解码 TXT；auto 走 detectEncoding。BOM 由 TextDecoder 按 WHATWG 规则自动剥离 */
export function decodeSourceText(bytes: Uint8Array, choice: EncodingChoice = 'auto'): { text: string; detection: EncodingDetection } {
  const detection = choice === 'auto'
    ? detectEncoding(bytes)
    : { encoding: choice, bom: detectBom(bytes) !== null, confidence: 'certain' as const };
  const decoder = new TextDecoder(detection.encoding);
  return { text: decoder.decode(bytes), detection };
}
