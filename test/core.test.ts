// Core pure-logic tests. Run with: npm test  (uses tsx, no heavy framework).
import { createNewGame } from "../src/game/state";
import {
  buildingCost,
  milestoneMultiplier,
  milestoneTiers,
  buyBuilding,
  buildingUnlocked,
} from "../src/game/buildings";
import { computeModifiers, researchTech } from "../src/game/research";
import {
  simulate,
  manualMine,
  sellResource,
  simulateOffline,
} from "../src/game/simulation";
import { pendingCoreData, doPrestige, canPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import { BUILDINGS } from "../src/game/balance";
import type { GameState } from "../src/game/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// 1. Building cost formula.
{
  const s = createNewGame();
  ok(buildingCost(s, "miningDrone") === BUILDINGS.miningDrone.baseCost, "cost @0 = baseCost");
  s.buildings.miningDrone = 1;
  ok(
    near(buildingCost(s, "miningDrone"), BUILDINGS.miningDrone.baseCost * BUILDINGS.miningDrone.costGrowth),
    "cost @1 = baseCost*growth",
  );
  s.techs.smartLogistics = true;
  const reduced = buildingCost(s, "miningDrone");
  const expectedReduced = BUILDINGS.miningDrone.baseCost * Math.pow(BUILDINGS.miningDrone.costGrowth - 0.05, 1);
  ok(near(reduced, expectedReduced), "smartLogistics reduces cost growth");
}

// 2. Milestone multipliers.
{
  ok(milestoneTiers("miningDrone", 9) === 0, "tiers @9 = 0");
  ok(milestoneTiers("miningDrone", 10) === 1, "tiers @10 = 1");
  ok(milestoneTiers("miningDrone", 50) === 3, "tiers @50 = 3");
  ok(milestoneTiers("miningDrone", 200) === 4, "tiers @200 = 4");
  ok(milestoneMultiplier("miningDrone", 25) === 4, "mult @25 = 4");
}

// 3. Tech modifiers.
{
  const s = createNewGame();
  ok(computeModifiers(s).miningMult === 1, "base miningMult 1");
  s.techs.highPressureDrill = true;
  ok(computeModifiers(s).miningMult === 1.5, "highPressureDrill -> 1.5");
}

// 4. Production simulation: mining + chain.
{
  const s = createNewGame();
  s.buildings.miningDrone = 10; // 10 ore/s before milestone (10 gives x2 -> 20/s)
  s.buildings.furnace = 5; // 5 ore/s capacity
  s.buildings.factory = 2; // 1 steel/s capacity
  const beforeOre = s.resources.ore;
  const beforeSteel = s.resources.steel;
  const beforeComp = s.resources.components;
  simulate(s, 1_000); // 1 second
  ok(s.resources.ore > beforeOre, "ore increased");
  ok(s.resources.steel > beforeSteel, "steel produced");
  ok(s.resources.components > beforeComp, "components produced");
  ok(Number.isFinite(s.resources.ore) && s.resources.ore >= 0, "ore finite/nonneg");
  ok(s.rates.furnaceUtil <= 1.0001, "furnace util <= 1");
  // furnace capacity (5/s) < mining (20/s) -> ore accumulates, furnace full.
  ok(s.rates.oreAccumulating === true, "ore accumulating detected");
}

// 5. Bottleneck (shortage) when upstream too weak.
{
  const s = createNewGame();
  s.buildings.miningDrone = 1; // ~1 ore/s (no milestone)
  s.buildings.furnace = 20; // 20 ore/s capacity >> supply
  simulate(s, 1_000);
  ok(s.rates.oreShortage === true, "ore shortage detected");
}

// 6. Manual mine + sell.
{
  const s = createNewGame();
  const c0 = s.resources.credits;
  manualMine(s);
  ok(s.resources.ore === 1, "manual mine +1 ore");
  const gain = sellResource(s, "ore", 1);
  ok(near(s.resources.ore, 0), "sell clears ore");
  ok(near(s.resources.credits, c0 + gain), "sell added credits");
  ok(s.stats.lifetimeCredits > 0, "lifetimeCredits tracked");
}

// 7. Negative / zero dt is safe.
{
  const s = createNewGame();
  s.buildings.miningDrone = 5;
  const o0 = s.resources.ore;
  simulate(s, -5000);
  ok(s.resources.ore === o0, "negative dt does nothing");
}

// 8. Prestige computation + reset.
{
  const s = createNewGame();
  s.stats.lifetimeCredits = 500_000; // at divisor 5000 -> sqrt(100)=10
  ok(pendingCoreData(s) === 10, "pendingCoreData = 10 at 500k (divisor 5000)");
  ok(canPrestige(s), "canPrestige true at threshold");
  s.permanentUpgrades.fasterBoot = true;
  const cd0 = s.coreData;
  const gained = doPrestige(s);
  ok(gained === 10, "doPrestige returns 10");
  ok(s.coreData === cd0 + 10, "coreData increased");
  ok(s.resources.credits === 0 && s.resources.ore === 0, "run resources reset");
  ok(s.buildings.miningDrone === 2, "fasterBoot applies after prestige");
  ok(s.permanentUpgrades.fasterBoot === true, "permanent upgrade kept");
  ok(s.stats.prestigeCount === 1, "prestige count incremented");
}

// 9. Offline simulation caps and produces.
{
  const s = createNewGame();
  s.buildings.miningDrone = 10;
  const produced = simulateOffline(s, 3_600_000); // 1 hour
  ok(produced.ore > 0, "offline produced ore");
  ok(Number.isFinite(produced.ore), "offline ore finite");
  // capped beyond 24h
  const s2 = createNewGame();
  s2.buildings.miningDrone = 1;
  const p2 = simulateOffline(s2, 100 * 24 * 3_600_000);
  ok(Number.isFinite(p2.ore), "huge offline finite");
}

// 10. Export / import round trip (no localStorage needed).
{
  const s = createNewGame();
  s.buildings.miningDrone = 7;
  s.resources.credits = 12345;
  s.permanentUpgrades.industrialMemory = true;
  const code = exportSave(s);
  const back = importSave(code);
  ok(back !== null, "import returns state");
  if (back) {
    ok(back.buildings.miningDrone === 7, "import preserved buildings");
    ok(back.resources.credits === 12345, "import preserved credits");
    ok(back.permanentUpgrades.industrialMemory === true, "import preserved upgrades");
  }
}

// 11. Auto-sell converts surplus to credits.
{
  const s = createNewGame();
  s.buildings.miningDrone = 50; // plenty of ore/s, exceeds auto-sell reserve
  s.autoSell.ore = true;
  simulate(s, 10_000);
  ok(s.resources.credits > 0, "auto-sell generated credits");
}

console.log(`\nCore tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} test(s) failed`);
}
