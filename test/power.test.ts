// Power-grid tests + a 60-minute balance regression bot. Run with: npm test
import { createNewGame } from "../src/game/state";
import { computeModifiers } from "../src/game/research";
import { computePower } from "../src/game/power";
import { simulate } from "../src/game/simulation";
import { canPrestige } from "../src/game/prestige";
import { BASE_POWER_SUPPLY } from "../src/game/balance";

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

// --- blank game: no demand, full factor ---
{
  const s = createNewGame();
  const p = computePower(s, computeModifiers(s));
  ok(p.supply === BASE_POWER_SUPPLY, "blank: supply = base supply");
  ok(p.demand === 0, "blank: no demand");
  ok(p.factor === 1, "blank: factor 1 (no brownout)");
}

// --- overload: factor = supply / demand ---
{
  const s = createNewGame();
  s.buildings.furnace = 200; // 200 * 0.6 = 120 demand vs 15 supply
  const p = computePower(s, computeModifiers(s));
  ok(near(p.demand, 120), "overload: demand = 120");
  ok(near(p.supply, BASE_POWER_SUPPLY), "overload: supply = 15");
  ok(near(p.factor, 15 / 120), "overload: factor = supply/demand");
}

// --- solar arrays restore the factor ---
{
  const s = createNewGame();
  s.buildings.furnace = 200;
  s.buildings.solarArray = 20; // 20 * 6 = 120 + 15 base -> above demand
  const p = computePower(s, computeModifiers(s));
  ok(p.supply > p.demand, "solar: supply covers demand");
  ok(p.factor === 1, "solar: factor restored to 1");
}

// --- grid optimization tech boosts supply ---
{
  const s = createNewGame();
  s.techs.gridOptimization = 2; // 1 + 0.25*2 = 1.5x
  const p = computePower(s, computeModifiers(s));
  ok(near(p.supply, BASE_POWER_SUPPLY * 1.5), "gridOptimization: supply x1.5");
}

// --- simulation scales production by the power factor ---
{
  const s = createNewGame();
  s.buildings.miningDrone = 1;
  s.buildings.furnace = 300; // forces a heavy brownout
  simulate(s, 1000);
  const r = s.rates;
  ok(r.powerFactor < 1, "simulate: brownout active");
  ok(near(r.powerFactor, r.powerSupply / r.powerDemand), "simulate: factor consistent");
  ok(
    near(r.oreProd, r.powerFactor),
    "simulate: mining output scaled by factor",
  );
}

// --- brownout must not be mis-reported as a raw-material shortage ---
{
  const s = createNewGame();
  s.buildings.furnace = 300;
  s.resources.ore = 1e9; // plenty of ore, only power is short
  simulate(s, 1000);
  ok(s.rates.powerFactor < 1, "no-false-shortage: brownout active");
  ok(s.rates.oreShortage === false, "no-false-shortage: not blamed on ore");

  // With no ore at all a genuine shortage must still be reported.
  const s2 = createNewGame();
  s2.buildings.furnace = 3;
  s2.resources.ore = 0;
  simulate(s2, 1000);
  ok(s2.rates.oreShortage === true, "no-false-shortage: real shortage still reported");
}

// --- structured metrics consistency ---
{
  const s = createNewGame();
  s.buildings.furnace = 4;
  s.resources.ore = 1e9;
  simulate(s, 1000);
  ok(near(s.rates.furnaceCap, 4), "metrics: furnace capacity = count * inputRate");
  ok(near(s.rates.furnaceInput, 4), "metrics: furnace input = consumed/s");
  ok(near(s.rates.furnaceYield, 1), "metrics: base yield = 1");
  s.techs.advancedAlloys = 1; // steel yield +25%
  simulate(s, 1000);
  ok(near(s.rates.furnaceYield, 1.25), "metrics: yield includes tech bonus");
}

// --- balance regression: first prestige reachable in 60 minutes ---
{
  const s = createNewGame();
  // Enable all automation so we test production/power pacing, not unlock timing.
  s.flags.autoSellUnlocked = true;
  s.flags.autoBuyUnlocked = true;
  s.flags.autoResearchUnlocked = true;
  s.autoSell = { ore: true, steel: true, components: true };
  s.autoBuy = {
    miningDrone: true,
    solarArray: true,
    furnace: true,
    factory: true,
    laboratory: true,
  };
  s.autoResearch = true;
  s.resources.credits = 200; // small bootstrap so auto-buy can start

  const MAX_STEPS = 3600; // 60 minutes at 1s steps
  let steps = 0;
  while (steps < MAX_STEPS && !canPrestige(s)) {
    simulate(s, 1000);
    steps++;
  }
  ok(canPrestige(s), `balance: first prestige within 60 min (took ${steps}s)`);
  ok(s.rates.powerFactor > 0, "balance: power factor stays positive");
}

console.log(`\nPower tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} power test(s) failed`);
}
