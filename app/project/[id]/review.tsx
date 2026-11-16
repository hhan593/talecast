import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { useProposal } from '@/hooks/use-proposal';
import { useProject } from '@/hooks/use-project';

/** 候选审阅（docs/plan.md 5.3）：modal 人工关口，采用/撤销均为显式命令。 */
export default function ReviewModal() {
  const params = useLocalSearchParams<{ id: string; proposalId: string }>();
  const projectId = params.id;
  const { project } = useProject(projectId);
  const proposal = useProposal(projectId, params.proposalId, project?.revision ?? -1);
  const router = useRouter();

  const statusText =
    proposal.status === 'pending'
      ? '待审阅：采用后写入工程目录，revision +1'
      : proposal.status === 'adopted'
        ? '已采用：撤销将回到采用前的目录（含采用时的编辑）'
        : '已撤销：可重新发起"重新分章"生成新候选';

  return (
    <View className="flex-1 bg-zinc-50 dark:bg-zinc-950">
      <View className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <Text className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          分章候选 · {proposal.drafts.length} 章
        </Text>
        <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{statusText}</Text>
        {proposal.error ? (
          <Text className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
            {proposal.error}
          </Text>
        ) : null}
        <View className="mt-3 flex-row gap-2">
          {proposal.status === 'pending' ? (
            <Pressable
              className="flex-1 items-center rounded-xl bg-indigo-500 py-2.5 active:bg-indigo-600"
              disabled={proposal.busy}
              onPress={() => {
                void proposal.adopt().then((result) => {
                  if (result.ok) {
                    Alert.alert('已采用', '候选目录已写入工程。', [
                      { text: '好的', onPress: () => router.back() },
                    ]);
                  }
                });
              }}
            >
              <Text className="font-semibold text-white">采用候选</Text>
            </Pressable>
          ) : null}
          {proposal.status === 'adopted' ? (
            <Pressable
              className="flex-1 items-center rounded-xl bg-amber-500 py-2.5 active:bg-amber-600"
              disabled={proposal.busy}
              onPress={() => {
                Alert.alert('撤销采用', '目录将回退到采用前的版本，来源不变。确认撤销？', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '撤销',
                    style: 'destructive',
                    onPress: () => {
                      void proposal.undo().then((result) => {
                        if (result.ok) router.back();
                      });
                    },
                  },
                ]);
              }}
            >
              <Text className="font-semibold text-white">撤销采用</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        className="px-4 py-3"
        data={proposal.drafts}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) => (
          <View className="rounded-xl bg-white px-4 py-3 dark:bg-zinc-900">
            <Text className="font-semibold text-zinc-900 dark:text-zinc-100">
              {index + 1}. {item.title}
            </Text>
            <Text className="mt-1 text-xs text-zinc-400">
              偏移 {item.startOffset}–{item.endOffset}
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-sm text-zinc-500">候选不存在或已被清理</Text>
          </View>
        }
      />
    </View>
  );
}
