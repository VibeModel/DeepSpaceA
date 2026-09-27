import { BUILDINGS, SELL_PRICES, AUTOSELL_RESERVE, MANUAL_MINE_AMOUNT, AUTOBUY_TRIGGER_MULTIPLE, AUTOBUY_MAX_PER_TICK, MAX_OFFLINE_MS } from "./balance";
import type { GameState, BuildingId, SellableResource, ResourceId, LiveRates } from "./types";
import { milestoneMultiplier, buyBuilding, buildingCost } from "./buildings";
import { computeModifiers } from "./research";

// Cap a single simulation step so a long background stall cannot destabilise
// the inventory math. Larger gaps are handled by the offline routine instead.
const MAX_TICK_DT = 300_000; // 5 minutes

const BUILDING_ORDER: BuildingId[] = [
  "miningDrone",
  "furnace",
  "factory",
  "laboratory",
];

function emptyRates(): LiveRates {
  return {
    ore: 0,
    steel: 0,
    components: 0,
    research: 0,
    credits: 0,
    oreProd: 0,
    steelProd: 0,
    compProd: 0,
    researchProd: 0,
    furnaceUtil: 0,
    factoryUtil: 0,
    labActive: false,
    oreShortage: false,
    oreAccumulating: false,
    steelShortage: false,
    steelAccumulating: false,
  };
}

// One simulation step of length dt (seconds). Mutates state in place.
export function simulate(state: GameState, dtMs: number): void {
  let dt = dtMs / 1000;
  if (dt <= 0) return;
  if (dt > MAX_TICK_DT / 1000) dt = MAX_TICK_DT / 1000;

  const mods = computeModifiers(state);
  const res = state.resources;
  const b = state.buildings;

  const before = {
    ore: res.ore,
    steel: res.steel,
    components: res.components,
    credits: res.credits,
    research: res.research,
  };

  const r = emptyRates();

  // 1. Mining — gross ore production.
  const oreRate =
    b.miningDrone *
    BUILDINGS.miningDrone.baseProduction! *
    mods.miningMult *
    milestoneMultiplier("miningDrone", b.miningDrone) *
    mods.globalProdMult;
  res.ore += oreRate * dt;
  r.oreProd = oreRate;

  // 2. Furnace — convert ore into steel (limited by ore on hand).
  const furnaceCap =
    b.furnace *
    BUILDINGS.furnace.inputRate! *
    mods.smeltMult *
    milestoneMultiplier("furnace", b.furnace) *
    mods.globalProdMult;
  const oreToSmelt = Math.min(furnaceCap * dt, res.ore);
  const steelProduced = oreToSmelt * BUILDINGS.furnace.outputYield! * mods.steelYieldMult;
  res.ore -= oreToSmelt;
  res.steel += steelProduced;
  r.steelProd = steelProduced / dt;
  r.furnaceUtil = furnaceCap > 0 ? oreToSmelt / (furnaceCap * dt) : 0;

  // 3. Factory — convert steel into components (limited by steel on hand).
  const factoryCap =
    b.factory *
    BUILDINGS.factory.inputRate! *
    mods.factoryMult *
    milestoneMultiplier("factory", b.factory) *
    mods.globalProdMult;
  const steelToUse = Math.min(factoryCap * dt, res.steel);
  const compProduced = steelToUse * BUILDINGS.factory.outputYield! * mods.componentYieldMult;
  res.steel -= steelToUse;
  res.components += compProduced;
  r.compProd = compProduced / dt;
  r.factoryUtil = factoryCap > 0 ? steelToUse / (factoryCap * dt) : 0;

  // 4. Auto-sell surplus (above reserve). Runs before lab upkeep so selling
  //    can feed the labs.
  const sellPrices = SELL_PRICES;
  const reserves = AUTOSELL_RESERVE;
  let creditsEarned = 0;
  (["ore", "steel", "components"] as SellableResource[]).forEach((rid) => {
    if (!state.autoSell[rid]) return;
    const surplus = res[rid] - reserves[rid];
    if (surplus > 0) {
      const gain = surplus * sellPrices[rid];
      res[rid] -= surplus;
      res.credits += gain;
      creditsEarned += gain;
    }
  });

  // 5. Laboratory — pay credit upkeep, produce research (scaled if short).
  const labCount = b.laboratory;
  const researchRate =
    labCount *
    BUILDINGS.laboratory.baseProduction! *
    mods.researchMult *
    milestoneMultiplier("laboratory", labCount) *
    mods.globalProdMult;
  const upkeep = labCount * BUILDINGS.laboratory.labUpkeep! * (1 - mods.labUpkeepReduction);
  r.researchProd = researchRate;
  if (labCount > 0) {
    const owed = upkeep * dt;
    if (res.credits >= owed) {
      res.credits -= owed;
      res.research += researchRate * dt;
      r.labActive = true;
    } else {
      const factor = owed > 0 ? res.credits / owed : 0;
      res.research += researchRate * dt * factor;
      res.credits = 0;
      r.labActive = factor > 0;
    }
  }

  // 6. Auto-buy (after production so credits are available).
  if (state.flags.autoBuyUnlocked) {
    for (const id of BUILDING_ORDER) {
      if (!state.autoBuy[id]) continue;
      let bought = 0;
      while (bought < AUTOBUY_MAX_PER_TICK) {
        const cost = buildingCost(state, id);
        if (res.credits < cost * AUTOBUY_TRIGGER_MULTIPLE) break;
        if (!buyBuilding(state, id)) break;
        bought++;
      }
    }
  }

  // 7. Net inventory deltas (per second) for display.
  r.ore = (res.ore - before.ore) / dt;
  r.steel = (res.steel - before.steel) / dt;
  r.components = (res.components - before.components) / dt;
  r.research = (res.research - before.research) / dt;
  r.credits = (res.credits - before.credits) / dt;

  // 8. Bottleneck flags.
  r.oreShortage = b.furnace > 0 && r.furnaceUtil < 0.99;
  r.oreAccumulating = b.furnace > 0 && r.oreProd > furnaceCap * 1.001 && furnaceCap > 0;
  r.steelShortage = b.factory > 0 && r.factoryUtil < 0.99;
  r.steelAccumulating = b.factory > 0 && r.steelProd > factoryCap * 1.001 && factoryCap > 0;

  // 9. Lifetime / stats tracking.
  state.stats.totalOre += oreRate * dt;
  state.stats.totalSteel += steelProduced;
  state.stats.totalComponents += compProduced;
  state.stats.lifetimeCredits += creditsEarned;
  if (r.credits > state.stats.bestCreditsPerSec) {
    state.stats.bestCreditsPerSec = r.credits;
  }

  // 10. Sanitise to avoid NaN / negative / Infinity polluting the save.
  sanitize(state);

  state.rates = r;
}

// Manual mining click.
export function manualMine(state: GameState): void {
  state.resources.ore += MANUAL_MINE_AMOUNT;
  state.stats.totalOre += MANUAL_MINE_AMOUNT;
  sanitize(state);
}

// Sell a fraction (0..1) of a resource at its sell price.
export function sellResource(state: GameState, rid: SellableResource, fraction: number): number {
  const amount = state.resources[rid] * fraction;
  if (amount <= 0) return 0;
  const gain = amount * SELL_PRICES[rid];
  state.resources[rid] -= amount;
  state.resources.credits += gain;
  state.stats.lifetimeCredits += gain;
  sanitize(state);
  return gain;
}

function sanitize(state: GameState): void {
  const ids: ResourceId[] = ["ore", "steel", "components", "credits", "research"];
  for (const id of ids) {
    const v = state.resources[id];
    if (!Number.isFinite(v) || v < 0) {
      state.resources[id] = Math.max(0, Number.isFinite(v) ? v : 0);
    }
  }
}

// Run a coarse simulation for offline progress, capped at MAX_OFFLINE_MS.
// Returns the resources produced during the offline window (for the popup).
export function simulateOffline(
  state: GameState,
  elapsedMs: number,
): { ore: number; steel: number; components: number; credits: number; research: number } {
  const capped = Math.min(elapsedMs, MAX_OFFLINE_MS);
  if (capped <= 0) return { ore: 0, steel: 0, components: 0, credits: 0, research: 0 };

  // Chunk into at most ~3600 steps so it stays fast even for 24h.
  const steps = Math.min(Math.ceil(capped / 1000), 3600);
  const dt = capped / steps;

  const snap = {
    ore: state.resources.ore,
    steel: state.resources.steel,
    components: state.resources.components,
    credits: state.resources.credits,
    research: state.resources.research,
  };

  for (let i = 0; i < steps; i++) simulate(state, dt);

  return {
    ore: state.resources.ore - snap.ore,
    steel: state.resources.steel - snap.steel,
    components: state.resources.components - snap.components,
    credits: state.resources.credits - snap.credits,
    research: state.resources.research - snap.research,
  };
}
