// Central balance configuration.
// Almost every tunable number lives here so the game can be rebalanced by
// editing a handful of constants.

export const SAVE_VERSION = 2;

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
// Unlock when lifetime credits earned reach this threshold.
export const PRESTIGE_THRESHOLD_CREDITS = 500_000;
// Core Data gained = floor(sqrt(lifetimeCredits / PRESTIGE_DIVISOR)).
export const PRESTIGE_DIVISOR = 5_000;

// Sell prices (credits per unit). Deeper processing is worth more, which
// rewards building the full chain rather than only mining.
export const SELL_PRICES: Record<"ore" | "steel" | "components", number> = {
  ore: 1,
  steel: 4,
  components: 12,
};

// Auto-sell keeps at least this much of a resource in reserve before selling
// the surplus. This lets production chains keep running while still converting
// true surplus into credits.
export const AUTOSELL_RESERVE: Record<"ore" | "steel" | "components", number> = {
  ore: 1_000,
  steel: 500,
  components: 200,
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
    name: "采矿无人机 / Mining Drone",
    icon: "⛏",
    description: "自动采集铁矿。",
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
  furnace: {
    id: "furnace" as const,
    name: "熔炼炉 / Furnace",
    icon: "🔥",
    description: "消耗铁矿，生产钢材。",
    category: "processor" as const,
    input: "ore" as const,
    output: "steel" as const,
    inputRate: 1, // ore per second per furnace
    outputYield: 1, // steel per ore
    baseCost: 120,
    costGrowth: 1.16,
    powerUse: 0.6,
  },
  factory: {
    id: "factory" as const,
    name: "制造厂 / Factory",
    icon: "⚙",
    description: "消耗钢材，生产机械零件。",
    category: "processor" as const,
    input: "steel" as const,
    output: "components" as const,
    inputRate: 0.5, // steel per second per factory
    outputYield: 1, // component per steel
    baseCost: 1_200,
    costGrowth: 1.17,
    powerUse: 1.2,
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
    description: "每轮开局获得 2 台采矿无人机（每级 +2）。",
    cost: 3,
    infinite: true,
    effectPerLevel: 2, // extra mining drones at run start per level
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
} as const;
