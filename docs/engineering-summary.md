# 工程化总结（2026-11-17，v0.1.0 发布后）

## 工具链现状

| 环节 | 现状 | 评价 |
| --- | --- | --- |
| 语言/类型 | TypeScript strict + `pnpm typecheck`（tsc --noEmit） | ✅ 全绿，进质量门 |
| 测试 | vitest（Node 环境）69 用例 / 14 文件；domain 纯函数 + services 用例（in-memory fakes）+ 纯函数适配器 | ✅ 全绿，进质量门 |
| 架构守卫 | `src/architecture.test.ts`：domain 禁入上层、app/components 禁直连 services/adapters、services 禁 import adapters（本轮新增第 3 条） | ✅ 守卫即测试 |
| Lint | `pnpm lint`（expo lint/ESLint）**存在但不在质量门内**；Biome 未用 | ⚠️ 差距：lint 未纳入门 |
| 格式化 | 无 Prettier/Biome 格式门 | ⚠️ 差距（低危） |
| CI | **无 GitHub Actions**——所有质量门只在本地跑 | ⚠️ 最大差距：PR 流程没有机器把关 |
| 构建 | 本地 Gradle/Xcode；Android APK 链路已通（NODE_PATH+ANDROID_HOME+JDK21）；iOS 被 Swift 6.2 工具链阻断 | ✅ / ⚠️ iOS 待 Xcode 26+ |
| 发版 | GitHub Release v0.1.0 + APK + SHA-256；语义化版本手工维护 | ✅ 可用；版本号手工改 app.json |
| 依赖治理 | pnpm v11 + workspace 隔离；依赖清理为人工（本轮 6 个模板死依赖） | ⚠️ 无自动过期检查（Dependabot/Renovate 缺位） |
| 评审流程 | PR 流程本轮首次启用；此前直接推 main | 🆕 刚建立 |

## 质量门清单（当前）

1. `pnpm typecheck`
2. `pnpm test`（含 architecture.test 守卫 3 条规则）
3. 双端构建冒烟（本地；Android 已自动化命令，iOS 依赖工具链）

## 与成熟工程化的差距（按优先级）

1. **CI 缺位**：质量门没有机器执行点，PR 合并前的验证靠执行者自觉 → 建议加 GitHub Actions（typecheck+test，push/PR 触发）
2. **lint 未进门**：ESLint 配置在但不在门内，也未纳入 CI → 与 CI 一起补
3. **发版产物单一**：仅 Android universal APK（103MB）；arm64 拆分（40MB）与 iOS 未自动化
4. **依赖治理**：无自动更新/过期提醒
5. **文档**：docs/plan.md 为单一事实源、docs/review 与 lessons 刚建立——沉淀习惯已开始，需持续

## 结论

工程化基础（类型门、测试门、架构守卫、本地构建链、发版链）已经齐且真实生效；最大缺口是 **CI 执行点** 与 **lint 进门**，两者都是小时级工作量。
