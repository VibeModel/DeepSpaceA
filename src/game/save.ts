import { SAVE_VERSION } from "./balance";
import { createNewGame } from "./state";
import { simulateOffline } from "./simulation";
import type { GameState } from "./types";

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
