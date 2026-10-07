// Stargate (infinite megastructure) tests: cost curve, atomic build, permanent
// modifiers, milestone stacking, and persistence across both resets.
// Run with: npm test
import { createNewGame } from "../src/game/state";
import {
  stargateCost,
  stargateProgress,
  canAffordStargate,
  buildStargate,
  stargateModifiers,
  stargateTierName,
  nextStargateMilestone,
} from "../src/game/stargate";
import { computeModifiers } from "../src/game/research";
import { buildingCost } from "../src/game/buildings";
import { doPrestige } from "../src/game/prestige";
import { doAscend } from "../src/game/ascension";
import { exportSave, importSave } from "../src/game/save";
import { STARGATE_INPUTS, STARGATE_BASE_COST, STARGATE_COST_GROWTH } from "../src/game/balance";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// Helper: a state that can afford the next stargate tier.
function stocked() {
  const s = createNewGame();
  const cost = stargateCost(s);
  for (const res of STARGATE_INPUTS) s.resources[res] = (cost[res] ?? 0) * 3 + 10;
  return s;
}

// --- 1. Config sanity ---
{
  for (const res of STARGATE_INPUTS) {
    ok((STARGATE_BASE_COST[res] ?? 0) > 0, `stargate input ${res}: has a base cost`);
  }
}

// --- 2. Cost curve: base * 1.18^n, and the same for every input ---
{
  const s = createNewGame();
  const c0 = stargateCost(s, 0);
  const c3 = stargateCost(s, 3);
  for (const res of STARGATE_INPUTS) {
    const base = STARGATE_BASE_COST[res]!;
    ok(near(c0[res]!, base), `cost T0 ${res} = base`);
    ok(
      near(c3[res]!, base * Math.pow(STARGATE_COST_GROWTH, 3)),
      `cost T3 ${res} follows 1.18^3`,
    );
    ok((c3[res] ?? 0) > (c0[res] ?? 0), `cost ${res} grows with tier`);
  }
}

// --- 3. Level 0 is fully neutral (regression: nothing changes before you build) ---
{
  const s = createNewGame();
  const sg = stargateModifiers(s);
  ok(sg.globalProdMult === 1, "T0: no production bonus");
  ok(sg.costMult === 1, "T0: no cost reduction");
  ok(sg.powerSupplyMult === 1, "T0: no power bonus");
  const m = computeModifiers(s);
  ok(m.globalProdMult === 1, "T0: computeModifiers global = 1");
}

// --- 4. Atomic build: consumes every input, bumps the level ---
{
  const s = stocked();
  const cost = stargateCost(s);
  const before = { ...s.resources };
  ok(canAffordStargate(s), "affordable when every input >= need");
  ok(buildStargate(s), "build succeeds when affordable");
  ok(s.stargateLevel === 1, "level incremented");
  for (const res of STARGATE_INPUTS) {
    ok(
      near(s.resources[res], before[res] - cost[res]!),
      `build consumed ${res}`,
    );
  }
}

// --- 5. Cannot build when a single input is short ---
{
  const s = stocked();
  const cost = stargateCost(s);
  s.resources.circuit = (cost.circuit ?? 0) - 1;
  ok(!canAffordStargate(s), "not affordable when one input is short");
  ok(!buildStargate(s), "build refused when short");
  ok(s.stargateLevel === 0, "level unchanged after a refused build");
  ok(stargateProgress(s) < 1, "progress < 100% when short");
}

// --- 6. Milestones: each reached tier adds another ×1.5 ---
{
  const s = createNewGame();
  s.stargateLevel = 1;
  const t1 = stargateModifiers(s).globalProdMult; // (1+0.03) * 1.5
  ok(near(t1, 1.03 * 1.5), "T1 includes the first milestone ×1.5");
  s.stargateLevel = 5;
  const t5 = stargateModifiers(s).globalProdMult; // (1.15) * 1.5^2
  ok(near(t5, 1.15 * 1.5 * 1.5), "T5 stacks a second milestone");
  ok(stargateTierName(5).includes("虫洞"), "T5 names the Stable Wormhole milestone");
  ok(nextStargateMilestone(5)?.level === 10, "next milestone after T5 is T10");
}

// --- 7. Building cost drops with the stargate level (buildings.ts path) ---
{
  const s = createNewGame();
  s.buildings.miningDrone = 10;
  const before = buildingCost(s, "miningDrone");
  s.stargateLevel = 10;
  const after = buildingCost(s, "miningDrone");
  ok(after < before, "stargate lowers building cost");
  ok(near(after, before * Math.pow(0.99, 10)), "cost scales by 0.99^10");
}

// --- 8. Save round-trip preserves the level ---
{
  const s = createNewGame();
  s.stargateLevel = 7;
  const back = importSave(exportSave(s));
  ok(back !== null && back.stargateLevel === 7, "save: stargate level preserved");
}

// --- 9. Level survives a prestige AND an ascension ---
{
  const s = stocked();
  s.stargateLevel = 4;
  s.runPeakCreditsPerSec = 500;
  doPrestige(s);
  ok(s.stargateLevel === 4, "prestige: stargate level preserved");

  s.lifetimeCoreData = 200;
  const gained = doAscend(s);
  ok(gained > 0, "ascension: granted charts");
  ok(s.stargateLevel === 4, "ascension: stargate level preserved");
}

console.log(`\nStargate tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`${failed} stargate test(s) failed`);
