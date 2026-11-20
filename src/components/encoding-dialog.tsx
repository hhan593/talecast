import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import {
  ENCODING_LABELS,
  SOURCE_ENCODINGS,
  type EncodingChoice,
  type EncodingDetection,
} from '@/domain/encoding';

/**
 * TXT 导入编码确认（v0.17.0）：先显示自动识别结果，再允许手动覆盖。
 * 纯展示组件：不调用 services，选择经回调交给 hooks。
 */
export function EncodingDialog(props: {
  visible: boolean;
  fileName: string;
  detection: EncodingDetection | null;
  value: EncodingChoice;
  onChange(choice: EncodingChoice): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  const confidence = props.detection?.confidence === 'certain'
    ? '已确认'
    : props.detection?.confidence === 'likely'
      ? '较可信'
      : '不确定，建议核对';
  const options: Array<{ value: EncodingChoice; label: string }> = [
    {
      value: 'auto',
      label: props.detection
        ? `自动识别（${ENCODING_LABELS[props.detection.encoding]} · ${confidence}）`
        : '自动识别',
    },
    ...SOURCE_ENCODINGS.map((encoding) => ({ value: encoding, label: ENCODING_LABELS[encoding] })),
  ];

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-5" onPress={props.onCancel}>
        <Pressable className="max-h-[80%] w-full rounded-2xl bg-card p-5 dark:bg-card-night" onPress={() => undefined}>
          <Text className="text-base font-semibold text-ink dark:text-ink-night">选择文本编码</Text>
          <Text className="mt-1 text-xs text-muted dark:text-muted-night" numberOfLines={2}>
            {props.fileName}
          </Text>
          <Text className="mt-2 text-xs text-muted dark:text-muted-night">
            自动识别依据 BOM / UTF-8 校验 / 中文字符评分；识别不准时请手动指定，导入后可在书架删除重导。
          </Text>
          <ScrollView className="mt-3">
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                className={`mb-2 rounded-xl border px-3 py-2.5 ${props.value === option.value ? 'border-accent bg-accent-soft' : 'border-line dark:border-line-night'}`}
                onPress={() => props.onChange(option.value)}
              >
                <Text className="text-sm text-ink dark:text-ink-night">{option.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View className="mt-3 flex-row justify-end gap-3">
            <Pressable className="rounded-lg px-4 py-2" onPress={props.onCancel}>
              <Text className="text-sm text-muted dark:text-muted-night">取消</Text>
            </Pressable>
            <Pressable className="rounded-lg bg-accent px-4 py-2" onPress={props.onConfirm}>
              <Text className="text-sm font-semibold text-white">导入</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
