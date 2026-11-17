
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

/** 文本模型未配置：网关抛出，服务层据此归为 invalid 而非 network（与提示文案解耦） */
export class LlmNotConfiguredError extends Error {
  constructor(message = '未配置文本模型：请到 设置 → 服务连接 填写端点、模型与密钥') {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}

/** 把远程调用异常归到命令错误码；未配置为输入/配置问题，其余按网络失败处理 */
export function remoteErrorCode(error: unknown): CommandErrorCode {
  return error instanceof LlmNotConfiguredError ? 'invalid' : 'network';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
