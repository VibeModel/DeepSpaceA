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
  - `types.ts` 类型定义 / `balance.ts` 全部数值常量 / `buildings.ts` 建筑与成本 / `research.ts` 科技树 / `upgrades.ts` 永久升级 / `prestige.ts` 重构 / `state.ts` 状态与默认值 / `simulation.ts` 生产模拟与离线结算 / `save.ts` 存档
- `src/ui/` — 界面层
  - `render.ts` 数据驱动 UI 渲染与事件委托 / `format.ts` 数字与速率格式化
- `src/styles/main.css` — 暗色科幻主题样式
- `src/main.ts` — 启动、游戏主循环、自动保存、事件接线
- `test/core.test.ts` — 核心逻辑测试（用 `tsx` 运行）

### 常用命令
- `npm run dev` — 本地开发服务器
- `npm run build` — 类型检查 + 生产构建（输出到 `dist/`）
- `npm test` — 运行核心逻辑测试

### 约定
- 游戏数值集中放在 `balance.ts`，改动平衡时优先改这里并同步相关测试。
- 调试面板（`render.ts` 中的 `debugBlock`）仅在 `import.meta.env.DEV` 下渲染，生产构建不可见，不要依赖它在生产环境生效。
- 新增可测试的游戏逻辑时，优先在 `test/core.test.ts` 补充用例。

## 工作风格
- 改动前先读相关文件，理解现有结构，避免无谓的重构。
- 保持改动聚焦在用户请求的范围内，不过度设计。
- 关键逻辑（生产链、瓶颈、重构、存档）已覆盖测试，改动后请运行 `npm test` 与 `npm run build` 确认通过。
