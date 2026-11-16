import { createAudioPlayer, type AudioPlayer as ExpoAudioPlayerInstance } from 'expo-audio';

import type { AudioPlayer } from '@/domain/ports';

/**
 * expo-audio 适配（docs/plan.md 3.1 播放 / P3 播放流程）：
 * load 单文件 → play/pause/seek → 进度与段尾回调。
 * 进度用 200ms 轮询（跨平台行为一致的稳态做法），段尾用 duration 判定。
 * 服务层（playback-service）负责队列与高亮映射；本类只封装单个音频文件。
 */
export class ExpoAudioPlayerService implements AudioPlayer {
  private player: ExpoAudioPlayerInstance | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private progressCallback: ((positionMs: number) => void) | null = null;
  private endCallback: (() => void) | null = null;
  private endFired = false;

  async load(uri: string): Promise<void> {
    this.stopInternal();
    this.player = createAudioPlayer({ uri });
    this.endFired = false;
  }

  async play(): Promise<void> {
    this.ensurePlayer();
    this.player!.play();
    this.startProgressPolling();
  }

  async pause(): Promise<void> {
    this.player?.pause();
  }

  async seek(positionMs: number): Promise<void> {
    this.ensurePlayer();
    await this.player!.seekTo(Math.max(positionMs, 0) / 1000);
  }

  onProgress(callback: (positionMs: number) => void): () => void {
    this.progressCallback = callback;
    return () => {
      if (this.progressCallback === callback) this.progressCallback = null;
    };
  }

  onPlaybackEnd(callback: () => void): () => void {
    this.endCallback = callback;
    return () => {
      if (this.endCallback === callback) this.endCallback = null;
    };
  }

  release(): void {
    this.stopInternal();
  }

  private ensurePlayer(): ExpoAudioPlayerInstance {
    if (!this.player) throw new Error('音频尚未加载');
    return this.player;
  }

  private startProgressPolling(): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => {
      const player = this.player;
      if (!player) return;
      const positionMs = (player.currentTime ?? 0) * 1000;
      this.progressCallback?.(positionMs);
      const durationMs = (player.duration ?? 0) * 1000;
      if (!this.endFired && durationMs > 0 && positionMs >= durationMs - 80) {
        this.endFired = true;
        this.endCallback?.();
      }
    }, 200);
  }

  private stopInternal(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
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

/**
 * 试听播放器（P2 最小实现）：单文件即点即播。
 * 与段队列播放（上方 ExpoAudioPlayerService + services/playback）相互独立、互不抢占。
 */
export class ExpoPreviewPlayer {
  private player: ExpoAudioPlayerInstance | null = null;

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
