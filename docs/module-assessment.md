# 模块评估（2026-11-17）

评估基准：docs/plan.md 5.1（ports & adapters 分层）、src/architecture.test.ts 守卫、11 个提交的共变证据。

## 逐模块

| 模块 | 职责 | 依赖方向 | 结论 |
| --- | --- | --- | --- |
| `src/domain` | 纯 TS 规则（哈希/分章/分段/候选/回执/Result）+ ports + contracts | 零外部 import（守卫规则 1） | ✅ 合理 |
| `src/adapters` | 平台触点（SQLite/files/Edge/LLM/secure-store/audio）；ports 实现 | 只被 container 装配；repos→db.ts 类型依赖为顺序迁移内在属性 | ✅ 合理；repos 文件粒度待改进（见 M-5） |
| `src/services` | 用例编排（命令+回执+事务语义） | 依赖 domain/ports（守卫规则 3 本轮新增） | ✅ 合理；读章节切片三处重复（M-1） |
| `src/hooks` | UI 唯一服务入口 | services→hooks 方向正确 | ✅ 合理；guarded-run 样板重复（M-2） |
| `src/container` | 组合根，唯一实例化点 | 依赖所有层但只装配 | ✅ 合理 |
| `app/` | Expo Router 页面 | 经 hooks 消费（守卫规则 2） | ✅ 合理；工作台三视图单文件 522 行（M-8） |
| `src/services/fakes.ts` | 测试桩（端口内存实现） | 仅测试消费 | ⚠️ 585 行单文件，应按端口家族拆目录（M-6） |

## 耦合点与共变证据

- `fakes.ts ↔ ports.ts`：最强跨目录共变对（7/7 次变更）——端口演进必然同步改 fake，家族拆分后落点可预期（M-6）
- `app/project/[id]/index.tsx`：最高频变更文件（8/11 提交），三条互不相关的变更轴（助手/播放/目录）压在同一文件（M-8）
- `repos/*.ts → db.ts`：顺序迁移的内在共变，**非缺陷**（不建议拆 DDL）
- `services ↔ adapters`：经 contracts.ts 常量层解耦 + 守卫规则 3，方向健康

## 问题清单（阶段 3 工作分解，编号即 PR 引用）

| # | 问题 | 影响 | 建议修法 | 模块 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M-1 | 读章节切片三处复制（generation/reading/playback 各自 listChapters→getSource→readDecodedText→slice） | 核心不变量口径漂移风险 | library-query 增 `readChapterSlice`，三处调用 | services | 待修 |
| M-2 | use-generation 与 use-library/use-proposal 各自复制 busy/error/finally 脚手架 | hooks 层样板膨胀 | 文件内 guarded-run 助手（use-library/runCommand 同法） | hooks | 待修 |
| M-3 | `getProgress` 轮询每 800ms 拉全部段文本（含 text 列），UI 不消费 | 生成期间持续的 IO/内存放大 | 轮询去段表；`GenerationProgress.segments` 删除；测试改走 `generationStore.listSegments` | services/generation | 待修 |
| M-4 | `readDecodedText` 无缓存：不可变内容寻址文件被 6 场景反复全文读取+解码 | 16MB 书 = 每次操作 16MB IO+decode；assistant 每条消息都读 | store 内最小 memo（Map<sha,text>） | adapters/files | 待修 |
| M-5 | `repos/generation.ts` 一文件四仓储；`repos/misc.ts` 名实不符 | 命名误导、家族口径断裂 | 拆 voices/characters/bindings/generation 四文件；misc→reading-state | adapters/sqlite | 待修 |
| M-6 | `fakes.ts` 585 行单文件聚合 15 个 fake | 端口演进必命中整文件 | 拆 `fakes/` 目录按端口家族 + barrel | tests | 待修 |
| M-7 | `previewSegment` 为取首段构建整章分段计划并全量哈希 | 一次性几十 ms（低危） | 首段即停变体 | services/generation | 待修 |
| M-8 | 工作台三视图单文件（目录/正文/助手，522 行） | 三条变更轴互相踩踏 | 正文/助手视图提取为 `components/workbench/` 纯展示组件 | app | 待修 |
| E-1 | 无 CI：质量门只在本地跑 | PR 合并前无机器验证 | GitHub Actions：push/PR 跑 typecheck+test | 工程化 | 待修 |

状态在阶段 3 每合并一个 PR 后更新为 ✅ 已修复（<PR 链接>）。
