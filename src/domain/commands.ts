/**
 * 命令与幂等回执（command_receipts）。
 * 这是横切机制：分章采用、角色确认、绑定修订、生成任务共用同一套规则，
 * 因此独立成模块，而不是埋在任何单个任务类型里（docs/plan.md 0.1 #15）。
 */

import type { Result } from './result';

export interface Command {
  /** 客户端生成的唯一命令 id：幂等回执的主键，重复提交返回旧结果 */
  commandId: string;
  /** 期望的书籍修订号；不匹配返回 conflict（乐观并发） */
  expectedRevision?: number;
}

export interface CommandReceipt<T> {
  commandId: string;
  result: Result<T>;
  createdAt: number;
}

/**
 * 幂等规则：已有回执的命令直接返回旧结果，不再执行。
 * execute 里应当包含"校验 → 落库 → 写回执"的完整事务（由 services 层编排）。
 */
export function resolveIdempotent<T>(
  receipt: CommandReceipt<T> | null,
  execute: () => Promise<Result<T>>,
): Promise<Result<T>> {
  if (receipt) return Promise.resolve(receipt.result);
  return execute();
}
