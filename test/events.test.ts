// Random-event tests: gating, spawn/expire, modifier folding, determinism and
// persistence. Events are PRNG-driven off state.rngSeed, so a fixed seed makes
// every assertion here reproducible.
// Run with: npm test
import { createNewGame } from "../src/game/state";
import {
  EVENT_LIST,
  eventsUnlocked,
  eventModifiers,
  tickEvents,
  forceSpawnEvent,
  eventProgress,
} from "../src/game/events";
import { computeModifiers } from "../src/game/research";
import { doPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import { EVENTS, EVENT_SPAWN_SEC, EVENT_DURATION_SEC } from "../src/game/balance";
import type { GameState } from "../src/game/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// A state that has seen at least one prestige (the event gate).
function unlocked(): GameState {
  const s = createNewGame();
  s.stats.prestigeCount = 1;
  return s;
}

// --- 1. Config sanity ---
{
  for (const def of EVENT_LIST) {
    ok(def.weight > 0, `event ${def.id}: positive weight`);
    ok(def.name.length > 0, `event ${def.id}: has a name`);
    const e = def.effect;
    const touches =
      (e.prodMult ?? 1) !== 1 ||
      (e.sellMult ?? 1) !== 1 ||
      (e.powerMult ?? 1) !== 1 ||
      (e.researchMult ?? 1) !== 1;
    ok(touches, `event ${def.id}: has a non-neutral effect`);
  }
  ok(
    EVENT_LIST.length === Object.keys(EVENTS).length,
    "EVENT_LIST covers every definition",
  );
  const ids = new Set(EVENT_LIST.map((e) => e.id));
  ok(ids.size === EVENT_LIST.length, "no duplicate event ids");
}

// --- 2. A fresh game is neutral and never spawns ---
{
  const s = createNewGame();
  ok(!eventsUnlocked(s), "fresh game: events locked");
  const m = eventModifiers(s);
  ok(
    m.prodMult === 1 && m.sellMult === 1 && m.powerMult === 1 && m.researchMult === 1,
    "fresh game: no event modifiers",
  );
  // Ticking far past the spawn interval still spawns nothing.
  tickEvents(s, EVENT_SPAWN_SEC * 3);
  ok(s.activeEvents.length === 0, "fresh game: tickEvents never spawns");
}

// --- 3. Spawns once the gate opens (exactly one per interval) ---
{
  const s = unlocked();
  tickEvents(s, EVENT_SPAWN_SEC);
  ok(s.activeEvents.length === 1, "one event spawns at the spawn interval");
  const ev = s.activeEvents[0];
  ok(near(ev.remaining, ev.total), "a fresh event starts at full duration");
  ok(ev.total === EVENT_DURATION_SEC, "event uses the configured duration");
}

// --- 4. forceSpawnEvent never duplicates an active event ---
{
  const s = unlocked();
  forceSpawnEvent(s);
  const first = s.activeEvents[0].id;
  // Spam spawns; the pool always excludes ids already on the board.
  for (let i = 0; i < 20; i++) forceSpawnEvent(s);
  ok(s.activeEvents.length === EVENT_LIST.length, "spamming fills the whole pool");
  const ids = s.activeEvents.map((e) => e.id);
  ok(new Set(ids).size === ids.length, "no duplicate event is ever spawned");
  ok(ids.includes(first), "the first event is never replaced");
}

// --- 5. Modifiers aggregate from the live events ---
{
  const s = createNewGame();
  s.activeEvents = [{ id: "richVein", remaining: 10, total: 10 }];
  const m = eventModifiers(s);
  ok(near(m.prodMult, 1.5), "richVein: production ×1.5");
  ok(m.sellMult === 1 && m.powerMult === 1 && m.researchMult === 1, "richVein is production-only");

  s.activeEvents = [{ id: "supplyGlut", remaining: 10, total: 10 }];
  ok(near(eventModifiers(s).sellMult, 0.6), "supplyGlut: sell price ×0.6");

  s.activeEvents = [
    { id: "richVein", remaining: 10, total: 10 },
    { id: "ionStorm", remaining: 10, total: 10 },
  ];
  ok(near(eventModifiers(s).prodMult, 1.5 * 0.7), "stacked production events multiply");
}

// --- 6. computeModifiers folds events in ---
{
  const s = createNewGame();
  ok(near(computeModifiers(s).globalProdMult, 1), "baseline global production = 1");

  s.activeEvents = [{ id: "richVein", remaining: 10, total: 10 }];
  ok(near(computeModifiers(s).globalProdMult, 1.5), "richVein folds into globalProdMult");

  s.activeEvents = [{ id: "supplyGlut", remaining: 10, total: 10 }];
  ok(near(computeModifiers(s).sellMult, 0.6), "supplyGlut folds into sellMult");

  s.activeEvents = [{ id: "researchSurge", remaining: 10, total: 10 }];
  ok(near(computeModifiers(s).producerMult.research, 2), "researchSurge folds into research");

  s.activeEvents = [{ id: "solarFlare", remaining: 10, total: 10 }];
  ok(near(computeModifiers(s).powerSupplyMult, 1.3), "solarFlare folds into power supply");
}

// --- 7. Events expire when their timer runs out ---
{
  const s = unlocked();
  forceSpawnEvent(s);
  const dur = s.activeEvents[0].total;
  tickEvents(s, dur / 2);
  ok(s.activeEvents.length === 1, "event survives halfway through");
  ok(s.activeEvents[0].remaining < dur, "event timer counts down");
  ok(near(eventProgress(s.activeEvents[0].remaining, dur), 0.5, 1e-3), "progress is 50%");
  tickEvents(s, dur);
  ok(s.activeEvents.length === 0, "event expires after its duration");
}

// --- 8. Determinism: the same seed replays the same stream ---
{
  const a = unlocked();
  const b = unlocked();
  for (let i = 0; i < 5; i++) {
    forceSpawnEvent(a);
    forceSpawnEvent(b);
  }
  ok(
    JSON.stringify(a.activeEvents.map((e) => e.id)) ===
      JSON.stringify(b.activeEvents.map((e) => e.id)),
    "same seed spawns the same events",
  );

  const c = unlocked();
  c.rngSeed = 12345;
  const d = unlocked();
  d.rngSeed = 12345;
  tickEvents(c, EVENT_SPAWN_SEC);
  tickEvents(d, EVENT_SPAWN_SEC);
  ok(c.activeEvents[0].id === d.activeEvents[0].id, "same seed → same first spawn");
}

// --- 9. Save round-trip keeps live events ---
{
  const s = createNewGame();
  s.activeEvents = [{ id: "ionStorm", remaining: 42, total: 60 }];
  const back = importSave(exportSave(s));
  ok(back !== null, "save: round trip");
  ok(back!.activeEvents.length === 1, "save: active event preserved");
  ok(back!.activeEvents[0].id === "ionStorm", "save: event id preserved");
  ok(near(back!.activeEvents[0].remaining, 42), "save: event timer preserved");
}

// --- 10. A prestige wipes events (they are run-scoped) ---
{
  const s = unlocked();
  forceSpawnEvent(s);
  ok(s.activeEvents.length === 1, "event present before prestige");
  s.runPeakCreditsPerSec = 500;
  doPrestige(s);
  ok(s.activeEvents.length === 0, "prestige clears events");
  ok(near(s.eventSpawnIn, EVENT_SPAWN_SEC), "prestige resets the spawn timer");
}

// --- 11. Unknown event ids are ignored by the modifier aggregator ---
{
  const s = createNewGame();
  s.activeEvents = [{ id: "richVein", remaining: 5, total: 5 }];
  // A foreign id must not throw or contribute.
  (s.activeEvents as unknown as { id: string; remaining: number; total: number }[]).push({
    id: "notAnEvent",
    remaining: 5,
    total: 5,
  });
  ok(near(eventModifiers(s).prodMult, 1.5), "unknown event id contributes nothing");
}

console.log(`\nEvent tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`${failed} event test(s) failed`);
