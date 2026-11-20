import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import { EditDialog } from '@/components/edit-dialog';
import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { characterProfileText } from '@/domain/character';
import { defaultVoiceLabel } from '@/domain/edge-voices';
import { useCharacters } from '@/hooks/use-characters';
import { useI18n } from '@/hooks/use-i18n';
import type { StringKey } from '@/i18n';

type Translate = (key: StringKey) => string;

const RATE_CYCLE = ['-20%', '+0%', '+20%'];
const VOL_CYCLE = ['-20%', '+0%', '+20%'];
const currentRate = (json: string) => (JSON.parse(json || '{}').rate as string | undefined) ?? '+0%';
const currentVolume = (json: string) => (JSON.parse(json || '{}').volume as string | undefined) ?? '+0%';
const nextRate = (json: string) => RATE_CYCLE[(RATE_CYCLE.indexOf(currentRate(json)) + 1) % RATE_CYCLE.length];
const nextVolume = (json: string) => VOL_CYCLE[(VOL_CYCLE.indexOf(currentVolume(json)) + 1) % VOL_CYCLE.length];
const rateLabel = (json: string, t: Translate) =>
  ({ '-20%': t('characters.rateSlow'), '+0%': t('characters.rateNormal'), '+20%': t('characters.rateFast') }[nextRate(json)] ?? t('characters.rateNormal'));
const volumeLabel = (json: string, t: Translate) =>
  ({ '-20%': t('characters.volumeSoft'), '+0%': t('characters.volumeNormal'), '+20%': t('characters.volumeLoud') }[nextVolume(json)] ?? t('characters.volumeNormal'));

export default function CharactersScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id;
  const characters = useCharacters(projectId);
  const { t } = useI18n();
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
          <Text className="font-semibold text-ink dark:text-ink-night">{t('characters.narrator')}</Text>
          <Pressable
            className="rounded-lg bg-accent px-3 py-1.5"
            onPress={() => setPickerTarget('narrator')}
          >
            <Text className="text-xs font-semibold text-white">{narratorVoiceName ? t('characters.changeVoice') : t('characters.bindVoice')}</Text>
          </Pressable>
        </View>
        <Text className="mt-2 text-xs text-muted dark:text-muted-night">
          {narratorVoiceName
            ? `${t('characters.currentVoice')}：${narratorVoiceName}`
            : t('characters.unboundHint', { voice: defaultVoiceLabel() })}
        </Text>
        <Text className="mt-1 text-xs text-faint">
          {t('characters.dialogueHint')}
        </Text>
        {characters.narratorBinding ? (
          <View className="mt-2 flex-row items-center gap-2">
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams('narrator', { rate: nextRate(characters.narratorBinding!.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">{t('characters.rate')}：{rateLabel(characters.narratorBinding!.providerParamsJson, t)}</Text>
            </Pressable>
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams('narrator', { volume: nextVolume(characters.narratorBinding!.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">{t('characters.volume')}：{volumeLabel(characters.narratorBinding!.providerParamsJson, t)}</Text>
            </Pressable>
            <Text className="text-[10px] text-faint dark:text-faint-night">{t('characters.paramsInvalidate')}</Text>
          </View>
        ) : null}
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          disabled={characters.busy}
          onPress={() => void characters.refreshVoices()}
        >
          <Text className="text-sm text-ink dark:text-ink-night">{t('characters.refreshVoices')}</Text>
        </Pressable>
        <Pressable
          className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
          disabled={characters.busy}
          onPress={() => void characters.extract()}
        >
          <Text className="font-semibold text-white">{t('characters.extract')}</Text>
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
                <Text className="text-xs text-faint">{binding ? characters.voiceName(binding.voiceId) : t('characters.unbound')}</Text>
              </View>
              <Text className="mt-1 text-xs text-muted dark:text-muted-night" numberOfLines={2}>
                {characterProfileText(item.profileJson)}
              </Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {!item.confirmed ? (
                  <Pressable className="rounded-md bg-accent-soft px-2 py-1 dark:bg-accent-nightsoft" onPress={() => void characters.confirm(item.id)}>
                    <Text className="text-xs text-accent dark:text-accent-night">{t('characters.confirm')}</Text>
                  </Pressable>
                ) : (
                  <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setPickerTarget({ characterId: item.id })}>
                    <Text className="text-xs text-muted dark:text-ink-night">{t('characters.bindVoice')}</Text>
                  </Pressable>
                )}
                <Pressable className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setRenameTarget({ id: item.id, name: item.name })}>
                  <Text className="text-xs text-muted dark:text-ink-night">{t('characters.rename')}</Text>
                </Pressable>
                {!item.manualProtected ? (
                  <Pressable
                    className="rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                    onPress={() =>
                      Alert.alert(t('common.delete'), t('characters.deleteConfirm', { name: item.name }), [
                        { text: t('common.cancel'), style: 'cancel' },
                        { text: t('common.delete'), style: 'destructive', onPress: () => void characters.remove(item.id) },
                      ])
                    }
                  >
                    <Text className="text-xs text-danger dark:text-danger-night">{t('common.delete')}</Text>
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
              {t('characters.empty')}
            </Text>
          </View>
        }
      />

      <VoicePickerSheet
        visible={pickerTarget !== null}
        title={pickerTarget === 'narrator' ? `${t('characters.narrator')} · ${t('characters.bindVoice')}` : t('characters.bindVoice')}
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
        title={t('characters.renameTitle')}
        initialValue={renameTarget?.name ?? ''}
        onConfirm={(value) => {
          if (renameTarget) void characters.rename(renameTarget.id, value);
        }}
        onClose={() => setRenameTarget(null)}
      />
    </View>
  );
}
