# 计划书：手动阅读模式 + 书架网格 + 横屏阅读（v0.3.0 主项）

文档状态：待确认后开工
日期：2026-11-19
前置：v0.2.0（后台锁屏播放 / TTS 参数 / 导出分享 / 阅读增强）按既定四功能交付；
本计划的书架网格（R1）体量小，建议并入 v0.2.0 一起发；阅读器本体为 v0.3.0 主项。

## 1. 定位

TaleCast 从"只能听"升级为**听读双模**：

- **听书模式**（已有）：段队列播放，正文按段跟随高亮——不动。
- **手动阅读模式**（新增）：市面流行小说阅读器的完整体验——翻页阅读、点击翻页、
  字号调节、书签、全文搜索、横屏。
- 双模共享同一套字符偏移体系与 reading_state：**听书能"边听边翻"，
  手读能"听到哪跟到哪"**——这是与单用途阅读器的核心差异，也是本项目双模的卖点。

明确不追求：复刻掌阅/起点的全部翻页动画（仿真卷页明确不做，见 §7 不做清单）。

## 2. 关键决策

| 决策点 | 决定 | 理由 |
| --- | --- | --- |
| 分页模型 | **字符偏移确定性分页**：domain 新增 `reader.ts`，`paginate(text, metrics) → Page[]`，Page = {startOffset, endOffset}；metrics（每行字数/每页行数）由首屏测量探针得出 | 与全库字符偏移体系一致；确定性输出（同输入同分页）可测试；字号/横屏变化 → metrics 变化 → 重算，不丢字（按偏移切分安全） |
| 翻页容器 | react-native-pager-view（新依赖，PR 说明：原生翻页手势与性能，纯 JS 无法达到市面手感） | 社区标准做法；平移模式开箱即用 |
| 翻页模式 | 首发两种：**平移**（pager-view 默认）+ **上下滚动**（保留现有 FlatList）；点击屏幕左/中/右分区 = 上一页/呼出菜单/下一页 | 市面主流的最小可用集；仿真/覆盖列入后置（§8） |
| 横屏 | expo-screen-orientation（新依赖）：阅读屏允许横屏（跟随系统），尺寸变化 → metrics 重算 → 重新分页并按"当前页首字符"回到原位置 | 横屏单页加宽；双栏后置 |
| 字号调节 | 设置项（小/标准/大/特大 4 档）→ 影响行高与每行字数 → 重算分页 | 阅读增强三件套与本计划合并实现 |
| 书签 | bookmarks 表（见 §5）：章节 + 字符偏移 + 可选备注；阅读工具栏长按加书签 | 与 reading_state 体系同源 |
| 全文搜索 | 纯实现：全书文本 `indexOf` 扫描（domain/search.ts），结果列出 章节+摘录+偏移，点击跳转 | 无需新依赖；数据量（≤16MB）可接受，按章节流式扫描 |
| 听读联动 | 播放中：高亮段所在页自动成为当前页（跟随翻页）；手动翻页不打断播放 | 双模融合的关键交互 |

## 3. 书架网格（R1，建议并入 v0.2.0）

- 书架顶栏增加视图切换（列表 / 三列网格 icon toggle），选择持久化到 settings 表（key `bookshelf-view`）。
- 网格卡片：封面色块（按书名哈希取色）+ 书名（衬线）+ 进度胶囊；点击/长按行为与列表一致。
- FlatList `numColumns={3}` + `columnWrapperStyle`，数据同源，无新依赖。

## 4. 架构设计

### 4.1 分层落点（沿用 5.1 约定）

```
src/domain/reader.ts        分页算法：paginate / metrics 计算 / 页内偏移映射（纯函数 + 测试）
src/domain/search.ts        全文搜索：纯扫描函数（章节内/全书两级）+ 测试
src/domain/bookmarks.ts     书签规则（新增/排序/去重）
src/adapters/screen.ts      屏幕方向适配（expo-screen-orientation 封装，唯一平台触点）
src/hooks/use-reader-settings.ts   字号/翻页模式/方向偏好（settings 表持久化）
src/hooks/use-pagination.ts        测量 → metrics → 分页 → 当前页位置
src/hooks/use-bookmarks.ts、use-search.ts
src/services/bookmarks.ts   书签用例（增删列，幂等回执）
```

### 4.2 分页算法要点

- 输入：章节文本 + 段落列表（已有 splitParagraphs）+ metrics { charsPerLine, linesPerPage, paragraphGapLines }
- 输出：Page[]（半开偏移区间，衔接覆盖全文，与 chapters 同一套不变量）
- 确定性：同输入同输出（text_hash 式可测试）；字号/方向变化 = metrics 变化 = 全量重算
- 探针测量：渲染隐藏 Text（与正文同样式）测 `charsPerLine` 与 `linesPerPage`；CJK 逐字换行假设为主，
  中英混排允许 ±1 字误差（按偏移切分不丢字，只影响页尾留白）

### 4.3 与播放的联动

- 高亮：段起始偏移落在当前页 → 该段高亮（沿用 playback 状态，无需新链路）
- 跟随：播放推进到段首偏移越过当前页 endOffset → 自动翻到该段所在页（仅"边听边读"开关开启时）
- 手动翻页：不改播放状态；reading_state 仍以 charOffset 为权威，翻页即写页首偏移

### 4.4 横屏

- expo-screen-orientation：进入阅读屏锁定为"跟随系统"（应用其余屏幕保持竖屏锁定）
- 尺寸变化 → 防抖 300ms → 重新测量 → 重算分页 → 按"当前页首字符"恢复位置（不读原页码，读偏移）

## 5. 数据模型（迁移 v6）

```sql
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  chapter_id TEXT NOT NULL,
  char_offset INTEGER NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, chapter_id, char_offset)
);
```

- `reading_state` 增列：`reader_mode TEXT`（scroll/paged）、`font_size TEXT`（小/标准/大/特大）——持久化在工程维度
- `settings` 表复用：`bookshelf-view`（list/grid）、`orientation`（跟随系统）

## 6. 里程碑与验收

### R1：书架网格 + 视图切换（小，建议并入 v0.2.0 一起发）
验收：列表/网格切换即时生效且重启保持；网格点击/长按与列表行为一致；tsc/vitest/守卫全绿。

### R2：分页阅读器（v0.3.0 主项）
交付：domain 分页算法与测试、翻页（平移 + 点击分区）、字号四档、边听边读跟随、横屏（重算恢复）。
验收：同一章节三种字号分页结果不同但均覆盖全文不丢字；横竖屏切换后位置回到原页首；
播放中打开阅读跟随，页随段推进；分页确定性测试（同输入同分页）通过。

### R3：书签 + 全文搜索
交付：书签（长按添加/列表跳转/删除）、全文搜索（全书扫描 + 结果跳转）。
验收：书签跨重启恢复；搜索结果点击落到正确章节与偏移；空态与无结果态有明确提示。

### 后置（不在本计划）
仿真卷页/覆盖动画、横屏双栏、EPUB/MOBI/在线书源、富文本排版、PDF。

## 7. 依赖说明（PR 中逐项理由）

| 依赖 | 用途 | 替代方案为何不用 |
| --- | --- | --- |
| react-native-pager-view | 原生翻页手势容器 | 纯 JS 手势无法达到市面翻页手感；Expo Go 不含，需 dev build（与 F-1 同口径） |
| expo-screen-orientation | 阅读屏横屏 | Expo Go 支持（SDK 内置），无阻断 |

## 8. 不做清单（本期明确）

仿真卷页动画、覆盖动画、横屏双栏、有声书音频对齐文字（ASR 对齐）、EPUB/MOBI/在线书源、
夜间护眼色温调节、阅读时长统计、社交/书评。

## 9. 风险与应对

| 风险 | 应对 |
| --- | --- |
| CJK/混排换行测量误差 | 按偏移切分不丢字；±1 字误差只影响页尾留白；探针样式与正文严格一致 |
| 字号/横屏切换抖动 | 防抖 300ms + 按"页首偏移"恢复；重算在 16MB 上限章节内为毫秒级 |
| pager-view 与 Expo Go 不兼容 | 与 F-1 同口径：v0.2.0 起主验证渠道为 dev APK；R2 在 v0.3.0，时间上晚于 F-1 |
| 大章节分页卡顿 | 分页在 domain 纯函数 + useMemo；3 万字上限（F-2 已限）量级为毫秒级 |
| 书签/搜索与章节编辑冲突 | 均以 charOffset 为准，章节集合变化后失效回退（沿用 reading_state 回退策略） |

## 10. 下一步

确认本计划后：R1 并入 v0.2.0（先于四功能发版，体量最小）；R2/R3 按 v0.3.0 主项开工，
顺序 = 分页算法与测试 → 翻页 UI → 横屏 → 书签/搜索。
