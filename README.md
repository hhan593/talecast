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

## 当前状态（v0.5.1，2026-11-19）

**已发版**。最新版本 [v0.5.1 正式版](https://github.com/hhan593/talecast/releases/tag/v0.5.1)（非预发行），附带可直接安装的 Android APK。`app.json` 与 `package.json` 版本均为 `0.5.1`，`main` 与 `origin/main` 同步。

质量门（本地 + CI 双重执行）：`pnpm typecheck` 0 错误；`pnpm test` 96 项全绿（20 个测试文件）；`src/architecture.test.ts` 3 条依赖方向守卫；零 TODO 残留。[GitHub Actions](.github/workflows/ci.yml) 在 push/PR 上跑 typecheck + test。

### 功能里程碑

- [x] **P0–P4（v0.1.0 / v0.1.1）**：脚手架与数据底座、导入与分章闭环、角色/音色/云端生成、播放与助手、加固；v0.1.1 完成工程化收敛（六路评审 40+ 项发现、27 项行为保持简化、9 个模块修复 PR、CI 上线）。见 [module-assessment.md](docs/module-assessment.md) / [findings](docs/review/2026-11-17-findings.md) / [复盘](docs/knowledge/lessons/2026-11-18-engineering-retrospective.md)
- [x] **v0.2.0**：墨韵纸感设计系统（衬线正文）、后台/锁屏播放（`react-native-track-player`）、章节 MP3 导出与系统分享、按绑定的 TTS 韵律参数（rate/pitch/volume）、书架三列网格视图
- [x] **v0.3.0–v0.5.0**：手动阅读模式完整落地——滚动/翻页双模式、确定性字符偏移分页、字号四档、横屏、边听边读跟随、书签、全文搜索；翻页动画三样式（平移/覆盖/卷页近似）、横屏双栏；EPUB 导入（spine 结构直建）、URL TXT 导入、书源规则骨架（Legado 子集解析）。MOBI 后置（npm 候选不可靠，见 [phase2-plan §5](docs/design/2026-11-19-phase2-plan.md)）
- [x] **v0.5.1（当前）**：质量收敛——生成热循环 SQLite 逐字段 UPDATE 合并、架构守卫补 hooks 层、EPUB 死代码清理与恢复；问题→issue→修复走 GitHub issue/PR 流程（#21/#22）

### 已发布版本

| 版本   | 主题                                             |
| ------ | ------------------------------------------------ |
| v0.1.0 | 首个 Android 发布（P0–P4 全链路）                |
| v0.1.1 | 工程化收敛（六路评审 / 9 PR / CI 上线）          |
| v0.2.0 | 墨韵纸感 UI + 后台播放 + 章节 MP3 导出           |
| v0.4.0 | 阅读器升级（双模式/翻页动画/横屏双栏/书签/搜索） |
| v0.5.0 | EPUB 导入 + 在线书源骨架                         |
| v0.5.1 | 质量收敛（#21/#22 + 架构守卫 + EPUB 修复）       |

全部 Release 见 [GitHub Releases](https://github.com/hhan593/talecast/releases)。

## 开发与运行

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run：domain 纯逻辑 + 纯函数适配器 + services（in-memory fakes）
pnpm start       # 开发服务器 → 手机装 Expo Go 扫码运行
pnpm web         # Web 预览（播放不支持，见"已知限制"）
```

日常运行（Expo Go，最快验证）：

1. `pnpm start`，终端出现二维码
2. 手机装 Expo Go（App Store / 各应用商店），扫二维码
3. 书架 → 添加书籍 → 导入 UTF-8 TXT / EPUB / URL TXT → 按里程碑流程使用
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

发版产物通过 [GitHub Releases](https://github.com/hhan593/talecast/releases) 分发（APK + SHA256SUMS），不在仓库内保存。

## 已知限制

- **iOS 构建需 Xcode 26+ / Swift 6.2**：Expo SDK 58 的 `expo-modules-jsi` 硬要求；本机 Xcode 16.3（Swift 6.1）无法构建，模拟器/真机包未产出。
- **Web 预览不支持播放**：`react-native-track-player` 为原生模块，Web 端走 noop player，仅可用于 UI 预览。
- **真机最小化验证待用户执行**：P0–P4 的实机验收（双端启动、数据持久化、后台播放、密钥存储）尚未由用户在本机确认。

## 技术栈（概览）

| 层次      | 选型                                                                                                                                   |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 框架      | Expo 58 + React Native 0.88 + React 19 + TypeScript 6（pnpm）                                                                          |
| 路由      | Expo Router（typedRoutes）                                                                                                             |
| 样式      | NativeWind 4 + Tailwind CSS；墨韵纸感设计系统（衬线正文）                                                                              |
| 本地存储  | expo-sqlite（SQLite 为唯一权威状态，数据库 schema v6）                                                                                 |
| 语音生成  | Edge TTS（免费、非官方 WebSocket 协议，按绑定可配 rate/pitch/volume；官方 provider 作为后备位）                                        |
| 文本模型  | 远程 OpenAI 兼容 API（助手与角色抽取）                                                                                                 |
| 阅读器    | 确定性字符偏移分页、滚动/翻页双模式、翻页动画（平移/覆盖/卷页近似）、横屏双栏                                                          |
| 导入格式  | UTF-8 TXT、EPUB（spine 解析，jszip + fast-xml-parser）、URL TXT；MOBI 后置                                                             |
| 播放/导出 | react-native-track-player（后台/锁屏播放）、章节 MP3 导出 + 系统分享                                                                   |
| 架构      | ports & adapters：domain 纯 TS + vitest，平台能力收口 adapters，hooks 为 UI 唯一服务入口；`architecture.test.ts` 编码 3 条依赖方向守卫 |
