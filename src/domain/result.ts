/**
 * 命令结果类型：忙、失败等语义统一（对应 docs/plan.md P4 的明确错误提示）。
 * 服务层与 UI 之间一律用 Result 传递命令结果，不用裸抛错承载业务失败。
 */

export type CommandErrorCode =
  | 'busy' // 有活动任务占用
  | 'not_found' // 目标不存在
  | 'invalid' // 输入校验不通过
  | 'conflict' // expectedRevision 不匹配
  | 'storage' // 本地存储失败
  | 'network' // 网络/远程服务失败
  | 'unknown';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: CommandError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (code: CommandErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
