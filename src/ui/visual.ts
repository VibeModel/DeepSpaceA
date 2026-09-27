// Presentation-layer mapping: turns live game numbers into the visual
// parameters that drive the planet scene and the number-driven animations.
//
// This module is intentionally free of DOM access so it can be unit-tested in
// Node (see test/visual.test.ts). Everything here is *presentation* tuning and
// does not affect game balance, which is why the constants live here rather
// than in game/balance.ts.

import type { BuildingId, GameState } from "../game/types";

export type StageId = "mining" | "smelting" | "manufacturing" | "research";

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
    smelting: 40,
    manufacturing: 15,
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
  // Stage throughput per second (gross).
  oreProd: number;
  steelProd: number;
  compProd: number;
  researchProd: number;
  // Net credits per second (drives the top-bar pulse).
  creditsRate: number;
  // Bottleneck flags.
  oreShortage: boolean;
  steelShortage: boolean;
  oreAccumulating: boolean;
  steelAccumulating: boolean;
  // Owned building counts.
  buildings: Record<BuildingId, number>;
  // Current power-grid throttle factor (1 = fine, <1 = brownout).
  powerFactor: number;
  // Production Analytics gate for the amber warning state.
  analyticsUnlocked: boolean;
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
  hasIndustry: boolean; // furnace/factory built -> outer orbit appears
  hasRing: boolean; // a building hit ringThreshold -> planetary ring
}

// Read the subset of game state the visual layer needs.
export function toVisualInput(state: GameState): VisualInput {
  const r = state.rates;
  return {
    oreProd: r.oreProd,
    steelProd: r.steelProd,
    compProd: r.compProd,
    researchProd: r.researchProd,
    creditsRate: r.credits,
    oreShortage: r.oreShortage,
    steelShortage: r.steelShortage,
    oreAccumulating: r.oreAccumulating,
    steelAccumulating: r.steelAccumulating,
    buildings: { ...state.buildings },
    powerFactor: r.powerFactor ?? 1,
    analyticsUnlocked: state.flags.analyticsUnlocked,
  };
}

export function deriveVisualParams(i: VisualInput): VisualParams {
  const totalProd = i.oreProd + i.steelProd + i.compProd + i.researchProd;
  const intensity = clamp01(
    VISUAL.idleFloor + (1 - VISUAL.idleFloor) * norm(totalProd, VISUAL.prodScale),
  );
  const glow = clamp01(VISUAL.glowFloor + intensity * (1 - VISUAL.glowFloor));

  const b = i.buildings;
  let bTotal = 0;
  let maxOwned = 0;
  for (const key of Object.keys(b) as BuildingId[]) {
    const n = b[key] || 0;
    bTotal += n;
    if (n > maxOwned) maxOwned = n;
  }
  // Linear fill so the light pool actually reaches full at buildingDotScale.
  const fill = clamp01(bTotal / VISUAL.buildingDotScale);
  const dotCount = Math.round(fill * VISUAL.dotPool);
  const activity = clamp01(fill * 0.7 + intensity * 0.3);

  const flowDur: Record<StageId, number> = {
    mining: lerp(VISUAL.flowMax, VISUAL.flowMin, norm(i.oreProd, VISUAL.stageScale.mining)),
    smelting: lerp(VISUAL.flowMax, VISUAL.flowMin, norm(i.steelProd, VISUAL.stageScale.smelting)),
    manufacturing: lerp(
      VISUAL.flowMax,
      VISUAL.flowMin,
      norm(i.compProd, VISUAL.stageScale.manufacturing),
    ),
    research: lerp(VISUAL.flowMax, VISUAL.flowMin, norm(i.researchProd, VISUAL.stageScale.research)),
  };

  const strained =
    i.powerFactor < 0.995 ||
    (i.analyticsUnlocked &&
      (i.oreShortage || i.steelShortage || i.oreAccumulating || i.steelAccumulating));

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
    hasIndustry: (b.furnace || 0) + (b.factory || 0) > 0,
    hasRing: maxOwned >= VISUAL.ringThreshold,
  };
}
