import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { FONT_SIZES, LINE_SPACINGS, type FontSizeKey, type LineSpacingKey } from '@/domain/reader';

const SPEED_MULTIPLIERS = { slow: 1, standard: 2, fast: 4 } as const;
/** reader-view 的匀速滚动 tick 周期（毫秒） */
export const AUTO_SCROLL_TICK_MS = 32;

export type AutoScrollSpeed = keyof typeof SPEED_MULTIPLIERS;

/**
 * 自动滚屏（RE-4①；issue #78 重构）：只产出「每 tick 像素步长」，不再持有
 * 绝对滚动位置——reader-view 每 tick 从**实际当前位置**前进一步，手动滚动/
 * 跨章后天然对齐，不会停摆或直跳章尾。速度档此前是 hook 内部死状态
 * （三档等速），现由调用方传入真实档位。
 */
export function useAutoScroll(options: {
  speed: AutoScrollSpeed;
  fontSize: FontSizeKey;
  lineSpacing: LineSpacingKey;
  marginPx: number;
}) {
  const { width: windowW } = useWindowDimensions();

  return useMemo(() => {
    const fontSizePx = FONT_SIZES[options.fontSize];
    return {
      /** 每 tick 前进的像素数 = 档位倍率 × 字号高度 */
      stepPx: (SPEED_MULTIPLIERS[options.speed] * fontSizePx * AUTO_SCROLL_TICK_MS) / 1000,
      /** 每行字数（CJK 方块字假设，排版参考值） */
      charsPerLine: Math.max(1, Math.floor((windowW - options.marginPx * 2) / fontSizePx)),
    };
  }, [options.fontSize, options.lineSpacing, options.marginPx, options.speed, windowW]);
}

export type AutoScroll = ReturnType<typeof useAutoScroll>;
