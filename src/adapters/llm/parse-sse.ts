/**
 * SSE 帧解析：纯函数，与传输解耦，可被 vitest 直接覆盖。
 * 真实流式传输用 expo/fetch（RN 全局 fetch 不支持响应体流式）。
 */

export interface SseEvent {
  /** event: 字段；未声明时为 null（消息事件） */
  event: string | null;
  data: string;
}

export interface SseParser {
  /** 喂入一个已解码的文本块；跨块的帧会缓冲到完整为止 */
  push(chunk: string): void;
}

export function createSseParser(onEvent: (event: SseEvent) => void): SseParser {
  let buffer = '';

  return {
    push(chunk: string): void {
      // 统一换行符，容忍 CRLF 服务端
      buffer += chunk.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(block);
        if (event) onEvent(event);
        boundary = buffer.indexOf('\n\n');
      }
    },
  };
}

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
    // 注释（:开头）与其他字段忽略
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}
