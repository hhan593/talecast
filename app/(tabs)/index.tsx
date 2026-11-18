import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { useProjects } from '@/hooks/use-projects';

export default function BookshelfScreen() {
  const { projects, error, createProject, deleteProject, refresh } = useProjects();
  const [createVisible, setCreateVisible] = useState(false);

  if (projects === null && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper px-4 pb-4 pt-16 dark:bg-paper-night">
      <Text className="font-serif text-3xl font-bold tracking-wide text-ink dark:text-ink-night">TaleCast</Text>
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
        className="mt-4"
        data={projects ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            className="rounded-r-xl rounded-l-sm border-l-[3px] border-accent bg-card p-4 active:bg-raised dark:bg-card-night dark:active:bg-card-night"
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
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              书架还是空的。点"添加小说"创建一本书籍，再导入 UTF-8 TXT 文本。
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
    </View>
  );
}
