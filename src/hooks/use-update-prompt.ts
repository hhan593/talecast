import { useCallback, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';

import { useServices } from '@/container';
import { truncateNotes } from '@/domain/update';
import { useI18n } from '@/hooks/use-i18n';

/**
 * 更新检查提示（issue #58 P1 + #85 P2）：检查 + 弹窗 + 站内下载安装（Android）。
 * manual=false 用于启动静默检查——只有发现新版本才弹窗，失败不提示。
 * 安装阶段（下载 %/校验中/拉起）经 installPhase 暴露给设置页行文案。
 */
export type InstallPhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed';

export function useUpdatePrompt() {
  const services = useServices();
  const { t } = useI18n();
  const [installPhase, setInstallPhase] = useState<InstallPhase>('idle');
  const [installProgress, setInstallProgress] = useState(0);

  const openRelease = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => undefined);
  }, []);

  /** P2：站内下载 → 校验 → 拉起安装器（仅 Android；失败弹窗回落 Release 页） */
  const downloadAndInstall = useCallback(
    async (tagName: string) => {
      setInstallPhase('downloading');
      setInstallProgress(0);
      const check = await services.update.check({ manual: true });
      if (check.status !== 'available' || !check.release) {
        setInstallPhase('idle');
        return;
      }
      const release = check.release;
      const result = await services.update.downloadAndInstallApk(release, (event) => {
        if (event.phase === 'downloading') {
          setInstallPhase('downloading');
          setInstallProgress(Math.round(event.progress ?? 0));
        } else if (event.phase === 'verifying') {
          setInstallPhase('verifying');
        } else if (event.phase === 'ready') {
          setInstallPhase('ready');
        } else {
          setInstallPhase('failed');
        }
      });
      if (result.ok) {
        setInstallPhase('ready');
        return;
      }
      setInstallPhase('failed');
      Alert.alert(
        t('update.installFailedTitle'),
        result.error.message,
        [
          { text: t('common.ok') },
          { text: t('update.openRelease'), onPress: () => openRelease(release.htmlUrl) },
        ],
      );
    },
    [openRelease, services, t],
  );

  const checkAndPrompt = useCallback(
    async (options: { manual: boolean }): Promise<void> => {
      const result = await services.update.check({ manual: options.manual });
      if (result.status === 'available' && result.release) {
        const body = t('update.availableBody', {
          version: result.release.tagName.replace(/^v/i, ''),
          current: services.update.currentVersion,
        });
        const notes = truncateNotes(result.release.notes);
        const buttons: Array<{
          text: string;
          style?: 'cancel' | 'default' | 'destructive';
          onPress?: () => void;
        }> = [{ text: t('update.later'), style: 'cancel' }];
        if (Platform.OS === 'android') {
          buttons.push({
            text: t('update.install'),
            onPress: () => void downloadAndInstall(result.release!.tagName),
          });
        }
        buttons.push({
          text: t('update.releasePage'),
          onPress: () => openRelease(result.release!.htmlUrl),
        });
        Alert.alert(
          t('update.availableTitle'),
          notes.length > 0 ? `${body}\n\n${notes}` : body,
          buttons,
        );
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
    [downloadAndInstall, openRelease, services, t],
  );

  return { checkAndPrompt, downloadAndInstall, installPhase, installProgress };
}
