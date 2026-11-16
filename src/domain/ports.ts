/**
 * 端口（ports & adapters）：domain 需要什么由这里定义，adapters 负责实现。
 * 依赖方向唯一：services 依赖 ports，adapters 实现 ports，domain 不 import 任何上层（docs/plan.md 5.1）。
 * P0 只落地仓储与回执存储；KeyStore/TtsGateway/AudioPlayer 的实现随 P2/P3/P4 接入。
 */

import type { CommandReceipt } from './commands';
import type { Project, VoiceInfo } from './types';

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: Project['id']): Promise<Project | null>;
  create(input: { id: Project['id']; title: string; description: string; createdAt: number }): Promise<Project>;
}

export interface ReceiptStore {
  get<T>(commandId: string): Promise<CommandReceipt<T> | null>;
  put<T>(receipt: CommandReceipt<T>): Promise<void>;
}

export interface KeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface TtsGateway {
  listVoices(): Promise<VoiceInfo[]>;
  /** 合成单段并写入 outputPath；失败抛错由 services 层转为 Result */
  synthesizeSegment(input: { text: string; voiceId: string; outputPath: string }): Promise<{ filePath: string }>;
}

export interface AudioPlayer {
  load(uri: string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  onProgress(callback: (positionMs: number) => void): () => void;
  onPlaybackEnd(callback: () => void): () => void;
}
