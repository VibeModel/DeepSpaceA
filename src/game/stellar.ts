// Second-layer (ascension) upgrades — pure logic. May only depend on
// balance / types / num so the dependency graph stays acyclic: research.ts
// and buildings.ts import the *Modifiers() helpers from here, never the other
// way around.
import { STELLAR_UPGRADES, STELLAR_COST_GROWTH, CONTRACT_MAX_ACTIVE } from "./balance";
import { capNumber, safePow } from "./num";
import type { GameState, StellarUpgradeId, StellarUpgradeDefinition } from "./types";

export const STELLAR_UPGRADE_IDS = Object.keys(STELLAR_UPGRADES) as StellarUpgradeId[];

// Exhaustive default map (every id present). MUST be exhaustive: the save loader
// only deep-merges keys already present on the default, so a missing key would
// silently drop a player's level on load.
export function emptyStellarUpgradeMap(): Record<StellarUpgradeId, number> {
  const out = {} as Record<StellarUpgradeId, number>;
  for (const id of STELLAR_UPGRADE_IDS) out[id] = 0;
  return out;
}

export function getStellarUpgrade(id: StellarUpgradeId): StellarUpgradeDefinition {
  return STELLAR_UPGRADES[id];
}

export function stellarLevel(state: GameState, id: StellarUpgradeId): number {
  return state.stellarUpgrades?.[id] || 0;
}

export function isInfiniteStellar(id: StellarUpgradeId): boolean {
  return getStellarUpgrade(id).infinite === true;
}

// Cost of the NEXT level. Finite upgrades are flat; repeatable ones grow
// exponentially with the current level.
export function stellarCost(state: GameState, id: StellarUpgradeId): number {
  const def = getStellarUpgrade(id);
  if (!def.infinite) return def.cost;
  return capNumber(def.cost * safePow(STELLAR_COST_GROWTH, stellarLevel(state, id)));
}

export function stellarMaxed(state: GameState, id: StellarUpgradeId): boolean {
  if (isInfiniteStellar(id)) return false;
  return stellarLevel(state, id) >= 1;
}

export function canBuyStellarUpgrade(state: GameState, id: StellarUpgradeId): boolean {
  if (stellarMaxed(state, id)) return false;
  return state.stellarCharts >= stellarCost(state, id);
}

export function buyStellarUpgrade(state: GameState, id: StellarUpgradeId): boolean {
  if (!canBuyStellarUpgrade(state, id)) return false;
  state.stellarCharts = capNumber(state.stellarCharts - stellarCost(state, id));
  state.stellarUpgrades[id] = stellarLevel(state, id) + 1;
  return true;
}

export interface StellarModifiers {
  globalProdMult: number;
  costMult: number; // building cost multiplier
  prestigeGainMult: number; // layer-1 payoff
  chartGainMult: number; // layer-2 payoff
  stargateCostMult: number;
  contractSlots: number;
  autoPrestige: boolean;
  memory: boolean;
}

export function stellarModifiers(state: GameState): StellarModifiers {
  const lv = state.stellarUpgrades;
  const n = (id: StellarUpgradeId): number => lv?.[id] ?? 0;
  return {
    globalProdMult: 1 + 0.2 * n("chartIndustry"),
    costMult: safePow(1 - 0.04, n("chartEconomy")), // 0.96^n
    prestigeGainMult: 1 + 0.1 * n("chartPrestige"),
    chartGainMult: 1 + 0.1 * n("chartCharts"),
    stargateCostMult: safePow(1 - 0.05, n("chartStargate")), // 0.95^n
    contractSlots: CONTRACT_MAX_ACTIVE + n("chartContracts"),
    autoPrestige: n("chartAutoPrestige") > 0,
    memory: n("chartMemory") > 0,
  };
}

// Narrow helper for buildings.ts (which does NOT go through computeModifiers).
export function stellarCostMult(state: GameState): number {
  return stellarModifiers(state).costMult;
}
