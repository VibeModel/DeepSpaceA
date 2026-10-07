// Central balance configuration.
// Almost every tunable number lives here so the game can be rebalanced by
// editing a handful of constants.

import type {
  BuildingId,
  EventDefinition,
  EventId,
  ResourceId,
  SellableResource,
} from "./types";

export const SAVE_VERSION = 5;

// Canonical ordered lists. Kept here so every module (state defaults, sanitize,
// auto-buy priority, emptyRates) shares one source of truth and never drifts.
// `simulate` iterates production buildings then processors in this order, so the
// processors must stay upstream-to-downstream (furnace → factory → assembler).
export const RESOURCE_IDS: ResourceId[] = [
  "ore",
  "steel",
  "components",
  "credits",
  "research",
  "copperOre",
  "copper",
  "circuit",
  "alloy",
];

export const BUILDING_ORDER: BuildingId[] = [
  "miningDrone",
  "solarArray",
  "copperMine",
  "furnace",
  "factory",
  "assembler",
  "laboratory",
];

// Global upper bound for any game value. Keeps numbers finite even under
// unbounded exponential growth (avoids Infinity/NaN corrupting state).
export const MAX_VALUE = 1e18;
// Hard caps that stop exponential blow-ups at the source.
export const MAX_TECH_LEVEL = 1000;
export const MAX_BUILDINGS = 1_000_000;
// Core Data cost growth per level for repeatable permanent upgrades.
export const UPGRADE_COST_GROWTH = 1.6;

// Maximum simulated offline time (ms). Prevents absurd catch-up.
export const MAX_OFFLINE_MS = 24 * 60 * 60 * 1000;

// How often (ms) the game auto-saves.
export const AUTOSAVE_MS = 20_000;

// Manual mining click amount.
export const MANUAL_MINE_AMOUNT = 1;

// Prestige configuration.
// A prestige becomes available once THIS RUN's peak credit income reaches the
// threshold. Rewards then scale with how high that peak climbed, so the real
// decision is "how far do I push before resetting" — not "spam the button".
export const PRESTIGE_THRESHOLD_CPS = 50;
// Core Data gained = floor(sqrt(runPeakCreditsPerSec / PRESTIGE_CPS_DIVISOR)),
// i.e. run-scoped (never eaten by a lifetime entitlement), times the prestige
// gain multiplier. cps 500 -> 10 core data.
export const PRESTIGE_CPS_DIVISOR = 5;

// Sellable resources (canonical order/source). Every sell loop and the sell UI
// derive from this list so adding a sellable resource never leaves a hole.
export const SELLABLE_RESOURCES: SellableResource[] = [
  "ore",
  "steel",
  "components",
  "copper",
  "circuit",
  "alloy",
];

// Sell prices (credits per unit). Deeper processing is worth more, which
// rewards building the full chain rather than only mining.
export const SELL_PRICES: Record<SellableResource, number> = {
  ore: 1,
  steel: 4,
  components: 12,
  copper: 10,
  circuit: 40,
  alloy: 80,
};

// Auto-sell keeps at least this much of a resource in reserve before selling
// the surplus. This lets production chains keep running while still converting
// true surplus into credits.
export const AUTOSELL_RESERVE: Record<SellableResource, number> = {
  ore: 1_000,
  steel: 500,
  components: 200,
  copper: 200,
  circuit: 100,
  alloy: 50,
};

// Power grid. Every building draws power; the initial landing module provides a
// small base supply so the very first mining drone never dead-locks. Supply is
// NOT scaled by milestones (that would trivialise power late-game); the main
// long-term lever is the repeatable "Grid Optimization" tech.
export const BASE_POWER_SUPPLY = 15;

// Building definitions (cost formula: baseCost * growth^owned).
// `powerUse` = power drawn per second per unit; the solar array instead
// supplies `baseSupply` per unit.
export const BUILDINGS = {
  miningDrone: {
    id: "miningDrone" as const,
    name: "铁矿钻机 / Iron Mining Drill",
    icon: "⛏",
    description: "自动钻取铁矿。",
    category: "producer" as const,
    produces: "ore" as const,
    baseProduction: 1,
    baseCost: 15,
    costGrowth: 1.15,
    powerUse: 0.15,
  },
  solarArray: {
    id: "solarArray" as const,
    name: "太阳能阵列 / Solar Array",
    icon: "☀",
    description: "为全基地供电；电力不足时全产线按比例减产。",
    category: "power" as const,
    baseSupply: 6,
    powerUse: 0,
    baseCost: 120,
    costGrowth: 1.1,
  },
  copperMine: {
    id: "copperMine" as const,
    name: "铜矿钻机 / Copper Mining Drill",
    icon: "🔶",
    description: "自动钻取铜矿，供铜链使用。",
    category: "producer" as const,
    produces: "copperOre" as const,
    baseProduction: 1,
    baseCost: 60,
    costGrowth: 1.16,
    powerUse: 0.2,
  },
  furnace: {
    id: "furnace" as const,
    name: "熔炼炉 / Furnace",
    icon: "🔥",
    description: "熔炼矿石：默认把铁矿炼成钢材（可切换为铜矿冶炼）。",
    category: "processor" as const,
    baseCost: 120,
    costGrowth: 1.16,
    powerUse: 0.6,
  },
  factory: {
    id: "factory" as const,
    name: "制造厂 / Factory",
    icon: "⚙",
    description: "制造部件：默认把钢材加工成零件（可切换为电路制造）。",
    category: "processor" as const,
    baseCost: 1_200,
    costGrowth: 1.17,
    powerUse: 1.2,
  },
  assembler: {
    id: "assembler" as const,
    name: "装配机 / Assembler",
    icon: "🛠",
    description: "高阶装配：把多种材料合成为合金或蓝图。",
    category: "processor" as const,
    baseCost: 5_000,
    costGrowth: 1.18,
    powerUse: 2.4,
  },
  laboratory: {
    id: "laboratory" as const,
    name: "实验室 / Laboratory",
    icon: "🔬",
    description: "消耗信用点，生产研究点。",
    category: "lab" as const,
    produces: "research" as const,
    baseProduction: 0.2, // research per second per lab
    labUpkeep: 2, // credits per second per lab
    baseCost: 6_000,
    costGrowth: 1.18,
    powerUse: 2.0,
  },
};

export type BuildingDefs = typeof BUILDINGS;

// Recipes. Each processor runs exactly one recipe at a time; the choice lives
// in state.activeRecipe (reset every run). `speed` is base batches/second per
// machine — with a 1:1 input/output and speed=1 the numbers reproduce the old
// fixed furnace exactly, so existing balance/tests stay valid.
// A recipe with no `unlockTech` is available from the start.
export const RECIPES = {
  smeltSteel: {
    id: "smeltSteel" as const,
    name: "钢铁冶炼 / Steel Smelting",
    icon: "🔥",
    description: "铁矿 → 钢材",
    machine: "furnace" as const,
    inputs: [{ res: "ore" as const, amount: 1 }],
    output: "steel" as const,
    outputAmount: 1,
    speed: 1,
  },
  smeltCopper: {
    id: "smeltCopper" as const,
    name: "铜矿冶炼 / Copper Smelting",
    icon: "🔶",
    description: "铜矿 → 铜材",
    machine: "furnace" as const,
    inputs: [{ res: "copperOre" as const, amount: 1 }],
    output: "copper" as const,
    outputAmount: 1,
    speed: 0.8,
    unlockTech: "copperProcessing" as const,
  },
  makeComponents: {
    id: "makeComponents" as const,
    name: "零件制造 / Component Assembly",
    icon: "⚙",
    description: "钢材 → 零件",
    machine: "factory" as const,
    inputs: [{ res: "steel" as const, amount: 1 }],
    output: "components" as const,
    outputAmount: 1,
    speed: 0.5,
  },
  makeCircuit: {
    id: "makeCircuit" as const,
    name: "电路制造 / Circuit Fabrication",
    icon: "🔬",
    description: "铜材 ×2 + 零件 ×1 → 电路板",
    machine: "factory" as const,
    inputs: [
      { res: "copper" as const, amount: 2 },
      { res: "components" as const, amount: 1 },
    ],
    output: "circuit" as const,
    outputAmount: 1,
    speed: 0.4,
    unlockTech: "circuitFabrication" as const,
  },
  makeAlloy: {
    id: "makeAlloy" as const,
    name: "合金冶炼 / Alloy Forging",
    icon: "🧱",
    description: "钢材 ×2 + 铜材 ×1 → 合金",
    machine: "assembler" as const,
    inputs: [
      { res: "steel" as const, amount: 2 },
      { res: "copper" as const, amount: 1 },
    ],
    output: "alloy" as const,
    outputAmount: 1,
    speed: 0.3,
    unlockTech: "alloySynthesis" as const,
  },
  synthesizeBlueprint: {
    id: "synthesizeBlueprint" as const,
    name: "蓝图合成 / Blueprint Synthesis",
    icon: "📘",
    description: "电路板 ×1 + 合金 ×1 → 蓝图（持久货币）",
    machine: "assembler" as const,
    inputs: [
      { res: "circuit" as const, amount: 1 },
      { res: "alloy" as const, amount: 1 },
    ],
    output: "blueprints" as const,
    outputAmount: 1,
    speed: 0.15,
    unlockTech: "alloySynthesis" as const,
  },
} as const;

export type RecipeDefs = typeof RECIPES;

// Milestone thresholds for every building. Each reached threshold doubles that
// building's production.
export const MILESTONES = [10, 25, 50, 100];

// Milestone production bonus per reached tier.
export const MILESTONE_BONUS = 2;

// Auto-buy default: when enabled for a building and credits exceed
// AUTOBUY_TRIGGER_MULTIPLE * its current cost, buy one.
export const AUTOBUY_TRIGGER_MULTIPLE = 1.5;
// Cap purchases per tick for a single building when auto-buying.
export const AUTOBUY_MAX_PER_TICK = 5;

// Cost growth per level for repeatable "infinite" techs. Buying the (n+1)-th
// level costs baseCost * INFINITE_TECH_COST_GROWTH^n. Linear effect growth
// against exponential cost gives natural diminishing returns.
export const INFINITE_TECH_COST_GROWTH = 1.5;

// Tech tree. 17 techs across 3 branches. Branches are mostly linear (each tech
// requires the previous one), but a branch may fork (e.g. Grid Optimization
// branches off Automated Smelting). Mix of numeric, mechanic, automation and
// quality-of-life effects.
// Ten "pure production multiplier" techs are repeatable (infinite): after the
// first purchase (level 1) they can be upgraded further for escalating cost.
export const TECHS = {
  // Industrial Engineering — raw production boosts.
  highPressureDrill: {
    id: "highPressureDrill" as const,
    name: "高压钻头 / High Pressure Drill",
    branch: "Industrial Engineering" as const,
    icon: "⬆",
    description: "采矿产量 +50%（每级再 +50%）。",
    cost: 10,
    requires: [],
    infinite: true,
    effectPerLevel: 0.5,
  },
  advancedAlloys: {
    id: "advancedAlloys" as const,
    name: "高级合金 / Advanced Alloys",
    branch: "Industrial Engineering" as const,
    icon: "🧪",
    description: "钢材产出率 +25%（每级再 +25%）。",
    cost: 25,
    requires: ["highPressureDrill"],
    infinite: true,
    effectPerLevel: 0.25,
  },
  precisionMfg: {
    id: "precisionMfg" as const,
    name: "精密制造 / Precision Mfg",
    branch: "Industrial Engineering" as const,
    icon: "🔧",
    description: "零件产出率 +25%（每级再 +25%）。",
    cost: 60,
    requires: ["advancedAlloys"],
    infinite: true,
    effectPerLevel: 0.25,
  },
  massProduction: {
    id: "massProduction" as const,
    name: "批量生产 / Mass Production",
    branch: "Industrial Engineering" as const,
    icon: "🏭",
    description: "所有建筑产量 +25%（每级再 +25%）。",
    cost: 140,
    requires: ["precisionMfg"],
    infinite: true,
    effectPerLevel: 0.25,
  },
  overclockedDrills: {
    id: "overclockedDrills" as const,
    name: "超频钻头 / Overclocked Drills",
    branch: "Industrial Engineering" as const,
    icon: "⚡",
    description: "采矿产量 +50%（每级再 +50%）。",
    cost: 320,
    requires: ["massProduction"],
    infinite: true,
    effectPerLevel: 0.5,
  },
  copperProcessing: {
    id: "copperProcessing" as const,
    name: "铜矿冶炼 / Copper Processing",
    branch: "Industrial Engineering" as const,
    icon: "🔶",
    description: "解锁铜链：熔炼炉可切换「铜矿冶炼」，把铜矿炼成铜材。",
    cost: 45,
    requires: ["highPressureDrill"],
  },
  circuitFabrication: {
    id: "circuitFabrication" as const,
    name: "电路制造 / Circuit Fabrication",
    branch: "Industrial Engineering" as const,
    icon: "🔬",
    description: "解锁「电路制造」：制造厂可用铜材 + 零件生产电路板。",
    cost: 180,
    requires: ["copperProcessing", "precisionMfg"],
  },
  alloySynthesis: {
    id: "alloySynthesis" as const,
    name: "合金合成 / Alloy Synthesis",
    branch: "Industrial Engineering" as const,
    icon: "🧱",
    description: "解锁装配机的「合金冶炼」与「蓝图合成」。",
    cost: 600,
    requires: ["circuitFabrication", "massProduction"],
  },
  // Automation — speed + system unlocks.
  automatedSmelting: {
    id: "automatedSmelting" as const,
    name: "自动熔炼 / Automated Smelting",
    branch: "Automation" as const,
    icon: "🔥",
    description: "熔炼速度 +50%（每级再 +50%）。",
    cost: 15,
    requires: [],
    infinite: true,
    effectPerLevel: 0.5,
  },
  automatedAssembly: {
    id: "automatedAssembly" as const,
    name: "自动装配 / Automated Assembly",
    branch: "Automation" as const,
    icon: "⚙",
    description: "制造速度 +50%（每级再 +50%）。",
    cost: 40,
    requires: ["automatedSmelting"],
    infinite: true,
    effectPerLevel: 0.5,
  },
  gridOptimization: {
    id: "gridOptimization" as const,
    name: "电网优化 / Grid Optimization",
    branch: "Automation" as const,
    icon: "🔌",
    description: "全电网供电 +25%（每级再 +25%）。",
    cost: 30,
    requires: ["automatedSmelting"],
    infinite: true,
    effectPerLevel: 0.25,
  },
  automatedTrading: {
    id: "automatedTrading" as const,
    name: "自动交易 / Automated Trading",
    branch: "Automation" as const,
    icon: "💱",
    description: "解锁自动出售多余资源。",
    cost: 90,
    requires: ["automatedAssembly"],
  },
  autoBuyLogic: {
    id: "autoBuyLogic" as const,
    name: "自动采购 / Auto-Buy Logic",
    branch: "Automation" as const,
    icon: "🤖",
    description: "解锁自动购买基础建筑。",
    cost: 200,
    requires: ["automatedTrading"],
  },
  smartLogistics: {
    id: "smartLogistics" as const,
    name: "智能物流 / Smart Logistics",
    branch: "Automation" as const,
    icon: "📦",
    description: "所有建筑成本增长 -5%。",
    cost: 450,
    requires: ["autoBuyLogic"],
  },
  // Computing — research & meta.
  researchMethodology: {
    id: "researchMethodology" as const,
    name: "研究方法 / Research Methodology",
    branch: "Computing" as const,
    icon: "📐",
    description: "研究产量 +50%（每级再 +50%）。",
    cost: 20,
    requires: [],
    infinite: true,
    effectPerLevel: 0.5,
  },
  productionAnalytics: {
    id: "productionAnalytics" as const,
    name: "生产分析 / Production Analytics",
    branch: "Computing" as const,
    icon: "📊",
    description: "解锁瓶颈分析显示。",
    cost: 50,
    requires: ["researchMethodology"],
  },
  efficientLabs: {
    id: "efficientLabs" as const,
    name: "高效实验室 / Efficient Labs",
    branch: "Computing" as const,
    icon: "🔬",
    description: "实验室信用点消耗 -30%。",
    cost: 110,
    requires: ["productionAnalytics"],
  },
  quantumComputing: {
    id: "quantumComputing" as const,
    name: "量子计算 / Quantum Computing",
    branch: "Computing" as const,
    icon: "🌌",
    description: "研究产量 +100%（每级再 +100%）。",
    cost: 250,
    requires: ["efficientLabs"],
    infinite: true,
    effectPerLevel: 1.0,
  },
  coreSynthesis: {
    id: "coreSynthesis" as const,
    name: "核心合成 / Core Synthesis",
    branch: "Computing" as const,
    icon: "💠",
    description: "重构获得的核心数据 +50%。",
    cost: 550,
    requires: ["quantumComputing"],
  },
  automatedResearch: {
    id: "automatedResearch" as const,
    name: "自动科研 / Automated Research",
    branch: "Computing" as const,
    icon: "🤖",
    description: "解锁自动科研：自动购买可负担的科技（优先解锁型，其次最便宜的无限升级）。",
    cost: 300,
    requires: ["quantumComputing"],
  },
} as const;

// Planets. A planet applies a set of multiplicative modifiers for the whole run.
// Switching planets is done ONLY through a prestige (see prestige.ts), so the
// player cannot cherry-pick a mining bonus while mining and a research bonus
// while researching within the same run.
export const PLANETS = {
  homeworld: {
    id: "homeworld" as const,
    name: "母星 / Homeworld",
    icon: "🌍",
    description: "起始星球，无特殊修正，均衡稳定。",
    modifiers: {},
    unlock: {},
  },
  ferrum: {
    id: "ferrum" as const,
    name: "铁锈星 / Ferrum",
    icon: "⛏",
    description: "富铁矿脉：采矿 ×1.6，但大气尘埃削弱供电 ×0.75。",
    modifiers: { miningMult: 1.6, powerSupplyMult: 0.75 },
    unlock: { prestigeCount: 1 },
  },
  pyra: {
    id: "pyra" as const,
    name: "熔火星 / Pyra",
    icon: "🔥",
    description: "炽热地核：熔炼 ×1.5，但严酷环境使建筑成本 ×1.15。",
    modifiers: { smeltMult: 1.5, costMult: 1.15 },
    unlock: { prestigeCount: 3 },
  },
  cryon: {
    id: "cryon" as const,
    name: "冰寒星 / Cryon",
    icon: "🔬",
    description: "冰封实验室世界：研究 ×1.8，但低温使全局产量 ×0.9。",
    modifiers: { researchMult: 1.8, globalProdMult: 0.9 },
    unlock: { lifetimeCoreData: 80 },
  },
} as const;

export type PlanetDefs = typeof PLANETS;

// Upgradable regions. Bought with credits, capped at maxLevel, reset every run.
// `planets` omitted = available on every planet.
export const REGIONS = {
  miningField: {
    id: "miningField" as const,
    name: "采矿场 / Mining Field",
    icon: "⛏",
    description: "扩建露天采场：采矿产量 +15%/级。",
    baseCost: 200,
    costGrowth: 1.35,
    maxLevel: 20,
    effects: [{ modKey: "miningMult" as const, perLevel: 0.15 }],
  },
  foundry: {
    id: "foundry" as const,
    name: "冶炼区 / Foundry",
    icon: "🔥",
    description: "增建冶炼车间：熔炼 +12%/级、钢材产出 +5%/级。",
    baseCost: 400,
    costGrowth: 1.4,
    maxLevel: 20,
    effects: [
      { modKey: "smeltMult" as const, perLevel: 0.12 },
      { modKey: "steelYieldMult" as const, perLevel: 0.05 },
    ],
  },
  powerGrid: {
    id: "powerGrid" as const,
    name: "电网枢纽 / Power Grid",
    icon: "🔌",
    description: "加固输电网：供电 +10%/级。",
    baseCost: 500,
    costGrowth: 1.45,
    maxLevel: 20,
    effects: [{ modKey: "powerSupplyMult" as const, perLevel: 0.1 }],
  },
  researchPark: {
    id: "researchPark" as const,
    name: "科研园区 / Research Park",
    icon: "🔬",
    description: "集中研究设施：研究产量 +15%/级。",
    planets: ["homeworld", "cryon"] as const,
    baseCost: 800,
    costGrowth: 1.5,
    maxLevel: 20,
    effects: [{ modKey: "researchMult" as const, perLevel: 0.15 }],
  },
  logisticsHub: {
    id: "logisticsHub" as const,
    name: "物流中枢 / Logistics Hub",
    icon: "📦",
    description: "优化物资调配：全局产量 +4%/级。",
    planets: ["ferrum", "pyra"] as const,
    baseCost: 900,
    costGrowth: 1.5,
    maxLevel: 20,
    effects: [{ modKey: "globalProdMult" as const, perLevel: 0.04 }],
  },
} as const;

export type RegionDefs = typeof REGIONS;

// Permanent upgrades bought with Core Data after a prestige.
export const UPGRADES = {
  fasterBoot: {
    id: "fasterBoot" as const,
    name: "快速启动 / Faster Boot",
    icon: "🚀",
    description: "每轮开局获得 2 台铁矿钻机（每级 +2）。",
    cost: 3,
    infinite: true,
    effectPerLevel: 2, // extra iron drills at run start per level
  },
  industrialMemory: {
    id: "industrialMemory" as const,
    name: "工业记忆 / Industrial Memory",
    icon: "🧠",
    description: "所有生产效率 +20%（每级再 +20%）。",
    cost: 5,
    infinite: true,
    effectPerLevel: 0.2,
  },
  automatedLogistics: {
    id: "automatedLogistics" as const,
    name: "自动物流 / Automated Logistics",
    icon: "🛰",
    description: "开局即解锁自动出售。",
    cost: 4,
  },
  researchArchive: {
    id: "researchArchive" as const,
    name: "研究档案 / Research Archive",
    icon: "🗄",
    description: "研究产量 +25%（每级再 +25%）。",
    cost: 4,
    infinite: true,
    effectPerLevel: 0.25,
  },
  // ---- Blueprint upgrades: bought with the persistent "blueprints" currency
  // crafted by the copper → circuit → alloy chain. These give the new chain a
  // lasting payoff beyond core-data prestige upgrades.
  copperExtractor: {
    id: "copperExtractor" as const,
    name: "铜矿开采强化 / Copper Extraction",
    icon: "🔶",
    description: "铜矿采集 +25%/级。",
    cost: 1,
    currency: "blueprints" as const,
    infinite: true,
    effectPerLevel: 0.25,
  },
  circuitOverclock: {
    id: "circuitOverclock" as const,
    name: "电路超频 / Circuit Overclock",
    icon: "🔬",
    description: "电路与合金 加工速度 +25%/级。",
    cost: 2,
    currency: "blueprints" as const,
    infinite: true,
    effectPerLevel: 0.25,
  },
  alloyMastery: {
    id: "alloyMastery" as const,
    name: "合金精通 / Alloy Mastery",
    icon: "🧱",
    description: "合金与蓝图 产出 +20%/级。",
    cost: 2,
    currency: "blueprints" as const,
    infinite: true,
    effectPerLevel: 0.2,
  },
  assemblerBoot: {
    id: "assemblerBoot" as const,
    name: "装配机预置 / Assembler Boot",
    icon: "🛠",
    description: "重构开局获得 1 台装配机（每级 +1）。",
    cost: 3,
    currency: "blueprints" as const,
    infinite: true,
    effectPerLevel: 1,
  },
} as const;

// ---------------------------------------------------------------------------
// Stargate — the infinite long-horizon megastructure. Each tier consumes the
// whole production chain (the four sellable outputs of the deep chain), the
// cost grows exponentially and the level is unbounded. Completing a tier grants
// a permanent multiplier that survives both resets.
// ---------------------------------------------------------------------------
export const STARGATE_INPUTS: ResourceId[] = ["steel", "components", "circuit", "alloy"];
export const STARGATE_BASE_COST: Partial<Record<ResourceId, number>> = {
  steel: 2_000,
  components: 1_200,
  circuit: 600,
  alloy: 300,
};
export const STARGATE_COST_GROWTH = 1.18; // cost_n = base * 1.18^n (per input)
export const STARGATE_PROD_PER_LEVEL = 0.03; // globalProdMult *= (1 + 0.03n)
export const STARGATE_POWER_PER_LEVEL = 0.01; // powerSupplyMult *= (1 + 0.01n)
export const STARGATE_COST_REDUCTION = 0.99; // building cost *= 0.99^n
// Named milestones: each reached tier adds another permanent ×1.5 to production,
// so the ladder has visible "chapters" even though it never ends.
export const STARGATE_MILESTONES: { level: number; name: string; bonus: number }[] = [
  { level: 1, name: "初阶星门 / First Gate", bonus: 1.5 },
  { level: 5, name: "稳定虫洞 / Stable Wormhole", bonus: 1.5 },
  { level: 10, name: "星门阵列 / Gate Array", bonus: 1.5 },
  { level: 25, name: "量子中继 / Quantum Relay", bonus: 1.5 },
  { level: 50, name: "跨星系门 / Interstellar Gate", bonus: 1.5 },
  { level: 100, name: "银河枢纽 / Galactic Hub", bonus: 1.5 },
  { level: 200, name: "深空灯塔 / Deep-Space Beacon", bonus: 1.5 },
];

// ---------------------------------------------------------------------------
// Second layer (ascension). Reached once enough lifetime Core Data has piled up;
// grants "stellar charts" and wipes layer-1 progress (Core Data + upgrades).
// ---------------------------------------------------------------------------
export const ASCENSION_THRESHOLD_CORE = 50; // lifetimeCoreData needed
export const CHART_DIVISOR = 2; // raw = floor(sqrt(lifetimeCoreData / 2))
export const STELLAR_COST_GROWTH = 1.7; // per-level cost growth for infinite ones

export const STELLAR_UPGRADES = {
  chartIndustry: {
    id: "chartIndustry" as const,
    name: "工业星图 / Chart: Industry",
    icon: "🏭",
    description: "所有生产效率 +20%/级。",
    cost: 1,
    infinite: true,
    effectPerLevel: 0.2,
  },
  chartEconomy: {
    id: "chartEconomy" as const,
    name: "经济星图 / Chart: Economy",
    icon: "💰",
    description: "所有建筑成本 ×0.96/级。",
    cost: 1,
    infinite: true,
    effectPerLevel: 0.04,
  },
  chartPrestige: {
    id: "chartPrestige" as const,
    name: "重构星图 / Chart: Prestige",
    icon: "💠",
    description: "一层重构收益 +10%/级。",
    cost: 2,
    infinite: true,
    effectPerLevel: 0.1,
  },
  chartCharts: {
    id: "chartCharts" as const,
    name: "星图星图 / Chart: Charts",
    icon: "🗺",
    description: "升华获得的星图 +10%/级。",
    cost: 2,
    infinite: true,
    effectPerLevel: 0.1,
  },
  chartStargate: {
    id: "chartStargate" as const,
    name: "星门星图 / Chart: Stargate",
    icon: "🌀",
    description: "星门建造成本 ×0.95/级。",
    cost: 3,
    infinite: true,
    effectPerLevel: 0.05,
  },
  chartContracts: {
    id: "chartContracts" as const,
    name: "合同星图 / Chart: Contracts",
    icon: "📜",
    description: "同时进行的合同槽位 +1/级。",
    cost: 2,
    infinite: true,
    effectPerLevel: 1,
  },
  chartAutoPrestige: {
    id: "chartAutoPrestige" as const,
    name: "自动重构 / Auto-Prestige",
    icon: "🔄",
    description: "解锁「自动重构」：本轮峰值达到阈值即自动重构。",
    cost: 5,
  },
  chartMemory: {
    id: "chartMemory" as const,
    name: "记忆回溯 / Memory Recall",
    icon: "🧠",
    description: "升华时保留 25% 的永久升级等级。",
    cost: 4,
  },
} as const;

// ---------------------------------------------------------------------------
// Contracts — manual timed orders. They tick on ONLINE wall-clock time only, so
// an offline player never comes back to an expired contract.
// ---------------------------------------------------------------------------
export const CONTRACT_MAX_ACTIVE = 2; // base slots (+ chartContracts levels)
export const CONTRACT_SPAWN_SEC = 90; // online seconds between offers
export const CONTRACT_DURATION_SEC = 600; // time to deliver once accepted
export const CONTRACT_OFFER_WINDOW_SEC = 240; // online seconds to accept an offer
export const CONTRACT_REWARD_MULT = 1.5; // credit reward = goods value × this
// An order asks for this fraction of what the run produces during the deadline
// window — demanding enough to matter, cheap enough to be feasible.
export const CONTRACT_AMOUNT_FRACTION = 0.4;
export const CONTRACT_MIN_AMOUNT = 10; // never ask for a trivial quantity

// ---------------------------------------------------------------------------
// Random events — automatic, ticked in SIMULATED time so they stay consistent
// with production (and offline catch-up).
// ---------------------------------------------------------------------------
export const EVENT_SPAWN_SEC = 180;
export const EVENT_DURATION_SEC = 60;

// Weighted event table. Every entry is a short-lived multiplicative modifier;
// good/bad is only used for the UI colour.
export const EVENTS = {
  richVein: {
    id: "richVein" as const,
    name: "富矿脉 / Rich Vein",
    icon: "⛏️",
    description: "所有生产 +50%。",
    weight: 3,
    good: true,
    effect: { prodMult: 1.5 },
  },
  marketBoom: {
    id: "marketBoom" as const,
    name: "市场繁荣 / Market Boom",
    icon: "📈",
    description: "出售价格 +50%。",
    weight: 3,
    good: true,
    effect: { sellMult: 1.5 },
  },
  researchSurge: {
    id: "researchSurge" as const,
    name: "研究突破 / Research Surge",
    icon: "🔬",
    description: "研究产出 ×2。",
    weight: 2,
    good: true,
    effect: { researchMult: 2 },
  },
  solarFlare: {
    id: "solarFlare" as const,
    name: "太阳耀斑 / Solar Flare",
    icon: "🌞",
    description: "电网供电 +30%。",
    weight: 2,
    good: true,
    effect: { powerMult: 1.3 },
  },
  ionStorm: {
    id: "ionStorm" as const,
    name: "离子风暴 / Ion Storm",
    icon: "⚡",
    description: "所有生产 -30%。",
    weight: 2,
    good: false,
    effect: { prodMult: 0.7 },
  },
  supplyGlut: {
    id: "supplyGlut" as const,
    name: "供给过剩 / Supply Glut",
    icon: "📉",
    description: "出售价格 -40%。",
    weight: 2,
    good: false,
    effect: { sellMult: 0.6 },
  },
} as const satisfies Record<EventId, EventDefinition>;
