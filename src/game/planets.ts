// Planets and their upgradable regions. Pure logic (no UI, no storage) so it can
// be unit-tested directly. This module may only depend on balance / types / num
// to keep the dependency graph acyclic (buildings/research/simulation all import
// FROM here, never the other way around).
import { PLANETS, REGIONS } from "./balance";
import type {
  GameState,
  PlanetDefinition,
  PlanetId,
  PlanetModifiers,
  RegionDefinition,
  RegionId,
} from "./types";
import { capNumber, safePow } from "./num";

export const PLANET_LIST: PlanetDefinition[] = Object.values(PLANETS);
export const REGION_LIST: RegionDefinition[] = Object.values(REGIONS);

export function getPlanet(id: PlanetId): PlanetDefinition {
  // Defensive: a corrupt save could carry an unknown id; fall back to homeworld.
  return PLANETS[id] ?? PLANETS.homeworld;
}

export function getRegion(id: RegionId): RegionDefinition {
  return REGIONS[id];
}

// A region map with every region at level 0. Enumerated so an older save that
// lacks the field still merges cleanly (normalizeState only copies existing keys).
export function emptyRegionMap(): Record<RegionId, number> {
  const out = {} as Record<RegionId, number>;
  for (const def of REGION_LIST) out[def.id] = 0;
  return out;
}

// A region is available on the current planet when it lists no restriction or
// the current planet is in that list.
export function regionAvailable(state: GameState, id: RegionId): boolean {
  const def = getRegion(id);
  if (!def.planets) return true;
  return def.planets.includes(state.planet);
}

export function regionsForPlanet(planet: PlanetId): RegionDefinition[] {
  return REGION_LIST.filter((def) => !def.planets || def.planets.includes(planet));
}

export function regionLevel(state: GameState, id: RegionId): number {
  return state.regions[id] || 0;
}

export function regionMaxed(state: GameState, id: RegionId): boolean {
  return regionLevel(state, id) >= getRegion(id).maxLevel;
}

// Cost of the NEXT region level (credits): baseCost * growth^level.
export function regionCost(state: GameState, id: RegionId): number {
  const def = getRegion(id);
  return capNumber(def.baseCost * safePow(def.costGrowth, regionLevel(state, id)));
}

export function canUpgradeRegion(state: GameState, id: RegionId): boolean {
  if (!regionAvailable(state, id)) return false;
  if (regionMaxed(state, id)) return false;
  return state.resources.credits >= regionCost(state, id);
}

// Attempt to upgrade a region by one level (spends credits). Returns true on
// success, false when unavailable / maxed / unaffordable.
export function upgradeRegion(state: GameState, id: RegionId): boolean {
  if (!canUpgradeRegion(state, id)) return false;
  state.resources.credits -= regionCost(state, id);
  state.regions[id] = regionLevel(state, id) + 1;
  return true;
}

// Aggregate the planet plus its region levels into a full set of multiplicative
// factors (missing entries default to 1). This is the single source of truth
// consumed by computeModifiers() and buildingCost().
export function planetRegionModifiers(state: GameState): Required<PlanetModifiers> {
  const out: Required<PlanetModifiers> = {
    miningMult: 1,
    smeltMult: 1,
    factoryMult: 1,
    researchMult: 1,
    steelYieldMult: 1,
    componentYieldMult: 1,
    globalProdMult: 1,
    powerSupplyMult: 1,
    costMult: 1,
    prestigeGainMult: 1,
  };

  const modifiers: PlanetModifiers = getPlanet(state.planet).modifiers;
  for (const key of Object.keys(modifiers) as (keyof PlanetModifiers)[]) {
    const v = modifiers[key];
    if (typeof v === "number") out[key] *= v;
  }

  for (const def of REGION_LIST) {
    const lv = state.regions[def.id] || 0;
    if (lv <= 0) continue;
    for (const eff of def.effects) {
      out[eff.modKey] *= 1 + eff.perLevel * lv;
    }
  }

  return out;
}

// Building cost multiplier contributed by the planet + regions.
export function costMultFromPlanet(state: GameState): number {
  return planetRegionModifiers(state).costMult;
}

// Every unlock criterion for a planet must hold (missing criteria are ignored).
export function planetMeetsCriteria(state: GameState, id: PlanetId): boolean {
  const unlock = getPlanet(id).unlock;
  if (
    unlock.prestigeCount !== undefined &&
    state.stats.prestigeCount < unlock.prestigeCount
  ) {
    return false;
  }
  if (
    unlock.lifetimeCoreData !== undefined &&
    state.lifetimeCoreData < unlock.lifetimeCoreData
  ) {
    return false;
  }
  return true;
}

// Planet unlock is DERIVED, never stored: prestigeCount / lifetimeCoreData both
// persist across prestiges, so the unlocked set is a pure function of state.
export function planetUnlocked(state: GameState, id: PlanetId): boolean {
  if (!(id in PLANETS)) return false;
  return planetMeetsCriteria(state, id);
}
