/**
 * 领域实体类型集中定义。
 * 约束：domain 模块之间只 import 类型（types/ports/commands/result），不 import 实现，防止循环依赖。
 * 实体随里程碑逐步落地：P0 只有工程；来源/章节/角色/绑定/生成任务随 P1/P2 扩展（见 docs/plan.md 5.2）。
 */

export type ProjectId = string;

export interface Project {
  id: ProjectId;
  title: string;
  description: string;
  /** 乐观并发修订号：任何采用类命令使它 +1（expectedRevision 校验的基础） */
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface SourceInfo {
  id: string;
  projectId: ProjectId;
  filename: string;
  /** 首版恒为 'utf-8'（docs/plan.md 4.2） */
  encoding: 'utf-8';
  rawSha256: string;
  textSha256: string;
  byteSize: number;
  createdAt: number;
}

export interface Chapter {
  id: string;
  projectId: ProjectId;
  sourceId: string;
  title: string;
  /** 半开区间 [startOffset, endOffset)，解码文本字符偏移，分区不重叠 */
  startOffset: number;
  endOffset: number;
  volume: number;
  ordinal: number;
  headingLine: number | null;
}

export interface VoiceInfo {
  provider: string;
  /** provider 内的音色标识，如 Edge TTS 的 zh-CN-XiaoxiaoNeural */
  voiceId: string;
  name: string;
}
