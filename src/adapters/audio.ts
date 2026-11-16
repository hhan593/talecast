import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

/**
 * 试听播放器（P2 最小实现）：单文件即点即播。
 * 完整段队列/全局单例/正文高亮播放服务随 P3 落地（docs/plan.md 5.3 播放流程）。
 */
export class ExpoPreviewPlayer {
  private player: AudioPlayer | null = null;

  play(uri: string): void {
    this.stop();
    this.player = createAudioPlayer({ uri });
    this.player.play();
  }

  stop(): void {
    if (this.player) {
      try {
        this.player.pause();
        this.player.release();
      } catch {
        // 已释放
      }
      this.player = null;
    }
  }
}
