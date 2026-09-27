// Shared type definitions for the game.

export type ResourceId =
  | "ore"
  | "steel"
  | "components"
  | "credits"
  | "research";

export type BuildingId = "miningDrone" | "furnace" | "factory" | "laboratory";

export type SellableResource = "ore" | "steel" | "components";

export type TechId =
  // Industrial Engineering
  | "highPressureDrill"
  | "advancedAlloys"
  | "precisionMfg"
  | "massProduction"
  | "overclockedDrills"
  // Automation
  | "automatedSmelting"
  | "automatedAssembly"
  | "automatedTrading"
  | "autoBuyLogic"
  | "smartLogistics"
  // Computing
  | "researchMethodology"
  | "productionAnalytics"
  | "efficientLabs"
  | "quantumComputing"
  | "coreSynthesis";

export type UpgradeId =
  | "fasterBoot"
  | "industrialMemory"
  | "automatedLogistics"
  | "researchArchive";

export interface BuildingDefinition {
  id: BuildingId;
  name: string;
  icon: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  // Producers (mining drone, laboratory handled specially) vs processors.
  category: "producer" | "processor" | "lab";
  // For producer: resource produced + base amount per second.
  produces?: ResourceId;
  baseProduction?: number;
  // For processor: input/output resources + conversion rates.
  input?: ResourceId;
  output?: ResourceId;
  inputRate?: number; // units of input consumed per second per building
  outputYield?: number; // units of output produced per unit of input
}

export interface TechDefinition {
  id: TechId;
  name: string;
  branch: "Industrial Engineering" | "Automation" | "Computing";
  icon: string;
  description: string;
  cost: number; // research points
  requires: readonly TechId[];
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  icon: string;
  description: string;
  cost: number; // core data
}

export interface LiveRates {
  // Net inventory change per second (what the player sees as "+X/s").
  ore: number;
  steel: number;
  components: number;
  research: number;
  credits: number;
  // Gross stage throughput per second (production-chain view).
  oreProd: number;
  steelProd: number;
  compProd: number;
  researchProd: number;
  // Per-building utilization (0..1) for bottleneck display.
  furnaceUtil: number;
  factoryUtil: number;
  labActive: boolean;
  // Flags describing current bottlenecks.
  oreShortage: boolean;
  oreAccumulating: boolean;
  steelShortage: boolean;
  steelAccumulating: boolean;
}

export interface GameStats {
  currentRunStart: number;
  lifetimePlayTime: number; // ms
  totalOre: number;
  totalSteel: number;
  totalComponents: number;
  lifetimeCredits: number; // gross credits earned (drives prestige)
  buildingsPurchased: number;
  prestigeCount: number;
  bestCreditsPerSec: number;
}

export interface GameState {
  version: number;
  timestamp: number;
  lastTick: number;
  resources: {
    ore: number;
    steel: number;
    components: number;
    credits: number;
    research: number;
  };
  buildings: Record<BuildingId, number>;
  techs: Record<TechId, boolean>;
  autoSell: Record<SellableResource, boolean>;
  autoBuy: Record<BuildingId, boolean>;
  permanentUpgrades: Record<UpgradeId, boolean>;
  coreData: number; // spendable prestige currency
  lifetimeCoreData: number;
  stats: GameStats;
  flags: {
    autoSellUnlocked: boolean;
    autoBuyUnlocked: boolean;
    analyticsUnlocked: boolean;
  };
  // Transient (recomputed each tick, persisted harmlessly).
  rates: LiveRates;
}
