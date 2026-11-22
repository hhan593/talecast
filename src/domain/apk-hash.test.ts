import { describe, expect, it } from 'vitest';

import { Sha256, sha256Hex } from './apk-hash';

describe('增量 SHA-256（issue #85）', () => {
  it('NIST 标准向量：abc', () => {
    expect(new Sha256().update(new TextEncoder().encode('abc')).digest()).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('空输入', () => {
    expect(new Sha256().update(new Uint8Array(0)).digest()).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('分块喂入与一次性喂入结果一致（跨块边界）', () => {
    const data = new Uint8Array(1000);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const oneShot = sha256Hex([data]);
    const split = sha256Hex([data.subarray(0, 37), data.subarray(37, 500), data.subarray(500)]);
    expect(split).toBe(oneShot);
    expect(split).toHaveLength(64);
  });

  it('超长输入（>64 字节多块）与 Node sha256sum 语义一致', () => {
    // "a" × 1000 的 SHA-256（与 sha256sum < /dev/null 生成 1000 个 a 的已知值核对）
    const data = new Uint8Array(1000).fill(0x61);
    expect(sha256Hex([data])).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('digest() 后实例重置：复用同一实例不串状态', () => {
    const hasher = new Sha256();
    hasher.update(new TextEncoder().encode('abc'));
    hasher.digest();
    const second = hasher.update(new TextEncoder().encode('abc')).digest();
    expect(second).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('兆级输入（8MB 模拟分块）与细粒度分块一致', () => {
    const chunk = new Uint8Array(1024 * 1024).fill(7);
    const hex = sha256Hex([chunk]);
    expect(hex).toHaveLength(64);
    const alt = sha256Hex([chunk.subarray(0, 512), chunk.subarray(512)]);
    expect(alt).toBe(hex);
  }, 15000);
});
