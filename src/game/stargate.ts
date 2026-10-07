// Stargate — the infinite long-horizon megastructure. Pure logic; may only
// depend on balance / types / num / stellar (stellar never imports this module,
// so the graph stays acyclic).
import {
  STARGATE_INPUTS,
  STARGATE_BASE_COST,
  STARGATE_COST_GROWTH,
  STARGATE_PROD_PER_LEVEL,
  STARGATE_POWER_PER_LEVEL,
  STARGATE_COST_REDUCTION,
  STARGATE_MILESTONES,
} from "./balance";
import { capNumber, safePow } from "./num";
import { stellarModifiers } from "./stellar";
import type { GameState, ResourceId } from "./types";

// Cost of the NEXT tier, per required resource. Scaled by the stargate-cost
// stellar upgrade (chartStargate).
export function stargateCost(
  state: GameState,
  level = state.stargateLevel,
): Partial<Record<ResourceId, number>> {
  const mult = safePow(STARGATE_COST_GROWTH, Math.max(0, level));
  const chartMult = stellarModifiers(state).stargateCostMult;
  const out: Partial<Record<ResourceId, number>> = {};
  for (const res of STARGATE_INPUTS) {
    out[res] = capNumber((STARGATE_BASE_COST[res] ?? 0) * mult * chartMult);
  }
  return out;
}

// How far along the CURRENT tier the player is (0..1) — the minimum have/need
// across every required input. Derived only (never persisted).
export function stargateProgress(state: GameState): number {
  const cost = stargateCost(state);
  let worst = 1;
  for (const res of STARGATE_INPUTS) {
    const need = cost[res] ?? 0;
    if (need <= 0) continue;
    worst = Math.min(worst, (state.resources[res] ?? 0) / need);
  }
  return Math.max(0, Math.min(1, worst));
}

export function canAffordStargate(state: GameState): boolean {
  return stargateProgress(state) >= 1;
}

// Build one tier: atomically consume every required resource.
export function buildStargate(state: GameState): boolean {
  if (!canAffordStargate(state)) return false;
  const cost = stargateCost(state);
  for (const res of STARGATE_INPUTS) {
    state.resources[res] = capNumber((state.resources[res] ?? 0) - (cost[res] ?? 0));
  }
  state.stargateLevel += 1;
  return true;
}

export interface StargateModifiers {
  globalProdMult: number;
  costMult: number; // building cost multiplier
  powerSupplyMult: number;
}

export function stargateModifiers(state: GameState): StargateModifiers {
  const n = Math.max(0, state.stargateLevel);
  // Every named milestone reached adds another cumulative ×1.5.
  const tierCount = STARGATE_MILESTONES.filter((m) => n >= m.level).length;
  const tierMult = Math.pow(1.5, tierCount);
  return {
    globalProdMult: (1 + STARGATE_PROD_PER_LEVEL * n) * tierMult,
    costMult: safePow(STARGATE_COST_REDUCTION, n), // 0.99^n
    powerSupplyMult: 1 + STARGATE_POWER_PER_LEVEL * n,
  };
}

// Narrow helper for buildings.ts (which does NOT go through computeModifiers).
export function stargateCostMult(state: GameState): number {
  return stargateModifiers(state).costMult;
}

// Name of the most recently reached milestone (or "" before the first).
export function stargateTierName(level: number): string {
  let name = "";
  for (const m of STARGATE_MILESTONES) if (level >= m.level) name = m.name;
  return name;
}

export function nextStargateMilestone(
  level: number,
): { level: number; name: string; bonus: number } | null {
  return STARGATE_MILESTONES.find((m) => level < m.level) ?? null;
}
