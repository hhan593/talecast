# 个人有声书制作 App（移动版）计划书

文档状态：草案 v4，待确认后开工
日期：2026-11-16

> v2 在 v1 基础上吸收评审意见修订，逐条变更见第 0 节。
> v3：主力 TTS provider 定为 **Edge TTS**，相关条目随决策更新。
> v4：架构评审修订——ports/组合根/编排层补全 DIP、幂等回执独立、路由树补全（见 0.1）。

## 0. v1 → v2 变更记录

| # | 变更 | 原因 |
| --- | --- | --- |
| 1 | 生成幂等从 job 级下沉到**段级**：新增 `generation_segments` 表，`input_hash` 组成显式定义 | "同 input_hash 重试返回原结果"只对完成态 job 成立；中途失败重试会整章重复计费 |
| 2 | 取消音频合并，改为**分段文件 + 播放队列** | WAV/MP3 拼接（重写头/帧对齐）是纯复杂度；段队列让正文高亮退化为段索引 |
| 3 | 流式网络改用 **`expo/fetch`** | RN 全局 fetch 基于 XHR，不支持响应体 ReadableStream，助手流式无法实现 |
| 4 | `chapters` 由 UTF-8 字节偏移改为**解码文本字符偏移** | TS 字符串是 UTF-16；字节切片会劈开多字节字符，且处处要做 byte↔char 转换 |
| 5 | 播放库明确为 **expo-audio** | expo-av 已废弃（SDK 52 起），不保留备选 |
| 6 | 角色抽取改为 **LLM 优先、规则兜底** | 中文人名纯规则识别基本无效，规则只留给旁白/对话切分 |
| 7 | 新增 **5.4 测试策略** | domain 纯 TS 必须配套测试；延续"宿主验证结果"哲学 |
| 8 | domain 新增 `segmenter.ts`（TTS 分段器） | 段是幂等与计费单元，切段必须确定性输出，text_hash 才能稳定 |
| 9 | 新增 `reading_state` 表 | 阅读位置与播放位置需要权威落点，与"单一权威来源"约定配套 |
| 10 | P2 前置约束：开工前敲定一家主力 TTS provider | 各家中文质量/字数上限/音频格式/计费差异大，provider 抽象需要靶子 |
| 11 | 产品新增**单段试听**，试听音频可复用进整章任务 | 按字数计费；先确认听感再生成整章，避免最贵的返工 |
| 12 | 播放器实现约束：全局单例，不挂在屏幕组件上 | 满足 P3"播放中切页不中断"验收 |

### 0.1 v3 → v4 变更记录（架构评审修订）

| # | 变更 | 原因 |
| --- | --- | --- |
| 13 | 补全依赖倒置：**端口接口定义在 domain（`ports.ts`），adapters 实现接口**，`src/container.tsx` 组合根装配 | 只写"domain 不 import Expo"没有写接口归属，第一次写仓储就会被 `import { db } from adapters` 绕过，纯净约束名存实亡 |
| 14 | 新增 **`src/services/`（用例编排）与 `src/hooks/`（UI 唯一服务入口）** 层 | 事务/幂等/队列推进需要可测试的编排层，否则散进组件或 sqlite.ts；组件直连 adapter 会绕穿"平台能力收口"约束 |
| 15 | SRP 修正：幂等回执从 jobs.ts 独立为 **`domain/commands.ts`**；audio.ts 只留能力封装，队列编排上移 services | 回执是横切机制（分章采用/角色确认/绑定修订都用）；adapter 与编排混在一起无法 mock 测试 |
| 16 | 路由树补全 + 收敛为**书架/设置双 Tab** + 两条路由原则（见 5.5） | "制作" Tab 是模式不是地点，无工程时无路由意义；候选审阅、角色中心等 MVP 承诺页面缺路由落点 |

## 1. 项目定位

做一个**从零开始的移动端有声书制作 App**，目标是把一本本地小说文本变成可以听的章节音频，并保留人对制作过程的最终决定权。

产品上的核心信念借鉴自 CastGlean，但不复制它的代码、UI 或桌面架构：

- 原文不可变：导入后按哈希保存原始字节和解码文本，任何编辑都不改写来源。
- 冻结输入：分析/生成任务开始时锁定来源哈希、章节范围和版本，输入变了就不续跑旧结果。
- 候选而非直改：模型只提出分章、角色、音色等建议，界面审阅后人工采用。
- 人工保护：用户确认的角色身份、音色绑定和声音画像不被模型建议覆盖。
- 幂等与可恢复：命令带 command id 和 expected revision；生成任务**按段**持久化与缓存，重进应用可恢复，重试不重复计费。
- 护栏：按段请求、按段缓存；整章生成前先单段试听确认听感（Edge TTS 免费，护栏对象是体验而非费用）。

不追求在手机上复刻桌面工作台。移动端只做适合手指和碎片时间的纵向流程。

## 2. 已确认约束与决策

| 项目 | 决定 |
| --- | --- |
| 代码来源 | 全新仓库，不依赖、不移植 CastGlean 的代码 |
| 桌面端 | 不做，不预留桌面适配层 |
| 语言/运行时 | 不用 Rust |
| 目标平台 | iOS + Android，一套代码 |
| 阶段目标 | 先做可验证的快速原型，不做完整商业产品 |
| 语音生成 | 云端 TTS 优先，端侧模型不在本期 |
| 主力 provider | **Edge TTS**（免费、无 Key、非官方 WebSocket 协议）；豆包作为官方后备实现位，本期不实现 |
| 文本模型 | 远程 OpenAI 兼容 API，用于助手和可选分析 |
| 数据存储 | 应用内 SQLite + 沙盒文件，不依赖自建后端 |
| 包管理器 | pnpm |

## 3. 技术选型

### 3.1 首选方案

| 层次 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | Expo SDK + React Native + TypeScript | 一套代码覆盖双端，Expo Go 可先跑起来；EAS Build/Update 解决构建和 OTA |
| 路由 | Expo Router | 文件路由，适合快速搭出书架、工程、设置等页面 |
| 样式 | NativeWind（Tailwind 写法）+ 少量自建组件 | 上手快，样式表达力强；不引入重型组件库 |
| 本地库 | expo-sqlite | 直接写 SQL，够原型使用；后续可加 drizzle-orm |
| 文件 | expo-document-picker + expo-file-system | iOS Files / Android SAF 导入，沙盒内持久化 |
| 哈希 | expo-crypto | SHA-256 校验来源身份与段幂等 |
| 密钥 | expo-secure-store | 存 API Key；绝不明文写进 SQLite |
| 播放 | expo-audio | 本地段文件播放与进度回调，前台够用（expo-av 已废弃，不使用） |
| 网络（LLM/SSE） | `expo/fetch` + EventSource | SDK 52+ 内置，WinterCG 兼容、支持响应体流式；RN 全局 fetch 不支持 ReadableStream |
| 网络（TTS） | RN 原生 WebSocket（Edge 协议） | Edge TTS 是 WebSocket 协议，RN 内置 WebSocket 直接可用；协议实现参考 edge-tts / edge-tts-universal，不引入 Node 依赖 |
| 状态 | React Context / Zustand 仅存界面态 | 权威业务状态一律以 SQLite 为准 |
| 组合根 | React Context Provider 注入 services（`src/container.tsx`） | 轻量依赖注入，不引 DI 框架 |
| 测试 | Vitest（domain）+ 录制 fixture（cloud adapters） | domain 纯逻辑可跑原生 Node；协议测试不真实计费 |

### 3.2 为什么不选其他方案

- **Flutter**：UI 一致性和列表性能更好，但要新学 Dart，原型速度不如 Expo + TS。作为未来重写的备选，不用于本期。
- **Capacitor**：优势是复用现成 Web 代码；新仓库没有可复用资产，而 WebView 的性能上限和原生配置成本仍在。
- **Tauri Mobile**：仍然依赖 Rust，且移动端生态不如桌面成熟。
- **纯 PWA**：iOS 文件访问、后台任务和模型/音频缓存都不可靠。
- **Kotlin/Compose Multiplatform**：双端质量高，但技术栈跨度大，不适合快速验证。

## 4. 产品范围

### 4.1 本期 MVP 主链

1. 书架：创建工程、列出本地工程、打开后恢复上次阅读位置。
2. 导入：从系统文件选择器导入 UTF-8 TXT，冻结原始字节，计算双哈希，保存不可变副本。
3. 分章：本地规则检测标题和起点，生成候选目录；人工改标题、调边界、增删章节；采用后写入工程 revision。
4. 角色与音色：**LLM 抽取**角色候选与归属（台词/内心独白归属旁白或角色），人工确认；规则只做旁白/对话切分兜底。给旁白和角色绑定 Edge TTS 内置音色（voices/list 拉取中文音色清单，选多语种音色应对中英混排）。
5. 生成：对已分析、已绑定的章节发起云端 TTS。**segmenter 确定性分段**，逐段请求、段音频逐段落盘缓存；失败重试只补缺失段；支持**单段试听**（不建任务、直接合成一段确认音色听感，试听音频在整章任务中按 text_hash 复用）。显示真实进度。
6. 播放：**段队列顺序播放**，正文按当前段高亮，可暂停、拖动、切章继续；播放中切页不中断。
7. 助手：单一工程助手会话，SSE 流式回答；分章/分析请求产出候选，不直接改工程。

### 4.2 明确不做

- 模型下载、模型中心、端侧 TTS 推理。
- 参考录音设计音色、音色包导入导出。
- WAV 导出、音频合并/拼接、多轨编辑、逐字波形对齐。
- 跨段字节级选区；首版只做段落/整章级交互。
- 后台生成、后台续跑；只保证前台任务与重进恢复。
- 128 MiB / 一万章这类大容量目标；首版给出更小的明确上限。
- 非 UTF-8 中文编码（GB18030/GBK）；首版明确拒绝并提示用户转码。
- 账号系统、云同步、协作、付费。

## 5. 架构设计

### 5.1 分层

```
app/                       Expo Router 页面与布局（完整路由树与原则见 5.5）
src/domain/                纯 TypeScript，不 import 任何 Expo/RN/上层代码；*.test.ts 就地存放，vitest 运行
  types.ts                 实体类型集中；模块间只 import 类型，防循环依赖
  ports.ts                 端口接口：仓储、TtsGateway、AudioPlayer、KeyStore 等，由 adapters 实现
  commands.ts              命令与幂等回执（command_receipts，横切：分章/角色/绑定/生成共用）
  result.ts                命令结果类型（Ok/Err：忙、失败、校验不通过）
  source.ts                不可变来源、哈希、修订
  split.ts                 分章规则与候选结构
  segmenter.ts             TTS 分段器：按句/长度切，受 provider 字数上限约束，确定性输出（同输入同段序同文本）
  review.ts                候选审阅、采用、撤销
  binding.ts               角色与音色绑定、人工保护
  jobs.ts                  生成任务状态机、input_hash 构成、段级推进规则
  playback.ts              段队列推导与段内进度 → 正文高亮映射
src/adapters/              平台能力，只有这里 import Expo/RN/网络 API；实现 domain/ports.ts 的接口
  sqlite/                  SQLite 初始化、migration 与仓储实现
  files.ts                 导入、复制、哈希校验、路径推导
  secure-store.ts          密钥读写（KeyStore 实现）
  audio.ts                 expo-audio 能力封装：加载段文件、播放/暂停/进度回调（无队列编排）
  cloud-tts.ts             Edge TTS WebSocket 协议实现 + provider 抽象（后备位）；输出统一 mp3/24kHz/mono；含音色列表拉取
  cloud-llm.ts             远程文本模型与 SSE（expo/fetch）
src/services/              用例编排（薄层，每用例一函数）：事务、幂等回执、段队列推进、重试调度；只依赖 domain 与 ports
  playback-service.ts      播放编排全局单例：队列推进、进度写 reading_state、错误恢复
src/hooks/                 useProject / usePlayback / useGeneration 等 —— UI 的唯一服务入口
src/container.tsx          组合根：唯一实例化 adapters、装配 services；导出 ServicesProvider 与 useServices()
src/components/            可复用 UI 组件（不直接 import adapters/expo，只用 hooks）
```

`src/domain/` 保持纯净是关键约束：它承载从参考项目借鉴来的规则，未来换 UI、换 TTS provider 或加端侧推理时都不用重写。

依赖方向唯一：`app → hooks → services → domain ← adapters`（adapters 与 domain 互不依赖，各自依赖 domain 中的 ports/types）；`container` 依赖所有层但只做装配，是唯一的实例化点。组件不直接 import adapters/expo——"平台能力只有 adapters 触碰"由 hooks 这层入口保证。

### 5.2 数据模型（SQLite）

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `projects` | id, title, description, revision, created_at, updated_at | 工程元数据与乐观并发修订 |
| `sources` | id, project_id, filename, encoding, raw_sha256, text_sha256, byte_size | 不可变来源；文件放 `sources/<sha>.raw` 与 `<sha>.txt` |
| `chapters` | id, project_id, source_id, title, start_offset, end_offset, volume, ordinal, heading_line | 半开**字符偏移**（基于 sources 的解码文本），分区不重叠；raw 字节仍保留用于身份校验 |
| `chapter_edits` | id, project_id, chapter_id, kind, payload_json, revision | 人工修正，来源正文不变 |
| `split_proposals` | id, project_id, revision, payload_json, status, created_at | 分章候选；采用须显式命令 |
| `characters` | id, project_id, name, aliases_json, profile_json, manual_protected | 角色身份与人工保护标记 |
| `voices` | id, name, provider, provider_voice_id, description | 只存 Edge TTS 音色；provider_voice_id = short name（如 zh-CN-XiaoxiaoNeural）；本地不存模型 |
| `bindings` | id, project_id, target_type, target_id, voice_id, revision | 旁白/角色到音色的绑定 |
| `generation_jobs` | id, project_id, chapter_id, status, provider, input_hash, progress, error, created_at, updated_at | 生成任务；`input_hash` 组成见 5.3 |
| `generation_segments` | id, job_id, ordinal, text, text_hash, status, file_path, error, updated_at | **幂等与计费单元**；status ∈ pending/generating/done/failed；done 段重试直接复用文件，零请求零计费 |
| `reading_state` | project_id (PK), chapter_id, char_offset, audio_segment_ordinal, audio_offset_ms, updated_at | 阅读与播放位置的单一权威落点 |
| `assistant_sessions` | id, project_id, task_kind, chapter_id | 单一工程助手会话 |
| `assistant_messages` | id, session_id, ordinal, role, parts_json, version | 流式消息与版本 |
| `command_receipts` | command_id, result_json | 幂等回执，防止重复提交；机制定义在 domain/commands.ts（横切） |

版本升级策略：用 `user_version` 标识结构版本。原型阶段遇到不兼容版本直接拒绝并提示，不做自动迁移、不删除用户数据。

### 5.3 关键流程约定

- **导入**：选择文件 → 复制到应用文档目录 → 计算原始字节与 UTF-8 文本双哈希 → 校验 UTF-8（`TextDecoder('utf-8', { fatal: true })`）→ 发布不可变文件 → 同一事务写 `sources` 和初始 `chapters`。解码后的全文是 chapters 字符偏移的基准。确认前的文件只放在临时区，不承诺跨进程恢复。
- **分章**：本地正则给出候选 → 生成 `split_proposals` → 用户审阅 → 采用时在单事务更新 chapters、edits、revision 和 command receipt；撤销只回退目录，不改来源。
- **生成**：
  - `input_hash = SHA-256(章节文本哈希 + 绑定 revision + voice_id + provider + 请求参数 + 音频格式 + segmenter 版本)`。任何一项变化都会产生新 job，旧缓存不会被误用。
  - 前置检查（章节已分析、已绑定音色、无活动 job）→ 创建 job；相同 `input_hash` 已存在则直接返回该 job（幂等）。
  - `segmenter` 确定性切段 → 逐段处理：`text_hash = SHA-256(段文本 + voice_id + provider + 参数)`；命中 done 段直接复用文件，未命中才请求 provider。
  - 段完成即落库（status/file_path）；全部完成 job 进入终态。
  - 失败重试：只请求缺失/失败段；已完成段零请求、零计费。
  - 单段试听：不建 job，按段直接请求并写暂存文件；发起整章 job 时该段 `text_hash` 命中，试听音频直接转为正式段缓存。
  - provider 请求锁定统一采样率/声道/音频格式，保证段间播放衔接平滑。
  - Edge 协议要点：WebSocket + `Sec-MS-GEC` 令牌（时间戳哈希，expo-crypto 可计算）→ 发送 speech.config 与 SSML 两段文本消息 → 接收二进制音频帧至 `turn.end`；输出锁定 `audio-24khz-48kbitrate-mono-mp3`；段文本上限按社区实践 ≤2000 字符，由 segmenter 约束；无 Key、无计费，请求按串行/低并发处理，流中附带的 wordBoundary 词级时间戳本期不消费（演进方向留存）。
- **播放**：段队列编排为 services 层全局单例（不挂在屏幕组件上），expo-audio 封装在 adapter，屏幕只经 hooks 订阅状态；位置权威来源是 `reading_state`；正文高亮 = 当前段 ordinal + 段内毫秒进度（段内不逐字对齐）；段队列顺序衔接，不重采样、不改格式。
- **助手**：所有任务共用同一会话；`expo/fetch`/EventSource 按会话序号写入，重连从 SQLite 历史恢复；工具产出候选，采用仍走显式命令。

### 5.4 测试策略

- **domain**：vitest 纯逻辑测试，重点覆盖分章规则、segmenter 确定性（同输入同段序）、jobs 段级推进、commands 幂等回执、review 采用/撤销、binding 人工保护不被覆盖。
- **services 编排**：用 domain ports 的 in-memory fake 驱动用例测试（事务边界、幂等回执、队列推进），不碰真 SQLite。
- **cloud adapters**：录制 fixture（固定请求/响应样本）驱动协议测试；Edge adapter 用录制的 WebSocket 帧（含 Sec-MS-GEC 构造）先录样本再实现；豆包等官方 provider 接入时同样先录样本。
- **采用/撤销路径必须有测试**：候选改写正式数据的每条命令（分章采用、角色确认、绑定修订）都要覆盖幂等与撤销。
- 本地检查：`pnpm vitest` + `pnpm tsc`；RN/Expo 依赖不进入 domain 测试环境。

### 5.5 路由设计

两条原则：

1. **路由只承载资源位置与 id**：屏间只传 `projectId`/`characterId` 等标识，正文与业务数据一律从 SQLite 读取——与"SQLite 唯一权威"是同一条原则的两面。
2. **资源进路由，瞬时状态不进**：工程/角色/候选审阅是资源或人工关口，占用路由位；章节切换、目录展开、助手面板开合是工作台内部状态（`reading_state` + zustand），不进 URL；语音选择等瞬时选择用 bottom sheet 组件，不占路由。

```
app/
  _layout.tsx                 根：ServicesProvider、主题、错误边界
  (tabs)/
    _layout.tsx               底部 Tab：书架 / 设置（双 Tab；"制作"经书架打开工程进入）
    index.tsx                 书架（工程列表）
    settings.tsx              设置（LLM 密钥、用量、能力边界文案）
  project/
    [id]/
      _layout.tsx             工程外壳：数据加载、不存在/错误空状态收口
      index.tsx               章节工作台（目录+正文+助手；章节切换为内部状态）
      characters/
        index.tsx             角色中心（列表、人工确认）
        [characterId].tsx     角色详情（绑定、建议对照）
      review.tsx              候选审阅（presentation: modal；分章/角色候选共用）
  +not-found.tsx              兜底空状态
```

说明：`project/[id]/_layout` 收口加载/错误态，内部屏幕假定数据已就绪；`review` 用 modal 路由，因为它是明确的人工关口——审阅可随时取消，系统返回键语义与"撤销"一致；`project/[id]` 位于 tabs 组之外（无 tab bar，沉浸式）。

## 6. 里程碑与验收

### P0：脚手架与数据底座

交付：Expo 工程、Expo Router 骨架（按 5.5 路由树）、NativeWind 配置、SQLite 初始化与 migration、分层骨架（domain/adapters/services/hooks/container 边界与 ports 定义）、vitest 就位并跑通首个 domain 测试、`expo/fetch` SSE 冒烟（连测试端点收到流式事件）、EAS 配置。
验收：Expo Go 在 iOS/Android 都能启动；建库并写入一条测试工程，重启后数据仍在；SSE 冒烟通过；`pnpm vitest` 与 `pnpm tsc` 通过。

### P1：导入与分章闭环

交付：文件选择器导入 UTF-8 TXT、双哈希与不可变副本、分章规则（字符偏移）、候选审阅 UI、采用/撤销。
验收：导入示例小说后重启可恢复；采用候选后 revision 推进；撤销后目录回到上一版；原始文件字节未改。

### P2：角色、音色与云端生成

前置：Edge TTS adapter 已按 5.4 用录制帧 fixture 通过协议测试。
交付：LLM 角色候选与人工确认、Edge 音色列表（voices/list）、绑定、Edge TTS 适配、segmenter 与段级生成任务、单段试听、真实进度、失败只补缺失段。
验收：为已绑定章节生成音频；中断/失败重试的 provider 请求数等于缺失段数（不重复计费，可用请求日志验证）；试听段转正为正式段缓存；断网/接口失败给出明确错误且已完成段音频可用。

### P3：播放与助手

交付：全局播放服务（services 层段队列编排）、正文按段跟随高亮、单一助手会话、SSE 流式消息、历史分页。
验收：播放中切页不中断；拖动进度/切章后高亮跟随；助手产出分章候选后必须人工采用才生效。

### P4：加固

交付：Secure Store 接密钥、错误与空状态、明确的能力边界文案、请求用量展示、最小化真机验证。
验收：密钥不出现在数据库和日志；无网络、无密钥、无章节、无音色绑定等状态都有明确提示。

## 7. 风险与应对

| 风险 | 应对 |
| --- | --- |
| Edge TTS 是非官方接口，可能失效、变更或限流 | 个人原型、非商用定位；provider 抽象使官方后备（豆包）只需新增一个 adapter；协议变更跟随 edge-tts 社区（Sec-MS-GEC 令牌） |
| `expo/fetch` 与标准 fetch 行为差异 | P0 SSE 冒烟验证；网络细节全部封装在 adapters，domain 不感知 |
| GB18030/GBK 编码无法解码 | 首版只接受 UTF-8，导入时用明确文案拒绝并建议转码；后续再评估 JS 解码库或原生模块 |
| iOS 切后台后任务中断 | 不承诺后台生成；任务与段状态持久化，重进恢复；音频后台播放留到后续用 track player 解决 |
| 原文发送到第三方 TTS（微软） | 设置页明示"文本会发送给服务商"；记录请求次数与失败原因；有顾虑时切换官方 provider |
| API Key 泄露（仅 LLM 需要 Key，TTS 无 Key） | 只存 Secure Store；不打印、不写日志、不进 SQLite |
| 长文本列表卡顿 | 章节按页读取，FlatList 虚拟化；不在 JS 里重复拼接整章字符串 |
| 音频占内存 | 用段文件路径播放，不把音频读进 JS；波形峰值摘要后置 |
| EAS / iOS 分发成本 | 开发期用 Expo Go；EAS Build 验证双端；真机分发所需 Apple 开发者账号后置 |
| 端侧 TTS 未来接入 | domain 与 provider 解耦；新增 on-device provider 不需要改业务流程 |

## 8. 本期之后的演进方向（不在计划内）

- 接入端侧小模型 TTS（Core ML / ONNX Runtime Mobile），与云端 provider 并存。
- 接入官方 provider（豆包/百度）作为后备与质量升级路径。
- 参考录音设计音色、音色资产包、WAV 导出与音频合并。
- 更细粒度的文本标注与逐字播放高亮（Edge 协议自带 wordBoundary 词级时间戳，可低成本利用）。
- 端到端加密或自托管 TTS 网关，降低第三方文本外发顾虑。

## 9. 下一步

确认本计划后，第一件事是搭 P0 骨架，只包含：

1. Expo + TypeScript + Expo Router + NativeWind 初始化（pnpm）。
2. `src/domain` / `src/adapters` 目录与类型接口，vitest 就位。
3. SQLite 建表与 `user_version` 检查。
4. `expo/fetch` SSE 冒烟验证。
5. EAS 配置与最小可运行页面。

再按 P1 → P2 → P3 推进，不提前引入模型、音频导出或后台任务。主力 provider 已定为 Edge TTS；若 Edge 失效，按风险表切换官方后备。


---

## 交付状态（2026-11-20，v0.18.0）

本计划已按 P0→P4 完整交付并发布 v0.1.0；随后完成一轮六路评审（复用/质量/效率/结构/测试价值/注释），27 项行为保持简化与 9 项模块修复经 PR 流程合入（CI 已上线）。发现与复盘：docs/review/2026-11-17-findings.md、docs/knowledge/lessons/2026-11-18-engineering-retrospective.md。演进方向见本文件第 8 节。

计划外的能力（均已发布，逐版明细见 [README 功能里程碑](../README.md#功能里程碑)）：阅读器双模式/翻页动画/横屏双栏/书签/全文搜索（v0.3–v0.5）、墨韵纸感设计系统与后台锁屏播放 + 章节 MP3 导出（v0.2）、阅读统计/JSON 备份/划线笔记/听书增强（v0.7–v0.13）、书架标签筛选排序与中英双语、自研 MOBI/AZW3 导入（v0.14）、统一审查闭环 16 个 issue（v0.16）、TXT 多编码导入与 Edge TTS v2 令牌迁移 + 离线音色兜底（v0.17）、阅读器设置面板重构与书架搜索（v0.18）。

与计划原约束的两处偏离，均为用户确认后放宽：

| 原约束 | 现状 | 说明 |
| --- | --- | --- |
| 4.2 "非 UTF-8 中文编码（GB18030/GBK）首版明确拒绝" | 已支持 GBK/GB18030/Big5/Shift_JIS/UTF-16 等，BOM 优先 + 自动识别 + 手动覆盖 | v0.17.0，用户要求放宽 |
| 4.1 生成前置"已分析、已绑定" | 旁白未绑定时自动绑定默认音色（`zh-CN-XiaoxiaoNeural`），LLM 角色抽取降为可选增强 | v0.17.1，前置条件无产品价值；内置离线音色目录保证断网可用 |

当前质量门：`pnpm typecheck` 0 错误、`pnpm test` 214 项（34 文件）、`pnpm lint` 0 错误、`architecture.test.ts` 4 条守卫；CI 与 Release 两条工作流均已上线（tag 触发构建并注入版本号）。

已知待办：`src/services` 与 `src/domain` 中约 83 条中文错误文案仍直接透出到界面，需改为错误码 + 文案表映射。
