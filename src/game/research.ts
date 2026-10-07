import {
  TECHS,
  UPGRADES,
  INFINITE_TECH_COST_GROWTH,
  MAX_TECH_LEVEL,
  RESOURCE_IDS,
} from "./balance";
import { capNumber, safePow } from "./num";
import { RECIPE_LIST } from "./recipes";
import { planetRegionModifiers } from "./planets";
import { stargateModifiers } from "./stargate";
import { stellarModifiers } from "./stellar";
import { eventModifiers } from "./events";
import type {
  GameState,
  ResourceId,
  RecipeId,
  TechId,
  TechDefinition,
  UpgradeId,
  UpgradeDefinition,
} from "./types";

export const TECH_LIST: TechDefinition[] = Object.values(TECHS);

export function getTech(id: TechId): TechDefinition {
  return TECHS[id];
}

export interface TechModifiers {
  // Producers (mining drone / copper mine / laboratory) indexed by resource.
  producerMult: Record<ResourceId, number>;
  // Processors indexed by recipe.
  recipeSpeedMult: Record<RecipeId, number>;
  recipeYieldMult: Record<RecipeId, number>;
  globalProdMult: number;
  costGrowthReduction: number;
  costMult: number;
  labUpkeepReduction: number;
  powerSupplyMult: number;
  unlockAutoSell: boolean;
  unlockAutoBuy: boolean;
  unlockAnalytics: boolean;
  unlockAutoResearch: boolean;
  prestigeGainMult: number;
  // Sell-price multiplier (random events can raise market prices).
  sellMult: number;
  // Stellar-chart gain multiplier (second-layer upgrades).
  chartGainMult: number;
}

function onesMap<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 1;
  return out;
}

const RECIPE_IDS: RecipeId[] = RECIPE_LIST.map((r) => r.id);
// Recipes run by the furnace-like "smelting" stage vs the factory-like stages.
const SMELT_RECIPES: RecipeId[] = ["smeltSteel", "smeltCopper"];
const FABRICATION_RECIPES: RecipeId[] = [
  "makeComponents",
  "makeCircuit",
  "makeAlloy",
  "synthesizeBlueprint",
];

// Derive all numeric/mechanic modifiers from the set of purchased techs plus
// permanent upgrades. Centralising this keeps simulation simple.
export function computeModifiers(state: GameState): TechModifiers {
  const t = state.techs;
  const p = state.permanentUpgrades;

  // Multiplier contributed by a repeatable ("infinite") tech at its current
  // level: (1 + effectPerLevel * level). Returns 1 when the tech is not owned.
  const inf = (id: TechId): number => {
    const n = t[id] || 0;
    if (n <= 0) return 1;
    return 1 + (getTech(id).effectPerLevel ?? 0) * n;
  };

  const m: TechModifiers = {
    producerMult: onesMap(RESOURCE_IDS),
    recipeSpeedMult: onesMap(RECIPE_IDS),
    recipeYieldMult: onesMap(RECIPE_IDS),
    globalProdMult: 1,
    costGrowthReduction: 0,
    costMult: 1,
    labUpkeepReduction: 0,
    powerSupplyMult: 1,
    unlockAutoSell: false,
    unlockAutoBuy: false,
    unlockAnalytics: false,
    unlockAutoResearch: false,
    prestigeGainMult: 1,
    sellMult: 1,
    chartGainMult: 1,
  };

  // Industrial Engineering.
  m.producerMult.ore *= inf("highPressureDrill");
  m.recipeYieldMult.smeltSteel *= inf("advancedAlloys");
  m.recipeYieldMult.makeComponents *= inf("precisionMfg");
  m.globalProdMult *= inf("massProduction");
  m.producerMult.ore *= inf("overclockedDrills");

  // Automation.
  for (const rid of SMELT_RECIPES) m.recipeSpeedMult[rid] *= inf("automatedSmelting");
  for (const rid of FABRICATION_RECIPES) {
    m.recipeSpeedMult[rid] *= inf("automatedAssembly");
  }
  m.powerSupplyMult *= inf("gridOptimization");
  if (t.automatedTrading) m.unlockAutoSell = true;
  if (t.autoBuyLogic) m.unlockAutoBuy = true;
  if (t.smartLogistics) m.costGrowthReduction += 0.05;

  // Computing.
  m.producerMult.research *= inf("researchMethodology");
  if (t.productionAnalytics) m.unlockAnalytics = true;
  if (t.efficientLabs) m.labUpkeepReduction += 0.3;
  m.producerMult.research *= inf("quantumComputing");
  if (t.coreSynthesis) m.prestigeGainMult *= 1.5;
  if (t.automatedResearch) m.unlockAutoResearch = true;

  // Permanent upgrades (repeatable ones scale with level).
  const pu = (id: UpgradeId): number => {
    const n = p[id] || 0;
    if (n <= 0) return 1;
    const def: UpgradeDefinition = UPGRADES[id];
    return 1 + (def.effectPerLevel ?? 0) * n;
  };
  m.globalProdMult *= pu("industrialMemory");
  m.producerMult.research *= pu("researchArchive");
  if (p.automatedLogistics) m.unlockAutoSell = true;
  // Blueprint (chain) upgrades.
  m.producerMult.copperOre *= pu("copperExtractor");
  for (const rid of ["makeCircuit", "makeAlloy"] as RecipeId[]) {
    m.recipeSpeedMult[rid] *= pu("circuitOverclock");
  }
  for (const rid of ["makeAlloy", "synthesizeBlueprint"] as RecipeId[]) {
    m.recipeYieldMult[rid] *= pu("alloyMastery");
  }

  // Planets + regions: translated from the legacy planet keys onto the
  // recipe/producer maps so planets.ts stays untouched.
  const pr = planetRegionModifiers(state);
  m.producerMult.ore *= pr.miningMult;
  m.producerMult.research *= pr.researchMult;
  for (const rid of SMELT_RECIPES) m.recipeSpeedMult[rid] *= pr.smeltMult;
  for (const rid of FABRICATION_RECIPES) m.recipeSpeedMult[rid] *= pr.factoryMult;
  m.recipeYieldMult.smeltSteel *= pr.steelYieldMult;
  m.recipeYieldMult.makeComponents *= pr.componentYieldMult;
  m.globalProdMult *= pr.globalProdMult;
  m.powerSupplyMult *= pr.powerSupplyMult;
  m.costMult *= pr.costMult;
  m.prestigeGainMult *= pr.prestigeGainMult;

  // Megastructure (stargate) + second-layer (stellar chart) meta. Both are
  // pure functions of persistent state, so folding them here makes every
  // consumer (simulation, power, prestige, contracts) benefit automatically.
  const sg = stargateModifiers(state);
  m.globalProdMult *= sg.globalProdMult;
  m.powerSupplyMult *= sg.powerSupplyMult;
  m.costMult *= sg.costMult;
  const st = stellarModifiers(state);
  m.globalProdMult *= st.globalProdMult;
  m.costMult *= st.costMult;
  m.prestigeGainMult *= st.prestigeGainMult;
  m.chartGainMult *= st.chartGainMult;

  // Live random events — temporary, run-scoped modifiers folded last so they
  // apply on top of everything else (and vanish when the event expires).
  const ev = eventModifiers(state);
  m.globalProdMult *= ev.prodMult;
  m.producerMult.research *= ev.researchMult;
  m.powerSupplyMult *= ev.powerMult;
  m.sellMult *= ev.sellMult;

  return m;
}

// A repeatable tech can be upgraded indefinitely after its first purchase.
export function isInfiniteTech(id: TechId): boolean {
  return getTech(id).infinite === true;
}

// Current level of a tech (0 = not researched).
export function techLevel(state: GameState, id: TechId): number {
  return state.techs[id] || 0;
}

// Cost of the NEXT level. Finite techs have a flat cost; repeatable techs cost
// baseCost * GROWTH^level, which grows exponentially with each purchase.
export function techCost(state: GameState, id: TechId): number {
  const def = getTech(id);
  if (!def.infinite) return def.cost;
  return capNumber(def.cost * safePow(INFINITE_TECH_COST_GROWTH, techLevel(state, id)));
}

// Finite techs are "maxed" once owned; repeatable techs are maxed only at the
// hard level cap (which keeps exponential growth bounded).
export function techMaxed(state: GameState, id: TechId): boolean {
  if (isInfiniteTech(id)) return techLevel(state, id) >= MAX_TECH_LEVEL;
  return techLevel(state, id) >= 1;
}

// All prerequisites satisfied (regardless of cost)?
export function techPrereqMet(state: GameState, id: TechId): boolean {
  return TECHS[id].requires.every((req) => state.techs[req] > 0);
}

export function canResearch(state: GameState, id: TechId): boolean {
  if (techMaxed(state, id)) return false;
  if (!techPrereqMet(state, id)) return false;
  return state.resources.research >= techCost(state, id);
}

export function researchTech(state: GameState, id: TechId): boolean {
  if (!canResearch(state, id)) return false;
  state.resources.research -= techCost(state, id);
  state.techs[id] = techLevel(state, id) + 1;
  applyTechUnlocks(state);
  return true;
}

// Apply the "unlock" type techs/upgrades to the flags object.
export function applyTechUnlocks(state: GameState): void {
  const mods = computeModifiers(state);
  state.flags.autoSellUnlocked = mods.unlockAutoSell;
  state.flags.autoBuyUnlocked = mods.unlockAutoBuy;
  state.flags.analyticsUnlocked = mods.unlockAnalytics;
  state.flags.autoResearchUnlocked = mods.unlockAutoResearch;
}
