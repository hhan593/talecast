import type {
  AssistantMessageRecord,
  AssistantRepository,
  AssistantSessionRecord,
  LlmGateway,
} from '@/domain/ports';

export class FakeLlmGateway implements LlmGateway {
  public calls: Array<{ system: string; user: string }> = [];
  public response: string | null = null;
  /** 分块流式：设置后按块回调 onDelta，块间等待 chunkDelayMs（模拟真实网络） */
  public streamChunks: string[] | null = null;
  public chunkDelayMs = 0;
  public error: Error | null = null;

  async complete(input: { system: string; user: string; onDelta?: (delta: string) => void }): Promise<string> {
    this.calls.push(input);
    if (this.error) throw this.error;
    const response = this.response ?? '{"characters":[]}';
    if (this.streamChunks !== null) {
      for (const chunk of this.streamChunks) {
        if (this.chunkDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
        }
        input.onDelta?.(chunk);
      }
      return this.streamChunks.join('');
    }
    input.onDelta?.(response);
    return response;
  }
}

export class FakeAssistantRepository implements AssistantRepository {
  public sessions = new Map<string, AssistantSessionRecord>();
  public messages: AssistantMessageRecord[] = [];

  async getOrCreateSession(projectId: string): Promise<AssistantSessionRecord> {
    const id = `sess-${projectId}`;
    let session = this.sessions.get(id);
    if (!session) {
      session = { id, projectId, taskKind: 'general', chapterId: null, createdAt: Date.now() };
      this.sessions.set(id, session);
    }
    return { ...session };
  }

  async listMessages(
    sessionId: string,
    options: { limit: number; beforeOrdinal?: number },
  ): Promise<AssistantMessageRecord[]> {
    const list = this.messages
      .filter((m) => m.sessionId === sessionId && (options.beforeOrdinal === undefined || m.ordinal < options.beforeOrdinal))
      .sort((a, b) => b.ordinal - a.ordinal)
      .slice(0, options.limit);
    return list.reverse().map((m) => ({ ...m }));
  }

  async appendMessage(record: AssistantMessageRecord): Promise<void> {
    if (this.messages.some((m) => m.id === record.id)) throw new Error('UNIQUE constraint failed');
    this.messages.push({ ...record });
  }

  async updateMessageParts(sessionId: string, ordinal: number, partsJson: string, nextVersion: number): Promise<void> {
    const message = this.messages.find((m) => m.sessionId === sessionId && m.ordinal === ordinal);
    if (!message) throw new Error('message 不存在');
    message.partsJson = partsJson;
    message.version = nextVersion;
  }

  async countMessages(sessionId: string): Promise<number> {
    return this.messages.filter((m) => m.sessionId === sessionId).length;
  }
}
