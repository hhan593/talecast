import type { AudioPlayer } from '@/domain/ports';

export class FakeAudioPlayer implements AudioPlayer {
  public loaded: string[] = [];
  public rate = 1;
  public volumes: number[] = [];
  public plays = 0;
  public pauses = 0;
  public seeks: number[] = [];
  public released = 0;
  private progressCb: ((ms: number) => void) | null = null;
  private endCb: (() => void) | null = null;

  async load(uri: string): Promise<void> {
    this.loaded.push(uri);
  }

  async play(): Promise<void> {
    this.plays += 1;
  }

  async pause(): Promise<void> {
    this.pauses += 1;
  }

  async seek(positionMs: number): Promise<void> {
    this.seeks.push(positionMs);
  }

  async setRate(rate: number): Promise<void> {
    this.rate = rate;
  }

  async setVolume(volume: number): Promise<void> {
    this.volumes.push(volume);
  }

  onProgress(callback: (positionMs: number) => void): () => void {
    this.progressCb = callback;
    return () => {
      this.progressCb = null;
    };
  }

  onPlaybackEnd(callback: () => void): () => void {
    this.endCb = callback;
    return () => {
      this.endCb = null;
    };
  }

  release(): void {
    this.released += 1;
  }

  /** 测试辅助：模拟进度回调 */
  fireProgress(positionMs: number): void {
    this.progressCb?.(positionMs);
  }

  /** 测试辅助：模拟当前文件播放到结尾 */
  fireEnd(): void {
    this.endCb?.();
  }
}
