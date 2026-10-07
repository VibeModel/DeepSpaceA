import { UPGRADES, UPGRADE_COST_GROWTH } from "./balance";
import type { GameState, UpgradeId, UpgradeDefinition } from "./types";
import { applyTechUnlocks } from "./research";
import { capNumber, safePow } from "./num";

export const UPGRADE_LIST: UpgradeDefinition[] = Object.values(UPGRADES);

export function getUpgrade(id: UpgradeId): UpgradeDefinition {
  return UPGRADES[id];
}

// A repeatable permanent upgrade can be upgraded indefinitely.
export function isInfiniteUpgrade(id: UpgradeId): boolean {
  return getUpgrade(id).infinite === true;
}

export function upgradeLevel(state: GameState, id: UpgradeId): number {
  return state.permanentUpgrades[id] || 0;
}

// Cost of the NEXT level. Finite upgrades have a flat cost; repeatable ones
// cost base * GROWTH^level.
export function upgradeCost(state: GameState, id: UpgradeId): number {
  const def = getUpgrade(id);
  if (!def.infinite) return def.cost;
  return capNumber(def.cost * safePow(UPGRADE_COST_GROWTH, upgradeLevel(state, id)));
}

// Finite upgrades are "maxed" once owned; repeatable ones never are.
export function upgradeMaxed(state: GameState, id: UpgradeId): boolean {
  if (isInfiniteUpgrade(id)) return false;
  return upgradeLevel(state, id) >= 1;
}

// Wallet an upgrade is bought from: core data (legacy default) or blueprints.
export function upgradeCurrency(id: UpgradeId): "coreData" | "blueprints" {
  return getUpgrade(id).currency ?? "coreData";
}

function wallet(state: GameState, id: UpgradeId): number {
  return upgradeCurrency(id) === "blueprints" ? state.blueprints : state.coreData;
}

export function canBuyUpgrade(state: GameState, id: UpgradeId): boolean {
  if (upgradeMaxed(state, id)) return false;
  return wallet(state, id) >= upgradeCost(state, id);
}

export function buyUpgrade(state: GameState, id: UpgradeId): boolean {
  if (!canBuyUpgrade(state, id)) return false;
  const cost = upgradeCost(state, id);
  if (upgradeCurrency(id) === "blueprints") {
    state.blueprints = capNumber(state.blueprints - cost);
  } else {
    state.coreData -= cost;
  }
  state.permanentUpgrades[id] = upgradeLevel(state, id) + 1;
  applyTechUnlocks(state);
  return true;
}
