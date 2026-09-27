import {
  TECHS,
  UPGRADES,
  INFINITE_TECH_COST_GROWTH,
  MAX_TECH_LEVEL,
} from "./balance";
import { capNumber, safePow } from "./num";
import type {
  GameState,
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
  miningMult: number;
  smeltMult: number;
  factoryMult: number;
  researchMult: number;
  steelYieldMult: number;
  componentYieldMult: number;
  globalProdMult: number;
  costGrowthReduction: number;
  labUpkeepReduction: number;
  unlockAutoSell: boolean;
  unlockAutoBuy: boolean;
  unlockAnalytics: boolean;
  unlockAutoResearch: boolean;
  prestigeGainMult: number;
}

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
    miningMult: 1,
    smeltMult: 1,
    factoryMult: 1,
    researchMult: 1,
    steelYieldMult: 1,
    componentYieldMult: 1,
    globalProdMult: 1,
    costGrowthReduction: 0,
    labUpkeepReduction: 0,
    unlockAutoSell: false,
    unlockAutoBuy: false,
    unlockAnalytics: false,
    unlockAutoResearch: false,
    prestigeGainMult: 1,
  };

  // Industrial Engineering (repeatable numeric techs use level-scaled `inf`).
  m.miningMult *= inf("highPressureDrill");
  m.steelYieldMult *= inf("advancedAlloys");
  m.componentYieldMult *= inf("precisionMfg");
  m.globalProdMult *= inf("massProduction");
  m.miningMult *= inf("overclockedDrills");

  // Automation
  m.smeltMult *= inf("automatedSmelting");
  m.factoryMult *= inf("automatedAssembly");
  if (t.automatedTrading) m.unlockAutoSell = true;
  if (t.autoBuyLogic) m.unlockAutoBuy = true;
  if (t.smartLogistics) m.costGrowthReduction += 0.05;

  // Computing
  m.researchMult *= inf("researchMethodology");
  if (t.productionAnalytics) m.unlockAnalytics = true;
  if (t.efficientLabs) m.labUpkeepReduction += 0.3;
  m.researchMult *= inf("quantumComputing");
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
  m.researchMult *= pu("researchArchive");
  if (p.automatedLogistics) m.unlockAutoSell = true;

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
