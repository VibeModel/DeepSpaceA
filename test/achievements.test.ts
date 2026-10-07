// Achievement tests (unlock logic, no repeats, prestige survival). Run: npm test
import { createNewGame } from "../src/game/state";
import {
  ACHIEVEMENTS,
  evaluateAchievements,
  emptyAchievementMap,
  achievementProgress,
} from "../src/game/achievements";
import { doPrestige } from "../src/game/prestige";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}

// --- default map is exhaustive (required for save compatibility) ---
{
  const m = emptyAchievementMap();
  ok(Object.keys(m).length === ACHIEVEMENTS.length, "empty map covers every achievement id");
  ok(
    ACHIEVEMENTS.every((a) => m[a.id] === false),
    "empty map starts all false",
  );
  ok(ACHIEVEMENTS.length >= 16, "at least 16 achievements defined");
}

// --- fresh game unlocks nothing ---
{
  const s = createNewGame();
  ok(evaluateAchievements(s).length === 0, "fresh game unlocks nothing");
}

// --- firstOre unlock + no repeat ---
{
  const s = createNewGame();
  s.stats.totalOre = 1;
  const got = evaluateAchievements(s);
  ok(got.includes("firstOre"), "firstOre unlocks");
  ok(s.achievements.firstOre === true, "firstOre recorded");
  ok(evaluateAchievements(s).length === 0, "no repeat unlock on second evaluation");
}

// --- threshold-based unlocks ---
{
  const s = createNewGame();
  s.stats.lifetimeCredits = 1e6;
  s.stats.totalSteel = 1e4;
  s.stats.prestigeCount = 5;
  s.lifetimeCoreData = 150;
  s.buildings.miningDrone = 1;
  s.buildings.solarArray = 1;
  const got = evaluateAchievements(s);
  for (const id of [
    "firstMillion",
    "steelWill",
    "cycleFive",
    "coreHoarder",
    "firstDrone",
    "solar",
    "reboot",
  ] as const) {
    ok(got.includes(id), `threshold: ${id} unlocks`);
  }
  ok(!got.includes("firstOre"), "threshold: firstOre stays locked without ore");
}

// --- copper / recipe chain achievements ---
{
  const s = createNewGame();
  ok(!s.achievements.firstCopper, "chain: firstCopper starts locked");
  s.stats.totalCopperOre = 1;
  s.stats.totalCircuit = 1;
  s.stats.totalAlloy = 1;
  s.stats.totalBlueprints = 1;
  const got = evaluateAchievements(s);
  for (const id of ["firstCopper", "circuitMaker", "alloySmith", "blueprintArchitect"] as const) {
    ok(got.includes(id), `chain: ${id} unlocks`);
  }
}

// --- progress helper ---
{
  const s = createNewGame();
  const a = ACHIEVEMENTS.find((x) => x.id === "firstMillion")!;
  s.stats.lifetimeCredits = 500_000;
  const p = achievementProgress(s, a);
  ok(p.pct === 0.5, "progress: 50% at half the target");
  s.stats.lifetimeCredits = 2e6;
  ok(achievementProgress(s, a).pct === 1, "progress: capped at 100%");
}

// --- achievements survive prestige ---
{
  const s = createNewGame();
  s.runPeakCreditsPerSec = 500; // above the prestige cps threshold
  s.achievements.firstOre = true;
  const gained = doPrestige(s);
  ok(gained > 0, "prestige: grants core data");
  ok(s.achievements.firstOre === true, "prestige: achievements are preserved");
  ok(s.buildings.miningDrone === 0, "prestige: run buildings reset");
}

console.log(`\nAchievement tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} achievement test(s) failed`);
}
