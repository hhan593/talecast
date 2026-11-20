import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useI18n } from '@/hooks/use-i18n';

/**
 * 通用编辑对话框：改标题 / 输入偏移（拆分、边界）共用。
 * 确认时把文本交给 onConfirm，由调用方做校验与错误展示（Result 语义保持在 hooks）。
 */
export function EditDialog(props: {
  visible: boolean;
  title: string;
  initialValue: string;
  keyboardType?: 'default' | 'numeric';
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(props.initialValue);

  useEffect(() => {
    if (props.visible) setValue(props.initialValue);
  }, [props.visible, props.initialValue]);

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/50 px-6" onPress={props.onClose}>
        <Pressable
          className="w-full rounded-2xl bg-card p-5 dark:bg-card-night"
          onPress={() => {
          }}
        >
          <Text className="text-base font-semibold text-ink dark:text-ink-night">{props.title}</Text>
          <TextInput
            className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
            value={value}
            onChangeText={setValue}
            keyboardType={props.keyboardType ?? 'default'}
            autoFocus
            placeholder={props.keyboardType === 'numeric' ? t('editDialog.offsetPlaceholder') : undefined}
          />
          <View className="mt-4 flex-row justify-end gap-3">
            <Pressable className="rounded-lg px-4 py-2" onPress={props.onClose}>
              <Text className="text-sm text-muted dark:text-muted-night">{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              className="rounded-lg bg-accent px-4 py-2"
              onPress={() => {
                props.onConfirm(value);
                props.onClose();
              }}
            >
              <Text className="text-sm font-semibold text-white">{props.confirmLabel ?? t('common.confirm')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
