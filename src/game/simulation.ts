import {
  BUILDINGS,
  BUILDING_ORDER,
  RESOURCE_IDS,
  SELLABLE_RESOURCES,
  SELL_PRICES,
  AUTOSELL_RESERVE,
  MANUAL_MINE_AMOUNT,
  AUTOBUY_TRIGGER_MULTIPLE,
  AUTOBUY_MAX_PER_TICK,
  MAX_OFFLINE_MS,
  MAX_BUILDINGS,
  MAX_TECH_LEVEL,
  PLANETS,
  EVENTS,
} from "./balance";
import type {
  ActiveEvent,
  Contract,
  GameState,
  SellableResource,
  ResourceId,
  RecipeId,
  RecipeOutputId,
  LiveRates,
  ProcessorRate,
  TechId,
} from "./types";
import { milestoneMultiplier, buyBuilding, buildingCost } from "./buildings";
import { REGION_LIST } from "./planets";
import { normalizeMix, recipeAllocation, RECIPE_LIST } from "./recipes";
import {
  computeModifiers,
  TECH_LIST,
  canResearch,
  isInfiniteTech,
  techCost,
  researchTech,
} from "./research";
import { capNumber } from "./num";
import { computePower } from "./power";
import { tickEvents } from "./events";

// Cap a single simulation step so a long background stall cannot destabilise
// the inventory math. Larger gaps are handled by the offline routine instead.
const MAX_TICK_DT = 300_000; // 5 minutes

// Which lifetime stat tracks each produced resource (credits/research excluded).
const STAT_KEY: Partial<Record<ResourceId, keyof GameState["stats"]>> = {
  ore: "totalOre",
  steel: "totalSteel",
  components: "totalComponents",
  copperOre: "totalCopperOre",
  copper: "totalCopper",
  circuit: "totalCircuit",
  alloy: "totalAlloy",
};

function emptyProcessorRate(): ProcessorRate {
  const perInput = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) perInput[id] = 0;
  return {
    cap: 0,
    input: 0,
    capBatches: 0,
    throughput: 0,
    util: 0,
    yield: 1,
    perInput,
    shortage: false,
    accumulating: false,
  };
}

// A fully zeroed LiveRates. Exported so state defaults reuse the exact shape.
export function emptyRates(): LiveRates {
  const production = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) production[id] = 0;
  const net = {} as Record<RecipeOutputId, number>;
  for (const id of RESOURCE_IDS) net[id] = 0;
  net.blueprints = 0;
  const processors = {} as Record<RecipeId, ProcessorRate>;
  for (const rec of RECIPE_LIST) processors[rec.id] = emptyProcessorRate();
  return {
    production,
    net,
    processors,
    powerSupply: 0,
    powerDemand: 0,
    powerFactor: 1,
    labActive: false,
  };
}

// Credit production into a run resource and its lifetime stat.
function addOutput(state: GameState, output: RecipeOutputId, amount: number): void {
  if (!(amount > 0)) return;
  if (output === "blueprints") {
    state.blueprints = capNumber(state.blueprints + amount);
    state.stats.totalBlueprints = capNumber(state.stats.totalBlueprints + amount);
    return;
  }
  state.resources[output] = capNumber(state.resources[output] + amount);
  const key = STAT_KEY[output];
  if (key) state.stats[key] = capNumber(state.stats[key] + amount);
}

// One simulation step of length dt (seconds). Mutates state in place.
export function simulate(state: GameState, dtMs: number): void {
  let dt = dtMs / 1000;
  if (dt <= 0) return;
  if (dt > MAX_TICK_DT / 1000) dt = MAX_TICK_DT / 1000;

  const mods = computeModifiers(state);
  const res = state.resources;
  const b = state.buildings;

  const before = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) before[id] = res[id];
  const beforeBlueprints = state.blueprints;

  const r = emptyRates();

  // 0. Power grid — a brownout (factor < 1) scales every production and
  //    consumption rate below.
  const power = computePower(state, mods);
  const pf = power.factor;
  r.powerSupply = power.supply;
  r.powerDemand = power.demand;
  r.powerFactor = pf;

  // 1. Producers (mining drone / copper mine). Laboratories are handled later
  //    because they need credit upkeep.
  for (const id of BUILDING_ORDER) {
    const def = BUILDINGS[id];
    if (def.category !== "producer") continue;
    const out = def.produces!;
    const rate =
      b[id] *
      def.baseProduction! *
      (mods.producerMult[out] ?? 1) *
      milestoneMultiplier(id, b[id]) *
      mods.globalProdMult *
      pf;
    res[out] = capNumber(res[out] + rate * dt);
    r.production[out] += rate;
    const key = STAT_KEY[out];
    if (key) state.stats[key] = capNumber(state.stats[key] + rate * dt);
  }

  // 2. Processors. Each machine's unit count is split across its allocated
  //    recipes (recipeAllocation), so several recipes of one machine can run in
  //    parallel. Recipes are processed upstream→downstream (BUILDING_ORDER).
  for (const id of BUILDING_ORDER) {
    if (BUILDINGS[id].category !== "processor") continue;
    const count = b[id];
    if (count <= 0) continue;
    const milestone = milestoneMultiplier(id, count);

    for (const alloc of recipeAllocation(state, id)) {
      const rec = alloc.recipe;
      const pr = r.processors[rec.id];
      const speedMult = mods.recipeSpeedMult[rec.id] ?? 1;

      const capBatches = alloc.count * rec.speed * speedMult * milestone * mods.globalProdMult;
      const capEff = capBatches * pf;

      // Batches this tick: limited by design capacity AND the scarcest input.
      let n = capEff * dt;
      for (const inp of rec.inputs) {
        n = Math.min(n, res[inp.res] / inp.amount);
      }
      if (!(n > 0)) n = 0;

      const yieldMult = mods.recipeYieldMult[rec.id] ?? 1;
      for (const inp of rec.inputs) {
        const used = n * inp.amount;
        res[inp.res] = capNumber(res[inp.res] - used);
        pr.perInput[inp.res] += used / dt;
      }

      const outAmount = n * rec.outputAmount * yieldMult;
      addOutput(state, rec.output, outAmount);
      if (rec.output !== "blueprints") r.production[rec.output] += outAmount / dt;

      const primary = rec.inputs[0];
      pr.capBatches = capBatches;
      pr.throughput = n / dt;
      pr.cap = capBatches * primary.amount;
      pr.input = (n / dt) * primary.amount;
      pr.util = capBatches > 0 ? n / dt / capBatches : 0;
      pr.yield = yieldMult;
      // Starved by an input (has spare capacity but nothing to process).
      pr.shortage = capEff > 0 && n < capEff * dt * 0.999;
      // Upstream makes the primary input faster than this recipe can consume it.
      pr.accumulating =
        r.production[primary.res] > capBatches * primary.amount * 1.001;
    }
  }

  // 3. Auto-sell surplus (above reserve). Runs before lab upkeep so selling can
  //    feed the labs.
  let creditsEarned = 0;
  for (const rid of SELLABLE_RESOURCES) {
    if (!state.autoSell[rid]) continue;
    const surplus = res[rid] - AUTOSELL_RESERVE[rid];
    if (surplus > 0) {
      const gain = surplus * SELL_PRICES[rid] * mods.sellMult;
      res[rid] -= surplus;
      res.credits = capNumber(res.credits + gain);
      creditsEarned += gain;
    }
  }

  // 4. Laboratory — pay credit upkeep, produce research (scaled if short).
  const labCount = b.laboratory;
  const researchRate =
    labCount *
    BUILDINGS.laboratory.baseProduction! *
    mods.producerMult.research *
    milestoneMultiplier("laboratory", labCount) *
    mods.globalProdMult *
    pf;
  const upkeep =
    labCount * BUILDINGS.laboratory.labUpkeep! * (1 - mods.labUpkeepReduction) * pf;
  r.production.research += researchRate;
  if (labCount > 0) {
    const owed = upkeep * dt;
    if (res.credits >= owed) {
      res.credits -= owed;
      res.research = capNumber(res.research + researchRate * dt);
      r.labActive = true;
    } else {
      const factor = owed > 0 ? res.credits / owed : 0;
      res.research = capNumber(res.research + researchRate * dt * factor);
      res.credits = 0;
      r.labActive = factor > 0;
    }
  }

  // 5. Auto-buy (after production so credits are available).
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

  // 6. Net inventory deltas (per second) for display.
  for (const id of RESOURCE_IDS) r.net[id] = (res[id] - before[id]) / dt;
  r.net.blueprints = (state.blueprints - beforeBlueprints) / dt;

  // 7. Lifetime / stats tracking.
  state.stats.lifetimeCredits += creditsEarned;
  const creditsPerSec = r.net.credits;
  if (creditsPerSec > state.stats.bestCreditsPerSec) {
    state.stats.bestCreditsPerSec = creditsPerSec;
  }
  // Run-scoped peak income — the prestige reward is based on this, so it must
  // track the best this run ever reached (reset by freshRunState each run).
  if (creditsPerSec > state.runPeakCreditsPerSec) {
    state.runPeakCreditsPerSec = creditsPerSec;
  }

  // 8. Random events (simulated time). Gated behind the first prestige, so a
  //    fresh game never spawns one and existing balance is untouched.
  tickEvents(state, dt);

  // 9. Auto-research (if unlocked & enabled) spends research on techs.
  autoResearchTick(state);

  // 10. Sanitise to avoid NaN / negative / Infinity polluting the save.
  sanitize(state);

  state.rates = r;
}

// Max tech purchases per tick to avoid unbounded loops in a single frame.
const AUTORESEARCH_MAX_PER_TICK = 5;

// Spend spare research automatically. Priority: one-time "unlock" techs first
// (cheapest first), then the cheapest affordable repeatable upgrade.
function autoResearchTick(state: GameState): void {
  if (!state.flags.autoResearchUnlocked || !state.autoResearch) return;
  for (let i = 0; i < AUTORESEARCH_MAX_PER_TICK; i++) {
    let best: TechId | null = null;
    let bestCost = Infinity;
    let bestInfinite = true;
    for (const t of TECH_LIST) {
      if (!canResearch(state, t.id)) continue;
      const infinite = isInfiniteTech(t.id);
      const cost = techCost(state, t.id);
      const better =
        best === null ||
        (bestInfinite && !infinite) ||
        (bestInfinite === infinite && cost < bestCost);
      if (better) {
        best = t.id;
        bestCost = cost;
        bestInfinite = infinite;
      }
    }
    if (best === null) break;
    if (!researchTech(state, best)) break;
  }
}

// Manual mining click.
export function manualMine(state: GameState): void {
  state.resources.ore += MANUAL_MINE_AMOUNT;
  state.stats.totalOre += MANUAL_MINE_AMOUNT;
  sanitize(state);
}

// Liquidate EVERY sellable resource in one go (the "sell all" button). Same
// price rules as sellResource, including the live market multiplier, but done
// in a single pass so the UI can offer a true one-click action.
export function sellAllResources(state: GameState): number {
  const mods = computeModifiers(state);
  let total = 0;
  for (const rid of SELLABLE_RESOURCES) {
    const amount = state.resources[rid];
    if (!(amount > 0)) continue;
    const gain = amount * SELL_PRICES[rid] * mods.sellMult;
    state.resources[rid] = 0;
    state.resources.credits = capNumber(state.resources.credits + gain);
    total += gain;
  }
  if (total > 0) state.stats.lifetimeCredits = capNumber(state.stats.lifetimeCredits + total);
  sanitize(state);
  return total;
}

// Sell a fraction (0..1) of a resource at its sell price (market events can
// raise or lower the price via mods.sellMult).
export function sellResource(state: GameState, rid: SellableResource, fraction: number): number {
  const amount = state.resources[rid] * fraction;
  if (amount <= 0) return 0;
  const gain = amount * SELL_PRICES[rid] * computeModifiers(state).sellMult;
  state.resources[rid] -= amount;
  state.resources.credits += gain;
  state.stats.lifetimeCredits += gain;
  sanitize(state);
  return gain;
}

// Keep only well-formed events (known id, finite timers).
function sanitizeEvents(list: ActiveEvent[]): ActiveEvent[] {
  if (!Array.isArray(list)) return [];
  const out: ActiveEvent[] = [];
  for (const ev of list) {
    if (!ev || typeof ev !== "object") continue;
    if (!(ev.id in EVENTS)) continue;
    out.push({
      id: ev.id,
      remaining: capNumber(ev.remaining),
      total: capNumber(ev.total),
    });
  }
  return out;
}

// Keep only well-formed contracts whose resource is actually sellable.
function sanitizeContracts(list: Contract[]): Contract[] {
  if (!Array.isArray(list)) return [];
  const out: Contract[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    if (!(SELLABLE_RESOURCES as readonly string[]).includes(c.resource)) continue;
    out.push({
      id: Math.floor(capNumber(c.id)),
      resource: c.resource,
      amount: capNumber(c.amount),
      reward: capNumber(c.reward),
      remaining: capNumber(c.remaining),
      total: capNumber(c.total),
    });
  }
  return out;
}

function sanitize(state: GameState): void {
  // Resources: clamp to [0, MAX_VALUE]. Overflow caps (never zeroes out).
  for (const id of RESOURCE_IDS) state.resources[id] = capNumber(state.resources[id]);

  // Buildings: non-negative integers capped at MAX_BUILDINGS.
  for (const id of BUILDING_ORDER) {
    state.buildings[id] = Math.min(
      MAX_BUILDINGS,
      Math.floor(capNumber(state.buildings[id], MAX_BUILDINGS)),
    );
  }

  // Tech levels: non-negative integers capped at MAX_TECH_LEVEL.
  const techs = state.techs as unknown as Record<string, number>;
  for (const key of Object.keys(techs)) {
    techs[key] = Math.min(
      MAX_TECH_LEVEL,
      Math.floor(capNumber(techs[key], MAX_TECH_LEVEL)),
    );
  }

  // Prestige + blueprint currencies.
  state.coreData = capNumber(state.coreData);
  state.lifetimeCoreData = capNumber(state.lifetimeCoreData);
  state.blueprints = capNumber(state.blueprints);
  state.runPeakCreditsPerSec = capNumber(state.runPeakCreditsPerSec);

  // Megastructure + second-layer meta.
  state.stargateLevel = Math.floor(capNumber(state.stargateLevel));
  state.stellarCharts = capNumber(state.stellarCharts);
  state.lifetimeStellarCharts = capNumber(state.lifetimeStellarCharts);
  state.chartsGranted = capNumber(state.chartsGranted);
  state.ascensionCount = Math.floor(capNumber(state.ascensionCount));
  if (!Number.isFinite(state.rngSeed)) state.rngSeed = 0x9e3779b9;

  // Random events + contracts (both run-scoped).
  state.activeEvents = sanitizeEvents(state.activeEvents);
  state.eventSpawnIn = capNumber(state.eventSpawnIn);
  state.contractOffers = sanitizeContracts(state.contractOffers);
  state.activeContracts = sanitizeContracts(state.activeContracts);
  state.contractSpawnIn = capNumber(state.contractSpawnIn);
  state.nextContractId = Math.max(1, Math.floor(capNumber(state.nextContractId)));

  if (state.stellarUpgrades) {
    for (const k of Object.keys(state.stellarUpgrades)) {
      state.stellarUpgrades[k as keyof typeof state.stellarUpgrades] = Math.floor(
        capNumber(state.stellarUpgrades[k as keyof typeof state.stellarUpgrades]),
      );
    }
  }

  // Planets + regions: keep ids legal and region levels within [0, maxLevel].
  if (!(state.planet in PLANETS)) state.planet = "homeworld";
  if (!(state.nextPlanet in PLANETS)) state.nextPlanet = state.planet;
  for (const def of REGION_LIST) {
    state.regions[def.id] = Math.min(
      def.maxLevel,
      Math.floor(capNumber(state.regions[def.id] ?? 0, def.maxLevel)),
    );
  }

  // Recipe allocation: drop unknown ids / foreign recipes, clamp weights.
  normalizeMix(state);

  // Live rates must stay finite for the UI (nested maps included).
  const r = state.rates;
  for (const id of RESOURCE_IDS) {
    r.production[id] = capNumber(r.production[id]);
    r.net[id] = capNumber(r.net[id]);
  }
  r.net.blueprints = capNumber(r.net.blueprints);
  r.powerSupply = capNumber(r.powerSupply);
  r.powerDemand = capNumber(r.powerDemand);
  r.powerFactor = capNumber(r.powerFactor, 1);
  for (const rec of RECIPE_LIST) {
    const pr = r.processors[rec.id];
    if (!pr) continue;
    pr.cap = capNumber(pr.cap);
    pr.input = capNumber(pr.input);
    pr.capBatches = capNumber(pr.capBatches);
    pr.throughput = capNumber(pr.throughput);
    pr.util = capNumber(pr.util, 1);
    pr.yield = capNumber(pr.yield);
    for (const id of RESOURCE_IDS) pr.perInput[id] = capNumber(pr.perInput[id]);
  }

  // Statistics.
  const st = state.stats;
  for (const key of Object.keys(st) as (keyof typeof st)[]) {
    st[key] = capNumber(st[key]);
  }
}

// Run a coarse simulation for offline progress, capped at MAX_OFFLINE_MS.
// Returns the inventory gained per output id (including blueprints).
export function simulateOffline(
  state: GameState,
  elapsedMs: number,
): Record<RecipeOutputId, number> {
  const zero = (): Record<RecipeOutputId, number> => {
    const o = {} as Record<RecipeOutputId, number>;
    for (const id of RESOURCE_IDS) o[id] = 0;
    o.blueprints = 0;
    return o;
  };

  const capped = Math.min(elapsedMs, MAX_OFFLINE_MS);
  if (capped <= 0) return zero();

  // Chunk into at most ~3600 steps so it stays fast even for 24h.
  const steps = Math.min(Math.ceil(capped / 1000), 3600);
  const dt = capped / steps;

  const before = {} as Record<RecipeOutputId, number>;
  for (const id of RESOURCE_IDS) before[id] = state.resources[id];
  before.blueprints = state.blueprints;

  for (let i = 0; i < steps; i++) simulate(state, dt);

  const out = zero();
  for (const id of RESOURCE_IDS) out[id] = state.resources[id] - before[id];
  out.blueprints = state.blueprints - before.blueprints;
  return out;
}
