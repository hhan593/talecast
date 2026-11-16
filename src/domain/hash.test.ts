import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { sha256Bytes, sha256HexUpper, sha256Text, utf8Bytes } from './hash';

function nodeSha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('sha256', () => {
  it('空输入 / 短输入符合已知摘要', () => {
    expect(sha256Bytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Text('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('与 Node crypto 参照实现一致（随机长度，覆盖多块与填充边界）', () => {
    for (const size of [55, 56, 57, 63, 64, 65, 119, 120, 121, 1000, 65536]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 17) % 256;
      expect(sha256Bytes(bytes)).toBe(nodeSha256Hex(bytes));
    }
  });

  it('中文文本与 Node 一致（UTF-8 编码路径）', () => {
    const text = '第一章 重逢\n山雨欲来风满楼。';
    expect(sha256Text(text)).toBe(nodeSha256Hex(utf8Bytes(text)));
    expect(sha256HexUpper(text)).toBe(nodeSha256Hex(utf8Bytes(text)).toUpperCase());
  });

  it('大输入（约 1MB）一致', () => {
    const bytes = new Uint8Array(1 << 20);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13 + 5) % 256;
    expect(sha256Bytes(bytes)).toBe(nodeSha256Hex(bytes));
  });
});
