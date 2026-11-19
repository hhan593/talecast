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
import { ReaderView } from '@/components/workbench/reader-view';
import { useAssistant } from '@/hooks/use-assistant';
import { useBookSearch } from '@/hooks/use-book-search';
import { useBookmarks } from '@/hooks/use-bookmarks';
import { useGeneration } from '@/hooks/use-generation';
import { useLibrary } from '@/hooks/use-library';
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

  // 打开工程恢复上次阅读位置（4.1.1）：直接回到上次阅读的章节与偏移
  const openChapterRef = useRef<(chapterId: string, charOffset?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    if (restored || !library.chapters || library.chapters.length === 0) return;
    setRestored(true);
    void services.reading.restoreReaderPrefs(projectId).then((prefs) => {
      setReaderMode(prefs.mode);
      setReaderFontSize(prefs.fontSize);
    });
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
        paragraphs={paragraphs}
        initialOffset={pendingOffset}
        highlightOffset={
          playback.state.chapterId === current.chapter.id ? playback.state.segmentStartOffset : null
        }
        playingThisChapter={playback.state.chapterId === current.chapter.id}
        playbackStatus={playback.state.status}
        playbackRate={playback.state.rate}
        segmentIndex={playback.state.segmentIndex}
        segmentCount={playback.state.segmentCount}
        onViewableItems={(info) => viewableCallbackRef.current?.(info)}
        onBack={() => setView('chapters')}
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
        onToggleMode={() => {
          const next = readerMode === 'paged' ? 'scroll' : 'paged';
          setReaderMode(next);
          void services.reading.saveReaderPrefs(projectId, next, readerFontSize);
        }}
        onPageChange={(charOffset) => {
          setLastPageOffset(charOffset);
          saveReadingPosition(current.chapter.id, charOffset);
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
          </>
        )}
      </View>

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
