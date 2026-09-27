// Core pure-logic tests. Run with: npm test  (uses tsx, no heavy framework).
import { createNewGame } from "../src/game/state";
import {
  buildingCost,
  milestoneMultiplier,
  milestoneTiers,
  buyBuilding,
  buildingUnlocked,
} from "../src/game/buildings";
import {
  computeModifiers,
  researchTech,
  techCost,
  techLevel,
  techMaxed,
  isInfiniteTech,
} from "../src/game/research";
import {
  simulate,
  manualMine,
  sellResource,
  simulateOffline,
} from "../src/game/simulation";
import { pendingCoreData, doPrestige, canPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import {
  BUILDINGS,
  TECHS,
  UPGRADES,
  INFINITE_TECH_COST_GROWTH,
  MAX_VALUE,
} from "../src/game/balance";
import {
  isInfiniteUpgrade,
  upgradeCost,
  upgradeLevel,
  upgradeMaxed,
  buyUpgrade,
} from "../src/game/upgrades";
import { capNumber, safePow } from "../src/game/num";
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
  s.techs.smartLogistics = 1;
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
  s.techs.highPressureDrill = 1;
  ok(computeModifiers(s).miningMult === 1.5, "highPressureDrill -> 1.5");
}

// 3b. Repeatable ("infinite") techs: cost grows, effect scales with level.
{
  const s = createNewGame();
  const base = TECHS.highPressureDrill.cost;
  ok(isInfiniteTech("highPressureDrill"), "highPressureDrill is repeatable");
  ok(!isInfiniteTech("automatedTrading"), "automatedTrading is finite");
  ok(techCost(s, "highPressureDrill") === base, "Lv0 cost = base cost");

  s.resources.research = 1_000_000;
  ok(researchTech(s, "highPressureDrill"), "buy Lv1");
  ok(techLevel(s, "highPressureDrill") === 1, "level 1 after buy");
  ok(near(computeModifiers(s).miningMult, 1.5), "Lv1 mining x1.5");
  ok(
    near(techCost(s, "highPressureDrill"), base * INFINITE_TECH_COST_GROWTH),
    "Lv1->2 cost = base * growth",
  );

  ok(researchTech(s, "highPressureDrill"), "buy Lv2");
  ok(techLevel(s, "highPressureDrill") === 2, "level 2 after buy");
  ok(near(computeModifiers(s).miningMult, 2.0), "Lv2 mining x2.0 (linear)");
  ok(!techMaxed(s, "highPressureDrill"), "repeatable tech never maxed");

  // Finite tech stays one-time (smartLogistics is NOT repeatable).
  s.techs.smartLogistics = 1;
  ok(!isInfiniteTech("smartLogistics"), "smartLogistics is finite");
  ok(techMaxed(s, "smartLogistics"), "finite maxed at Lv1");
  ok(!researchTech(s, "smartLogistics"), "cannot rebuy finite tech");
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
  ok(s.rates.furnaceCap > 0, "furnace capacity reported");
  ok(s.rates.factoryCap > 0, "factory capacity reported");
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
  s.permanentUpgrades.fasterBoot = 1;
  const cd0 = s.coreData;
  const gained = doPrestige(s);
  ok(gained === 10, "doPrestige returns 10");
  ok(s.coreData === cd0 + 10, "coreData increased");
  ok(s.resources.credits === 0 && s.resources.ore === 0, "run resources reset");
  ok(s.buildings.miningDrone === 2, "fasterBoot applies after prestige");
  ok(s.permanentUpgrades.fasterBoot === 1, "permanent upgrade kept");
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
  s.permanentUpgrades.industrialMemory = 1;
  const code = exportSave(s);
  const back = importSave(code);
  ok(back !== null, "import returns state");
  if (back) {
    ok(back.buildings.miningDrone === 7, "import preserved buildings");
    ok(back.resources.credits === 12345, "import preserved credits");
    ok(back.permanentUpgrades.industrialMemory === 1, "import preserved upgrades");
  }
}

// 10b. Legacy boolean techs migrate to numeric levels on import.
{
  const s = createNewGame();
  (s.techs as unknown as Record<string, unknown>).highPressureDrill = true;
  (s.techs as unknown as Record<string, unknown>).advancedAlloys = false;
  const back = importSave(exportSave(s));
  ok(back !== null, "legacy import returns state");
  if (back) {
    ok(back.techs.highPressureDrill === 1, "boolean true -> level 1");
    ok(back.techs.advancedAlloys === 0, "boolean false -> level 0");
  }
}

// 12. Number safety: cap helpers + sanitize caps instead of wiping.
{
  ok(capNumber(Infinity) === MAX_VALUE, "capNumber(Infinity) = MAX_VALUE");
  ok(capNumber(NaN) === 0, "capNumber(NaN) = 0");
  ok(capNumber(-5) === 0, "capNumber(-5) = 0");
  ok(safePow(1.5, 10000) === MAX_VALUE, "safePow overflow caps at MAX_VALUE");
  ok(safePow(2, 10) === 1024, "safePow normal value");
  const s = createNewGame();
  s.resources.credits = Infinity;
  s.resources.ore = Infinity;
  manualMine(s); // triggers sanitize
  ok(s.resources.credits === MAX_VALUE, "sanitize caps Infinity credits (no wipe)");
  ok(s.resources.ore === MAX_VALUE, "sanitize caps Infinity ore (no wipe)");
}

// 13. Repeatable permanent upgrades: cost grows, effect scales with level.
{
  const s = createNewGame();
  s.coreData = 1_000_000;
  ok(isInfiniteUpgrade("industrialMemory"), "industrialMemory repeatable");
  ok(!isInfiniteUpgrade("automatedLogistics"), "automatedLogistics finite");
  const base = UPGRADES.industrialMemory.cost;
  ok(upgradeCost(s, "industrialMemory") === base, "Lv0 upgrade cost = base");
  const pm0 = computeModifiers(s).globalProdMult;

  ok(buyUpgrade(s, "industrialMemory"), "buy upgrade Lv1");
  ok(upgradeLevel(s, "industrialMemory") === 1, "upgrade level 1");
  ok(near(computeModifiers(s).globalProdMult, pm0 * 1.2), "Lv1 -> +20%");
  ok(
    upgradeCost(s, "industrialMemory") === capNumber(base * 1.6),
    "Lv1->2 cost = base * growth",
  );

  ok(buyUpgrade(s, "industrialMemory"), "buy upgrade Lv2");
  ok(near(computeModifiers(s).globalProdMult, pm0 * 1.4), "Lv2 -> +40% (linear)");
  ok(!upgradeMaxed(s, "industrialMemory"), "repeatable upgrade never maxed");

  // Finite permanent upgrade stays one-time.
  s.permanentUpgrades.automatedLogistics = 1;
  ok(upgradeMaxed(s, "automatedLogistics"), "finite upgrade maxed at Lv1");
  ok(!buyUpgrade(s, "automatedLogistics"), "cannot rebuy finite upgrade");
}

// 14. Auto-research buys techs when unlocked & enabled.
{
  const s = createNewGame();
  s.flags.autoResearchUnlocked = true;
  s.autoResearch = true;
  s.resources.research = 1_000;
  simulate(s, 1_000);
  ok(
    Object.values(s.techs).some((lv) => lv > 0),
    "auto-research bought at least one tech",
  );

  const s2 = createNewGame();
  s2.flags.autoResearchUnlocked = true;
  s2.autoResearch = false;
  s2.resources.research = 1_000;
  simulate(s2, 1_000);
  ok(
    Object.values(s2.techs).every((lv) => lv === 0),
    "auto-research off -> no purchases",
  );
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
