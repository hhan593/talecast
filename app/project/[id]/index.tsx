import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useProject } from '@/hooks/use-project';

/** 章节工作台占位（docs/plan.md 4.1.3-4.1.7）：目录/正文/助手随 P1-P3 逐步落地。 */
export default function ProjectWorkbenchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const { project, loading, notFound } = useProject(params.id);

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

  return (
    <View className="flex-1 bg-zinc-50 px-4 pt-16 dark:bg-zinc-950">
      <Text className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{project.title}</Text>
      <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        revision {project.revision}
      </Text>
      {project.description ? (
        <Text className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{project.description}</Text>
      ) : null}

      <View className="mt-6 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">章节工作台</Text>
        <Text className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          目录、正文与工程助手随 P1（导入与分章）、P2（角色与生成）、P3（播放与助手）逐步接入；
          章节切换是工作台内部状态，不走路由。
        </Text>
      </View>
    </View>
  );
}
