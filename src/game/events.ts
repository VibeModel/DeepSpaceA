// Random events — automatic, short-lived modifiers. They advance in SIMULATED
// time (the same clock as production, including offline catch-up) and are
// wiped by every run reset.
//
// Gated behind the first prestige so a fresh game is completely unaffected:
// without the gate, `stats.prestigeCount === 0` means `tickEvents` returns
// immediately and no event ever spawns.
import { EVENTS, EVENT_SPAWN_SEC, EVENT_DURATION_SEC } from "./balance";
import { nextRandom, randomRange } from "./rng";
import type { EventDefinition, GameState } from "./types";

export const EVENT_LIST: EventDefinition[] = Object.values(EVENTS);

export function eventsUnlocked(state: GameState): boolean {
  return state.stats.prestigeCount >= 1 || state.ascensionCount >= 1;
}

// Aggregated multiplicative contribution of every live event. Read as "no
// effect" (×1) when there is nothing active.
export interface EventModifiers {
  prodMult: number;
  sellMult: number;
  powerMult: number;
  researchMult: number;
}

export function eventModifiers(state: GameState): EventModifiers {
  const out: EventModifiers = { prodMult: 1, sellMult: 1, powerMult: 1, researchMult: 1 };
  const active = state.activeEvents;
  if (!active || active.length === 0) return out;
  for (const ev of active) {
    // Annotated so the `as const` table widens back to the shared shape.
    const def: EventDefinition | undefined = EVENTS[ev.id];
    if (!def) continue;
    const e = def.effect;
    if (e.prodMult) out.prodMult *= e.prodMult;
    if (e.sellMult) out.sellMult *= e.sellMult;
    if (e.powerMult) out.powerMult *= e.powerMult;
    if (e.researchMult) out.researchMult *= e.researchMult;
  }
  return out;
}

// Weighted pick that never duplicates an already-active event.
function spawnEvent(state: GameState): void {
  const active = new Set(state.activeEvents.map((e) => e.id));
  const pool = EVENT_LIST.filter((e) => !active.has(e.id));
  if (pool.length === 0) return;
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let roll = nextRandom(state) * total;
  let chosen = pool[pool.length - 1];
  for (const def of pool) {
    roll -= def.weight;
    if (roll <= 0) {
      chosen = def;
      break;
    }
  }
  const duration = EVENT_DURATION_SEC * (chosen.durationMult ?? 1);
  state.activeEvents.push({ id: chosen.id, remaining: duration, total: duration });
}

// Spawn an event immediately, ignoring the spawn timer (debug / tests only).
export function forceSpawnEvent(state: GameState): void {
  spawnEvent(state);
}

// Advance events by `dtSec` of SIMULATED time.
export function tickEvents(state: GameState, dtSec: number): void {
  if (!eventsUnlocked(state)) {
    if (state.activeEvents.length > 0) state.activeEvents = [];
    return;
  }
  if (state.activeEvents.length > 0) {
    for (const ev of state.activeEvents) ev.remaining -= dtSec;
    state.activeEvents = state.activeEvents.filter((ev) => ev.remaining > 0);
  }
  state.eventSpawnIn -= dtSec;
  if (state.eventSpawnIn <= 0) {
    // Reset the timer with a little jitter so events never feel metronomic.
    state.eventSpawnIn = EVENT_SPAWN_SEC * randomRange(state, 0.75, 1.25);
    spawnEvent(state);
  }
}

// Remaining fraction (0..1) of an event, for the UI progress bar.
export function eventProgress(remaining: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, remaining / total));
}
