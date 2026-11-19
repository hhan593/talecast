import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AssistantView } from '@/components/workbench/assistant-view';
import { EditDialog } from '@/components/edit-dialog';
import { MARGINS, ReaderView, type HighlightRange } from '@/components/workbench/reader-view';
import { useAssistant } from '@/hooks/use-assistant';
import { useBookSearch } from '@/hooks/use-book-search';
import { useBookmarks } from '@/hooks/use-bookmarks';
import { useGeneration } from '@/hooks/use-generation';
import { useLibrary } from '@/hooks/use-library';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { usePlayback } from '@/hooks/use-playback';
import { useProject } from '@/hooks/use-project';
import { useServices } from '@/container';
import { type Paragraph } from '@/domain/source';
import type { Chapter } from '@/domain/types';

export default function ProjectWorkbenchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id;
  const { project, loading, notFound } = useProject(projectId);
  const services = useServices();
  const library = useLibrary(projectId, project?.revision ?? -1);
  const generation = useGeneration(projectId);
  const router = useRouter();

  const playback = usePlayback(projectId);
  const assistant = useAssistant(projectId);
  const bookmarks = useBookmarks(projectId);
  const bookSearch = useBookSearch(projectId);
  const [view, setView] = useState<'chapters' | 'reader' | 'assistant'>('chapters');
  const [readerMode, setReaderMode] = useState<'scroll' | 'paged'>('scroll');
  const [readerFontSize, setReaderFontSize] = useState<'small' | 'standard' | 'large' | 'xlarge'>('standard');
  const [readerLineSpacing, setReaderLineSpacing] = useState<'compact' | 'standard' | 'relaxed'>('standard');
  const [readerParagraphSpacing, setReaderParagraphSpacing] = useState<'compact' | 'standard' | 'relaxed'>('standard');
  const [readerIndent, setReaderIndent] = useState(true);
  const [readerJustify, setReaderJustify] = useState(true);
  const [readerMargin, setReaderMargin] = useState<'narrow' | 'standard' | 'wide'>('standard');
  const [readerTheme, setReaderTheme] = useState<'paper' | 'green' | 'white' | 'night'>('paper');
  const [pageTurnStyle, setPageTurnStyle] = useState<'slide' | 'cover' | 'curl'>('slide');
  const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(null);
  const [catalogView, setCatalogView] = useState<'chapters' | 'bookmarks' | 'search'>('chapters');
  const [searchInput, setSearchInput] = useState('');
  const [dialogueVoices, setDialogueVoices] = useState(true);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<'off' | 'slow' | 'standard' | 'fast'>('off');
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [current, setCurrent] = useState<{
    chapter: Chapter;
    chapterText: string;
    paragraphs: Paragraph[];
  } | null>(null);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [lastPageOffset, setLastPageOffset] = useState(-1);
  const [restored, setRestored] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: 'rename'; chapterId: string; title: string; initial: string }
    | { kind: 'split'; chapterId: string; title: string; initial: string }
    | { kind: 'boundary'; chapterId: string; title: string; initial: string }
    | null
  >(null);
  const lastSaveRef = useRef(0);
  const orientation = services.screenOrientation;

  // 阅读屏开放横屏（manual-reading-plan §4.4）；离开恢复竖屏
  useEffect(() => {
    if (view !== 'reader') return;
    void orientation.allowAll();
    return () => {
      void orientation.lockPortrait();
    };
  }, [view, orientation]);

  // 自动滚屏（v0.10.0）：滚动模式 + 速度档驱动；离开阅读/切模式/关闭即停
  const autoScroll = useAutoScroll({
    enabled: autoScrollSpeed !== 'off',
    fontSize: readerFontSize,
    lineSpacing: readerLineSpacing,
    marginPx: MARGINS[readerMargin],
    contentHeight: 600,
  });
  useEffect(() => {
    if (view === 'reader' && readerMode === 'scroll' && autoScrollSpeed !== 'off' && !autoScrollPaused) {
      autoScroll.start();
    } else {
      autoScroll.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, readerMode, autoScrollSpeed, autoScrollPaused, readerFontSize, readerLineSpacing, readerMargin]);

  // 阅读会话统计（v0.10.0）：进入阅读计时，离开/切视图结算时长与字数
  const readerSessionRef = useRef<{ at: number; startOffset: number } | null>(null);
  const lastKnownOffsetRef = useRef(0);
  useEffect(() => {
    if (view === 'reader') {
      readerSessionRef.current = { at: Date.now(), startOffset: lastKnownOffsetRef.current };
      return () => {
        const session = readerSessionRef.current;
        if (!session) return;
        const durationMs = Date.now() - session.at;
        const charsRead = Math.max(0, lastKnownOffsetRef.current - session.startOffset);
        readerSessionRef.current = null;
        void services.stats.recordSession(durationMs, charsRead);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // 打开工程恢复上次阅读位置（4.1.1）：直接回到上次阅读的章节与偏移
  const openChapterRef = useRef<(chapterId: string, charOffset?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    if (restored || !library.chapters || library.chapters.length === 0) return;
    setRestored(true);
    void services.reading.restoreReaderPrefs(projectId).then((prefs) => {
      setReaderMode(prefs.mode);
      setReaderFontSize(prefs.fontSize);
    });
    void services.settings.getSetting('reader-line-spacing').then((v) => {
      if (v === 'compact' || v === 'standard' || v === 'relaxed') setReaderLineSpacing(v);
    });
    void services.settings.getSetting('reader-margin').then((v) => {
      if (v === 'narrow' || v === 'standard' || v === 'wide') setReaderMargin(v);
    });
    void services.settings.getSetting('reader-paragraph-spacing').then((v) => {
      if (v === 'compact' || v === 'standard' || v === 'relaxed') setReaderParagraphSpacing(v);
    });
    void services.settings.getSetting('reader-indent').then((v) => setReaderIndent(v !== 'off'));
    void services.settings.getSetting('reader-align').then((v) => setReaderJustify(v !== 'off'));
    void services.settings.getSetting(`dialogue-voices:${projectId}`).then((v) => setDialogueVoices(v !== 'off'));
    void services.settings.getSetting('reader-theme').then((v) => {
      if (v === 'paper' || v === 'green' || v === 'white' || v === 'night') setReaderTheme(v);
    });
    void services.settings.getPageTurnStyle().then(setPageTurnStyle);
    void services.reading.restorePosition(projectId, library.chapters).then((position) => {
      if (!position || position.charOffset === 0) return; // 无历史位置/在开头 → 停留目录
      void openChapterRef.current(position.chapterId, position.charOffset);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.chapters, restored, projectId, services]);

  const openChapter = useCallback(
    async (chapterId: string, charOffset = 0) => {
      const result = await services.reading.getChapterText(projectId, chapterId);
      if (!result.ok) {
        library.setError(result.error.message);
        return;
      }
      setCurrent({
        chapter: result.value.chapter,
        chapterText: result.value.chapterText,
        paragraphs: result.value.paragraphs,
      });
      setPendingOffset(charOffset);
      setView('reader');
    },
    [projectId, services, library],
  );
  openChapterRef.current = openChapter;

  // 章节导航（v0.8.0）：上一章/下一章/拖动条跳章；跳章清除搜索高亮
  const chapters = library.chapters ?? [];
  const chapterIndex = current ? chapters.findIndex((c) => c.id === current.chapter.id) : -1;
  const goChapterDelta = useCallback(
    (delta: number) => {
      if (chapterIndex < 0) return;
      const target = chapters[chapterIndex + delta];
      if (!target) return;
      setHighlightRange(null);
      void openChapter(target.id, target.startOffset);
    },
    [chapters, chapterIndex, openChapter],
  );
  const seekChapter = useCallback(
    (index: number) => {
      const target = chapters[index];
      if (!target) return;
      setHighlightRange(null);
      void openChapter(target.id, target.startOffset);
    },
    [chapters, openChapter],
  );
  const getChapterTitle = useCallback(
    (index: number) => chapters[index]?.title ?? '',
    [chapters],
  );

  // 点段跳转 / 正文跟随（docs/plan.md P3：拖动进度/切章后高亮跟随）
  const seekToParagraph = useCallback(
    async (paragraph: Paragraph) => {
      const st = services.playback.getState();
      if (st.chapterId !== current?.chapter.id || st.queueOffsets.length === 0) {
        if (!current) return;
        const played = await playback.playChapter(current.chapter.id);
        if (!played.ok) return;
      }
      const offsets = services.playback.getState().queueOffsets;
      let index = 0;
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i] <= paragraph.startOffset) index = i;
      }
      await playback.seekToSegment(index);
    },
    [current, playback, projectId, services],
  );

  const saveReadingPosition = useCallback(
    (chapterId: string, charOffset: number) => {
      const now = Date.now();
      if (now - lastSaveRef.current < 1500) return; // 节流
      lastSaveRef.current = now;
      void services.reading.savePosition(projectId, chapterId, charOffset);
    },
    [projectId, services],
  );

  const paragraphs = current?.paragraphs ?? [];
  const initialIndex = useMemo(() => {
    if (pendingOffset <= 0) return undefined;
    const index = paragraphs.findIndex((p) => p.startOffset > pendingOffset) - 1;
    return index >= 0 ? index : 0;
  }, [paragraphs, pendingOffset]);
  // 按文本长度估算行高：滚动定位精度优于固定值（长段/短段混合的章节尤其明显）
  const layout = useMemo(() => {
    const lengths = paragraphs.map((p) => Math.ceil(p.text.length / 22) * 24 + 16);
    const offsets: number[] = [];
    let acc = 0;
    for (const length of lengths) {
      offsets.push(acc);
      acc += length;
    }
    return { lengths, offsets };
  }, [paragraphs]);

  const viewableCallbackRef = useRef<((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null>(null);
  viewableCallbackRef.current = (info) => {
    const first = info.viewableItems[0];
    if (first?.item && current && view === 'reader' && readerMode === 'scroll') {
      lastKnownOffsetRef.current = (first.item as Paragraph).startOffset;
      saveReadingPosition(current.chapter.id, (first.item as Paragraph).startOffset);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }
  if (notFound || !project) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-paper-night">
        <Text className="text-base text-ink dark:text-ink-night">这本书不存在或已被删除</Text>
        <Pressable className="rounded-xl bg-accent px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">返回书架</Text>
        </Pressable>
      </View>
    );
  }

  // ------------------------------------------------------------------ 正文视图
  if (view === 'reader' && current) {
    return (
      <ReaderView
        chapterTitle={current.chapter.title}
        chapterText={current.chapterText}
        chapterBaseOffset={current.chapter.startOffset}
        mode={readerMode}
        fontSize={readerFontSize}
        followPlayback={true}
        paragraphs={current.paragraphs}
        lineSpacing={readerLineSpacing}
        paragraphSpacing={readerParagraphSpacing}
        indentEnabled={readerIndent}
        justifyEnabled={readerJustify}
        margin={readerMargin}
        theme={readerTheme}
        pageTurnStyle={pageTurnStyle}
        initialOffset={pendingOffset}
        highlightOffset={
          playback.state.chapterId === current.chapter.id ? playback.state.segmentStartOffset : null
        }
        highlightRange={highlightRange}
        playingThisChapter={playback.state.chapterId === current.chapter.id}
        playbackStatus={playback.state.status}
        playbackRate={playback.state.rate}
        segmentIndex={playback.state.segmentIndex}
        segmentCount={playback.state.segmentCount}
        chapterIndex={Math.max(chapterIndex, 0)}
        chapterCount={chapters.length}
        getChapterTitle={getChapterTitle}
        hasPrevChapter={chapterIndex > 0}
        hasNextChapter={chapterIndex >= 0 && chapterIndex < chapters.length - 1}
        onPrevChapter={() => goChapterDelta(-1)}
        onNextChapter={() => goChapterDelta(1)}
        onSeekChapter={seekChapter}
        onViewableItems={(info) => viewableCallbackRef.current?.(info)}
        onBack={() => {
          setHighlightRange(null);
          setView('chapters');
        }}
        onPlayChapter={() => void playback.playChapter(current.chapter.id)}
        onPause={() => void playback.pause()}
        onResume={() => void playback.resume()}
        onCycleRate={() => {
          const rates = [0.8, 1.0, 1.2, 1.5, 2.0];
          const next = rates[(rates.indexOf(playback.state.rate) + 1) % rates.length];
          void playback.setRate(next);
        }}
        onCycleFontSize={() => {
          const cycle: Array<'small' | 'standard' | 'large' | 'xlarge'> = [
            'small',
            'standard',
            'large',
            'xlarge',
          ];
          const next = cycle[(cycle.indexOf(readerFontSize) + 1) % cycle.length];
          setReaderFontSize(next);
          void services.reading.saveReaderPrefs(projectId, readerMode, next);
        }}
        onCycleLineSpacing={() => {
          const cycle: Array<'compact' | 'standard' | 'relaxed'> = ['compact', 'standard', 'relaxed'];
          const next = cycle[(cycle.indexOf(readerLineSpacing) + 1) % cycle.length];
          setReaderLineSpacing(next);
          void services.settings.setSetting('reader-line-spacing', next);
        }}
        onCycleParagraphSpacing={() => {
          const cycle: Array<'compact' | 'standard' | 'relaxed'> = ['compact', 'standard', 'relaxed'];
          const next = cycle[(cycle.indexOf(readerParagraphSpacing) + 1) % cycle.length];
          setReaderParagraphSpacing(next);
          void services.settings.setSetting('reader-paragraph-spacing', next);
        }}
        onToggleIndent={() => {
          const next = !readerIndent;
          setReaderIndent(next);
          void services.settings.setSetting('reader-indent', next ? 'on' : 'off');
        }}
        onToggleJustify={() => {
          const next = !readerJustify;
          setReaderJustify(next);
          void services.settings.setSetting('reader-align', next ? 'on' : 'off');
        }}
        onCycleMargin={() => {
          const cycle: Array<'narrow' | 'standard' | 'wide'> = ['narrow', 'standard', 'wide'];
          const next = cycle[(cycle.indexOf(readerMargin) + 1) % cycle.length];
          setReaderMargin(next);
          void services.settings.setSetting('reader-margin', next);
        }}
        onCycleTheme={() => {
          const cycle: Array<'paper' | 'green' | 'white' | 'night'> = ['paper', 'green', 'white', 'night'];
          const next = cycle[(cycle.indexOf(readerTheme) + 1) % cycle.length];
          setReaderTheme(next);
          void services.settings.setSetting('reader-theme', next);
        }}
        onToggleMode={() => {
          const next = readerMode === 'paged' ? 'scroll' : 'paged';
          setReaderMode(next);
          void services.reading.saveReaderPrefs(projectId, next, readerFontSize);
        }}
        onCyclePageTurnStyle={() => {
          const cycle: Array<'slide' | 'cover' | 'curl'> = ['slide', 'cover', 'curl'];
          const next = cycle[(cycle.indexOf(pageTurnStyle) + 1) % cycle.length];
          setPageTurnStyle(next);
          void services.settings.setPageTurnStyle(next);
        }}
        onPageChange={(charOffset) => {
          setLastPageOffset(charOffset);
          lastKnownOffsetRef.current = charOffset;
          saveReadingPosition(current.chapter.id, charOffset);
        }}
        autoScrollOffsetRef={autoScrollSpeed !== 'off' ? autoScroll.offsetRef : null}
        autoScrollSpeedLabel={
          autoScrollSpeed === 'off' ? '关' : autoScrollSpeed === 'slow' ? '慢' : autoScrollSpeed === 'standard' ? '中' : '快'
        }
        onCycleAutoScroll={() => {
          setAutoScrollPaused(false);
          const cycle: Array<'off' | 'slow' | 'standard' | 'fast'> = ['off', 'slow', 'standard', 'fast'];
          setAutoScrollSpeed(cycle[(cycle.indexOf(autoScrollSpeed) + 1) % cycle.length]);
        }}
        onSeekSegment={(index) => void playback.seekToSegment(index)}
        onScrollTap={() => {
          if (autoScrollSpeed !== 'off') setAutoScrollPaused((p) => !p);
        }}
        onAddBookmark={() => {
          const offset = lastPageOffset >= 0 ? lastPageOffset : pendingOffset;
          const excerpt = current.chapterText.slice(offset, offset + 20);
          void bookmarks.add(current.chapter.id, offset, excerpt);
        }}
      />
    );
  }

  // ------------------------------------------------------------------ 助手视图
  if (view === 'assistant') {
    return (
      <AssistantView
        messages={assistant.messages}
        streaming={assistant.streaming}
        streamText={assistant.streamText}
        error={assistant.error}
        hasEarlier={assistant.hasEarlier}
        input={assistantInput}
        onBack={() => setView('chapters')}
        onLoadEarlier={() => void assistant.loadEarlier()}
        onInputChange={setAssistantInput}
        onSend={(text) => {
          setAssistantInput('');
          void assistant.send(text);
        }}
        onOpenProposal={(proposalId) =>
          router.push({
            pathname: '/project/[id]/review',
            params: { id: projectId, proposalId },
          })
        }
      />
    );
  }

  // ------------------------------------------------------------------ 目录视图
  return (
    <View className="flex-1 bg-paper px-4 pb-6 pt-14 dark:bg-paper-night">
      <Text className="font-serif text-2xl font-bold text-ink dark:text-ink-night" numberOfLines={1}>
        {project.title}
      </Text>
      <Text className="mt-1 text-xs text-muted dark:text-muted-night">
        revision {project.revision}
        {library.source ? ` · 来源《${library.source.filename}》` : ''}
      </Text>

      {library.error ? (
        <Text className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {library.error}
        </Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => router.push({ pathname: '/project/[id]/characters', params: { id: projectId } })}
        >
          <Text className="text-sm text-ink dark:text-ink-night">角色中心</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => setView('assistant')}
        >
          <Text className="text-sm text-ink dark:text-ink-night">书籍助手</Text>
        </Pressable>
      </View>

      {generation.progress ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink dark:text-ink-night">
              生成任务 ·{' '}
              {generation.progress.status === 'done'
                ? '已完成'
                : generation.progress.status === 'failed'
                  ? '失败（已完成段已保留）'
                  : `生成中 ${generation.progress.progress}/${generation.progress.totalSegments}`}
            </Text>
            {generation.progress.status === 'failed' ? (
              <Pressable
                className="rounded-lg bg-gold px-3 py-1.5"
                disabled={generation.busy}
                onPress={() => void generation.retry(generation.progress!.jobId)}
              >
                <Text className="text-xs font-semibold text-white">重试缺失段</Text>
              </Pressable>
            ) : null}
            {generation.progress.status === 'done' ? (
              <Pressable
                className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
                disabled={generation.busy}
                onPress={() => void generation.exportChapter(generation.progress!.jobId)}
              >
                <Text className="text-xs text-ink dark:text-ink-night">导出分享 MP3</Text>
              </Pressable>
            ) : null}
            {generation.progress.status === 'running' || generation.progress.status === 'pending' ? (
              <Pressable
                className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night"
                onPress={() => void generation.cancel(generation.progress!.jobId)}
              >
                <Text className="text-xs text-ink dark:text-ink-night">取消</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="mt-2 h-2 rounded-full bg-raised dark:bg-card-night">
            <View
              className="h-2 rounded-full bg-accent"
              style={{ width: `${Math.round((generation.progress.progress / Math.max(generation.progress.totalSegments, 1)) * 100)}%` }}
            />
          </View>
          <Text className="mt-2 text-xs text-muted dark:text-muted-night" numberOfLines={3}>
            {generation.progress.error ?? `${generation.progress.progress}/${generation.progress.totalSegments} 段完成`}
          </Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {!library.source ? (
          <Pressable
            className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
            disabled={library.busy}
            onPress={() => void library.importTxt()}
          >
            <Text className="font-semibold text-white">导入 UTF-8 TXT</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              className="rounded-xl bg-raised px-3 py-2.5 dark:bg-card-night"
              disabled={library.busy}
              onPress={() => {
                void library.resplit().then((result) => {
                  if (result.ok && result.value && typeof result.value === 'object' && 'proposalId' in result.value) {
                    router.push({
                      pathname: '/project/[id]/review',
                      params: { id: projectId, proposalId: String((result.value as { proposalId: string }).proposalId) },
                    });
                  }
                });
              }}
            >
              <Text className="text-sm text-ink dark:text-ink-night">重新分章</Text>
            </Pressable>
            <Pressable
              className="rounded-xl bg-raised px-3 py-2.5 dark:bg-card-night"
              onPress={() =>
                Alert.alert('能力边界', '采用/撤销历史候选请重新发起"重新分章"并在审阅中操作。')
              }
            >
              <Text className="text-sm text-ink dark:text-ink-night">候选历史</Text>
            </Pressable>
            <Pressable
              className={`rounded-xl px-3 py-2.5 ${dialogueVoices ? 'bg-accent-soft dark:bg-accent-nightsoft' : 'bg-raised dark:bg-card-night'}`}
              onPress={() => {
                const next = !dialogueVoices;
                setDialogueVoices(next);
                void services.settings.setSetting(`dialogue-voices:${projectId}`, next ? 'on' : 'off');
              }}
            >
              <Text
                className={`text-sm ${dialogueVoices ? 'text-accent dark:text-accent-night' : 'text-ink dark:text-ink-night'}`}
              >
                对话分声{dialogueVoices ? '开' : '关'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* 目录三分区（v0.8.0）：章节 / 书签列表（含摘录） / 全文搜索 */}
      <View className="mt-3 flex-row gap-2">
        {([
          ['chapters', `章节${chapters.length > 0 ? ` ${chapters.length}` : ''}`],
          ['bookmarks', `书签${bookmarks.bookmarks.length > 0 ? ` ${bookmarks.bookmarks.length}` : ''}`],
          ['search', '搜索'],
        ] as const).map(([key, label]) => (
          <Pressable
            key={key}
            className={`flex-1 items-center rounded-xl py-2 ${
              catalogView === key ? 'bg-accent' : 'bg-raised dark:bg-card-night'
            }`}
            onPress={() => setCatalogView(key)}
          >
            <Text
              className={`text-sm ${catalogView === key ? 'font-semibold text-white' : 'text-ink dark:text-ink-night'}`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {catalogView === 'chapters' ? (
      <FlatList
        className="mt-3"
        data={library.chapters ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={library.busy} onRefresh={() => void library.refresh()} />}
        renderItem={({ item, index }) => (
          <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
            <Pressable onPress={() => void openChapter(item.id)}>
              <Text className="font-semibold text-ink dark:text-ink-night">
                {index + 1}. {item.title}
              </Text>
              <Text className="mt-1 text-xs text-faint">
                偏移 {item.startOffset}–{item.endOffset}
              </Text>
            </Pressable>
            {library.source ? (
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'rename', chapterId: item.id, title: '修改标题', initial: item.title })}>
                  <Text className="text-xs text-muted dark:text-ink-night">改名</Text>
                </Pressable>
                <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'split', chapterId: item.id, title: '从此处拆分（字符偏移）', initial: String(Math.floor((item.startOffset + item.endOffset) / 2)) })}>
                  <Text className="text-xs text-muted dark:text-ink-night">拆分</Text>
                </Pressable>
                <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'boundary', chapterId: item.id, title: '移动章尾边界（字符偏移）', initial: String(item.endOffset) })}>
                  <Text className="text-xs text-muted dark:text-ink-night">边界</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-accent-soft px-2 py-1 dark:bg-accent-nightsoft"
                  disabled={generation.busy}
                  onPress={() => void generation.preview(item.id)}
                >
                  <Text className="text-xs text-accent dark:text-accent-night">试听首段</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-accent px-2 py-1"
                  disabled={generation.busy}
                  onPress={() => void generation.start(item.id)}
                >
                  <Text className="text-xs font-semibold text-white">生成本章</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                  onPress={() =>
                    Alert.alert('删除本章', `《${item.title}》正文将并入相邻章节，来源不变。确认删除？`, [
                      { text: '取消', style: 'cancel' },
                      { text: '删除', style: 'destructive', onPress: () => void library.remove(item.id) },
                    ])
                  }
                >
                  <Text className="text-xs text-danger dark:text-danger-night">删除</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              还没有章节。导入一本 UTF-8 TXT 小说开始制作。
            </Text>
          </View>
        }
      />
      ) : null}

      {catalogView === 'bookmarks' ? (
        <FlatList
          className="mt-3"
          data={bookmarks.bookmarks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
              <Pressable
                onPress={() => {
                  setHighlightRange(null);
                  void openChapter(item.chapterId, item.charOffset);
                }}
              >
                <Text className="text-sm text-ink dark:text-ink-night" numberOfLines={3}>
                  {item.excerpt}
                </Text>
                <Text className="mt-1 text-xs text-faint">
                  {new Date(item.createdAt).toLocaleString()}
                </Text>
              </Pressable>
              <Pressable
                className="mt-2 self-start rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                onPress={() => void bookmarks.remove(item.id)}
              >
                <Text className="text-xs text-danger dark:text-danger-night">删除</Text>
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="text-center text-sm text-muted dark:text-muted-night">
                还没有书签。阅读时点工具栏「书签」即可收藏当前段落。
              </Text>
            </View>
          }
        />
      ) : null}

      {catalogView === 'search' ? (
        <View className="mt-3 flex-1">
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 rounded-xl bg-raised px-3 py-2 text-sm text-ink dark:bg-card-night dark:text-ink-night"
              placeholder="搜索全文关键词"
              placeholderTextColor="#8C8272"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={() => void bookSearch.search(searchInput)}
              returnKeyType="search"
            />
            <Pressable
              className="rounded-xl bg-accent px-4 py-2 active:bg-accent-deep"
              disabled={bookSearch.busy || searchInput.trim().length === 0}
              onPress={() => void bookSearch.search(searchInput)}
            >
              <Text className="text-sm font-semibold text-white">{bookSearch.busy ? '搜索中' : '搜索'}</Text>
            </Pressable>
          </View>
          {bookSearch.error ? (
            <Text className="mt-2 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
              {bookSearch.error}
            </Text>
          ) : null}
          {bookSearch.results !== null && bookSearch.results.length === 0 ? (
            <Text className="mt-6 text-center text-sm text-muted dark:text-muted-night">
              没有找到「{searchInput.trim()}」
            </Text>
          ) : null}
          <FlatList
            className="mt-3"
            data={bookSearch.results ?? []}
            keyExtractor={(item, index) => `${item.chapterId}-${item.charOffset}-${index}`}
            renderItem={({ item }) => (
              <Pressable
                className="rounded-xl bg-card px-4 py-3 dark:bg-card-night"
                onPress={() => {
                  const length = searchInput.trim().length;
                  setHighlightRange({ start: item.charOffset, end: item.charOffset + length });
                  void openChapter(item.chapterId, item.charOffset);
                }}
              >
                <Text className="text-xs text-muted dark:text-muted-night" numberOfLines={1}>
                  {item.chapterTitle}
                </Text>
                <Text className="mt-1 text-sm text-ink dark:text-ink-night" numberOfLines={2}>
                  {item.excerpt}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View className="h-2" />}
          />
        </View>
      ) : null}

      <EditDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        initialValue={dialog?.initial ?? ''}
        keyboardType={dialog?.kind === 'rename' ? 'default' : 'numeric'}
        onConfirm={(value) => {
          if (!dialog) return;
          if (dialog.kind === 'rename') {
            void library.rename(dialog.chapterId, value);
          } else if (dialog.kind === 'split') {
            const offset = Number.parseInt(value, 10);
            if (!Number.isFinite(offset)) library.setError('切分点必须是数字偏移量');
            else void library.splitAt(dialog.chapterId, offset);
          } else if (dialog.kind === 'boundary') {
            const offset = Number.parseInt(value, 10);
            if (!Number.isFinite(offset)) library.setError('边界必须是数字偏移量');
            else void library.moveBoundary(dialog.chapterId, offset);
          }
        }}
        onClose={() => setDialog(null)}
      />
    </View>
  );
}
