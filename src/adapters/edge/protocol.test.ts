import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  buildSsmlMessage,
  buildSpeechConfigMessage,
  computeSecMsGec,
  parseBinaryFrame,
  parseTextFrame,
} from "./protocol";

/** 手写二进制帧字节夹具：独立构造，不与被测的 parseBinaryFrame 共享组装逻辑 */
function binaryFrameFixture(
  headerText: string,
  payload: Uint8Array,
): Uint8Array {
  const headerBytes = new TextEncoder().encode(headerText);
  const out = new Uint8Array(2 + headerBytes.length + payload.length);
  out[0] = (headerBytes.length >> 8) & 0xff;
  out[1] = headerBytes.length & 0xff;
  out.set(headerBytes, 2);
  out.set(payload, 2 + headerBytes.length);
  return out;
}

describe("computeSecMsGec", () => {
  it("与社区算法参照一致（固定时刻，5 分钟窗口取整）", () => {
    // 参照实现：ticks = floor((ms + 11644473599991) / 300000) * 300000；GEC = SHA256(ticks + TOKEN) 大写
    const TOKEN = "6A5AA1D4EAFF4E1FB37E23D9EDEDCAAD";
    const reference = (ms: number) => {
      const ticks = Math.floor((ms + 11644473599991) / 300000) * 300000;
      return createHash("sha256")
        .update(String(ticks) + TOKEN)
        .digest("hex")
        .toUpperCase();
    };
    for (const ms of [
      0, 1_700_000_000_000, 1_799_999_999_999, 299_999, 300_000, 300_001,
    ]) {
      expect(computeSecMsGec(ms)).toBe(reference(ms));
    }
  });

  it("同一 5 分钟窗口内令牌相同，跨窗口变化", () => {
    // 窗口相位：Windows 纪元偏移 11644473599991 mod 300000 = 299991，真实窗口边界在 k*300000+9
    const windowStart = 1_700_000_100_009;
    const a = computeSecMsGec(windowStart);
    const b = computeSecMsGec(windowStart + 299_999);
    const c = computeSecMsGec(windowStart + 300_000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("WS 帧组装/解析对称", () => {
  it("speech.config 含输出格式与 Path", () => {
    const message = buildSpeechConfigMessage();
    expect(message).toContain("Path:speech.config");
    expect(message).toContain("audio-24khz-48kbitrate-mono-mp3");
  });

  it("SSML 帧转义文本并带 Path:ssml", () => {
    const message = buildSsmlMessage(
      "req-1",
      "zh-CN-XiaoxiaoNeural",
      '他说："你好 & 再见"',
    );
    expect(message).toContain("Path:ssml");
    expect(message).toContain("zh-CN-XiaoxiaoNeural");
    // 仅 XML 特殊字符转义：引号与 & ；中文本身不转义
    expect(message).toContain("&quot;你好 &amp; 再见&quot;");
    expect(message).not.toContain(" & ");
    expect(message).not.toContain('"你好');
  });

  it("二进制音频帧解析：头部剥离，载荷完整", () => {
    const payload = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
    const header =
      "X-RequestId:req-2\r\nContent-Type:application/octet-stream\r\nPath:audio\r\n";
    const frame = binaryFrameFixture(header, payload);
    const parsed = parseBinaryFrame(frame);
    expect(parsed.kind).toBe("audio");
    if (parsed.kind !== "audio") return;
    expect(Array.from(parsed.bytes)).toEqual(Array.from(payload));
  });

  it("文本控制帧：turn.end / turn.start / response", () => {
    expect(parseTextFrame("X-RequestId:1\r\nPath:turn.end\r\n\r\n").kind).toBe(
      "turnEnd",
    );
    expect(parseTextFrame("Path:turn.start\r\n\r\n").kind).toBe("turnStart");
    const response = parseTextFrame('Path:response\r\n\r\n{"a":1}');
    expect(response.kind).toBe("response");
  });

  it("非 audio 的二进制帧按 textFrame 处理", () => {
    const frame = binaryFrameFixture("Path:turn.end\r\n", new Uint8Array(0));
    expect(parseBinaryFrame(frame).kind).toBe("textFrame");
  });
});

describe('v0.13.0 词级时间线（audio.metadata 帧）', () => {
  function metadataFrame(json: object): Uint8Array {
    const header = `X-RequestId:1\r\nContent-Type:application/json; charset=utf-8\r\nPath:audio.metadata\r\n\r\n`;
    const headerBytes = new TextEncoder().encode(header);
    const body = new TextEncoder().encode(JSON.stringify(json));
    const out = new Uint8Array(2 + headerBytes.length + body.length);
    out[0] = (headerBytes.length >> 8) & 0xff;
    out[1] = headerBytes.length & 0xff;
    out.set(headerBytes, 2);
    out.set(body, 2 + headerBytes.length);
    return out;
  }

  it('WordBoundary 事件解析：100ns → ms', () => {
    const frame = parseBinaryFrame(metadataFrame({
      type: 'WordBoundary',
      offset: 51_500_000, // 5150ms
      duration: 2_100_000, // 210ms
      text: { Word: '林晚', Length: 2 },
    }));
    expect(frame.kind).toBe('wordBoundary');
    if (frame.kind !== 'wordBoundary') return;
    expect(frame.event).toEqual({ offsetMs: 5150, durationMs: 210, word: '林晚' });
  });

  it('非 WordBoundary 元数据/坏 JSON 退化为 textFrame', () => {
    const sentence = parseBinaryFrame(metadataFrame({ type: 'SentenceBoundary', offset: 1 }));
    expect(sentence.kind).toBe('textFrame');
    const broken = parseBinaryFrame(metadataFrame({ broken: true, offset: 'x' }));
    expect(broken.kind).toBe('textFrame');
  });
});
