import { BUILDINGS, MILESTONES, MILESTONE_BONUS, MAX_BUILDINGS } from "./balance";
import type { BuildingId, BuildingDefinition, GameState } from "./types";
import { capNumber, safePow } from "./num";
import { costMultFromPlanet } from "./planets";

export const BUILDING_LIST: BuildingDefinition[] = Object.values(BUILDINGS);

export function getBuilding(id: BuildingId): BuildingDefinition {
  return BUILDINGS[id];
}

// Cost of the next unit of a building given how many are already owned.
export function buildingCost(
  state: GameState,
  id: BuildingId,
  ownedOverride?: number,
): number {
  const def = BUILDINGS[id];
  const owned = ownedOverride ?? state.buildings[id];
  // Smart Logistics reduces cost growth.
  let growth = def.costGrowth;
  if (state.techs.smartLogistics) growth -= 0.05;
  // Planet modifiers can raise/lower the base cost (e.g. Pyra ×1.15).
  return capNumber(def.baseCost * safePow(growth, owned) * costMultFromPlanet(state));
}

// How many milestone bonus tiers a building currently has.
export function milestoneTiers(_id: BuildingId, owned: number): number {
  let tiers = 0;
  for (const m of MILESTONES) {
    if (owned >= m) tiers++;
  }
  return tiers;
}

// Total production multiplier granted by milestones for a building.
export function milestoneMultiplier(id: BuildingId, owned: number): number {
  return Math.pow(MILESTONE_BONUS, milestoneTiers(id, owned));
}

// The next milestone threshold for a building, or null if all reached.
export function nextMilestone(_id: BuildingId, owned: number): number | null {
  for (const m of MILESTONES) {
    if (owned < m) return m;
  }
  return null;
}

// The bonus that the next milestone will grant (always ×2 per spec).
export function nextMilestoneBonus(): number {
  return MILESTONE_BONUS;
}

export function canAfford(state: GameState, id: BuildingId): boolean {
  return state.resources.credits >= buildingCost(state, id);
}

// Buildings unlock progressively: each requires the previous one to exist.
export function buildingUnlocked(state: GameState, id: BuildingId): boolean {
  switch (id) {
    case "miningDrone":
      return true;
    case "solarArray":
      // Power matters once you start automating, so expose it with the first drone.
      return state.buildings.miningDrone >= 1;
    case "furnace":
      return state.buildings.miningDrone >= 1;
    case "factory":
      return state.buildings.furnace >= 1;
    case "laboratory":
      return state.buildings.factory >= 1;
  }
}

// Attempt to buy one unit of a building. Returns true on success.
export function buyBuilding(state: GameState, id: BuildingId): boolean {
  if (state.buildings[id] >= MAX_BUILDINGS) return false;
  const cost = buildingCost(state, id);
  if (state.resources.credits < cost) return false;
  state.resources.credits -= cost;
  state.buildings[id] += 1;
  state.stats.buildingsPurchased += 1;
  return true;
}
