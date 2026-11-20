import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { VoicePickerSheet } from '@/components/voice-picker-sheet';
import { EditDialog } from '@/components/edit-dialog';
import { characterProfileText } from '@/domain/character';
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

export default function CharacterDetailScreen() {
  const params = useLocalSearchParams<{ id: string; characterId: string }>();
  const projectId = params.id;
  const router = useRouter();
  const characters = useCharacters(projectId);
  const { t } = useI18n();
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
        <Text className="text-sm text-muted dark:text-ink-night">{t('characters.missing')}</Text>
        <Pressable className="rounded-lg bg-accent px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">{t('common.back')}</Text>
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
            {character.confirmed ? t('characters.confirmedProtected') : t('characters.unconfirmedCandidate')}
          </Text>
        </View>
        <Text className="mt-2 text-sm text-muted dark:text-muted-night">{profileText}</Text>
      </View>

      <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
        <Text className="font-semibold text-ink dark:text-ink-night">{t('characters.voiceBinding')}</Text>
        <Text className="mt-2 text-xs text-muted dark:text-muted-night">
          {binding
            ? `${t('characters.currentVoice')}：${characters.voiceName(binding.voiceId)}${t('characters.revision', { revision: binding.revision })}`
            : t('characters.unbound')}
        </Text>
        {binding ? (
          <View className="mt-2 flex-row items-center gap-2">
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams({ characterId: character.id }, { rate: nextRate(binding.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">{t('characters.rate')}：{rateLabel(binding.providerParamsJson, t)}</Text>
            </Pressable>
            <Pressable
              className="rounded-md bg-raised px-2.5 py-1 dark:bg-raised-night"
              onPress={() => void characters.updateParams({ characterId: character.id }, { volume: nextVolume(binding.providerParamsJson) })}
            >
              <Text className="text-xs text-ink dark:text-ink-night">{t('characters.volume')}：{volumeLabel(binding.providerParamsJson, t)}</Text>
            </Pressable>
          </View>
        ) : null}
        {character.confirmed ? (
          <Pressable
            className="mt-3 items-center rounded-xl bg-accent py-2.5"
            onPress={() => setPickerVisible(true)}
          >
            <Text className="font-semibold text-white">{binding ? t('characters.changeVoice') : t('characters.bindVoice')}</Text>
          </Pressable>
        ) : (
          <Pressable
            className="mt-3 items-center rounded-xl bg-accent py-2.5"
            onPress={() => void characters.confirm(character.id)}
          >
            <Text className="font-semibold text-white">{t('characters.confirmThis')}</Text>
          </Pressable>
        )}
        <Text className="mt-2 text-xs text-faint">
          {t('characters.revisionHint')}
        </Text>
      </View>

      <View className="mt-3 flex-row gap-2">
        <Pressable
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => setRenameVisible(true)}
        >
          <Text className="text-sm text-ink dark:text-ink-night">{t('characters.rename')}</Text>
        </Pressable>
        {!character.manualProtected ? (
          <Pressable
            className="flex-1 items-center rounded-xl bg-danger-soft py-2.5 dark:bg-danger-nightsoft"
            onPress={() =>
              Alert.alert(t('common.delete'), t('characters.deleteConfirm', { name: character.name }), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: () => {
                    void characters.remove(character.id).then(() => router.back());
                  },
                },
              ])
            }
          >
            <Text className="text-sm text-danger dark:text-danger-night">{t('common.delete')}</Text>
          </Pressable>
        ) : null}
      </View>

      <VoicePickerSheet
        visible={pickerVisible}
        title={t('characters.bindTitle', { name: character.name })}
        voices={characters.voices}
        refreshing={characters.busy}
        onRefresh={() => void characters.refreshVoices()}
        onSelect={(voice) => void characters.bindCharacter(character.id, voice.voiceId)}
        onClose={() => setPickerVisible(false)}
      />

      <EditDialog
        visible={renameVisible}
        title={t('characters.renameTitle')}
        initialValue={character.name}
        onConfirm={(value) => void characters.rename(character.id, value)}
        onClose={() => setRenameVisible(false)}
      />
    </View>
  );
}
