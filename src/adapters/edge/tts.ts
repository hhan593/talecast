import * as Crypto from "expo-crypto";
import { fetch } from "expo/fetch";

import {
  buildSsmlMessage,
  buildSpeechConfigMessage,
  buildVoicesListUrl,
  buildWssUrl,
  clientHeaders,
  computeSecMsGec,
  SEC_MS_GEC_VERSION,
  voicesHeaders,
  parseBinaryFrame,
  parseTextFrame,
} from "./protocol";
import { concatBytes } from "@/domain/base64";
import { EDGE_TTS_PROVIDER } from "@/domain/contracts";
import type { TtsGateway } from "@/domain/ports";
import type { TtsProsody } from "@/domain/jobs";
import type { VoiceInfo } from "@/domain/types";

/**
 * Edge TTS 网关（docs/plan.md 5.3 Edge 协议要点）。
 * 协议纯层在 protocol.ts；本文件只做传输与聚合。
 * RN 原生 WebSocket 支持自定义头与 arraybuffer 二进制。
 */

const WS_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const SYNTH_TIMEOUT_MS = 30_000;

/**
 * 设备时钟偏移（毫秒）：Sec-MS-GEC 令牌按 5 分钟窗口推导，
 * 手机时间偏几分钟就会被判 401/403。失败时用服务端 Date 头校准一次。
 */
let clockSkewMs = 0;

function nowMs(): number {
  return Date.now() + clockSkewMs;
}

/** RN WebSocket 运行时支持第三参自定义头，但内置类型未声明 */
type RnWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

function newHexId(): string {
  return Crypto.randomUUID().replace(/-/g, "");
}

interface EdgeVoiceJson {
  ShortName: string;
  Gender: string;
  Locale: string;
  LocaleName?: string;
  FriendlyName?: string;
  Status?: string;
}

/** 服务端 Date 头 → 校准本机时钟；拿不到有效时间时保持原偏移 */
async function calibrateClockFromServer(): Promise<void> {
  try {
    const response = await fetch(buildVoicesListUrl(nowMs()), {
      headers: { ...voicesHeaders(), "Sec-MS-GEC": computeSecMsGec(nowMs()), "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION },
    });
    const serverDate = response.headers.get("date");
    const parsed = serverDate ? Date.parse(serverDate) : Number.NaN;
    if (Number.isFinite(parsed)) clockSkewMs = parsed - Date.now();
  } catch {
    // 校准失败不影响主流程，交给上层给出可操作提示
  }
}

/** "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)" → "Xiaoxiao · Chinese (Mainland)" */
function friendlyLabel(voice: EdgeVoiceJson): string {
  const friendly = voice.FriendlyName ?? "";
  const match = /^Microsoft\s+(.+?)\s+Online(?:\s+\(Natural\))?\s*-\s*(.+)$/.exec(friendly);
  if (match) return `${match[1]} · ${match[2]}`;
  const short = voice.ShortName.split("-");
  return short[short.length - 1]?.replace(/Neural$/, "") ?? voice.ShortName;
}

export class EdgeTtsGateway implements TtsGateway {
  /** 拉取中文音色清单（含粤语/台湾国语与方言音色，应对中英混排） */
  async listVoices(): Promise<VoiceInfo[]> {
    const fetchList = () =>
      fetch(buildVoicesListUrl(nowMs()), {
        headers: {
          ...voicesHeaders(),
          "Sec-MS-GEC": computeSecMsGec(nowMs()),
          "Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
          Pragma: "no-cache",
          "Cache-Control": "no-cache",
        },
      });

    let response = await fetchList();
    // 401/403 多为本机时钟偏移导致令牌窗口错位：校准后重试一次
    if (response.status === 401 || response.status === 403) {
      await calibrateClockFromServer();
      response = await fetchList();
    }
    if (!response.ok) {
      throw new Error(
        `音色列表拉取失败：HTTP ${response.status}` +
          (response.status === 401 || response.status === 403
            ? "（请检查手机系统时间是否准确）"
            : "（网络受限或服务协议变更）"),
      );
    }
    const data = (await response.json()) as EdgeVoiceJson[];
    return data
      .filter((voice) => voice.Locale?.startsWith("zh"))
      .sort((a, b) => {
        const rank = (locale: string) => (locale === "zh-CN" ? 0 : locale.startsWith("zh-CN") ? 1 : 2);
        return rank(a.Locale) - rank(b.Locale) || a.ShortName.localeCompare(b.ShortName);
      })
      .map((voice) => ({
        provider: EDGE_TTS_PROVIDER,
        voiceId: voice.ShortName,
        name: friendlyLabel(voice),
        // 性别用中英并列：音色行是持久化数据，切换界面语言后不会重写，避免只存一种语言
        description: `${voice.Locale} · ${voice.Gender === "Female" ? "女/Female" : "男/Male"}${voice.LocaleName ? ` · ${voice.LocaleName}` : ""}`,
      }));
  }

  /** 合成单段：一次连接 → speech.config + SSML → 聚合音频帧至 turn.end */
  async synthesize(input: {
    text: string;
    voiceId: string;
    prosody?: TtsProsody;
  }): Promise<Uint8Array> {
    return (await this.synthesizeInternal(input)).audio;
  }

  /** 合成 + 词级时间线（v0.13.0 卡拉OK）：协议 wordBoundary 事件随音频一并返回 */
  async synthesizeWithTimeline(input: {
    text: string;
    voiceId: string;
    prosody?: TtsProsody;
  }): Promise<{ audio: Uint8Array; words: { offsetMs: number; durationMs: number; word: string }[] }> {
    return this.synthesizeInternal(input);
  }

  private synthesizeInternal(input: {
    text: string;
    voiceId: string;
    prosody?: TtsProsody;
  }): Promise<{ audio: Uint8Array; words: { offsetMs: number; durationMs: number; word: string }[] }> {
    return this.attemptSynthesize(input).catch(async (error: unknown) => {
      // 握手被拒/连接被关通常是令牌窗口错位：校准时钟后重试一次
      const retryable = error instanceof Error && error.name === "EdgeRetryableError";
      if (!retryable) throw error;
      await calibrateClockFromServer();
      return this.attemptSynthesize(input);
    });
  }

  private attemptSynthesize(input: {
    text: string;
    voiceId: string;
    prosody?: TtsProsody;
  }): Promise<{ audio: Uint8Array; words: { offsetMs: number; durationMs: number; word: string }[] }> {
    const requestId = newHexId();
    const url = buildWssUrl(nowMs(), newHexId());
    const chunks: Uint8Array[] = [];
    const words: { offsetMs: number; durationMs: number; word: string }[] = [];

    return new Promise<{ audio: Uint8Array; words: { offsetMs: number; durationMs: number; word: string }[] }>((resolve, reject) => {
      let settled = false;
      const ws = new (WebSocket as unknown as RnWebSocketConstructor)(
        url,
        undefined,
        {
          headers: {
            ...clientHeaders(),
            Pragma: "no-cache",
            "Cache-Control": "no-cache",
            Origin: WS_ORIGIN,
          },
        },
      );
      ws.binaryType = "arraybuffer";

      const finish = (error?: Error, audio?: Uint8Array) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {}
        if (error) reject(error);
        else resolve({ audio: audio as Uint8Array, words });
      };

      const timeout = setTimeout(() => {
        finish(new Error("合成超时：30 秒未收到音频（网络受限或服务不可用）"));
      }, SYNTH_TIMEOUT_MS);

      ws.onopen = () => {
        ws.send(buildSpeechConfigMessage());
        ws.send(
          buildSsmlMessage(requestId, input.voiceId, input.text, input.prosody),
        );
      };

      ws.onmessage = (event: WebSocketMessageEvent) => {
        if (typeof event.data === "string") {
          const frame = parseTextFrame(event.data);
          if (frame.kind === "turnEnd") {
            const audio = concatBytes(chunks);
            if (audio.length === 0)
              finish(new Error("服务端未返回音频（文本可能为空或被拒绝）"));
            else finish(undefined, audio);
          }
          return;
        }
        const frame = parseBinaryFrame(
          new Uint8Array(event.data as ArrayBuffer),
        );
        if (frame.kind === "audio" && frame.bytes.length > 0) {
          chunks.push(frame.bytes);
        } else if (frame.kind === "wordBoundary") {
          words.push(frame.event);
        }
      };

      ws.onerror = () => {
        if (!settled) {
          const error = new Error("Edge TTS 连接失败：令牌被拒、被限流或网络不可用");
          error.name = "EdgeRetryableError";
          finish(error);
        }
      };

      ws.onclose = () => {
        if (!settled) {
          const error = new Error("连接在合成完成前关闭（令牌可能已过期）");
          error.name = "EdgeRetryableError";
          finish(error);
        }
      };
    });
  }
}
