import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';

import { useProposal } from '@/hooks/use-proposal';
import { useProject } from '@/hooks/use-project';
import { useI18n } from '@/hooks/use-i18n';

export default function ReviewModal() {
  const params = useLocalSearchParams<{ id: string; proposalId: string }>();
  const projectId = params.id;
  const { project } = useProject(projectId);
  const proposal = useProposal(projectId, params.proposalId, project?.revision ?? -1);
  const router = useRouter();
  const { t } = useI18n();

  const statusText =
    proposal.status === 'pending'
      ? t('review.pending')
      : proposal.status === 'adopted'
        ? t('review.applied')
        : t('review.reverted');

  return (
    <View className="flex-1 bg-paper dark:bg-paper-night">
      <View className="border-b border-line px-4 py-3 dark:border-line-night">
        <Text className="text-base font-semibold text-ink dark:text-ink-night">
          {t('review.title', { count: proposal.drafts.length })}
        </Text>
        <Text className="mt-1 text-xs text-muted dark:text-muted-night">{statusText}</Text>
        {proposal.error ? (
          <Text className="mt-2 rounded-lg bg-danger-soft p-2 text-xs text-danger dark:bg-danger-nightsoft dark:text-danger-night">
            {proposal.error}
          </Text>
        ) : null}
        <View className="mt-3 flex-row gap-2">
          {proposal.status === 'pending' ? (
            <Pressable
              className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
              disabled={proposal.busy}
              onPress={() => {
                void proposal.adopt().then((result) => {
                  if (result.ok) {
                    Alert.alert(t('review.applied'), t('review.appliedToast'), [
                      { text: t('common.ok'), onPress: () => router.back() },
                    ]);
                  }
                });
              }}
            >
              <Text className="font-semibold text-white">{t('review.apply')}</Text>
            </Pressable>
          ) : null}
          {proposal.status === 'adopted' ? (
            <Pressable
              className="flex-1 items-center rounded-xl bg-gold py-2.5 active:bg-amber-600"
              disabled={proposal.busy}
              onPress={() => {
                Alert.alert(t('review.revert'), t('review.revertConfirm'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('review.revert'),
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
              <Text className="font-semibold text-white">{t('review.revert')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        className="px-4 py-3"
        data={proposal.drafts}
        keyExtractor={(_, index) => String(index)}
        renderItem={({ item, index }) => (
          <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
            <Text className="font-semibold text-ink dark:text-ink-night">
              {index + 1}. {item.title}
            </Text>
            <Text className="mt-1 text-xs text-faint">
              {t('review.offset', { start: item.startOffset, end: item.endOffset })}
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-sm text-muted">{t('review.missing')}</Text>
          </View>
        }
      />
    </View>
  );
}
