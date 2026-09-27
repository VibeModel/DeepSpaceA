import { UPGRADES } from "./balance";
import type { GameState, UpgradeId, UpgradeDefinition } from "./types";
import { applyTechUnlocks } from "./research";

export const UPGRADE_LIST: UpgradeDefinition[] = Object.values(UPGRADES);

export function getUpgrade(id: UpgradeId): UpgradeDefinition {
  return UPGRADES[id];
}

export function canBuyUpgrade(state: GameState, id: UpgradeId): boolean {
  if (state.permanentUpgrades[id]) return false;
  return state.coreData >= UPGRADES[id].cost;
}

export function buyUpgrade(state: GameState, id: UpgradeId): boolean {
  if (!canBuyUpgrade(state, id)) return false;
  state.coreData -= UPGRADES[id].cost;
  state.permanentUpgrades[id] = true;
  applyTechUnlocks(state);
  return true;
}
