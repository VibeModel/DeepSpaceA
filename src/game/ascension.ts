// Second layer (ascension). Reached once enough lifetime Core Data has accrued;
// grants "stellar charts" and wipes layer-1 progress (Core Data + permanent
// upgrades + the whole run), while keeping the megastructure and the chart tree.
import { ASCENSION_THRESHOLD_CORE, CHART_DIVISOR } from "./balance";
import { computeModifiers, applyTechUnlocks } from "./research";
import { freshRunState, applyRunStartBonuses } from "./state";
import { snapshotMeta, restoreMeta } from "./prestige";
import { capNumber } from "./num";
import type { GameState, UpgradeId } from "./types";

// Fraction of permanent-upgrade levels kept across an ascension IF the player
// owns the "Memory Recall" chart upgrade.
const MEMORY_KEEP = 0.25;

// Raw chart entitlement from lifetime Core Data, BEFORE the gain multiplier.
// lifetimeCoreData is monotonic, so the delta above what was already claimed is
// what an ascension grants (prevents farming charts at the same total).
export function rawChartEntitlement(state: GameState): number {
  return Math.floor(Math.sqrt(state.lifetimeCoreData / CHART_DIVISOR));
}

export function pendingCharts(state: GameState): number {
  const mods = computeModifiers(state);
  const raw = rawChartEntitlement(state) - state.chartsGranted;
  if (raw <= 0) return 0;
  return capNumber(Math.floor(raw * mods.chartGainMult));
}

export function canAscend(state: GameState): boolean {
  return (
    state.lifetimeCoreData >= ASCENSION_THRESHOLD_CORE && pendingCharts(state) > 0
  );
}

// Perform an ascension. Returns the charts gained (0 = nothing to claim).
export function doAscend(state: GameState): number {
  const gained = pendingCharts(state);
  if (gained <= 0) return 0;

  state.stellarCharts = capNumber(state.stellarCharts + gained);
  state.lifetimeStellarCharts = capNumber(state.lifetimeStellarCharts + gained);

  const snap = snapshotMeta(state);
  const keepMemory = (snap.stellarUpgrades?.chartMemory ?? 0) > 0;
  const prevUpgrades = { ...snap.permanentUpgrades };

  // Reset the run, then restore everything persistent.
  Object.assign(state, freshRunState());
  restoreMeta(state, snap);

  // Layer-2 reset wipes layer-1 progress: Core Data, blueprints and (unless the
  // Memory Recall chart is owned) the permanent-upgrade levels.
  const scaled = { ...state.permanentUpgrades };
  for (const k of Object.keys(scaled) as UpgradeId[]) {
    scaled[k] = keepMemory ? Math.floor((prevUpgrades[k] ?? 0) * MEMORY_KEEP) : 0;
  }
  state.permanentUpgrades = scaled;
  state.coreData = 0;
  state.blueprints = 0;

  // Claim the raw entitlement now; future ascensions only grant the delta above.
  state.chartsGranted = rawChartEntitlement(state);
  state.ascensionCount += 1;
  state.stats.currentRunStart = Date.now();

  applyRunStartBonuses(state);
  applyTechUnlocks(state);
  return gained;
}
