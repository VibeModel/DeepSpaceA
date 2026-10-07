// Recipe-system tests: allocation, unlocking, multi-input caps, the blueprint
// currency and save/prestige round-trips. Run with: npm test
import { createNewGame } from "../src/game/state";
import { simulate } from "../src/game/simulation";
import {
  RECIPE_LIST,
  getRecipe,
  recipesForBuilding,
  isRecipeUnlocked,
  defaultRecipeFor,
  defaultRecipeMix,
  recipeAllocation,
  recipeShare,
  normalizeMix,
} from "../src/game/recipes";
import { computeModifiers } from "../src/game/research";
import { buyUpgrade, upgradeCurrency } from "../src/game/upgrades";
import { doPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import { BUILDING_ORDER, RECIPES } from "../src/game/balance";
import type { RecipeId } from "../src/game/types";

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
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// --- 1. Config sanity ---
{
  for (const r of RECIPE_LIST) {
    ok(BUILDING_ORDER.includes(r.machine), `recipe ${r.id}: machine is a real building`);
    ok(r.inputs.length >= 1, `recipe ${r.id}: has at least one input`);
    ok(r.speed > 0, `recipe ${r.id}: positive speed`);
    ok(r.outputAmount > 0, `recipe ${r.id}: positive output amount`);
  }
  ok(getRecipe("smeltSteel").output === "steel", "smeltSteel outputs steel");
  ok(getRecipe("synthesizeBlueprint").output === "blueprints", "blueprint recipe outputs blueprints");
  ok(recipesForBuilding("furnace").length === 2, "furnace has two recipes");
  ok(recipesForBuilding("miningDrone").length === 0, "producers have no recipes");
}

// --- 2. Unlocking ---
{
  const s = createNewGame();
  ok(isRecipeUnlocked(s, "smeltSteel"), "base recipe unlocked from the start");
  ok(!isRecipeUnlocked(s, "smeltCopper"), "copper recipe gated behind a tech");
  ok(!isRecipeUnlocked(s, "makeCircuit"), "circuit recipe gated behind a tech");
  s.techs.copperProcessing = 1;
  ok(isRecipeUnlocked(s, "smeltCopper"), "tech unlocks copper smelting");
  s.techs.circuitFabrication = 1;
  ok(isRecipeUnlocked(s, "makeCircuit"), "tech unlocks circuit fabrication");
}

// --- 3. Default recipe / mix ---
{
  ok(defaultRecipeFor("furnace") === "smeltSteel", "default furnace recipe is smeltSteel");
  ok(defaultRecipeFor("assembler") === "makeAlloy", "default assembler recipe is makeAlloy");
  ok(defaultRecipeFor("miningDrone") === null, "producers have no default recipe");

  const mix = defaultRecipeMix();
  let exhaustive = true;
  for (const bid of BUILDING_ORDER) {
    if (!mix[bid]) {
      exhaustive = false;
      break;
    }
    for (const r of recipesForBuilding(bid)) {
      if (typeof mix[bid][r.id] !== "number") exhaustive = false;
    }
  }
  ok(exhaustive, "defaultRecipeMix lists every building AND every one of its recipes");
  // The base recipe runs at full weight; the gated ones start at zero.
  ok(mix.furnace.smeltSteel === 1 && mix.furnace.smeltCopper === 0, "furnace default weight 1/0");
  ok(mix.factory.makeComponents === 1 && mix.factory.makeCircuit === 0, "factory default weight 1/0");
}

// --- 4. Allocation by weight (splitting a machine across recipes) ---
{
  const s = createNewGame();
  s.techs.copperProcessing = 1;
  s.buildings.furnace = 20;
  s.recipeMix.furnace = { smeltSteel: 3, smeltCopper: 1 };
  const alloc = recipeAllocation(s, "furnace");
  ok(alloc.length === 2, "allocation returns both recipes");
  ok(near(alloc[0].count, 15), "3:1 split -> 15 on the first recipe");
  ok(near(alloc[1].count, 5), "3:1 split -> 5 on the second recipe");
  ok(near(recipeShare(s, "furnace", "smeltSteel"), 0.75), "recipeShare = 0.75");
  ok(near(recipeShare(s, "furnace", "smeltCopper"), 0.25), "recipeShare = 0.25");
  ok(recipeAllocation(s, "miningDrone").length === 0, "producers allocate nothing");
}

// --- 5. A locked recipe is dropped, not silently mis-split ---
{
  const s = createNewGame();
  s.buildings.furnace = 10;
  s.recipeMix.furnace = { smeltSteel: 1, smeltCopper: 1 }; // copper still locked
  const alloc = recipeAllocation(s, "furnace");
  ok(alloc.length === 1, "locked recipe excluded from the allocation");
  ok(alloc[0].recipe.id === "smeltSteel", "remaining recipe is the base one");
  ok(near(alloc[0].count, 10), "all 10 machines fall back onto the base recipe");
}

// --- 6. All-zero mix falls back to the default recipe at full count ---
{
  const s = createNewGame();
  s.techs.copperProcessing = 1;
  s.buildings.furnace = 6;
  s.recipeMix.furnace = { smeltSteel: 0, smeltCopper: 0 };
  const alloc = recipeAllocation(s, "furnace");
  ok(alloc.length === 1 && alloc[0].recipe.id === "smeltSteel", "zero weights -> default recipe");
  ok(near(alloc[0].count, 6), "default recipe runs at full machine count");
}

// --- 7. normalizeMix sanitises hand-edited / legacy data ---
{
  const s = createNewGame();
  s.recipeMix.furnace = {
    smeltSteel: 2,
    bogusRecipe: 5,
    makeComponents: 7,
  } as unknown as Partial<Record<RecipeId, number>>;
  s.recipeMix.factory = { makeComponents: 3.7 };
  normalizeMix(s);
  ok(s.recipeMix.furnace.smeltSteel === 2, "normalizeMix keeps a valid weight");
  ok(!("bogusRecipe" in s.recipeMix.furnace), "normalizeMix drops an unknown recipe id");
  ok(!("makeComponents" in s.recipeMix.furnace), "normalizeMix drops a foreign recipe");
  ok(s.recipeMix.factory.makeComponents === 3, "normalizeMix floors fractional weights");
  let allPresent = true;
  for (const bid of BUILDING_ORDER) if (!s.recipeMix[bid]) allPresent = false;
  ok(allPresent, "normalizeMix keeps every BuildingId present");
}

// --- 8. Regression: a furnace can run steel AND copper at once ---
// (With a binary recipe switch the two are mutually exclusive, which makes
// circuits — copper + components — permanently unreachable.)
{
  const s = createNewGame();
  s.techs.copperProcessing = 1;
  s.buildings.miningDrone = 10; // 20 ore/s
  s.buildings.copperMine = 10; // 20 copper ore/s
  s.buildings.furnace = 10; // split 5 steel / 5 copper
  s.recipeMix.furnace = { smeltSteel: 1, smeltCopper: 1 };
  simulate(s, 1000);
  ok(s.resources.steel > 0, "split furnace produced steel");
  ok(s.resources.copper > 0, "split furnace produced copper in the SAME tick");
}

// --- 9. The full chain reaches circuits ---
{
  const s = createNewGame();
  s.techs.copperProcessing = 1;
  s.techs.circuitFabrication = 1;
  s.buildings.copperMine = 10;
  s.buildings.furnace = 10;
  s.buildings.factory = 10;
  s.recipeMix.furnace = { smeltSteel: 0, smeltCopper: 1 };
  s.recipeMix.factory = { makeComponents: 0, makeCircuit: 1 };
  s.resources.components = 100; // seed the non-copper input
  simulate(s, 1000);
  ok(s.stats.totalCopper > 0, "chain: copper smelted");
  ok(s.resources.circuit > 0, "chain: circuits assembled");
  ok(s.stats.totalCircuit > 0, "chain: totalCircuit tracked");
}

// --- 10. Multi-input batches are capped by the scarcest input ---
{
  const s = createNewGame();
  s.techs.circuitFabrication = 1;
  s.buildings.factory = 10; // 10 * 0.4 * milestone(x2) = 8 batches/s capacity
  s.recipeMix.factory = { makeComponents: 0, makeCircuit: 1 };
  s.resources.copper = 1000;
  s.resources.components = 3; // only 3 batches' worth
  simulate(s, 1000);
  ok(near(s.resources.circuit, 3), "output limited by the scarcest input (3)");
  ok(near(s.resources.components, 0), "scare input fully consumed");
  ok(near(s.resources.copper, 994), "copper consumed 2 per batch (6 total)");
  const pr = s.rates.processors.makeCircuit;
  ok(near(pr.yield, 1), "base recipe yield = 1");
  ok(pr.capBatches > 3 && pr.util < 0.5, "starved machine has spare capacity (low utilisation)");
  ok(pr.shortage === true, "shortage flagged when starved");

  // With enough of both inputs the machine runs at capacity instead.
  const s2 = createNewGame();
  s2.techs.circuitFabrication = 1;
  s2.buildings.factory = 10;
  s2.recipeMix.factory = { makeComponents: 0, makeCircuit: 1 };
  s2.resources.copper = 1000;
  s2.resources.components = 1000;
  simulate(s2, 1000);
  ok(near(s2.resources.circuit, 8), "unstarved machine hits its batch capacity");
  ok(s2.rates.processors.makeCircuit.shortage === false, "no shortage at full capacity");
}

// --- 11. Recipe speed scales capacity ---
{
  const s = createNewGame();
  s.buildings.furnace = 5; // below the first milestone, so no x2 yet
  s.resources.ore = 1e9;
  simulate(s, 1000);
  ok(near(s.rates.processors.smeltSteel.capBatches, 5), "smeltSteel capacity = count * speed(1)");

  s.techs.copperProcessing = 1;
  s.recipeMix.furnace = { smeltSteel: 0, smeltCopper: 1 };
  s.resources.copperOre = 1e9;
  simulate(s, 1000);
  ok(near(s.rates.processors.smeltCopper.capBatches, 4), "smeltCopper capacity = count * speed(0.8)");
}

// --- 12. Blueprint currency: craft, track, spend ---
{
  const s = createNewGame();
  s.techs.alloySynthesis = 1;
  s.buildings.assembler = 10;
  s.recipeMix.assembler = { makeAlloy: 0, synthesizeBlueprint: 1 };
  s.resources.circuit = 1000;
  s.resources.alloy = 1000;
  simulate(s, 1000);
  ok(s.blueprints > 0, "blueprints synthesized from the chain");
  ok(s.stats.totalBlueprints > 0, "totalBlueprints tracked");
  ok(s.rates.net.blueprints > 0, "net blueprint rate is positive");
  ok(
    !Object.prototype.hasOwnProperty.call(s.rates.production, "blueprints"),
    "blueprints stay out of the resource production map",
  );

  // Blueprint upgrades draw on the blueprint wallet only.
  ok(upgradeCurrency("copperExtractor") === "blueprints", "copperExtractor is a blueprint upgrade");
  ok(upgradeCurrency("industrialMemory") === "coreData", "industrialMemory is a coreData upgrade");
  const before = computeModifiers(s).producerMult.copperOre;
  const bpBefore = s.blueprints;
  ok(buyUpgrade(s, "copperExtractor"), "buy a blueprint upgrade");
  ok(s.blueprints < bpBefore, "blueprints deducted");
  ok(computeModifiers(s).producerMult.copperOre > before, "blueprint upgrade boosts copper extraction");

  const s2 = createNewGame();
  s2.blueprints = 1000;
  s2.coreData = 0;
  ok(!buyUpgrade(s2, "industrialMemory"), "coreData upgrade is not payable with blueprints");
  ok(buyUpgrade(s2, "copperExtractor"), "blueprint upgrade is payable with blueprints");
}

// --- 13. Prestige keeps the blueprint currency, resets the recipe mix ---
{
  const s = createNewGame();
  s.runPeakCreditsPerSec = 500; // entitlement 10 -> prestige is a no-op otherwise
  s.blueprints = 7;
  s.techs.copperProcessing = 1;
  s.recipeMix.furnace = { smeltSteel: 3, smeltCopper: 1 };
  doPrestige(s);
  ok(s.blueprints === 7, "prestige keeps blueprints");
  ok(near(s.recipeMix.furnace.smeltSteel, 1), "prestige resets the recipe mix to default");
  ok(near(s.recipeMix.furnace.smeltCopper, 0), "prestige resets the gated recipe weight to 0");
}

// --- 14. Save round trip: blueprints + recipe mix ---
{
  const s = createNewGame();
  s.blueprints = 42;
  s.recipeMix.furnace = { smeltSteel: 2, smeltCopper: 5 };
  const back = importSave(exportSave(s));
  ok(back !== null, "save round trip returns state");
  if (back) {
    ok(back.blueprints === 42, "blueprints survive a save round trip");
    ok(back.recipeMix.furnace.smeltCopper === 5, "recipe mix survives a save round trip");
  }
}

// --- 15. Legacy saves (no recipeMix / no blueprints) get safe defaults ---
{
  const s = createNewGame();
  const json = decodeURIComponent(escape(atob(exportSave(s))));
  const env = JSON.parse(json) as { state: Record<string, unknown> };
  delete env.state.recipeMix;
  delete env.state.blueprints;
  const code = btoa(unescape(encodeURIComponent(JSON.stringify(env))));
  const back = importSave(code);
  ok(back !== null, "legacy save still imports");
  if (back) {
    ok(back.blueprints === 0, "missing blueprints default to 0");
    ok(back.recipeMix.furnace.smeltSteel === 1, "missing recipeMix falls back to the default mix");
    ok(RECIPES.smeltSteel.id === "smeltSteel", "recipe ids are stable");
  }
}

console.log(`\nRecipe tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} test(s) failed`);
}
