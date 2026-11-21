import type {
  AudioPlayer,
  GenerationStore,
  LibraryRepository,
  ReadingStateRepository,
  SettingsRepository,
} from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';
import type { GenerationService } from '@/services/generation';


export type SleepTimerMode = 'minutes' | 'chapter' | 'segment';

export interface PlaybackState {
  projectId: string | null;
  chapterId: string | null;
  status: 'idle' | 'playing' | 'paused' | 'done';
  /** 当前段（0 起，对应段队列） */
  segmentIndex: number;
  segmentCount: number;
  /** 当前段在全文中的起始字符偏移（正文高亮映射） */
  segmentStartOffset: number | null;
  /** 全部段的起始偏移（点段跳转：段落偏移 → 段索引） */
  queueOffsets: number[];
  /** 播放倍速（0.8–2.0，播放端即时生效） */
  rate: number;
  /** 词级卡拉OK（v0.13.0）：当前朗读词的书级偏移；null=无时间线/未在播放 */
  wordHighlight: { start: number; end: number } | null;
  /** 睡眠定时（v0.11.0）：当前生效模式；null=未开启 */
  sleepMode: SleepTimerMode | null;
  /** minutes 模式的到期时间戳；其余模式为 null */
  sleepDeadline: number | null;
}

interface QueueItem {
  ordinal: number;
  filePath: string;
  text: string;
  startOffset: number;
  endOffset: number;
  /** 词级时间线（v0.13.0，加载时读取伴生 JSON；null=无） */
  words: Array<{ offsetMs: number; durationMs: number; word: string }> | null;
}

export interface PlaybackDeps {
  audioPlayer: AudioPlayer;
  audioFileStore?: import('@/domain/ports').AudioFileStore;
  generationStore: GenerationStore;
  libraryQuery: import('@/services/library-query').LibraryQueryService;
  readingStateRepository: ReadingStateRepository;
  settingsRepository: SettingsRepository;
  /** 可选：播放某章后自动预生成下一章（v0.8.0，测试可省略） */
  generationService?: GenerationService;
}

export const PLAYBACK_RATES = [0.8, 1.0, 1.2, 1.5, 2.0] as const;

/** 渐弱时长：5 步 × 600ms ≈ 3 秒，睡眠到期先渐弱再暂停 */
const FADE_STEPS = 5;
const FADE_STEP_MS = 600;

export function createPlaybackService(deps: PlaybackDeps) {
  let state: PlaybackState = {
    projectId: null,
    chapterId: null,
    status: 'idle',
    segmentIndex: 0,
    segmentCount: 0,
    segmentStartOffset: null,
    queueOffsets: [],
    rate: 1,
    wordHighlight: null,
    sleepMode: null,
    sleepDeadline: null,
  };
  const listeners = new Set<(state: PlaybackState) => void>();
  let queue: QueueItem[] = [];
  let queueProjectId: string | null = null;
  let lastPersistMs = 0;
  let rate = 1;
  let sleepTimerHandle: number | null = null;
  /** 渐弱代次：取消/新定时器/新播放使旧渐弱链失效 */
  let fadeGeneration = 0;
  /** 渐弱链在跑 = 定时器已到期；用于区分"过期状态需清理"与"未来定时器仍有效" */
  let fadingOut = false;
  let sleepMode: SleepTimerMode | null = null;

  /** 使当前渐弱链失效；音量/状态语义由调用方负责 */
  function invalidateFade(): void {
    fadeGeneration += 1;
    fadingOut = false;
  }

  /** 新播放入口统一调用（issue #28）：三个播放入口都要失效旧渐弱链 */
  function invalidateFadeForNewPlayback(): void {
    const wasFading = fadingOut;
    invalidateFade();
    if (wasFading) {
      // 定时器已到期但渐弱被新播放打断：清掉过期的睡眠状态（不动未来定时器）
      sleepMode = null;
      setState({ sleepMode: null, sleepDeadline: null });
    }
  }

  function cancelSleepTimerInternal(): void {
    if (sleepTimerHandle !== null) {
      clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }
    sleepMode = null;
    setState({ sleepMode: null, sleepDeadline: null });
    // 取消进行中的渐弱并立即恢复音量（下次播放也兜底重置）
    invalidateFade();
    void deps.audioPlayer.setVolume(1).catch(() => undefined);
  }

  function setState(patch: Partial<PlaybackState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  /** 词级对齐（v0.13.0）：进度 ms → 当前词的书级偏移（词序单调，indexOf 游标累进） */
  function alignWord(item: QueueItem, positionMs: number): { start: number; end: number } | null {
    if (!item.words || item.words.length === 0) return null;
    let cursor = 0;
    for (const word of item.words) {
      if (positionMs < word.offsetMs) break;
      const charIndex = item.text.indexOf(word.word, cursor);
      if (charIndex === -1) continue;
      cursor = charIndex + word.word.length;
      if (positionMs <= word.offsetMs + word.durationMs) {
        return {
          start: item.startOffset + charIndex,
          end: item.startOffset + charIndex + word.word.length,
        };
      }
    }
    return null;
  }

  async function loadAndPlay(index: number): Promise<void> {
    // 新播放使进行中的渐弱链失效（issue #28：渐弱 3 秒窗口内开播新章会被旧链降音量并暂停）
    invalidateFadeForNewPlayback();
    const item = queue[index];
    // 词级时间线随段加载（v0.13.0）：伴生 JSON 读取失败视为无卡拉OK
    if (deps.audioFileStore?.readText) {
      try {
        const raw = await deps.audioFileStore.readText(item.filePath);
        const parsed = JSON.parse(raw) as { words?: Array<{ offsetMs: number; durationMs: number; word: string }> };
        item.words = Array.isArray(parsed.words) ? parsed.words : null;
      } catch {
        item.words = null;
      }
    }
    setState({ wordHighlight: null });
    await deps.audioPlayer.load(item.filePath);
    if (rate !== 1) await deps.audioPlayer.setRate(rate);
    try {
      await deps.audioPlayer.setVolume(1);
    } catch {
      // 音量重置失败不影响播放
    }
    await deps.audioPlayer.play();
    setState({
      status: 'playing',
      segmentIndex: index,
      segmentStartOffset: item.startOffset,
    });
    persistPosition(item.ordinal, 0);
  }

  function persistPosition(segmentOrdinal: number, offsetMs: number): void {
    if (!queueProjectId) return;
    const now = Date.now();
    if (now - lastPersistMs < 1500) return; // 节流
    lastPersistMs = now;
    const chapterId = state.chapterId;
    if (!chapterId) return;
    // 只更新音频位置字段；文本阅读位置（chapter_id/char_offset）由阅读流程维护，互不覆盖
    void deps.readingStateRepository.set({
      projectId: queueProjectId,
      chapterId: null,
      charOffset: null,
      audioSegmentOrdinal: segmentOrdinal,
      audioOffsetMs: Math.round(offsetMs),
      readerMode: null,
      fontSize: null,
    });
  }

  deps.audioPlayer.onProgress((positionMs) => {
    const item = queue[state.segmentIndex];
    if (item && state.status === 'playing') {
      persistPosition(item.ordinal, positionMs);
      // 词级对齐（v0.13.0）：当前词变化才更新状态（避免每秒整树渲染）
      const word = alignWord(item, positionMs);
      const prev = state.wordHighlight;
      if ((word?.start ?? null) !== (prev?.start ?? null) || (word?.end ?? null) !== (prev?.end ?? null)) {
        setState({ wordHighlight: word });
      }
    }
  });
  // 自动连播：queue 完结后按 settings 开关取下一章 done 任务续播（RE-2）
  deps.audioPlayer.onPlaybackEnd(() => {
    const next = state.segmentIndex + 1;
    if (next < queue.length) {
      if (sleepMode === 'segment') {
        // 睡眠"播完本段"：暂停并清除
        void deps.audioPlayer.pause().catch(() => undefined);
        setState({ status: 'paused' });
        cancelSleepTimerInternal();
        return;
      }
      loadAndPlay(next).catch((error) => {
        // 下一段文件被删/播放器报错：终止播放并暴露状态（issue #40）
        setState({ status: 'idle', wordHighlight: null });
        console.error('[playback] 段推进失败', error);
      });
    } else {
      setState({ status: 'done' });
      if (sleepMode === 'chapter') {
        // 睡眠"播完本章"：章末不自动连播，清除后暂停
        cancelSleepTimerInternal();
        return;
      }
      autoNextChapter(state.projectId, state.chapterId).catch((error) => {
        console.error('[playback] 自动连播失败', error);
      });
    }
  });

  /** 组建章播放队列：done 任务段按序回定位全文偏移（playChapter 与自动连播共用） */
  async function buildQueue(projectId: string, chapterId: string): Promise<Result<{ segmentCount: number }>> {
    const jobs = await deps.generationStore.listJobsByChapter(projectId, chapterId);
    const doneJob = jobs.find((job) => job.status === 'done');
    if (!doneJob) return err('invalid', '本章还没有已完成的生成音频，请先点"生成本章"');

    const segments = (await deps.generationStore.listSegments(doneJob.id)).filter(
      (segment) => segment.status === 'done' && segment.filePath !== null,
    );
    if (segments.length === 0) return err('invalid', '本章没有可用音频段');

    const slice = await deps.libraryQuery.readChapterSlice(projectId, chapterId);
    if (!slice) return err('not_found', '章节或来源不存在');
    const { chapter, chapterText } = slice;

    let cursor = 0;
    queue = [];
    for (const segment of segments) {
      const found = chapterText.indexOf(segment.text, cursor);
      const startOffset = found === -1 ? cursor : chapter.startOffset + found;
      const endOffset = startOffset + segment.text.length;
      queue.push({
        ordinal: segment.ordinal,
        filePath: segment.filePath!,
        text: segment.text,
        startOffset,
        endOffset,
        words: null,
      });
      if (found !== -1) cursor = found + segment.text.length;
    }
    queueProjectId = projectId;
    return ok({ segmentCount: queue.length });
  }

  /** 自动连播（RE-2）：queue 完结后取下一章 done 任务续播；开关持久化于 settings */
  async function autoNextChapter(
    projectId: string | null,
    finishedChapterId: string | null,
  ): Promise<void> {
    if (!projectId || !finishedChapterId) return;
    const enabled = await deps.settingsRepository.get('auto-next-chapter');
    // 'false' 为历史遗留值；'off' 来自设置页开关（issue #99）
    if (enabled === 'false' || enabled === 'off') return;
    const chapters = await deps.libraryQuery.listChapters(projectId);
    const currentIndex = chapters.findIndex((c) => c.id === finishedChapterId);
    const nextChapter = chapters[currentIndex + 1];
    if (!nextChapter) return;
    const jobs = await deps.generationStore.listJobsByChapter(projectId, nextChapter.id);
    const doneJob = jobs.find((job) => job.status === 'done');
    if (!doneJob) return; // 下一章未生成：停止（不自动触发生成——生成需用户发起）
    await playChapter(projectId, nextChapter.id, 0);
  }

  /**
   * 播放整章：取该章最近一次 done 任务的全部完成段（按序），
   * 段文本顺序回定位到全文偏移（高亮映射），从 startSegmentIndex 段开始播。
   * 成功后触发下一章预生成（v0.8.0：连播零等待，始终只领先播放进度一章）。
   */
  async function playChapter(
    projectId: string,
    chapterId: string,
    startSegmentIndex = 0,
  ): Promise<Result<{ segmentCount: number }>> {
    const built = await buildQueue(projectId, chapterId);
    if (!built.ok) return built;
    const startIndex = Math.min(Math.max(startSegmentIndex, 0), queue.length - 1);
    setState({
      projectId,
      chapterId,
      segmentCount: queue.length,
      status: 'playing',
      segmentIndex: startIndex,
      segmentStartOffset: queue[startIndex].startOffset,
      queueOffsets: queue.map((item) => item.startOffset),
    });
    await loadAndPlay(startIndex);
    void deps.generationService?.pregenNextChapter(projectId, chapterId);
    return ok({ segmentCount: queue.length });
  }

  /** 睡眠到期：音量渐弱后暂停并恢复音量（代次失效防取消/新播放竞态） */
  async function fadeOutAndPause(): Promise<void> {
    const generation = fadeGeneration;
    fadingOut = true;
    for (let step = FADE_STEPS; step >= 1; step--) {
      if (generation !== fadeGeneration) return; // 期间取消或新播放
      try {
        await deps.audioPlayer.setVolume(step / FADE_STEPS);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, FADE_STEP_MS));
    }
    if (generation !== fadeGeneration) return;
    try {
      await deps.audioPlayer.pause();
    } catch {
      // 暂停失败不阻塞状态更新
    }
    if (generation !== fadeGeneration) {
      // pause() 在途期间开播新章：恢复它，避免旧链误暂停新播放（issue #28）
      try {
        await deps.audioPlayer.play();
      } catch {
        // 恢复失败由新播放链自行兜底
      }
      return;
    }
    setState({ status: 'paused' });
    // 到期即完成：清睡眠状态 + 恢复音量（issue #37）；音量恢复由此处统一负责，
    // 不再在 pause() 后重复 setVolume(1)（此前两次调用只是被测试断言掩盖）
    cancelSleepTimerInternal();
  }

  return {
    getState(): PlaybackState {
      return state;
    },

    subscribe(listener: (state: PlaybackState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    playChapter,

    async pause(): Promise<void> {
      await deps.audioPlayer.pause();
      setState({ status: 'paused' });
    },

    async resume(): Promise<void> {
      // 渐弱 3 秒窗口内点"继续播放"同样不能被旧链接管（issue #28）
      invalidateFadeForNewPlayback();
      await deps.audioPlayer.play();
      setState({ status: 'playing' });
    },

    /** 点段跳转 / 拖动进度到某段起点 */
    async seekToSegment(index: number, offsetMs = 0): Promise<Result<null>> {
      if (queue.length === 0 || state.chapterId === null) return err('invalid', '当前没有播放队列');
      // 跳段是新播放行为：旧渐弱链不得继续降音量/暂停（issue #28）
      invalidateFadeForNewPlayback();
      const clamped = Math.min(Math.max(index, 0), queue.length - 1);
      if (clamped === state.segmentIndex) {
        await deps.audioPlayer.seek(offsetMs);
        return ok(null);
      }
      await deps.audioPlayer.load(queue[clamped].filePath);
      if (offsetMs > 0) await deps.audioPlayer.seek(offsetMs);
      await deps.audioPlayer.play();
      setState({
        segmentIndex: clamped,
        status: 'playing',
        segmentStartOffset: queue[clamped].startOffset,
      });
      return ok(null);
    },

    /**
     * 单文件播放（试听场景）：停掉段队列，独占音频设备。
     */
    async playStandalone(uri: string): Promise<Result<null>> {
      // 试听同样独占音频设备：先失效旧渐弱链（issue #28）
      invalidateFadeForNewPlayback();
      queue = [];
      setState({
        projectId: null,
        chapterId: null,
        status: 'playing',
        segmentIndex: 0,
        segmentCount: 0,
        segmentStartOffset: null,
        queueOffsets: [],
      });
      try {
        await deps.audioPlayer.load(uri);
        await deps.audioPlayer.play();
        return ok(null);
      } catch (error) {
        setState({ status: 'idle' });
        return err('network', `播放失败：${errorMessage(error)}`);
      }
    },

    /**
     * 睡眠定时（v0.11.0）：minutes 到期渐弱暂停；chapter 播完本章停（不自动连播）；
     * segment 播完本段停。cancel 清除。
     */
    async setSleepTimer(mode: SleepTimerMode, minutes?: number): Promise<Result<{ deadline: number | null }>> {
      cancelSleepTimerInternal();
      sleepMode = mode;
      setState({ sleepMode: mode, sleepDeadline: null });
      if (mode === 'minutes') {
        if (!minutes || minutes <= 0 || minutes > 240) {
          cancelSleepTimerInternal();
          return err('invalid', '定时时长需为 1-240 分钟');
        }
        const deadline = Date.now() + minutes * 60_000;
        const tick = (): void => {
          if (Date.now() >= deadline) {
            sleepTimerHandle = null;
            void fadeOutAndPause();
            return;
          }
          sleepTimerHandle = setTimeout(tick, 5000) as unknown as number;
        };
        tick();
        setState({ sleepDeadline: deadline });
        return ok({ deadline });
      }
      return ok({ deadline: null });
    },

    cancelSleepTimer(): void {
      cancelSleepTimerInternal();
    },

    /** 倍速：播放端即时生效，settings 持久化（F-1） */
    async setRate(next: number): Promise<Result<null>> {
      if (next < 0.5 || next > 3) return err('invalid', '倍速超出支持范围');
      rate = next;
      setState({ rate: next });
      try {
        await deps.audioPlayer.setRate(rate);
        await deps.settingsRepository.set('playback-speed', String(rate));
        return ok(null);
      } catch (error) {
        return err('network', `倍速设置失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async restoreRate(): Promise<void> {
      const saved = await deps.settingsRepository.get('playback-speed');
      const parsed = saved === null ? 1 : Number(saved);
      if (Number.isFinite(parsed) && parsed > 0) rate = parsed;
      if (rate !== 1) {
        try {
          await deps.audioPlayer.setRate(rate);
        } catch {
          // 静默：下次播放再应用
        }
      }
    },

    stop(): void {
      deps.audioPlayer.release();
      queue = [];
      setState({ status: 'idle', chapterId: null, segmentIndex: 0, segmentCount: 0, segmentStartOffset: null, queueOffsets: [], wordHighlight: null });
    },
  };
}

export type PlaybackService = ReturnType<typeof createPlaybackService>;
