import { describe, expect, it } from 'vitest';

import { createBindingsService } from './bindings';
import { createGenerationService, type GenerationProgress } from './generation';
import { createVoicesService } from './voices';
import {
  FakeAudioFileStore,
  FakeBindingRepository,
  FakeSettingsRepository,
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeRequestLogRepository,
  FakeSourceFileStore,
  FakeTtsGateway,
  FakeGenerationStore,
  textToBytes,
} from './fakes';

/** 轮询等待任务进入终态，避免固定 setTimeout 在并行测试负载下被压缩导致 flaky */
async function waitForJobStatus(
  getProgress: (jobId: string) => Promise<GenerationProgress | null>,
  jobId: string,
  terminal: GenerationProgress['status'][],
  timeoutMs = 2000,
): Promise<GenerationProgress | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getProgress(jobId);
    if (progress && terminal.includes(progress.status)) return progress;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return getProgress(jobId);
}

async function setupWithImport(sampleText?: string) {
  const project = { id: 'p1', title: '示例', description: '', tags: [], revision: 0, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const tts = new FakeTtsGateway();
  const audio = new FakeAudioFileStore();
  const bindings = new FakeBindingRepository();
  const generationStore = new FakeGenerationStore();
  const requestLog = new FakeRequestLogRepository();
  const receipts = new FakeReceiptStore();

  const characterList: import('@/domain/types').CharacterRecord[] = [];
  const characters = {
    list: async () => characterList,
    get: async (id: string) => characterList.find((c) => c.id === id) ?? null,
    insert: async () => undefined,
    update: async () => undefined,
    delete: async () => undefined,
  };

  const importService = (await import('./import')).createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  const libraryQuery = (await import('./library-query')).createLibraryQueryService({
    libraryRepository: library,
    splitProposalRepository: {
      insert: async () => undefined,
      get: async () => null,
      setStatus: async () => undefined,
      setPreviousJson: async () => undefined,
    },
    sourceFileStore: files,
  });
  const filler = '夜里落了细雨，屋檐下的灯忽明忽暗，街上行人渐渐少了，远处传来更夫的梆子声，一声一声敲进心里。';
  const sample = sampleText ??
    '第一章 起\n' +
    // 约 1400 字，确保默认分段上限（1200 字）能切出多段
    `${filler.repeat(30)}第二段在这之后。${filler.repeat(10)}第三段收尾。\n` +
    '第二章 承\n' +
    `${filler.repeat(8)}第二章正文收束。`;
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
    characterRepository: characters,
    receiptStore: receipts,
  });
  const settings = new FakeSettingsRepository();
  const generation = createGenerationService({
    projectRepository: projects,
    libraryRepository: library,
    libraryQuery,
    settingsRepository: settings,
    characterRepository: characters,
    sourceFileStore: files,
    bindingRepository: bindings,
    generationStore,
    ttsGateway: tts,
    audioFileStore: audio,
    requestLogRepository: requestLog,
    receiptStore: receipts,
  });

  return { project, projects, library, files, tts, audio, bindings, bindingsService, generationStore, requestLog, receipts, voices, settings, generation, characterList };
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

  it('试听转正：试听文件按 text_hash 落盘后，生成时该段零请求复用（v0.9.0 试听取计划首个有意义段，不一定为第 0 段）', async () => {
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
    // 试听段与任务段同 text_hash、同文件（转正复用）
    const jobSegments = await s.generationStore.listSegments(started.value.jobId);
    const previewed = jobSegments.find((seg) => seg.textHash === preview.value.textHash);
    expect(previewed).toBeDefined();
    expect(previewed!.filePath).toBe(preview.value.filePath);
  });

  it('未绑定音色时自动使用默认旁白音色（无需先配置）', async () => {
    const s = await setupWithImport();
    const chapters = await s.library.listChapters('p1');
    const result = await s.generation.startGeneration({ commandId: 'c-gen-x', projectId: 'p1', chapterId: chapters[0].id });
    expect(result.ok).toBe(true);
    // 自动写入的绑定可被角色中心读取与更换
    const binding = await s.bindingsService.listBindings('p1');
    const narrator = binding.find((item) => item.targetType === 'narrator');
    expect(narrator?.voiceId).toBe('zh-CN-XiaoxiaoNeural');
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

describe('P4 优化：取消与级联删除', () => {
  it('取消生成：已完成段保留，任务标记失败，重试续跑到完成', async () => {
    const s = await setupWithImport();
    await s.bindingsService.bindVoice({ commandId: 'c-bind', projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural' });
    const chapters = await s.library.listChapters('p1');
    s.tts.synthDelayMs = 120; // 放慢合成，为取消留出时间窗

    const started = await s.generation.startGeneration({ commandId: 'c-gen-1', projectId: 'p1', chapterId: chapters[0].id });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await new Promise((resolve) => setTimeout(resolve, 150)); // 首段完成、次段进行中
    const cancelled = await s.generation.cancelGeneration({ projectId: 'p1', jobId: started.value.jobId });
    expect(cancelled.ok).toBe(true);

    const afterCancel = await waitForJobStatus(s.generation.getProgress, started.value.jobId, ['failed', 'done']);
    expect(afterCancel?.status).toBe('failed');
    expect(afterCancel?.error).toContain('已取消');
    const doneAfterCancel = (afterCancel?.segments ?? []).filter((seg) => seg.status === 'done').length;
    expect(doneAfterCancel).toBeGreaterThan(0);

    // 重试（不再延迟）→ 续跑到完成，且不重复请求已完成段
    s.tts.synthDelayMs = 0;
    const retried = await s.generation.retryGeneration({ projectId: 'p1', jobId: started.value.jobId });
    expect(retried.ok).toBe(true);
    const after = await waitForJobStatus(s.generation.getProgress, started.value.jobId, ['done']);
    expect(after?.status).toBe('done');
    expect(after?.segments.every((seg) => seg.status === 'done')).toBe(true);
  });

  it('已完成任务取消返回 busy', async () => {
    const s = await setupWithImport();
    await s.bindingsService.bindVoice({ commandId: 'c-bind', projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural' });
    const chapters = await s.library.listChapters('p1');
    const started = await s.generation.startGeneration({ commandId: 'c-gen-1', projectId: 'p1', chapterId: chapters[0].id });
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!started.ok) return;
    const result = await s.generation.cancelGeneration({ projectId: 'p1', jobId: started.value.jobId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('busy');
  });
});

describe('v0.8.0 章节预生成', () => {
  const bindNarrator = async (s: Awaited<ReturnType<typeof setupWithImport>>) => {
    const bind = await s.bindingsService.bindVoice({
      commandId: 'c-bind',
      projectId: 'p1',
      targetType: 'narrator',
      targetId: null,
      voiceId: 'zh-CN-XiaoxiaoNeural',
    });
    expect(bind.ok).toBe(true);
  };

  it('下一章无任务时自动建任务（连播零等待）', async () => {
    const s = await setupWithImport();
    await bindNarrator(s);
    const chapters = await s.library.listChapters('p1');
    expect(chapters.length).toBeGreaterThanOrEqual(2);

    await s.generation.pregenNextChapter('p1', chapters[0].id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const jobs = await s.generation.listJobsByChapter('p1', chapters[1].id);
    expect(jobs.length).toBe(1);
    expect(['pending', 'running', 'done']).toContain(jobs[0].status);
  });

  it('下一章已有任务（任意状态）时跳过', async () => {
    const s = await setupWithImport();
    await bindNarrator(s);
    const chapters = await s.library.listChapters('p1');
    const started = await s.generation.startGeneration({
      commandId: 'c-manual-next',
      projectId: 'p1',
      chapterId: chapters[1].id,
    });
    expect(started.ok).toBe(true);

    await s.generation.pregenNextChapter('p1', chapters[0].id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const jobs = await s.generation.listJobsByChapter('p1', chapters[1].id);
    expect(jobs.length).toBe(1); // 未重复建任务
  });

  it('开关 auto-pregen-next=false 时不生成', async () => {
    const s = await setupWithImport();
    await bindNarrator(s);
    s.settings.map.set('auto-pregen-next', 'false');
    const chapters = await s.library.listChapters('p1');

    await s.generation.pregenNextChapter('p1', chapters[0].id);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const jobs = await s.generation.listJobsByChapter('p1', chapters[1].id);
    expect(jobs.length).toBe(0);
  });

  it('最后一章无下一章：静默返回', async () => {
    const s = await setupWithImport();
    await bindNarrator(s);
    const chapters = await s.library.listChapters('p1');
    const last = chapters[chapters.length - 1];
    await expect(s.generation.pregenNextChapter('p1', last.id)).resolves.toBeUndefined();
    const jobs = await s.generation.listJobsByChapter('p1', chapters[0].id);
    expect(jobs.length).toBe(0);
  });
});

describe('v0.9.0 对话分声', () => {
  /** 含引号台词与角色归属的章节样本 */
  const dialogueSample =
    '第一章 对话\n' +
    '林晚推门而入，冷声道："谁允许你们进来的？"\n' +
    `丫鬟吓得跪在地上，连连磕头。${'夜里落了细雨。'.repeat(30)}\n` +
    '林晚皱眉："起来，带我去正厅。"\n' +
    '两人一前一后出了院子。';

  async function setupDialogue() {
    const s = await setupWithImport(dialogueSample);
    const bind = await s.bindingsService.bindVoice({
      commandId: 'c-bind',
      projectId: 'p1',
      targetType: 'narrator',
      targetId: null,
      voiceId: 'zh-CN-XiaoxiaoNeural',
    });
    expect(bind.ok).toBe(true);
    s.characterList.push({
      id: 'char-1',
      projectId: 'p1',
      name: '林晚',
      aliasesJson: '[]',
      profileJson: '{}',
      confirmed: true,
      manualProtected: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const charBind = await s.bindingsService.bindVoice({
      commandId: 'c-bind-char',
      projectId: 'p1',
      targetType: 'character',
      targetId: 'char-1',
      voiceId: 'zh-CN-YunxiNeural',
    });
    expect(charBind.ok).toBe(true);
    return s;
  }

  it('引号台词归角色音色，旁白用旁白音色', async () => {
    const s = await setupDialogue();
    const chapters = await s.library.listChapters('p1');
    const started = await s.generation.startGeneration({
      commandId: 'c-gen-dv',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));

    const segments = await s.generationStore.listSegments(started.value.jobId);
    const dialogueSeg = segments.find((seg) => seg.text.includes('谁允许你们进来的'));
    expect(dialogueSeg).toBeDefined();
    expect(dialogueSeg!.voiceId).toBe('zh-CN-YunxiNeural');
    const narrationSeg = segments.find((seg) => seg.text.includes('推门而入'));
    expect(narrationSeg).toBeDefined();
    expect(narrationSeg!.voiceId).toBe('zh-CN-XiaoxiaoNeural');
    // 引号内人名不作为归属判据（只扫引号外）
    expect(segments.every((seg) => seg.voiceId !== null)).toBe(true);
  });

  it('对话分声关闭：全部段回落旁白音色', async () => {
    const s = await setupDialogue();
    s.settings.map.set('dialogue-voices:p1', 'off');
    const chapters = await s.library.listChapters('p1');
    const started = await s.generation.startGeneration({
      commandId: 'c-gen-single',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const segments = await s.generationStore.listSegments(started.value.jobId);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((seg) => seg.voiceId === 'zh-CN-XiaoxiaoNeural')).toBe(true);
  });

  it('角色绑定变更（revision+1）→ input_hash 变化 → 建新任务', async () => {
    const s = await setupDialogue();
    const chapters = await s.library.listChapters('p1');
    const first = await s.generation.startGeneration({
      commandId: 'c-gen-1st',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));

    const rebound = await s.bindingsService.bindVoice({
      commandId: 'c-bind-char-2',
      projectId: 'p1',
      targetType: 'character',
      targetId: 'char-1',
      voiceId: 'zh-CN-XiaoxiaoNeural',
    });
    expect(rebound.ok).toBe(true);

    const second = await s.generation.startGeneration({
      commandId: 'c-gen-2nd',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.jobId).not.toBe(first.value.jobId);
  });

  it('台词段失败后重试：只补缺失段且沿用段级音色（非任务音色）', async () => {
    const s = await setupDialogue();
    const chapters = await s.library.listChapters('p1');
    // 注入失败：台词段（角色音色）合成失败，旁白段成功
    s.tts.failTextIncludes = ['谁允许你们进来的'];
    const started = await s.generation.startGeneration({
      commandId: 'c-gen-fail',
      projectId: 'p1',
      chapterId: chapters[0].id,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const failed = await s.generation.getProgress(started.value.jobId);
    expect(failed?.status).toBe('failed');
    const dialogueCalls = s.tts.synthCalls.filter((call) => call.includes('谁允许你们进来的'));
    expect(dialogueCalls.length).toBe(1);
    expect(dialogueCalls[0].startsWith('zh-CN-YunxiNeural:')).toBe(true); // 首次即角色音色

    // 重试：清失败注入 → 补全部缺失段（失败段 + 其后未请求段），台词段仍用角色音色（来自段记录，非 job.voiceId）
    s.tts.failTextIncludes = [];
    const callsBeforeRetry = s.tts.synthCalls.length;
    const missingCount = (failed?.segments ?? []).filter((seg) => seg.status !== 'done').length;
    expect(missingCount).toBeGreaterThan(1); // 失败段之后还有未请求段
    const retried = await s.generation.retryGeneration({ projectId: 'p1', jobId: started.value.jobId });
    expect(retried.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = await s.generation.getProgress(started.value.jobId);
    expect(after?.status).toBe('done');
    expect(s.tts.synthCalls.length).toBe(callsBeforeRetry + missingCount);
    const dialogueRetry = s.tts.synthCalls
      .slice(callsBeforeRetry)
      .filter((call) => call.includes('谁允许你们进来的'));
    expect(dialogueRetry.length).toBe(1);
    expect(dialogueRetry[0].startsWith('zh-CN-YunxiNeural:')).toBe(true);
  });
});
