import type {
  AudioPlayer,
  GenerationStore,
  LibraryRepository,
  ReadingStateRepository,
  SourceFileStore,
} from '@/domain/ports';
import { errorMessage, err, ok, type Result } from '@/domain/result';


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
}

interface QueueItem {
  ordinal: number;
  filePath: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface PlaybackDeps {
  audioPlayer: AudioPlayer;
  generationStore: GenerationStore;
  libraryQuery: import('@/services/library-query').LibraryQueryService;
  readingStateRepository: ReadingStateRepository;
  settingsRepository: import('@/domain/ports').SettingsRepository;
}

export const PLAYBACK_RATES = [0.8, 1.0, 1.2, 1.5, 2.0] as const;

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
  };
  const listeners = new Set<(state: PlaybackState) => void>();
  let queue: QueueItem[] = [];
  let queueProjectId: string | null = null;
  let lastPersistMs = 0;
  let rate = 1;

  function setState(patch: Partial<PlaybackState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function loadAndPlay(index: number): Promise<void> {
    const item = queue[index];
    await deps.audioPlayer.load(item.filePath);
    if (rate !== 1) await deps.audioPlayer.setRate(rate);
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
    }
  });
  // 自动连播：queue 完结后按 settings 开关取下一章 done 任务续播（RE-2）
  deps.audioPlayer.onPlaybackEnd(() => {
    const next = state.segmentIndex + 1;
    if (next < queue.length) {
      void loadAndPlay(next);
    } else {
      setState({ status: 'done' });
      void autoNextChapter(state.projectId, state.chapterId);
    }
  });

  /** 自动连播（RE-2）：queue 完结后取下一章 done 任务续播；开关持久化于 settings */
  async function autoNextChapter(
    projectId: string | null,
    finishedChapterId: string | null,
  ): Promise<void> {
    if (!projectId || !finishedChapterId) return;
    const enabled = await deps.settingsRepository.get('auto-next-chapter');
    if (enabled === 'false') return;
    const chapters = await deps.libraryQuery.listChapters(projectId);
    const currentIndex = chapters.findIndex((c) => c.id === finishedChapterId);
    const nextChapter = chapters[currentIndex + 1];
    if (!nextChapter) return;
    const jobs = await deps.generationStore.listJobsByChapter(projectId, nextChapter.id);
    const doneJob = jobs.find((job) => job.status === 'done');
    if (!doneJob) return; // 下一章未生成：停止（不自动触发生成——生成需用户发起）
    await playChapterById(projectId, nextChapter.id, 0);
  }

  /** 按章节 id 播放（独立函数：autoNextChapter 与返回对象方法共用） */
  async function playChapterById(
    projectId: string,
    chapterId: string,
    startSegmentIndex: number,
  ): Promise<Result<{ segmentCount: number }>> {
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
      });
      if (found !== -1) cursor = found + segment.text.length;
    }
    queueProjectId = projectId;
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
    return ok({ segmentCount: queue.length });
  }

  return {
    getState(): PlaybackState {
      return state;
    },

    subscribe(listener: (state: PlaybackState) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * 播放整章：取该章最近一次 done 任务的全部完成段（按序），
     * 段文本顺序回定位到全文偏移（高亮映射），从 startSegmentIndex 段开始播。
     */
    async playChapter(projectId: string, chapterId: string, startSegmentIndex = 0): Promise<Result<{ segmentCount: number }>> {
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
        });
        if (found !== -1) cursor = found + segment.text.length;
      }
      queueProjectId = projectId;
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
      return ok({ segmentCount: queue.length });
    },

    async pause(): Promise<void> {
      await deps.audioPlayer.pause();
      setState({ status: 'paused' });
    },

    async resume(): Promise<void> {
      await deps.audioPlayer.play();
      setState({ status: 'playing' });
    },

    /** 点段跳转 / 拖动进度到某段起点 */
    async seekToSegment(index: number, offsetMs = 0): Promise<Result<null>> {
      if (queue.length === 0 || state.chapterId === null) return err('invalid', '当前没有播放队列');
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
      setState({ status: 'idle', chapterId: null, segmentIndex: 0, segmentCount: 0, segmentStartOffset: null, queueOffsets: [] });
    },
  };
}

export type PlaybackService = ReturnType<typeof createPlaybackService>;
