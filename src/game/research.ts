import { TECHS } from "./balance";
import type { GameState, TechId, TechDefinition } from "./types";

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
  prestigeGainMult: number;
}

// Derive all numeric/mechanic modifiers from the set of purchased techs plus
// permanent upgrades. Centralising this keeps simulation simple.
export function computeModifiers(state: GameState): TechModifiers {
  const t = state.techs;
  const p = state.permanentUpgrades;

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
    prestigeGainMult: 1,
  };

  // Industrial Engineering
  if (t.highPressureDrill) m.miningMult *= 1.5;
  if (t.advancedAlloys) m.steelYieldMult *= 1.25;
  if (t.precisionMfg) m.componentYieldMult *= 1.25;
  if (t.massProduction) m.globalProdMult *= 1.25;
  if (t.overclockedDrills) m.miningMult *= 1.5;

  // Automation
  if (t.automatedSmelting) m.smeltMult *= 1.5;
  if (t.automatedAssembly) m.factoryMult *= 1.5;
  if (t.automatedTrading) m.unlockAutoSell = true;
  if (t.autoBuyLogic) m.unlockAutoBuy = true;
  if (t.smartLogistics) m.costGrowthReduction += 0.05;

  // Computing
  if (t.researchMethodology) m.researchMult *= 1.5;
  if (t.productionAnalytics) m.unlockAnalytics = true;
  if (t.efficientLabs) m.labUpkeepReduction += 0.3;
  if (t.quantumComputing) m.researchMult *= 2;
  if (t.coreSynthesis) m.prestigeGainMult *= 1.5;

  // Permanent upgrades
  if (p.industrialMemory) m.globalProdMult *= 1.2;
  if (p.researchArchive) m.researchMult *= 1.25;
  if (p.automatedLogistics) m.unlockAutoSell = true;

  return m;
}

// All prerequisites satisfied (regardless of cost)?
export function techPrereqMet(state: GameState, id: TechId): boolean {
  return TECHS[id].requires.every((req) => state.techs[req]);
}

export function canResearch(state: GameState, id: TechId): boolean {
  if (state.techs[id]) return false;
  if (!techPrereqMet(state, id)) return false;
  return state.resources.research >= TECHS[id].cost;
}

export function researchTech(state: GameState, id: TechId): boolean {
  if (!canResearch(state, id)) return false;
  state.resources.research -= TECHS[id].cost;
  state.techs[id] = true;
  applyTechUnlocks(state);
  return true;
}

// Apply the "unlock" type techs/upgrades to the flags object.
export function applyTechUnlocks(state: GameState): void {
  const mods = computeModifiers(state);
  state.flags.autoSellUnlocked = mods.unlockAutoSell;
  state.flags.autoBuyUnlocked = mods.unlockAutoBuy;
  state.flags.analyticsUnlocked = mods.unlockAnalytics;
}
