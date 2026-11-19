/**
 * 对话式多语音 TTS 的台词检测与说话人归属（docs/design/2026-11-20-v0.9.0-dialogue-voices.md）。
 * 确定性启发式（v1）：引号区/旁白区切分 + 引号邻段人名归属（最长匹配优先）。
 * 纯函数、零请求：同文本 + 同候选 → 同归属；voice spans 拼接覆盖全文
 * （与 chapters / reader 分页同一套不变量）。
 *
 * 检测规则：
 * - 「」『』“”\ " 四种配对；全文级扫描——引号允许跨段（中文小说多段独白常见），
 *   未闭合视作旁白；单引号区超过 500 字按失控引号忽略（防书级 runaway）
 * - 重叠/相接引号区合并
 *
 * 归属规则：
 * - 只在引号外文本找角色名/别名（引号内的称呼如"李明，你来啦"不算说话人）
 * - 归属判据 = 引号区起点与终点所在段落（跨段则覆盖首尾段）内的旁白文本
 * - 命中多个候选时最长匹配名优先（长度相同取出现位置最早）；未命中 → 旁白
 */

export const DIALOGUE_VERSION = 'dv-1';

/** 旁白 voiceKey（generation 里映射为旁白绑定） */
export const NARRATOR_VOICE_KEY = 'narrator';

/** 引号区长度上限：超过视为失控引号（如误配对的远处同形引号），忽略 */
const MAX_QUOTE_SPAN_CHARS = 500;

export interface DialogueCandidate {
  /** 角色 id（作为 voiceKey 传回） */
  key: string;
  /** 角色名 + 别名（空串忽略） */
  names: string[];
}

export interface VoiceSpan {
  /** 章节文本内的字符偏移（半开区间） */
  startOffset: number;
  endOffset: number;
  /** 'narrator' | characterId */
  voiceKey: string;
  text: string;
}

interface QuoteSpan {
  start: number;
  end: number;
}

interface LineRange {
  start: number;
  /** 不含行尾换行符 */
  end: number;
}

const QUOTE_PAIRS: Array<[string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
];

/** 全文引号区：同类型最近闭引号配对；未闭合忽略；跨段允许；超长失控忽略；重叠合并 */
function findQuoteSpans(text: string): QuoteSpan[] {
  const spans: QuoteSpan[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let cursor = 0;
    for (;;) {
      const start = text.indexOf(open, cursor);
      if (start === -1) break;
      const contentStart = start + open.length;
      const end = text.indexOf(close, contentStart);
      if (end === -1) break; // 未闭合：后续不再尝试该引号类型
      if (end + close.length - start > MAX_QUOTE_SPAN_CHARS) {
        // 失控引号：跳过本次配对，从此引号内容之后继续找
        cursor = contentStart;
        continue;
      }
      spans.push({ start, end: end + close.length });
      cursor = end + close.length;
    }
  }
  if (spans.length <= 1) return spans;
  spans.sort((a, b) => a.start - b.start);
  const merged: QuoteSpan[] = [spans[0]];
  for (const span of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push(span);
  }
  return merged;
}

function computeLines(text: string): LineRange[] {
  const lines: LineRange[] = [];
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    lines.push({ start, end });
    if (newline === -1) break;
    start = newline + 1;
  }
  return lines;
}

function lineRangeAt(lines: LineRange[], offset: number): LineRange {
  for (const line of lines) {
    if (offset >= line.start && offset <= line.end) return line;
    if (offset < line.start) return line; // 引号区起点恰在换行符上等边界情形
  }
  return lines[lines.length - 1];
}

/** 归属：在旁白文本中找候选名，最长匹配优先（平局取位置最早）；无命中返回 null */
export function attributeQuote(narrationText: string, candidates: DialogueCandidate[]): string | null {
  let best: { key: string; name: string; index: number } | null = null;
  for (const candidate of candidates) {
    for (const name of candidate.names) {
      if (name.length === 0) continue;
      const index = narrationText.indexOf(name);
      if (index === -1) continue;
      if (
        best === null ||
        name.length > best.name.length ||
        (name.length === best.name.length && index < best.index)
      ) {
        best = { key: candidate.key, name, index };
      }
    }
  }
  return best?.key ?? null;
}

/** 章节 → voice spans（拼接覆盖 chapterText） */
export function planVoiceSpans(
  chapterText: string,
  candidates: DialogueCandidate[],
): VoiceSpan[] {
  if (chapterText.length === 0) return [];
  const quotes = findQuoteSpans(chapterText);
  const lines = computeLines(chapterText);

  // 旁白补集（引号区之外的文本片段）
  const narrationPieces: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const quote of quotes) {
    if (quote.start > cursor) narrationPieces.push({ start: cursor, end: quote.start });
    cursor = quote.end;
  }
  if (cursor < chapterText.length) narrationPieces.push({ start: cursor, end: chapterText.length });

  // 逐引号区归属：判据 = 首尾所在段落（跨段覆盖首尾段）内的旁白文本
  const quoteKeys = quotes.map((quote) => {
    const firstLine = lineRangeAt(lines, quote.start);
    const lastLine = lineRangeAt(lines, quote.end - 1);
    const zoneStart = Math.min(firstLine.start, lastLine.start);
    const zoneEnd = Math.max(firstLine.end, lastLine.end);
    let narration = '';
    for (const piece of narrationPieces) {
      const start = Math.max(piece.start, zoneStart);
      const end = Math.min(piece.end, zoneEnd);
      if (start < end) narration += chapterText.slice(start, end);
    }
    return attributeQuote(narration, candidates) ?? NARRATOR_VOICE_KEY;
  });

  const spans: VoiceSpan[] = [];
  cursor = 0;
  for (let i = 0; i < quotes.length; i++) {
    const quote = quotes[i];
    if (quote.start > cursor) {
      spans.push({
        startOffset: cursor,
        endOffset: quote.start,
        voiceKey: NARRATOR_VOICE_KEY,
        text: chapterText.slice(cursor, quote.start),
      });
    }
    spans.push({
      startOffset: quote.start,
      endOffset: quote.end,
      voiceKey: quoteKeys[i],
      text: chapterText.slice(quote.start, quote.end),
    });
    cursor = quote.end;
  }
  if (cursor < chapterText.length) {
    spans.push({
      startOffset: cursor,
      endOffset: chapterText.length,
      voiceKey: NARRATOR_VOICE_KEY,
      text: chapterText.slice(cursor),
    });
  }
  return spans;
}

export interface VoiceFingerprintEntry {
  /** 'narrator' | characterId */
  key: string;
  voiceId: string;
  providerParamsJson: string;
  /** 绑定修订号：绑定变更 → 指纹变化 → 旧任务失效 */
  revision: number;
}

/**
 * 多声计划指纹（参与 input_hash）：确定性序列化，只含本次计划实际用到的音色。
 * 单声路径不传指纹 → 既有任务哈希完全不变。
 */
export function buildVoicePlanFingerprint(entries: VoiceFingerprintEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({
    version: DIALOGUE_VERSION,
    voices: sorted.map((entry) => ({
      key: entry.key,
      voiceId: entry.voiceId,
      params: entry.providerParamsJson,
      revision: entry.revision,
    })),
  });
}
