import { describe, expect, it } from 'vitest';

import { createSseParser } from './parse-sse';

function collect() {
  const events: { event: string | null; data: string }[] = [];
  const parser = createSseParser((event) => events.push(event));
  return { events, parser };
}

describe('createSseParser', () => {
  it('解析完整帧', () => {
    const { events, parser } = collect();
    parser.push('data: hello\n\n');
    expect(events).toEqual([{ event: null, data: 'hello' }]);
  });

  it('跨块缓冲：帧被拆在两次 push 之间也能完整解析', () => {
    const { events, parser } = collect();
    parser.push('data: he');
    parser.push('llo\n\ndata: world\n\n');
    expect(events.map((e) => e.data)).toEqual(['hello', 'world']);
  });

  it('携带 event 字段与多行 data', () => {
    const { events, parser } = collect();
    parser.push('event: delta\ndata: 第一行\ndata: 第二行\n\n');
    expect(events).toEqual([{ event: 'delta', data: '第一行\n第二行' }]);
  });

  it('容忍 CRLF 换行', () => {
    const { events, parser } = collect();
    parser.push('data: a\r\n\r\ndata: b\r\n\r\n');
    expect(events.map((e) => e.data)).toEqual(['a', 'b']);
  });

  it('忽略注释块与纯注释行', () => {
    const { events, parser } = collect();
    parser.push(': ping\ndata: real\n\n');
    expect(events.map((e) => e.data)).toEqual(['real']);
  });

  it('结尾不满一帧的残余保留在缓冲中，不误发', () => {
    const { events, parser } = collect();
    parser.push('data: pending');
    expect(events).toEqual([]);
  });
});
