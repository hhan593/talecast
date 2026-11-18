import { FlatList, Pressable, Text, View } from 'react-native';

import type { Paragraph } from '@/domain/source';

/**
 * 章节工作台的正文视图（docs/plan.md 4.1.6）：段队列播放控制条 + 段级跟随高亮。
 * 纯展示组件：播放状态与回调经 props 注入（components 不 import services/adapters）。
 */

export interface ReaderViewProps {
  chapterTitle: string;
  paragraphs: Paragraph[];
  /** 恢复阅读位置的初始段索引；undefined 表示从头 */
  initialIndex?: number;
  /** FlatList 估算行高（按段文本长度），滚动定位用 */
  layout: { lengths: number[]; offsets: number[] };
  /** 当前朗读段的全文起始偏移（高亮单元）；null = 未在播本章 */
  highlightOffset: number | null;
  playingThisChapter: boolean;
  playbackStatus: 'idle' | 'playing' | 'paused' | 'done';
  segmentIndex: number;
  segmentCount: number;
  onBack(): void;
  onPlayChapter(): void;
  onPause(): void;
  onResume(): void;
  onSeekParagraph(paragraph: Paragraph): void;
  onViewableItems(info: { viewableItems: Array<{ item?: unknown }> }): void;
}

export function ReaderView(props: ReaderViewProps) {
  const playingHere = props.playingThisChapter && props.playbackStatus === 'playing';
  const pausedHere = props.playingThisChapter && props.playbackStatus === 'paused';
  return (
    <View className="flex-1 bg-paper pt-14 dark:bg-paper-night">
      <View className="flex-row items-center justify-between px-4">
        <Pressable className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night" onPress={props.onBack}>
          <Text className="text-sm text-ink dark:text-ink-night">返回目录</Text>
        </Pressable>
        <Text
          className="flex-1 mx-3 text-center text-sm font-semibold text-ink dark:text-ink-night"
          numberOfLines={1}
        >
          {props.chapterTitle}
        </Text>
        <View className="w-16" />
      </View>
      <View className="mt-2 flex-row items-center gap-2 px-4">
        {playingHere ? (
          <Pressable
            className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night"
            onPress={props.onPause}
          >
            <Text className="text-xs text-ink dark:text-ink-night">暂停</Text>
          </Pressable>
        ) : pausedHere ? (
          <Pressable
            className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night"
            onPress={props.onResume}
          >
            <Text className="text-xs text-ink dark:text-ink-night">继续</Text>
          </Pressable>
        ) : (
          <Pressable className="rounded-lg bg-accent px-3 py-1.5" onPress={props.onPlayChapter}>
            <Text className="text-xs font-semibold text-white">播放整章</Text>
          </Pressable>
        )}
        {props.playingThisChapter && props.segmentCount > 0 ? (
          <Text className="text-xs text-muted dark:text-muted-night">
            正在朗读第 {props.segmentIndex + 1}/{props.segmentCount} 段（点任意段落跳转）
          </Text>
        ) : (
          <Text className="text-xs text-faint">段级播放：当前段即高亮单元</Text>
        )}
      </View>
      {props.paragraphs.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-sm text-muted">本章内容为空</Text>
        </View>
      ) : (
        <FlatList
          className="mt-2 px-4"
          data={props.paragraphs}
          keyExtractor={(item, index) => `${item.startOffset}-${index}`}
          initialScrollIndex={props.initialIndex}
          getItemLayout={(_, index) => ({
            length: props.layout.lengths[index] ?? 96,
            offset: props.layout.offsets[index] ?? 96 * index,
            index,
          })}
          renderItem={({ item }) => {
            const isHighlighted =
              props.highlightOffset !== null &&
              item.startOffset <= props.highlightOffset &&
              props.highlightOffset < item.endOffset;
            return (
              <Pressable onPress={() => props.onSeekParagraph(item)}>
                <Text
                  className={
                    isHighlighted
                      ? 'rounded-lg bg-accent-soft py-2 text-[15px] leading-6 text-accent-deep dark:bg-accent-nightsoft dark:text-ink-night'
                      : 'py-2 text-[15px] leading-6 text-ink dark:text-ink-night'
                  }
                >
                  {item.text}
                </Text>
              </Pressable>
            );
          }}
          onViewableItemsChanged={props.onViewableItems}
        />
      )}
    </View>
  );
}
