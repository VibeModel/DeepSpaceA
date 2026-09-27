// Planet + region pure-logic tests. Run with: npm test
import { createNewGame } from "../src/game/state";
import {
  PLANET_LIST,
  REGION_LIST,
  getPlanet,
  getRegion,
  emptyRegionMap,
  regionAvailable,
  regionsForPlanet,
  regionLevel,
  regionMaxed,
  regionCost,
  canUpgradeRegion,
  upgradeRegion,
  planetRegionModifiers,
  costMultFromPlanet,
  planetUnlocked,
  planetMeetsCriteria,
} from "../src/game/planets";
import { computeModifiers } from "../src/game/research";
import { buildingCost } from "../src/game/buildings";
import { simulate } from "../src/game/simulation";
import { doPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import { BUILDINGS, PLANETS, REGIONS } from "../src/game/balance";
import type { GameState, PlanetId } from "../src/game/types";

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

// Make a state that can prestige right now (has unclaimed core data).
function prestigable(): GameState {
  const s = createNewGame();
  s.stats.lifetimeCredits = 500_000; // raw entitlement = floor(sqrt(100)) = 10
  return s;
}

// --- 1. Derived planet unlock ---
{
  const s = createNewGame();
  ok(planetUnlocked(s, "homeworld"), "unlock: homeworld always unlocked");
  ok(!planetUnlocked(s, "ferrum"), "unlock: ferrum locked at prestigeCount 0");
  ok(!planetUnlocked(s, "cryon"), "unlock: cryon locked without core data");

  s.stats.prestigeCount = 1;
  ok(planetUnlocked(s, "ferrum"), "unlock: ferrum at prestigeCount 1");
  ok(!planetUnlocked(s, "pyra"), "unlock: pyra still locked at prestigeCount 1");
  s.stats.prestigeCount = 3;
  ok(planetUnlocked(s, "pyra"), "unlock: pyra at prestigeCount 3");

  // Boundary: cryon needs lifetimeCoreData >= 80 exactly.
  s.lifetimeCoreData = 79;
  ok(!planetUnlocked(s, "cryon"), "unlock: cryon locked at 79");
  s.lifetimeCoreData = 80;
  ok(planetUnlocked(s, "cryon"), "unlock: cryon unlocked at exactly 80");
  ok(planetMeetsCriteria(s, "cryon"), "unlock: meetsCriteria mirrors unlocked");

  // Unknown id must never report as unlocked.
  ok(!planetUnlocked(s, "bogus" as PlanetId), "unlock: unknown id is locked");
}

// --- 2. Modifier aggregation ---
{
  const s = createNewGame();
  const base = planetRegionModifiers(s);
  ok(base.miningMult === 1, "mods: homeworld miningMult = 1");
  ok(base.costMult === 1, "mods: homeworld costMult = 1");
  ok(base.powerSupplyMult === 1, "mods: homeworld powerSupplyMult = 1");

  s.planet = "ferrum";
  const fer = planetRegionModifiers(s);
  ok(near(fer.miningMult, 1.6), "mods: ferrum miningMult = 1.6");
  ok(near(fer.powerSupplyMult, 0.75), "mods: ferrum powerSupplyMult = 0.75");

  // Region effects stack multiplicatively on top of the planet.
  s.regions.miningField = 1; // 1 + 0.15*1
  const withRegion = planetRegionModifiers(s);
  ok(near(withRegion.miningMult, 1.6 * 1.15), "mods: ferrum + miningField Lv1 = 1.84");

  // Foundry grants two effects.
  s.planet = "homeworld";
  s.regions.foundry = 2; // smelt 1+0.12*2=1.24, steelYield 1+0.05*2=1.10
  const f = planetRegionModifiers(s);
  ok(near(f.smeltMult, 1.24), "mods: foundry Lv2 smeltMult = 1.24");
  ok(near(f.steelYieldMult, 1.1), "mods: foundry Lv2 steelYieldMult = 1.10");

  // computeModifiers folds the planet layer in (so simulate benefits for free).
  const s2 = createNewGame();
  s2.buildings.miningDrone = 1;
  simulate(s2, 1000);
  ok(near(s2.rates.oreProd, 1), "mods: homeworld mining rate = 1");
  s2.planet = "ferrum";
  simulate(s2, 1000);
  ok(near(s2.rates.oreProd, 1.6), "mods: ferrum mining rate = 1.6");
}

// --- 3. Building cost multiplier ---
{
  const s = createNewGame();
  // Regression: homeworld must reproduce the plain base cost.
  ok(
    buildingCost(s, "miningDrone") === BUILDINGS.miningDrone.baseCost,
    "cost: homeworld matches base cost",
  );
  ok(near(costMultFromPlanet(s), 1), "cost: homeworld costMult = 1");

  s.planet = "pyra";
  ok(near(costMultFromPlanet(s), 1.15), "cost: pyra costMult = 1.15");
  ok(
    near(buildingCost(s, "miningDrone"), BUILDINGS.miningDrone.baseCost * 1.15),
    "cost: pyra multiplies base cost",
  );
  // computeModifiers exposes the same cost multiplier.
  ok(near(computeModifiers(s).costMult, 1.15), "cost: computeModifiers.costMult = 1.15");
}

// --- 4. Region availability / cost / upgrade ---
{
  const s = createNewGame();
  ok(regionAvailable(s, "researchPark"), "region: researchPark on homeworld");
  ok(regionAvailable(s, "logisticsHub") === false, "region: logisticsHub not on homeworld");
  s.planet = "ferrum";
  ok(regionAvailable(s, "logisticsHub"), "region: logisticsHub on ferrum");
  ok(regionAvailable(s, "researchPark") === false, "region: researchPark not on ferrum");
  ok(
    regionsForPlanet("homeworld").some((r) => r.id === "researchPark"),
    "region: regionsForPlanet includes researchPark on homeworld",
  );
  ok(
    regionsForPlanet("ferrum").every((r) => r.id !== "researchPark"),
    "region: regionsForPlanet excludes researchPark on ferrum",
  );

  // Cost grows with level.
  const c0 = regionCost(s, "miningField");
  ok(c0 === getRegion("miningField").baseCost, "region: Lv0 cost = baseCost");
  s.regions.miningField = 1;
  ok(near(regionCost(s, "miningField"), c0 * 1.35), "region: Lv1 cost = baseCost*1.35");

  // Upgrade spends credits and increments the level.
  s.regions.miningField = 0;
  s.resources.credits = 1e9;
  const before = s.resources.credits;
  const spent = regionCost(s, "miningField");
  ok(canUpgradeRegion(s, "miningField"), "region: affordable upgrade allowed");
  ok(upgradeRegion(s, "miningField"), "region: upgrade succeeds");
  ok(regionLevel(s, "miningField") === 1, "region: level incremented");
  ok(near(s.resources.credits, before - spent), "region: credits deducted");

  // Unaffordable -> rejected, level unchanged.
  s.resources.credits = 0;
  ok(!canUpgradeRegion(s, "miningField"), "region: unaffordable rejected");
  ok(!upgradeRegion(s, "miningField"), "region: unaffordable upgrade fails");
  ok(regionLevel(s, "miningField") === 1, "region: failed upgrade leaves level");

  // Maxed -> rejected.
  s.regions.miningField = getRegion("miningField").maxLevel;
  s.resources.credits = 1e9;
  ok(regionMaxed(s, "miningField"), "region: maxed detected");
  ok(!upgradeRegion(s, "miningField"), "region: maxed upgrade rejected");

  // Unavailable region cannot be upgraded even with credits.
  s.planet = "ferrum";
  s.resources.credits = 1e9;
  ok(!canUpgradeRegion(s, "researchPark"), "region: unavailable rejected");
}

// --- 5. Prestige destination selection ---
{
  const s = prestigable();
  s.stats.prestigeCount = 1; // ferrum unlocked
  s.regions.miningField = 5; // run progress to be wiped
  s.regions.powerGrid = 3;
  const gained = doPrestige(s, "ferrum");
  ok(gained > 0, "prestige: gained some core data");
  ok(s.planet === "ferrum", "prestige: lands on requested planet");
  ok(s.nextPlanet === "ferrum", "prestige: nextPlanet follows landing");
  ok(s.regions.miningField === 0, "prestige: regions reset (miningField)");
  ok(s.regions.powerGrid === 0, "prestige: regions reset (powerGrid)");
  ok(s.stats.prestigeCount === 2, "prestige: prestigeCount incremented");
  ok(s.coreData === gained, "prestige: core data credited");

  // Requesting a LOCKED planet falls back safely (no stranding).
  const s2 = prestigable(); // prestigeCount 0, no core data; cryon locked
  const g2 = doPrestige(s2, "cryon");
  ok(g2 > 0, "prestige-fallback: prestiged");
  ok(s2.planet === "homeworld", "prestige-fallback: locked target -> homeworld");

  // No target argument: keep the current nextPlanet.
  const s3 = prestigable();
  s3.stats.prestigeCount = 1;
  s3.nextPlanet = "ferrum";
  doPrestige(s3);
  ok(s3.planet === "ferrum", "prestige-default: uses stored nextPlanet");
}

// --- 6. Old-save compatibility (missing planet/region fields) ---
{
  const s = createNewGame();
  s.planet = "ferrum";
  s.nextPlanet = "ferrum";
  s.regions.miningField = 4;
  // Simulate a legacy save written before these fields existed.
  const legacy = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete legacy.planet;
  delete legacy.nextPlanet;
  delete legacy.regions;

  const restored = importSave(exportSave(legacy as unknown as GameState))!;
  ok(restored.planet === "homeworld", "compat: planet defaults to homeworld");
  ok(restored.nextPlanet === "homeworld", "compat: nextPlanet defaults to homeworld");
  ok(typeof restored.regions === "object", "compat: regions object present");
  ok(Object.keys(restored.regions).length === REGION_LIST.length, "compat: all regions enumerated");
  const allZero = REGION_LIST.every((r) => restored.regions[r.id] === 0);
  ok(allZero, "compat: every region level is a number (0)");
  ok(
    Number.isFinite(restored.regions.miningField),
    "compat: region level finite (no undefined/NaN)",
  );
}

// --- 7. sanitize clamps regions and planet ids ---
{
  const s = createNewGame();
  s.regions.miningField = Infinity;
  s.regions.foundry = -5;
  s.regions.powerGrid = 1e9;
  s.planet = "bogus" as unknown as PlanetId;
  s.nextPlanet = "bogus" as unknown as PlanetId;
  simulate(s, 1000); // triggers sanitize
  ok(regionLevel(s, "miningField") === getRegion("miningField").maxLevel, "sanitize: Infinity -> maxLevel");
  ok(regionLevel(s, "foundry") === 0, "sanitize: negative -> 0");
  ok(
    regionLevel(s, "powerGrid") === getRegion("powerGrid").maxLevel,
    "sanitize: huge -> maxLevel",
  );
  ok(s.planet === "homeworld", "sanitize: illegal planet -> homeworld");
  ok(s.nextPlanet === "homeworld", "sanitize: illegal nextPlanet -> homeworld");
}

// --- 8. Data integrity ---
{
  ok(PLANET_LIST.length === Object.keys(PLANETS).length, "data: PLANET_LIST complete");
  ok(REGION_LIST.length === Object.keys(REGIONS).length, "data: REGION_LIST complete");
  ok(getPlanet("homeworld").id === "homeworld", "data: getPlanet works");
  ok(getRegion("foundry").id === "foundry", "data: getRegion works");
  ok(Object.keys(emptyRegionMap()).length === REGION_LIST.length, "data: emptyRegionMap complete");
  ok(emptyRegionMap().miningField === 0, "data: emptyRegionMap starts at 0");
}

console.log(`\nPlanet tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} planet test(s) failed`);
}
