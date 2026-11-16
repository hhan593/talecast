import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { useProjects } from '@/hooks/use-projects';

/** 书架（docs/plan.md 4.1.1）：P0 只验证数据底座——建库、写入测试工程、重启可恢复。 */
export default function BookshelfScreen() {
  const { projects, error, createTestProject, refresh } = useProjects();

  if (projects === null && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-zinc-50 px-4 pb-4 pt-16 dark:bg-zinc-950">
      <Text className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">TaleCast</Text>
      <Text className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        书架 · 把一本小说变成可以听的章节音频
      </Text>

      {error ? (
        <Text className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {error}
        </Text>
      ) : null}

      <Pressable
        className="mt-4 items-center rounded-xl bg-indigo-500 py-3 active:bg-indigo-600"
        onPress={() => void createTestProject()}
      >
        <Text className="font-semibold text-white">新建测试工程</Text>
      </Pressable>

      <FlatList
        className="mt-4"
        data={projects ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            className="rounded-xl bg-white p-4 active:bg-zinc-100 dark:bg-zinc-900 dark:active:bg-zinc-800"
            onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
          >
            <Text className="font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</Text>
            <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              revision {item.revision} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
            </Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">
              还没有工程。导入小说的完整流程随 P1 到来，先点上方按钮验证数据底座。
            </Text>
          </View>
        }
        ListFooterComponent={
          projects && projects.length > 0 ? (
            <Pressable className="mt-3 items-center py-2" onPress={() => void refresh()}>
              <Text className="text-xs text-zinc-400">刷新</Text>
            </Pressable>
          ) : undefined
        }
      />
    </View>
  );
}
