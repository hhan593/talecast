/**
 * 角色与音色绑定、人工保护规则（docs/plan.md 4.1.4）。
 * 核心约束：manual_protected 的角色身份与绑定不被模型建议覆盖；
 * LLM 抽取产出候选，人工确认才生效。绑定命令实现见 src/services/bindings.ts（本文件保留模块占位，端口在 ports.ts）。
 */

export {};
