# iOS 计划书（后置，工具链升级后执行）

文档状态：后置（当前工具链不满足，见下）；2026-11-20 修订至 v0.9.0 代码状态
日期：2026-11-19（v0.10.0 修订）
前置条件：**Xcode 26+ / Swift 6.2 工具链**（本机当前 Xcode 16.3 不满足，Expo SDK 58 iOS 原生层要求）

## 1. 范围

TaleCast 全量功能 iOS 版（与 Android 功能集一致），无功能裁剪：

- 阅读（滚动/翻页/主题/排版/书签/搜索/高亮笔记）——React Native 代码层 100% 复用
- 后台/锁屏播放——react-native-track-player iOS 实现（MPRemoteCommandCenter + NowPlayingInfo）
- TTS 生成（Edge TTS WebSocket 协议跨平台一致；**对话分声**同样生效——归属逻辑纯 domain）
- 导出（MP3 + UIActivityViewController 替代 Android share intent）
- 推送/通知——本期不做（个人应用无推送需求）
- iOS 专属增强位（可选）：音量键翻页不适用 iOS（iOS 无音量键拦截 API）——iOS 端阅读器不启用该功能

## 2. 阻断项与解除条件

| 阻断 | 现状 | 解除条件 |
| --- | --- | --- |
| Swift tools 6.2 | Xcode 16.3 内含 Swift 6.1 | **升级到 Xcode 26.0+**（App Store 下载） |
| Expo SDK 58 iOS 原生编译 | 依赖 Swift 6.2 | 同上 |
| react-native-track-player iOS Pod | CocoaPods 集成 | pod install 在新 Xcode 下应正常 |
| 原生模块增量（v0.8–v0.14） | expo-haptics（触感）、react-native-pager-view、react-native-volume-manager（若音量键翻页落地） | autolinking 自动接入；pod install 覆盖 |

## 3. 执行步骤（工具链就绪后 ~1 天工作量）

1. 升级 Xcode 26+（App Store）
2. `pnpm expo prebuild --platform ios --no-install`（已做好跨平台代码）
3. `cd ios && pod install`
4. `xcodebuild -workspace TaleCast.xcworkspace -scheme TaleCast -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO`（模拟器包）
5. 真机分发需 Apple Developer 账号（$99/年）：Xcode 签名 → TestFlight → App Store
6. 质量门：tsc / vitest / iOS bundle / 真机验收（同 Android 清单）

## 4. iOS 差异项

| 项 | Android | iOS |
| --- | --- | --- |
| 后台播放 | Foreground Service + MediaSession | UIBackgroundModes audio + MPRemoteCommandCenter（track-player 自动处理） |
| 文件导入 | SAF (content:// URI) | Files app / UIDocumentPicker |
| 分享 | Android Share Intent | UIActivityViewController（expo-sharing 自动处理） |
| 签名 | 调试签名 | 需开发者证书 |
| 真机分发 | APK 直接安装 | TestFlight / Ad Hoc |
