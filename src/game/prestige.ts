import {
  PRESTIGE_THRESHOLD_CREDITS,
  PRESTIGE_DIVISOR,
} from "./balance";
import { computeModifiers, applyTechUnlocks } from "./research";
import type { GameState } from "./types";
import { freshRunState } from "./state";

// Core Data the player would gain if they prestiged right now.
export function pendingCoreData(state: GameState): number {
  const mods = computeModifiers(state);
  const raw = Math.floor(
    Math.sqrt(state.stats.lifetimeCredits / PRESTIGE_DIVISOR),
  );
  return Math.max(0, Math.floor(raw * mods.prestigeGainMult));
}

export function canPrestige(state: GameState): boolean {
  return (
    state.stats.lifetimeCredits >= PRESTIGE_THRESHOLD_CREDITS &&
    pendingCoreData(state) > 0
  );
}

// Stellar Reboot: reset the current run but keep Core Data, permanent
// upgrades and lifetime statistics.
export function doPrestige(state: GameState): number {
  const gained = pendingCoreData(state);
  if (gained <= 0) return 0;

  state.coreData += gained;
  state.lifetimeCoreData += gained;

  // Snapshot persistent fields.
  const coreData = state.coreData;
  const lifetimeCoreData = state.lifetimeCoreData;
  const permanentUpgrades = state.permanentUpgrades;
  const stats = state.stats;

  // Reset run-specific state.
  Object.assign(state, freshRunState());

  // Restore persistent fields.
  state.coreData = coreData;
  state.lifetimeCoreData = lifetimeCoreData;
  state.permanentUpgrades = permanentUpgrades;
  state.stats = stats;

  // Prestige bookkeeping.
  state.stats.prestigeCount += 1;
  state.stats.currentRunStart = Date.now();

  // Re-apply run-start permanent bonuses (e.g. Faster Boot).
  if (state.permanentUpgrades.fasterBoot) {
    state.buildings.miningDrone = 2;
  }
  // Techs were wiped by the reset, so recompute unlock flags from any
  // permanent upgrades that grant them (e.g. Automated Logistics).
  applyTechUnlocks(state);

  return gained;
}
