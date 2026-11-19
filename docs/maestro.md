# Maestro E2E（v0.13.0 基础）

本地运行（不进 CI 门禁）：

```bash
# 前置：Android 模拟器或真机 + 已安装 dev APK；maestro（https://maestro.mobile.dev）
maestro test .maestro/smoke-import-play.yaml
maestro test .maestro/reader-interactions.yaml
maestro test .maestro/dialogue-generation.yaml
```

## 流程清单

| 流程 | 覆盖 |
|------|------|
| smoke-import-play | 启动 → 新建 → 工作台元素断言 |
| reader-interactions | 阅读器：模式/字体/行距/段距/主题/睡眠按钮存在性 + 返回 |
| dialogue-generation | 对话分声开关循环 + 角色中心可达 |

## 约定

- flow 里的选择器文案与 UI 中文标签耦合——改标签需同步 flow
- 系统文件选择器（SAF）内的自动化不稳定，导入步骤采用"手动配合 + 后续断言"策略
- 后续补充：划线笔记流程（v0.12）、搜索跳转（v0.8）在真机验收后补 flow
