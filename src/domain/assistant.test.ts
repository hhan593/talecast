import { describe, expect, it } from 'vitest';

import { parseResplitProposalBlock } from './assistant';

describe('parseResplitProposalBlock', () => {
  const textLength = 1000;

  it('解析合法候选块', () => {
    const output =
      '好的，这是建议的分章：\n```json\n{"type":"resplit_proposal","chapters":[' +
      '{"title":"第一章","startOffset":0,"endOffset":400},' +
      '{"title":"第二章","startOffset":400,"endOffset":1000}]}\n```\n请审阅后采用。';
    const block = parseResplitProposalBlock(output, textLength);
    expect(block?.chapters).toEqual([
      { title: '第一章', startOffset: 0, endOffset: 400 },
      { title: '第二章', startOffset: 400, endOffset: 1000 },
    ]);
  });

  it('无 JSON 块返回 null', () => {
    expect(parseResplitProposalBlock('直接回答，没有候选。', textLength)).toBeNull();
  });

  it('offset 越界 / 不单调 / 非法 JSON 均拒绝', () => {
    const good = '{"type":"resplit_proposal","chapters":[{"title":"A","startOffset":0,"endOffset":500}]}';
    expect(parseResplitProposalBlock('```json\n' + good.replace('500', '2000') + '\n```', textLength)).toBeNull();
    expect(
      parseResplitProposalBlock(
        '```json\n{"type":"resplit_proposal","chapters":[{"title":"A","startOffset":400,"endOffset":300}]}\n```',
        textLength,
      ),
    ).toBeNull();
    expect(parseResplitProposalBlock('```json\n{"bad json', textLength)).toBeNull();
  });

  it('type 不符或章节数组为空返回 null', () => {
    expect(parseResplitProposalBlock('```json\n{"type":"other","chapters":[]}\n```', textLength)).toBeNull();
    expect(parseResplitProposalBlock('```json\n{"type":"resplit_proposal","chapters":[]}\n```', textLength)).toBeNull();
  });
});
