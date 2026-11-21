import { describe, expect, it } from 'vitest';

import { generateSecMsGecV2, SEC_MS_GEC_VERSION } from './edge-drm';

/**
 * 官方向量：由 edge-tts 的 drm.py（Python 参考实现）在同一时刻生成。
 * 令牌算法改了哈希常数，无法用标准 SHA-256 交叉验证，只能用抓包/参考实现的固定值回归。
 */
const VECTORS: [number, string][] = [
  [1791888000, '492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876'],
  [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
  [1763000000, '3689BC1F78238B9A-DD2A2B71647FAA9B316154E46E5EEA92B85708C5C753EC77984ED8A78A848763'],
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [1763650923, 'A8F64CA43366CB4A-6EF85BA521FBB54B91A2823DA7FAF7C0E5569398304886840F9ECBE93246656D'],
];

describe('generateSecMsGecV2', () => {
  it.each(VECTORS)('时刻 %i 与参考实现逐字节一致', (seconds, expected) => {
    expect(generateSecMsGecV2(seconds)).toBe(expected);
  });

  it('同一 5 分钟窗口内令牌相同，跨窗口变化', () => {
    const base = 1_763_650_800; // 窗口起点
    expect(generateSecMsGecV2(base)).toBe(generateSecMsGecV2(base + 299));
    expect(generateSecMsGecV2(base)).not.toBe(generateSecMsGecV2(base + 300));
  });

  it('格式为 16 位 CS64 + 64 位 SHA256 大写十六进制', () => {
    expect(generateSecMsGecV2(1791888000)).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });

  it('版本串与令牌代次一致（v2）', () => {
    expect(SEC_MS_GEC_VERSION.startsWith('2-')).toBe(true);
  });
});
