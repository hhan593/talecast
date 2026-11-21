import TrackPlayer, {
  Capability,
  Event,
  State,
  type Track,
} from 'react-native-track-player';
import type { AudioPlayer } from '@/domain/ports';

/**
 * 后台/锁屏播放适配（docs/design/2026-11-18-v0.2.0-spec.md F-1）。
 * 选型说明：锁屏/通知栏控制需要 Android MediaSession 与 iOS 远程控制中心，
 * expo-audio 不提供该能力，react-native-track-player (4.x) 是 RN 生态标准实现——
 * 因此 AudioPlayer 端口在此换实现（业务层 services/playback 不变）。
 *
 * 代价（已在 PR/Release 说明）：原生模块，Expo Go 不可用——验证需安装 dev APK。
 *
 * 使用方式：本适配把 RNTP 当"单轨播放器"用（一次只加载一个文件），
 * 段队列推进仍由 services/playback 编排——保持业务逻辑与端口语义不变。
 */

export interface TrackPlayerAudioServiceOptions {
  /** 通知栏/锁屏展示的默认元数据兜底 */
  defaultTitle: string;
  defaultArtist: string;
}

const REMOTE_CAPABILITIES: Capability[] = [
  Capability.Play,
  Capability.Pause,
  Capability.SeekTo,
];

export class TrackPlayerAudioService implements AudioPlayer {
  private ready: Promise<void> | null = null;
  private progressCb: ((positionMs: number) => void) | null = null;
  private endCb: (() => void) | null = null;
  private endFired = false;
  private bound: { remove(): void }[] = [];

  constructor(private readonly options: TrackPlayerAudioServiceOptions) {
    // 远程控制（锁屏/通知栏按钮）必须在应用启动时注册一次
    void this.ensureSetup().then(() => {
      void TrackPlayer.registerPlaybackService(() => async () => {
        // 播放/暂停由系统按钮触发：转发到主播放器
        const state = await TrackPlayer.getState();
        if (state === State.Playing) {
          await TrackPlayer.pause();
        } else {
          await TrackPlayer.play();
        }
      });
      this.bound.push(
        TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
          this.progressCb?.(event.position * 1000);
        }),
        TrackPlayer.addEventListener(Event.PlaybackQueueEnded, (event) => {
          // 自然播完（非手动 stop）才触发段尾推进
          if (!this.endFired && event.position > 0) {
            this.endFired = true;
            this.endCb?.();
          }
        }),
      );
    });
  }

  private ensureSetup(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Expo Go 无原生模块：给出明确指引而不是含糊报错
          throw new Error(
            `后台播放模块初始化失败（${message}）。Expo Go 不含该原生模块，请安装 v0.2.0 起的 dev APK 验证。`,
          );
        }
        await TrackPlayer.updateOptions({
          capabilities: REMOTE_CAPABILITIES,
          progressUpdateEventInterval: 1,
        });
      })();
    }
    return this.ready;
  }

  async load(uri: string, meta?: { title?: string; artist?: string }): Promise<void> {
    await this.ensureSetup();
    this.endFired = false;
    await TrackPlayer.reset();
    const track: Track = {
      url: uri,
      title: meta?.title ?? this.options.defaultTitle,
      artist: meta?.artist ?? this.options.defaultArtist,
    };
    await TrackPlayer.add([track]);
  }

  async play(): Promise<void> {
    await this.ensureSetup();
    await TrackPlayer.play();
  }

  async pause(): Promise<void> {
    await TrackPlayer.pause();
  }

  async seek(positionMs: number): Promise<void> {
    await this.ensureSetup();
    await TrackPlayer.seekTo(Math.max(positionMs, 0) / 1000);
  }

  async setRate(rate: number): Promise<void> {
    await this.ensureSetup();
    await TrackPlayer.setRate(rate);
  }

  async setVolume(volume: number): Promise<void> {
    await this.ensureSetup();
    await TrackPlayer.setVolume(Math.min(Math.max(volume, 0), 1));
  }

  onProgress(callback: (positionMs: number) => void): () => void {
    this.progressCb = callback;
    return () => {
      if (this.progressCb === callback) this.progressCb = null;
    };
  }

  onPlaybackEnd(callback: () => void): () => void {
    this.endCb = callback;
    return () => {
      if (this.endCb === callback) this.endCb = null;
    };
  }

  release(): void {
    this.endFired = false;
    void TrackPlayer.reset().catch(() => undefined);
  }
}
