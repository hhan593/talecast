import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';

import type { VoiceRecord } from '@/domain/types';

export function VoicePickerSheet(props: {
  visible: boolean;
  title: string;
  voices: VoiceRecord[];
  refreshing?: boolean;
  onSelect: (voice: VoiceRecord) => void;
  onClose: () => void;
  onRefresh?: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return props.voices;
    return props.voices.filter(
      (voice) => voice.name.toLowerCase().includes(q) || voice.voiceId.toLowerCase().includes(q),
    );
  }, [props.voices, query]);

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable className="flex-1 justify-end bg-black/50" onPress={props.onClose}>
        <Pressable className="max-h-[80%] rounded-t-2xl bg-card dark:bg-card-night" onPress={() => undefined}>
          <View className="border-b border-line px-4 pb-3 pt-4 dark:border-line-night">
            <View className="flex-row items-center justify-between">
              <Text className="text-base font-semibold text-ink dark:text-ink-night">{props.title}</Text>
              <Pressable onPress={props.onClose}>
                <Text className="text-sm text-muted">关闭</Text>
              </Pressable>
            </View>
            <TextInput
              className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
              placeholder="搜索音色名 / 标识"
              value={query}
              onChangeText={setQuery}
            />
            {props.onRefresh ? (
              <Pressable className="mt-2 self-start" disabled={props.refreshing} onPress={props.onRefresh}>
                <Text className="text-xs text-accent">
                  {props.refreshing ? '刷新中…' : '从 Edge 服务刷新音色列表'}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <FlatList
            className="px-4 py-2"
            data={filtered}
            keyExtractor={(item) => item.voiceId}
            renderItem={({ item }) => (
              <Pressable
                className="border-b border-line py-3 dark:border-line-night"
                onPress={() => {
                  props.onSelect(item);
                  props.onClose();
                }}
              >
                <Text className="font-semibold text-ink dark:text-ink-night">{item.name}</Text>
                <Text className="mt-0.5 text-xs text-faint">{item.voiceId}</Text>
                {item.description ? (
                  <Text className="mt-0.5 text-xs text-muted dark:text-muted-night">{item.description}</Text>
                ) : null}
              </Pressable>
            )}
            ListEmptyComponent={
              <View className="items-center py-10">
                <Text className="text-center text-sm text-muted dark:text-muted-night">
                  没有匹配的音色。点上方「刷新音色列表」从服务拉取（首次使用必须刷新一次）。
                </Text>
              </View>
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
