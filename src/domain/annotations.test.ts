import { describe, expect, it } from 'vitest';

import {
  assertAnnotationNote,
  assertAnnotationSpan,
  buildAnnotationExcerpt,
  renderAnnotationsMarkdown,
  sliceStyledText,
} from './annotations';

describe('v0.12.0 划线与笔记（domain）', () => {
  it('区间校验：非法/超长/越界拒绝', () => {
    expect(assertAnnotationSpan(10, 5, 100)).toContain('无效');
    expect(assertAnnotationSpan(-1, 10, 100)).toContain('无效');
    expect(assertAnnotationSpan(10, 10 + 2001, 9999)).toContain('最长');
    expect(assertAnnotationSpan(10, 500, 400)).toContain('章节范围');
    expect(assertAnnotationSpan(10, 20, 100)).toBeNull();
  });

  it('笔记长度校验', () => {
    expect(assertAnnotationNote('好句')).toBeNull();
    expect(assertAnnotationNote('长'.repeat(2001))).toContain('最长');
  });

  it('摘录：划线原文 + 前后上下文（空白折叠）', () => {
    const text = '前文铺垫。\n林晚冷声道："滚出去。"\n后文收束。';
    const start = text.indexOf('林晚');
    const end = text.indexOf('滚出去') + 3;
    const result = buildAnnotationExcerpt(text, start, end);
    expect(result.excerpt).toBe('林晚冷声道："滚出去');
    expect(result.contextBefore).toBe('前文铺垫。');
    expect(result.contextAfter).toBe('。" 后文收束。');
  });

  it('Markdown 渲染：按章节分组、笔记可空、确定性', () => {
    const items = [
      { chapterTitle: '第一章', excerpt: '摘录一', note: '写得好', createdAt: 1 },
      { chapterTitle: '第一章', excerpt: '摘录二', note: '', createdAt: 2 },
      { chapterTitle: '第二章', excerpt: '摘录三', note: '记一笔', createdAt: 3 },
    ];
    const a = renderAnnotationsMarkdown('书名', items);
    const b = renderAnnotationsMarkdown('书名', items);
    expect(a).toBe(b);
    expect(a).toContain('## 第一章');
    expect(a).toContain('> 摘录一');
    expect(a).toContain('**笔记**：写得好');
    expect(a).toContain('## 第二章');
    expect(renderAnnotationsMarkdown('空书', [])).toContain('暂无');
  });

  it('sliceStyledText：重叠合并、越界裁剪、顺序切片', () => {
    const text = '一二三四五六七';
    expect(sliceStyledText(text, [])).toEqual([{ text, highlighted: false }]);
    expect(sliceStyledText(text, [{ start: 2, end: 5 }])).toEqual([
      { text: '一二', highlighted: false },
      { text: '三四五', highlighted: true },
      { text: '六七', highlighted: false },
    ]);
    // 重叠合并
    expect(sliceStyledText(text, [
      { start: 1, end: 3 },
      { start: 2, end: 6 },
    ])).toEqual([
      { text: '一', highlighted: false },
      { text: '二三四五六', highlighted: true },
      { text: '七', highlighted: false },
    ]);
    // 越界裁剪
    expect(sliceStyledText(text, [{ start: -5, end: 100 }])).toEqual([
      { text, highlighted: true },
    ]);
  });
});
