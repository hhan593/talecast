import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { EditDialog } from '@/components/edit-dialog';
import { useCharacters } from '@/hooks/use-characters';

/** 角色详情：身份 + 音色绑定（确认后才可绑定，docs/plan.md 4.1.4） */
export default function CharacterDetailScreen() {
  const params = useLocalSearchParams<{ id: string; characterId: string }>();
  const projectId = params.id;
  const router = useRouter();
  const characters = useCharacters(projectId);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);

  const character = characters.characters?.find((c) => c.id === params.characterId) ?? null;
  const binding = character ? characters.bindingFor(character.id) : null;

  if (characters.characters === null) {
    return (
      <View className="flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <ActivityIndicator />
      </View>
    );
  }
  if (!character) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-zinc-50 dark:bg-zinc-950">
        <Text className="text-sm text-zinc-600 dark:text-zinc-300">角色不存在或已被删除</Text>
        <Pressable className="rounded-lg bg-indigo-500 px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">返回</Text>
        </Pressable>
      </View>
    );
  }

  let profileText = '（无描述）';
  try {
    profileText = (JSON.parse(character.profileJson) as { profile?: string }).profile || '（无描述）';
  } catch {
    // 保持默认
  }

  return (
    <View className="flex-1 bg-zinc-50 px-4 py-4 dark:bg-zinc-950">
      <View className="rounded-xl bg-white p-4 dark:bg-zinc-900">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {character.name}
            {character.confirmed ? ' ✓' : ''}
          </Text>
          <Text className="text-xs text-zinc-400">
            {character.confirmed ? '已确认 · 人工保护中' : '未确认候选'}
          </Text>
        </View>
        <Text className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{profileText}</Text>
      </View>

      <View className="mt-3 rounded-xl bg-white p-4 dark:bg-zinc-900">
        <Text className="font-semibold text-zinc-900 dark:text-zinc-100">音色绑定</Text>
        <Text className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {binding ? `当前音色：${characters.voiceName(binding.voiceId)}（修订 ${binding.revision}）` : '未绑定音色'}
        </Text>
        {character.confirmed ? (
          <Pressable
            className="mt-3 items-center rounded-xl bg-indigo-500 py-2.5"
            onPress={() => setPickerVisible(true)}
          >
            <Text className="font-semibold text-white">{binding ? '更换音色' : '绑定音色'}</Text>
          </Pressable>
        ) : (
          <Pressable
            className="mt-3 items-center rounded-xl bg-indigo-500 py-2.5"
            onPress={() => void characters.confirm(character.id)}
          >
            <Text className="font-semibold text-white">人工确认此角色</Text>
          </Pressable>
        )}
        <Text className="mt-2 text-xs text-zinc-400">
          绑定修订号参与生成任务的 input_hash：更换音色后旧段缓存不会被误用。
        </Text>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-zinc-200 py-2.5 dark:bg-zinc-800"
          onPress={() => setRenameVisible(true)}
        >
          <Text className="text-sm text-zinc-800 dark:text-zinc-200">改名</Text>
        </Pressable>
        {!character.manualProtected ? (
          <Pressable
            className="flex-1 items-center rounded-xl bg-red-50 py-2.5 dark:bg-red-950"
            onPress={() =>
              Alert.alert('删除候选', `删除未确认候选"${character.name}"？`, [
                { text: '取消', style: 'cancel' },
                {
                  text: '删除',
                  style: 'destructive',
                  onPress: () => {
                    void characters.remove(character.id).then(() => router.back());
                  },
                },
              ])
            }
          >
            <Text className="text-sm text-red-600 dark:text-red-400">删除候选</Text>
          </Pressable>
        ) : null}
      </View>

      <VoicePickerSheet
        visible={pickerVisible}
        title={`给"${character.name}"绑定音色`}
        voices={characters.voices}
        refreshing={characters.busy}
        onRefresh={() => void characters.refreshVoices()}
        onSelect={(voice) => void characters.bindCharacter(character.id, voice.voiceId)}
        onClose={() => setPickerVisible(false)}
      />

      <EditDialog
        visible={renameVisible}
        title="修改角色名"
        initialValue={character.name}
        onConfirm={(value) => void characters.rename(character.id, value)}
        onClose={() => setRenameVisible(false)}
      />
    </View>
  );
}
