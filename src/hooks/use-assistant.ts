import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { AssistantScope } from '@/domain/assistant';
import type { AssistantMessageView } from '@/services/assistant';

export function useAssistant(projectId: string) {
  const services = useServices();
  const [messages, setMessages] = useState<AssistantMessageView[] | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** 本次提问发送给模型的正文范围（默认全书概览，不发送全文） */
  const [scope, setScope] = useState<AssistantScope>({ kind: 'book' });
  /** 历史分页：最早已加载的 ordinal；null 表示已到头 */
  const [oldestOrdinal, setOldestOrdinal] = useState<number | null>(null);
  const PAGE_SIZE = 20;

  const reloadLatest = useCallback(async () => {
    const list = await services.assistant.listMessages(projectId, { limit: PAGE_SIZE });
    setMessages(list);
    setOldestOrdinal(list.length > 0 ? list[0].ordinal : null);
  }, [projectId, services]);

  useEffect(() => {
    void reloadLatest();
  }, [reloadLatest]);

  const loadEarlier = useCallback(async () => {
    if (messages === null || oldestOrdinal === null || oldestOrdinal === 0) return;
    const earlier = await services.assistant.listMessages(projectId, {
      limit: PAGE_SIZE,
      beforeOrdinal: oldestOrdinal,
    });
    if (earlier.length === 0) {
      setOldestOrdinal(0);
      return;
    }
    setMessages([...earlier, ...messages]);
    setOldestOrdinal(earlier[0].ordinal);
  }, [messages, oldestOrdinal, projectId, services]);

  const send = useCallback(
    async (userText: string) => {
      if (userText.trim().length === 0) return;
      setStreaming(true);
      setStreamText('');
      setError(null);
      try {
        const result = await services.assistant.sendMessage({
          projectId,
          commandId: services.newCommandId(),
          userText,
          scope,
          onDelta: (delta) => setStreamText((prev) => prev + delta),
        });
        if (!result.ok) {
          setError(result.error.message);
          return result;
        }
        await reloadLatest();
        return result;
      } finally {
        setStreaming(false);
        setStreamText('');
      }
    },
    [projectId, reloadLatest, scope, services],
  );

  return { messages, streaming, streamText, error, scope, setScope, hasEarlier: oldestOrdinal !== null && oldestOrdinal > 0, send, loadEarlier, reloadLatest };
}
