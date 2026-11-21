import { describe, expect, it } from 'vitest';


import { base64ToBytes, bytesToBase64 } from './base64';

describe('base64 编解码', () => {
  it('已知向量：RFC 4648 样例', () => {
    const vec: [string, string][] = [
      ['', ''],
      ['f', 'Zg=='],
      ['fo', 'Zm8='],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg=='],
      ['fooba', 'Zm9vYmE='],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [text, b64] of vec) {
      expect(bytesToBase64(new TextEncoder().encode(text))).toBe(b64);
      expect(new TextDecoder().decode(base64ToBytes(b64))).toBe(text);
    }
  });

  it('随机字节往返一致（对照 Node 实现）', () => {
    for (const size of [1, 2, 3, 63, 64, 65, 4096, 65537]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 7 + size) % 256;
      const expected = Buffer.from(bytes).toString('base64');
      expect(bytesToBase64(bytes)).toBe(expected);
      expect(Buffer.from(base64ToBytes(expected)).equals(Buffer.from(bytes))).toBe(true);
    }
  });
});
