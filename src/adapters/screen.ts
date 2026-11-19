import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * 屏幕方向适配（docs/design/2026-11-19-manual-reading-plan.md §4.4）：
 * 应用整体竖屏（app.json orientation），阅读屏临时开放横屏（跟随系统）。
 */
export class ScreenOrientationAdapter {
  async allowAll(): Promise<void> {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL);
  }

  async lockPortrait(): Promise<void> {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }
}
