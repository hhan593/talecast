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

export interface VoiceInfo {
  provider: string;
  /** provider 内的音色标识，如 Edge TTS 的 zh-CN-XiaoxiaoNeural */
  voiceId: string;
  name: string;
}
