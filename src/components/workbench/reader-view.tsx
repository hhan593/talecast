import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createAudioPlayer } from 'expo-audio';
import { useWindowDimensions } from 'react-native';

import { ReaderSlider } from '@/components/workbench/reader-slider';
import { pageForOffset, paginateText, type ReaderPage } from '@/domain/reader';
import { sliceStyledText } from '@/domain/annotations';
import { READER_THEMES, type ReaderThemeKey } from '@/domain/reader-theme';
import type { Paragraph } from '@/domain/source';

/**
 * 章节工作台的正文视图（docs/plan.md 4.1.6 + manual-reading-plan R2 + reading-experience-plan RE-1）：
 * 双模式——滚动/翻页；主题四套（纸感/护眼/纯白/暖黑）；排版（字号/行距/段距/边距/缩进/对齐）；
 * 悬浮菜单动画显隐（正文全屏分页，显隐不再引起重排）；章节导航（上一章/下一章/拖动条）；
 * 搜索命中高亮；听读跟随；翻页手势点击区（左右翻页，页尾自动接下一章）。
 * 纯展示组件：状态与回调经 props 注入（components 不 import services/adapters）。
 */

export type ReaderMode = 'scroll' | 'paged';
export const FONT_SIZES = { small: 14, standard: 15.5, large: 18, xlarge: 21 } as const;
export type FontSizeKey = keyof typeof FONT_SIZES;
export const LINE_SPACINGS = { compact: 1.5, standard: 1.7, relaxed: 1.9 } as const;
export type LineSpacingKey = keyof typeof LINE_SPACINGS;
export const MARGINS = { narrow: 12, standard: 20, wide: 32 } as const;
export type MarginKey = keyof typeof MARGINS;
/** 段间距（像素）：翻页分页按像素预算预留，滚动模式为段落纵向内边距 */
export const PARAGRAPH_SPACINGS = { compact: 4, standard: 12, relaxed: 20 } as const;
export type ParagraphSpacingKey = keyof typeof PARAGRAPH_SPACINGS;

/** 搜索命中区间（全文绝对偏移，半开区间 [start, end)） */
export interface HighlightRange {
  start: number;
  end: number;
}

/** 轻触感反馈（Web 无震感硬件，静默跳过） */
const hapticLight = (): void => {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
};

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
  paragraphSpacing: ParagraphSpacingKey;
  margin: MarginKey;
  /** 首行缩进（中文两字全角空格，渲染层补齐，分页同步预留） */
  indentEnabled: boolean;
  /** 两端对齐 */
  justifyEnabled: boolean;
  theme: ReaderThemeKey;
  /** 边听边读跟随（paged 模式：播放偏移变化自动翻页） */
  followPlayback: boolean;
  /** 朗读段偏移（播放高亮，段落级） */
  highlightOffset: number | null;
  /** 搜索命中区间（字符级高亮） */
  highlightRange: HighlightRange | null;
  playingThisChapter: boolean;
  playbackStatus: 'idle' | 'playing' | 'paused' | 'done';
  playbackRate: number;
  segmentIndex: number;
  segmentCount: number;
  /** 恢复阅读位置的初始偏移（paged 模式按页首回位） */
  initialOffset: number;
  paragraphs: Paragraph[];
  /** 章节导航（v0.8.0）：当前章索引/总数/拖动跳章 */
  chapterIndex: number;
  chapterCount: number;
  getChapterTitle(index: number): string;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  onPrevChapter(): void;
  onNextChapter(): void;
  onSeekChapter(index: number): void;
  onBack(): void;
  onPlayChapter(): void;
  onPause(): void;
  onResume(): void;
  onCycleRate(): void;
  onCycleFontSize(): void;
  onCycleLineSpacing(): void;
  onCycleParagraphSpacing(): void;
  onCycleMargin(): void;
  onCycleTheme(): void;
  onToggleMode(): void;
  onToggleIndent(): void;
  onToggleJustify(): void;
  onAddBookmark(): void;
  /** 自动滚屏（v0.10.0）：offsetRef 由父级 hook 推进，本组件驱动 FlatList；null=关闭 */
  autoScrollOffsetRef: { current: number } | null;
  autoScrollSpeedLabel: string;
  onCycleAutoScroll(): void;
  /** 播放段级滑条（v0.10.0）：拖动跨段跳转 */
  onSeekSegment(index: number): void;
  /** 滚动模式点击正文：滚屏运行时暂停/恢复（v0.10.0） */
  onScrollTap(): void;
  /** 字体族（v0.11.0）：衬线/黑体/系统 */
  fontFamily: 'serif' | 'sans' | 'system';
  onCycleFontFamily(): void;
  /** 本章剩余时长预估（v0.11.0，父级按阅读/听读口径计算） */
  chapterEta: string | null;
  /** 睡眠定时（v0.11.0）：菜单按钮循环 */
  sleepLabel: string;
  onCycleSleep(): void;
  /** 音量键翻页事件（v0.11.0，父级监听后下发；仅 Android） */
  volumeEvent: { seq: number; direction: 'up' | 'down' } | null;
  /** 翻页音效（v0.11.0） */
  pageSoundEnabled: boolean;
  /** 沉浸全屏（v0.11.0）：菜单隐藏时同步隐藏状态栏 */
  immersive: boolean;
  /** 划线区间（v0.12.0，书级偏移） */
  annotations: Array<{ start: number; end: number }>;
  /**
   * 长按文本块（v0.12.0）：RN Text 无字符级选区回调，采用段落级长按划线。
   * range = 长按内容 的书级偏移；null = 清除操作条。
   */
  longPressRange: { start: number; end: number } | null;
  onLongPressText(range: { start: number; end: number } | null): void;
  /** 长按操作（v0.12.0）：划线/笔记/复制 */
  onAnnotate(kind: 'underline' | 'note' | 'copy'): void;
  /** 滚动模式：可视段落变化（阅读位置持久化，scroll 模式） */
  onViewableItems(info: { viewableItems: Array<{ item?: unknown }> }): void;
  /** 翻页模式：页选择变化（阅读位置持久化，paged 模式） */
  onPageChange(charOffset: number): void;
}

/** 翻页页渲染窗口：PagerView 不虚拟化，只渲染当前页 ±3 页（长章首屏速度） */
const RENDER_WINDOW = 3;

export function ReaderView(props: ReaderViewProps) {
  const fontSize = FONT_SIZES[props.fontSize];
  const lineSpacing = LINE_SPACINGS[props.lineSpacing];
  const marginPx = MARGINS[props.margin];
  const paragraphSpacingPx = PARAGRAPH_SPACINGS[props.paragraphSpacing];
  const theme = READER_THEMES[props.theme];
  const { width: windowW } = useWindowDimensions();
  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null);
  const pagerRef = useRef<PagerView | null>(null);
  const currentPageRef = useRef(0);
  const [activePage, setActivePage] = useState(0);
  // 覆盖动画：滚动偏移驱动每页位移（当前页静止，下一页从右滑入覆盖）
  const coverScrollX = useRef(new Animated.Value(0)).current;
  const coverScrollRef = useRef<FlatList | null>(null);
  const scrollListRef = useRef<FlatList | null>(null);
  const scrollOffsetRef = useRef(0);
  const viewableCbRef = useRef<
    ((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null
  >(null);
  viewableCbRef.current = (info) => props.onViewableItems(info);

  // 自动滚屏驱动（v0.10.0）：hook 每帧推进 offsetRef，本组件按增量滚动 FlatList
  useEffect(() => {
    if (props.mode !== 'scroll' || props.autoScrollOffsetRef === null) return;
    const timer = setInterval(() => {
      const target = props.autoScrollOffsetRef!.current;
      const current = scrollOffsetRef.current;
      if (target > current) {
        const next = Math.max(current + (target - current), current + 1);
        scrollListRef.current?.scrollToOffset({ offset: next, animated: false });
        scrollOffsetRef.current = next;
      }
    }, 32);
    return () => clearInterval(timer);
  }, [props.mode, props.autoScrollOffsetRef]);

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

  // 菜单开合动画（v0.8.0）：渐隐 + 位移；正文全屏悬浮其上，显隐不改变分页
  const menuAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: controlsVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible, menuAnim]);
  const menuPointer = controlsVisible ? ('auto' as const) : ('none' as const);
  const menuTopStyle = {
    opacity: menuAnim,
    transform: [
      {
        translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }),
      },
    ],
  } as const;
  const menuBottomStyle = {
    opacity: menuAnim,
    transform: [
      {
        translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }),
      },
    ],
  } as const;

  // 分页 metrics：CJK 方块字假设；排版（边距/行距/段距/缩进）全部进 metrics（RE-1 §2）
  const metrics = useMemo(() => {
    if (!contentSize) return null;
    const contentW = contentSize.w - marginPx * 2;
    return {
      charsPerLine: Math.max(1, Math.floor(contentW / fontSize)),
      linesPerPage: Math.max(1, Math.floor(contentSize.h / (fontSize * lineSpacing))),
      lineHeightPx: fontSize * lineSpacing,
      paragraphSpacingPx,
      indentChars: props.indentEnabled ? 2 : 0,
    };
  }, [contentSize, fontSize, lineSpacing, marginPx, paragraphSpacingPx, props.indentEnabled]);

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

  const pageWidth = contentSize?.w ?? 0;

  // 字体族（v0.11.0）：CJK 方块字假设下同字号不改变分页 metrics
  const bodyFontClass =
    props.fontFamily === 'sans' ? 'font-sans' : props.fontFamily === 'system' ? '' : 'font-serif';

  // 翻页音效（v0.11.0）：懒加载短音效，翻页时重播
  const pageSoundRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const playPageSound = (): void => {
    if (!props.pageSoundEnabled || Platform.OS === 'web') return;
    try {
      if (!pageSoundRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        pageSoundRef.current = createAudioPlayer(require('../../../assets/sounds/page-turn.wav'));
      }
      const player = pageSoundRef.current;
      player.seekTo(0);
      player.play();
    } catch {
      // 音效失败静默（非核心功能）
    }
  };
  useEffect(() => {
    const player = pageSoundRef.current;
    return () => {
      if (player) player.remove();
    };
  }, []);

  // 音量键翻页（v0.11.0）：父级监听系统音量后下发事件，这里只管翻页
  const volumeSeqRef = useRef(0);
  useEffect(() => {
    const event = props.volumeEvent;
    if (!event || event.seq === volumeSeqRef.current) return;
    volumeSeqRef.current = event.seq;
    if (props.mode !== 'paged') return;
    hapticLight();
    if (event.direction === 'up') {
      if (currentPageRef.current + 1 < pages.length) goToPage(currentPageRef.current + 1);
      else if (props.hasNextChapter) props.onNextChapter();
    } else {
      if (currentPageRef.current > 0) goToPage(currentPageRef.current - 1);
      else if (props.hasPrevChapter) props.onPrevChapter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.volumeEvent?.seq, props.mode, pages.length, props.pageTurnStyle]);

  // 沉浸全屏（v0.11.0）：菜单隐藏时同步隐藏状态栏；卸载恢复
  useEffect(() => {
    StatusBar.setHidden(props.immersive && !controlsVisible, 'fade');
    return () => StatusBar.setHidden(false, 'fade');
  }, [props.immersive, controlsVisible]);

  /** 按页索引跳转（slide → PagerView；cover/curl → 滚动定位） */
  const goToPage = (index: number): void => {
    const clamped = Math.min(Math.max(index, 0), Math.max(pages.length - 1, 0));
    if (clamped !== currentPageRef.current) playPageSound();
    if (props.pageTurnStyle === 'slide') {
      pagerRef.current?.setPage(clamped);
    } else {
      coverScrollRef.current?.scrollToOffset({ offset: clamped * pageWidth, animated: false });
    }
  };

  // 听读跟随：播放偏移推进 → 自动翻到所在页（仅 paged 模式 + 跟随开启）
  useEffect(() => {
    if (props.mode !== 'paged' || !props.followPlayback || pages.length === 0) return;
    if (!props.playingThisChapter || props.highlightOffset === null) return;
    goToPage(pageForOffset(pages, props.highlightOffset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlightOffset, props.mode, pages.length, props.followPlayback, props.playingThisChapter, props.pageTurnStyle]);

  // 位置记忆：进入用恢复偏移；此后记录用户实际所在页首，排版变化后不回跳
  const currentOffsetRef = useRef(props.initialOffset > 0 ? props.initialOffset : props.chapterBaseOffset);
  const chapterBaseRef = useRef(props.chapterBaseOffset);

  // 页定位：章节切换 → 恢复/起始偏移；同章排版变化 → 当前所在页首
  useEffect(() => {
    if (props.mode !== 'paged' || pages.length === 0) return;
    const chapterChanged = chapterBaseRef.current !== props.chapterBaseOffset;
    chapterBaseRef.current = props.chapterBaseOffset;
    const offset = chapterChanged
      ? props.initialOffset > 0
        ? props.initialOffset
        : props.chapterBaseOffset
      : currentOffsetRef.current;
    if (chapterChanged) currentOffsetRef.current = offset;
    goToPage(pageForOffset(pages, offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.chapterBaseOffset, pages.length, props.mode, props.pageTurnStyle]);

  const coverPageFromScroll = (event: unknown): number => {
    const x = (event as { nativeEvent: { contentOffset: { x: number } } }).nativeEvent.contentOffset.x;
    const w = Math.max(pageWidth, 1);
    return Math.round(x / w);
  };

  // 点击分区：左 1/3 上一页（页首接上一章），右 1/3 下一页（页尾接下一章），中 1/3 显隐菜单
  const handleTap = (event: { nativeEvent: { pageX: number } }) => {
    if (props.mode !== 'paged') {
      pokeControls();
      return;
    }
    const x = event.nativeEvent.pageX;
    const zoneW = windowW / 3;
    if (x < zoneW) {
      hapticLight();
      if (currentPageRef.current > 0) goToPage(currentPageRef.current - 1);
      else if (props.hasPrevChapter) props.onPrevChapter();
    } else if (x >= zoneW * 2) {
      hapticLight();
      if (currentPageRef.current + 1 < pages.length) goToPage(currentPageRef.current + 1);
      else if (props.hasNextChapter) props.onNextChapter();
    } else if (controlsVisible) {
      setControlsVisible(false);
    } else {
      pokeControls();
    }
  };

  // 高亮渲染（v0.12.0）：搜索命中 + 划线区间合并切片（字符级，重叠合并）
  const highlightSpans = (text: string, absoluteStart: number): ReactNode => {
    const ranges: Array<{ start: number; end: number }> = [];
    const searchRange = props.highlightRange;
    if (searchRange && searchRange.end > absoluteStart && searchRange.start < absoluteStart + text.length) {
      ranges.push({
        start: Math.max(0, searchRange.start - absoluteStart),
        end: Math.min(text.length, searchRange.end - absoluteStart),
      });
    }
    for (const annotation of props.annotations) {
      if (annotation.end > absoluteStart && annotation.start < absoluteStart + text.length) {
        ranges.push({
          start: Math.max(0, annotation.start - absoluteStart),
          end: Math.min(text.length, annotation.end - absoluteStart),
        });
      }
    }
    if (ranges.length === 0) return text;
    return sliceStyledText(text, ranges).map((slice, index) =>
      slice.highlighted ? (
        <Text key={index} style={{ backgroundColor: theme.highlightBgHex }}>
          {slice.text}
        </Text>
      ) : (
        <Fragment key={index}>{slice.text}</Fragment>
      ),
    );
  };

  interface PageChunk {
    key: string;
    text: string;
    /** 块首在页内文本中的相对偏移 */
    localStart: number;
    /** 段落首块（缩进判据） */
    isStart: boolean;
    /** 页内最后一块（不加段间距，与分页像素预算一致） */
    isLast: boolean;
  }

  /** 页 → 段落块：页区间与段落区间求交（页可从段落中部开始） */
  const chunksForPage = (page: ReaderPage): PageChunk[] => {
    const chunks: PageChunk[] = [];
    for (const para of props.paragraphs) {
      const s = Math.max(para.startOffset, page.startOffset);
      const e = Math.min(para.endOffset, page.endOffset);
      if (s >= e) continue;
      chunks.push({
        key: `${para.startOffset}-${s}`,
        text: props.chapterText.slice(s - page.startOffset, e - page.startOffset),
        localStart: s - page.startOffset,
        isStart: s === para.startOffset,
        isLast: false,
      });
    }
    if (chunks.length > 0) chunks[chunks.length - 1].isLast = true;
    return chunks;
  };

  const renderChunk = (chunk: PageChunk, page: ReaderPage): ReactNode => {
    const indentPrefix = chunk.isStart && props.indentEnabled ? '\u3000\u3000' : '';
    const chunkAbsoluteStart = page.startOffset + chunk.localStart;
    return (
      <Pressable
        key={chunk.key}
        onLongPress={() => {
          hapticLight();
          props.onLongPressText({ start: chunkAbsoluteStart, end: chunkAbsoluteStart + chunk.text.length });
        }}
        delayLongPress={350}
      >
        <Text
          className={`${bodyFontClass} ${theme.text}`}
          style={{
            fontSize,
            lineHeight: fontSize * lineSpacing,
            textAlign: props.justifyEnabled ? 'justify' : 'left',
            marginBottom: chunk.isLast ? 0 : paragraphSpacingPx,
          }}
        >
          {indentPrefix}
          {highlightSpans(chunk.text, chunkAbsoluteStart)}
        </Text>
      </Pressable>
    );
  };

  // 章节拖动预览（拖动中显示目标章名，松手跳章）
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const percent =
    props.chapterCount > 0 ? Math.round(((props.chapterIndex + 1) / props.chapterCount) * 100) : 0;
  const progressLabel =
    seekPreview !== null
      ? `${seekPreview + 1}/${props.chapterCount} · ${props.getChapterTitle(seekPreview)}`
      : `${props.chapterIndex + 1}/${props.chapterCount} · ${percent}%`;

  const playingHere = props.playingThisChapter && props.playbackStatus === 'playing';
  const pausedHere = props.playingThisChapter && props.playbackStatus === 'paused';

  const pageNumRow = (page: ReaderPage) => (
    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
      {page.ordinal + 1} / {pages.length}
    </Text>
  );

  return (
    <View className={`flex-1 ${theme.bg}`}>
      {/* 正文全屏区：菜单悬浮其上，显隐不再引起正文重排（v0.8.0） */}
      <View
        className="flex-1 pt-14"
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
              <PagerView
                ref={pagerRef}
                style={{ flex: 1 }}
                initialPage={0}
                overdrag={false}
                onPageSelected={(e) => {
                  currentPageRef.current = e.nativeEvent.position;
                  setActivePage(e.nativeEvent.position);
                  const page = pages[e.nativeEvent.position];
                  if (page) {
                    currentOffsetRef.current = page.startOffset;
                    props.onPageChange(page.startOffset);
                  }
                }}
              >
                {pages.map((page) =>
                  Math.abs(page.ordinal - activePage) <= RENDER_WINDOW ? (
                    <View key={page.ordinal} className="flex-1">
                      {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                      {pageNumRow(page)}
                    </View>
                  ) : (
                    <View key={page.ordinal} className="flex-1" />
                  ),
                )}
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
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={5}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: coverScrollX } } }],
                  {
                    useNativeDriver: true,
                    listener: (event) => {
                      const idx = coverPageFromScroll(event);
                      currentPageRef.current = idx;
                      const page = pages[idx];
                      if (page) currentOffsetRef.current = page.startOffset;
                    },
                  },
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
                    {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                    {pageNumRow(page)}
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
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={5}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: coverScrollX } } }],
                  {
                    useNativeDriver: true,
                    listener: (event) => {
                      const idx = coverPageFromScroll(event);
                      currentPageRef.current = idx;
                      const page = pages[idx];
                      if (page) currentOffsetRef.current = page.startOffset;
                    },
                  },
                )}
                renderItem={({ item: page }) => (
                  <Animated.View
                    className={theme.bg}
                    style={[
                      { width: contentSize.w, height: contentSize.h },
                      coverTransforms[page.ordinal],
                    ]}
                  >
                    {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                    {pageNumRow(page)}
                  </Animated.View>
                )}
              />
            </View>
          </TouchableWithoutFeedback>
        ) : null}
        {props.mode === 'scroll' ? (
          <TouchableWithoutFeedback
            onPress={() => {
              pokeControls();
              props.onScrollTap();
            }}
          >
            <FlatList
              ref={scrollListRef}
              className="flex-1"
              style={{ paddingHorizontal: marginPx }}
              onScroll={(event) => {
                scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
              }}
              scrollEventThrottle={32}
              data={props.paragraphs}
              keyExtractor={(item, index) => `${item.startOffset}-${index}`}
              onViewableItemsChanged={(info) => viewableCbRef.current?.(info)}
              renderItem={({ item }) => {
                const isHighlighted =
                  props.highlightOffset !== null &&
                  item.startOffset <= props.highlightOffset &&
                  props.highlightOffset < item.endOffset;
                return (
                  <Pressable
                    onLongPress={() => {
                      hapticLight();
                      props.onLongPressText({
                        start: item.startOffset,
                        end: item.startOffset + item.text.length,
                      });
                    }}
                    delayLongPress={350}
                  >
                    <Text
                      className={`${bodyFontClass} ${theme.text} ${
                        isHighlighted ? `rounded-lg ${theme.highlightBg}` : ''
                      }`}
                      style={{
                        fontSize,
                        lineHeight: fontSize * lineSpacing,
                        paddingVertical: paragraphSpacingPx / 2,
                        textAlign: props.justifyEnabled ? 'justify' : 'left',
                      }}
                    >
                      {props.indentEnabled ? '\u3000\u3000' : ''}
                      {highlightSpans(item.text, item.startOffset)}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </TouchableWithoutFeedback>
        ) : null}
      </View>

      {/* 长按操作条（v0.12.0）：长按文本块后悬浮显示 */}
      {props.longPressRange ? (
        <View
          pointerEvents="auto"
          className={`absolute inset-x-0 bottom-28 mx-4 flex-row items-center gap-2 rounded-xl border p-2 ${theme.surface} ${theme.border}`}
        >
          <Text className={`flex-1 text-center text-[10px] ${theme.muted}`} numberOfLines={1}>
            已选中 {props.longPressRange.end - props.longPressRange.start} 字
          </Text>
          {([
            ['underline', '划线'],
            ['note', '笔记'],
            ['copy', '复制'],
          ] as const).map(([kind, label]) => (
            <Pressable
              key={kind}
              accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => props.onAnnotate(kind)}
            >
              <Text className={`text-xs ${theme.text}`}>{label}</Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
            onPress={() => props.onLongPressText(null)}
          >
            <Text className={`text-xs ${theme.muted}`}>取消</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 顶部悬浮菜单：导航 + 播放 + 排版（动画显隐） */}
      <Animated.View
        pointerEvents={menuPointer}
        className={`absolute inset-x-0 top-0 rounded-b-2xl border-b ${theme.surface} ${theme.border}`}
        style={menuTopStyle}
      >
        <View className="px-4 pb-3 pt-14">
          <View className="flex-row items-center justify-between">
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-3 py-1.5`}
              onPress={() => {
                hapticLight();
                props.onBack();
              }}
            >
              <Text className={`text-sm ${theme.text}`}>返回目录</Text>
            </Pressable>
            <Text
              className={`${bodyFontClass} mx-3 flex-1 text-center text-sm font-semibold ${theme.text}`}
              numberOfLines={1}
            >
              {props.chapterTitle}
            </Text>
            <View className="w-16" />
          </View>
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            {playingHere ? (
              <Pressable accessibilityRole="button"
                className={`rounded-lg ${theme.bg} px-3 py-1.5`}
                onPress={() => {
                  pokeControls();
                  props.onPause();
                }}
              >
                <Text className={`text-xs ${theme.text}`}>暂停</Text>
              </Pressable>
            ) : pausedHere ? (
              <Pressable accessibilityRole="button"
                className={`rounded-lg ${theme.bg} px-3 py-1.5`}
                onPress={() => {
                  pokeControls();
                  props.onResume();
                }}
              >
                <Text className={`text-xs ${theme.text}`}>继续</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button"
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
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleRate();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>{props.playbackRate}×</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                hapticLight();
                props.onCycleSleep();
              }}
            >
              <Text className={`text-xs ${props.sleepLabel !== '定时关' ? theme.accent : theme.text}`}>
                {props.sleepLabel}
              </Text>
            </Pressable>
          </View>
          <View className="mt-2 flex-row flex-wrap items-center gap-2">
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
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
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleLineSpacing();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>行距</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleParagraphSpacing();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>
                段
                {props.paragraphSpacing === 'compact'
                  ? '紧'
                  : props.paragraphSpacing === 'standard'
                    ? '中'
                    : '松'}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleFontFamily();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>
                {props.fontFamily === 'serif' ? '宋' : props.fontFamily === 'sans' ? '黑' : '系'}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleMargin();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>边距</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onToggleIndent();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>缩进{props.indentEnabled ? '开' : '关'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onToggleJustify();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>两端{props.justifyEnabled ? '开' : '关'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCycleTheme();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>主题</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onCyclePageTurnStyle();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>
                翻
                {props.pageTurnStyle === 'slide' ? '滑' : props.pageTurnStyle === 'cover' ? '覆' : '卷'}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onToggleMode();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>
                {props.mode === 'paged' ? '滚动' : '翻页'}
              </Text>
            </Pressable>
            {props.mode === 'scroll' ? (
              <Pressable accessibilityRole="button"
                className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
                onPress={() => {
                  hapticLight();
                  props.onCycleAutoScroll();
                }}
              >
                <Text className={`text-xs ${theme.text}`}>滚屏{props.autoScrollSpeedLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
              onPress={() => {
                pokeControls();
                props.onAddBookmark();
              }}
            >
              <Text className={`text-xs ${theme.text}`}>书签</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {/* 底部悬浮菜单：上一章 / 章节拖动条 / 下一章（v0.8.0） */}
      <Animated.View
        pointerEvents={menuPointer}
        className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t ${theme.surface} ${theme.border}`}
        style={menuBottomStyle}
      >
        <View className="flex-row items-center gap-3 px-4 pb-4 pt-2">
          <Pressable accessibilityRole="button"
            className={`rounded-lg ${theme.bg} px-2 py-1.5`}
            disabled={!props.hasPrevChapter}
            style={!props.hasPrevChapter ? styles.navDisabled : null}
            onPress={() => {
              hapticLight();
              props.onPrevChapter();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>上一章</Text>
          </Pressable>
          <ReaderSlider
            value={props.chapterIndex}
            max={Math.max(props.chapterCount - 1, 0)}
            trackColor={theme.textHex}
            fillColor={theme.textHex}
            thumbColor={theme.actionHex}
            onPreview={(index) => {
              pokeControls();
              setSeekPreview(index);
            }}
            onCommit={(index) => {
              setSeekPreview(null);
              if (index !== props.chapterIndex) {
                hapticLight();
                props.onSeekChapter(index);
              }
            }}
          />
          <Pressable accessibilityRole="button"
            className={`rounded-lg ${theme.bg} px-2 py-1.5`}
            disabled={!props.hasNextChapter}
            style={!props.hasNextChapter ? styles.navDisabled : null}
            onPress={() => {
              hapticLight();
              props.onNextChapter();
            }}
          >
            <Text className={`text-xs ${theme.text}`}>下一章</Text>
          </Pressable>
        </View>
        {props.playingThisChapter && props.segmentCount > 0 ? (
          <View className="flex-row items-center gap-3 px-4 pb-1">
            <Text className={`text-[10px] ${theme.muted}`}>播放</Text>
            <ReaderSlider
              value={props.segmentIndex}
              max={Math.max(props.segmentCount - 1, 0)}
              trackColor={theme.textHex}
              fillColor={theme.textHex}
              thumbColor={theme.actionHex}
              onPreview={() => pokeControls()}
              onCommit={(index) => {
                if (index !== props.segmentIndex) {
                  hapticLight();
                  props.onSeekSegment(index);
                }
              }}
            />
            <Text className={`text-[10px] ${theme.muted}`}>
              {props.segmentIndex + 1}/{props.segmentCount} 段
            </Text>
          </View>
        ) : null}
        <Text className={`pb-2 text-center text-[10px] ${theme.muted}`} numberOfLines={1}>
          {props.chapterEta ? `${progressLabel} · ${props.chapterEta}` : progressLabel}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  navDisabled: {
    opacity: 0.4,
  },
});
