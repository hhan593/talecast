import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { EditDialog } from '@/components/edit-dialog';
import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { useCharacters } from '@/hooks/use-characters';

/** 角色中心（docs/plan.md 4.1.4）：旁白绑定 + LLM 抽取候选 + 人工确认 + 绑定音色 */
export default function CharactersScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id;
  const characters = useCharacters(projectId);
  const [pickerTarget, setPickerTarget] = useState<'narrator' | { characterId: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  if (characters.characters === null) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <ActivityIndicator />
      </View>
    );
  }

  const narratorVoiceName = characters.narratorBinding
    ? characters.voiceName(characters.narratorBinding.voiceId)
    : null;

  return (
    <View className="flex-1 bg-zinc-50 px-4 pb-6 dark:bg-zinc-950">
      {characters.error ? (
        <Text className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
          {characters.error}
        </Text>
      ) : null}

      {/* 旁白绑定卡（生成的声音主体） */}
      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <View className="flex-row items-center justify-between">
          <Text className="font-semibold text-zinc-900 dark:text-zinc-100">旁白（讲述人）</Text>
          <Pressable
            className="rounded-lg bg-indigo-500 px-3 py-1.5"
            onPress={() => setPickerTarget('narrator')}
          >
            <Text className="text-xs font-semibold text-white">{narratorVoiceName ? '换音色' : '绑定音色'}</Text>
          </Pressable>
        </View>
        <Text className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {narratorVoiceName ? `当前音色：${narratorVoiceName}` : '未绑定。生成整章前必须给旁白绑定音色。'}
        </Text>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-zinc-200 py-2.5 dark:bg-zinc-800"
          disabled={characters.busy}
          onPress={() => void characters.refreshVoices()}
        >
          <Text className="text-sm text-zinc-800 dark:text-zinc-200">刷新音色库</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-xl bg-indigo-500 py-2.5 active:bg-indigo-600"
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
            <View className="rounded-xl bg-white p-4 dark:bg-zinc-900">
              <View className="flex-row items-center justify-between">
                <Text className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {item.name}
                  {item.confirmed ? ' ✓' : ''}
                </Text>
                <Text className="text-xs text-zinc-400">{binding ? characters.voiceName(binding.voiceId) : '未绑定'}</Text>
              </View>
              <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400" numberOfLines={2}>
                {(() => {
                  try {
                    const parsed = JSON.parse(item.profileJson) as { profile?: string };
                    return parsed.profile || '（无描述）';
                  } catch {
                    return '（无描述）';
                  }
                })()}
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {!item.confirmed ? (
                  <Pressable className="rounded-md bg-indigo-50 px-2 py-1 dark:bg-indigo-950" onPress={() => void characters.confirm(item.id)}>
                    <Text className="text-xs text-indigo-600 dark:text-indigo-400">人工确认</Text>
                  </Pressable>
                ) : (
                  <Pressable className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800" onPress={() => setPickerTarget({ characterId: item.id })}>
                    <Text className="text-xs text-zinc-600 dark:text-zinc-300">绑定音色</Text>
                  </Pressable>
                )}
                <Pressable className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800" onPress={() => setRenameTarget({ id: item.id, name: item.name })}>
                  <Text className="text-xs text-zinc-600 dark:text-zinc-300">改名</Text>
                </Pressable>
                {!item.manualProtected ? (
                  <Pressable
                    className="rounded-md bg-red-50 px-2 py-1 dark:bg-red-950"
                    onPress={() =>
                      Alert.alert('删除候选', `删除未确认的角色候选"${item.name}"？`, [
                        { text: '取消', style: 'cancel' },
                        { text: '删除', style: 'destructive', onPress: () => void characters.remove(item.id) },
                      ])
                    }
                  >
                    <Text className="text-xs text-red-600 dark:text-red-400">删除</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-12">
            <Text className="text-center text-sm text-zinc-500 dark:text-zinc-400">
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
