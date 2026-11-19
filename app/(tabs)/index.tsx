import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { useProjects } from '@/hooks/use-projects';
import { useServices } from '@/container';
import { EditDialog } from '@/components/edit-dialog';

export default function BookshelfScreen() {
  const { projects, error, createProject, deleteProject, refresh } = useProjects();
  const services = useServices();
  const [createVisible, setCreateVisible] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');

  useEffect(() => {
    void services.settings.getSetting('bookshelf-view').then((saved) => {
      if (saved === 'grid' || saved === 'list') setView(saved);
    });
  }, [services]);

  const toggleView = useCallback(() => {
    setView((current) => {
      const next = current === 'list' ? 'grid' : 'list';
      void services.settings.setSetting('bookshelf-view', next);
      return next;
    });
  }, [services]);

  // 创建书籍：成功后跳书详情页，用户从那里导入文本（service/hook 已就绪，仅缺此 UI 入口）
  const handleCreate = useCallback(
    (title: string) => {
      void createProject(title).then((result) => {
        if (result.ok && result.value) {
          setCreateVisible(false);
          router.push({ pathname: '/project/[id]', params: { id: result.value.id } });
        }
      });
    },
    [createProject],
  );

  /** 封面底色：按书名确定性取色（网格卡与列表封面同源） */
  const coverFor = useCallback((title: string) => {
    const palette = ['#3E4A5B', '#6B4A3A', '#44584A', '#5B3E4A', '#4A5B3E', '#44405B'];
    let sum = 0;
    for (const ch of title) sum += ch.charCodeAt(0);
    return palette[sum % palette.length];
  }, []);

  if (projects === null && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper px-4 pb-4 pt-16 dark:bg-paper-night">
      <View className="flex-row items-center justify-between">
        <Text className="font-serif text-3xl font-bold tracking-wide text-ink dark:text-ink-night">TaleCast</Text>
        <Pressable
          className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
          onPress={toggleView}
        >
          <Text className="text-xs text-ink dark:text-ink-night">{view === 'list' ? '▦ 网格' : '☰ 列表'}</Text>
        </Pressable>
      </View>
      <Text className="mt-1 text-sm text-muted dark:text-muted-night">
        书架 · 把一本小说变成可以听的章节音频
      </Text>

      {error ? (
        <Text className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {error}
        </Text>
      ) : null}

      <Pressable
        className="mt-4 items-center rounded-xl bg-accent py-3 active:bg-accent-deep"
        onPress={() => setCreateVisible(true)}
      >
        <Text className="font-semibold text-white">＋ 添加书籍</Text>
      </Pressable>

      <FlatList
        key={view}
        className="mt-4"
        data={projects ?? []}
        keyExtractor={(item) => item.id}
        numColumns={view === 'grid' ? 3 : 1}
        columnWrapperStyle={view === 'grid' ? { gap: 10 } : undefined}
        contentContainerStyle={view === 'grid' ? { gap: 10 } : undefined}
        renderItem={({ item }) =>
          view === 'list' ? (
            <Pressable
              className="rounded-r-xl rounded-l-sm border-l-[3px] border-accent bg-card p-4 active:bg-raised dark:bg-card-night dark:active:bg-raised-night"
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
              onLongPress={() =>
                Alert.alert('删除书籍', `《${item.title}》的章节、候选与生成任务将全部删除，且不可恢复。确认删除？`, [
                  { text: '取消', style: 'cancel' },
                  { text: '删除', style: 'destructive', onPress: () => void deleteProject(item.id) },
                ])
              }
            >
              <Text className="font-serif text-base font-semibold tracking-wide text-ink dark:text-ink-night">{item.title}</Text>
              <Text className="mt-1 text-xs text-muted dark:text-muted-night">
                revision {item.revision} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              className="flex-1 rounded-2xl border border-line bg-card p-2.5 active:bg-raised dark:bg-card-night dark:active:bg-raised-night"
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
              onLongPress={() =>
                Alert.alert('删除书籍', `《${item.title}》的章节、候选与生成任务将全部删除，且不可恢复。确认删除？`, [
                  { text: '取消', style: 'cancel' },
                  { text: '删除', style: 'destructive', onPress: () => void deleteProject(item.id) },
                ])
              }
            >
              <View
                className="aspect-[3/4] rounded-lg items-center justify-center"
                style={{ backgroundColor: coverFor(item.title) }}
              >
                <Text className="font-serif text-sm tracking-widest text-paper">
                  {item.title.slice(0, 4).split('').join('\n')}
                </Text>
              </View>
              <Text className="mt-2 font-serif text-xs font-semibold text-ink dark:text-ink-night" numberOfLines={1}>
                {item.title}
              </Text>
              <Text className="mt-0.5 text-[10px] text-faint dark:text-faint-night" numberOfLines={1}>
                revision {item.revision}
              </Text>
            </Pressable>
          )
        }
        ItemSeparatorComponent={view === 'list' ? () => <View className="h-2" /> : undefined}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              书架还是空的。点"添加书籍"创建一本书籍，再导入 UTF-8 TXT 文本。
              {'\n'}长按书籍可删除。
            </Text>
          </View>
        }
        ListFooterComponent={
          projects && projects.length > 0 ? (
            <Pressable className="mt-3 items-center py-2" onPress={() => void refresh()}>
              <Text className="text-xs text-faint">刷新</Text>
            </Pressable>
          ) : undefined
        }
      />

      <EditDialog
        visible={createVisible}
        title="添加书籍"
        initialValue=""
        confirmLabel="创建"
        onConfirm={handleCreate}
        onClose={() => setCreateVisible(false)}
      />
    </View>
  );
}
