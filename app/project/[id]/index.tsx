import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';

import { EditDialog } from '@/components/edit-dialog';
import { useLibrary } from '@/hooks/use-library';
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
  const router = useRouter();

  const [view, setView] = useState<'chapters' | 'reader'>('chapters');
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
            renderItem={({ item }) => (
              <Text className="py-2 text-[15px] leading-6 text-zinc-800 dark:text-zinc-200">{item.text}</Text>
            )}
            onViewableItemsChanged={(info) => viewableCallbackRef.current?.(info)}
          />
        )}
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
