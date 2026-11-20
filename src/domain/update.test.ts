import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  isReleaseNewer,
  parseVersionTag,
  truncateNotes,
} from './update';

describe('parseVersionTag', () => {
  it('忽略前缀 v，解析点分段数字', () => {
    expect(parseVersionTag('v0.19.1')).toEqual([0, 19, 1]);
    expect(parseVersionTag('0.19.1')).toEqual([0, 19, 1]);
    expect(parseVersionTag('V1.2')).toEqual([1, 2]);
    expect(parseVersionTag(' 1.0 ')).toEqual([1, 0]);
  });

  it('非法输入返回 null', () => {
    expect(parseVersionTag('')).toBeNull();
    expect(parseVersionTag('v')).toBeNull();
    expect(parseVersionTag('0.19.x')).toBeNull();
    expect(parseVersionTag('0.19.')).toBeNull();
    expect(parseVersionTag('1..2')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('逐段比较，支持多位数段', () => {
    expect(compareVersions('v0.19.1', 'v0.19.1')).toBe(0);
    expect(compareVersions('v0.20.0', 'v0.19.1')).toBe(1);
    expect(compareVersions('v0.19.1', 'v0.20.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1); // 逐段数字，非字符串
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0);
  });

  it('段数不齐补零', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
    expect(compareVersions('1.1', '1.0.9')).toBe(1);
  });

  it('任一侧非法返回 null', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', '')).toBeNull();
  });
});

describe('isReleaseNewer', () => {
  it('仅远端严格更新时为 true', () => {
    expect(isReleaseNewer('v0.20.0', '0.19.1')).toBe(true);
    expect(isReleaseNewer('v0.19.1', '0.19.1')).toBe(false);
    expect(isReleaseNewer('v0.19.0', '0.19.1')).toBe(false);
  });

  it('任一侧非法 → false（宁可不提示）', () => {
    expect(isReleaseNewer('snapshot', '0.19.1')).toBe(false);
    expect(isReleaseNewer('v0.20.0', 'dev')).toBe(false);
  });
});

describe('truncateNotes', () => {
  it('短文本去空白原样返回', () => {
    expect(truncateNotes('  修复阅读位置  ')).toBe('修复阅读位置');
  });

  it('超长截断并加省略号', () => {
    const long = 'a'.repeat(301);
    expect(truncateNotes(long)).toBe(`${'a'.repeat(300)}…`);
    expect(truncateNotes(long, 10)).toBe(`${'a'.repeat(10)}…`);
  });
});
