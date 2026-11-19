import * as Crypto from "expo-crypto";
import { fetch } from "expo/fetch";

import {
  buildSsmlMessage,
  buildSpeechConfigMessage,
  buildWssUrl,
  buildVoicesListUrl,
  parseBinaryFrame,
  parseTextFrame,
  requestHeaders,
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
  LocalName: string;
  DisplayName: string;
  Locale: string;
  Gender: string;
  VoiceType: string;
}

export class EdgeTtsGateway implements TtsGateway {
  /** 拉取中文音色清单（含多语种音色，应对中英混排） */
  async listVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(buildVoicesListUrl(Date.now()), {
      headers: {
        ...requestHeaders(),
        Pragma: "no-cache",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) {
      throw new Error(
        `音色列表拉取失败：HTTP ${response.status}（可能时钟偏移或协议变更）`,
      );
    }
    const data = (await response.json()) as EdgeVoiceJson[];
    return data
      .filter((voice) => voice.Locale.startsWith("zh"))
      .map((voice) => ({
        provider: EDGE_TTS_PROVIDER,
        voiceId: voice.ShortName,
        name: `${voice.LocalName}（${voice.Locale}）`,
        description: `${voice.DisplayName} · ${voice.Gender} · ${voice.VoiceType}`,
      }));
  }

  /** 合成单段：一次连接 → speech.config + SSML → 聚合音频帧至 turn.end */
  async synthesize(input: {
    text: string;
    voiceId: string;
    prosody?: TtsProsody;
  }): Promise<Uint8Array> {
    const requestId = newHexId();
    const url = buildWssUrl(Date.now(), newHexId());
    const chunks: Uint8Array[] = [];

    return new Promise<Uint8Array>((resolve, reject) => {
      let settled = false;
      const ws = new (WebSocket as unknown as RnWebSocketConstructor)(
        url,
        undefined,
        {
          headers: {
            Pragma: "no-cache",
            "Cache-Control": "no-cache",
            Origin: WS_ORIGIN,
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
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
        else resolve(audio as Uint8Array);
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
        }
      };

      ws.onerror = () => {
        if (!settled) {
          finish(
            new Error("Edge TTS 连接失败：协议可能已变更、被限流或网络不可用"),
          );
        }
      };

      ws.onclose = () => {
        if (!settled) {
          finish(new Error("连接在合成完成前关闭"));
        }
      };
    });
  }
}
