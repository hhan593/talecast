import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { resolveAssistantScope, type AssistantScope } from '@/domain/assistant';

/**
 * 章节工作台的助手视图（docs/plan.md 4.1.7）：流式消息 + 历史分页 + 候选卡。
 * 纯展示组件：会话状态与回调经 props 注入（components 不 import services/adapters）。
 */

export interface AssistantMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 非空时渲染"去审阅"候选卡（采用在审阅 modal 完成） */
  proposalId: string | null;
  /** 用户消息附带本次发送范围，历史可追溯 */
  scopeNotice: string | null;
}

export interface AssistantViewProps {
  messages: AssistantMessageItem[] | null;
  streaming: boolean;
  streamText: string;
  error: string | null;
  hasEarlier: boolean;
  input: string;
  scope: AssistantScope;
  chapters: Array<{ id: string; title: string; startOffset: number; endOffset: number }>;
  selection: { start: number; end: number } | null;
  onScopeChange(scope: AssistantScope): void;
  onBack(): void;
  onLoadEarlier(): void;
  onInputChange(text: string): void;
  onSend(text: string): void;
  onOpenProposal(proposalId: string): void;
}

export function AssistantView(props: AssistantViewProps) {
  const resolved = resolveAssistantScope(props.scope, props.chapters);
  const notice = resolved?.notice ?? '范围无效，请重新选择';
  // 选区是书级偏移：按偏移找所属章节，不能沿用当前范围（否则跨章选区会静默指向错误章节）
  const selectionChapter = props.selection
    ? props.chapters.find((c) => props.selection!.start >= c.startOffset && props.selection!.end <= c.endOffset)
    : undefined;
  const selectionScope: AssistantScope | null = props.selection && selectionChapter
    ? { kind: 'selection', chapterId: selectionChapter.id, startOffset: props.selection.start, endOffset: props.selection.end }
    : null;
  const options: Array<{ key: string; label: string; value: AssistantScope }> = [
    { key: 'book', label: '全书概览', value: { kind: 'book' } },
    ...props.chapters.map((c) => ({ key: `ch-${c.id}`, label: c.title, value: { kind: 'chapter' as const, chapterId: c.id } })),
    ...(selectionScope ? [{ key: 'selection', label: '选中段落', value: selectionScope }] : []),
  ];
  return (
    <View className="flex-1 bg-paper pt-14 dark:bg-paper-night">
      <View className="flex-row items-center justify-between px-4">
        <Pressable className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night" onPress={props.onBack}>
          <Text className="text-sm text-ink dark:text-ink-night">返回目录</Text>
        </Pressable>
        <Text className="text-sm font-semibold text-ink dark:text-ink-night">书籍助手</Text>
        <View className="w-16" />
      </View>
      <Text className="mt-3 px-4 text-xs text-muted dark:text-muted-night">发送范围（原文片段会提交给配置的文本模型服务商）</Text>
      <FlatList
        className="mt-1 px-4"
        horizontal
        data={options}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            className={`mr-2 rounded-full border px-3 py-1.5 ${JSON.stringify(item.value) === JSON.stringify(props.scope) ? 'border-accent bg-accent-soft' : 'border-line dark:border-line-night'}`}
            onPress={() => props.onScopeChange(item.value)}
          >
            <Text className="text-xs text-ink dark:text-ink-night">{item.label}</Text>
          </Pressable>
        )}
      />
      <Text className="px-4 pt-1 text-xs text-faint" numberOfLines={2}>本次发送：{notice}</Text>
      {props.hasEarlier ? (
        <Pressable className="mt-2 self-center px-4" onPress={props.onLoadEarlier}>
          <Text className="text-xs text-accent">加载更早消息</Text>
        </Pressable>
      ) : null}
      <FlatList
        className="mt-2 flex-1 px-4"
        data={props.messages ?? []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              还没有会话记录。助手只提出建议（候选），不会直接修改书籍内容；
              分章候选需要你在审阅中人工采用。使用前需在 设置 → 服务连接 配置文本模型。
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className={item.role === 'user' ? 'items-end' : 'items-start'}>
            <View
              className={
                item.role === 'user'
                  ? 'max-w-[85%] rounded-2xl bg-accent px-4 py-2 my-1'
                  : 'max-w-[85%] rounded-2xl bg-card px-4 py-2 my-1 dark:bg-card-night'
              }
            >
              <Text
                className={
                  item.role === 'user' ? 'text-sm text-white' : 'text-sm text-ink dark:text-ink-night'
                }
              >
                {item.text}
              </Text>
              {item.role === 'user' && item.scopeNotice ? (
                <Text className="mt-1 text-[10px] text-faint">发送范围：{item.scopeNotice}</Text>
              ) : null}
              {item.proposalId ? (
                <Pressable
                  className="mt-2 rounded-lg bg-gold px-3 py-1.5 self-start"
                  onPress={() => props.onOpenProposal(item.proposalId!)}
                >
                  <Text className="text-xs font-semibold text-white">去审阅候选（需人工采用）</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      />
      {props.streaming ? (
        <Text className="px-4 pb-1 text-xs text-faint" numberOfLines={4}>
          {props.streamText || '…'}
        </Text>
      ) : null}
      {props.error ? (
        <Text className="mx-4 rounded-lg bg-danger-soft p-2 text-xs text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {props.error}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-2 border-t border-line px-4 py-3 dark:border-line-night">
        <TextInput
          className="flex-1 rounded-xl border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
          placeholder="向助手提问或请求重新分章（只提议，不直改）"
          value={props.input}
          onChangeText={props.onInputChange}
          multiline
        />
        <Pressable
          className="rounded-xl bg-accent px-4 py-2.5"
          disabled={props.streaming || props.input.trim().length === 0}
          onPress={() => props.onSend(props.input)}
        >
          <Text className="text-sm font-semibold text-white">{props.streaming ? '…' : '发送'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
