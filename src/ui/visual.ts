// Presentation-layer mapping: turns live game numbers into the visual
// parameters that drive the planet scene and the number-driven animations.
//
// This module is intentionally free of DOM access so it can be unit-tested in
// Node (see test/visual.test.ts). Everything here is *presentation* tuning and
// does not affect game balance, which is why the constants live here rather
// than in game/balance.ts.

import { BUILDING_ORDER, MILESTONES } from "../game/balance";
import type {
  BuildingId,
  GameState,
  RecipeId,
  RecipeOutputId,
  ResourceId,
} from "../game/types";

// One pipeline stage per producer plus one per recipe, then research. These map
// 1:1 onto the FLOW panel stages in render.ts.
export type StageId =
  | "mining"
  | "copperMining"
  | RecipeId
  | "research";

// Which output id each stage's throughput is read from.
const STAGE_OUTPUT: Record<StageId, RecipeOutputId> = {
  mining: "ore",
  copperMining: "copperOre",
  smeltSteel: "steel",
  smeltCopper: "copper",
  makeComponents: "components",
  makeCircuit: "circuit",
  makeAlloy: "alloy",
  synthesizeBlueprint: "blueprints",
  research: "research",
};

// Outputs summed for the overall planet intensity (credits excluded).
const MATERIAL_OUTPUTS: RecipeOutputId[] = [
  "ore",
  "steel",
  "components",
  "research",
  "copperOre",
  "copper",
  "circuit",
  "alloy",
];

// All stage ids, in display order.
export const STAGE_IDS: StageId[] = [
  "mining",
  "copperMining",
  "smeltSteel",
  "smeltCopper",
  "makeComponents",
  "makeCircuit",
  "makeAlloy",
  "synthesizeBlueprint",
  "research",
];

// Tunable presentation constants. Values are chosen so that a fresh game shows
// a dim, calm planet and a mature run lights up a busy one.
export const VISUAL = {
  // Total throughput/s at which intensity reaches tanh(1) ≈ 0.76.
  prodScale: 60,
  // Building count at which the on-planet light pool is fully lit.
  buildingDotScale: 24,
  // Number of base light dots pre-created in the DOM (fixed pool).
  dotPool: 14,
  // Reference throughput per stage (x/s) for the pipeline sweep speed.
  stageScale: {
    mining: 120,
    copperMining: 120,
    smeltSteel: 40,
    smeltCopper: 40,
    makeComponents: 15,
    makeCircuit: 6,
    makeAlloy: 3,
    synthesizeBlueprint: 1,
    research: 6,
  } as Record<StageId, number>,
  // Planet breathing period (s): slow when idle, quick when busy.
  breatheMax: 8.5,
  breatheMin: 3.2,
  // Satellite orbit period (s).
  orbitMax: 30,
  orbitMin: 9,
  // Pipeline sweep period (s): slow trickle → fast flow.
  flowMax: 3.0,
  flowMin: 0.7,
  // Minimum intensity so an idle game still has a faint glow.
  idleFloor: 0.12,
  // Baseline planet glow when nothing is happening.
  glowFloor: 0.15,
  // Credits/s at which the top-bar readout pulses at full strength.
  creditScale: 40,
  // Top-bar pulse period (s): slow when barely earning, quick when flowing.
  creditDurMax: 3.2,
  creditDurMin: 1.4,
  // Below this credits/s the top-bar pulse is switched off entirely.
  creditActiveFloor: 0.02,
  // Any building count reaching this unlocks the planetary ring.
  ringThreshold: 25,

  // ---- Per-building colony skyline ("how many of what") ----
  // Building count at which a cluster reaches full height / glow / pulse speed.
  // Deliberately generous: the tower COUNT steps at the milestone tiers
  // (10/25/50/100), so the height channel should keep responding well past them
  // instead of flattening out at the first milestone.
  nodeScale: 250,
  towerMinH: 7, // px, a single building
  towerMaxH: 32, // px, a saturated colony
  // Towers drawn per cluster; how many show is 1 + the milestone tier reached.
  towerPool: 5,
  nodePulseMax: 3.6, // s, one lonely building pulses slowly
  nodePulseMin: 1.1, // s, a large colony pulses quickly
  // Smallest log-normalised fill a single (owned > 0) cluster gets, so the very
  // first building is clearly visible rather than a bare minimum.
  nodeFillFloor: 0.14,

  // ---- Convoy ships crossing the orbital lanes ----
  // Fixed DOM pool; only this many can ever be visible.
  convoyPool: 10,
  // Total buildings at which the full convoy is out.
  convoyScale: 40,
  // Orbit period (s) for a convoy ship: slow at first, quick once busy.
  convoyDurMax: 26,
  convoyDurMin: 8,
  // Convoy orbit radii (px), alternated so ships do not overlap.
  convoyRadii: [70, 78, 64],
} as const;

// Squash an unbounded non-negative value into [0, 1) using tanh. Guards
// NaN / Infinity / negatives so giant late-game numbers can never poison the
// visual layer.
export function norm(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0 || scale <= 0) return 0;
  return Math.tanh(value / scale);
}

// Log-compress a value into [0, 1]. Useful when the interesting range spans
// many orders of magnitude. min is 2 to keep the denominator >= log10(2) > 0.
export function logNorm(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 1) return 0;
  const denom = Math.log10(Math.max(2, max));
  return Math.min(1, Math.log10(value) / denom);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export interface VisualInput {
  // Gross output per second keyed by output id (resources + blueprints).
  outputs: Record<RecipeOutputId, number>;
  // Net credits per second (drives the top-bar pulse).
  creditsRate: number;
  // Any processor starved or accumulating (drives the amber warning state).
  bottleneck: boolean;
  // Owned building counts.
  buildings: Record<BuildingId, number>;
  // Current power-grid throttle factor (1 = fine, <1 = brownout).
  powerFactor: number;
  // Production Analytics gate for the amber warning state.
  analyticsUnlocked: boolean;
}

// One building type's on-screen presence in the colony skyline. Everything is
// driven by the owned count, so the strip literally shows "how many of what".
export interface BuildingNodeVisual {
  id: BuildingId;
  owned: number;
  visible: boolean; // owned > 0 -> the cluster appears
  height: number; // px tower height
  towers: number; // towers drawn (1..towerPool), grows with milestone tiers
  glow: number; // 0..1 opacity / halo strength
  pulseDur: number; // seconds per pulse (faster with more buildings)
  tier: number; // how many count tiers (10/25/50/100) have been reached
  fill: number; // 0..1 normalised count, for bars / arcs
}

export interface VisualParams {
  intensity: number; // 0..1 overall activity
  glow: number; // 0..1 planet glow / halo opacity
  activity: number; // 0..1 surface + orbit liveliness
  creditIntensity: number; // 0..1 top-bar pulse strength
  creditActive: boolean; // whether the top-bar should pulse at all
  creditDur: number; // seconds
  breatheDur: number; // seconds
  orbitDur: number; // seconds
  flowDur: Record<StageId, number>; // seconds per stage sweep
  dotCount: number; // lit base-light dots (0..dotPool)
  strained: boolean; // show amber bottleneck warning
  hasIndustry: boolean; // a processor is built -> outer orbit appears
  hasRing: boolean; // a building hit ringThreshold -> planetary ring
  // Per-building presence, in BUILDING_ORDER.
  nodes: BuildingNodeVisual[];
  totalBuildings: number;
  convoy: number; // visible convoy ships (0..convoyPool)
  convoyDur: number; // seconds per convoy orbit
}

// Read the subset of game state the visual layer needs.
export function toVisualInput(state: GameState): VisualInput {
  const r = state.rates;
  const outputs = {} as Record<RecipeOutputId, number>;
  for (const key of Object.keys(r.production) as ResourceId[]) {
    outputs[key] = r.production[key];
  }
  outputs.blueprints = r.net?.blueprints ?? 0;

  let bottleneck = false;
  for (const key of Object.keys(r.processors) as RecipeId[]) {
    const pr = r.processors[key];
    if (pr && (pr.shortage || pr.accumulating)) {
      bottleneck = true;
      break;
    }
  }

  return {
    outputs,
    creditsRate: r.net?.credits ?? 0,
    bottleneck,
    buildings: { ...state.buildings },
    powerFactor: r.powerFactor ?? 1,
    analyticsUnlocked: state.flags.analyticsUnlocked,
  };
}

export function deriveVisualParams(i: VisualInput): VisualParams {
  let totalProd = 0;
  for (const key of MATERIAL_OUTPUTS) totalProd += i.outputs[key] || 0;
  const intensity = clamp01(
    VISUAL.idleFloor + (1 - VISUAL.idleFloor) * norm(totalProd, VISUAL.prodScale),
  );
  const glow = clamp01(VISUAL.glowFloor + intensity * (1 - VISUAL.glowFloor));

  const b = i.buildings;
  let bTotal = 0;
  let maxOwned = 0;
  for (const key of BUILDING_ORDER) {
    const n = b[key] || 0;
    bTotal += n;
    if (n > maxOwned) maxOwned = n;
  }
  // Linear fill so the light pool actually reaches full at buildingDotScale.
  const fill = clamp01(bTotal / VISUAL.buildingDotScale);
  const dotCount = Math.round(fill * VISUAL.dotPool);
  const activity = clamp01(fill * 0.7 + intensity * 0.3);

  // Per-building nodes. Size/glow/pulse all come from the owned count, so the
  // scene reads as a colony whose parts grow with how much you have built.
  const nodes: BuildingNodeVisual[] = BUILDING_ORDER.map((id) => {
    const owned = b[id] || 0;
    const raw = logNorm(owned, VISUAL.nodeScale); // 0 at <= 1
    const nodeFill = owned <= 0 ? 0 : Math.max(VISUAL.nodeFillFloor, raw);
    // Reuse the gameplay milestone tiers so the visual "spikes" always line up
    // with the ×2 production milestones (single source of truth).
    let tier = 0;
    for (const m of MILESTONES) if (owned >= m) tier++;
    return {
      id,
      owned,
      visible: owned > 0,
      height: lerp(VISUAL.towerMinH, VISUAL.towerMaxH, nodeFill),
      // One tower at the first building, then one more per milestone tier.
      towers: Math.min(VISUAL.towerPool, 1 + tier),
      glow: owned <= 0 ? 0 : clamp01(0.34 + 0.66 * nodeFill),
      pulseDur: lerp(VISUAL.nodePulseMax, VISUAL.nodePulseMin, nodeFill),
      tier,
      fill: nodeFill,
    };
  });
  // Convoy ships scale from the TOTAL building count on their own curve, so
  // the lanes fill up independently of the planet's light pool.
  const convoyFill = clamp01(bTotal / VISUAL.convoyScale);
  const convoy = Math.round(convoyFill * VISUAL.convoyPool);

  const flowDur = {} as Record<StageId, number>;
  for (const stage of STAGE_IDS) {
    const rate = i.outputs[STAGE_OUTPUT[stage]] || 0;
    flowDur[stage] = lerp(VISUAL.flowMax, VISUAL.flowMin, norm(rate, VISUAL.stageScale[stage]));
  }

  const strained =
    i.powerFactor < 0.995 || (i.analyticsUnlocked && i.bottleneck);

  const creditIntensity = norm(i.creditsRate, VISUAL.creditScale);

  return {
    intensity,
    glow,
    activity,
    creditIntensity,
    creditActive: creditIntensity > VISUAL.creditActiveFloor,
    creditDur: lerp(VISUAL.creditDurMax, VISUAL.creditDurMin, creditIntensity),
    breatheDur: lerp(VISUAL.breatheMax, VISUAL.breatheMin, intensity),
    orbitDur: lerp(VISUAL.orbitMax, VISUAL.orbitMin, activity),
    flowDur,
    dotCount,
    strained,
    hasIndustry:
      (b.furnace || 0) + (b.factory || 0) + (b.assembler || 0) > 0,
    hasRing: maxOwned >= VISUAL.ringThreshold,
    nodes,
    totalBuildings: bTotal,
    convoy,
    convoyDur: lerp(VISUAL.convoyDurMax, VISUAL.convoyDurMin, activity),
  };
}
