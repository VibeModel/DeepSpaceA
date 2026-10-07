// Shared type definitions for the game.

export type ResourceId =
  | "ore"
  | "steel"
  | "components"
  | "credits"
  | "research"
  // Copper chain (Factorio-style intermediates added by the recipe system).
  | "copperOre"
  | "copper"
  | "circuit"
  | "alloy";

export type BuildingId =
  | "miningDrone"
  | "solarArray"
  | "copperMine"
  | "furnace"
  | "factory"
  | "assembler"
  | "laboratory";

// Resources the player can sell for credits. The copper-chain products are
// sellable too, so the deep chain feeds the main economy instead of being a
// closed loop (it only used to yield blueprints).
export type SellableResource =
  | "ore"
  | "steel"
  | "components"
  | "copper"
  | "circuit"
  | "alloy";

// Recipes turn processors into "machine + chosen recipe". Machines run exactly
// one recipe at a time; multi-input recipes are the core of the chain feel.
export type RecipeId =
  | "smeltSteel"
  | "smeltCopper"
  | "makeComponents"
  | "makeCircuit"
  | "makeAlloy"
  | "synthesizeBlueprint";

// A recipe output is either a run resource or the persistent "blueprints"
// currency (the sink that makes the new chain worthwhile).
export type RecipeOutputId = ResourceId | "blueprints";

export interface RecipeInput {
  res: ResourceId;
  amount: number;
}

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  icon: string;
  description: string;
  // Which building executes this recipe.
  machine: BuildingId;
  inputs: readonly RecipeInput[];
  output: RecipeOutputId;
  outputAmount: number;
  // Base batches per second per machine (before machine/yield modifiers).
  speed: number;
  // Omitted = available from the start; otherwise gated behind a tech.
  unlockTech?: TechId;
}

export type TechId =
  // Industrial Engineering
  | "highPressureDrill"
  | "advancedAlloys"
  | "precisionMfg"
  | "massProduction"
  | "overclockedDrills"
  | "copperProcessing"
  | "circuitFabrication"
  | "alloySynthesis"
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
  | "researchArchive"
  // Blueprint-currency upgrades (crafted by the copper/circuit chain).
  | "copperExtractor"
  | "circuitOverclock"
  | "alloyMastery"
  | "assemblerBoot";

// Second-layer (ascension) upgrades, bought with "stellar charts". These are
// the branchy meta tree that survives a layer-2 reset.
export type StellarUpgradeId =
  | "chartIndustry"
  | "chartEconomy"
  | "chartPrestige"
  | "chartCharts"
  | "chartStargate"
  | "chartContracts"
  | "chartAutoPrestige"
  | "chartMemory";

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
  | "timeTraveler"
  // Copper / recipe chain
  | "firstCopper"
  | "circuitMaker"
  | "alloySmith"
  | "blueprintArchitect";

// Planets and their upgradable regions. A planet is chosen at prestige time and
// applies a set of multipliers for the whole run; regions are per-run growth
// bought with credits (a second progression axis beside buildings/techs).
export type PlanetId = "homeworld" | "ferrum" | "pyra" | "cryon";

export type RegionId =
  | "miningField"
  | "foundry"
  | "powerGrid"
  | "researchPark"
  | "logisticsHub";

// Multiplicative modifiers contributed by a planet and/or its regions. Missing
// fields are treated as "no effect" (multiplier 1) when aggregated.
export interface PlanetModifiers {
  miningMult?: number;
  smeltMult?: number;
  factoryMult?: number;
  researchMult?: number;
  steelYieldMult?: number;
  componentYieldMult?: number;
  globalProdMult?: number;
  powerSupplyMult?: number;
  costMult?: number; // building cost multiplier
  prestigeGainMult?: number;
}

export interface PlanetDefinition {
  id: PlanetId;
  name: string;
  icon: string;
  description: string;
  modifiers: PlanetModifiers;
  // Empty object = always unlocked. Otherwise every listed criterion must hold.
  unlock: { prestigeCount?: number; lifetimeCoreData?: number };
}

export interface RegionEffect {
  modKey: keyof PlanetModifiers;
  // Multiplicative: level n contributes a (1 + perLevel * n) multiplier.
  perLevel: number;
}

export interface RegionDefinition {
  id: RegionId;
  name: string;
  icon: string;
  description: string;
  // Omitted = available on every planet. Otherwise restricted to the listed set.
  planets?: readonly PlanetId[];
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
  effects: readonly RegionEffect[];
}

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
  // Processors (furnace / factory / assembler) no longer carry input/output
  // here — that lives in RECIPES and is selected per run via state.activeRecipe.
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
  cost: number; // cost of the first level, in the upgrade's currency
  // Wallet: "coreData" (default, legacy) or "blueprints" (crafted by the chain).
  currency?: "coreData" | "blueprints";
  // Repeatable permanent upgrades: after the first purchase they can be
  // upgraded indefinitely with an escalating cost.
  infinite?: boolean;
  effectPerLevel?: number;
}

// Second-layer upgrade definition (bought with stellar charts). Shaped like the
// permanent upgrades but kept separate so the two trees can evolve apart.
export interface StellarUpgradeDefinition {
  id: StellarUpgradeId;
  name: string;
  icon: string;
  description: string;
  cost: number;
  infinite?: boolean;
  effectPerLevel?: number;
}

// ---------------------------------------------------------------------------
// Random events (automatic, ticked in SIMULATED time) and contracts (manual,
// ticked in ONLINE wall-clock time).
// ---------------------------------------------------------------------------
export type EventId =
  | "richVein"
  | "marketBoom"
  | "researchSurge"
  | "solarFlare"
  | "ionStorm"
  | "supplyGlut";

// Multiplicative contributions of an event. Every field is optional and read as
// "no effect" (×1) when absent.
export interface EventEffect {
  prodMult?: number; // multiplies global production
  sellMult?: number; // multiplies sell prices
  powerMult?: number; // multiplies power supply
  researchMult?: number; // multiplies laboratory research output
}

export interface EventDefinition {
  id: EventId;
  name: string;
  icon: string;
  description: string;
  weight: number; // relative spawn weight
  good: boolean; // buff (true) vs debuff (false) — drives the UI colour
  durationMult?: number; // scales EVENT_DURATION_SEC
  effect: EventEffect;
}

// A live event on the board. `remaining`/`total` are in simulated seconds.
export interface ActiveEvent {
  id: EventId;
  remaining: number;
  total: number;
}

// A delivery order. Offers (in `contractOffers`) count down their accept
// window; accepted ones (in `activeContracts`) count down their deadline. Both
// timers advance on ONLINE wall-clock time only.
export interface Contract {
  id: number;
  resource: SellableResource;
  amount: number;
  reward: number; // credits paid on delivery
  remaining: number;
  total: number;
}

// Per-processor live readout (one entry per building, zero-filled for machines
// that are not processors).
export interface ProcessorRate {
  // Design capacity in the PRIMARY input's units/s (first input of the recipe).
  // Used for the "input / capacity" display so it reads like the old furnace.
  cap: number;
  // Actual primary-input units/s consumed.
  input: number;
  // Design capacity in batches/s and the actual batches/s (the real math).
  capBatches: number;
  throughput: number;
  util: number; // throughput / capBatches (0..1)
  yield: number; // output multiplier applied per batch (incl. yield techs)
  // Actual consumption per second of each input resource.
  perInput: Record<ResourceId, number>;
  // Starved by an input (has spare capacity but nothing to process).
  shortage: boolean;
  // Upstream produces the primary input faster than this machine can consume.
  accumulating: boolean;
}

export interface LiveRates {
  // Gross production per second for every resource (mining/copper/lab output
  // plus every processor's output).
  production: Record<ResourceId, number>;
  // Net inventory change per second (includes the persistent "blueprints").
  net: Record<RecipeOutputId, number>;
  // One entry per recipe (a recipe belongs to exactly one machine). Sparse
  // allocations leave the unused recipes zeroed, which the UI hides.
  processors: Record<RecipeId, ProcessorRate>;
  // Power grid: supply (capacity), demand and the resulting throttle factor
  // (1 = fine, <1 = brownout scaling every production/consumption rate).
  powerSupply: number;
  powerDemand: number;
  powerFactor: number;
  // Whether the laboratories are currently running (paid their upkeep).
  labActive: boolean;
}

export interface GameStats {
  currentRunStart: number;
  lifetimePlayTime: number; // ms
  totalOre: number;
  totalSteel: number;
  totalComponents: number;
  totalCopperOre: number;
  totalCopper: number;
  totalCircuit: number;
  totalAlloy: number;
  totalBlueprints: number;
  lifetimeCredits: number; // gross credits earned (drives prestige)
  buildingsPurchased: number;
  prestigeCount: number;
  bestCreditsPerSec: number;
}

export interface GameState {
  version: number;
  timestamp: number;
  lastTick: number;
  resources: Record<ResourceId, number>;
  buildings: Record<BuildingId, number>;
  // Tech level per tech: 0 = not researched, 1 = unlocked, >1 = upgraded
  // (only repeatable/infinite techs can exceed 1).
  techs: Record<TechId, number>;
  // Recipe allocation per machine: a non-negative weight per recipe. A machine's
  // unit count is split across its recipes in proportion to these weights (so
  // 20 furnaces with {steel:3, copper:1} => 15 on steel, 5 on copper). An all
  // -zero (or absent) entry means "run the default recipe at full count".
  // Reset each run; the fallback lives in recipes.ts.
  recipeMix: Record<BuildingId, Partial<Record<RecipeId, number>>>;
  autoSell: Record<SellableResource, boolean>;
  autoBuy: Record<BuildingId, boolean>;
  autoResearch: boolean;
  // Permanent upgrade level: 0 = not owned, 1 = owned, >1 = upgraded (only
  // repeatable permanent upgrades can exceed 1).
  permanentUpgrades: Record<UpgradeId, number>;
  coreData: number; // spendable prestige currency
  lifetimeCoreData: number;
  // Persistent "blueprints" currency crafted by the copper/circuit chain and
  // spent on the blueprint permanent upgrades. Kept across prestiges.
  blueprints: number;
  // Peak credit income (credits/s) reached during the CURRENT run. Drives the
  // prestige reward and is reset each run, so every run pays out on its own
  // merit (prestiging often no longer forfeits anything).
  runPeakCreditsPerSec: number;
  // ---- Megastructure (stargate) + second-layer meta. All persist across both
  // prestige (layer 1) and ascension (layer 2). ----
  // Completed stargate tiers. Unbounded; each tier consumes the whole chain and
  // grants a permanent multiplier.
  stargateLevel: number;
  // "Stellar charts": the layer-2 currency, earned by an ascension.
  stellarCharts: number;
  lifetimeStellarCharts: number;
  // Highest raw chart entitlement already claimed (prevents farming).
  chartsGranted: number;
  // Level per second-layer upgrade.
  stellarUpgrades: Record<StellarUpgradeId, number>;
  ascensionCount: number;
  // Seed/state of the deterministic PRNG (events etc.).
  rngSeed: number;
  // ---- Random events (run-scoped, simulated time) ----
  // Live temporary modifiers. Wiped by every run reset.
  activeEvents: ActiveEvent[];
  // Simulated seconds until the next event spawn.
  eventSpawnIn: number;
  // ---- Contracts (run-scoped, online wall-clock time) ----
  contractOffers: Contract[];
  activeContracts: Contract[];
  // Online seconds until the next offer is generated.
  contractSpawnIn: number;
  // Monotonic id source for offers (only needs to be unique within a run).
  nextContractId: number;
  // Planet the CURRENT run is played on. Reset to "homeworld" each prestige.
  planet: PlanetId;
  // Destination chosen for the NEXT prestige. Persists across prestiges so the
  // selection survives the run reset.
  nextPlanet: PlanetId;
  // Region upgrade levels for the current planet. Reset each prestige.
  regions: Record<RegionId, number>;
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
