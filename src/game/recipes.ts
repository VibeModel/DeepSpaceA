// Recipe helpers. Pure logic (no DOM, no storage). May only depend on
// balance / types so the dependency graph stays acyclic — buildings, research
// and simulation all import FROM here, never the other way around.
import { BUILDING_ORDER, RECIPES } from "./balance";
import { capNumber } from "./num";
import type {
  BuildingId,
  GameState,
  RecipeDefinition,
  RecipeId,
} from "./types";

// Config order (matches RECIPES declaration order), which also defines each
// building's fallback order.
export const RECIPE_LIST: RecipeDefinition[] = Object.values(RECIPES);

export function getRecipe(id: RecipeId): RecipeDefinition {
  return RECIPES[id];
}

// All recipes a given building can run, in config order.
export function recipesForBuilding(bid: BuildingId): RecipeDefinition[] {
  return RECIPE_LIST.filter((r) => r.machine === bid);
}

// A recipe is unlocked when it has no gate, or its gating tech is researched.
export function isRecipeUnlocked(state: GameState, id: RecipeId): boolean {
  const rec: RecipeDefinition | undefined = RECIPES[id];
  if (!rec || !rec.unlockTech) return true;
  return (state.techs[rec.unlockTech] ?? 0) > 0;
}

// The default recipe for a machine: its base (tech-free) one, else the first.
export function defaultRecipeFor(bid: BuildingId): RecipeId | null {
  const list = recipesForBuilding(bid);
  if (list.length === 0) return null;
  const base = list.find((r) => !r.unlockTech);
  return (base ?? list[0]).id;
}

// Exhaustive default allocation: every BuildingId present, and every valid
// recipe of that building listed (base recipe weight 1, the rest 0). MUST be
// exhaustive on BOTH levels — the save loader only deep-merges keys that
// already exist on the default object, so a missing recipe key would silently
// reset a player's allocation on load.
export function defaultRecipeMix(): Record<
  BuildingId,
  Partial<Record<RecipeId, number>>
> {
  const out = {} as Record<BuildingId, Partial<Record<RecipeId, number>>>;
  for (const bid of BUILDING_ORDER) {
    const base = defaultRecipeFor(bid);
    const dst: Partial<Record<RecipeId, number>> = {};
    for (const r of recipesForBuilding(bid)) dst[r.id] = r.id === base ? 1 : 0;
    out[bid] = dst;
  }
  return out;
}

export interface Allocation {
  recipe: RecipeDefinition;
  // Effective machine count devoted to this recipe (may be fractional).
  count: number;
}

// Split a machine's unit count across its UNLOCKED recipes by weight. Locked
// recipes are dropped (so a prestige that wipes the tech degrades gracefully).
// When nothing is allocated, the default recipe runs at full count.
export function recipeAllocation(state: GameState, bid: BuildingId): Allocation[] {
  const total = state.buildings[bid] || 0;
  if (total <= 0) return [];
  const list = recipesForBuilding(bid).filter((r) => isRecipeUnlocked(state, r.id));
  if (list.length === 0) return [];

  const mix = (state.recipeMix ? state.recipeMix[bid] : undefined) ?? {};
  let sum = 0;
  const weighted = list.map((r) => {
    const w = mix[r.id];
    const v = typeof w === "number" && w > 0 ? w : 0;
    sum += v;
    return { r, v };
  });

  if (sum <= 0) {
    const def = list.find((r) => !r.unlockTech) ?? list[0];
    return [{ recipe: def, count: total }];
  }
  return weighted
    .filter((x) => x.v > 0)
    .map((x) => ({ recipe: x.r, count: (total * x.v) / sum }));
}

// Share (0..1) of a machine's capacity currently assigned to a recipe. Used by
// the UI to show a percentage per recipe.
export function recipeShare(state: GameState, bid: BuildingId, id: RecipeId): number {
  const alloc = recipeAllocation(state, bid);
  const total = alloc.reduce((a, x) => a + x.count, 0);
  if (total <= 0) return 0;
  const mine = alloc.find((x) => x.recipe.id === id);
  return mine ? mine.count / total : 0;
}

// Sanitise a (possibly hand-edited / legacy) recipeMix: drop unknown recipe ids
// and recipes that do not belong to the building, clamp weights to finite
// non-negative integers, and keep every BuildingId present.
export function normalizeMix(state: GameState): void {
  const out = {} as Record<BuildingId, Partial<Record<RecipeId, number>>>;
  for (const bid of BUILDING_ORDER) {
    const valid = new Set(recipesForBuilding(bid).map((r) => r.id));
    const src = (state.recipeMix && state.recipeMix[bid]) || {};
    const dst: Partial<Record<RecipeId, number>> = {};
    for (const [key, value] of Object.entries(src)) {
      if (!valid.has(key as RecipeId)) continue;
      const n = typeof value === "number" ? Math.floor(capNumber(value)) : 0;
      dst[key as RecipeId] = n;
    }
    out[bid] = dst;
  }
  state.recipeMix = out;
}
