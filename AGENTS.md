# AGENTS.md — DeepSpaceA 深空自动化

本文件用于指导在本项目中工作的 AI 编程助手（如 CodeBuddy Code）。请在处理本仓库的任何任务时遵循以下约定。

## 关键约束：禁止未经授权的 Git 提交

**未经用户明确允许，绝对不得执行 `git commit`（或 `git add` + `git commit` 组合）。**

- ❌ 不要为了"保存进度"或"收尾"而自行提交。
- ❌ 不要因为任务看起来完成就自动提交到版本库。
- ✅ 只有在用户**显式**说"提交""commit""保存改动到 git"之类指令时，才可以进行提交。
- ✅ 推送（`git push`）、建分支、开 PR 同样需要用户单独授权，默认不做。

如果用户在对话中明确要求提交，请先 `git status` / `git diff` 确认改动范围，再按用户给定的提交信息或恰当的提交信息执行，但**不要**超出用户授权的范围（例如用户说提交某文件，就不要顺手 push）。

## 项目简介

增量 / 自动化放置类游戏，技术栈为 **Vite + TypeScript**（无框架，手写 DOM 渲染）。

### 目录结构
- `src/game/` — 游戏逻辑（纯逻辑，可单测）
  - `types.ts` 类型定义 / `balance.ts` 全部数值常量 / `buildings.ts` 建筑与成本 / `research.ts` 科技树 / `upgrades.ts` 永久升级 / `prestige.ts` 重构（含星球目的地）/ `planets.ts` 星球与区域（纯逻辑）/ `state.ts` 状态与默认值 / `simulation.ts` 生产模拟与离线结算 / `save.ts` 存档 / `num.ts` 大数值运算 / `power.ts` 电力供需 / `achievements.ts` 成就系统
- `src/ui/` — 界面层
  - `render.ts` 数据驱动 UI 渲染与事件委托 / `format.ts` 数字与速率格式化 / `settings.ts` UI 偏好持久化（数字格式、动画档位）/ `visual.ts` 数值→视觉参数映射（纯函数，可单测）
- `src/styles/main.css` — 暗色科幻主题样式 / `src/styles/space.css` — 星球场景与动画
- `src/main.ts` — 启动、游戏主循环、自动保存、事件接线、成就/里程碑检测
- `test/` — 测试（用 `tsx` 运行，不经 `tsc`）
  - `core.test.ts` 核心逻辑 / `power.test.ts` 电力供需（含平衡 bot）/ `achievements.test.ts` 成就 / `format.test.ts` 数字格式 / `visual.test.ts` 视觉映射 / `planets.test.ts` 星球与区域

### 常用命令
- `npm run dev` — 本地开发服务器
- `npm run build` — 类型检查 + 生产构建（输出到 `dist/`）
- `npm test` — 按顺序运行全部测试文件（core → power → achievements → format → visual → planets）

### 约定
- 游戏数值集中放在 `balance.ts`，改动平衡时优先改这里并同步相关测试。
- 建筑、科技、成就的新增往往需要同步多处：`BuildingId`/`TechId`/`AchievementId` 联合类型、`BUILDING_ORDER`、`KEY_BINDINGS`、`visual.ts` 求和、`render.ts` 与 `main.ts` 中的硬编码列表，以及存档默认值。
- **存档兼容**：`save.ts` 的 `normalizeState` 只合并默认对象中**已存在**的 key。新增状态字段（如建筑、成就、星球/区域）必须显式写入默认值，否则旧存档读入后会得到 `undefined`（运算变 `NaN`）。新增 `Record` 类型字段时要用穷举的默认 map（如 `emptyRegionMap()`）预填全部 key，否则旧档对应整段会被丢弃。
- **星球 / 区域**：星球解锁是**纯派生**（由 `stats.prestigeCount` / `lifetimeCoreData` 计算，不落存档）；切换星球的唯一入口是重构（`doPrestige(state, targetPlanet?)`），本轮星球/区域在重构时落地。`planets.ts` 只允许依赖 `balance` / `types` / `num`，其余模块单向往上依赖它，以防循环依赖。
- **事件委托陷阱**：`render.ts` 的 `#app` mousedown 委托是 first-match-wins 链，每个分支必须 `return`；新增分支的属性选择器要限定 `button[x]`（如 `button[data-planet]`），否则裸属性选择器可能命中 `<html data-anim=...>` 而吞掉后续所有分支。
- 调试面板（`render.ts` 中的 `debugBlock`）仅在 `import.meta.env.DEV` 下渲染，生产构建不可见，不要依赖它在生产环境生效。
- 新增可测试的游戏逻辑时，在对应的 `test/*.test.ts` 补充用例；核心通用逻辑放 `test/core.test.ts`。
- 快捷键（`render.ts` 的 `KEY_BINDINGS`）：Q 手动采矿 / W E R 卖矿 / A S D F G 购买对应建筑。

## 工作风格
- 改动前先读相关文件，理解现有结构，避免无谓的重构。
- 保持改动聚焦在用户请求的范围内，不过度设计。
- 关键逻辑（生产链、瓶颈、重构、存档）已覆盖测试，改动后请运行 `npm test` 与 `npm run build` 确认通过。
