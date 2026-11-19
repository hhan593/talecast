import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { FONT_SIZES, LINE_SPACINGS, type FontSizeKey, type LineSpacingKey } from '@/components/workbench/reader-view';

const SPEED_MULTIPLIERS = { slow: 1, standard: 2, fast: 4 } as const;
const TICK_MS = 16;

export type AutoScrollSpeed = keyof typeof SPEED_MULTIPLIERS;

/**
 * 自动滚屏（RE-4①）：滚动模式下匀速自动滚动，触摸暂停/恢复。
 * 返回 scrollRef 的 offset 推进器和速度控制。
 */
export function useAutoScroll(options: {
  enabled: boolean;
  fontSize: FontSizeKey;
  lineSpacing: LineSpacingKey;
  /** 边距像素值（直接传数值，避免跨层类型依赖） */
  marginPx: number;
  contentHeight: number;
}) {
  const [speed, setSpeed] = useState<AutoScrollSpeed>('standard');
  const [running, setRunning] = useState(false);
  const offsetRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { width: windowW } = useWindowDimensions();

  const fontSizePx = FONT_SIZES[options.fontSize];
  const marginPx = options.marginPx;
  const lineHeight = fontSizePx * LINE_SPACINGS[options.lineSpacing];
  const charsPerLine = Math.max(1, Math.floor((windowW - marginPx * 2) / fontSizePx));
  const linesPerPage = Math.max(1, Math.floor(options.contentHeight / lineHeight));

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = useCallback(() => {
    stop();
    setRunning(true);
    const pxPerTick = (SPEED_MULTIPLIERS[speed] * fontSizePx * TICK_MS) / 1000;
    timerRef.current = setInterval(() => {
      offsetRef.current += pxPerTick;
    }, TICK_MS);
  }, [speed, fontSizePx]);

  const toggle = useCallback(() => {
    if (running) stop();
    else start();
  }, [running, start, stop]);

  useEffect(() => stop, [stop]);

  return {
    offsetRef,
    running,
    speed,
    setSpeed,
    start,
    stop,
    toggle,
    /** 每页视觉行数（分页用） */
    linesPerPage,
    /** 每行字数（分页用） */
    charsPerLine,
    lineHeightPx: lineHeight,
  };
}
