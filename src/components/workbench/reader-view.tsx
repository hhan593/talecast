import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReaderSlider } from '@/components/workbench/reader-slider';
import { AUTO_SCROLL_TICK_MS } from '@/hooks/use-auto-scroll';
import {
  pageForOffset,
  paginateText,
  paragraphIndexAtScrollY,
  paragraphIndexForOffset,
  type PageTurnStyle,
  type ReaderPage,
} from '@/domain/reader';

import { sliceStyledText } from '@/domain/annotations';
import { READER_THEMES, THEME_CYCLE, type ReaderThemeKey } from '@/domain/reader-theme';
import type { Paragraph } from '@/domain/source';
import { useI18n } from '@/hooks/use-i18n';
import type { StringKey } from '@/i18n';

/**
 * 章节工作台的正文视图（docs/plan.md 4.1.6 + manual-reading-plan R2 + reading-experience-plan RE-1）。
 *
 * v0.19.0 面板重构（issue #64）：从「工具条悬浮 + 正文避让」改为三段式
 * 　顶部单行工具条／正文／底部翻页行 + 四入口，设置面板从底部升起，
 * 听书改右侧悬浮球，不占排版空间。
 *
 * v0.20.1 交互重做（issue #90，v0.20.0 实机反馈）：顶栏/底栏改回悬浮层
 * （显隐不改变正文高度，翻页不重排），点屏唤出、3 秒无操作自动收起；
 * 面板打开期间点正文任意处 = 关面板收工具条，不翻页；顶栏 ··· 改开
 * 更多菜单抽屉（角色中心/书籍助手/听书），设置面板入口保留在底栏「设置」。
 *
 * 滚动模式收尾（issue #64）：正文 FlatList → ScrollView + flexGrow 尾部占位，
 * 短章的尾部空白整块可点（此前超 320dp 点不到）；位置持久化从 FlatList 可视区
 * 回调改为「每段实测 y + scrollY 互查」（domain/reader.ts 纯函数），并补上
 * 滚动模式从未有过的段级位置恢复（initialOffset 此前只有翻页模式消费）。
 *
 * 仍然保留的能力：双模式（滚动/翻页）、四套主题、排版（字号/行距/段距/边距/缩进/对齐/
 * 字体族）、翻页动画（平移/覆盖/仿真/瞬切）、搜索命中与划线高亮、听读跟随、
 * 点击分区翻页、页尾自动接下一章、自动滚屏、音量键翻页。
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
export type FontFamilyKey = 'serif' | 'sans' | 'system';

/** 搜索命中区间（全文绝对偏移，半开区间 [start, end)） */
export interface HighlightRange {
  start: number;
  end: number;
}

/** 书签（v0.19.0）：阅读器只做展示与回调，数据由父级 hooks 提供 */
export interface ReaderBookmark {
  id: string;
  chapterId: string;
  charOffset: number;
  excerpt: string;
  chapterTitle: string;
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
  /** 翻页样式：平移 / 覆盖 / 仿真 / 瞬切 */
  pageTurnStyle: PageTurnStyle;
  lineSpacing: LineSpacingKey;
  paragraphSpacing: ParagraphSpacingKey;
  margin: MarginKey;
  /** 首行缩进（中文两字全角空格，渲染层补齐，分页同步预留） */
  indentEnabled: boolean;
  /** 两端对齐 */
  justifyEnabled: boolean;
  theme: ReaderThemeKey;
  /** 阅读亮度（0.35–1，渲染为黑色遮罩；不申请系统亮度权限） */
  brightness: number;
  /** 护眼（琥珀色低透明度遮罩，独立于主题） */
  eyeCare: boolean;
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
  /** 章节导航：当前章索引/总数/拖动跳章 */
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
  /** 排版：直接选中（v0.19.0 取代原来的「循环到下一个」——点哪个就是哪个） */
  onSelectFontSize(key: FontSizeKey): void;
  onSelectLineSpacing(key: LineSpacingKey): void;
  onSelectParagraphSpacing(key: ParagraphSpacingKey): void;
  onSelectMargin(key: MarginKey): void;
  onSelectFontFamily(key: FontFamilyKey): void;
  onSelectTheme(key: ReaderThemeKey): void;
  onSelectPageTurnStyle(style: PageTurnStyle): void;
  onBrightnessChange(value: number): void;
  onToggleEyeCare(): void;
  onToggleMode(): void;
  onToggleIndent(): void;
  onToggleJustify(): void;
  onAddBookmark(): void;
  /** 书签列表（v0.19.0）：底栏「书签」入口升起面板 */
  bookmarks: ReaderBookmark[];
  onOpenBookmark(bookmark: ReaderBookmark): void;
  onDeleteBookmark(bookmarkId: string): void;
  /** 自动滚屏每 tick 步长（像素，>0 = 开启；issue #78 重构：相对步进防基准脱节） */
  autoScrollStep: number;
  autoScrollSpeedLabel: string;
  onCycleAutoScroll(): void;
  /** 播放段级滑条：拖动跨段跳转 */
  onSeekSegment(index: number): void;
  /** 滚动模式点击正文：滚屏运行时暂停/恢复 */
  onScrollTap(): void;
  /** 字体族：衬线/黑体/系统 */
  fontFamily: FontFamilyKey;
  /** 本章剩余时长预估（父级按阅读/听读口径计算） */
  chapterEta: string | null;
  /** 睡眠定时：菜单按钮循环 */
  sleepLabel: string;
  onCycleSleep(): void;
  /** 音量键翻页事件（父级监听后下发；仅 Android） */
  volumeEvent: { seq: number; direction: 'up' | 'down' } | null;
  /** 翻页音效 */
  pageSoundEnabled: boolean;
  /** 翻页音效播放回调（hooks 注入——组件不直连 expo-audio） */
  playPageSound(): void;
  /** 沉浸全屏：滚动模式下工具条 3 秒无操作自动收起 */
  immersive: boolean;
  /** 划线区间（书级偏移） */
  annotations: Array<{ start: number; end: number }>;
  /** 词级卡拉OK当前词（书级偏移；null=关闭） */
  wordHighlight: { start: number; end: number } | null;
  /**
   * 长按文本块：RN Text 无字符级选区回调，采用段落级长按划线。
   * range = 长按内容 的书级偏移；null = 清除操作条。
   */
  longPressRange: { start: number; end: number } | null;
  onLongPressText(range: { start: number; end: number } | null): void;
  /** 长按操作：划线/笔记/复制 */
  onAnnotate(kind: 'underline' | 'note' | 'copy'): void;
  /** 滚动模式：顶边所在段变化（阅读位置持久化；ScrollView 按 scrollY 互查） */
  onVisibleCharOffset(charOffset: number): void;
  /** 翻页模式：页选择变化（阅读位置持久化） */
  onPageChange(charOffset: number): void;
  /** 顶栏 ···：打开更多菜单抽屉（角色中心/书籍助手/听书，issue #90） */
  onOpenDrawer(): void;
  /** 底栏「目录」：打开左侧章节抽屉（issue #94，不再用底部面板） */
  onOpenCatalog(): void;
}

/** 翻页页渲染窗口：PagerView 不虚拟化，只渲染当前页 ±3 页（长章首屏速度） */
const RENDER_WINDOW = 3;
/** 亮度滑杆的下限：再暗也不至于看不见字 */
const MIN_BRIGHTNESS = 0.35;

const FONT_SIZE_KEYS: FontSizeKey[] = ['small', 'standard', 'large', 'xlarge'];
const LINE_SPACING_KEYS: LineSpacingKey[] = ['compact', 'standard', 'relaxed'];
const PARAGRAPH_SPACING_KEYS: ParagraphSpacingKey[] = ['compact', 'standard', 'relaxed'];
const MARGIN_KEYS: MarginKey[] = ['narrow', 'standard', 'wide'];
const FONT_FAMILY_KEYS: FontFamilyKey[] = ['serif', 'sans', 'system'];
const PAGE_TURN_KEYS: PageTurnStyle[] = ['slide', 'cover', 'curl', 'vertical', 'none'];

/** 底部升起的面板（同一时刻只开一个；目录改走左侧抽屉，issue #94） */
type Sheet = 'none' | 'bookmarks' | 'settings' | 'listen';
/** 设置面板内的二级展开行 */
type ExtraRow = 'none' | 'spacing' | 'more';

export function ReaderView(props: ReaderViewProps) {
  // t 绑定 React state，避免模块级 locale 与界面语言不同步
  const { t } = useI18n();
  const fontSize = FONT_SIZES[props.fontSize];
  const lineSpacing = LINE_SPACINGS[props.lineSpacing];
  const marginPx = MARGINS[props.margin];
  const paragraphSpacingPx = PARAGRAPH_SPACINGS[props.paragraphSpacing];
  const theme = READER_THEMES[props.theme];
  const { width: windowW, height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [contentSize, setContentSize] = useState<{ w: number; h: number } | null>(null);
  const pagerRef = useRef<PagerView | null>(null);
  const currentPageRef = useRef(0);
  const [activePage, setActivePage] = useState(0);
  // 覆盖动画：滚动偏移驱动每页位移（当前页静止，下一页从右滑入覆盖）
  const coverScrollX = useRef(new Animated.Value(0)).current;
  const coverScrollRef = useRef<FlatList | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const scrollOffsetRef = useRef(0);
  // 滚动模式位置互查（issue #64 收尾）：每段实测 y（onLayout 填充）+ 顶边段索引
  const paragraphTopsRef = useRef<number[]>([]);
  const visibleIndexRef = useRef<number | null>(null);
  /** 切章待恢复的段索引：布局就绪后由 tryScrollToPending 一次性定位 */
  const pendingScrollIndexRef = useRef<number | null>(null);
  /** null = 尚未见过本章（挂载也按切章处理，走一次恢复定位） */
  const scrollChapterBaseRef = useRef<number | null>(null);

  /** 上一套浅色主题：底栏「夜间」一键在浅色 ↔ 暖黑之间来回 */
  const lastLightThemeRef = useRef<ReaderThemeKey>(
    props.theme === 'night' ? 'paper' : props.theme,
  );
  if (props.theme !== 'night') lastLightThemeRef.current = props.theme;

  // 底部面板与工具条显隐
  const [sheet, setSheet] = useState<Sheet>('none');
  const [extraRow, setExtraRow] = useState<ExtraRow>('none');
  const [controlsVisible, setControlsVisible] = useState(true);
  /** 底栏两段实测高度：面板挂在四入口之上、长按操作条挂在底栏之上 */
  const [footerHeight, setFooterHeight] = useState(0);
  const [entriesHeight, setEntriesHeight] = useState(64);

  /**
   * 工具条悬浮（issue #90）：点屏唤出、3 秒无操作自动收起；
   * 面板打开期间保持显示（用户正在操作），关闭面板后重新计时。
   * 悬浮层不占排版空间——显隐不再触发翻页模式重新分页。
   */
  const showControls = () => setControlsVisible(true);
  useEffect(() => {
    if (!controlsVisible || sheet !== 'none') return;
    const timer = setTimeout(() => setControlsVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [controlsVisible, sheet]);

  const openSheet = (next: Sheet) => {
    hapticLight();
    setSheet((prev) => (prev === next ? 'none' : next));
    setControlsVisible(true);
    setExtraRow('none');
  };

  const closeSheet = () => {
    setSheet('none');
    setExtraRow('none');
  };

  // 工具条开合动画（渐隐 + 轻微位移）
  const menuAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: controlsVisible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [controlsVisible, menuAnim]);
  const topBarStyle = {
    opacity: menuAnim,
    transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
  } as const;
  const footerStyle = {
    opacity: menuAnim,
    transform: [{ translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
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
  /** 平移/瞬切共用 PagerView：瞬切只是不带动画的 setPage */
  const pagerMode = props.pageTurnStyle === 'slide' || props.pageTurnStyle === 'none';
  /**
   * 「上下」实时滚动（issue #99）：vertical 不再走 PagerView 按页吸附，
   * 改为与滚动模式同一套连续 ScrollView 渲染与位置跟踪——滑动多少就
   * 向下多少，跟手不吸附。
   */
  const scrollLike =
    props.mode === 'scroll' || (props.mode === 'paged' && props.pageTurnStyle === 'vertical');

  // 自动滚屏驱动（issue #78 重构）：每 tick 从实际当前位置前进一步，
  // 手动滚动/跨章后基准天然对齐，不会停摆或直跳章尾
  useEffect(() => {
    if (!scrollLike || props.autoScrollStep <= 0) return;
    const timer = setInterval(() => {
      const next = scrollOffsetRef.current + props.autoScrollStep;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollOffsetRef.current = next;
    }, AUTO_SCROLL_TICK_MS);
    return () => clearInterval(timer);
  }, [props.mode, props.autoScrollStep]);

  // 字体族：CJK 方块字假设下同字号不改变分页 metrics
  const bodyFontClass =
    props.fontFamily === 'sans' ? 'font-sans' : props.fontFamily === 'system' ? '' : 'font-serif';

  // 音量键翻页：父级监听系统音量后下发事件，这里只管翻页
  const volumeSeqRef = useRef(0);
  useEffect(() => {
    const event = props.volumeEvent;
    if (!event || event.seq === volumeSeqRef.current) return;
    volumeSeqRef.current = event.seq;
    if (scrollLike) {
      // 上下（连续滚动）：音量键滚动约一屏
      hapticLight();
      const page = (contentSize?.h ?? windowH) * 0.85;
      scrollRef.current?.scrollTo({
        y: Math.max(scrollOffsetRef.current + (event.direction === 'up' ? -page : page), 0),
        animated: true,
      });
      return;
    }
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

  // 沉浸全屏：菜单隐藏时同步隐藏状态栏；卸载恢复
  // 状态栏图标明暗跟随阅读主题：纸感/护眼/纯白是浅底，必须是深色图标，
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

  /** 按页索引跳转（平移/瞬切 → PagerView；覆盖/仿真 → 滚动定位） */
  const goToPage = (index: number): void => {
    const clamped = Math.min(Math.max(index, 0), Math.max(pages.length - 1, 0));
    if (clamped !== currentPageRef.current) props.playPageSound();
    if (pagerMode) {
      if (props.pageTurnStyle === 'none') pagerRef.current?.setPageWithoutAnimation(clamped);
      else pagerRef.current?.setPage(clamped);
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

  // 页定位：章节切换 → 恢复/起始偏移；同章排版变化（含工具条显隐导致的高度变化）→ 当前页首
  useEffect(() => {
    if (scrollLike || props.mode !== 'paged' || pages.length === 0) return;
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
  }, [props.chapterBaseOffset, pages.length, props.mode, props.pageTurnStyle, contentSize?.h]);

  // 滚动模式定位：切章 → 恢复/起始偏移所在段（此前滚动模式只有章级恢复，无段级）。
  // 布局未必立刻就绪：先记 pending，onLayout/onContentSizeChange 兜底触发 tryScrollToPending。
  const tryScrollToPending = (): void => {
    const index = pendingScrollIndexRef.current;
    if (index === null) return;
    const top = paragraphTopsRef.current[index];
    if (top === undefined) return;
    pendingScrollIndexRef.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(top, 0), animated: false });
  };
  useEffect(() => {
    paragraphTopsRef.current = [];
    visibleIndexRef.current = null;
    const chapterChanged = scrollChapterBaseRef.current !== props.chapterBaseOffset;
    scrollChapterBaseRef.current = props.chapterBaseOffset;
    if (!scrollLike) return;
    if (!chapterChanged) return;
    const targetOffset =
      props.initialOffset > 0 ? props.initialOffset : props.chapterBaseOffset;
    const startOffsets = props.paragraphs.map((p) => p.startOffset);
    pendingScrollIndexRef.current =
      startOffsets.length > 0 ? paragraphIndexForOffset(startOffsets, targetOffset) : null;
    tryScrollToPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.paragraphs, props.mode, props.pageTurnStyle]);

  // 滚动位置上报：顶边段变化时通知父级（统计/ETA/节流落库），替代 FlatList 的可视区回调
  const handleScroll = (event: { nativeEvent: { contentOffset: { y: number } } }): void => {
    const y = event.nativeEvent.contentOffset.y;
    scrollOffsetRef.current = y;
    if (pendingScrollIndexRef.current !== null) return; // 恢复定位期间不上报
    const tops = paragraphTopsRef.current;
    if (tops.length === 0 || props.paragraphs.length === 0) return;
    const index = paragraphIndexAtScrollY(tops, y);
    if (index === visibleIndexRef.current) return;
    visibleIndexRef.current = index;
    props.onVisibleCharOffset(props.paragraphs[index].startOffset);
  };

  const coverPageFromScroll = (event: unknown): number => {
    const x = (event as { nativeEvent: { contentOffset: { x: number } } }).nativeEvent.contentOffset.x;
    const w = Math.max(pageWidth, 1);
    return Math.round(x / w);
  };

  // 点击分区：左 1/3 上一页（页首接上一章），右 1/3 下一页（页尾接下一章），中 1/3 显隐工具条
  const handleTap = (event: { nativeEvent: { pageX: number } }) => {
    if (props.mode !== 'paged') {
      showControls();
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
      setSheet('none');
    } else {
      showControls();
    }
  };

  /**
   * 正文文本块的点击：文本块本身是 Pressable（长按划线需要），
   * 它会吃掉触摸、外层收不到 onPress，这里把同一次点击转交给分区逻辑。
   * 面板优先（issue #90）：面板开着时点正文任意处 = 关面板 + 收起工具条，不翻页。
   */
  const handleTextTap = (event: { nativeEvent: { pageX: number } }) => {
    if (sheet !== 'none') {
      closeSheet();
      setControlsVisible(false);
      return;
    }
    if (scrollLike) {
      // 滚动式交互没有分区翻页，整屏点击即显隐；自动阅读中仍按旧语义暂停/继续
      props.onScrollTap();
      if (controlsVisible) {
        setControlsVisible(false);
        setSheet('none');
      } else {
        showControls();
      }
      return;
    }
    handleTap(event);
  };

  // 高亮渲染：搜索命中 + 划线区间合并切片（字符级，重叠合并）
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

  // ---------------------------------------------------------------- 片段构造

  /** 分段选择器：点哪个就是哪个（不再「循环到下一个」） */
  const renderSegmented = <K extends string>(
    options: Array<{ key: K; label: string }>,
    /** null = 当前状态不适用（例如滚动模式下的翻页动画），不高亮任何一项 */
    value: K | null,
    onSelect: (key: K) => void,
  ) => (
    <View className={`flex-1 flex-row rounded-xl ${theme.bg} p-0.5`}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className={`flex-1 items-center justify-center rounded-lg py-1.5 ${active ? theme.action : ''}`}
            onPress={() => {
              hapticLight();
              onSelect(option.key);
            }}
          >
            <Text className={`text-[11px] ${active ? theme.actionText : theme.text}`}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  /** 带标签的整行（左侧标签，右侧分段） */
  const renderSegRow = <K extends string>(
    label: string,
    options: Array<{ key: K; label: string }>,
    value: K | null,
    onSelect: (key: K) => void,
  ) => (
    <View className="mb-1.5 flex-row items-center gap-2">
      <Text className={`w-12 text-[11px] ${theme.muted}`}>{label}</Text>
      {renderSegmented(options, value, onSelect)}
    </View>
  );

  /** 数字步进：A- / A+ */
  const stepFontSize = (delta: number) => {
    const index = FONT_SIZE_KEYS.indexOf(props.fontSize);
    const next = FONT_SIZE_KEYS[Math.min(Math.max(index + delta, 0), FONT_SIZE_KEYS.length - 1)];
    if (next === props.fontSize) return;
    hapticLight();
    props.onSelectFontSize(next);
  };

  const fontStepButton = (label: string, delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-9 w-9 items-center justify-center rounded-xl ${theme.bg}`}
      onPress={() => stepFontSize(delta)}
    >
      <Text className={`text-[13px] font-semibold ${theme.text}`}>{label}</Text>
    </Pressable>
  );

  // ---------------------------------------------------------------- 设置面板

  const renderSettingsSheet = () => {
    const sizeLabels: Record<FontSizeKey, StringKey> = {
      small: 'reader.sizeSmall',
      standard: 'reader.sizeStandard',
      large: 'reader.sizeLarge',
      xlarge: 'reader.sizeXLarge',
    };
    const spacingLabels: Record<'compact' | 'standard' | 'relaxed', StringKey> = {
      compact: 'reader.tight',
      standard: 'reader.medium',
      relaxed: 'reader.loose',
    };
    const marginLabels: Record<MarginKey, StringKey> = {
      narrow: 'reader.tight',
      standard: 'reader.medium',
      wide: 'reader.loose',
    };
    const themeLabels: Record<ReaderThemeKey, StringKey> = {
      paper: 'reader.themePaper',
      green: 'reader.themeGreen',
      white: 'reader.themeWhite',
      night: 'reader.themeNight',
    };

    return (
      <View className="px-3 pb-3 pt-2.5">
        {/* 第一行：亮度 + 护眼 */}
        <View className="mb-2 flex-row items-center gap-2">
          <View className={`flex-1 flex-row items-center gap-2 rounded-xl px-3 ${theme.bg}`}>
            <Ionicons name="sunny-outline" size={15} color={theme.mutedHex} />
            <ReaderSlider
              value={Math.round(props.brightness * 100)}
              max={100}
              trackColor={theme.mutedHex}
              fillColor={theme.textHex}
              thumbColor={theme.actionHex}
              onPreview={(v) => {
                const next = Math.max(MIN_BRIGHTNESS, v / 100);
                props.onBrightnessChange(next);
                showControls();
              }}
              onCommit={(v) => props.onBrightnessChange(Math.max(MIN_BRIGHTNESS, v / 100))}
            />
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: props.eyeCare }}
            className={`flex-row items-center gap-1.5 rounded-xl px-3 py-2.5 ${props.eyeCare ? theme.action : theme.bg}`}
            onPress={() => {
              hapticLight();
              props.onToggleEyeCare();
              showControls();
            }}
          >
            <Text className={`text-[11px] ${props.eyeCare ? theme.actionText : theme.text}`}>
              {t('reader.eyeCare')}
            </Text>
            <View
              className={`h-4 w-7 justify-center rounded-full px-0.5 ${
                props.eyeCare ? 'bg-white/40' : 'bg-black/10'
              }`}
            >
              <View className={`h-3 w-3 rounded-full bg-white ${props.eyeCare ? 'self-end' : 'self-start'}`} />
            </View>
          </Pressable>
        </View>

        {/* 第二行：字号 A- / 档位 / A+ */}
        <View className="mb-2 flex-row items-center gap-2">
          {fontStepButton('A-', -1)}
          {renderSegmented(
            FONT_SIZE_KEYS.map((key) => ({ key, label: t(sizeLabels[key]) })),
            props.fontSize,
            props.onSelectFontSize,
          )}
          {fontStepButton('A+', 1)}
        </View>

        {/* 第三行：背景四色点 */}
        <View className="mb-2 flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            {THEME_CYCLE.map((key) => {
              const tokens = READER_THEMES[key];
              const active = props.theme === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={t(themeLabels[key])}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    hapticLight();
                    props.onSelectTheme(key);
                    showControls();
                  }}
                  className="items-center justify-center rounded-full"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: tokens.bgHex,
                    borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                    borderColor: active ? tokens.actionHex : tokens.mutedHex,
                  }}
                >
                  {active ? <Ionicons name="checkmark" size={13} color={tokens.textHex} /> : null}
                </Pressable>
              );
            })}
          </View>
          <Text className={`text-[11px] ${theme.muted}`}>{t('reader.background')}</Text>
        </View>

        {/* 第四行：翻页动画 + 间距 */}
        <View className="mb-2 flex-row items-center gap-2">
          {renderSegmented(
            PAGE_TURN_KEYS.map((key) => ({
              key,
              label:
                key === 'slide'
                  ? t('reader.turnSlideLong')
                  : key === 'cover'
                    ? t('reader.turnCoverLong')
                    : key === 'curl'
                      ? t('reader.turnCurlLong')
                      : key === 'vertical'
                        ? t('reader.turnVerticalLong')
                        : t('reader.turnNone'),
            })),
            // 滚动模式下没有翻页动画可言，不给任何一项高亮，避免「选了覆盖却在滚动」的错位观感
            props.mode === 'paged' ? props.pageTurnStyle : null,
            (key) => {
              props.onSelectPageTurnStyle(key);
              // 滚动模式下选了翻页动画，说明想看翻页效果，顺手切模式
              if (props.mode === 'scroll') props.onToggleMode();
            },
          )}
          <Pressable
            accessibilityRole="button"
            className={`flex-row items-center gap-0.5 rounded-xl px-2.5 py-2 ${extraRow === 'spacing' ? theme.action : theme.bg}`}
            onPress={() => {
              hapticLight();
              setExtraRow(extraRow === 'spacing' ? 'none' : 'spacing');
            }}
          >
            <Text className={`text-[11px] ${extraRow === 'spacing' ? theme.actionText : theme.text}`}>
              {t('reader.spacing')}
            </Text>
            <Ionicons
              name={extraRow === 'spacing' ? 'chevron-down' : 'chevron-forward'}
              size={12}
              color={extraRow === 'spacing' ? theme.actionHex : theme.mutedHex}
            />
          </Pressable>
        </View>

        {extraRow === 'spacing' ? (
          <View className="mb-2 rounded-xl px-1 py-1.5">
            {renderSegRow(
              t('reader.lineHeight'),
              LINE_SPACING_KEYS.map((key) => ({ key, label: t(spacingLabels[key]) })),
              props.lineSpacing,
              props.onSelectLineSpacing,
            )}
            {renderSegRow(
              t('reader.paragraphSpacing', { value: '' }).trim(),
              PARAGRAPH_SPACING_KEYS.map((key) => ({ key, label: t(spacingLabels[key]) })),
              props.paragraphSpacing,
              props.onSelectParagraphSpacing,
            )}
            {renderSegRow(
              t('reader.margin'),
              MARGIN_KEYS.map((key) => ({ key, label: t(marginLabels[key]) })),
              props.margin,
              props.onSelectMargin,
            )}
          </View>
        ) : null}

        {/* 第五行：自动阅读 + 更多设置项 */}
        <View className="flex-row items-center justify-between">
          {scrollLike ? (
            <Pressable
              accessibilityRole="button"
              className={`flex-row items-center gap-1.5 rounded-xl px-3 py-2 ${
                props.autoScrollStep > 0 ? theme.action : theme.bg
              }`}
              onPress={() => {
                hapticLight();
                props.onCycleAutoScroll();
                showControls();
              }}
            >
              <Text
                className={`text-[11px] ${
                  props.autoScrollStep > 0 ? theme.actionText : theme.text
                }`}
              >
                {t('reader.autoRead')}
              </Text>
              <Text
                className={`text-[10px] ${
                  props.autoScrollStep > 0 ? theme.actionText : theme.muted
                }`}
              >
                {props.autoScrollSpeedLabel}
              </Text>
            </Pressable>
          ) : (
            <View className={`rounded-xl px-3 py-2 ${theme.bg}`}>
              <Text className={`text-[11px] ${theme.text}`}>{t('reader.modePaged')}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            className={`rounded-xl px-3 py-2 ${extraRow === 'more' ? theme.action : theme.bg}`}
            onPress={() => {
              hapticLight();
              setExtraRow(extraRow === 'more' ? 'none' : 'more');
            }}
          >
            <Text className={`text-[11px] ${extraRow === 'more' ? theme.actionText : theme.text}`}>
              {extraRow === 'more' ? t('reader.less') : t('reader.moreSettings')}
            </Text>
          </Pressable>
        </View>

        {extraRow === 'more' ? (
          <View className="mt-2 gap-1.5">
            {renderSegRow(
              t('reader.fontFamilyLabel'),
              FONT_FAMILY_KEYS.map((key) => ({
                key,
                label:
                  key === 'serif'
                    ? t('reader.fontSerif')
                    : key === 'sans'
                      ? t('reader.fontSans')
                      : t('reader.fontSystem'),
              })),
              props.fontFamily,
              props.onSelectFontFamily,
            )}
            {renderSegRow(
              t('reader.modeLabel'),
              [
                { key: 'scroll' as const, label: t('reader.modeScroll') },
                { key: 'paged' as const, label: t('reader.modePaged') },
              ],
              props.mode,
              (key) => {
                if (key !== props.mode) props.onToggleMode();
              },
            )}
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                className={`flex-1 items-center rounded-xl py-2 ${props.indentEnabled ? theme.action : theme.bg}`}
                onPress={() => {
                  hapticLight();
                  props.onToggleIndent();
                }}
              >
                <Text className={`text-[11px] ${props.indentEnabled ? theme.actionText : theme.text}`}>
                  {`${t('reader.indent')} ${props.indentEnabled ? t('common.on') : t('common.off')}`}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={`flex-1 items-center rounded-xl py-2 ${props.justifyEnabled ? theme.action : theme.bg}`}
                onPress={() => {
                  hapticLight();
                  props.onToggleJustify();
                }}
              >
                <Text className={`text-[11px] ${props.justifyEnabled ? theme.actionText : theme.text}`}>
                  {`${t('reader.justify')} ${props.justifyEnabled ? t('common.on') : t('common.off')}`}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={`flex-1 items-center rounded-xl py-2 ${theme.bg}`}
                onPress={() => {
                  hapticLight();
                  setSheet('listen');
                }}
              >
                <Text className={`text-[11px] ${theme.text}`}>{t('reader.panelListen')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  // ---------------------------------------------------------------- 其他面板
  // 目录改走左侧抽屉（issue #94）：由父级渲染，此处不再有 catalog 面板

  const renderBookmarksSheet = () => (
    <View className="px-3 pb-3 pt-2.5">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className={`text-[11px] ${theme.muted}`}>
          {t('reader.bookmark')} · {props.bookmarks.length}
        </Text>
        <Pressable
          accessibilityRole="button"
          className={`rounded-xl px-3 py-1.5 ${theme.action}`}
          onPress={() => {
            hapticLight();
            props.onAddBookmark();
          }}
        >
          <Text className={`text-[11px] ${theme.actionText}`}>{t('reader.addBookmark')}</Text>
        </Pressable>
      </View>
      {props.bookmarks.length === 0 ? (
        <Text className={`py-6 text-center text-[11px] ${theme.muted}`}>
          {t('reader.bookmarkEmpty')}
        </Text>
      ) : (
        <FlatList
          data={props.bookmarks}
          keyExtractor={(item) => item.id}
          style={{ maxHeight: Math.round(windowH * 0.45) }}
          renderItem={({ item }) => (
            <View className={`mb-1 flex-row items-center gap-2 rounded-lg ${theme.bg} px-2 py-1.5`}>
              <Pressable
                accessibilityRole="button"
                className="flex-1"
                onPress={() => {
                  hapticLight();
                  props.onOpenBookmark(item);
                  closeSheet();
                }}
              >
                <Text className={`text-xs ${theme.text}`} numberOfLines={1}>
                  {item.chapterTitle}
                </Text>
                <Text className={`text-[10px] ${theme.muted}`} numberOfLines={1}>
                  {item.excerpt}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.delete')}
                className="px-1.5 py-1"
                onPress={() => {
                  hapticLight();
                  props.onDeleteBookmark(item.id);
                }}
              >
                <Ionicons name="trash-outline" size={15} color={theme.mutedHex} />
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );

  const renderListenSheet = () => (
    <View className="px-3 pb-3 pt-2.5">
      <View className="mb-2 flex-row items-center gap-2">
        {playingHere ? (
          <Pressable
            accessibilityRole="button"
            className={`flex-row items-center gap-1.5 rounded-xl px-4 py-2 ${theme.action}`}
            onPress={() => props.onPause()}
          >
            <Ionicons name="pause" size={14} color={theme.actionHex} />
            <Text className={`text-[11px] ${theme.actionText}`}>{t('reader.pause')}</Text>
          </Pressable>
        ) : pausedHere ? (
          <Pressable
            accessibilityRole="button"
            className={`flex-row items-center gap-1.5 rounded-xl px-4 py-2 ${theme.action}`}
            onPress={() => props.onResume()}
          >
            <Ionicons name="play" size={14} color={theme.actionHex} />
            <Text className={`text-[11px] ${theme.actionText}`}>{t('reader.resume')}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            className={`flex-row items-center gap-1.5 rounded-xl px-4 py-2 ${theme.action}`}
            onPress={() => props.onPlayChapter()}
          >
            <Ionicons name="play" size={14} color={theme.actionHex} />
            <Text className={`text-[11px] ${theme.actionText}`}>{t('reader.playChapter')}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          className={`rounded-xl px-3 py-2 ${theme.bg}`}
          onPress={() => props.onCycleRate()}
        >
          <Text className={`text-[11px] ${theme.text}`}>{props.playbackRate}×</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className={`rounded-xl px-3 py-2 ${theme.bg}`}
          onPress={() => {
            hapticLight();
            props.onCycleSleep();
          }}
        >
          <Text
            className={`text-[11px] ${
              props.sleepLabel !== t('reader.sleepOff') ? theme.accent : theme.text
            }`}
          >
            {props.sleepLabel}
          </Text>
        </Pressable>
      </View>
      {props.playingThisChapter && props.segmentCount > 0 ? (
        <View className="flex-row items-center gap-2">
          <Text className={`text-[10px] ${theme.muted}`}>{t('reader.play')}</Text>
          <ReaderSlider
            value={props.segmentIndex}
            max={Math.max(props.segmentCount - 1, 0)}
            trackColor={theme.mutedHex}
            fillColor={theme.textHex}
            thumbColor={theme.actionHex}
            onPreview={() => undefined}
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
      ) : (
        <Text className={`text-[11px] ${theme.muted}`}>{t('reader.segmentHint')}</Text>
      )}
    </View>
  );

  const renderSheetBody = () => {
    switch (sheet) {
      case 'settings':
        return renderSettingsSheet();
      case 'bookmarks':
        return renderBookmarksSheet();
      case 'listen':
        return renderListenSheet();
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------- 底栏

  const renderEntry = (params: {
    icon: 'list' | 'bookmarks-outline' | 'moon' | 'settings-outline';
    label: string;
    active?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: params.active === true }}
      className="flex-1 items-center gap-0.5 py-1"
      onPress={params.onPress}
    >
      <Ionicons
        name={params.icon === 'list' ? 'list-outline' : params.icon}
        size={20}
        color={params.active ? theme.actionHex : theme.textHex}
        style={params.active ? undefined : styles.entryIconIdle}
      />
      <Text
        className={`text-[10px] ${params.active ? theme.accent : theme.muted}`}
        numberOfLines={1}
      >
        {params.label}
      </Text>
    </Pressable>
  );

  const nightActive = props.theme === 'night';

  const pageNumRow = (page: ReaderPage) => (
    <Text className={`mt-4 text-center text-[10px] ${theme.muted}`}>
      {page.ordinal + 1} / {pages.length}
    </Text>
  );

  return (
    <View className={`flex-1 ${theme.bg}`}>
      {/* 顶部工具条（单行，悬浮层 issue #90）：返回 / 章节名 / 加书签 / 更多；设置项一律不进这里 */}
      {controlsVisible ? (
        <Animated.View
          style={[topBarStyle, styles.topBarOverlay]}
          className={`absolute inset-x-0 top-0 border-b ${theme.surface} ${theme.border}`}
        >
          <View
            className="flex-row items-center px-1"
            style={{ paddingTop: insets.top + 4, paddingBottom: 4 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              className="h-9 w-9 items-center justify-center"
              onPress={() => {
                hapticLight();
                props.onBack();
              }}
            >
              <Ionicons name="chevron-back" size={22} color={theme.textHex} />
            </Pressable>
            <Text className={`flex-1 text-center text-xs ${theme.muted}`} numberOfLines={1}>
              {props.chapterTitle}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('reader.addBookmark')}
              className="h-9 w-9 items-center justify-center"
              onPress={() => {
                hapticLight();
                props.onAddBookmark();
              }}
            >
              <Ionicons name="bookmark-outline" size={19} color={theme.textHex} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('reader.more')}
              className="h-9 w-9 items-center justify-center"
              onPress={() => props.onOpenDrawer()}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={theme.textHex} />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}

      {/* 正文区：工具条与底栏都在流内，正文高度稳定，显隐不重新分页 */}
      <View
        className="flex-1"
        style={{ paddingTop: 8 }}
        onLayout={(e) =>
          // layout.height 含这段内边距，分页要用真正的正文高度，否则每页会多排一行把末行顶出屏幕
          setContentSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height - 8,
          })
        }
      >
        {props.mode === 'paged' && contentSize && metrics && pagerMode ? (
          <View className="flex-1" style={{ paddingHorizontal: marginPx }}>
            <PagerView
              ref={pagerRef}
              style={{ flex: 1 }}
              initialPage={0}
              overdrag={false}
              orientation={props.pageTurnStyle === 'vertical' ? 'vertical' : 'horizontal'}
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
                  <Pressable key={page.ordinal} className="flex-1" onPress={handleTextTap}>
                    {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                    {pageNumRow(page)}
                  </Pressable>
                ) : (
                  <View key={page.ordinal} className="flex-1" />
                ),
              )}
            </PagerView>
          </View>
        ) : null}
        {props.mode === 'paged' && contentSize && metrics && props.pageTurnStyle === 'curl' ? (
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
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: coverScrollX } } }], {
                useNativeDriver: true,
                listener: (event) => {
                  const idx = coverPageFromScroll(event);
                  currentPageRef.current = idx;
                  const page = pages[idx];
                  if (page) currentOffsetRef.current = page.startOffset;
                },
              })}
              renderItem={({ item: page }) => (
                <Animated.View
                  className={theme.bg}
                  style={[
                    { width: contentSize.w, height: contentSize.h },
                    coverTransforms[page.ordinal],
                    {
                      // 卷页近似：3D 翻页（rotationY + 透视），真 Skia 着色器卷页为后续增强
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
                  <Pressable className="flex-1" onPress={handleTextTap}>
                    {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                    {pageNumRow(page)}
                  </Pressable>
                </Animated.View>
              )}
            />
          </View>
        ) : null}
        {props.mode === 'paged' && contentSize && metrics && props.pageTurnStyle === 'cover' ? (
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
              onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: coverScrollX } } }], {
                useNativeDriver: true,
                listener: (event) => {
                  const idx = coverPageFromScroll(event);
                  currentPageRef.current = idx;
                  const page = pages[idx];
                  if (page) currentOffsetRef.current = page.startOffset;
                },
              })}
              renderItem={({ item: page }) => (
                <Animated.View
                  className={theme.bg}
                  style={[
                    { width: contentSize.w, height: contentSize.h },
                    coverTransforms[page.ordinal],
                  ]}
                >
                  <Pressable className="flex-1" onPress={handleTextTap}>
                    {chunksForPage(page).map((chunk) => renderChunk(chunk, page))}
                    {pageNumRow(page)}
                  </Pressable>
                </Animated.View>
              )}
            />
          </View>
        ) : null}
        {scrollLike ? (
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            style={{ paddingHorizontal: marginPx }}
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
            onScroll={handleScroll}
            onContentSizeChange={() => tryScrollToPending()}
            scrollEventThrottle={32}
          >
            {props.paragraphs.map((item, index) => {
              const isHighlighted =
                props.highlightOffset !== null &&
                item.startOffset <= props.highlightOffset &&
                props.highlightOffset < item.endOffset;
              return (
                <Pressable
                  key={`${item.startOffset}-${index}`}
                  onLayout={(e) => {
                    // 每段实测 y：滚动位置持久化按「顶边所在段」互查（替代可视区回调）
                    paragraphTopsRef.current[index] = e.nativeEvent.layout.y;
                    tryScrollToPending();
                  }}
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
            })}
            {/* 尾部占位（issue #64 收尾）：内容不足一屏时撑满剩余空白、整块可点，
                长章时 flexBasis 0 收拢为 0 高——替代固定 320dp footer，空白区不再点不到 */}
            <Pressable style={styles.scrollTail} onPress={handleTextTap} />
          </ScrollView>
        ) : null}
      </View>

      {/* 长按操作条：挂在底栏之上，避免被四入口挡住 */}
      {props.longPressRange ? (
        <View
          pointerEvents="auto"
          className={`absolute inset-x-0 mx-4 flex-row items-center gap-2 rounded-xl border p-2 ${theme.surface} ${theme.border}`}
          style={{ bottom: footerHeight + 8 }}
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

      {/* 听书悬浮球：不占排版空间，点按播放/暂停，长按展开听书面板 */}
      {sheet === 'none' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('reader.listenHint')}
          className={`absolute h-12 w-12 items-center justify-center rounded-full border ${theme.surface} ${theme.border}`}
          style={[styles.listenBall, playingHere ? { borderColor: theme.actionHex } : null]}
          onPress={() => {
            hapticLight();
            if (playingHere) props.onPause();
            else if (pausedHere) props.onResume();
            else props.onPlayChapter();
          }}
          onLongPress={() => openSheet('listen')}
          delayLongPress={400}
        >
          <Ionicons
            name={playingHere ? 'headset' : 'headset-outline'}
            size={21}
            color={playingHere ? theme.actionHex : theme.textHex}
          />
        </Pressable>
      ) : null}

      {/* 底部：翻页行 + 四入口（悬浮层 issue #90，点屏唤出 / 3 秒自动收起） */}
      {controlsVisible ? (
        <Animated.View
          style={[footerStyle, styles.footerOverlay, { paddingBottom: insets.bottom }]}
          className={`absolute inset-x-0 bottom-0 border-t ${theme.surface} ${theme.border}`}
          onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        >
          <View className="flex-row items-center gap-2 px-3 pt-1">
            <Pressable
              accessibilityRole="button"
              disabled={!props.hasPrevChapter}
              style={!props.hasPrevChapter ? styles.navDisabled : null}
              onPress={() => {
                hapticLight();
                props.onPrevChapter();
              }}
            >
              <Text className={`text-[11px] ${theme.text}`}>{t('reader.prevChapter')}</Text>
            </Pressable>
            <ReaderSlider
              value={props.chapterIndex}
              max={Math.max(props.chapterCount - 1, 0)}
              trackColor={theme.mutedHex}
              fillColor={theme.textHex}
              thumbColor={theme.actionHex}
              onPreview={(index) => {
                showControls();
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
            <Pressable
              accessibilityRole="button"
              disabled={!props.hasNextChapter}
              style={!props.hasNextChapter ? styles.navDisabled : null}
              onPress={() => {
                hapticLight();
                props.onNextChapter();
              }}
            >
              <Text className={`text-[11px] ${theme.text}`}>{t('reader.nextChapter')}</Text>
            </Pressable>
          </View>
          <Text className={`pb-0.5 text-center text-[10px] ${theme.muted}`} numberOfLines={1}>
            {props.chapterEta ? `${progressLabel} · ${props.chapterEta}` : progressLabel}
          </Text>

          <View
            className="flex-row items-center px-1 pb-1"
            onLayout={(e) => setEntriesHeight(e.nativeEvent.layout.height)}
          >
            {renderEntry({
              icon: 'list',
              label: t('reader.catalog'),
              onPress: () => props.onOpenCatalog(),
            })}
            {renderEntry({
              icon: 'bookmarks-outline',
              label: t('reader.bookmark'),
              active: sheet === 'bookmarks',
              onPress: () => openSheet('bookmarks'),
            })}
            {renderEntry({
              icon: 'moon',
              label: t('reader.night'),
              active: nightActive,
              onPress: () => {
                hapticLight();
                props.onSelectTheme(nightActive ? lastLightThemeRef.current : 'night');
                showControls();
              },
            })}
            {renderEntry({
              icon: 'settings-outline',
              label: t('reader.settingsTitle'),
              active: sheet === 'settings',
              onPress: () => openSheet('settings'),
            })}
          </View>
        </Animated.View>
      ) : null}

      {/* 底部升起的面板（issue #94 去分层）：与底栏入口同色平面衔接，无圆角/阴影/拖拽条 */}
      {sheet !== 'none' ? (
        <View
          className={`absolute inset-x-0 border-t ${theme.surface} ${theme.border}`}
          style={{
            bottom: entriesHeight + insets.bottom,
            maxHeight: Math.round(windowH * 0.62),
          }}
        >
          {/* 面板内容可滚动（issue #99）：任何行都不被 maxHeight 截断 */}
          <ScrollView nestedScrollEnabled>{renderSheetBody()}</ScrollView>
        </View>
      ) : null}

      {/* 亮度遮罩（黑）与护眼遮罩（琥珀）：不申请系统亮度权限，只压在本页上 */}
      <View
        pointerEvents="none"
        className="absolute inset-0"
        style={{ backgroundColor: '#000000', opacity: 1 - props.brightness }}
      />
      {props.eyeCare ? (
        <View
          pointerEvents="none"
          className="absolute inset-0"
          style={{ backgroundColor: '#FFB863', opacity: 0.12 }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navDisabled: {
    opacity: 0.4,
  },
  entryIconIdle: {
    opacity: 0.72,
  },
  // 悬浮工具条（issue #90）：盖在正文之上，显隐不改变正文排版高度
  topBarOverlay: {
    zIndex: 20,
  },
  footerOverlay: {
    zIndex: 20,
  },
  scrollTail: {
    flex: 1,
  },
  listenBall: {
    right: 6,
    top: '42%',
    // 悬浮球压在正文之上，给一点投影让它在任何底色上都立得住
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
