// Shared type definitions for the game.

export type ResourceId =
  | "ore"
  | "steel"
  | "components"
  | "credits"
  | "research";

export type BuildingId =
  | "miningDrone"
  | "solarArray"
  | "furnace"
  | "factory"
  | "laboratory";

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
  | "gridOptimization"
  | "automatedTrading"
  | "autoBuyLogic"
  | "smartLogistics"
  // Computing
  | "researchMethodology"
  | "productionAnalytics"
  | "efficientLabs"
  | "quantumComputing"
  | "coreSynthesis"
  | "automatedResearch";

export type UpgradeId =
  | "fasterBoot"
  | "industrialMemory"
  | "automatedLogistics"
  | "researchArchive";

// Achievements are pure trophies (no gameplay effect). Ids live here so both
// types.ts consumers and achievements.ts can share the union without a cycle.
export type AchievementId =
  | "firstOre"
  | "firstDrone"
  | "smelter"
  | "assembly"
  | "lab"
  | "solar"
  | "oreBaron"
  | "steelWill"
  | "partsMaster"
  | "firstMillion"
  | "reboot"
  | "cycleFive"
  | "coreHoarder"
  | "scholar"
  | "milestoneMaster"
  | "gridStable"
  | "highThroughput"
  | "timeTraveler";

export interface BuildingDefinition {
  id: BuildingId;
  name: string;
  icon: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  // Producers (mining drone, laboratory handled specially) vs processors vs
  // power suppliers.
  category: "producer" | "processor" | "lab" | "power";
  // For producer: resource produced + base amount per second.
  produces?: ResourceId;
  baseProduction?: number;
  // For processor: input/output resources + conversion rates.
  input?: ResourceId;
  output?: ResourceId;
  inputRate?: number; // units of input consumed per second per building
  outputYield?: number; // units of output produced per unit of input
  // For lab: credit upkeep per second per building.
  labUpkeep?: number;
  // For power: supply each unit contributes (solar array).
  baseSupply?: number;
  // Power drawn per second per building (0 for the power building itself).
  powerUse?: number;
}

export interface TechDefinition {
  id: TechId;
  name: string;
  branch: "Industrial Engineering" | "Automation" | "Computing";
  icon: string;
  description: string;
  cost: number; // research points (cost of the first level)
  requires: readonly TechId[];
  // Repeatable numeric techs: after unlocking, can be upgraded indefinitely.
  infinite?: boolean;
  // Multiplier gained per level, e.g. 0.5 means +50% per level. Level n grants
  // a (1 + effectPerLevel * n) multiplier.
  effectPerLevel?: number;
}

export interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  icon: string;
  description: string;
  cost: number; // core data (cost of the first level)
  // Repeatable permanent upgrades: after the first purchase they can be
  // upgraded indefinitely with escalating Core Data cost.
  infinite?: boolean;
  effectPerLevel?: number;
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
  // Gross input capacity of the processors (ore/s for furnaces, steel/s for
  // factories). Used for the analytics diagnostics panel.
  furnaceCap: number;
  factoryCap: number;
  // Actual input consumed per second (for the structured bottleneck panel).
  furnaceInput: number;
  factoryInput: number;
  // Effective conversion ratio (output per unit of input) incl. yield techs.
  furnaceYield: number;
  factoryYield: number;
  // Power grid: supply (capacity), demand and the resulting throttle factor
  // (1 = fine, <1 = brownout scaling every production/consumption rate).
  powerSupply: number;
  powerDemand: number;
  powerFactor: number;
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
  // Tech level per tech: 0 = not researched, 1 = unlocked, >1 = upgraded
  // (only repeatable/infinite techs can exceed 1).
  techs: Record<TechId, number>;
  autoSell: Record<SellableResource, boolean>;
  autoBuy: Record<BuildingId, boolean>;
  autoResearch: boolean;
  // Permanent upgrade level: 0 = not owned, 1 = owned, >1 = upgraded (only
  // repeatable permanent upgrades can exceed 1).
  permanentUpgrades: Record<UpgradeId, number>;
  coreData: number; // spendable prestige currency
  lifetimeCoreData: number;
  // Highest raw core-data entitlement already claimed by a prestige. Only the
  // delta above this is granted, so prestiging repeatedly at the same lifetime
  // credits yields nothing (prevents farming Core Data).
  prestigeGranted: number;
  // Unlocked achievements (pure trophies). Kept across prestiges.
  achievements: Record<AchievementId, boolean>;
  stats: GameStats;
  flags: {
    autoSellUnlocked: boolean;
    autoBuyUnlocked: boolean;
    analyticsUnlocked: boolean;
    autoResearchUnlocked: boolean;
  };
  // Transient (recomputed each tick, persisted harmlessly).
  rates: LiveRates;
}
