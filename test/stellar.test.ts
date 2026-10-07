// Second-layer (ascension / stellar charts) tests: the chart tree, the chart
// gain curve, ascension reset semantics and persistence.
// Run with: npm test
import { createNewGame } from "../src/game/state";
import {
  STELLAR_UPGRADE_IDS,
  emptyStellarUpgradeMap,
  getStellarUpgrade,
  stellarLevel,
  stellarCost,
  stellarMaxed,
  isInfiniteStellar,
  canBuyStellarUpgrade,
  buyStellarUpgrade,
  stellarModifiers,
} from "../src/game/stellar";
import {
  rawChartEntitlement,
  pendingCharts,
  canAscend,
  doAscend,
} from "../src/game/ascension";
import { computeModifiers } from "../src/game/research";
import { buildingCost } from "../src/game/buildings";
import { exportSave, importSave } from "../src/game/save";
import { ASCENSION_THRESHOLD_CORE, CHART_DIVISOR } from "../src/game/balance";

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

// --- 1. Default map is exhaustive over every upgrade id ---
{
  const m = emptyStellarUpgradeMap();
  for (const id of STELLAR_UPGRADE_IDS) ok(m[id] === 0, `default map has ${id}`);
  ok(Object.keys(m).length === STELLAR_UPGRADE_IDS.length, "default map has no extras");
}

// --- 2. Level 0 is fully neutral ---
{
  const s = createNewGame();
  const sm = stellarModifiers(s);
  ok(sm.globalProdMult === 1, "0 charts: no production bonus");
  ok(sm.costMult === 1, "0 charts: no cost reduction");
  ok(sm.prestigeGainMult === 1, "0 charts: no prestige bonus");
  ok(sm.chartGainMult === 1, "0 charts: no chart bonus");
  ok(sm.stargateCostMult === 1, "0 charts: no stargate discount");
  ok(sm.autoPrestige === false && sm.memory === false, "0 charts: no mechanic unlocked");
  const m = computeModifiers(s);
  ok(m.globalProdMult === 1 && m.chartGainMult === 1, "0 charts: computeModifiers neutral");
}

// --- 3. Buying deducts charts and raises the level ---
{
  const s = createNewGame();
  s.stellarCharts = 10;
  const cost = stellarCost(s, "chartIndustry");
  ok(buyStellarUpgrade(s, "chartIndustry"), "buy chartIndustry");
  ok(s.stellarCharts === 10 - cost, "charts deducted");
  ok(stellarLevel(s, "chartIndustry") === 1, "level advanced");
  ok(
    computeModifiers(s).globalProdMult > 1,
    "chartIndustry boosts global production",
  );
}

// --- 4. Infinite cost grows; finite upgrades are flat and max out ---
{
  const s = createNewGame();
  s.stellarCharts = 1e6;
  const c1 = stellarCost(s, "chartEconomy");
  buyStellarUpgrade(s, "chartEconomy");
  const c2 = stellarCost(s, "chartEconomy");
  ok(c2 > c1, "infinite chart upgrade cost grows");

  ok(!isInfiniteStellar("chartMemory"), "chartMemory is a finite upgrade");
  ok(!stellarMaxed(s, "chartMemory"), "finite upgrade not maxed before purchase");
  s.stellarCharts = getStellarUpgrade("chartMemory").cost;
  ok(buyStellarUpgrade(s, "chartMemory"), "buy finite chartMemory");
  ok(stellarMaxed(s, "chartMemory"), "finite upgrade maxed after purchase");
  ok(!canBuyStellarUpgrade(s, "chartMemory"), "cannot buy a maxed upgrade");
}

// --- 5. Cost reduction affects buildingCost (buildings.ts path) ---
{
  const s = createNewGame();
  s.buildings.miningDrone = 10;
  const before = buildingCost(s, "miningDrone");
  s.stellarUpgrades.chartEconomy = 5;
  const after = buildingCost(s, "miningDrone");
  ok(after < before, "chartEconomy lowers building cost");
  ok(near(after, before * Math.pow(0.96, 5)), "cost scales by 0.96^5");
}

// --- 6. Chart entitlement: run on lifetime Core Data, anti-farm by delta ---
{
  const s = createNewGame();
  s.lifetimeCoreData = 200; // raw = floor(sqrt(200/2)) = 10
  ok(near(rawChartEntitlement(s), Math.floor(Math.sqrt(200 / CHART_DIVISOR))), "raw entitlement formula");
  ok(pendingCharts(s) === 10, "pending charts = 10 at 200 lifetime core");
  ok(canAscend(s), "can ascend above the threshold");
  s.lifetimeCoreData = 10;
  ok(!canAscend(s), "cannot ascend below the threshold");
}

// --- 7. Ascension reset semantics ---
{
  const s = createNewGame();
  s.lifetimeCoreData = 200;
  s.coreData = 999;
  s.blueprints = 50;
  s.stargateLevel = 3;
  s.achievements.firstOre = true;
  s.permanentUpgrades.fasterBoot = 4;
  const gained = doAscend(s);
  ok(gained === 10, `ascension grants 10 charts (got ${gained})`);
  ok(s.stellarCharts === 10, "charts credited");
  ok(s.ascensionCount === 1, "ascension count incremented");
  ok(s.coreData === 0, "coreData wiped");
  ok(s.blueprints === 0, "blueprints wiped");
  ok(s.permanentUpgrades.fasterBoot === 0, "permanent upgrades wiped (no Memory Recall)");
  ok(s.stargateLevel === 3, "stargate level kept");
  ok(s.achievements.firstOre === true, "achievements kept");
  ok(s.lifetimeCoreData === 200, "lifetime core data kept");

  // No new charts at the same lifetime core data (anti-farm).
  ok(pendingCharts(s) === 0, "nothing pending right after claiming");
  ok(!canAscend(s), "cannot ascend again without more core data");
}

// --- 8. Memory Recall keeps 25% of permanent upgrades ---
{
  const s = createNewGame();
  s.lifetimeCoreData = 200;
  s.stellarUpgrades.chartMemory = 1;
  s.permanentUpgrades.fasterBoot = 4;
  s.permanentUpgrades.industrialMemory = 3;
  doAscend(s);
  ok(s.permanentUpgrades.fasterBoot === 1, "memory: 25% of 4 = 1");
  ok(s.permanentUpgrades.industrialMemory === 0, "memory: 25% of 3 floors to 0");
  ok(s.stellarUpgrades.chartMemory === 1, "memory: the chart upgrade itself is kept");
}

// --- 9. Save round-trip keeps the (exhaustive) chart tree ---
{
  const s = createNewGame();
  s.stellarCharts = 42;
  s.stellarUpgrades.chartIndustry = 3;
  s.ascensionCount = 2;
  const back = importSave(exportSave(s));
  ok(back !== null, "save: round trip");
  ok(back!.stellarCharts === 42, "save: charts preserved");
  ok(back!.stellarUpgrades.chartIndustry === 3, "save: chart upgrade level preserved");
  for (const id of STELLAR_UPGRADE_IDS) {
    ok(typeof back!.stellarUpgrades[id] === "number", `save: ${id} present after load`);
  }
}

console.log(`\nStellar tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`${failed} stellar test(s) failed`);
