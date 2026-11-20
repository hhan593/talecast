/**
 * Edge TTS 协议纯层（docs/plan.md 5.3 Edge 协议要点）。
 * Sec-MS-GEC 令牌与 WebSocket 帧的组装/解析都是确定性纯函数，
 * protocol.test.ts 用固定输入离线覆盖；网络传输（RN WebSocket）在 tts.ts，薄到不做逻辑。
 */

import { EDGE_AUDIO_FORMAT } from "@/domain/contracts";
import type { TtsProsody } from "@/domain/jobs";
import {
  CHROMIUM_MAJOR_VERSION,
  generateSecMsGecV2,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
} from "@/domain/edge-drm";

export {
  CHROMIUM_FULL_VERSION,
  CHROMIUM_MAJOR_VERSION,
  SEC_MS_GEC_VERSION,
  TRUSTED_CLIENT_TOKEN,
} from "@/domain/edge-drm";

export const WSS_ENDPOINT =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
export const VOICES_ENDPOINT =
  "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list";

/** 音频输出锁定统一格式（段间播放衔接的前提，docs/plan.md 5.3） */

/**
 * Sec-MS-GEC v2：5 分钟窗口的时间戳 + 客户端令牌，经改制 SHA-256 与 CS64 双哈希。
 * 实现见 domain/edge-drm.ts（官方 drm.py 的逐位移植，含抓包向量回归）。
 */
export function computeSecMsGec(nowMs: number): string {
  return generateSecMsGecV2(Math.floor(nowMs / 1000));
}

/** Edge 客户端指纹头：服务端会校验 UA 与令牌版本串一致 */
export function clientHeaders(): Record<string, string> {
  return {
    "User-Agent":
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
      `Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** 音色列表额外要求的客户端提示头（缺 Sec-CH-UA 会被判为非 Edge 客户端） */
export function voicesHeaders(): Record<string, string> {
  return {
    ...clientHeaders(),
    Authority: "speech.platform.bing.com",
    "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${CHROMIUM_MAJOR_VERSION}", "Chromium";v="${CHROMIUM_MAJOR_VERSION}"`,
    "Sec-CH-UA-Mobile": "?0",
    Accept: "*/*",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

export function buildVoicesListUrl(nowMs: number): string {
  return `${VOICES_ENDPOINT}?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${computeSecMsGec(nowMs)}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
}

export function buildWssUrl(
  nowMs: string | number,
  connectionId: string,
): string {
  const gec = computeSecMsGec(
    typeof nowMs === "string" ? Number(nowMs) : nowMs,
  );
  return (
    `${WSS_ENDPOINT}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${connectionId}`
  );
}

export function requestHeaders(): Record<string, string> {
  return {
    ...clientHeaders(),
    "Sec-MS-GEC": computeSecMsGec(Date.now()),
    "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
  };
}

// WebSocket 文本帧组装

export function buildSpeechConfigMessage(): string {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "true",
          },
          outputFormat: EDGE_AUDIO_FORMAT,
        },
      },
    },
  };
  return `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`;
}

function prosodyAttrs(prosody?: TtsProsody): string {
  if (!prosody) return " pitch='+0Hz' rate='+0%' volume='+0%'";
  const rate = prosody.rate ?? "+0%";
  const pitch = prosody.pitch ?? "+0%";
  const volume = prosody.volume ?? "+0%";
  return ` rate='${rate}' pitch='${pitch}' volume='${volume}'`;
}

export function buildSsmlMessage(
  requestId: string,
  voiceId: string,
  text: string,
  prosody?: TtsProsody,
): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${escapeXml(voiceId)}'><prosody${prosodyAttrs(prosody)}>${escapeXml(text)}</prosody></voice></speak>`;
  return (
    `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n${ssml}`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// WebSocket 入站帧解析（二进制音频帧与文本控制帧）

/** 词级时间线事件（v0.13.0 卡拉OK）：Edge 协议 offset/duration 单位为 100ns */
export interface WordBoundaryEvent {
  offsetMs: number;
  durationMs: number;
  word: string;
}

export type EdgeFrame =
  | { kind: "audio"; bytes: Uint8Array }
  | { kind: "wordBoundary"; event: WordBoundaryEvent }
  | { kind: "turnEnd" }
  | { kind: "turnStart" }
  | { kind: "response"; headers: Record<string, string> }
  | { kind: "textFrame"; path: string; body: string };

/** 二进制帧：2 字节大端头长 + 头部（含 Path:audio / Path:audio.metadata）+ 载荷 */
export function parseBinaryFrame(data: Uint8Array): EdgeFrame {
  if (data.length < 2) return { kind: "textFrame", path: "unknown", body: "" };
  const headerLength = (data[0] << 8) | data[1];
  const headerText = new TextDecoder().decode(
    data.subarray(2, 2 + headerLength),
  );
  const headers = parseHeaderBlock(headerText);
  const path = headers.Path ?? "";
  if (path === "audio") {
    return { kind: "audio", bytes: data.subarray(2 + headerLength) };
  }
  if (path === "audio.metadata") {
    try {
      const payload = JSON.parse(
        new TextDecoder().decode(data.subarray(2 + headerLength)),
      ) as { type?: string; offset?: number; duration?: number; text?: { Word?: string; Length?: number } };
      if (payload.type === "WordBoundary" && typeof payload.offset === "number") {
        return {
          kind: "wordBoundary",
          event: {
            // 100ns 单位 → 毫秒
            offsetMs: Math.round(payload.offset / 10_000),
            durationMs: Math.round((payload.duration ?? 0) / 10_000),
            word: payload.text?.Word ?? "",
          },
        };
      }
      return { kind: "textFrame", path, body: "" };
    } catch {
      return { kind: "textFrame", path, body: "" };
    }
  }
  return { kind: "textFrame", path, body: "" };
}

export function parseTextFrame(data: string): EdgeFrame {
  const separator = data.indexOf("\r\n\r\n");
  const headerBlock = separator === -1 ? data : data.slice(0, separator);
  const body = separator === -1 ? "" : data.slice(separator + 4);
  const headers = parseHeaderBlock(headerBlock);
  const path = headers.Path ?? "";
  if (path === "turn.end") return { kind: "turnEnd" };
  if (path === "turn.start") return { kind: "turnStart" };
  if (path === "response") return { kind: "response", headers };
  return { kind: "textFrame", path, body };
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    headers[line.slice(0, colon)] = line.slice(colon + 1);
  }
  return headers;
}
