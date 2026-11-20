import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { VolumeManager } from 'react-native-volume-manager';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AssistantView } from '@/components/workbench/assistant-view';
import { EditDialog } from '@/components/edit-dialog';
import { EncodingDialog } from '@/components/encoding-dialog';
import { MARGINS, ReaderView, type HighlightRange, type ReaderBookmark } from '@/components/workbench/reader-view';
import { useAnnotations } from '@/hooks/use-annotations';
import { useAssistant } from '@/hooks/use-assistant';
import { useBookSearch } from '@/hooks/use-book-search';
import { useBookmarks } from '@/hooks/use-bookmarks';
import { useGeneration } from '@/hooks/use-generation';
import { useLibrary } from '@/hooks/use-library';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { usePageSound } from '@/hooks/use-page-sound';
import { usePlayback } from '@/hooks/use-playback';
import { useProject } from '@/hooks/use-project';
import { useServices } from '@/container';
import { useI18n } from '@/hooks/use-i18n';
import type { PageTurnStyle } from '@/domain/reader';
import { type Paragraph } from '@/domain/source';
import type { Chapter } from '@/domain/types';

export default function ProjectWorkbenchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const projectId = params.id;
  const { project, loading, notFound } = useProject(projectId);
  const services = useServices();
  const { t } = useI18n();
  const library = useLibrary(projectId, project?.revision ?? -1);
  const generation = useGeneration(projectId);
  const router = useRouter();

  const playback = usePlayback(projectId);
  const assistant = useAssistant(projectId);
  const bookmarks = useBookmarks(projectId);
  const annotations = useAnnotations(projectId);
  const [longPressRange, setLongPressRange] = useState<{ start: number; end: number } | null>(null);
  const bookSearch = useBookSearch(projectId);
  const [view, setView] = useState<'chapters' | 'reader' | 'assistant'>('chapters');
  const [readerMode, setReaderMode] = useState<'scroll' | 'paged'>('scroll');
  const [readerFontSize, setReaderFontSize] = useState<'small' | 'standard' | 'large' | 'xlarge'>('standard');
  const [readerLineSpacing, setReaderLineSpacing] = useState<'compact' | 'standard' | 'relaxed'>('standard');
  const [readerParagraphSpacing, setReaderParagraphSpacing] = useState<'compact' | 'standard' | 'relaxed'>('standard');
  const [readerIndent, setReaderIndent] = useState(true);
  const [readerJustify, setReaderJustify] = useState(true);
  const [readerMargin, setReaderMargin] = useState<'narrow' | 'standard' | 'wide'>('standard');
  const [readerTheme, setReaderTheme] = useState<'paper' | 'green' | 'white' | 'night'>('paper');
  const [pageTurnStyle, setPageTurnStyle] = useState<PageTurnStyle>('slide');
  const [readerBrightness, setReaderBrightness] = useState(1);
  const [readerEyeCare, setReaderEyeCare] = useState(false);
  const [highlightRange, setHighlightRange] = useState<HighlightRange | null>(null);
  const [catalogView, setCatalogView] = useState<'chapters' | 'bookmarks' | 'notes' | 'search'>('chapters');
  const [searchInput, setSearchInput] = useState('');
  const [dialogueVoices, setDialogueVoices] = useState(true);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<'off' | 'slow' | 'standard' | 'fast'>('off');
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const [readerFontFamily, setReaderFontFamily] = useState<'serif' | 'sans' | 'system'>('serif');
  const [immersive, setImmersive] = useState(true);
  const [volumeKeyTurn, setVolumeKeyTurn] = useState(false);
  const [pageSound, setPageSound] = useState(false);
  const [volumeEvent, setVolumeEvent] = useState<{ seq: number; direction: 'up' | 'down' } | null>(null);
  const [wordKaraoke, setWordKaraoke] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [current, setCurrent] = useState<{
    chapter: Chapter;
    chapterText: string;
    paragraphs: Paragraph[];
  } | null>(null);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [lastPageOffset, setLastPageOffset] = useState(-1);
  const [restored, setRestored] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: 'rename'; chapterId: string; title: string; initial: string }
    | { kind: 'split'; chapterId: string; title: string; initial: string }
    | { kind: 'boundary'; chapterId: string; title: string; initial: string }
    | { kind: 'note-annotation'; title: string; range: { start: number; end: number }; initial: string }
    | { kind: 'edit-note'; title: string; annotationId: string; initial: string }
    | null
  >(null);
  const lastSaveRef = useRef(0);
  const orientation = services.screenOrientation;

  // 亮度偏好（v0.19.0）：滑杆拖动时逐帧改状态，停手 500ms 再落库，避免每帧写 settings
  useEffect(() => {
    const timer = setTimeout(() => {
      void services.settings.setSetting('reader-brightness', readerBrightness.toFixed(2));
    }, 500);
    return () => clearTimeout(timer);
  }, [readerBrightness, services]);

  // 阅读屏开放横屏（manual-reading-plan §4.4）；离开恢复竖屏
  useEffect(() => {
    if (view !== 'reader') return;
    void orientation.allowAll();
    return () => {
      void orientation.lockPortrait();
    };
  }, [view, orientation]);

  // 自动滚屏（v0.10.0）：滚动模式 + 速度档驱动；离开阅读/切模式/关闭即停
  const playPageSound = usePageSound(pageSound);
  const autoScroll = useAutoScroll({
    enabled: autoScrollSpeed !== 'off',
    fontSize: readerFontSize,
    lineSpacing: readerLineSpacing,
    marginPx: MARGINS[readerMargin],
    contentHeight: 600,
  });
  useEffect(() => {
    if (view === 'reader' && readerMode === 'scroll' && autoScrollSpeed !== 'off' && !autoScrollPaused) {
      autoScroll.start();
    } else {
      autoScroll.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, readerMode, autoScrollSpeed, autoScrollPaused, readerFontSize, readerLineSpacing, readerMargin]);

  // 音量键翻页（v0.11.0）：Android；监听音量变化→还原音量→下发翻页事件
  const volumeRef = useRef<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android' || !volumeKeyTurn || view !== 'reader') {
      volumeRef.current = null;
      return;
    }
    let cancelled = false;
    void VolumeManager.getVolume().then((v) => {
      if (!cancelled) volumeRef.current = v.volume;
    });
    const listener = VolumeManager.addVolumeListener((result) => {
      const last = volumeRef.current;
      const volume = result.volume;
      if (last === null || Math.abs(volume - last) < 0.02) {
        volumeRef.current = volume;
        return;
      }
      volumeRef.current = volume;
      void VolumeManager.setVolume(last, { showUI: false }); // 还原系统音量
      setVolumeEvent((prev) => ({
        seq: (prev?.seq ?? 0) + 1,
        direction: volume > last ? 'up' : 'down',
      }));
    });
    return () => {
      cancelled = true;
      listener.remove();
    };
  }, [volumeKeyTurn, view]);

  // 阅读会话统计（v0.10.0）：进入阅读计时，离开/切视图结算时长与字数
  const readerSessionRef = useRef<{ at: number; startOffset: number } | null>(null);
  const lastKnownOffsetRef = useRef(0);
  useEffect(() => {
    if (view === 'reader') {
      readerSessionRef.current = { at: Date.now(), startOffset: lastKnownOffsetRef.current };
      return () => {
        const session = readerSessionRef.current;
        if (!session) return;
        const durationMs = Date.now() - session.at;
        const charsRead = Math.max(0, lastKnownOffsetRef.current - session.startOffset);
        readerSessionRef.current = null;
        void services.stats.recordSession(durationMs, charsRead);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // 打开工程恢复上次阅读位置（4.1.1）：直接回到上次阅读的章节与偏移
  const openChapterRef = useRef<(chapterId: string, charOffset?: number) => Promise<void>>(async () => {});
  useEffect(() => {
    if (restored || !library.chapters || library.chapters.length === 0) return;
    setRestored(true);
    void services.reading.restoreReaderPrefs(projectId).then((prefs) => {
      setReaderMode(prefs.mode);
      setReaderFontSize(prefs.fontSize);
    });
    void services.settings.getSetting('reader-line-spacing').then((v) => {
      if (v === 'compact' || v === 'standard' || v === 'relaxed') setReaderLineSpacing(v);
    });
    void services.settings.getSetting('reader-margin').then((v) => {
      if (v === 'narrow' || v === 'standard' || v === 'wide') setReaderMargin(v);
    });
    void services.settings.getSetting('reader-paragraph-spacing').then((v) => {
      if (v === 'compact' || v === 'standard' || v === 'relaxed') setReaderParagraphSpacing(v);
    });
    void services.settings.getSetting('reader-indent').then((v) => setReaderIndent(v !== 'off'));
    void services.settings.getSetting('reader-align').then((v) => setReaderJustify(v !== 'off'));
    void services.settings.getSetting(`dialogue-voices:${projectId}`).then((v) => setDialogueVoices(v !== 'off'));
    void services.settings.getSetting('reader-font-family').then((v) => {
      if (v === 'serif' || v === 'sans' || v === 'system') setReaderFontFamily(v);
    });
    void services.settings.getSetting('reader-immersive').then((v) => setImmersive(v !== 'off'));
    void services.settings.getSetting('volume-key-turn').then((v) => setVolumeKeyTurn(v === 'on'));
    void services.settings.getSetting('reader-page-sound').then((v) => setPageSound(v === 'on'));
    void services.settings.getSetting('word-karaoke').then((v) => setWordKaraoke(v === 'on'));
    void services.settings.getSetting('reader-theme').then((v) => {
      if (v === 'paper' || v === 'green' || v === 'white' || v === 'night') setReaderTheme(v);
    });
    void services.settings.getPageTurnStyle().then(setPageTurnStyle);
    void services.settings.getSetting('reader-brightness').then((v) => {
      const parsed = v === null ? NaN : Number.parseFloat(v);
      if (Number.isFinite(parsed)) setReaderBrightness(Math.min(1, Math.max(0.35, parsed)));
    });
    void services.settings.getSetting('reader-eye-care').then((v) => setReaderEyeCare(v === 'on'));
    void services.reading.restorePosition(projectId, library.chapters).then((position) => {
      if (!position || position.charOffset === 0) return; // 无历史位置/在开头 → 停留目录
      void openChapterRef.current(position.chapterId, position.charOffset);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.chapters, restored, projectId, services]);

  const openChapter = useCallback(
    async (chapterId: string, charOffset = 0) => {
      const result = await services.reading.getChapterText(projectId, chapterId);
      if (!result.ok) {
        library.setError(result.error.message);
        return;
      }
      setCurrent({
        chapter: result.value.chapter,
        chapterText: result.value.chapterText,
        paragraphs: result.value.paragraphs,
      });
      setPendingOffset(charOffset);
      // 阅读统计基点随切章重置（issue #32）：否则 charsRead = 跨章全书偏移差，字数统计虚高
      lastKnownOffsetRef.current = charOffset;
      setCurrentOffset(charOffset);
      setView('reader');
    },
    [projectId, services, library],
  );
  openChapterRef.current = openChapter;

  // 章节导航（v0.8.0）：上一章/下一章/拖动条跳章；跳章清除搜索高亮
  const chapters = library.chapters ?? [];
  const chapterIndex = current ? chapters.findIndex((c) => c.id === current.chapter.id) : -1;
  const goChapterDelta = useCallback(
    (delta: number) => {
      if (chapterIndex < 0) return;
      const target = chapters[chapterIndex + delta];
      if (!target) return;
      setHighlightRange(null);
      void openChapter(target.id, target.startOffset);
    },
    [chapters, chapterIndex, openChapter],
  );
  const seekChapter = useCallback(
    (index: number) => {
      const target = chapters[index];
      if (!target) return;
      setHighlightRange(null);
      void openChapter(target.id, target.startOffset);
    },
    [chapters, openChapter],
  );
  const getChapterTitle = useCallback(
    (index: number) => chapters[index]?.title ?? '',
    [chapters],
  );

  // 划线与笔记（v0.12.0）：当前书全部区间下发给阅读器渲染
  const annotationRanges = useMemo(
    () => annotations.annotations.map((a) => ({ start: a.startOffset, end: a.endOffset })),
    [annotations.annotations],
  );
  /** 书签列表（v0.19.0 阅读器底栏入口）：补上章节标题，供阅读器直接展示 */
  const readerBookmarks = useMemo<ReaderBookmark[]>(
    () =>
      bookmarks.bookmarks.map((bookmark) => ({
        id: bookmark.id,
        chapterId: bookmark.chapterId,
        charOffset: bookmark.charOffset,
        excerpt: bookmark.excerpt,
        chapterTitle: chapters.find((chapter) => chapter.id === bookmark.chapterId)?.title ?? '',
      })),
    [bookmarks.bookmarks, chapters],
  );

  const handleAnnotate = useCallback(
    (kind: 'underline' | 'note' | 'copy') => {
      if (!current || !longPressRange) return;
      if (kind === 'copy') {
        void Clipboard.setStringAsync(current.chapterText.slice(longPressRange.start, longPressRange.end));
        setLongPressRange(null);
        return;
      }
      if (kind === 'underline') {
        void annotations
          .add(current.chapter.id, longPressRange.start, longPressRange.end, '')
          .then((result) => {
            // 失败保留选区并提示（issue #33）：静默关闭会让用户误以为已保存
            if (result.ok) setLongPressRange(null);
            else Alert.alert(t('workbench.underlineFailed'), result.error.message);
          });
        return;
      }
      // 笔记：对话框输入后写入
      setDialog({ kind: 'note-annotation', title: t('workbench.writeNoteTitle'), range: longPressRange, initial: '' });
    },
    [annotations, current, longPressRange],
  );

  // 睡眠定时循环（v0.11.0）：关 → 15 分 → 30 分 → 60 分 → 播完本章 → 播完本段 → 关
  const sleepModes = ['off', 'm15', 'm30', 'm60', 'chapter', 'segment'] as const;
  const [sleepModeKey, setSleepModeKey] = useState<(typeof sleepModes)[number]>('off');
  const sleepLabel =
    sleepModeKey === 'off'
      ? t('reader.sleepOff')
      : sleepModeKey === 'm15'
        ? t('reader.sleepMinutes', { minutes: 15 })
        : sleepModeKey === 'm30'
          ? t('reader.sleepMinutes', { minutes: 30 })
          : sleepModeKey === 'm60'
            ? t('reader.sleepMinutes', { minutes: 60 })
            : sleepModeKey === 'chapter'
              ? t('reader.sleepChapter')
              : t('reader.sleepSegment');
  const cycleSleep = useCallback(async () => {
    const next = sleepModes[(sleepModes.indexOf(sleepModeKey) + 1) % sleepModes.length];
    setSleepModeKey(next);
    if (next === 'off') {
      playback.cancelSleepTimer();
      return;
    }
    if (next === 'chapter' || next === 'segment') {
      await playback.setSleepTimer(next);
      return;
    }
    const minutes = next === 'm15' ? 15 : next === 'm30' ? 30 : 60;
    await playback.setSleepTimer('minutes', minutes);
  }, [sleepModeKey, playback]);

  // 本章剩余时长预估（v0.11.0）：听读按当前倍速语速（≈4.2 字/秒@1×），阅读按 500 字/分
  const [currentOffset, setCurrentOffset] = useState(0);
  const chapterEta = useMemo(() => {
    if (!current) return null;
    const remaining = Math.max(0, current.chapter.endOffset - currentOffset);
    if (remaining === 0) return null;
    const listening = playback.state.chapterId === current.chapter.id && playback.state.status === 'playing';
    const minutes = listening
      ? remaining / (4.2 * playback.state.rate * 60)
      : remaining / 500;
    return t('workbench.remainingMinutes', { minutes: Math.max(1, Math.ceil(minutes)) });
  }, [current, currentOffset, playback.state.chapterId, playback.state.status, playback.state.rate]);

  // 点段跳转 / 正文跟随（docs/plan.md P3：拖动进度/切章后高亮跟随）
  const seekToParagraph = useCallback(
    async (paragraph: Paragraph) => {
      const st = services.playback.getState();
      if (st.chapterId !== current?.chapter.id || st.queueOffsets.length === 0) {
        if (!current) return;
        const played = await playback.playChapter(current.chapter.id);
        if (!played.ok) return;
      }
      const offsets = services.playback.getState().queueOffsets;
      let index = 0;
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i] <= paragraph.startOffset) index = i;
      }
      await playback.seekToSegment(index);
    },
    [current, playback, projectId, services],
  );

  const saveReadingPosition = useCallback(
    (chapterId: string, charOffset: number) => {
      const now = Date.now();
      if (now - lastSaveRef.current < 1500) return; // 节流
      lastSaveRef.current = now;
      void services.reading.savePosition(projectId, chapterId, charOffset);
    },
    [projectId, services],
  );

  const paragraphs = current?.paragraphs ?? [];
  const initialIndex = useMemo(() => {
    if (pendingOffset <= 0) return undefined;
    const index = paragraphs.findIndex((p) => p.startOffset > pendingOffset) - 1;
    return index >= 0 ? index : 0;
  }, [paragraphs, pendingOffset]);
  // 按文本长度估算行高：滚动定位精度优于固定值（长段/短段混合的章节尤其明显）
  const layout = useMemo(() => {
    const lengths = paragraphs.map((p) => Math.ceil(p.text.length / 22) * 24 + 16);
    const offsets: number[] = [];
    let acc = 0;
    for (const length of lengths) {
      offsets.push(acc);
      acc += length;
    }
    return { lengths, offsets };
  }, [paragraphs]);

  const viewableCallbackRef = useRef<((info: { viewableItems: Array<{ item?: unknown }> }) => void) | null>(null);
  viewableCallbackRef.current = (info) => {
    const first = info.viewableItems[0];
    if (first?.item && current && view === 'reader' && readerMode === 'scroll') {
      lastKnownOffsetRef.current = (first.item as Paragraph).startOffset;
      setCurrentOffset((first.item as Paragraph).startOffset);
      saveReadingPosition(current.chapter.id, (first.item as Paragraph).startOffset);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }
  if (notFound || !project) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-paper-night">
        <Text className="text-base text-ink dark:text-ink-night">{t('workbench.missingBook')}</Text>
        <Pressable accessibilityRole="button" className="rounded-xl bg-accent px-4 py-2" onPress={() => router.back()}>
          <Text className="font-semibold text-white">{t('workbench.backToShelf')}</Text>
        </Pressable>
      </View>
    );
  }

  // ------------------------------------------------------------------ 正文视图
  if (view === 'reader' && current) {
    return (
      <ReaderView
        chapterTitle={current.chapter.title}
        chapterText={current.chapterText}
        chapterBaseOffset={current.chapter.startOffset}
        mode={readerMode}
        fontSize={readerFontSize}
        followPlayback={true}
        paragraphs={current.paragraphs}
        lineSpacing={readerLineSpacing}
        paragraphSpacing={readerParagraphSpacing}
        indentEnabled={readerIndent}
        justifyEnabled={readerJustify}
        margin={readerMargin}
        theme={readerTheme}
        brightness={readerBrightness}
        eyeCare={readerEyeCare}
        pageTurnStyle={pageTurnStyle}
        initialOffset={pendingOffset}
        highlightOffset={
          playback.state.chapterId === current.chapter.id ? playback.state.segmentStartOffset : null
        }
        highlightRange={highlightRange}
        playingThisChapter={playback.state.chapterId === current.chapter.id}
        playbackStatus={playback.state.status}
        playbackRate={playback.state.rate}
        segmentIndex={playback.state.segmentIndex}
        segmentCount={playback.state.segmentCount}
        chapterIndex={Math.max(chapterIndex, 0)}
        chapterCount={chapters.length}
        getChapterTitle={getChapterTitle}
        hasPrevChapter={chapterIndex > 0}
        hasNextChapter={chapterIndex >= 0 && chapterIndex < chapters.length - 1}
        onPrevChapter={() => goChapterDelta(-1)}
        onNextChapter={() => goChapterDelta(1)}
        onSeekChapter={seekChapter}
        onViewableItems={(info) => viewableCallbackRef.current?.(info)}
        onBack={() => {
          setHighlightRange(null);
          setView('chapters');
        }}
        onPlayChapter={() => void playback.playChapter(current.chapter.id)}
        onPause={() => void playback.pause()}
        onResume={() => void playback.resume()}
        onCycleRate={() => {
          const rates = [0.8, 1.0, 1.2, 1.5, 2.0];
          const next = rates[(rates.indexOf(playback.state.rate) + 1) % rates.length];
          void playback.setRate(next);
        }}
        onSelectFontSize={(key) => {
          setReaderFontSize(key);
          void services.reading.saveReaderPrefs(projectId, readerMode, key);
        }}
        onSelectLineSpacing={(key) => {
          setReaderLineSpacing(key);
          void services.settings.setSetting('reader-line-spacing', key);
        }}
        onSelectParagraphSpacing={(key) => {
          setReaderParagraphSpacing(key);
          void services.settings.setSetting('reader-paragraph-spacing', key);
        }}
        onToggleIndent={() => {
          const next = !readerIndent;
          setReaderIndent(next);
          void services.settings.setSetting('reader-indent', next ? 'on' : 'off');
        }}
        onToggleJustify={() => {
          const next = !readerJustify;
          setReaderJustify(next);
          void services.settings.setSetting('reader-align', next ? 'on' : 'off');
        }}
        onSelectMargin={(key) => {
          setReaderMargin(key);
          void services.settings.setSetting('reader-margin', key);
        }}
        onSelectTheme={(key) => {
          setReaderTheme(key);
          void services.settings.setSetting('reader-theme', key);
        }}
        onBrightnessChange={(value) => setReaderBrightness(Math.min(1, Math.max(0.35, value)))}
        onToggleEyeCare={() => {
          const next = !readerEyeCare;
          setReaderEyeCare(next);
          void services.settings.setSetting('reader-eye-care', next ? 'on' : 'off');
        }}
        onToggleMode={() => {
          const next = readerMode === 'paged' ? 'scroll' : 'paged';
          setReaderMode(next);
          void services.reading.saveReaderPrefs(projectId, next, readerFontSize);
        }}
        onSelectPageTurnStyle={(style) => {
          setPageTurnStyle(style);
          void services.settings.setPageTurnStyle(style);
        }}
        onPageChange={(charOffset) => {
          setLastPageOffset(charOffset);
          lastKnownOffsetRef.current = charOffset;
          setCurrentOffset(charOffset);
          saveReadingPosition(current.chapter.id, charOffset);
        }}
        autoScrollOffsetRef={autoScrollSpeed !== 'off' ? autoScroll.offsetRef : null}
        autoScrollSpeedLabel={
          autoScrollSpeed === 'off'
            ? t('common.off')
            : autoScrollSpeed === 'slow'
              ? t('characters.rateSlow')
              : autoScrollSpeed === 'standard'
                ? t('reader.medium')
                : t('characters.rateFast')
        }
        onCycleAutoScroll={() => {
          setAutoScrollPaused(false);
          const cycle: Array<'off' | 'slow' | 'standard' | 'fast'> = ['off', 'slow', 'standard', 'fast'];
          setAutoScrollSpeed(cycle[(cycle.indexOf(autoScrollSpeed) + 1) % cycle.length]);
        }}
        onSeekSegment={(index) => void playback.seekToSegment(index)}
        onScrollTap={() => {
          if (autoScrollSpeed !== 'off') setAutoScrollPaused((p) => !p);
        }}
        annotations={annotationRanges}
        wordHighlight={wordKaraoke ? (playback.state.wordHighlight ?? null) : null}
        longPressRange={longPressRange}
        onLongPressText={setLongPressRange}
        onAnnotate={handleAnnotate}
        fontFamily={readerFontFamily}
        onSelectFontFamily={(key) => {
          setReaderFontFamily(key);
          void services.settings.setSetting('reader-font-family', key);
        }}
        chapterEta={chapterEta}
        sleepLabel={sleepLabel}
        onCycleSleep={() => void cycleSleep()}
        volumeEvent={volumeEvent}
        pageSoundEnabled={pageSound}
        playPageSound={playPageSound}
        immersive={immersive}
        onAddBookmark={() => {
          const offset = lastPageOffset >= 0 ? lastPageOffset : pendingOffset;
          const excerpt = current.chapterText.slice(offset, offset + 20);
          void bookmarks.add(current.chapter.id, offset, excerpt);
        }}
        bookmarks={readerBookmarks}
        onOpenBookmark={(bookmark) => {
          setHighlightRange(null);
          void openChapter(bookmark.chapterId, bookmark.charOffset);
        }}
        onDeleteBookmark={(bookmarkId) => void bookmarks.remove(bookmarkId)}
      />
    );
  }

  // ------------------------------------------------------------------ 助手视图
  if (view === 'assistant') {
    return (
      <AssistantView
        messages={assistant.messages}
        streaming={assistant.streaming}
        streamText={assistant.streamText}
        error={assistant.error}
        hasEarlier={assistant.hasEarlier}
        input={assistantInput}
        scope={assistant.scope}
        chapters={chapters.map((c) => ({ id: c.id, title: c.title, startOffset: c.startOffset, endOffset: c.endOffset }))}
        selection={longPressRange}
        onScopeChange={assistant.setScope}
        onBack={() => setView('chapters')}
        onLoadEarlier={() => void assistant.loadEarlier()}
        onInputChange={setAssistantInput}
        onSend={(text) => {
          setAssistantInput('');
          void assistant.send(text);
        }}
        onOpenProposal={(proposalId) =>
          router.push({
            pathname: '/project/[id]/review',
            params: { id: projectId, proposalId },
          })
        }
      />
    );
  }

  // ------------------------------------------------------------------ 目录视图
  return (
    <View className="flex-1 bg-paper px-4 pb-6 pt-14 dark:bg-paper-night">
      <Text className="font-serif text-2xl font-bold text-ink dark:text-ink-night" numberOfLines={1}>
        {project.title}
      </Text>
      <Text className="mt-1 text-xs text-muted dark:text-muted-night">
        revision {project.revision}
        {library.source ? t('workbench.sourceSuffix', { name: library.source.filename }) : ''}
      </Text>

      {library.error ? (
        <Text className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {library.error}
        </Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        <Pressable accessibilityRole="button"
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => router.push({ pathname: '/project/[id]/characters', params: { id: projectId } })}
        >
          <Text className="text-sm text-ink dark:text-ink-night">{t('workbench.characters')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button"
          className="flex-1 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
          onPress={() => setView('assistant')}
        >
          <Text className="text-sm text-ink dark:text-ink-night">{t('workbench.assistant')}</Text>
        </Pressable>
      </View>

      {generation.progress ? (
        <View className="mt-3 rounded-xl bg-card p-4 dark:bg-card-night">
          <View className="flex-row items-center justify-between">
            <Text className="font-semibold text-ink dark:text-ink-night">
              {t('workbench.jobTitle')} ·{' '}
              {generation.progress.status === 'done'
                ? t('workbench.jobDone')
                : generation.progress.status === 'failed'
                  ? t('workbench.jobFailed')
                  : t('workbench.jobRunning', { progress: generation.progress.progress, total: generation.progress.totalSegments })}
            </Text>
            {generation.progress.status === 'failed' ? (
              <Pressable accessibilityRole="button"
                className="rounded-lg bg-gold px-3 py-1.5"
                disabled={generation.busy}
                onPress={() => void generation.retry(generation.progress!.jobId)}
              >
                <Text className="text-xs font-semibold text-white">{t('workbench.retryMissing')}</Text>
              </Pressable>
            ) : null}
            {generation.progress.status === 'done' ? (
              <Pressable accessibilityRole="button"
                className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
                disabled={generation.busy}
                onPress={() => void generation.exportChapter(generation.progress!.jobId)}
              >
                <Text className="text-xs text-ink dark:text-ink-night">{t('workbench.exportMp3')}</Text>
              </Pressable>
            ) : null}
            {generation.progress.status === 'running' || generation.progress.status === 'pending' ? (
              <Pressable accessibilityRole="button"
                className="rounded-lg bg-raised px-3 py-1.5 dark:bg-card-night"
                onPress={() => void generation.cancel(generation.progress!.jobId)}
              >
                <Text className="text-xs text-ink dark:text-ink-night">{t('common.cancel')}</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="mt-2 h-2 rounded-full bg-raised dark:bg-card-night">
            <View
              className="h-2 rounded-full bg-accent"
              style={{ width: `${Math.round((generation.progress.progress / Math.max(generation.progress.totalSegments, 1)) * 100)}%` }}
            />
          </View>
          <Text className="mt-2 text-xs text-muted dark:text-muted-night" numberOfLines={3}>
            {generation.progress.error ?? t('workbench.jobProgress', { progress: generation.progress.progress, total: generation.progress.totalSegments })}
          </Text>
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        {!library.source ? (
          <Pressable accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-accent py-2.5 active:bg-accent-deep"
            disabled={library.busy}
            onPress={() => void library.pickImportTxt()}
          >
            <Text className="font-semibold text-white">{t('workbench.importTxt')}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable accessibilityRole="button"
              className="rounded-xl bg-raised px-3 py-2.5 dark:bg-card-night"
              disabled={library.busy}
              onPress={() => {
                void library.resplit().then((result) => {
                  if (result.ok && result.value && typeof result.value === 'object' && 'proposalId' in result.value) {
                    router.push({
                      pathname: '/project/[id]/review',
                      params: { id: projectId, proposalId: String((result.value as { proposalId: string }).proposalId) },
                    });
                  }
                });
              }}
            >
              <Text className="text-sm text-ink dark:text-ink-night">{t('workbench.resplit')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className="rounded-xl bg-raised px-3 py-2.5 dark:bg-card-night"
              onPress={() =>
                Alert.alert(t('workbench.capability'), t('workbench.capabilityHint'))
              }
            >
              <Text className="text-sm text-ink dark:text-ink-night">{t('workbench.proposalHistory')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button"
              className={`rounded-xl px-3 py-2.5 ${dialogueVoices ? 'bg-accent-soft dark:bg-accent-nightsoft' : 'bg-raised dark:bg-card-night'}`}
              onPress={() => {
                const next = !dialogueVoices;
                setDialogueVoices(next);
                void services.settings.setSetting(`dialogue-voices:${projectId}`, next ? 'on' : 'off');
              }}
            >
              <Text
                className={`text-sm ${dialogueVoices ? 'text-accent dark:text-accent-night' : 'text-ink dark:text-ink-night'}`}
              >
                {t('workbench.dialogueVoices')} · {dialogueVoices ? t('common.on') : t('common.off')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* 目录三分区（v0.8.0）：章节 / 书签列表（含摘录） / 全文搜索 */}
      <View className="mt-3 flex-row gap-2">
        {([
          ['chapters', `${t('workbench.chapters')}${chapters.length > 0 ? ` ${chapters.length}` : ''}`],
          ['bookmarks', `${t('workbench.bookmarks')}${bookmarks.bookmarks.length > 0 ? ` ${bookmarks.bookmarks.length}` : ''}`],
          ['notes', `${t('workbench.notes')}${annotations.annotations.length > 0 ? ` ${annotations.annotations.length}` : ''}`],
          ['search', t('workbench.search')],
        ] as const).map(([key, label]) => (
          <Pressable accessibilityRole="button"
            key={key}
            className={`flex-1 items-center rounded-xl py-2 ${
              catalogView === key ? 'bg-accent' : 'bg-raised dark:bg-card-night'
            }`}
            onPress={() => setCatalogView(key)}
          >
            <Text
              className={`text-sm ${catalogView === key ? 'font-semibold text-white' : 'text-ink dark:text-ink-night'}`}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {catalogView === 'chapters' ? (
      <FlatList
        className="mt-3"
        data={library.chapters ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={library.busy} onRefresh={() => void library.refresh()} />}
        renderItem={({ item, index }) => (
          <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
            <Pressable onPress={() => void openChapter(item.id)}>
              <Text className="font-semibold text-ink dark:text-ink-night">
                {index + 1}. {item.title}
              </Text>
              <Text className="mt-1 text-xs text-faint">
                {t('workbench.offset', { start: item.startOffset, end: item.endOffset })}
              </Text>
            </Pressable>
            {library.source ? (
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Pressable accessibilityRole="button" className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'rename', chapterId: item.id, title: t('workbench.renameTitle'), initial: item.title })}>
                  <Text className="text-xs text-muted dark:text-ink-night">{t('workbench.rename')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'split', chapterId: item.id, title: t('workbench.splitTitle'), initial: String(Math.floor((item.startOffset + item.endOffset) / 2)) })}>
                  <Text className="text-xs text-muted dark:text-ink-night">{t('workbench.split')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" className="rounded-md bg-raised px-2 py-1 dark:bg-card-night" onPress={() => setDialog({ kind: 'boundary', chapterId: item.id, title: t('workbench.boundaryTitle'), initial: String(item.endOffset) })}>
                  <Text className="text-xs text-muted dark:text-ink-night">{t('workbench.boundary')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  className="rounded-md bg-accent-soft px-2 py-1 dark:bg-accent-nightsoft"
                  disabled={generation.busy}
                  onPress={() => void generation.preview(item.id)}
                >
                  <Text className="text-xs text-accent dark:text-accent-night">{t('workbench.previewFirst')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  className="rounded-md bg-accent px-2 py-1"
                  disabled={generation.busy}
                  onPress={() => void generation.start(item.id)}
                >
                  <Text className="text-xs font-semibold text-white">{t('workbench.generateChapter')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button"
                  className="rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                  onPress={() =>
                    Alert.alert(t('workbench.deleteChapter'), t('workbench.deleteChapterConfirm', { title: item.title }), [
                      { text: t('common.cancel'), style: 'cancel' },
                      { text: t('common.delete'), style: 'destructive', onPress: () => void library.remove(item.id) },
                    ])
                  }
                >
                  <Text className="text-xs text-danger dark:text-danger-night">{t('common.delete')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-2" />}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              {t('workbench.catalogEmpty')}
            </Text>
          </View>
        }
      />
      ) : null}

      {catalogView === 'bookmarks' ? (
        <FlatList
          className="mt-3"
          data={bookmarks.bookmarks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
              <Pressable accessibilityRole="button"
                onPress={() => {
                  setHighlightRange(null);
                  void openChapter(item.chapterId, item.charOffset);
                }}
              >
                <Text className="text-sm text-ink dark:text-ink-night" numberOfLines={3}>
                  {item.excerpt}
                </Text>
                <Text className="mt-1 text-xs text-faint">
                  {new Date(item.createdAt).toLocaleString()}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button"
                className="mt-2 self-start rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                onPress={() => void bookmarks.remove(item.id)}
              >
                <Text className="text-xs text-danger dark:text-danger-night">{t('common.delete')}</Text>
              </Pressable>
            </View>
          )}
          ItemSeparatorComponent={() => <View className="h-2" />}
          ListEmptyComponent={
            <View className="items-center py-16">
              <Text className="text-center text-sm text-muted dark:text-muted-night">
                {t('workbench.bookmarksEmpty')}
              </Text>
            </View>
          }
        />
      ) : null}

      {catalogView === 'notes' ? (
        <View className="mt-3 flex-1">
          {annotations.annotations.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              className="mb-2 items-center rounded-xl bg-raised py-2.5 dark:bg-card-night"
              onPress={() => {
                void services.annotations
                  .exportMarkdown(projectId)
                  .then((result) => {
                    if (!result.ok) return;
                    void services.shareTextFile(
                      `${(project?.title ?? t('workbench.notesFallback')).slice(0, 20)}-notes.md`,
                      result.value.markdown,
                      'text/markdown',
                    );
                  });
              }}
            >
              <Text className="text-sm text-ink dark:text-ink-night">{t('workbench.exportMarkdown')}</Text>
            </Pressable>
          ) : null}
          <FlatList
            data={annotations.annotations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const chapter = chapters.find((c) => c.id === item.chapterId);
              return (
                <View className="rounded-xl bg-card px-4 py-3 dark:bg-card-night">
                  <Text className="text-sm text-ink dark:text-ink-night" numberOfLines={3}>
                    {chapter ? chapter.title : t('workbench.chapterFallback')}
                  </Text>
                  {item.note.length > 0 ? (
                    <Text className="mt-1 text-xs text-muted dark:text-muted-night" numberOfLines={4}>
                      {t('workbench.noteLine', { text: item.note })}
                    </Text>
                  ) : (
                    <Text className="mt-1 text-xs text-faint" numberOfLines={2}>
                      {t('workbench.underlineLine', { count: item.endOffset - item.startOffset })}
                    </Text>
                  )}
                  <View className="mt-2 flex-row gap-2">
                    <Pressable
                      accessibilityRole="button"
                      className="rounded-md bg-raised px-2 py-1 dark:bg-card-night"
                      onPress={() => {
                        setHighlightRange(null);
                        void openChapter(item.chapterId, item.startOffset);
                      }}
                    >
                      <Text className="text-xs text-muted dark:text-ink-night">{t('workbench.jump')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      className="rounded-md bg-raised px-2 py-1 dark:bg-card-night"
                      onPress={() => setDialog({ kind: 'edit-note', title: t('workbench.editNoteTitle'), annotationId: item.id, initial: item.note })}
                    >
                      <Text className="text-xs text-muted dark:text-ink-night">{item.note.length > 0 ? t('workbench.editNote') : t('workbench.writeNote')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      className="rounded-md bg-danger-soft px-2 py-1 dark:bg-danger-nightsoft"
                      onPress={() => void annotations.remove(item.id)}
                    >
                      <Text className="text-xs text-danger dark:text-danger-night">{t('common.delete')}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
            ItemSeparatorComponent={() => <View className="h-2" />}
            ListEmptyComponent={
              <View className="items-center py-16">
                <Text className="text-center text-sm text-muted dark:text-muted-night">
                  {t('workbench.notesEmpty')}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}

      {catalogView === 'search' ? (
        <View className="mt-3 flex-1">
          <View className="flex-row gap-2">
            <TextInput
              className="flex-1 rounded-xl bg-raised px-3 py-2 text-sm text-ink dark:bg-card-night dark:text-ink-night"
              placeholder={t("workbench.searchPlaceholder")}
              placeholderTextColor="#8C8272"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={() => void bookSearch.search(searchInput)}
              returnKeyType="search"
            />
            <Pressable accessibilityRole="button"
              className="rounded-xl bg-accent px-4 py-2 active:bg-accent-deep"
              disabled={bookSearch.busy || searchInput.trim().length === 0}
              onPress={() => void bookSearch.search(searchInput)}
            >
              <Text className="text-sm font-semibold text-white">{bookSearch.busy ? t('workbench.searching') : t('workbench.searchButton')}</Text>
            </Pressable>
          </View>
          {bookSearch.error ? (
            <Text className="mt-2 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
              {bookSearch.error}
            </Text>
          ) : null}
          {bookSearch.results !== null && bookSearch.results.length === 0 ? (
            <Text className="mt-6 text-center text-sm text-muted dark:text-muted-night">
              {t('workbench.searchEmpty', { query: searchInput.trim() })}
            </Text>
          ) : null}
          <FlatList
            className="mt-3"
            data={bookSearch.results ?? []}
            keyExtractor={(item, index) => `${item.chapterId}-${item.charOffset}-${index}`}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button"
                className="rounded-xl bg-card px-4 py-3 dark:bg-card-night"
                onPress={() => {
                  const length = searchInput.trim().length;
                  setHighlightRange({ start: item.charOffset, end: item.charOffset + length });
                  void openChapter(item.chapterId, item.charOffset);
                }}
              >
                <Text className="text-xs text-muted dark:text-muted-night" numberOfLines={1}>
                  {item.chapterTitle}
                </Text>
                <Text className="mt-1 text-sm text-ink dark:text-ink-night" numberOfLines={2}>
                  {item.excerpt}
                </Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View className="h-2" />}
          />
        </View>
      ) : null}

      <EncodingDialog
        visible={library.pendingImport !== null}
        fileName={library.pendingImport?.fileName ?? ''}
        detection={library.pendingImport?.detection ?? null}
        value={library.importEncoding}
        onChange={library.setImportEncoding}
        onConfirm={() => void library.confirmImportTxt()}
        onCancel={library.cancelImportTxt}
      />

      <EditDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        initialValue={dialog?.initial ?? ''}
        keyboardType={dialog?.kind === 'rename' || dialog?.kind === 'note-annotation' || dialog?.kind === 'edit-note' ? 'default' : 'numeric'}
        onConfirm={(value) => {
          if (!dialog) return;
          if (dialog.kind === 'rename') {
            void library.rename(dialog.chapterId, value);
          } else if (dialog.kind === 'note-annotation') {
            void annotations
              .add(current!.chapter.id, dialog.range.start, dialog.range.end, value)
              .then((result) => {
                if (result.ok) setLongPressRange(null);
                else Alert.alert(t('workbench.noteSaveFailed'), result.error.message);
              });
          } else if (dialog.kind === 'edit-note') {
            void annotations.setNote(dialog.annotationId, value);
          } else if (dialog.kind === 'split') {
            const offset = Number.parseInt(value, 10);
            if (!Number.isFinite(offset)) library.setError(t('workbench.invalidSplit'));
            else void library.splitAt(dialog.chapterId, offset);
          } else if (dialog.kind === 'boundary') {
            const offset = Number.parseInt(value, 10);
            if (!Number.isFinite(offset)) library.setError(t('workbench.invalidBoundary'));
            else void library.moveBoundary(dialog.chapterId, offset);
          }
        }}
        onClose={() => setDialog(null)}
      />
    </View>
  );
}
