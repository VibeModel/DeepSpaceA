// Central balance configuration.
// Almost every tunable number lives here so the game can be rebalanced by
// editing a handful of constants.

export const SAVE_VERSION = 1;

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

// Building definitions (cost formula: baseCost * growth^owned).
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

// Tech tree. 15 techs across 3 branches. Each branch is linear (requires the
// previous tech in the same branch). Mix of numeric, mechanic, automation and
// quality-of-life effects.
export const TECHS = {
  // Industrial Engineering — raw production boosts.
  highPressureDrill: {
    id: "highPressureDrill" as const,
    name: "高压钻头 / High Pressure Drill",
    branch: "Industrial Engineering" as const,
    icon: "⬆",
    description: "采矿产量 +50%。",
    cost: 10,
    requires: [],
  },
  advancedAlloys: {
    id: "advancedAlloys" as const,
    name: "高级合金 / Advanced Alloys",
    branch: "Industrial Engineering" as const,
    icon: "🧪",
    description: "钢材产出率 +25%。",
    cost: 25,
    requires: ["highPressureDrill"],
  },
  precisionMfg: {
    id: "precisionMfg" as const,
    name: "精密制造 / Precision Mfg",
    branch: "Industrial Engineering" as const,
    icon: "🔧",
    description: "零件产出率 +25%。",
    cost: 60,
    requires: ["advancedAlloys"],
  },
  massProduction: {
    id: "massProduction" as const,
    name: "批量生产 / Mass Production",
    branch: "Industrial Engineering" as const,
    icon: "🏭",
    description: "所有建筑产量 +25%。",
    cost: 140,
    requires: ["precisionMfg"],
  },
  overclockedDrills: {
    id: "overclockedDrills" as const,
    name: "超频钻头 / Overclocked Drills",
    branch: "Industrial Engineering" as const,
    icon: "⚡",
    description: "采矿产量 再 +50%。",
    cost: 320,
    requires: ["massProduction"],
  },
  // Automation — speed + system unlocks.
  automatedSmelting: {
    id: "automatedSmelting" as const,
    name: "自动熔炼 / Automated Smelting",
    branch: "Automation" as const,
    icon: "🔥",
    description: "熔炼速度 +50%。",
    cost: 15,
    requires: [],
  },
  automatedAssembly: {
    id: "automatedAssembly" as const,
    name: "自动装配 / Automated Assembly",
    branch: "Automation" as const,
    icon: "⚙",
    description: "制造速度 +50%。",
    cost: 40,
    requires: ["automatedSmelting"],
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
    description: "研究产量 +50%。",
    cost: 20,
    requires: [],
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
    description: "研究产量 再 +100%。",
    cost: 250,
    requires: ["efficientLabs"],
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
} as const;

// Permanent upgrades bought with Core Data after a prestige.
export const UPGRADES = {
  fasterBoot: {
    id: "fasterBoot" as const,
    name: "快速启动 / Faster Boot",
    icon: "🚀",
    description: "每轮开局获得 2 台采矿无人机。",
    cost: 3,
  },
  industrialMemory: {
    id: "industrialMemory" as const,
    name: "工业记忆 / Industrial Memory",
    icon: "🧠",
    description: "所有生产效率 +20%。",
    cost: 5,
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
    description: "研究产量 +25%。",
    cost: 4,
  },
} as const;
