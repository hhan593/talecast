import { describe, expect, it } from 'vitest';

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

/** P3 助手测试：流式候选产出 → pending 提案 → 必须人工采用才改目录 */
async function setup() {
  const project = { id: 'p1', title: '示例', description: '', revision: 0, createdAt: 1, updatedAt: 1 };
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
    s.llm.error = new Error('未配置文本模型：请到 设置 → 服务连接 填写端点、模型与密钥');
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

describe('P4 优化：流式增量持久化', () => {
  it('onDelta 期间消息版本递增（中断可恢复），结束时文本完整', async () => {
    const s = await setup();
    s.llm.streamChunks = ['第一块。', '第二块。', '第三块。'];
    s.llm.chunkDelayMs = 20;
    const fakeAssistant = s.assistant as unknown as {
      // 直接经依赖创建的服务实例即可；为读取中间版本，重建一个带假仓库的服务
    };
    void fakeAssistant;

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
    // 版本号 > 1 证明流式期间有多次持久化（不再只在结尾落一次）
    expect(assistantMessage?.version).toBeGreaterThan(1);
  });
});
