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

## 当前状态（v0.20.1，2026-11-21）

**已发版**。最新版本 [v0.20.1 正式版](https://github.com/hhan593/talecast/releases/tag/v0.20.1)（非预发行），附带可直接安装的 Android APK 与 `SHA256SUMS`。`app.json` 与 `package.json` 版本均为 `0.20.1`，`main` 与 `origin/main` 同步。

质量门（本地 + CI 双重执行）：`pnpm typecheck` 0 错误；`pnpm test` 231 项全绿（36 个测试文件）；`src/architecture.test.ts` 4 条守卫（3 条依赖方向 + 1 条原生补丁保留）；`pnpm lint` 0 错误（179 条既有 warning 待清理）。[CI](.github/workflows/ci.yml) 在 push/PR 上跑 typecheck + test + lint，[release.yml](.github/workflows/release.yml) 在 tag 上构建并发布 APK（版本号与 `android.versionCode` 由 tag 注入）。

### 功能里程碑

- [x] **P0–P4（v0.1.0 / v0.1.1）**：脚手架与数据底座、导入与分章闭环、角色/音色/云端生成、播放与助手、加固；v0.1.1 完成工程化收敛（六路评审 40+ 项发现、27 项行为保持简化、9 个模块修复 PR、CI 上线）。见 [module-assessment.md](docs/module-assessment.md) / [findings](docs/review/2026-11-17-findings.md) / [复盘](docs/knowledge/lessons/2026-11-18-engineering-retrospective.md)
- [x] **v0.2.0**：墨韵纸感设计系统（衬线正文）、后台/锁屏播放（`react-native-track-player`）、章节 MP3 导出与系统分享、按绑定的 TTS 韵律参数（rate/pitch/volume）、书架三列网格视图
- [x] **v0.3–v0.5.0**：手动阅读模式完整落地——滚动/翻页双模式、确定性字符偏移分页、字号四档、横屏、边听边读跟随、书签、全文搜索；翻页动画三样式（平移/覆盖/卷页近似）、横屏双栏；EPUB 导入（spine 结构直建）、URL TXT 导入、书源规则骨架（Legado 子集解析）。MOBI 当时后置（npm 候选不可靠，见 [phase2-plan §5](docs/design/2026-11-19-phase2-plan.md)），v0.14.0 以自研 PalmDOC LZ77 解码补上
- [x] **v0.5.1**：质量收敛——生成热循环 SQLite 逐字段 UPDATE 合并、架构守卫补 hooks 层、EPUB 死代码清理与恢复；问题→issue→修复走 GitHub issue/PR 流程（#21/#22）
- [x] **v0.5.2–v0.5.3**：添加书籍创建弹窗与详情页跳转、书架交互补齐
- [x] **v0.6.0–v0.9.0**：阅读体验升级（主题/排版/连播/文本净化/搜索）、阅读统计 + JSON 备份 + EPUB 封面、交互与排版进阶、对话式多语音 TTS（按角色与归属分配音色）
- [x] **v0.10.0–v0.14.0**：快赢清零与安全加固、阅读器体验周、划线与笔记、听书增强、书架标签/筛选/排序 + EPUB 封面抽取 + 中英双语 + 自研 MOBI/AZW3 导入（PalmDOC LZ77）
- [x] **v0.16.0–v0.16.2**：统一代码审查闭环（16 个 issue 全走 PR）、睡眠渐弱竞态与 MOBI 解码公式/LLM 归属段落修正、RN 0.88 新架构启动崩溃热修（`react-native-track-player` pnpm 补丁 + 守卫测试）
- [x] **v0.17.0–v0.17.2**：TXT 导入编码放宽（BOM 优先 + 自动识别 + 手动指定）、Edge TTS 迁移 Sec-MS-GEC v2 令牌（音色列表恢复）、内置离线音色兜底 + 旁白自动绑定（不再要求先跑 LLM 抽取）、i18n 架构修复与全量英文化
- [x] **v0.18.0–v0.18.1**：阅读器设置面板重构（底部四 Tab：目录/进度/排版/听书，顶栏瘦身）、书架常驻搜索框；点正文显隐工具条、安全区与分页高度修正
- [x] **v0.19.0–v0.19.1**：阅读器面板重构（#64）——顶栏单行 / 底栏翻页行 + 目录·书签·夜间·设置四入口进流、底部升起设置面板（亮度·护眼·字号·背景色点·翻页动画）、听书改悬浮球；顺带修复 `reading_state` 违反 NOT NULL 导致阅读位置/模式/字号从未落库
- [x] **v0.20.0（当前）**：UX 体验批次（#59–#66 全闭环）——专属应用图标（#59）、书架左抽屉（#62）、导入 TXT 静默化（#63）、详情页精简 + 右侧抽屉（#65）、设置页四组分区重构（#60）、助手对话式 UI 重做（#66）、书源导入分析界面（#61）、App 内更新检查（#58 P1）；阅读器滚动模式收尾——尾部空白全区域可点 + 段级位置恢复（#64）

### 已发布版本

| 版本   | 主题                                             |
| ------ | ------------------------------------------------ |
| v0.1.0 | 首个 Android 发布（P0–P4 全链路）                |
| v0.1.1 | 工程化收敛（六路评审 / 9 PR / CI 上线）          |
| v0.2.0 | 墨韵纸感 UI + 后台播放 + 章节 MP3 导出           |
| v0.4.0 | 阅读器升级（双模式/翻页动画/横屏双栏/书签/搜索） |
| v0.5.0 | EPUB 导入 + 在线书源骨架                         |
| v0.5.1 | 质量收敛（#21/#22 + 架构守卫 + EPUB 修复）       |
| v0.5.2–v0.5.3 | 添加书籍弹窗、书架交互补齐                 |
| v0.6.0 | 阅读体验升级（主题/排版/连播/净化/搜索）         |
| v0.7.0 | 阅读统计 + JSON 备份 + EPUB 封面                 |
| v0.8.0 | 交互补齐 + 排版进阶                              |
| v0.9.0 | 对话式多语音 TTS                                 |
| v0.10.0 | 快赢清零 + 安全加固                             |
| v0.11.0 | 阅读器体验周                                    |
| v0.12.0 | 划线、笔记与标注                                |
| v0.13.0 | 听书增强                                        |
| v0.14.0 | 书架标签/筛选/排序 + 中英双语 + MOBI/AZW3 导入    |
| v0.16.0 | 统一代码审查闭环（16 issue 走 PR）               |
| v0.16.1 | 睡眠渐弱竞态 + MOBI 解码 + LLM 归属修正          |
| v0.16.2 | Android 启动崩溃热修（RN 0.88 新架构）           |
| v0.17.0 | TXT 导入编码放宽（多编码自动识别）               |
| v0.17.1 | Edge TTS v2 令牌 + 离线音色兜底 + i18n 修复      |
| v0.17.2 | 残留写死文案本地化                               |
| v0.18.0 | 阅读器设置面板重构 + 书架搜索                    |
| v0.18.1 | 点正文显隐工具条 + 状态栏/手势条安全区修复       |
| v0.19.0 | 阅读器面板重构：底栏四入口 + 设置面板 + 悬浮球   |
| v0.19.1 | 阅读位置/模式/字号持久化修复                     |
| v0.20.0 | UX 体验批次：图标/书架抽屉/详情页精简/设置重构/助手重做/更新检查 |
| v0.20.1 | 实机反馈修复：横屏门控/听书透错/阅读器交互重做（#88–#90） |

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
3. 书架 → 添加书籍 → 导入 TXT（自动识别编码，可手动指定）/ EPUB / URL TXT → 按里程碑流程使用
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
| 本地存储  | expo-sqlite（SQLite 为唯一权威状态，数据库 schema v8）                                                                                 |
| 语音生成  | Edge TTS（免费、非官方 WebSocket 协议，按绑定可配 rate/pitch/volume；官方 provider 作为后备位）                                        |
| 文本模型  | 远程 OpenAI 兼容 API（助手与角色抽取）                                                                                                 |
| 阅读器    | 确定性字符偏移分页、滚动/翻页双模式、翻页动画（平移/覆盖/卷页近似）、横屏双栏                                                          |
| 导入格式  | TXT（UTF-8 / UTF-16 / GB18030 / Big5 / Shift_JIS / Windows-1252，BOM 优先 + 自动识别 + 手动指定）、EPUB（spine 解析）、URL TXT；MOBI 另见导入 |
| 播放/导出 | react-native-track-player（后台/锁屏播放）、章节 MP3 导出 + 系统分享                                                                   |
| 架构      | ports & adapters：domain 纯 TS + vitest，平台能力收口 adapters，hooks 为 UI 唯一服务入口；`architecture.test.ts` 编码 4 条守卫 |
