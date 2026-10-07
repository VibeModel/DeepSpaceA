import {
  SAVE_VERSION,
  PLANETS,
  SELLABLE_RESOURCES,
  EVENTS,
  EVENT_SPAWN_SEC,
  CONTRACT_SPAWN_SEC,
} from "./balance";
import { createNewGame } from "./state";
import { simulateOffline } from "./simulation";
import { REGION_LIST, planetUnlocked } from "./planets";
import { normalizeMix } from "./recipes";
import { emptyStellarUpgradeMap } from "./stellar";
import { capNumber } from "./num";
import type { ActiveEvent, Contract, GameState, PlanetId, SellableResource } from "./types";

const STORAGE_KEY = "deepspace_automation_save";

interface SaveEnvelope {
  version: number;
  timestamp: number;
  state: GameState;
}

// Deep-merge a loaded (possibly older / partial) state onto fresh defaults so
// missing fields never become undefined and corrupt the game. Only keys that
// already exist in the default object are copied, preserving forward safety.
function normalizeState(loaded: Partial<GameState>): GameState {
  const base = createNewGame();
  const out = base;
  const mergeObj = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
  ) => {
    for (const key of Object.keys(target)) {
      if (!(key in source)) continue;
      const sv = source[key];
      const tv = target[key];
      if (
        sv !== null &&
        typeof sv === "object" &&
        !Array.isArray(sv) &&
        tv !== null &&
        typeof tv === "object" &&
        !Array.isArray(tv)
      ) {
        mergeObj(tv as Record<string, unknown>, sv as Record<string, unknown>);
      } else {
        target[key] = sv;
      }
    }
  };
  mergeObj(out as unknown as Record<string, unknown>, loaded as Record<string, unknown>);

  // Backwards compatibility: techs and permanent upgrades used to be stored as
  // booleans. Coerce any legacy/partial values into numeric levels.
  const coerceLevels = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      obj[key] = typeof v === "number" ? v : v ? 1 : 0;
    }
  };
  coerceLevels(out.techs as unknown as Record<string, unknown>);
  coerceLevels(out.permanentUpgrades as unknown as Record<string, unknown>);

  // Planet / regions: validate ids and clamp region levels. `regions` already
  // exists on the fresh default (enumerated by emptyRegionMap), so missing keys
  // survive the merge above; here we guard against junk values.
  const isPlanet = (v: unknown): v is PlanetId =>
    typeof v === "string" && Object.prototype.hasOwnProperty.call(PLANETS, v);
  if (!isPlanet(out.planet)) out.planet = "homeworld";
  if (!isPlanet(out.nextPlanet)) out.nextPlanet = out.planet;
  // A stored destination that is no longer unlocked falls back to the current
  // planet rather than stranding the player on a locked world.
  if (!planetUnlocked(out, out.nextPlanet)) out.nextPlanet = out.planet;
  for (const def of REGION_LIST) {
    const v = out.regions[def.id];
    out.regions[def.id] = Math.min(
      def.maxLevel,
      Math.floor(capNumber(typeof v === "number" ? v : 0, def.maxLevel)),
    );
  }

  // Blueprints (persistent meta currency) and the recipe allocation.
  out.blueprints = capNumber(typeof out.blueprints === "number" ? out.blueprints : 0);
  // Run-scoped peak income (drives the prestige reward this run).
  out.runPeakCreditsPerSec = capNumber(
    typeof out.runPeakCreditsPerSec === "number" ? out.runPeakCreditsPerSec : 0,
  );

  // Megastructure + second-layer meta.
  const numOr = (v: unknown): number => (typeof v === "number" ? v : 0);
  out.stargateLevel = Math.floor(capNumber(numOr(out.stargateLevel)));
  out.stellarCharts = capNumber(numOr(out.stellarCharts));
  out.lifetimeStellarCharts = capNumber(numOr(out.lifetimeStellarCharts));
  out.chartsGranted = capNumber(numOr(out.chartsGranted));
  out.ascensionCount = Math.floor(capNumber(numOr(out.ascensionCount)));
  out.rngSeed = Number.isFinite(out.rngSeed) ? out.rngSeed >>> 0 : 0x9e3779b9;
  // Stellar upgrades: coerce legacy/partial values to numeric levels and make
  // the map EXHAUSTIVE (the merge only fills keys that exist on the default).
  const stellarDefaults = emptyStellarUpgradeMap();
  const loadedStellar = (out.stellarUpgrades ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(stellarDefaults) as (keyof typeof stellarDefaults)[]) {
    const v = loadedStellar[key];
    stellarDefaults[key] = Math.floor(capNumber(typeof v === "number" ? v : v ? 1 : 0));
  }
  out.stellarUpgrades = stellarDefaults;

  // Run-scoped random events + contracts. Arrays are replaced wholesale by the
  // merge above, so validate every entry against the current definitions.
  out.activeEvents = (Array.isArray(out.activeEvents) ? out.activeEvents : [])
    .filter((ev): ev is ActiveEvent => !!ev && typeof ev === "object" && ev.id in EVENTS)
    .map((ev) => ({
      id: ev.id,
      remaining: capNumber(numOr(ev.remaining)),
      total: capNumber(numOr(ev.total)),
    }));
  out.eventSpawnIn = capNumber(numOr(out.eventSpawnIn)) || EVENT_SPAWN_SEC;
  const loadContracts = (v: unknown): Contract[] =>
    (Array.isArray(v) ? v : [])
      .filter(
        (c): c is Contract =>
          !!c &&
          typeof c === "object" &&
          (SELLABLE_RESOURCES as readonly string[]).includes(
            (c as Contract).resource as SellableResource,
          ),
      )
      .map((c) => ({
        id: Math.floor(capNumber(numOr(c.id))),
        resource: c.resource,
        amount: capNumber(numOr(c.amount)),
        reward: capNumber(numOr(c.reward)),
        remaining: capNumber(numOr(c.remaining)),
        total: capNumber(numOr(c.total)),
      }));
  out.contractOffers = loadContracts(out.contractOffers);
  out.activeContracts = loadContracts(out.activeContracts);
  out.contractSpawnIn = capNumber(numOr(out.contractSpawnIn)) || CONTRACT_SPAWN_SEC;
  out.nextContractId = Math.max(1, Math.floor(capNumber(numOr(out.nextContractId))));

  normalizeMix(out);

  out.version = SAVE_VERSION;
  return out;
}

export function saveGame(state: GameState): void {
  const now = Date.now();
  state.timestamp = now;
  state.lastTick = now;
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    timestamp: now,
    state,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch (e) {
    console.warn("保存失败", e);
  }
}

// Load and normalise. Returns null when there is no valid save.
export function loadGame(): GameState | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as SaveEnvelope;
    if (!env || typeof env !== "object" || !env.state) return null;
    return normalizeState(env.state);
  } catch (e) {
    console.warn("读取存档失败，已忽略", e);
    return null;
  }
}

// Apply offline progress. Returns the produced-resource summary, or null if the
// gap was negligible. This MUTATES state (advances resources).
export function applyOfflineProgress(
  state: GameState,
): { elapsedMs: number; produced: ReturnType<typeof simulateOffline> } | null {
  const now = Date.now();
  const elapsed = now - state.lastTick;
  if (elapsed < 1000) {
    state.lastTick = now;
    return null;
  }
  const produced = simulateOffline(state, elapsed);
  state.lastTick = now;
  state.stats.lifetimePlayTime += elapsed;
  return { elapsedMs: elapsed, produced };
}

export function exportSave(state: GameState): string {
  const now = Date.now();
  state.timestamp = now;
  const envelope: SaveEnvelope = { version: SAVE_VERSION, timestamp: now, state };
  return btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
}

export function importSave(encoded: string): GameState | null {
  let json: string;
  try {
    json = decodeURIComponent(escape(atob(encoded.trim())));
  } catch {
    return null;
  }
  try {
    const env = JSON.parse(json) as SaveEnvelope;
    if (!env || typeof env !== "object" || !env.state) return null;
    const state = normalizeState(env.state);
    state.lastTick = Date.now();
    return state;
  } catch {
    return null;
  }
}

export function resetSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
