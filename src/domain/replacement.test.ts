import { describe, expect, it } from 'vitest';

import { applyReplacements, deserializeRules, serializeRules } from './replacement';

describe('applyReplacements', () => {
  it('正则净化页眉广告行', () => {
    const rules = [{ find: '^\\s*[（(]?本章由[\\S\\s]*?[）)]?\\s*$', replace: '', isRegex: true }];
    expect(applyReplacements('正文第一行\n（本章由起点中文网首发）\n正文第二行', rules)).toBe(
      '正文第一行\n\n正文第二行',
    );
  });

  it('字面量替换', () => {
    const rules = [{ find: '广告', replace: '' }];
    expect(applyReplacements('没有广告的内容', rules)).toBe('没有的内容');
  });

  it('无效正则跳过不抛错', () => {
    const rules = [{ find: '[invalid', replace: '', isRegex: true }];
    expect(applyReplacements('原文', rules)).toBe('原文');
  });

  it('空规则列表返回原文', () => {
    expect(applyReplacements('原文', [])).toBe('原文');
  });
});

describe('serializeRules / deserializeRules', () => {
  it('序列化往返一致', () => {
    const rules = [{ find: 'A', replace: 'B', isRegex: false }];
    expect(deserializeRules(serializeRules(rules))).toEqual(rules);
  });

  it('坏 JSON 返回空数组', () => {
    expect(deserializeRules('not-json')).toEqual([]);
  });
});
