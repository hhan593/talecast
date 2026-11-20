import { describe, expect, it } from 'vitest';

import { ASSISTANT_CONTEXT_CHAR_LIMIT } from '@/domain/assistant';
import { LlmNotConfiguredError } from '@/domain/result';
import { createAssistantService } from './assistant';
import { createImportService } from './import';
import { createSplitReviewService } from './split-review';
import {
  FakeAssistantRepository,
  FakeLibraryRepository,
  FakeLlmGateway,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeSourceFileStore,
  FakeSplitProposalRepository,
  textToBytes,
} from './fakes';

async function setup() {
  const project = { id: 'p1', title: '示例', description: '', tags: [], revision: 0, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const receipts = new FakeReceiptStore();
  const proposals = new FakeSplitProposalRepository();
  const llm = new FakeLlmGateway();

  const importService = createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  const filler = '夜里落了细雨，屋檐下的灯忽明忽暗。';
  const fullText = `第一章 起\n${filler.repeat(10)}\n第二章 承\n${filler.repeat(10)}\n第三章 转\n${filler.repeat(10)}`;
  await importService.importSource({
    commandId: 'c-import',
    projectId: 'p1',
    fileName: 'n.txt',
    bytes: textToBytes(fullText),
  });

  const assistant = createAssistantService({
    assistantRepository: new FakeAssistantRepository(),
    llmGateway: llm,
    libraryRepository: library,
    sourceFileStore: files,
    splitProposalRepository: proposals,
  });
  const splitReview = createSplitReviewService({
    projectRepository: projects,
    libraryRepository: library,
    splitProposalRepository: proposals,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  return { project, projects, library, files, receipts, proposals, llm, assistant, splitReview };
}

describe('P3 工程助手', () => {
  it('候选产出：写入 pending 提案但不改目录；人工采用后才生效', async () => {
    const s = await setup();
    const source = await s.library.getSource('p1');
    if (!source) throw new Error('no source');
    const text = await s.files.readDecodedText(source.textSha256);
    const textLength = text.length;
    const half = Math.floor(textLength / 2);
    s.llm.response =
      '建议这样重新分章：\n```json\n' +
      `{"type":"resplit_proposal","chapters":[{"title":"上","startOffset":0,"endOffset":${half}},` +
      `{"title":"下","startOffset":${half},"endOffset":${textLength}}]}\n` +
      '```\n请在审阅中采用。';

    const deltas: string[] = [];
    const result = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-send-1',
      userText: '帮我把这本书分成上下两篇',
      onDelta: (delta) => deltas.push(delta),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposalId).not.toBeNull();
    // 流式增量已回调
    expect(deltas.join('')).toContain('resplit_proposal');

    // 候选 pending，目录未被改动
    const proposal = await s.proposals.get(result.value.proposalId!);
    expect(proposal?.status).toBe('pending');
    const chaptersAfterSend = await s.library.listChapters('p1');
    expect(chaptersAfterSend.length).toBe(3); // 仍是导入时的三章

    // 人工采用才生效
    const adopted = await s.splitReview.adoptProposal({
      commandId: 'c-adopt',
      projectId: 'p1',
      proposalId: result.value.proposalId!,
      expectedRevision: s.project.revision,
    });
    expect(adopted.ok).toBe(true);
    const chaptersAfterAdopt = await s.library.listChapters('p1');
    expect(chaptersAfterAdopt.map((c) => c.title)).toEqual(['上', '下']);
  });

  it('未配置文本模型时给出明确指引并落错误消息', async () => {
    const s = await setup();
    s.llm.error = new LlmNotConfiguredError();
    const result = await s.assistant.sendMessage({ projectId: 'p1', commandId: 'c-send-2', userText: '你好' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('未配置文本模型');
    // 错误也进入历史，重进可见
    const messages = await s.assistant.listMessages('p1', { limit: 10 });
    expect(messages.some((m) => m.role === 'assistant' && m.text.includes('未配置文本模型'))).toBe(true);
  });

  it('历史分页：limit/beforeOrdinal 正确翻页', async () => {
    const s = await setup();
    for (let i = 0; i < 5; i++) {
      s.llm.response = `回复 ${i}`;
      await s.assistant.sendMessage({ projectId: 'p1', commandId: `c-${i}`, userText: `问 ${i}` });
    }
    const latest = await s.assistant.listMessages('p1', { limit: 4 });
    expect(latest.length).toBe(4);
    // 每轮一问一答共 10 条：最后 4 条 = 问3/回复3/问4/回复4
    expect(latest[0].text).toBe('问 3');
    expect(latest[3].text).toBe('回复 4');
    const earlier = await s.assistant.listMessages('p1', { limit: 4, beforeOrdinal: latest[0].ordinal });
    expect(earlier.length).toBe(4);
    expect(earlier[0].text).toBe('问 1');
  });
});

describe('助手上下文范围（按章/选段）', () => {
  it('全书概览：只发送目录 + 开头 1200 字，不发送全文', async () => {
    const s = await setup();
    const source = await s.library.getSource('p1');
    if (!source) throw new Error('no source');
    const text = await s.files.readDecodedText(source.textSha256);
    await s.assistant.sendMessage({ projectId: 'p1', commandId: 'c-scope-book', userText: '概括开头' });
    const prompt = s.llm.calls.at(-1)!.user;
    expect(prompt).toContain('章节目录');
    expect(prompt).toContain(text.slice(0, 1200));
    expect(prompt).toContain('开头 1200 字（不发送全书正文）');
    // 文案声明"不发送全书"必须与行为一致：加长正文后提示词仍只含开头片段
    const longText = '头'.repeat(1500) + text + '尾'.repeat(3000);
    await s.files.writeDecodedText(source.textSha256, longText);
    await s.assistant.sendMessage({ projectId: 'p1', commandId: 'c-scope-book-long', userText: '再问' });
    expect(s.llm.calls.at(-1)!.user).not.toContain('尾'.repeat(20));
  });

  it('按章：只发送该章正文（书级偏移），其他章节不进提示词', async () => {
    const s = await setup();
    const source = await s.library.getSource('p1');
    if (!source) throw new Error('no source');
    const text = await s.files.readDecodedText(source.textSha256);
    const chapters = await s.library.listChapters('p1');
    const target = chapters[1];
    const result = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-scope-chapter',
      userText: '这章讲了什么',
      scope: { kind: 'chapter', chapterId: target.id },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prompt = s.llm.calls.at(-1)!.user;
    expect(prompt).toContain(text.slice(target.startOffset, target.endOffset));
    expect(prompt).not.toContain(text.slice(chapters[2].startOffset, chapters[2].startOffset + 10));
    expect(result.value.scopeNotice).toContain(target.title);
    // 历史消息标注本次范围（可追溯）
    const messages = await s.assistant.listMessages('p1', { limit: 10 });
    expect(messages.find((m) => m.text === '这章讲了什么')?.scopeNotice).toContain(target.title);
  });

  it('选段：只发送选中书级区间，越界范围直接拒绝且不调用模型', async () => {
    const s = await setup();
    const source = await s.library.getSource('p1');
    if (!source) throw new Error('no source');
    const text = await s.files.readDecodedText(source.textSha256);
    const chapters = await s.library.listChapters('p1');
    const target = chapters[0];
    const start = target.startOffset + 3;
    const end = start + 12;
    const result = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-scope-selection',
      userText: '解释这段',
      scope: { kind: 'selection', chapterId: target.id, startOffset: start, endOffset: end },
    });
    expect(result.ok).toBe(true);
    const prompt = s.llm.calls.at(-1)!.user;
    expect(prompt).toContain(text.slice(start, end));
    expect(prompt).toContain('选中片段');

    const callsBefore = s.llm.calls.length;
    const invalid = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-scope-invalid',
      userText: '越界',
      scope: { kind: 'selection', chapterId: target.id, startOffset: target.startOffset, endOffset: target.endOffset + 1 },
    });
    expect(invalid.ok).toBe(false);
    expect(s.llm.calls.length).toBe(callsBefore);
  });

  it('局部范围不产出全书分章候选；超长章节截断并告知', async () => {
    const s = await setup();
    const source = await s.library.getSource('p1');
    if (!source) throw new Error('no source');
    const chapters = await s.library.listChapters('p1');
    const longText = '长'.repeat(ASSISTANT_CONTEXT_CHAR_LIMIT + 500);
    await s.files.writeDecodedText(source.textSha256, longText);
    s.library.chapters[0] = { ...chapters[0], endOffset: longText.length };
    s.llm.response =
      '```json\n{"type":"resplit_proposal","chapters":[{"title":"上","startOffset":0,"endOffset":100}]}\n```';
    const result = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-scope-long',
      userText: '分章',
      scope: { kind: 'chapter', chapterId: chapters[0].id },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.proposalId).toBeNull();
    expect(result.value.scopeNotice).toContain(`仅发送前 ${ASSISTANT_CONTEXT_CHAR_LIMIT} 字`);
    const prompt = s.llm.calls.at(-1)!.user;
    expect(prompt.match(/长/g)?.length).toBe(ASSISTANT_CONTEXT_CHAR_LIMIT);
  });
});

describe('P4 优化：流式增量持久化', () => {
  it('onDelta 期间消息版本递增（中断可恢复），结束时文本完整', async () => {
    const s = await setup();
    s.llm.streamChunks = ['第一块。', '第二块。', '第三块。'];
    s.llm.chunkDelayMs = 20;
    const result = await s.assistant.sendMessage({
      projectId: 'p1',
      commandId: 'c-stream',
      userText: '讲讲这个故事',
      onDelta: () => undefined,
    });
    expect(result.ok).toBe(true);
    const messages = await s.assistant.listMessages('p1', { limit: 10 });
    const assistantMessage = messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.text).toContain('第一块。');
    expect(assistantMessage?.text).toContain('第三块。');
    // 结尾至少两次持久化（流式节流 + 收尾），>2 才能捕获"删掉流式期间持久化"的回归
    expect(assistantMessage?.version).toBeGreaterThan(2);
  });
});
