# TaleCast

面向个人的移动端有声书制作 App：把一本本地小说文本，变成可以听的章节音频——人对制作过程保留最终决定权。

## 创意来源与致谢

本项目的**产品创意与核心信念借鉴自 [CastGlean](https://github.com/yexiyue/castglean)**（yexiyue 开发的 Tauri 2 + Rust 桌面有声书制作应用）：

- **"模型提议、宿主验证、用户拍板"** 的产品哲学：模型只提出分章、角色、音色等候选建议，界面审阅后由人工显式采用，可撤销。
- **从小说到有声的完整制作链**：导入原文 → 分章 → 角色与归属分析 → 声音绑定 → 顺序生成 → 试听。
- **原文不可变、冻结输入、幂等可恢复** 等工程信念。

TaleCast 是在移动端对这些创意的**全新实现**：不复用 CastGlean 的代码、UI 或桌面架构（无 Rust），专注 iOS + Android 一套代码。产品细节以 [docs/plan.md](docs/plan.md) 的约束为准。

## 产品核心信念（借鉴自 CastGlean）

- **原文不可变**：导入后按哈希保存原始字节和解码文本，任何编辑都不改写来源
- **冻结输入**：任务开始时锁定来源哈希、章节范围和版本，输入变了不续跑旧结果
- **候选而非直改**：一切模型产出都是候选，人工采用才生效
- **人工保护**：确认过的角色身份、音色绑定不被模型建议覆盖
- **幂等与可恢复**：命令带回执，生成任务按段持久化缓存，重试不重复请求

## 当前状态

计划定稿（草案 v4，见 [docs/plan.md](docs/plan.md)）。

- [~] P0：脚手架与数据底座——代码就绪（tsc / 15 vitest / iOS bundle 通过）；**待 Expo Go 双端启动与数据持久化验收**
- [~] P1：导入与分章闭环——已实现（UTF-8 校验导入、双哈希、分章候选采用/撤销、章节编辑、阅读位置；49 项测试含全流程）
- [~] P2：角色、音色与云端生成——已实现（Edge TTS 协议纯层+fixture 测试、音色快照、绑定+人工保护、LLM 角色抽取、段级幂等生成、失败只补缺失段、试听转正）
- [~] P3：播放与助手——已实现（全局段队列播放/切页不中断、正文按段高亮+点段跳转、助手 SSE 流式+历史分页、候选必须人工采用）
- [~] P4：加固——已实现（Secure Store 密钥、请求用量展示、空/错误状态清扫、能力边界文案；**真机最小化验证待用户执行**）

## 开发与运行

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：domain 纯逻辑 + 纯函数适配器（SSE 解析）
pnpm start       # 开发服务器 → 手机装 Expo Go 扫码运行
```

日常运行（Expo Go，最快验证）：
1. `pnpm start`，终端出现二维码
2. 手机装 Expo Go（App Store / 各应用商店），扫二维码
3. 书架 → 新建工程 → 导入 UTF-8 TXT → 按里程碑流程使用
（注意：手机与电脑需同一局域网；`pnpm start --tunnel` 可走隧道）

## 构建发版（本地产物）

```bash
# 1. 生成原生工程（改动 app.json / 原生配置后需重跑；产物目录已被 .gitignore）
pnpm expo prebuild --platform android --no-install
pnpm expo prebuild --platform ios --no-install

# 2. Android APK（调试签名，可直接安装分发；pnpm 严格布局需补 NODE_PATH）
cd android
NODE_PATH="$(cd .. && pwd)/node_modules/.pnpm/node_modules" \
  JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleRelease --no-daemon
# 产物：android/app/build/outputs/apk/release/app-release.apk

# 3. iOS（模拟器包，无需开发者账号；需 Xcode 26+ / Swift 6.2）
cd ios && pod install
xcodebuild -workspace TaleCast.xcworkspace -scheme TaleCast -configuration Release \
  -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO
# 产物：ios/build/Build/Products/Release-iphonesimulator/TaleCast.app

# 4. 真机 iOS / 上架：需 Apple 开发者账号，走 EAS（eas build）或本地签名打包
```

`releases/` 目录存放当期编译产物，不入库。

## 技术栈（概览）

| 层次 | 选型 |
| --- | --- |
| 框架 | Expo + React Native + TypeScript（pnpm） |
| 路由 | Expo Router |
| 样式 | NativeWind |
| 本地存储 | expo-sqlite（SQLite 为唯一权威状态） |
| 语音生成 | Edge TTS（免费、非官方 WebSocket 协议；官方 provider 作为后备位） |
| 文本模型 | 远程 OpenAI 兼容 API（助手与角色抽取） |
| 架构 | ports & adapters：domain 纯 TS + vitest，平台能力收口 adapters，hooks 为 UI 唯一服务入口 |
