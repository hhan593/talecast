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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { ReaderSlider } from '@/components/workbench/reader-slider';
import { pageForOffset, paginateText, type ReaderPage } from '@/domain/reader';
import { sliceStyledText } from '@/domain/annotations';
import { READER_THEMES, type ReaderThemeKey } from '@/domain/reader-theme';
import type { Paragraph } from '@/domain/source';
import { useI18n } from '@/hooks/use-i18n';

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
  /** 翻页音效播放回调（v0.15.0，hooks 注入——组件不直连 expo-audio） */
  playPageSound(): void;
  /** 沉浸全屏（v0.11.0）：菜单隐藏时同步隐藏状态栏 */
  immersive: boolean;
  /** 划线区间（v0.12.0，书级偏移） */
  annotations: Array<{ start: number; end: number }>;
  /** 词级卡拉OK当前词（v0.13.0，书级偏移；null=关闭） */
  wordHighlight: { start: number; end: number } | null;
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
  // t 绑定 React state，避免模块级 locale 与界面语言不同步
  const { t } = useI18n();
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

  // 设置面板（UI 重构）：目录/进度/排版/听书四 tab；面板展开时暂停自动隐藏
  type PanelTab = 'none' | 'catalog' | 'progress' | 'typeset' | 'listen';
  const [panelTab, setPanelTab] = useState<PanelTab>('none');

  // 安全区（v0.18.1）：顶部工具条需让开状态栏，底部进度行需让开手势条，
  // 否则状态栏图标被工具条底色盖成白底白字、进度文字被 Home 指示条切断
  const insets = useSafeAreaInsets();
  // 顶部工具条实测高度：正文内边距跟随它，保证工具条可见时首行不被遮住
  const [topBarHeight, setTopBarHeight] = useState(56);

  // 沉浸模式：工具栏 3 秒无操作自动隐藏，任意点击重置（RE-1）
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleHide = () => {
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (panelTab === 'none') {
      controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  };
  const pokeControls = () => {
    setControlsVisible(true);
    scheduleHide();
  };
  const togglePanel = (tab: PanelTab) => {
    const next: PanelTab = panelTab === tab ? 'none' : tab;
    setPanelTab(next);
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    if (next === 'none') controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
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

  // 翻页音效（v0.15.0）：播放回调经 hooks 注入（issue #38：组件不直连 expo-audio）

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
  // 状态栏图标明暗跟随阅读主题（v0.18.1）：纸感/护眼/纯白是浅底，必须是深色图标，
  // 否则系统按应用级深色主题给白图标，压在浅底工具条上几乎看不见
  useEffect(() => {
    const night = props.theme === 'night';
    StatusBar.setHidden(props.immersive && !controlsVisible, 'fade');
    StatusBar.setBarStyle(night ? 'light-content' : 'dark-content', true);
    return () => {
      StatusBar.setHidden(false, 'fade');
      StatusBar.setBarStyle('default', true);
    };
  }, [props.immersive, controlsVisible, props.theme]);

  /** 按页索引跳转（slide → PagerView；cover/curl → 滚动定位） */
  const goToPage = (index: number): void => {
    const clamped = Math.min(Math.max(index, 0), Math.max(pages.length - 1, 0));
    if (clamped !== currentPageRef.current) props.playPageSound();
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

  /**
   * 正文文本块的点击（v0.18.1）：文本块本身是 Pressable（长按划线需要），
   * 它会吃掉触摸、外层 TouchableWithoutFeedback 收不到 onPress，
   * 结果就是"点正文没反应、只能点 Aa"。这里把同一次点击转交给分区逻辑。
   */
  const handleTextTap = (event: { nativeEvent: { pageX: number } }) => {
    if (props.mode === 'scroll') {
      pokeControls();
      props.onScrollTap();
      return;
    }
    handleTap(event);
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
    const word = props.wordHighlight;
    if (word && word.end > absoluteStart && word.start < absoluteStart + text.length) {
      ranges.push({
        start: Math.max(0, word.start - absoluteStart),
        end: Math.min(text.length, word.end - absoluteStart),
      });
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
        onPress={handleTextTap}
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

  /** 设置面板的一行：显示档位选项，当前值高亮；点击调现有 cycle 回调（行为不变，仅为可视化） */
  const renderTypeRow = <K extends string>(
    label: string,
    current: K,
    options: Record<K, string>,
    onCycle: () => void,
  ) => (
    <View className="mb-2 flex-row items-center justify-between">
      <Text className={`w-16 text-xs ${theme.muted}`}>{label}</Text>
      <View className="flex-row flex-wrap justify-end gap-1.5">
        {(Object.keys(options) as K[]).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            className={`rounded-lg px-2.5 py-1 ${current === key ? theme.action : theme.bg}`}
            onPress={() => { pokeControls(); onCycle(); }}
          >
            <Text className={`text-xs ${current === key ? theme.actionText : theme.text}`}>{options[key]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const pageNumRow = (page: ReaderPage) => (
    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
      {page.ordinal + 1} / {pages.length}
    </Text>
  );

  return (
    <View className={`flex-1 ${theme.bg}`}>
      {/* 正文全屏区：菜单悬浮其上，显隐不再引起正文重排（v0.8.0） */}
      <View
        className="flex-1"
        style={{ paddingTop: topBarHeight }}
        onLayout={(e) => {
          // layout.height 是含内边距的外框高度；分页只能用真正的正文高度，
          // 否则每页会多算 topBarHeight 对应的行数，页末行被裁掉
          setContentSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height - topBarHeight,
          });
        }}
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
              // 底部工具条悬浮在正文上：留出尾部空白，避免末行被工具条永久遮住
              contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
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
                    onPress={handleTextTap}
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
            {t('reader.selectedChars', { count: props.longPressRange.end - props.longPressRange.start })}
          </Text>
          {([
            ['underline', t('reader.underline')],
            ['note', t('reader.note')],
            ['copy', t('reader.copy')],
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
            <Text className={`text-xs ${theme.muted}`}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* 顶部悬浮菜单（UI 重构）：只保留导航 / 章节名 / 书签 / Aa 入口；排版项收进底部面板 */}
      <Animated.View
        pointerEvents={menuPointer}
        onLayout={(e) => setTopBarHeight(e.nativeEvent.layout.height)}
        className={`absolute inset-x-0 top-0 rounded-b-2xl border-b ${theme.surface} ${theme.border}`}
        style={menuTopStyle}
      >
        <View className="px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
          <View className="flex-row items-center justify-between">
            <Pressable accessibilityRole="button"
              className={`rounded-lg ${theme.bg} px-3 py-1.5`}
              onPress={() => {
                hapticLight();
                props.onBack();
              }}
            >
              <Text className={`text-sm ${theme.text}`}>{t('reader.backToCatalog')}</Text>
            </Pressable>
            <Text
              className={`${bodyFontClass} mx-3 flex-1 text-center text-sm font-semibold ${theme.text}`}
              numberOfLines={1}
            >
              {props.chapterTitle}
            </Text>
            <View className="flex-row items-center gap-2">
              <Pressable accessibilityRole="button"
                className={`rounded-lg ${theme.bg} px-2.5 py-1.5`}
                onPress={() => {
                  pokeControls();
                  props.onAddBookmark();
                }}
              >
                <Text className={`text-xs ${theme.text}`}>{t('reader.bookmark')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                accessibilityLabel={t('reader.typeset')}
                className={`rounded-lg ${panelTab === 'typeset' ? theme.action : theme.bg} px-2.5 py-1.5`}
                onPress={() => {
                  hapticLight();
                  togglePanel('typeset');
                }}
              >
                <Text className={`text-xs font-semibold ${panelTab === 'typeset' ? theme.actionText : theme.text}`}>Aa</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* 底部悬浮菜单（UI 重构）：四 tab 设置面板 + 章节导航 */}
      <Animated.View
        pointerEvents={menuPointer}
        className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t ${theme.surface} ${theme.border}`}
        style={[menuBottomStyle, { paddingBottom: insets.bottom }]}
      >
        {panelTab !== 'none' ? (
          <View className={`border-b px-4 pb-3 pt-3 ${theme.border}`}>
            <View className="mb-3 flex-row items-center gap-2">
              {([
                ['catalog', 'reader.panelCatalog'],
                ['progress', 'reader.panelProgress'],
                ['typeset', 'reader.panelTypeset'],
                ['listen', 'reader.panelListen'],
              ] as const).map(([key, labelKey]) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  className={`rounded-full px-3 py-1.5 ${panelTab === key ? theme.action : theme.bg}`}
                  onPress={() => {
                    hapticLight();
                    setPanelTab(key);
                  }}
                >
                  <Text className={`text-xs ${panelTab === key ? theme.actionText : theme.text}`}>{t(labelKey)}</Text>
                </Pressable>
              ))}
            </View>

            {panelTab === 'typeset' ? (
              <View>
                <View className="mb-2 flex-row items-center justify-between">
                  <Text className={`text-xs ${theme.muted}`}>{t('reader.fontSize', { size: '' })}</Text>
                  <View className="flex-row items-center gap-3">
                    <Pressable accessibilityRole="button" onPress={() => { pokeControls(); props.onCycleFontSize(); }}>
                      <Text className={`text-lg ${theme.text}`}>−</Text>
                    </Pressable>
                    <Text className={`w-10 text-center text-sm font-semibold ${theme.text}`}>{Math.round(fontSize)}</Text>
                    <Pressable accessibilityRole="button" onPress={() => { pokeControls(); props.onCycleFontSize(); }}>
                      <Text className={`text-lg ${theme.text}`}>＋</Text>
                    </Pressable>
                  </View>
                </View>
                {renderTypeRow(t('reader.lineHeight'), props.lineSpacing, {
                  compact: t('reader.tight'), standard: t('reader.medium'), relaxed: t('reader.loose'),
                }, props.onCycleLineSpacing)}
                {renderTypeRow(t('reader.paragraphSpacing', { value: '' }).trim(), props.paragraphSpacing, {
                  compact: t('reader.tight'), standard: t('reader.medium'), relaxed: t('reader.loose'),
                }, props.onCycleParagraphSpacing)}
                {renderTypeRow(t('reader.theme'), props.theme, {
                  paper: t('reader.themePaper'), green: t('reader.themeGreen'),
                  white: t('reader.themeWhite'), night: t('reader.themeNight'),
                }, props.onCycleTheme)}
                {renderTypeRow(t('reader.fontFamilyLabel'), props.fontFamily, {
                  serif: t('reader.fontSerif'), sans: t('reader.fontSans'), system: t('reader.fontSystem'),
                }, props.onCycleFontFamily)}
                <View className="mt-2 flex-row flex-wrap gap-2">
                  <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${props.indentEnabled ? theme.action : theme.bg}`} onPress={() => { pokeControls(); props.onToggleIndent(); }}>
                    <Text className={`text-xs ${props.indentEnabled ? theme.actionText : theme.text}`}>{t('reader.indent')} {props.indentEnabled ? t('common.on') : t('common.off')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${props.justifyEnabled ? theme.action : theme.bg}`} onPress={() => { pokeControls(); props.onToggleJustify(); }}>
                    <Text className={`text-xs ${props.justifyEnabled ? theme.actionText : theme.text}`}>{t('reader.justify')} {props.justifyEnabled ? t('common.on') : t('common.off')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${theme.bg}`} onPress={() => { pokeControls(); props.onCycleMargin(); }}>
                    <Text className={`text-xs ${theme.text}`}>{t('reader.margin')} · {props.margin === 'narrow' ? t('reader.tight') : props.margin === 'wide' ? t('reader.loose') : t('reader.medium')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${theme.bg}`} onPress={() => { pokeControls(); props.onToggleMode(); }}>
                    <Text className={`text-xs ${theme.text}`}>{props.mode === 'paged' ? t('reader.modePaged') : t('reader.modeScroll')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${theme.bg}`} onPress={() => { pokeControls(); props.onCyclePageTurnStyle(); }}>
                    <Text className={`text-xs ${theme.text}`}>{t('reader.pageTurn', { value: props.pageTurnStyle === 'slide' ? t('reader.turnSlide') : props.pageTurnStyle === 'cover' ? t('reader.turnCover') : t('reader.turnCurl') })}</Text>
                  </Pressable>
                  {props.mode === 'scroll' ? (
                    <Pressable accessibilityRole="button" className={`rounded-lg px-3 py-2 ${theme.bg}`} onPress={() => { hapticLight(); props.onCycleAutoScroll(); }}>
                      <Text className={`text-xs ${theme.text}`}>{t('reader.autoScroll', { value: props.autoScrollSpeedLabel })}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {panelTab === 'listen' ? (
              <View>
                <View className="flex-row items-center gap-3">
                  {playingHere ? (
                    <Pressable accessibilityRole="button" className={`rounded-lg ${theme.action} px-4 py-2`} onPress={() => { pokeControls(); props.onPause(); }}>
                      <Text className={`text-xs font-semibold ${theme.actionText}`}>{t('reader.pause')}</Text>
                    </Pressable>
                  ) : pausedHere ? (
                    <Pressable accessibilityRole="button" className={`rounded-lg ${theme.action} px-4 py-2`} onPress={() => { pokeControls(); props.onResume(); }}>
                      <Text className={`text-xs font-semibold ${theme.actionText}`}>{t('reader.resume')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable accessibilityRole="button" className={`rounded-lg ${theme.action} px-4 py-2`} onPress={() => { pokeControls(); props.onPlayChapter(); }}>
                      <Text className={`text-xs font-semibold ${theme.actionText}`}>{t('reader.playChapter')}</Text>
                    </Pressable>
                  )}
                  <Pressable accessibilityRole="button" className={`rounded-lg ${theme.bg} px-3 py-2`} onPress={() => { pokeControls(); props.onCycleRate(); }}>
                    <Text className={`text-xs ${theme.text}`}>{props.playbackRate}×</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`rounded-lg ${theme.bg} px-3 py-2`} onPress={() => { hapticLight(); props.onCycleSleep(); }}>
                    <Text className={`text-xs ${props.sleepLabel !== t('reader.sleepOff') ? theme.accent : theme.text}`}>{props.sleepLabel}</Text>
                  </Pressable>
                </View>
                <Text className={`mt-3 text-xs ${theme.muted}`}>
                  {props.playingThisChapter && props.segmentCount > 0
                    ? t('reader.segmentOf', { index: props.segmentIndex + 1, total: props.segmentCount })
                    : t('reader.segmentHint')}
                </Text>
              </View>
            ) : null}

            {panelTab === 'catalog' ? (
              <FlatList
                data={Array.from({ length: props.chapterCount }, (_, i) => i)}
                keyExtractor={(i) => String(i)}
                style={{ maxHeight: 220 }}
                renderItem={({ item: i }) => (
                  <Pressable
                    accessibilityRole="button"
                    className={`flex-row items-center rounded-lg px-3 py-2 ${i === props.chapterIndex ? theme.action : ''}`}
                    onPress={() => {
                      hapticLight();
                      props.onSeekChapter(i);
                      setPanelTab('none');
                    }}
                  >
                    <Text className={`mr-3 text-xs ${i === props.chapterIndex ? theme.actionText : theme.muted}`}>{i + 1}</Text>
                    <Text className={`flex-1 text-xs ${i === props.chapterIndex ? theme.actionText : theme.text}`} numberOfLines={1}>{props.getChapterTitle(i)}</Text>
                  </Pressable>
                )}
              />
            ) : null}

            {panelTab === 'progress' ? (
              <View>
                <Text className={`mb-3 text-sm ${theme.text}`}>{progressLabel}</Text>
                <View className="gap-2">
                  <Pressable accessibilityRole="button" className={`flex-row items-center justify-between rounded-lg ${theme.bg} px-3 py-2`} disabled={!props.hasPrevChapter} style={!props.hasPrevChapter ? styles.navDisabled : null} onPress={() => { hapticLight(); props.onPrevChapter(); setPanelTab('none'); }}>
                    <Text className={`text-xs ${theme.text}`}>{t('reader.prevChapter')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" className={`flex-row items-center justify-between rounded-lg ${theme.bg} px-3 py-2`} disabled={!props.hasNextChapter} style={!props.hasNextChapter ? styles.navDisabled : null} onPress={() => { hapticLight(); props.onNextChapter(); setPanelTab('none'); }}>
                    <Text className={`text-xs ${theme.text}`}>{t('reader.nextChapter')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

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
            <Text className={`text-xs ${theme.text}`}>{t('reader.prevChapter')}</Text>
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
            <Text className={`text-xs ${theme.text}`}>{t('reader.nextChapter')}</Text>
          </Pressable>
        </View>
        {props.playingThisChapter && props.segmentCount > 0 ? (
          <View className="flex-row items-center gap-3 px-4 pb-1">
            <Text className={`text-[10px] ${theme.muted}`}>{t('reader.play')}</Text>
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
              {t('reader.segmentBadge', { index: props.segmentIndex + 1, total: props.segmentCount })}
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
