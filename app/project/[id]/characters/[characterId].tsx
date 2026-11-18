import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { EditDialog } from '@/components/edit-dialog';
import { characterProfileText } from '@/domain/character';
import { useCharacters } from '@/hooks/use-characters';

const RATE_CYCLE = ['-20%', '+0%', '+20%'];
const VOL_CYCLE = ['-20%', '+0%', '+20%'];
const currentRate = (json: string) => (JSON.parse(json || '{}').rate as string | undefined) ?? '+0%';
const currentVolume = (json: string) => (JSON.parse(json || '{}').volume as string | undefined) ?? '+0%';
const nextRate = (json: string) => RATE_CYCLE[(RATE_CYCLE.indexOf(currentRate(json)) + 1) % RATE_CYCLE.length];
const nextVolume = (json: string) => VOL_CYCLE[(VOL_CYCLE.indexOf(currentVolume(json)) + 1) % VOL_CYCLE.length];
const rateLabel = (json: string) => ({ '-20%': '慢', '+0%': '标准', '+20%': '快' }[nextRate(json)] ?? '标准');
const volumeLabel = (json: string) => ({ '-20%': '轻', '+0%': '标准', '+20%': '响' }[nextVolume(json)] ?? '标准');

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
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }
  if (!character) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-paper-night">
        <Text className="text-sm text-muted dark:text-ink-night">角色不存在或已被删除</Text>
        <Pressable className="rounded-lg bg-accent px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">返回</Text>
        </Pressable>
      </View>
    );
  }

  const profileText = characterProfileText(character.profileJson);

  return (
    <View className="flex-1 bg-paper px-4 py-4 dark:bg-paper-night">
      <View className="rounded-xl bg-card p-4 dark:bg-card-night">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-bold text-ink dark:text-ink-night">
            {character.name}
            {character.confirmed ? ' ✓' : ''}
          </Text>
          <Text className="text-xs text-faint">
            {character.confirmed ? '已确认 · 人工保护中' : '未确认候选'}
          </Text>
        </View>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">{profileText}</Text>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">音色绑定</Text>
        <Text className="mt-2 text-xs text-muted dark:text-muted-night">
          {binding ? `当前音色：${characters.voiceName(binding.voiceId)}（修订 ${binding.revision}）` : '未绑定音色'}
        </Text>
        {binding ? (
          <View className="mt-2 flex-row items-center gap-2">
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams({ characterId: character.id }, { rate: nextRate(binding.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">语速：{rateLabel(binding.providerParamsJson)}</Text>
            </Pressable>
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams({ characterId: character.id }, { volume: nextVolume(binding.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">音量：{volumeLabel(binding.providerParamsJson)}</Text>
            </Pressable>
          </View>
        ) : null}
        {character.confirmed ? (
          <Pressable
            className="mt-3 items-center rounded-xl bg-accent py-2.5"
            onPress={() => setPickerVisible(true)}
          >
            <Text className="font-semibold text-white">{binding ? '更换音色' : '绑定音色'}</Text>
          </Pressable>
        ) : (
          <Pressable
            className="mt-3 items-center rounded-xl bg-accent py-2.5"
            onPress={() => void characters.confirm(character.id)}
          >
            <Text className="font-semibold text-white">人工确认此角色</Text>
          </Pressable>
        )}
        <Text className="mt-2 text-xs text-faint">
          绑定修订号参与生成任务的 input_hash：更换音色后旧段缓存不会被误用。
        </Text>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => setRenameVisible(true)}
        >
          <Text className="text-sm text-ink dark:text-ink-night">改名</Text>
        </Pressable>
        {!character.manualProtected ? (
          <Pressable
            className="flex-1 items-center rounded-xl bg-danger-soft py-2.5 dark:bg-danger-nightsoft"
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
            <Text className="text-sm text-danger dark:text-danger-night">删除候选</Text>
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
