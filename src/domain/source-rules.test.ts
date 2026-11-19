import { describe, expect, it } from 'vitest';

import { parseBookSourceRule } from './source-rules';

describe('parseBookSourceRule', () => {
  it('解析单个书源（Legado JSON 子集）', () => {
    const json = JSON.stringify({
      sourceName: '示例源',
      sourceUrl: 'https://example.com',
      ruleSearch: { bookList: 'class.book', name: 'h3' },
      ruleContent: { content: '#content' },
    });
    const parsed = parseBookSourceRule(json);
    expect(parsed).toEqual([
      { sourceName: '示例源', sourceUrl: 'https://example.com', hasSearch: true, hasToc: false, hasContent: true },
    ]);
  });

  it('数组输入', () => {
    const json = JSON.stringify([
      { sourceName: 'A', sourceUrl: 'https://a.com' },
      { sourceName: 'B', sourceUrl: 'https://b.com', ruleToc: { chapterList: 'dd' } },
    ]);
    const parsed = parseBookSourceRule(json);
    expect(parsed?.length).toBe(2);
    expect(parsed?.[1].hasToc).toBe(true);
  });

  it('缺必填字段/坏 JSON 返回 null', () => {
    expect(parseBookSourceRule('{"sourceName":"A"}')).toBeNull();
    expect(parseBookSourceRule('not-json')).toBeNull();
  });
});
