import { FlatList, Pressable, Text, TouchableWithoutFeedback, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { pageForOffset, paginateText } from '@/domain/reader';
import type { Paragraph } from '@/domain/source';

/**
 * 章节工作台的正文视图（docs/plan.md 4.1.6 + manual-reading-plan R2）：
 * 双模式——上下滚动（FlatList，听书高亮跟随）+ 左右翻页（PagerView，市面阅读器形态）。
 * 分页为字符偏移确定性算法（domain/reader.ts）；边听边读：播放偏移自动翻页。
 * 纯展示组件：状态与回调经 props 注入（components 不 import services/adapters）。
 */

export type ReaderMode = 'scroll' | 'paged';
/** 字号四档（manual-reading-plan §2） */
export const FONT_SIZES = { small: 14, standard: 15.5, large: 18, xlarge: 21 } as const;
export type FontSizeKey = keyof typeof FONT_SIZES;

export interface ReaderViewProps {
  chapterTitle: string;
  chapterText: string;
  chapterBaseOffset: number;
  mode: ReaderMode;
  fontSize: FontSizeKey;
  /** 边听边读跟随（paged 模式：播放偏移变化自动翻页） */
  followPlayback: boolean;
  highlightOffset: number | null;
  playingThisChapter: boolean;
  playbackStatus: 'idle' | 'playing' | 'paused' | 'done';
  playbackRate: number;
  segmentIndex: number;
  segmentCount: number;
  /** 恢复阅读位置的初始偏移（paged 模式按页首回位） */
  initialOffset: number;
  paragraphs: Paragraph[];
  /** 滚动模式：可视段落变化（阅读位置持久化，scroll 模式） */
  onViewableItems(info: { viewableItems: Array<{ item?: unknown }> }): void;
  /** 翻页模式：页选择变化（阅读位置持久化，paged 模式） */
  onPageChange(charOffset: number): void;
  onBack(): void;
  onPlayChapter(): void;
  onPause(): void;
  onResume(): void;
  onCycleRate(): void;
  onCycleFontSize(): void;
  onToggleMode(): void;
}

export function ReaderView(props: ReaderViewProps) {
  const fontSize = FONT_SIZES[props.fontSize];
  const { width: windowW } = useWindowDimensions();
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null);
  const pagerRef = useRef<PagerView | null>(null);
  const currentPageRef = useRef(0);
  const viewableCbRef = useRef<((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null>(null);
  viewableCbRef.current = (info) => props.onViewableItems(info);
  const playingHere = props.playingThisChapter && props.playbackStatus === 'playing';
  const pausedHere = props.playingThisChapter && props.playbackStatus === 'paused';

  // 分页 metrics：CJK 方块字假设（±1 字取舍见计划书 §2），容器尺寸/字号变化自动重算
  const metrics = useMemo(() => {
    if (!contentSize) return null;
    return {
      charsPerLine: Math.max(1, Math.floor(contentSize.w / fontSize)),
      linesPerPage: Math.max(1, Math.floor(contentSize.h / (fontSize * 1.7))),
    };
  }, [contentSize, fontSize]);

  const pages = useMemo(
    () => (metrics ? paginateText(props.chapterText, props.chapterBaseOffset, metrics) : []),
    [props.chapterText, props.chapterBaseOffset, metrics],
  );

  // 听读跟随：播放偏移推进 → 自动翻到所在页（仅 paged 模式 + 跟随开启）
  useEffect(() => {
    if (props.mode !== 'paged' || !props.followPlayback || pages.length === 0) return;
    if (!props.playingThisChapter || props.highlightOffset === null) return;
    const target = pageForOffset(pages, props.highlightOffset);
    pagerRef.current?.setPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlightOffset, props.mode, pages.length, props.followPlayback, props.playingThisChapter]);

  // 初始偏移恢复：进入阅读/字号变化后按偏移回位
  useEffect(() => {
    if (props.mode !== 'paged' || pages.length === 0 || props.initialOffset <= 0) return;
    const target = pageForOffset(pages, props.initialOffset);
    pagerRef.current?.setPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialOffset, pages.length, props.mode]);

  // 点击分区：左 1/3 上一页，右 1/3 下一页，中 1/3 呼出菜单
  const handleTap = (event: { nativeEvent: { pageX: number } }) => {
    const x = event.nativeEvent.pageX;
    const zoneW = windowW / 3;
    if (props.mode !== 'paged') return;
    if (x < zoneW) {
      const prev = Math.max(0, currentPageRef.current - 1);
      pagerRef.current?.setPage(prev);
    } else if (x >= zoneW * 2) {
      if (currentPageRef.current + 1 < pages.length) pagerRef.current?.setPage(currentPageRef.current + 1);
    }
  };

  const controls = (
    <>
      {playingHere ? (
        <Pressable
          className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
          onPress={props.onPause}
        >
          <Text className="text-xs text-ink dark:text-ink-night">暂停</Text>
        </Pressable>
      ) : pausedHere ? (
        <Pressable
          className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
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
          正在朗读第 {props.segmentIndex + 1}/{props.segmentCount} 段
        </Text>
      ) : (
        <Text className="text-xs text-faint">段级播放：当前段即高亮单元</Text>
      )}
      <Pressable
        className="ml-auto rounded-lg bg-raised px-2.5 py-1.5 dark:bg-raised-night"
        onPress={props.onCycleRate}
      >
        <Text className="text-xs text-ink dark:text-ink-night">{props.playbackRate}×</Text>
      </Pressable>
      <Pressable
        className="rounded-lg bg-raised px-2.5 py-1.5 dark:bg-raised-night"
        onPress={props.onCycleFontSize}
      >
        <Text className="text-xs text-ink dark:text-ink-night">字{props.fontSize === 'small' ? '小' : props.fontSize === 'standard' ? '中' : props.fontSize === 'large' ? '大' : '特大'}</Text>
      </Pressable>
      <Pressable
        className="rounded-lg bg-raised px-2.5 py-1.5 dark:bg-raised-night"
        onPress={props.onToggleMode}
      >
        <Text className="text-xs text-ink dark:text-ink-night">{props.mode === 'paged' ? '滚动' : '翻页'}</Text>
      </Pressable>
    </>
  );

  return (
    <View className="flex-1 bg-paper pt-14 dark:bg-paper-night">
      <View className="flex-row items-center justify-between px-4">
        <Pressable
          className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
          onPress={props.onBack}
        >
          <Text className="text-sm text-ink dark:text-ink-night">返回目录</Text>
        </Pressable>
        <Text
          className="font-serif flex-1 mx-3 text-center text-sm font-semibold text-ink dark:text-ink-night"
          numberOfLines={1}
        >
          {props.chapterTitle}
        </Text>
        <View className="w-16" />
      </View>
      <View className="mt-2 flex-row flex-wrap items-center gap-2 px-4">{controls}</View>
      <View
        className="mt-2 flex-1 px-5"
        onLayout={(e) =>
          setContentSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {props.mode === 'paged' && contentSize && metrics ? (
          <TouchableWithoutFeedback onPress={handleTap}>
            <View className="flex-1">
              <PagerView
                ref={pagerRef}
                style={{ flex: 1 }}
                initialPage={0}
                overdrag={false}
                onPageSelected={(e) => {
                  currentPageRef.current = e.nativeEvent.position;
                  const page = pages[e.nativeEvent.position];
                  if (page) props.onPageChange(page.startOffset);
                }}
              >
                {pages.map((page) => (
                  <View key={page.ordinal} className="flex-1">
                    <Text
                      className="font-serif text-ink dark:text-ink-night"
                      style={{ fontSize, lineHeight: fontSize * 1.7 }}
                    >
                      {props.chapterText.slice(page.startOffset, page.endOffset)}
                    </Text>
                    <Text className="mt-4 text-center text-[10px] text-faint dark:text-faint-night">
                      {page.ordinal + 1} / {pages.length}
                    </Text>
                  </View>
                ))}
              </PagerView>
            </View>
          </TouchableWithoutFeedback>
        ) : null}
        {props.mode === 'scroll' ? (
          <FlatList
            className="flex-1"
            data={props.paragraphs}
            keyExtractor={(item, index) => `${item.startOffset}-${index}`}
            onViewableItemsChanged={(info) => viewableCbRef.current?.(info)}
            renderItem={({ item }) => {
              const isHighlighted =
                props.highlightOffset !== null &&
                item.startOffset <= props.highlightOffset &&
                props.highlightOffset < item.endOffset;
              return (
                <Text
                  className={
                    isHighlighted
                      ? 'rounded-lg bg-accent-soft py-2 font-serif text-[15.5px] leading-7 text-accent-deep dark:bg-accent-nightsoft dark:text-ink-night'
                      : 'py-2 font-serif text-[15.5px] leading-7 text-ink dark:text-ink-night'
                  }
                  style={{ fontSize }}
                >
                  {item.text}
                </Text>
              );
            }}
          />
        ) : null}
      </View>
    </View>
  );
}
