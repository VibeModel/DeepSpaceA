import {
  PRESTIGE_THRESHOLD_CPS,
  PRESTIGE_CPS_DIVISOR,
} from "./balance";
import { computeModifiers, applyTechUnlocks } from "./research";
import type { GameState, PlanetId } from "./types";
import { freshRunState, applyRunStartBonuses } from "./state";
import { capNumber } from "./num";
import { planetUnlocked } from "./planets";

// Fields that survive a prestige (layer 1) — and an ascension (layer 2). This is
// the exact complement of freshRunState()'s Omit list; keep the two in sync so a
// new persistent field is never silently wiped by a reset.
export const META_KEYS = [
  "coreData",
  "lifetimeCoreData",
  "blueprints",
  "permanentUpgrades",
  "achievements",
  "stats",
  "nextPlanet",
  // Megastructure + second layer (survive BOTH resets).
  "stargateLevel",
  "stellarCharts",
  "lifetimeStellarCharts",
  "chartsGranted",
  "stellarUpgrades",
  "ascensionCount",
  "rngSeed",
] as const satisfies readonly (keyof GameState)[];

export type MetaSnapshot = Pick<GameState, (typeof META_KEYS)[number]>;

export function snapshotMeta(s: GameState): MetaSnapshot {
  const out = {} as MetaSnapshot;
  for (const k of META_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out;
}

export function restoreMeta(s: GameState, snap: MetaSnapshot): void {
  for (const k of META_KEYS) (s as unknown as Record<string, unknown>)[k] = snap[k];
}

// Raw core-data entitlement from THIS RUN's peak credit income, BEFORE the gain
// multiplier. Run-scoped: each run pays out on its own merit, so prestiging
// frequently never forfeits anything (the old lifetime-delta model did).
function rawEntitlement(state: GameState): number {
  return Math.floor(Math.sqrt(state.runPeakCreditsPerSec / PRESTIGE_CPS_DIVISOR));
}

// Core Data the player would gain if they prestiged right now.
export function pendingCoreData(state: GameState): number {
  const mods = computeModifiers(state);
  const raw = rawEntitlement(state);
  if (raw <= 0) return 0;
  return capNumber(Math.floor(raw * mods.prestigeGainMult));
}

export function canPrestige(state: GameState): boolean {
  return (
    state.runPeakCreditsPerSec >= PRESTIGE_THRESHOLD_CPS &&
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

  // Snapshot every persistent field, then reset the run and restore them.
  const meta = snapshotMeta(state);

  // Reset run-specific state (planet back to homeworld, regions cleared, run
  // peak income zeroed so the next run starts its own tally).
  Object.assign(state, freshRunState());

  // Restore persistent fields.
  restoreMeta(state, meta);

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

  // Re-apply run-start permanent bonuses (e.g. Faster Boot / Assembler Boot).
  applyRunStartBonuses(state);
  // Techs were wiped by the reset, so recompute unlock flags from any
  // permanent upgrades that grant them (e.g. Automated Logistics).
  applyTechUnlocks(state);

  return gained;
}
