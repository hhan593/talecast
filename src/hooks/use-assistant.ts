import { useCallback, useEffect, useState } from 'react';

import { useServices } from '@/container';
import type { AssistantMessageView } from '@/services/assistant';

/** 助手会话入口（docs/plan.md 4.1.7）：流式回复 + 历史分页 + 候选卡 */
export function useAssistant(projectId: string) {
  const services = useServices();
  const [messages, setMessages] = useState<AssistantMessageView[] | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
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
    [projectId, reloadLatest, services],
  );

  return { messages, streaming, streamText, error, hasEarlier: oldestOrdinal !== null && oldestOrdinal > 0, send, loadEarlier, reloadLatest };
}
