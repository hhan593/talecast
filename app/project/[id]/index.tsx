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

import { EditDialog } from '@/components/edit-dialog';
import { useAssistant } from '@/hooks/use-assistant';
import { useGeneration } from '@/hooks/use-generation';
import { useLibrary } from '@/hooks/use-library';
import { usePlayback } from '@/hooks/use-playback';
import { useProject } from '@/hooks/use-project';
import { useServices } from '@/container';
import { type Paragraph } from '@/domain/source';
import type { Chapter } from '@/domain/types';

/**
 * 章节工作台（docs/plan.md 4.1.3-4.1.6）：目录 / 正文两个内部视图，章节切换不走路由。
 * 打开工程时恢复上次阅读位置（reading_state）；章节编辑走命令 + revision 守卫。
 */
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
  const [view, setView] = useState<'chapters' | 'reader' | 'assistant'>('chapters');
  const [assistantInput, setAssistantInput] = useState('');
  const [current, setCurrent] = useState<{ chapter: Chapter; paragraphs: Paragraph[] } | null>(null);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [restored, setRestored] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: 'rename'; chapterId: string; title: string; initial: string }
    | { kind: 'split'; chapterId: string; title: string; initial: string }
    | { kind: 'boundary'; chapterId: string; title: string; initial: string }
    | null
  >(null);
  const lastSaveRef = useRef(0);

  // 打开工程恢复上次阅读位置（4.1.1）：直接回到上次阅读的章节与偏移
  const openChapterRef = useRef<(chapterId: string, charOffset?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    if (restored || !library.chapters || library.chapters.length === 0) return;
    setRestored(true);
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
      setCurrent({ chapter: result.value.chapter, paragraphs: result.value.paragraphs });
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

  const viewableCallbackRef = useRef<((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null>(null);
  viewableCallbackRef.current = (info) => {
    const first = info.viewableItems[0];
    if (first?.item && current) {
      saveReadingPosition(current.chapter.id, (first.item as Paragraph).startOffset);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <ActivityIndicator />
      </View>
    );
  }
  if (notFound || !project) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-zinc-50 dark:bg-zinc-950">
        <Text className="text-base text-zinc-700 dark:text-zinc-300">该工程不存在或已被删除</Text>
        <Pressable className="rounded-xl bg-indigo-500 px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">返回书架</Text>
        </Pressable>
      </View>
    );
  }

  // ------------------------------------------------------------------ 正文视图
  if (view === 'reader' && current) {
    return (
      <View className="flex-1 bg-zinc-50 pt-14 dark:bg-zinc-950">
        <View className="flex-row items-center justify-between px-4">
          <Pressable className="rounded-lg bg-zinc-200 px-3 py-1.5 dark:bg-zinc-800" onPress={() => setView('chapters')}>
            <Text className="text-sm text-zinc-700 dark:text-zinc-300">返回目录</Text>
          </Pressable>
          <Text className="flex-1 mx-3 text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100" numberOfLines={1}>
            {current.chapter.title}
          </Text>
          <View className="w-16" />
        </View>
        <View className="mt-2 flex-row items-center gap-2 px-4">
          {playback.state.chapterId === current.chapter.id && playback.state.status === 'playing' ? (
            <Pressable className="rounded-lg bg-zinc-200 px-3 py-1.5 dark:bg-zinc-800" onPress={() => void playback.pause()}>
              <Text className="text-xs text-zinc-700 dark:text-zinc-300">暂停</Text>
            </Pressable>
          ) : playback.state.chapterId === current.chapter.id && playback.state.status === 'paused' ? (
            <Pressable className="rounded-lg bg-zinc-200 px-3 py-1.5 dark:bg-zinc-800" onPress={() => void playback.resume()}>
              <Text className="text-xs text-zinc-700 dark:text-zinc-300">继续</Text>
            </Pressable>
          ) : (
            <Pressable
              className="rounded-lg bg-indigo-500 px-3 py-1.5"
              onPress={() => void playback.playChapter(current.chapter.id)}
            >
              <Text className="text-xs font-semibold text-white">播放整章</Text>
            </Pressable>
          )}
          {playback.state.chapterId === current.chapter.id && playback.state.segmentCount > 0 ? (
            <Text className="text-xs text-zinc-500 dark:text-zinc-400">
              正在朗读第 {playback.state.segmentIndex + 1}/{playback.state.segmentCount} 段（点任意段落跳转）
            </Text>
          ) : (
            <Text className="text-xs text-zinc-400">段级播放：当前段即高亮单元</Text>
          )}
        </View>
        {paragraphs.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-sm text-zinc-500">本章内容为空</Text>
          </View>
        ) : (
          <FlatList
            className="mt-2 px-4"
            data={paragraphs}
            keyExtractor={(item, index) => `${item.startOffset}-${index}`}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({ length: 96, offset: 96 * index, index })}
            renderItem={({ item }) => {
              const highlightOffset =
                playback.state.chapterId === current.chapter.id ? playback.state.segmentStartOffset : null;
              const isHighlighted =
                highlightOffset !== null && item.startOffset <= highlightOffset && highlightOffset < item.endOffset;
              return (
                <Pressable onPress={() => void seekToParagraph(item)}>
                  <Text
                    className={
                      isHighlighted
                        ? 'rounded-lg bg-indigo-50 py-2 text-[15px] leading-6 text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100'
                        : 'py-2 text-[15px] leading-6 text-zinc-800 dark:text-zinc-200'
                    }
                  >
                    {item.text}
                  </Text>
                </Pressable>
              );
            }}
            onViewableItemsChanged={(info) => viewableCallbackRef.current?.(info)}
          />
        )}
      </View>
    );
  }

  // ------------------------------------------------------------------ 助手视图
  if (view === 'assistant') {
    return (
      <View className="flex-1 bg-zinc-50 pt-14 dark:bg-zinc-950">
        <View className="flex-row items-center justify-between px-4">
          <Pressable className="rounded-lg bg-zinc-200 px-3 py-1.5 dark:bg-zinc-800" onPress={() => setView('chapters')}>
            <Text className="text-sm text-zinc-700 dark:text-zinc-300">返回目录</Text>
          </Pressable>
          <Text className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">工程助手</Text>
          <View className="w-16" />
        </View>
        {assistant.hasEarlier ? (
          <Pressable className="mt-2 self-center px-4" onPress={() => void assistant.loadEarlier()}>
            <Text className="text-xs text-indigo-500">加载更早消息</Text>
          </Pressable>
        ) : null}
        <FlatList
          className="mt-2 flex-1 px-4"
          data={assistant.messages ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View className={item.role === 'user' ? 'items-end' : 'items-start'}>
              <View
                className={
                  item.role === 'user'
                    ? 'max-w-[85%] rounded-2xl bg-indigo-500 px-4 py-2 my-1'
                    : 'max-w-[85%] rounded-2xl bg-white px-4 py-2 my-1 dark:bg-zinc-900'
                }
              >
                <Text
                  className={
                    item.role === 'user' ? 'text-sm text-white' : 'text-sm text-zinc-800 dark:text-zinc-200'
                  }
                >
                  {item.text}
                </Text>
                {item.proposalId ? (
                  <Pressable
                    className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 self-start"
                    onPress={() =>
                      router.push({
                        pathname: '/project/[id]/review',
                        params: { id: projectId, proposalId: item.proposalId! },
                      })
                    }
                  >
                    <Text className="text-xs font-semibold text-white">去审阅候选（需人工采用）</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        />
        {assistant.streaming ? (
          <Text className="px-4 pb-1 text-xs text-zinc-400" numberOfLines={4}>
            {assistant.streamText || '…'}
          </Text>
        ) : null}
        {assistant.error ? (
          <Text className="mx-4 rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
            {assistant.error}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <TextInput
            className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
            placeholder="向助手提问或请求重新分章（只提议，不直改）"
            value={assistantInput}
            onChangeText={setAssistantInput}
            multiline
          />
          <Pressable
            className="rounded-xl bg-indigo-500 px-4 py-2.5"
            disabled={assistant.streaming || assistantInput.trim().length === 0}
            onPress={() => {
              const text = assistantInput;
              setAssistantInput('');
              void assistant.send(text);
            }}
          >
            <Text className="text-sm font-semibold text-white">{assistant.streaming ? '…' : '发送'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ------------------------------------------------------------------ 目录视图
  return (
    <View className="flex-1 bg-zinc-50 px-4 pb-6 pt-14 dark:bg-zinc-950">
      <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50" numberOfLines={1}>
        {project.title}
      </Text>
      <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        revision {project.revision}
        {library.source ? ` · 来源《${library.source.filename}》` : ''}
      </Text>

      {library.error ? (
        <Text className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {library.error}
        </Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-zinc-200 py-2.5 dark:bg-zinc-800"
          onPress={() => router.push({ pathname: '/project/[id]/characters', params: { id: projectId } })}
        >
          <Text className="text-sm text-zinc-800 dark:text-zinc-200">角色中心</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-xl bg-zinc-200 py-2.5 dark:bg-zinc-800"
          onPress={() => setView('assistant')}
        >
          <Text className="text-sm text-zinc-800 dark:text-zinc-200">工程助手</Text>
        </Pressable>
      </View>

      {/* 生成进度卡（docs/plan.md 4.1.5）：真实进度 + 失败重试只补缺失段 */}
      {generation.progress ? (
        <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-zinc-900 dark:text-zinc-100">
              生成任务 ·{' '}
              {generation.progress.status === 'done'
                ? '已完成'
                : generation.progress.status === 'failed'
                  ? '失败（已完成段已保留）'
                  : `生成中 ${generation.progress.progress}/${generation.progress.totalSegments}`}
            </Text>
            {generation.progress.status === 'failed' ? (
              <Pressable
                className="rounded-lg bg-amber-500 px-3 py-1.5"
                disabled={generation.busy}
                onPress={() => void generation.retry(generation.progress!.jobId)}
              >
                <Text className="text-xs font-semibold text-white">重试缺失段</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="mt-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
            <View
              className="h-2 rounded-full bg-indigo-500"
              style={{ width: `${Math.round((generation.progress.progress / Math.max(generation.progress.totalSegments, 1)) * 100)}%` }}
            />
          </View>
          <Text className="mt-2 text-xs text-zinc-500 dark:text-zinc-400" numberOfLines={3}>
            {generation.progress.error ?? `${generation.progress.progress}/${generation.progress.totalSegments} 段完成`}
          </Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {!library.source ? (
          <Pressable
            className="flex-1 items-center rounded-xl bg-indigo-500 py-2.5 active:bg-indigo-600"
            disabled={library.busy}
            onPress={() => void library.importTxt()}
          >
            <Text className="font-semibold text-white">导入 UTF-8 TXT</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              className="rounded-xl bg-zinc-200 px-3 py-2.5 dark:bg-zinc-800"
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
              <Text className="text-sm text-zinc-800 dark:text-zinc-200">重新分章</Text>
            </Pressable>
            <Pressable
              className="rounded-xl bg-zinc-200 px-3 py-2.5 dark:bg-zinc-800"
              onPress={() =>
                Alert.alert('能力边界', '采用/撤销历史候选请重新发起"重新分章"并在审阅中操作。')
              }
            >
              <Text className="text-sm text-zinc-800 dark:text-zinc-200">候选历史</Text>
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
          <View className="rounded-xl bg-white px-4 py-3 dark:bg-zinc-900">
            <Pressable onPress={() => void openChapter(item.id)}>
              <Text className="font-semibold text-zinc-900 dark:text-zinc-100">
                {index + 1}. {item.title}
              </Text>
              <Text className="mt-1 text-xs text-zinc-400">
                偏移 {item.startOffset}–{item.endOffset}
              </Text>
            </Pressable>
            {library.source ? (
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Pressable className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800" onPress={() => setDialog({ kind: 'rename', chapterId: item.id, title: '修改标题', initial: item.title })}>
                  <Text className="text-xs text-zinc-600 dark:text-zinc-300">改名</Text>
                </Pressable>
                <Pressable className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800" onPress={() => setDialog({ kind: 'split', chapterId: item.id, title: '从此处拆分（字符偏移）', initial: String(Math.floor((item.startOffset + item.endOffset) / 2)) })}>
                  <Text className="text-xs text-zinc-600 dark:text-zinc-300">拆分</Text>
                </Pressable>
                <Pressable className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800" onPress={() => setDialog({ kind: 'boundary', chapterId: item.id, title: '移动章尾边界（字符偏移）', initial: String(item.endOffset) })}>
                  <Text className="text-xs text-zinc-600 dark:text-zinc-300">边界</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-indigo-50 px-2 py-1 dark:bg-indigo-950"
                  disabled={generation.busy}
                  onPress={() => void generation.preview(item.id)}
                >
                  <Text className="text-xs text-indigo-600 dark:text-indigo-400">试听首段</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-indigo-500 px-2 py-1"
                  disabled={generation.busy}
                  onPress={() => void generation.start(item.id)}
                >
                  <Text className="text-xs font-semibold text-white">生成本章</Text>
                </Pressable>
                <Pressable
                  className="rounded-md bg-red-50 px-2 py-1 dark:bg-red-950"
                  onPress={() =>
                    Alert.alert('删除本章', `《${item.title}》正文将并入相邻章节，来源不变。确认删除？`, [
                      { text: '取消', style: 'cancel' },
                      { text: '删除', style: 'destructive', onPress: () => void library.remove(item.id) },
                    ])
                  }
                >
                  <Text className="text-xs text-red-600 dark:text-red-400">删除</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">
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
