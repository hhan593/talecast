import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { EditDialog } from '@/components/edit-dialog';
import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { characterProfileText } from '@/domain/character';
import { useCharacters } from '@/hooks/use-characters';

export default function CharactersScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id;
  const characters = useCharacters(projectId);
  const [pickerTarget, setPickerTarget] = useState<'narrator' | { characterId: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  if (characters.characters === null) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }

  const narratorVoiceName = characters.narratorBinding
    ? characters.voiceName(characters.narratorBinding.voiceId)
    : null;

  return (
    <View className="flex-1 bg-paper px-4 pb-6 dark:bg-paper-night">
      {characters.error ? (
        <Text className="mt-2 rounded-lg bg-danger-soft p-3 text-xs text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {characters.error}
        </Text>
      ) : null}

      {/* 旁白绑定卡（生成的声音主体） */}
      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-ink dark:text-ink-night">旁白（讲述人）</Text>
          <Pressable
            className="rounded-lg bg-accent px-3 py-1.5"
            onPress={() => setPickerTarget('narrator')}
          >
            <Text className="text-xs font-semibold text-white">{narratorVoiceName ? '换音色' : '绑定音色'}</Text>
          </Pressable>
        </View>
        <Text className="mt-2 text-xs text-muted dark:text-muted-night">
          {narratorVoiceName ? `当前音色：${narratorVoiceName}` : '未绑定。生成整章前必须给旁白绑定音色。'}
        </Text>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          disabled={characters.busy}
          onPress={() => void characters.refreshVoices()}
        >
          <Text className="text-sm text-ink dark:text-ink-night">刷新音色库</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
          disabled={characters.busy}
          onPress={() => void characters.extract()}
        >
          <Text className="font-semibold text-white">LLM 抽取角色</Text>
        </Pressable>
      </View>

      <FlatList
        className="mt-3"
        data={characters.characters}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const binding = characters.bindingFor(item.id);
          return (
            <View className="rounded-xl bg-card p-4 dark:bg-card-night">
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-ink dark:text-ink-night">
                  {item.name}
                  {item.confirmed ? ' ✓' : ''}
                </Text>
                <Text className="text-xs text-faint">{binding ? characters.voiceName(binding.voiceId) : '未绑定'}</Text>
              </View>
              <Text className="mt-1 text-xs text-muted dark:text-muted-night" numberOfLines={2}>
                {characterProfileText(item.profileJson)}
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {!item.confirmed ? (
                  <Pressable className="rounded-md bg-accent-soft px-2 py-1 dark:bg-accent-nightsoft" onPress={() => void characters.confirm(item.id)}>
                    <Text className="text-xs text-accent dark:text-accent-night">人工确认</Text>
                  </Pressable>
                ) : (
                  <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setPickerTarget({ characterId: item.id })}>
                    <Text className="text-xs text-muted dark:text-ink-night">绑定音色</Text>
                  </Pressable>
                )}
                <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setRenameTarget({ id: item.id, name: item.name })}>
                  <Text className="text-xs text-muted dark:text-ink-night">改名</Text>
                </Pressable>
                {!item.manualProtected ? (
                  <Pressable
                    className="rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                    onPress={() =>
                      Alert.alert('删除候选', `删除未确认的角色候选"${item.name}"？`, [
                        { text: '取消', style: 'cancel' },
                        { text: '删除', style: 'destructive', onPress: () => void characters.remove(item.id) },
                      ])
                    }
                  >
                    <Text className="text-xs text-danger dark:text-danger-night">删除</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              还没有角色。点"LLM 抽取角色"（需先在 设置 → 服务连接 配置文本模型），
              或等候选审阅后人工确认。
            </Text>
          </View>
        }
      />

      <VoicePickerSheet
        visible={pickerTarget !== null}
        title={pickerTarget === 'narrator' ? '给旁白绑定音色' : '给角色绑定音色'}
        voices={characters.voices}
        refreshing={characters.busy}
        onRefresh={() => void characters.refreshVoices()}
        onSelect={(voice) => {
          if (pickerTarget === 'narrator') void characters.bindNarrator(voice.voiceId);
          else if (pickerTarget) void characters.bindCharacter(pickerTarget.characterId, voice.voiceId);
        }}
        onClose={() => setPickerTarget(null)}
      />

      <EditDialog
        visible={renameTarget !== null}
        title="修改角色名"
        initialValue={renameTarget?.name ?? ''}
        onConfirm={(value) => {
          if (renameTarget) void characters.rename(renameTarget.id, value);
        }}
        onClose={() => setRenameTarget(null)}
      />
    </View>
  );
}
