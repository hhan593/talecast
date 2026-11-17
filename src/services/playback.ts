import type {
  AudioPlayer,
  GenerationStore,
  LibraryRepository,
  ReadingStateRepository,
  SourceFileStore,
} from '@/domain/ports';
import { err, ok, type Result } from '@/domain/result';


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
  libraryRepository: LibraryRepository;
  sourceFileStore: SourceFileStore;
  readingStateRepository: ReadingStateRepository;
}

export function createPlaybackService(deps: PlaybackDeps) {
  let state: PlaybackState = {
    projectId: null,
    chapterId: null,
    status: 'idle',
    segmentIndex: 0,
    segmentCount: 0,
    segmentStartOffset: null,
    queueOffsets: [],
  };
  const listeners = new Set<(state: PlaybackState) => void>();
  let queue: QueueItem[] = [];
  let queueProjectId: string | null = null;
  let lastPersistMs = 0;

  function setState(patch: Partial<PlaybackState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }

  async function loadAndPlay(index: number): Promise<void> {
    const item = queue[index];
    await deps.audioPlayer.load(item.filePath);
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
    });
  }

  deps.audioPlayer.onProgress((positionMs) => {
    const item = queue[state.segmentIndex];
    if (item && state.status === 'playing') {
      persistPosition(item.ordinal, positionMs);
    }
  });
  deps.audioPlayer.onPlaybackEnd(() => {
    const next = state.segmentIndex + 1;
    if (next < queue.length) {
      void loadAndPlay(next);
    } else {
      setState({ status: 'done' });
    }
  });

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

      const source = await deps.libraryRepository.getSource(projectId);
      if (!source) return err('invalid', '本书还没有导入文本');
      const chapters = await deps.libraryRepository.listChapters(projectId);
      const chapter = chapters.find((c) => c.id === chapterId);
      if (!chapter) return err('not_found', '章节不存在');
      const fullText = await deps.sourceFileStore.readDecodedText(source.textSha256);
      const chapterText = fullText.slice(chapter.startOffset, chapter.endOffset);

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
     * 收编 P2 的独立 PreviewPlayer，消除"试听与整章播放同时出声"的并行音轨。
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
        return err('network', `播放失败：${error instanceof Error ? error.message : String(error)}`);
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
