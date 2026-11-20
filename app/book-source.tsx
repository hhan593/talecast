import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, useColorScheme, View } from 'react-native';

import { parseBookSourceRule, type ParsedBookSource } from '@/domain/source-rules';
import { useI18n } from '@/hooks/use-i18n';

/**
 * 书源导入分析（issue #61，阶段一入口）：粘贴 Legado 兼容书源 JSON →
 * 解析出每个书源的结构摘要（名称/地址/是否含搜索、目录、正文规则）。
 * 只做解析与校验展示，不发起任何站点请求——执行调度涉及版权与 robots
 * 边界，按 phase2-plan §6 独立评估后置。
 */
export default function BookSourceScreen() {
  const { t } = useI18n();
  const [json, setJson] = useState('');
  const [result, setResult] = useState<ParsedBookSource[] | null>(null);
  const [invalid, setInvalid] = useState(false);
  const colorScheme = useColorScheme();
  const inkColor = colorScheme === 'dark' ? '#EAE3D5' : '#2C2822';

  const analyze = () => {
    const parsed = parseBookSourceRule(json);
    setInvalid(parsed === null);
    setResult(parsed);
  };

  return (
    <View className="flex-1 bg-paper px-4 pb-6 pt-14 dark:bg-paper-night">
      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          className="h-9 w-9 items-center justify-center"
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={inkColor} />
        </Pressable>
        <Text className="flex-1 font-serif text-2xl font-bold text-ink dark:text-ink-night" numberOfLines={1}>
          {t('bookSource.title')}
        </Text>
      </View>
      <Text className="mt-2 text-xs text-muted dark:text-muted-night">{t('bookSource.hint')}</Text>

      <TextInput
        className="mt-3 h-32 rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink dark:border-line-night dark:bg-card-night dark:text-ink-night"
        value={json}
        onChangeText={(v) => {
          setJson(v);
          setInvalid(false);
        }}
        placeholder={t('bookSource.placeholder')}
        placeholderTextColor="#8C8272"
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        textAlignVertical="top"
      />

      <Pressable
        accessibilityRole="button"
        className="mt-3 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
        disabled={json.trim().length === 0}
        onPress={analyze}
      >
        <Text className="font-semibold text-white">{t('bookSource.analyze')}</Text>
      </Pressable>

      {invalid ? (
        <Text className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {t('bookSource.invalid')}
        </Text>
      ) : null}

      {result !== null && result.length > 0 ? (
        <FlatList
          className="mt-3"
          data={result}
          keyExtractor={(item, index) => `${item.sourceUrl}-${index}`}
          renderItem={({ item }) => (
            <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
              <Text className="font-semibold text-ink dark:text-ink-night" numberOfLines={1}>
                {item.sourceName}
              </Text>
              <Text className="mt-0.5 text-xs text-faint" numberOfLines={1}>
                {item.sourceUrl}
              </Text>
              <View className="mt-2 flex-row gap-2">
                {([
                  ['bookSource.search', item.hasSearch],
                  ['bookSource.toc', item.hasToc],
                  ['bookSource.content', item.hasContent],
                ] as const).map(([key, has]) => (
                  <View
                    key={key}
                    className={`rounded-md px-2 py-1 ${has ? 'bg-accent-soft dark:bg-accent-nightsoft' : 'bg-raised dark:bg-raised-night'}`}
                  >
                    <Text
                      className={`text-xs ${has ? 'text-accent dark:text-accent-night' : 'text-muted dark:text-muted-night'}`}
                    >
                      {`${t(key)} ${has ? '✓' : '✗'}`}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="text-center text-sm text-muted dark:text-muted-night">
                {t('bookSource.empty')}
              </Text>
            </View>
          }
        />
      ) : null}
    </View>
  );
}
