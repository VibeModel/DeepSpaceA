// Power grid: an instantaneous supply/demand model with no storage.
//
// Every building draws power. The initial landing module provides a small base
// supply so the very first mining drone never dead-locks. When demand exceeds
// supply the whole base is throttled by `factor = supply / demand` (a brownout).
//
// Supply is deliberately NOT scaled by milestones (that would trivialise power
// late-game); the long-term lever is the repeatable "Grid Optimization" tech.
//
// Pure module (no DOM) so it can be unit-tested directly.

import { BUILDINGS, BASE_POWER_SUPPLY } from "./balance";
import { capNumber } from "./num";
import type { BuildingId, GameState } from "./types";
import type { TechModifiers } from "./research";

// Buildings that consume power, in a stable order.
const CONSUMERS: BuildingId[] = ["miningDrone", "furnace", "factory", "laboratory"];

export interface PowerState {
  supply: number;
  demand: number;
  // 1 = fully supplied; <1 = brownout (all production/consumption scales by it).
  factor: number;
}

export function computePower(state: GameState, mods: TechModifiers): PowerState {
  const b = state.buildings;
  const solar = b.solarArray || 0;
  const perArray = BUILDINGS.solarArray.baseSupply ?? 0;
  const supply = capNumber(
    (BASE_POWER_SUPPLY + solar * perArray) * mods.powerSupplyMult,
  );

  // Demand is computed from raw building counts, so it does NOT shrink when the
  // brownout throttles throughput (avoids a positive-feedback oscillation).
  let demand = 0;
  for (const id of CONSUMERS) {
    demand += (b[id] || 0) * (BUILDINGS[id].powerUse ?? 0);
  }
  demand = capNumber(demand);

  const factor = demand <= supply ? 1 : demand > 0 ? supply / demand : 1;
  return { supply, demand, factor: capNumber(factor, 1) };
}
