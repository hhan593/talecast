import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { createAudioPlayer } from 'expo-audio';

/**
 * 翻页音效入口（v0.15.0，issue #38）：expo-audio 从组件移到 hooks 层——
 * 组件保持纯展示（props 注入回调），平台库只在 hooks/adapters 出现。
 * player 卸载时移除（原实现捕获 null ref 导致泄漏）。
 */
export function usePageSound(enabled: boolean) {
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  useEffect(() => {
    const player = playerRef.current;
    return () => {
      if (player) player.remove();
    };
  }, []);

  const play = (): void => {
    if (!enabled || Platform.OS === 'web') return;
    try {
      if (!playerRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        playerRef.current = createAudioPlayer(require('../../assets/sounds/page-turn.wav'));
      }
      const player = playerRef.current;
      player.seekTo(0);
      player.play();
    } catch {
      // 音效失败静默（非核心功能）
    }
  };

  return play;
}
