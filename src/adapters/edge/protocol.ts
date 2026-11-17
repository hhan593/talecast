/**
 * Edge TTS 协议纯层（docs/plan.md 5.3 Edge 协议要点）。
 * Sec-MS-GEC 令牌与 WebSocket 帧的组装/解析都是确定性纯函数，
 * 由 gec.test.ts / frames.test.ts 用固定输入覆盖（5.4 录制帧 fixture 思路的离线等价物）。
 * 网络传输（RN WebSocket）在 tts.ts，薄到不做逻辑。
 */

import { EDGE_AUDIO_FORMAT } from '@/domain/contracts';
import { sha256HexUpper } from '@/domain/hash';

/** Edge 官方客户端令牌（公开常量，非密钥） */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E1FB37E23D9EDEDCAAD';

export const WSS_ENDPOINT = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
export const VOICES_ENDPOINT = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list';
export const SEC_MS_GEC_VERSION = '1-130.0.2849.68';

/** 音频输出锁定统一格式（段间播放衔接的前提，docs/plan.md 5.3） */
export { EDGE_AUDIO_FORMAT } from '@/domain/contracts';

/**
 * Sec-MS-GEC：当前 UTC 时间自 1601-01-01 起的毫秒数，向下取整到 5 分钟窗口，
 * 与客户端令牌拼接后 SHA-256 大写十六进制。时钟偏移会导致 403。
 */
export function computeSecMsGec(nowMs: number): string {
  const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_599_991;
  const TICK_WINDOW_MS = 300_000; // 5 分钟
  const ticks = Math.floor((nowMs + WINDOWS_EPOCH_OFFSET_MS) / TICK_WINDOW_MS) * TICK_WINDOW_MS;
  return sha256HexUpper(String(ticks) + TRUSTED_CLIENT_TOKEN);
}

export function buildVoicesListUrl(nowMs: number): string {
  return `${VOICES_ENDPOINT}?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${computeSecMsGec(nowMs)}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
}

export function buildWssUrl(nowMs: string | number, connectionId: string): string {
  const gec = computeSecMsGec(typeof nowMs === 'string' ? Number(nowMs) : nowMs);
  return (
    `${WSS_ENDPOINT}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${connectionId}`
  );
}

export function requestHeaders(): Record<string, string> {
  return {
    'Sec-MS-GEC': computeSecMsGec(Date.now()),
    'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
  };
}

// WebSocket 文本帧组装

export function buildSpeechConfigMessage(): string {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'true' },
          outputFormat: EDGE_AUDIO_FORMAT,
        },
      },
    },
  };
  return `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`;
}

export function buildSsmlMessage(requestId: string, voiceId: string, text: string): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${escapeXml(voiceId)}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;
  return (
    `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml}`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// WebSocket 入站帧解析（二进制音频帧与文本控制帧）

export type EdgeFrame =
  | { kind: 'audio'; bytes: Uint8Array }
  | { kind: 'turnEnd' }
  | { kind: 'turnStart' }
  | { kind: 'response'; headers: Record<string, string> }
  | { kind: 'textFrame'; path: string; body: string };

/** 二进制帧：2 字节大端头长 + 头部（含 Path:audio）+ 音频载荷 */
export function parseBinaryFrame(data: Uint8Array): EdgeFrame {
  if (data.length < 2) return { kind: 'textFrame', path: 'unknown', body: '' };
  const headerLength = (data[0] << 8) | data[1];
  const headerText = new TextDecoder().decode(data.subarray(2, 2 + headerLength));
  const headers = parseHeaderBlock(headerText);
  const path = headers.Path ?? '';
  if (path === 'audio') {
    return { kind: 'audio', bytes: data.subarray(2 + headerLength) };
  }
  return { kind: 'textFrame', path, body: '' };
}

export function parseTextFrame(data: string): EdgeFrame {
  const separator = data.indexOf('\r\n\r\n');
  const headerBlock = separator === -1 ? data : data.slice(0, separator);
  const body = separator === -1 ? '' : data.slice(separator + 4);
  const headers = parseHeaderBlock(headerBlock);
  const path = headers.Path ?? '';
  if (path === 'turn.end') return { kind: 'turnEnd' };
  if (path === 'turn.start') return { kind: 'turnStart' };
  if (path === 'response') return { kind: 'response', headers };
  return { kind: 'textFrame', path, body };
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    headers[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return headers;
}
