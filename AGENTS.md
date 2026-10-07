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
  - `types.ts` 类型定义 / `balance.ts` 全部数值常量（含 `RECIPES`、`EVENTS`、`STELLAR_UPGRADES` 与规范源常量 `RESOURCE_IDS`、`BUILDING_ORDER`、`SELLABLE_RESOURCES`、`STARGATE_INPUTS`）/ `buildings.ts` 建筑与成本 / `recipes.ts` 配方查询与台数分配 / `research.ts` 科技树 + 按配方/资源索引的修正器（**唯一的修正折叠入口** `computeModifiers`）/ `upgrades.ts` 永久升级（Core Data / 蓝图双货币）/ `prestige.ts` 一层重构 + 跨重置字段裁判 `META_KEYS` / `planets.ts` 星球与区域（纯逻辑）/ `stargate.ts` 星门（无限层）/ `stellar.ts` 第二层星图升级（纯逻辑）/ `ascension.ts` 升华（星图结算 + 一层重置）/ `events.ts` 随机事件（模拟时间）/ `contracts.ts` 合同（在线时间）/ `rng.ts` 确定性 PRNG（mulberry32）/ `state.ts` 状态与默认值 / `simulation.ts` 生产模拟与离线结算 / `save.ts` 存档 / `num.ts` 大数值运算 / `power.ts` 电力供需 / `achievements.ts` 成就系统
- `src/ui/` — 界面层
  - `render.ts` 数据驱动 UI 渲染与事件委托（含事件条、星门/星图/合同卡片、基地天际线、护航船）/ `format.ts` 数字与速率格式化 / `settings.ts` UI 偏好持久化（数字格式、动画档位）/ `visual.ts` 数值→视觉参数映射（纯函数，可单测；`STAGE_IDS` 定义 FLOW 的 9 个阶段，`BuildingNodeVisual` 定义逐建筑天际线）
- `src/styles/main.css` — 暗色科幻主题样式（含事件条 / 合同卡片 / 基地天际线）/ `src/styles/space.css` — 星球场景与动画（含护航船、卡片呼吸脉冲）
- `src/main.ts` — 启动、游戏主循环、自动保存、事件接线、成就/里程碑检测、合同在线推进
- `test/` — 测试（用 `tsx` 运行，不经 `tsc`）
  - `core.test.ts` 核心逻辑 / `power.test.ts` 电力供需（含平衡 bot）/ `recipes.test.ts` 配方系统 / `achievements.test.ts` 成就 / `format.test.ts` 数字格式 / `visual.test.ts` 视觉映射 / `planets.test.ts` 星球与区域 / `stargate.test.ts` 星门 / `stellar.test.ts` 第二层星图 / `events.test.ts` 随机事件 / `contracts.test.ts` 合同
- `.smoke/smoke.mjs`（位于本项目目录**之外**的同级 `.smoke/` 下，不随仓库分发）— 无头 Chrome + 原始 CDP 的端到端冒烟测试

### 常用命令
- `npm run dev` — 本地开发服务器
- `npm run build` — 类型检查 + 生产构建（输出到 `dist/`）
- `npm test` — 按顺序运行全部测试文件（core → power → recipes → achievements → format → visual → planets → stargate → stellar → events → contracts）
- `node .smoke/smoke.mjs`（在仓库根目录 `..` 下运行）— 端到端冒烟（需本机有 Chrome）

### 约定
- 游戏数值集中放在 `balance.ts`，改动平衡时优先改这里并同步相关测试。
- **规范源常量**：`RESOURCE_IDS` / `BUILDING_ORDER` 是资源顺序、建筑顺序（也是同 tick 内的结算顺序：采集 → 熔炼炉 → 制造厂 → 装配机 → 实验室，保证上游产物同 tick 可用）与各类默认 map 的唯一来源。新增资源/建筑时改这两个数组即可，不要另写一份硬编码列表。
- 建筑、科技、成就的新增往往需要同步多处：`BuildingId`/`TechId`/`AchievementId`/`RecipeId` 联合类型、`BUILDING_ORDER`、`CONSUMERS`（power.ts）、`visual.ts` 的 `STAGE_IDS`/`STAGE_OUTPUT`、`render.ts` 的资源标签与 FLOW 元数据、以及存档默认值。
- **配方系统**：
  - 加工建筑（熔炼炉/制造厂/装配机）**不再**在 `BuildingDefinition` 里带 `input/output`，一切走 `RECIPES`。`speed` 是「每秒批次数」，与旧的 `inputRate/outputYield` 数值等价（`smeltSteel: speed 1` ⇔ 旧熔炉 1 输入 1 输出），改动时留意 `test/power.test.ts` 的容量断言与 60 分钟平衡 bot。
  - `state.recipeMix[bid][rid]` 是**权重**，机器台数按权重比例拆分（`recipeAllocation`）。权重全 0 / 缺省时回退默认配方满额运行；被科技锁住的配方会被丢弃。
  - **多输入批次上限**：`n = min(capEff * dt, min_i(库存_i / 单批用量_i))`，不要写成 `库存/用量*用量` 之类的等价式（会算错上限）。
  - `RecipeOutputId = ResourceId | "blueprints"`：只有 `addOutput` / 统计特判蓝图（持久货币），主循环其余部分不感知。
  - 新增 `BuildingId` 时必须用**双层穷举**更新 `defaultRecipeMix()`（每个建筑 + 该建筑每个配方），否则某配方的配比会在读档时静默丢失；若新建筑是加工型，还要补 `RECIPES` 条目、`recipesForBuilding` 自然生效、并在 `buildings.ts` / `power.ts` / `visual.ts` / `render.ts` 补齐。
  - 新增配方时同步：`RecipeId` 联合、`RECIPES`、`visual.ts` 的 `STAGE_OUTPUT`/`STAGE_IDS`/`stageScale`、`research.ts` 里 `SMELT_RECIPES`/`FABRICATION_RECIPES` 的归类（决定哪些科技/星球修正作用到它）。
- **双货币永久升级**：`UpgradeDefinition.currency`（缺省 `coreData`）决定钱包；`upgrades.ts` 的 `wallet()` 是唯一分叉点。新增蓝图升级要给 `currency: "blueprints"`。`blueprints` 属于元进度：`prestige.ts` 会快照/还原它，`freshRunState()` 里用 `Omit` 排除它。
- **存档兼容**：`save.ts` 的 `normalizeState` 只合并默认对象中**已存在**的 key。新增状态字段（如建筑、成就、星球/区域、`blueprints`、`recipeMix`、星门/星图字段、事件与合同）必须显式写入默认值，否则旧存档读入后会得到 `undefined`（运算变 `NaN`）。新增 `Record` 类型字段时要用穷举的默认 map（如 `emptyRegionMap()`、`defaultRecipeMix()`、`emptyStellarUpgradeMap()`）预填全部 key，否则旧档对应整段会被丢弃。数组字段（`activeEvents` / `contractOffers` / `activeContracts`）会被合并逻辑**整体替换**，因此必须在 `normalizeState` 里逐条校验（事件 id 属于 `EVENTS`、合同资源属于 `SELLABLE_RESOURCES`）。
- **跨重置字段的单一裁判**：`prestige.ts` 的 `META_KEYS`（及配套 `snapshotMeta`/`restoreMeta`）与 `state.ts` 的 `freshRunState()` 的 `Omit` 列表**互为补集**，一层重构与二层升华共用。新增「应跨轮 / 跨层保留」的字段时，两处都要改，否则会被静默清空。
- **修正器（`computeModifiers`）是唯一入口**：科技 → 永久升级 → 星球/区域 → 星门 → 星图 → 事件，按此顺序折叠，消费方（simulation / power / prestige / contracts）自动受益。**例外**：`buildings.ts` 的 `buildingCost` **不走** `computeModifiers`（它只乘 `costMultFromPlanet`），所以星门 / 星图的降本必须在那里**单独**乘 `stargateCostMult(state) * stellarCostMult(state)`。
- **星门 / 星图 / 升华**：`stellar.ts` 只允许依赖 `balance` / `types` / `num`（`stargate.ts` 依赖它，反向禁止，避免成环）；`ascension.ts` 依赖 `prestige.ts` 的 `META_KEYS` 做跨层保留。星门成本 `base × 1.18ⁿ` 对每种输入同倍率，整级**原子支付**（四种同时备足）。升华的星图用「累计核心数据求得的额度 − 已领取 `chartsGranted`」的**增量**发放，防止同一累计值反复刷取。
- **事件 vs 合同的时间语义（刻意不同，不要混用）**：
  - **随机事件**走**模拟时间**（在 `simulate()` 内 `tickEvents(state, dt)`，`dt` 已含 `timeScale`，离线分块也会推进），门槛 `prestigeCount ≥ 1 || ascensionCount ≥ 1`。
  - **合同**走**在线墙钟时间**（在 `main.ts` 主循环里 `tickContracts(state, dt / 1000)`，用**未乘 timeScale 的真实 dt**，离线**不推进**）。
  - 两者都用 `rng.ts` 的 `state.rngSeed`（mulberry32）保证可复现；门槛保证 fresh game（`prestigeCount === 0`）恒不触发，因此现有精确断言不受影响。两者都是 **run 级**（写进 `freshRunState()`，**不**进 `META_KEYS`）。
- **星球 / 区域**：星球解锁是**纯派生**（由 `stats.prestigeCount` / `lifetimeCoreData` 计算，不落存档）；切换星球的唯一入口是重构（`doPrestige(state, targetPlanet?)`），本轮星球/区域在重构时落地。`planets.ts` 只允许依赖 `balance` / `types` / `num`，其余模块单向往上依赖它，以防循环依赖。`planets.ts` 的修正键（`miningMult`/`smeltMult`…）保持不变，只在 `computeModifiers` 折叠时「翻译」到按配方/资源索引的 map。
- `recipes.ts` 只允许依赖 `balance` / `types` / `num`（解锁自检直接用 `state.techs[tech] > 0`，**不要** import `research`，否则成环）。
- **事件委托陷阱**：`render.ts` 的 `#app` mousedown 委托是 first-match-wins 链，每个分支必须 `return`；新增分支的属性选择器要限定 `button[x]`（如 `button[data-planet]`、`button[data-recipe]`），否则裸属性选择器可能命中 `<html data-anim=...>` 而吞掉后续所有分支。
- **可视化层（`ui/visual.ts` + CSS）**：
  - 分工固定：`visual.ts` 只做**纯数值→参数映射**（可单测，禁止 DOM 访问），`render.ts` 每 180ms 把参数写成 CSS 变量 / `data-*` 属性，动画全部由 CSS 承担。不要在 `render.ts` 里写逐帧动画，也不要在 `visual.ts` 里碰 DOM。
  - **数量相关的 DOM 只在数值真正变化时触碰**（`lastDotCount` / `lastOwned` / `lastTowers` / `lastConvoy` 缓存），这是为了避免每帧重排。
  - 新增逐建筑可视化时：`VISUAL` 加常数 → `BuildingNodeVisual` 加字段 → `deriveVisualParams` 补派生（记得同时处理 `owned <= 0` 的退化分支）→ `render.ts` 建一次 DOM 池 + 在 `updateVisuals` 里写变量 → CSS 加动画 → **`test/visual.test.ts` 补边界与单调性断言**。
  - 里程碑相关的视觉**必须复用 `balance.ts` 的 `MILESTONES`**（天际线塔数就是 1 + 已跨层级数），不要再抄一份阈值。
  - 新增动画后要同步三处降级开关：`:root[data-anim="off"]`、`:root[data-anim="subtle"]`、`@media (prefers-reduced-motion: reduce)`（都在 `space.css` 末尾）。
  - 场景内元素继承 `.space-scene *` 的 `pointer-events: none`；放到场景**外面**的新装饰层（如 `#colony-belt`）要自己加 `pointer-events: none`。
- **命名规范**：建筑物的显示名以 `balance.ts` 的 `BUILDINGS[].name` 为唯一命名源；UI 的 `BUILDING_SHORT` 必须由 `BUILDING_LIST` **派生**，不要手抄一份（历史上「采矿无人机 vs 铜矿采集器」就是因为手抄而不一致，已统一为「钻机」）。同类项的后缀要保持一致、中英对仗。
- 调试面板（`render.ts` 中的 `debugBlock`）仅在 `import.meta.env.DEV` 下渲染，生产构建不可见，不要依赖它在生产环境生效。新增调试动作时，`render.ts` 的按钮与 `main.ts` 的 `onDebug` switch 要同时改。
- 新增可测试的游戏逻辑时，在对应的 `test/*.test.ts` 补充用例；核心通用逻辑放 `test/core.test.ts`，配方相关放 `test/recipes.test.ts`，新系统各自建文件（stargate/stellar/events/contracts）。
- 快捷键（`render.ts` 的 `KEY_BINDINGS`，由建筑顺序与 `SELLABLE_RESOURCES` 自动生成）：Q 手动采矿 / W E R T Y U 卖资源 / A S D F G H J 购买对应建筑 / X 一键出售全部。`KEY_BINDINGS` 的值是判别联合（`mine` / `buy` / `sell` / `sellAll`），`main.ts` 的 keydown 必须按 `bind.type` 分派——新增类型时别落到 `else { bind.res }` 分支上。任何依赖「标签页数量」「可售资源数量」的断言（含 `.smoke/smoke.mjs`）在新增 tab / 资源时都要同步。
- 主网格（`.main-grid`）为**两栏**：左列 `#panel-buildings`，右列 `.main-col` 内含 `#panel-production` + `#panel-stats`（纵向堆叠）。生产/统计是同一列的兄弟节点，别再让统计单独占一列。响应式断点只改 `grid-template-columns`，不要再给 `#panel-stats` 加 `grid-column`。

## 工作风格
- 改动前先读相关文件，理解现有结构，避免无谓的重构。
- 保持改动聚焦在用户请求的范围内，不过度设计。
- 关键逻辑（生产链、瓶颈、重构、存档）已覆盖测试，改动后请运行 `npm test` 与 `npm run build` 确认通过。
