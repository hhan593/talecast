import { useCallback } from 'react';
import { Alert, Linking } from 'react-native';

import { useServices } from '@/container';
import { truncateNotes } from '@/domain/update';
import { useI18n } from '@/hooks/use-i18n';

/**
 * 更新检查提示（issue #58 P1）：检查 + 弹窗 + 跳转 Release 页。
 * manual=false 用于启动静默检查——只有发现新版本才弹窗，失败不提示。
 */
export function useUpdatePrompt() {
  const services = useServices();
  const { t } = useI18n();

  const openRelease = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  }, []);

  const checkAndPrompt = useCallback(
    async (options: { manual: boolean }): Promise<void> => {
      const result = await services.update.check({ manual: options.manual });
      if (result.status === 'available' && result.release) {
        const body = t('update.availableBody', {
          version: result.release.tagName.replace(/^v/i, ''),
          current: services.update.currentVersion,
        });
        const notes = truncateNotes(result.release.notes);
        Alert.alert(t('update.availableTitle'), notes.length > 0 ? `${body}\n\n${notes}` : body, [
          { text: t('update.later'), style: 'cancel' },
          { text: t('update.install'), onPress: () => openRelease(result.release!.htmlUrl) },
        ]);
        return;
      }
      if (!options.manual) return; // 静默检查：无更新/失败一律不打扰
      if (result.status === 'up-to-date') {
        Alert.alert(
          t('update.upToDateTitle'),
          t('update.upToDate', { version: services.update.currentVersion }),
        );
        return;
      }
      Alert.alert(t('update.checkFailedTitle'), t('update.checkFailed'));
    },
    [openRelease, services, t],
  );

  return { checkAndPrompt };
}
