import {
  PRESTIGE_THRESHOLD_CREDITS,
  PRESTIGE_DIVISOR,
} from "./balance";
import { computeModifiers, applyTechUnlocks } from "./research";
import type { GameState, PlanetId } from "./types";
import { freshRunState } from "./state";
import { capNumber } from "./num";
import { planetUnlocked } from "./planets";

// Raw core-data entitlement from lifetime credits, BEFORE the gain multiplier.
// Lifetime credits are cumulative and never reset, so the entitlement only ever
// grows; the delta above what was already claimed is what a prestige grants.
function rawEntitlement(state: GameState): number {
  return Math.floor(Math.sqrt(state.stats.lifetimeCredits / PRESTIGE_DIVISOR));
}

// Core Data the player would gain if they prestiged right now. Only the part not
// already claimed counts, so a prestige at the same lifetime credits yields 0.
export function pendingCoreData(state: GameState): number {
  const mods = computeModifiers(state);
  const pendingRaw = rawEntitlement(state) - state.prestigeGranted;
  if (pendingRaw <= 0) return 0;
  return capNumber(Math.floor(pendingRaw * mods.prestigeGainMult));
}

export function canPrestige(state: GameState): boolean {
  return (
    state.stats.lifetimeCredits >= PRESTIGE_THRESHOLD_CREDITS &&
    pendingCoreData(state) > 0
  );
}

// Stellar Reboot: reset the current run but keep Core Data, permanent
// upgrades and lifetime statistics. `targetPlanet` selects the destination for
// the new run (must already be unlocked; otherwise the stored `nextPlanet` or
// homeworld is used). Region levels are wiped along with the run.
export function doPrestige(state: GameState, targetPlanet?: PlanetId): number {
  const gained = pendingCoreData(state);
  if (gained <= 0) return 0;

  state.coreData += gained;
  state.lifetimeCoreData += gained;

  // Snapshot persistent fields.
  const coreData = state.coreData;
  const lifetimeCoreData = state.lifetimeCoreData;
  const permanentUpgrades = state.permanentUpgrades;
  const achievements = state.achievements;
  const stats = state.stats;
  const nextPlanet = state.nextPlanet;
  // Claim the raw entitlement now; future prestiges only grant the delta above it.
  const claimed = rawEntitlement(state);

  // Reset run-specific state (planet back to homeworld, regions cleared).
  Object.assign(state, freshRunState());

  // Restore persistent fields.
  state.coreData = coreData;
  state.lifetimeCoreData = lifetimeCoreData;
  state.permanentUpgrades = permanentUpgrades;
  state.achievements = achievements;
  state.stats = stats;
  state.nextPlanet = nextPlanet;
  state.prestigeGranted = claimed;

  // Land the new run on the chosen planet (falling back safely if it is not
  // actually unlocked). The selection is applied exactly here — never mid-run —
  // so the player cannot cherry-pick planet bonuses within a run.
  const dest =
    targetPlanet && planetUnlocked(state, targetPlanet)
      ? targetPlanet
      : state.nextPlanet;
  state.planet = planetUnlocked(state, dest) ? dest : "homeworld";
  state.nextPlanet = state.planet;

  // Prestige bookkeeping.
  state.stats.prestigeCount += 1;
  state.stats.currentRunStart = Date.now();

  // Re-apply run-start permanent bonuses (e.g. Faster Boot).
  const fb = state.permanentUpgrades.fasterBoot || 0;
  if (fb > 0) {
    state.buildings.miningDrone = 2 * fb;
  }
  // Techs were wiped by the reset, so recompute unlock flags from any
  // permanent upgrades that grant them (e.g. Automated Logistics).
  applyTechUnlocks(state);

  return gained;
}
