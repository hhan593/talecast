import { describe, expect, it } from 'vitest';

import { createBindingsService } from './bindings';
import { createGenerationService } from './generation';
import { createVoicesService } from './voices';
import {
  FakeAudioFileStore,
  FakeBindingRepository,
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeRequestLogRepository,
  FakeSourceFileStore,
  FakeTtsGateway,
  FakeGenerationStore,
  textToBytes,
} from './fakes';

/** P2 验收的服务层等价验证（docs/plan.md 6 P2）：段级幂等、重试只补缺失段、试听转正 */
async function setupWithImport() {
  const project = { id: 'p1', title: '示例', description: '', revision: 0, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const tts = new FakeTtsGateway();
  const audio = new FakeAudioFileStore();
  const bindings = new FakeBindingRepository();
  const generationStore = new FakeGenerationStore();
  const requestLog = new FakeRequestLogRepository();
  const receipts = new FakeReceiptStore();

  const importService = (await import('./import')).createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  const filler = '夜里落了细雨，屋檐下的灯忽明忽暗，街上行人渐渐少了，远处传来更夫的梆子声，一声一声敲进心里。';
  const sample =
    '第一章 起\n' +
    // 约 1400 字，确保默认分段上限（1200 字）能切出多段
    `${filler.repeat(30)}第二段在这之后。${filler.repeat(10)}第三段收尾。`;
  const imported = await importService.importSource({
    commandId: 'c-import',
    projectId: 'p1',
    fileName: 'n.txt',
    bytes: textToBytes(sample),
  });
  if (!imported.ok) throw new Error(imported.error.message);

  const voices = createVoicesService({ ttsGateway: tts, voiceRepository: {
    replaceAllForProvider: async () => undefined,
    list: async () => [],
    findByVoiceId: async () => null,
  } as never });
  const bindingsService = createBindingsService({
    bindingRepository: bindings,
    characterRepository: {
      list: async () => [],
      get: async () => null,
      insert: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
    receiptStore: receipts,
  });
  const generation = createGenerationService({
    projectRepository: projects,
    libraryRepository: library,
    sourceFileStore: files,
    bindingRepository: bindings,
    generationStore,
    ttsGateway: tts,
    audioFileStore: audio,
    requestLogRepository: requestLog,
    receiptStore: receipts,
  });

  return { project, projects, library, files, tts, audio, bindings, bindingsService, generationStore, requestLog, receipts, voices, generation };
}

describe('P2 生成任务：段级幂等与重试', () => {
  it('绑定旁白 → 生成：逐段请求，失败后重试只补缺失段', async () => {
    const s = await setupWithImport();
    const bind = await s.bindingsService.bindVoice({
      commandId: 'c-bind',
      projectId: 'p1',
      targetType: 'narrator',
      targetId: null,
      voiceId: 'zh-CN-XiaoxiaoNeural',
    });
    expect(bind.ok).toBe(true);

    const chapters = await s.library.listChapters('p1');
    s.tts.failCallIndexes = [1]; // 第 2 次请求失败（与分段结果解耦）

    const started = await s.generation.startGeneration({
      commandId: 'c-gen-1',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // 等待后台段循环结束（fakes 全部同步 resolve，微任务即可完成）
    await new Promise((resolve) => setTimeout(resolve, 20));

    const progress = await s.generation.getProgress(started.value.jobId);
    expect(progress?.status).toBe('failed');
    const segments = progress?.segments ?? [];
    const doneCount = segments.filter((seg) => seg.status === 'done').length;
    expect(doneCount).toBeGreaterThan(0);
    expect(segments.some((seg) => seg.status === 'failed')).toBe(true);

    // 修复失败源后重试：请求数 = 缺失段数
    s.tts.failCallIndexes = [];
    const requestCountBefore = s.tts.synthCalls.length;
    const retried = await s.generation.retryGeneration({ projectId: 'p1', jobId: started.value.jobId });
    expect(retried.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const after = await s.generation.getProgress(started.value.jobId);
    expect(after?.status).toBe('done');
    const missingCount = (after?.segments ?? []).filter((seg) => seg.status !== 'done').length;
    expect(missingCount).toBe(0);
    expect(s.tts.synthCalls.length - requestCountBefore).toBe(
      (after?.totalSegments ?? 0) - doneCount,
    );
    // 已完成段的音频文件未被重新写入（零重复请求）
    expect(after?.segments.every((seg) => seg.filePath !== null)).toBe(true);
  });

  it('同 input_hash 的已完成任务直接复用，不重新请求', async () => {
    const s = await setupWithImport();
    await s.bindingsService.bindVoice({ commandId: 'c-bind', projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural' });
    const chapters = await s.library.listChapters('p1');
    const first = await s.generation.startGeneration({ commandId: 'c-gen-1', projectId: 'p1', chapterId: chapters[0].id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const callsAfterFirst = s.tts.synthCalls.length;

    const second = await s.generation.startGeneration({ commandId: 'c-gen-2', projectId: 'p1', chapterId: chapters[0].id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.jobId).toBe(first.value.jobId);
    expect(second.value.reusedSegments).toBe(second.value.totalSegments);
    expect(s.tts.synthCalls.length).toBe(callsAfterFirst);
  });

  it('试听转正：试听文件按 text_hash 落盘后，生成首段零请求', async () => {
    const s = await setupWithImport();
    await s.bindingsService.bindVoice({ commandId: 'c-bind', projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural' });
    const chapters = await s.library.listChapters('p1');

    const preview = await s.generation.previewSegment({ projectId: 'p1', chapterId: chapters[0].id });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.cached).toBe(false);
    const callsAfterPreview = s.tts.synthCalls.length;

    const started = await s.generation.startGeneration({ commandId: 'c-gen-1', projectId: 'p1', chapterId: chapters[0].id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.reusedSegments).toBe(1); // 试听段转正
    expect(s.tts.synthCalls.length).toBe(callsAfterPreview + (started.value.totalSegments - 1));
    // 首段文件路径与试听一致（同一 text_hash）
    const progress = await s.generation.getProgress(started.value.jobId);
    expect(progress?.segments[0].filePath).toBe(preview.value.filePath);
    expect(progress?.segments[0].textHash).toBe(preview.value.textHash);
  });

  it('未绑定音色时生成给出明确错误', async () => {
    const s = await setupWithImport();
    const chapters = await s.library.listChapters('p1');
    const result = await s.generation.startGeneration({ commandId: 'c-gen-x', projectId: 'p1', chapterId: chapters[0].id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('绑定音色');
  });

  it('应用重启恢复：运行中任务标记失败且保留已完成段', async () => {
    const s = await setupWithImport();
    await s.bindingsService.bindVoice({ commandId: 'c-bind', projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural' });
    const chapters = await s.library.listChapters('p1');
    const started = await s.generation.startGeneration({ commandId: 'c-gen-1', projectId: 'p1', chapterId: chapters[0].id });
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!started.ok) return;

    const job = await s.generationStore.getJob(started.value.jobId);
    if (!job) return;
    job.status = 'running'; // 模拟重启时仍在运行
    const recovered = await s.generation.recoverInterrupted();
    expect(recovered).toBe(1);
    const after = await s.generationStore.getJob(started.value.jobId);
    expect(after?.status).toBe('failed');
    const segments = await s.generationStore.listSegments(started.value.jobId);
    expect(segments.filter((seg) => seg.status === 'done').length).toBeGreaterThan(0);
  });
});

describe('P2 绑定：人工确认门槛', () => {
  it('角色未确认不能绑定', async () => {
    const receipts = new FakeReceiptStore();
    const characters = {
      list: async () => [],
      get: async (id: string) =>
        id === 'ch1' ? { id: 'ch1', projectId: 'p1', name: '甲', aliasesJson: '[]', profileJson: '{}', confirmed: false, manualProtected: false, createdAt: 1, updatedAt: 1 } : null,
      insert: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    };
    const bindings = createBindingsService({
      bindingRepository: new FakeBindingRepository(),
      characterRepository: characters,
      receiptStore: receipts,
    });
    const result = await bindings.bindVoice({
      commandId: 'c-bind',
      projectId: 'p1',
      targetType: 'character',
      targetId: 'ch1',
      voiceId: 'zh-CN-YunxiNeural',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('人工确认');
  });
});
