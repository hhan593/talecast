import { describe, expect, it, vi } from 'vitest';

import { createGenerationService } from './generation';
import { createImportService } from './import';
import { createPlaybackService } from './playback';

import {
  FakeAudioFileStore,
  FakeAudioPlayer,
  FakeBindingRepository,
  FakeSettingsRepository,
  FakeGenerationStore,
  FakeLibraryRepository,
  FakeProjectRepository,
  FakeReceiptStore,
  FakeReadingStateRepository,
  FakeRequestLogRepository,
  FakeSourceFileStore,
  FakeTtsGateway,
  textToBytes,
} from './fakes';

async function setupWithGeneratedChapter() {
  const project = { id: 'p1', title: '示例', description: '', revision: 0, createdAt: 1, updatedAt: 1 };
  const projects = new FakeProjectRepository([project]);
  const library = new FakeLibraryRepository([project]);
  const files = new FakeSourceFileStore();
  const tts = new FakeTtsGateway();
  const audio = new FakeAudioFileStore();
  const bindings = new FakeBindingRepository();
  const generationStore = new FakeGenerationStore();
  const readingStates = new FakeReadingStateRepository();
  const receipts = new FakeReceiptStore();

  const importService = createImportService({
    filePicker: { pickTextFile: async () => null },
    libraryRepository: library,
    sourceFileStore: files,
    receiptStore: receipts,
  });
  const filler = '夜里落了细雨，屋檐下的灯忽明忽暗，街上行人渐渐少了，远处传来更夫的梆子声。';
  await importService.importSource({
    commandId: 'c-import',
    projectId: 'p1',
    fileName: 'n.txt',
    bytes: textToBytes(`第一章 起\n${filler.repeat(30)}第二段在这之后。${filler.repeat(10)}第三段收尾。\n第二章 承\n${filler.repeat(6)}第二章正文收束。`),
  });
  await bindings.upsert({ projectId: 'p1', targetType: 'narrator', targetId: null, voiceId: 'zh-CN-XiaoxiaoNeural', providerParamsJson: '{}' });
  const chapters = await library.listChapters('p1');
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
  const generation = createGenerationService({
    projectRepository: projects,
    libraryRepository: library,
    libraryQuery,
    sourceFileStore: files,
    bindingRepository: bindings,
    generationStore,
    ttsGateway: tts,
    audioFileStore: audio,
    requestLogRepository: new FakeRequestLogRepository(),
    receiptStore: receipts,
    settingsRepository: new FakeSettingsRepository(),
    characterRepository: {
      list: async () => [] as import('@/domain/types').CharacterRecord[],
      get: async () => null,
      insert: async () => undefined,
      update: async () => undefined,
      delete: async () => undefined,
    },
  });
  const started = await generation.startGeneration({ commandId: 'c-gen', projectId: 'p1', chapterId: chapters[0].id });
  if (!started.ok) throw new Error(started.error.message);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const audioPlayer = new FakeAudioPlayer();
  const settingsRepository = new (await import('./fakes')).FakeSettingsRepository();
  const playback = createPlaybackService({
    audioPlayer,
    generationStore,
    libraryQuery,
    settingsRepository,
    readingStateRepository: readingStates,
    generationService: generation,
  });
  return { projects, library, files, generationStore, readingStates, chapters, started, audioPlayer, playback, generation };
}

describe('P3 播放服务', () => {
  it('播放整章：段队列就位、偏移映射单调递增、段尾自动推进', async () => {
    const s = await setupWithGeneratedChapter();
    const states: Array<{ segmentIndex: number; segmentStartOffset: number | null }> = [];
    s.playback.subscribe((state) =>
      states.push({ segmentIndex: state.segmentIndex, segmentStartOffset: state.segmentStartOffset }),
    );

    const played = await s.playback.playChapter('p1', s.chapters[0].id);
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    const total = played.value.segmentCount;
    expect(total).toBeGreaterThanOrEqual(2);

    const state = s.playback.getState();
    expect(state.status).toBe('playing');
    expect(state.queueOffsets.length).toBe(total);
    // 偏移映射单调递增
    for (let i = 1; i < state.queueOffsets.length; i++) {
      expect(state.queueOffsets[i]).toBeGreaterThan(state.queueOffsets[i - 1]);
    }
    expect(s.audioPlayer.loaded.length).toBe(1);

    // 段尾推进到下一段（等待异步 load 完成）
    s.audioPlayer.fireEnd();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.playback.getState().segmentIndex).toBe(1);
    // 最后一段结束后进入 done；若下一章已被预生成（v0.8.0），自动连播接续下一章
    for (let i = 1; i < total; i++) {
      s.audioPlayer.fireEnd();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    const finalState = s.playback.getState();
    const nextJobs = await s.generation.listJobsByChapter('p1', s.chapters[1].id);
    if (nextJobs.some((job) => job.status === 'done')) {
      expect(finalState.status).toBe('playing');
      expect(finalState.chapterId).toBe(s.chapters[1].id);
    } else {
      expect(finalState.status).toBe('done');
    }
  });

  it('seekToSegment：跨段跳转加载对应文件并更新高亮偏移', async () => {
    const s = await setupWithGeneratedChapter();
    const played = await s.playback.playChapter('p1', s.chapters[0].id);
    if (!played.ok) return;
    const total = played.value.segmentCount;

    await new Promise((resolve) => setTimeout(resolve, 10));
    const seeked = await s.playback.seekToSegment(total - 1);
    expect(seeked.ok).toBe(true);
    const state = s.playback.getState();
    expect(state.segmentIndex).toBe(total - 1);
    expect(state.segmentStartOffset).toBe(state.queueOffsets[total - 1]);
    expect(s.audioPlayer.loaded.length).toBe(2); // 初始 + 跳转
  });

  it('本章没有已完成音频时给出明确错误', async () => {
    const s = await setupWithGeneratedChapter();
    const played = await s.playback.playChapter('p1', 'ch-不存在');
    expect(played.ok).toBe(false);
    if (played.ok) return;
    expect(played.error.message).toContain('生成');
  });

  it('播放进度写 reading_state 且不覆盖文本阅读位置', async () => {
    const s = await setupWithGeneratedChapter();
    // 先保存文本阅读位置
    await s.readingStates.set({ projectId: 'p1', chapterId: s.chapters[0].id, charOffset: 123, audioSegmentOrdinal: null, audioOffsetMs: null, readerMode: null, fontSize: null });
    vi.useFakeTimers();
    try {
      await s.playback.playChapter('p1', s.chapters[0].id);
      // loadAndPlay 的写入占满 1500ms 节流窗：推进时间越过窗口后进度写入才生效
      vi.advanceTimersByTime(1500);
      s.audioPlayer.fireProgress(500);
      const state = await s.readingStates.get('p1');
      expect(state).not.toBeNull();
      expect(state!.charOffset).toBe(123); // 文本位置保留
      expect(state!.audioOffsetMs).toBe(500); // 进度回调持久化音频位置
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('v0.8.0 睡眠渐弱与章节预生成', () => {
  it('睡眠到期：音量渐弱 5 步后暂停并恢复音量', async () => {
    const s = await setupWithGeneratedChapter();
    await s.playback.playChapter('p1', s.chapters[0].id);
    vi.useFakeTimers();
    try {
      await s.playback.setSleepTimer('minutes', 1);
      // 轮询 5s 一次，t=60s 到期；渐弱 5 步 × 600ms ≈ 3s 后暂停
      await vi.advanceTimersByTimeAsync(65_000);
      expect(s.playback.getState().status).toBe('paused');
      const vols = s.audioPlayer.volumes;
      expect(vols.slice(-6)).toEqual([1, 0.8, 0.6, 0.4, 0.2, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('取消定时器：渐弱中断、音量立即恢复、不再暂停', async () => {
    const s = await setupWithGeneratedChapter();
    await s.playback.playChapter('p1', s.chapters[0].id);
    vi.useFakeTimers();
    try {
      await s.playback.setSleepTimer('minutes', 1);
      // 推进到 deadline 后第一步渐弱，停在 600ms 等待中
      await vi.advanceTimersByTimeAsync(60_500);
      s.playback.cancelSleepTimer();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(s.playback.getState().status).toBe('playing'); // 未被暂停
      expect(s.audioPlayer.volumes.every((v) => v === 1)).toBe(true); // 从未降到低音量
    } finally {
      vi.useRealTimers();
    }
  });

  it('播放成功触发下一章预生成（连播零等待）', async () => {
    const s = await setupWithGeneratedChapter();
    const played = await s.playback.playChapter('p1', s.chapters[0].id);
    expect(played.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const jobs = await s.generation.listJobsByChapter('p1', s.chapters[1].id);
    expect(jobs.length).toBe(1);
    expect(['pending', 'running', 'done']).toContain(jobs[0].status);
  });
});

describe('v0.11.0 睡眠模式', () => {
  it('播完本段停：段尾暂停并清除睡眠', async () => {
    const s = await setupWithGeneratedChapter();
    await s.playback.playChapter('p1', s.chapters[0].id);
    const set = await s.playback.setSleepTimer('segment');
    expect(set.ok).toBe(true);
    s.audioPlayer.fireEnd();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.playback.getState().status).toBe('paused');
    expect(s.playback.getState().sleepMode).toBeNull();
  });

  it('播完本章停：段内照常推进，章末不自动连播', async () => {
    const s = await setupWithGeneratedChapter();
    const played = await s.playback.playChapter('p1', s.chapters[0].id);
    if (!played.ok) return;
    const total = played.value.segmentCount;
    await s.playback.setSleepTimer('chapter');
    // 段内推进不受影响
    s.audioPlayer.fireEnd();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(s.playback.getState().segmentIndex).toBe(1);
    // 推进到章末
    for (let i = 1; i < total; i++) {
      s.audioPlayer.fireEnd();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    // 章末：不自动连播（即使下一章已预生成），睡眠清除
    expect(s.playback.getState().sleepMode).toBeNull();
    expect(s.playback.getState().status).not.toBe('playing');
  });

  it('取消睡眠：状态清空', async () => {
    const s = await setupWithGeneratedChapter();
    await s.playback.setSleepTimer('minutes', 15);
    expect(s.playback.getState().sleepMode).toBe('minutes');
    s.playback.cancelSleepTimer();
    expect(s.playback.getState().sleepMode).toBeNull();
    expect(s.playback.getState().sleepDeadline).toBeNull();
  });
});
