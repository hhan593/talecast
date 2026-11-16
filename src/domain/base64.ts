/**
 * 纯 TS base64 编解码（导入原始字节复制 / Edge TTS 音频落盘需要）。
 * 不依赖 btoa/atob：RN Hermes 与 Node 行为一致，vitest 可直接覆盖。
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

const B64_CODES = (() => {
  const codes = new Uint8Array(64);
  for (let i = 0; i < ALPHABET.length; i++) {
    codes[i] = ALPHABET.charCodeAt(i);
  }
  return codes;
})();

const PAD_CODE = 61; // '='

export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const outLen = Math.ceil(len / 3) * 4;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const hasB2 = i + 1 < len;
    const hasB3 = i + 2 < len;
    const b2 = hasB2 ? bytes[i + 1] : 0;
    const b3 = hasB3 ? bytes[i + 2] : 0;
    out[o++] = B64_CODES[b1 >> 2];
    out[o++] = B64_CODES[((b1 & 3) << 4) | (b2 >> 4)];
    out[o++] = hasB2 ? B64_CODES[((b2 & 15) << 2) | (b3 >> 6)] : PAD_CODE;
    out[o++] = hasB3 ? B64_CODES[b3 & 63] : PAD_CODE;
  }
  // 大数组分块转字符串，避免超出 fromCharCode 参数上限
  let text = '';
  for (let start = 0; start < o; start += 0x4000) {
    text += String.fromCharCode(...out.subarray(start, Math.min(start + 0x4000, o)));
  }
  return text;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const padding = clean.length - clean.replace(/=+$/, '').length;
  // 字节数按含 padding 的总长计算：(L/4)*3 - padding
  const byteLength = Math.max((clean.length / 4) * 3 - padding, 0);
  const out = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < clean.length && p < out.length; i++) {
    const v = LOOKUP[clean.charCodeAt(i)];
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}
