import {
  Animated,
  FlatList,
  Pressable,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { pageForOffset, paginateText } from '@/domain/reader';
import { READER_THEMES, type ReaderThemeKey } from '@/domain/reader-theme';
import type { Paragraph } from '@/domain/source';

/**
 * 章节工作台的正文视图（docs/plan.md 4.1.6 + manual-reading-plan R2 + reading-experience-plan RE-1）：
 * 双模式——滚动/翻页；主题四套（纸感/护眼/纯白/暖黑）；排版（字号/行距/边距）；
 * 沉浸模式（工具栏 3 秒自动隐藏，点击呼出）；听读跟随。
 * 纯展示组件：状态与回调经 props 注入（components 不 import services/adapters）。
 */

export type ReaderMode = 'scroll' | 'paged';
export const FONT_SIZES = { small: 14, standard: 15.5, large: 18, xlarge: 21 } as const;
export type FontSizeKey = keyof typeof FONT_SIZES;
export const LINE_SPACINGS = { compact: 1.5, standard: 1.7, relaxed: 1.9 } as const;
export type LineSpacingKey = keyof typeof LINE_SPACINGS;
export const MARGINS = { narrow: 12, standard: 20, wide: 32 } as const;
export type MarginKey = keyof typeof MARGINS;

export interface ReaderViewProps {
  chapterTitle: string;
  chapterText: string;
  chapterBaseOffset: number;
  mode: ReaderMode;
  fontSize: FontSizeKey;
  /** 翻页样式：slide 平移 / cover 覆盖 / curl 卷页近似 */
  pageTurnStyle: 'slide' | 'cover' | 'curl';
  onCyclePageTurnStyle(): void;
  lineSpacing: LineSpacingKey;
  margin: MarginKey;
  theme: ReaderThemeKey;
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
  onBack(): void;
  onPlayChapter(): void;
  onPause(): void;
  onResume(): void;
  onCycleRate(): void;
  onCycleFontSize(): void;
  onCycleLineSpacing(): void;
  onCycleMargin(): void;
  onCycleTheme(): void;
  onToggleMode(): void;
  onAddBookmark(): void;
  /** 滚动模式：可视段落变化（阅读位置持久化，scroll 模式） */
  onViewableItems(info: { viewableItems: Array<{ item?: unknown }> }): void;
  /** 翻页模式：页选择变化（阅读位置持久化，paged 模式） */
  onPageChange(charOffset: number): void;
}

export function ReaderView(props: ReaderViewProps) {
  const fontSize = FONT_SIZES[props.fontSize];
  const lineSpacing = LINE_SPACINGS[props.lineSpacing];
  const marginPx = MARGINS[props.margin];
  const theme = READER_THEMES[props.theme];
  const { width: windowW } = useWindowDimensions();
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null);
  const pagerRef = useRef<PagerView | null>(null);
  const currentPageRef = useRef(0);
  // 覆盖动画：滚动偏移驱动每页位移（当前页静止，下一页从右滑入覆盖）
  const coverScrollX = useRef(new Animated.Value(0)).current;
  const coverScrollRef = useRef<FlatList | null>(null);
  const viewableCbRef = useRef<
    ((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null
  >(null);
  viewableCbRef.current = (info) => props.onViewableItems(info);

  // 沉浸模式：工具栏 3 秒无操作自动隐藏，任意点击重置（RE-1）
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pokeControls = () => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  };
  useEffect(() => {
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, []);

  // 分页 metrics：CJK 方块字假设；排版（边距/行距/字号）全部进 metrics（RE-1 §2）
  const metrics = useMemo(() => {
    if (!contentSize) return null;
    const contentW = contentSize.w - marginPx * 2;
    return {
      charsPerLine: Math.max(1, Math.floor(contentW / fontSize)),
      linesPerPage: Math.max(1, Math.floor(contentSize.h / (fontSize * lineSpacing))),
    };
  }, [contentSize, fontSize, lineSpacing, marginPx]);

  const pages = useMemo(
    () => (metrics ? paginateText(props.chapterText, props.chapterBaseOffset, metrics) : []),
    [props.chapterText, props.chapterBaseOffset, metrics],
  );

  // 覆盖动画：per-page 位移插值（当前页静止，下一页从右滑入覆盖）
  const coverTransforms = useMemo(() => {
    if (contentSize === null) return [];
    const w = contentSize.w;
    return pages.map((page) => {
      const pageOffset = page.ordinal * w;
      if (page.ordinal === 0) {
        return { transform: [{ translateX: 0 }] };
      }
      return {
        transform: [
          {
            translateX: coverScrollX.interpolate({
              inputRange: [pageOffset - w, pageOffset],
              outputRange: [w, 0],
              extrapolate: 'clamp',
            }),
          },
        ],
      };
    });
  }, [pages, contentSize, coverScrollX]);


  // 听读跟随：播放偏移推进 → 自动翻到所在页（仅 paged 模式 + 跟随开启）
  useEffect(() => {
    if (props.mode !== 'paged' || !props.followPlayback || pages.length === 0) return;
    if (!props.playingThisChapter || props.highlightOffset === null) return;
    const target = pageForOffset(pages, props.highlightOffset);
    pagerRef.current?.setPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlightOffset, props.mode, pages.length, props.followPlayback, props.playingThisChapter]);

  // 初始偏移恢复：进入阅读/排版变化后按偏移回位
  useEffect(() => {
    if (props.mode !== 'paged' || pages.length === 0 || props.initialOffset <= 0) return;
    const target = pageForOffset(pages, props.initialOffset);
    pagerRef.current?.setPage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialOffset, pages.length, props.mode]);

  // 点击分区：左 1/3 上一页，右 1/3 下一页，中 1/3 切换工具栏
  const handleTap = (event: { nativeEvent: { pageX: number } }) => {
    pokeControls();
    const x = event.nativeEvent.pageX;
    const zoneW = windowW / 3;
    if (props.mode !== 'paged') return;
    if (x < zoneW) {
      const prev = Math.max(0, currentPageRef.current - 1);
      pagerRef.current?.setPage(prev);
    } else if (x >= zoneW * 2) {
      if (currentPageRef.current + 1 < pages.length) {
        pagerRef.current?.setPage(currentPageRef.current + 1);
      }
    }
  };

  const playingHere = props.playingThisChapter && props.playbackStatus === 'playing';
  const pausedHere = props.playingThisChapter && props.playbackStatus === 'paused';
  const chipBase = `rounded-lg ${theme.surface}`;

  return (
    <View className={`flex-1 pt-14 ${theme.bg}`}>
      <View className="flex-row items-center justify-between px-4">
        <Pressable
          className={`rounded-lg ${theme.surface} px-3 py-1.5`}
          onPress={() => {
            pokeControls();
            props.onBack();
          }}
        >
          <Text className={`text-sm ${theme.text}`}>返回目录</Text>
        </Pressable>
        <Text
          className={`font-serif flex-1 mx-3 text-center text-sm font-semibold ${theme.text}`}
          numberOfLines={1}
        >
          {props.chapterTitle}
        </Text>
        <View className="w-16" />
      </View>
      {controlsVisible ? (
        <View className="mt-2 flex-row flex-wrap items-center gap-2 px-4">
          {playingHere ? (
            <Pressable
              className={`rounded-lg ${theme.surface} px-3 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onPause();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>暂停</Text>
            </Pressable>
          ) : pausedHere ? (
            <Pressable
              className={`rounded-lg ${theme.surface} px-3 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onResume();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>继续</Text>
            </Pressable>
          ) : (
            <Pressable
              className={`rounded-lg ${theme.action} px-3 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onPlayChapter();
              }}
            >
              <Text className={`text-xs font-semibold ${theme.actionText}`}>播放整章</Text>
            </Pressable>
          )}
          {props.playingThisChapter && props.segmentCount > 0 ? (
            <Text className={`text-xs ${theme.muted}`}>
              第 {props.segmentIndex + 1}/{props.segmentCount} 段
            </Text>
          ) : (
            <Text className={`text-xs ${theme.muted}`}>段级播放：当前段即高亮单元</Text>
          )}
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onCycleRate();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>{props.playbackRate}×</Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onCycleFontSize();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>
              字
              {props.fontSize === 'small'
                ? '小'
                : props.fontSize === 'standard'
                  ? '中'
                  : props.fontSize === 'large'
                    ? '大'
                    : '特大'}
            </Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onCycleLineSpacing();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>行距</Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onCycleMargin();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>边距</Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onCycleTheme();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>主题</Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onToggleMode();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>
              {props.mode === 'paged' ? '滚动' : '翻页'}
            </Text>
          </Pressable>
          <Pressable
            className={`rounded-lg ${theme.surface} px-2.5 py-1.5`}
            onPress={() => {
              pokeControls();
              props.onAddBookmark();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>书签</Text>
          </Pressable>
        </View>
      ) : null}
      <View
        className="mt-2 flex-1"
        onLayout={(e) =>
          setContentSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
        }
      >
        {props.mode === 'paged' && contentSize && metrics ? (
          <TouchableWithoutFeedback
            onPress={(e) => {
              handleTap(e);
            }}
          >
            <View className="flex-1" style={{ paddingHorizontal: marginPx }}>
              <PagerView ref={pagerRef} style={{ flex: 1 }} initialPage={0} overdrag={false}>
                {pages.map((page) => (
                  <View key={page.ordinal} className="flex-1">
                    <Text
                      className={`font-serif ${theme.text}`}
                      style={{ fontSize, lineHeight: fontSize * lineSpacing }}
                    >
                      {props.chapterText.slice(page.startOffset, page.endOffset)}
                    </Text>
                    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
                      {page.ordinal + 1} / {pages.length}
                    </Text>
                  </View>
                ))}
              </PagerView>
            </View>
          </TouchableWithoutFeedback>
        ) : null}
{props.mode === 'paged' && contentSize && metrics && props.pageTurnStyle === 'curl' ? (
          <TouchableWithoutFeedback onPress={handleTap}>
            <View className="flex-1">
              <Animated.FlatList
                ref={coverScrollRef}
                style={{ flex: 1 }}
                data={pages}
                keyExtractor={(item) => String(item.ordinal)}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: coverScrollX } } }],
                  { useNativeDriver: true },
                )}
                renderItem={({ item: page }) => (
                  <Animated.View
                    className={theme.bg}
                    style={[
                      { width: contentSize.w, height: contentSize.h },
                      coverTransforms[page.ordinal],
                      {
                        // 卷页近似：3D 翻页（rotationY + 透视），真 Skia 着色器卷页为 v0.4.x 增强
                        transform: [
                          { perspective: 800 },
                          {
                            rotateY: coverScrollX.interpolate({
                              inputRange: [
                                (page.ordinal - 1) * contentSize.w,
                                page.ordinal * contentSize.w,
                                (page.ordinal + 1) * contentSize.w,
                              ],
                              outputRange: ['90deg', '0deg', '-90deg'],
                              extrapolate: 'clamp',
                            }),
                          },
                        ],
                        backfaceVisibility: 'hidden',
                      },
                    ]}
                  >
                    <Text
                      className={`font-serif ${theme.text}`}
                      style={{ fontSize, lineHeight: fontSize * lineSpacing }}
                    >
                      {props.chapterText.slice(page.startOffset, page.endOffset)}
                    </Text>
                    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
                      {page.ordinal + 1} / {pages.length}
                    </Text>
                  </Animated.View>
                )}
              />
            </View>
          </TouchableWithoutFeedback>
        ) : null}
        
{props.mode === 'paged' && contentSize && metrics && props.pageTurnStyle === 'cover' ? (
          <TouchableWithoutFeedback onPress={handleTap}>
            <View className="flex-1">
              <Animated.FlatList
                ref={coverScrollRef}
                style={{ flex: 1 }}
                data={pages}
                keyExtractor={(item) => String(item.ordinal)}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: coverScrollX } } }],
                  { useNativeDriver: true },
                )}
                renderItem={({ item: page }) => (
                  <Animated.View
                    className={theme.bg}
                    style={[
                      { width: contentSize.w, height: contentSize.h },
                      coverTransforms[page.ordinal],
                    ]}
                  >
                    <Text
                      className={`font-serif ${theme.text}`}
                      style={{ fontSize, lineHeight: fontSize * lineSpacing }}
                    >
                      {props.chapterText.slice(page.startOffset, page.endOffset)}
                    </Text>
                    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
                      {page.ordinal + 1} / {pages.length}
                    </Text>
                  </Animated.View>
                )}
              />
            </View>
          </TouchableWithoutFeedback>
        ) : null}
        
        {props.mode === 'scroll' ? (
          <FlatList
            className="flex-1"
            style={{ paddingHorizontal: marginPx }}
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
                  className={`font-serif ${theme.text} ${
                    isHighlighted ? `rounded-lg ${theme.highlightBg}` : ''
                  }`}
                  style={{ fontSize, lineHeight: fontSize * lineSpacing, paddingVertical: 8 }}
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
