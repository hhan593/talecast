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

- [~] P0：脚手架与数据底座——代码就绪（Expo + Expo Router + NativeWind + SQLite 迁移 + ports/adapters 分层骨架，15 项 vitest 通过、tsc 与 iOS bundle 构建通过）；**待 Expo Go 双端启动与数据持久化验收**
- [ ] P1：导入与分章闭环
- [ ] P2：角色、音色与云端生成（Edge TTS）
- [ ] P3：播放与助手
- [ ] P4：加固

## 开发

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest：domain 纯逻辑 + 纯函数适配器（SSE 解析）
pnpm start       # Expo Go 扫码真机运行（P0 验收：书架建测试工程 → 杀进程重开 → 数据仍在）
```

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
