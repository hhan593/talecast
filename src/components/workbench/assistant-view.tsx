import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveAssistantScope, type AssistantScope } from '@/domain/assistant';
import { useI18n } from '@/hooks/use-i18n';

/**
 * 章节工作台的助手视图（docs/plan.md 4.1.7 + issue #66 重做）：对话式 UI。
 * 范围选择收拢为「全书 / 选中段落 / 章节▾」三枚 chip——章节列表按需展开，
 * 不再把每章平铺成几十个 chip；流式输出渲染为助手气泡（ListFooter）；
 * 新消息自动滚到底；底部输入条让开系统手势条。
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
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<AssistantMessageItem> | null>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const resolved = resolveAssistantScope(props.scope, props.chapters);
  const notice = resolved?.notice ?? t('assistant.invalidScope');
  // 选区是书级偏移：按偏移找所属章节，不能沿用当前范围（否则跨章选区会静默指向错误章节）
  const selectionChapter = props.selection
    ? props.chapters.find((c) => props.selection!.start >= c.startOffset && props.selection!.end <= c.endOffset)
    : undefined;
  const selectionScope: AssistantScope | null = props.selection && selectionChapter
    ? { kind: 'selection', chapterId: selectionChapter.id, startOffset: props.selection.start, endOffset: props.selection.end }
    : null;

  const scopeEquals = (a: AssistantScope, b: AssistantScope) => JSON.stringify(a) === JSON.stringify(b);

  // 新消息 / 流式开始时贴底：用户视线焦点始终是最新内容
  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.messages?.length, props.streaming]);

  const scopeChip = (params: { label: string; active: boolean; icon?: 'globe-outline' | 'text-outline'; onPress: () => void }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: params.active }}
      className={`flex-row items-center gap-1 rounded-full border px-3 py-1.5 ${
        params.active ? 'border-accent bg-accent-soft dark:bg-accent-nightsoft' : 'border-line dark:border-line-night'
      }`}
      onPress={params.onPress}
    >
      {params.icon ? <Ionicons name={params.icon} size={12} color={params.active ? '#B5442D' : '#8C8272'} /> : null}
      <Text
        className={`text-xs ${params.active ? 'font-semibold text-accent dark:text-accent-night' : 'text-ink dark:text-ink-night'}`}
        numberOfLines={1}
      >
        {params.label}
      </Text>
    </Pressable>
  );

  const bubble = (text: string, keyHint: string, extra?: React.ReactNode) => (
    <View key={keyHint} className="my-1 max-w-[88%] self-start rounded-2xl rounded-bl-sm bg-card px-4 py-2.5 dark:bg-card-night">
      <Text className="text-sm leading-5 text-ink dark:text-ink-night">{text || '…'}</Text>
      {extra}
    </View>
  );

  return (
    <View className="flex-1 bg-paper dark:bg-paper-night">
      {/* 顶栏：返回 + 标题（与阅读器/详情页同一套顶栏语汇） */}
      <View className="flex-row items-center px-1 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          className="h-9 w-9 items-center justify-center"
          onPress={props.onBack}
        >
          <Ionicons name="chevron-back" size={22} color="#2C2822" />
        </Pressable>
        <Text className="flex-1 text-center text-sm font-semibold text-ink dark:text-ink-night">
          {t('assistant.title')}
        </Text>
        <View className="w-9" />
      </View>

      {/* 范围选择：全书 / 选中段落 / 章节▾（章节列表按需展开，不再平铺几十个 chip） */}
      <View className="mt-2 gap-2 px-4">
        <View className="flex-row flex-wrap gap-2">
          {scopeChip({
            label: t('assistant.bookScope'),
            icon: 'globe-outline',
            active: scopeEquals(props.scope, { kind: 'book' }),
            onPress: () => props.onScopeChange({ kind: 'book' }),
          })}
          {selectionScope
            ? scopeChip({
                label: t('assistant.selectionScope'),
                icon: 'text-outline',
                active: scopeEquals(props.scope, selectionScope),
                onPress: () => props.onScopeChange(selectionScope),
              })
            : null}
          {scopeChip({
            label: t('assistant.chapterScope'),
            active: props.scope.kind === 'chapter' || chaptersOpen,
            onPress: () => setChaptersOpen((prev) => !prev),
          })}
        </View>
        {chaptersOpen ? (
          <View className="max-h-52 rounded-xl border border-line dark:border-line-night">
            <FlatList
              data={props.chapters}
              keyExtractor={(item) => item.id}
              nestedScrollEnabled
              renderItem={({ item }) => {
                const active = scopeEquals(props.scope, { kind: 'chapter', chapterId: item.id });
                return (
                  <Pressable
                    accessibilityRole="button"
                    className={`flex-row items-center rounded-lg px-3 py-2 ${active ? 'bg-accent-soft dark:bg-accent-nightsoft' : ''}`}
                    onPress={() => {
                      props.onScopeChange({ kind: 'chapter', chapterId: item.id });
                      setChaptersOpen(false);
                    }}
                  >
                    <Text className={`mr-2 text-[10px] ${active ? 'text-accent dark:text-accent-night' : 'text-faint'}`}>
                      {props.chapters.findIndex((c) => c.id === item.id) + 1}
                    </Text>
                    <Text
                      className={`flex-1 text-xs ${active ? 'font-semibold text-accent dark:text-accent-night' : 'text-ink dark:text-ink-night'}`}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={14} color="#B5442D" /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        ) : null}
      </View>

      {/* 消息列表：气泡对话；加载更早在列表头，流式输出为尾随助手气泡 */}
      <FlatList
        ref={listRef}
        className="mt-2 flex-1 px-4"
        data={props.messages ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          props.hasEarlier ? (
            <Pressable accessibilityRole="button" className="mb-2 self-center rounded-full bg-raised px-3 py-1 dark:bg-raised-night" onPress={props.onLoadEarlier}>
              <Text className="text-xs text-accent">{t('assistant.loadEarlier')}</Text>
            </Pressable>
          ) : undefined
        }
        ListEmptyComponent={
          <View className="items-center py-16">
            <Ionicons name="chatbubble-ellipses-outline" size={36} color="#C9C0AE" />
            <Text className="mt-3 px-8 text-center text-sm text-muted dark:text-muted-night">
              {t('assistant.empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className={item.role === 'user' ? 'items-end' : 'items-start'}>
            <View
              className={
                item.role === 'user'
                  ? 'my-1 max-w-[88%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5'
                  : 'my-1 max-w-[88%] rounded-2xl rounded-bl-sm bg-card px-4 py-2.5 dark:bg-card-night'
              }
            >
              <Text
                className={
                  item.role === 'user' ? 'text-sm leading-5 text-white' : 'text-sm leading-5 text-ink dark:text-ink-night'
                }
              >
                {item.text}
              </Text>
              {item.role === 'user' && item.scopeNotice ? (
                <Text className="mt-1 text-[10px] text-white/70">{t('assistant.scopeLabel', { notice: item.scopeNotice ?? '' })}</Text>
              ) : null}
              {item.proposalId ? (
                <Pressable
                  accessibilityRole="button"
                  className="mt-2 flex-row items-center gap-1.5 self-start rounded-lg bg-gold px-3 py-1.5"
                  onPress={() => props.onOpenProposal(item.proposalId!)}
                >
                  <Ionicons name="document-text-outline" size={12} color="#FFFFFF" />
                  <Text className="text-xs font-semibold text-white">{t('assistant.reviewProposal')}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        ListFooterComponent={
          props.streaming ? (
            <View className="my-1 flex-row items-end gap-1.5 self-start">
              {bubble(props.streamText, 'streaming')}
              <View className="mb-3 h-2 w-2 rounded-full bg-accent" />
            </View>
          ) : undefined
        }
      />

      {props.error ? (
        <Text className="mx-4 mb-2 rounded-lg bg-danger-soft p-2 text-xs text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {props.error}
        </Text>
      ) : null}

      {/* 发送范围紧贴输入框：发送前最后一眼确认 */}
      <Text className="mb-1 px-4 text-[10px] text-faint" numberOfLines={1}>
        {t('assistant.sendingNotice', { notice })}
      </Text>
      <View
        className="flex-row items-end gap-2 border-t border-line px-4 pt-3 dark:border-line-night"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <TextInput
          className="max-h-28 flex-1 rounded-xl border border-line px-3 py-2 text-sm text-ink dark:border-line-night dark:text-ink-night"
          placeholder={t('assistant.placeholder')}
          placeholderTextColor="#8C8272"
          value={props.input}
          onChangeText={props.onInputChange}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('assistant.send')}
          className="h-11 w-11 items-center justify-center rounded-xl bg-accent active:bg-accent-deep"
          disabled={props.streaming || props.input.trim().length === 0}
          onPress={() => props.onSend(props.input)}
        >
          <Ionicons name="send" size={18} color={props.streaming || props.input.trim().length === 0 ? 'rgba(255,255,255,0.5)' : '#FFFFFF'} />
        </Pressable>
      </View>
    </View>
  );
}
