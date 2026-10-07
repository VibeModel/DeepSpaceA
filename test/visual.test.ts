// Visual mapping tests (normalisation + deriveVisualParams + settings round-trip).
// Run with: npm test
import {
  VISUAL,
  STAGE_IDS,
  norm,
  logNorm,
  deriveVisualParams,
  type VisualInput,
} from "../src/ui/visual";
import type { BuildingId, RecipeOutputId } from "../src/game/types";
import {
  getAnimationLevel,
  setAnimationLevel,
  getNumberFormat,
  setNumberFormat,
} from "../src/ui/settings";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function eq(got: string, want: string, msg: string): void {
  ok(got === want, `${msg} — got "${got}", want "${want}"`);
}

// Numeric comparison with a tolerance (floating point).
function close(got: number, want: number, msg: string, eps = 1e-9): void {
  ok(Math.abs(got - want) <= eps, `${msg} — got ${got}, want ${want}`);
}

function inRange(v: number, lo: number, hi: number, msg: string): void {
  ok(Number.isFinite(v) && v >= lo && v <= hi, `${msg} — got ${v}, want [${lo}, ${hi}]`);
}

// Building counts with every BuildingId present (so nothing is undefined).
function bld(over: Partial<Record<BuildingId, number>> = {}): Record<BuildingId, number> {
  return {
    miningDrone: 0,
    solarArray: 0,
    copperMine: 0,
    furnace: 0,
    factory: 0,
    assembler: 0,
    laboratory: 0,
    ...over,
  };
}

// Output rates with every output id present (resources + blueprints).
function outs(over: Partial<Record<RecipeOutputId, number>> = {}): Record<RecipeOutputId, number> {
  const base: Record<RecipeOutputId, number> = {
    ore: 0,
    steel: 0,
    components: 0,
    credits: 0,
    research: 0,
    copperOre: 0,
    copper: 0,
    circuit: 0,
    alloy: 0,
    blueprints: 0,
  };
  return { ...base, ...over };
}

// A blank-slate game: nothing built, nothing produced.
function blankInput(over: Partial<VisualInput> = {}): VisualInput {
  return {
    outputs: outs(),
    creditsRate: 0,
    bottleneck: false,
    buildings: bld(),
    powerFactor: 1,
    analyticsUnlocked: false,
    ...over,
  };
}

// --- norm / logNorm ---
eq(norm(0, 60).toString(), "0", "norm: zero");
eq(norm(NaN, 60).toString(), "0", "norm: NaN guard");
eq(norm(-5, 60).toString(), "0", "norm: negative guard");
eq(norm(Infinity, 60).toString(), "0", "norm: Infinity guard");
eq(norm(10, 0).toString(), "0", "norm: zero scale guard");
ok(norm(Infinity, 60) <= 1, "norm: bounded above by 1");
ok(norm(1, 60) < norm(10, 60) && norm(10, 60) < norm(1e6, 60), "norm: strictly increasing");
ok(norm(1e18, 60) <= 1 && Number.isFinite(norm(1e18, 60)), "norm: huge value finite & <=1");

eq(logNorm(0, 1e6).toString(), "0", "logNorm: zero");
eq(logNorm(1, 1e6).toString(), "0", "logNorm: one -> 0");
close(logNorm(1e6, 1e6), 1, "logNorm: max -> 1");
eq(logNorm(1e9, 1e6).toString(), "1", "logNorm: above max capped at 1");
eq(logNorm(NaN, 1e6).toString(), "0", "logNorm: NaN guard");

// --- deriveVisualParams: blank game ---
{
  const p = deriveVisualParams(blankInput());
  close(p.intensity, VISUAL.idleFloor, "blank: intensity == idleFloor", 1e-9);
  // With an idle floor > 0 the planet already glows faintly and breathes just
  // shy of its slowest.
  const glowIdle = VISUAL.glowFloor + VISUAL.idleFloor * (1 - VISUAL.glowFloor);
  close(p.glow, glowIdle, "blank: glow at idle floor", 1e-9);
  const breatheIdle = VISUAL.breatheMax + (VISUAL.breatheMin - VISUAL.breatheMax) * VISUAL.idleFloor;
  close(p.breatheDur, breatheIdle, "blank: breathes near slowest", 1e-9);
  eq(p.dotCount.toString(), "0", "blank: no dots lit");
  eq(p.strained.toString(), "false", "blank: not strained");
  eq(p.hasIndustry.toString(), "false", "blank: no industry");
  eq(p.hasRing.toString(), "false", "blank: no ring");
  eq(p.creditActive.toString(), "false", "blank: credit pulse off");
  close(p.creditDur, VISUAL.creditDurMax, "blank: credit pulse slowest", 1e-9);
}

// --- deriveVisualParams: huge values stay finite & in range ---
{
  const huge = deriveVisualParams(
    blankInput({
      outputs: outs({ ore: 1e18, steel: 1e18, components: 1e18, research: 1e18 }),
      creditsRate: 1e18,
      buildings: bld({
        miningDrone: 1e6,
        solarArray: 1e6,
        copperMine: 1e6,
        furnace: 1e6,
        factory: 1e6,
        assembler: 1e6,
        laboratory: 1e6,
      }),
      analyticsUnlocked: true,
    }),
  );
  inRange(huge.intensity, 0, 1, "huge: intensity");
  inRange(huge.glow, 0, 1, "huge: glow");
  inRange(huge.activity, 0, 1, "huge: activity");
  inRange(huge.creditIntensity, 0, 1, "huge: creditIntensity");
  inRange(huge.breatheDur, VISUAL.breatheMin, VISUAL.breatheMax, "huge: breatheDur");
  inRange(huge.orbitDur, VISUAL.orbitMin, VISUAL.orbitMax, "huge: orbitDur");
  inRange(huge.creditDur, VISUAL.creditDurMin, VISUAL.creditDurMax, "huge: creditDur");
  eq(huge.creditActive.toString(), "true", "huge: credit pulse active");
  for (const k of STAGE_IDS) {
    inRange(huge.flowDur[k], VISUAL.flowMin, VISUAL.flowMax, `huge: flowDur.${k}`);
  }
  inRange(huge.dotCount, 0, VISUAL.dotPool, "huge: dotCount");
  eq(huge.hasRing.toString(), "true", "huge: ring unlocked");
  eq(huge.hasIndustry.toString(), "true", "huge: industry present");
  for (const n of huge.nodes) {
    inRange(n.height, VISUAL.towerMinH, VISUAL.towerMaxH, `huge: node ${n.id} height`);
    inRange(n.glow, 0, 1, `huge: node ${n.id} glow`);
    inRange(n.pulseDur, VISUAL.nodePulseMin, VISUAL.nodePulseMax, `huge: node ${n.id} pulseDur`);
  }
  inRange(huge.convoy, 0, VISUAL.convoyPool, "huge: convoy");
  inRange(huge.convoyDur, VISUAL.convoyDurMin, VISUAL.convoyDurMax, "huge: convoyDur");
}

// --- flowDur / breatheDur bounds across a spread of rates ---
{
  for (const rate of [0, 0.1, 1, 40, 120, 1e6]) {
    const p = deriveVisualParams(
      blankInput({ outputs: outs({ ore: rate, steel: rate, components: rate, research: rate }) }),
    );
    inRange(p.flowDur.mining, VISUAL.flowMin, VISUAL.flowMax, `flow mining @${rate}`);
    inRange(p.breatheDur, VISUAL.breatheMin, VISUAL.breatheMax, `breathe @${rate}`);
  }
}

// --- strain gating on analyticsUnlocked ---
{
  const straind = deriveVisualParams(
    blankInput({ bottleneck: true, analyticsUnlocked: true }),
  );
  eq(straind.strained.toString(), "true", "strain: shown when analytics unlocked");
  const gated = deriveVisualParams(
    blankInput({ bottleneck: true, analyticsUnlocked: false }),
  );
  eq(gated.strained.toString(), "false", "strain: hidden before analytics");
}

// --- dotCount monotonic in building count, capped at dotPool ---
{
  let prev = -1;
  let monotonic = true;
  for (const n of [0, 1, 5, 12, 24, 100, 1e6]) {
    const p = deriveVisualParams(
      blankInput({ buildings: bld({ miningDrone: n }) }),
    );
    if (p.dotCount < prev || p.dotCount > VISUAL.dotPool) monotonic = false;
    prev = p.dotCount;
  }
  ok(monotonic, "dots: monotonic non-decreasing and <= dotPool");
  eq(
    deriveVisualParams(
      blankInput({ buildings: bld({ miningDrone: VISUAL.buildingDotScale }) }),
    ).dotCount.toString(),
    VISUAL.dotPool.toString(),
    "dots: full pool at buildingDotScale",
  );
}

// --- hasIndustry / hasRing triggers ---
{
  const f = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: 1, furnace: 1 }) }));
  eq(f.hasIndustry.toString(), "true", "industry: furnace triggers it");
  const r = deriveVisualParams(blankInput({ buildings: bld({ laboratory: 25 }) }));
  eq(r.hasRing.toString(), "true", "ring: laboratory at threshold triggers it");
  const r2 = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: 24 }) }));
  eq(r2.hasRing.toString(), "false", "ring: below threshold stays off");
}

// --- per-building nodes: presence, bounds and count-driven growth ---
{
  const blank = deriveVisualParams(blankInput());
  eq(blank.nodes.length.toString(), "7", "nodes: one per building type");
  eq(blank.nodes.map((n) => n.id).join(","), "miningDrone,solarArray,copperMine,furnace,factory,assembler,laboratory", "nodes: follow BUILDING_ORDER");
  ok(
    blank.nodes.every((n) => !n.visible && n.owned === 0 && n.glow === 0),
    "nodes: none visible on a blank game",
  );
  eq(blank.totalBuildings.toString(), "0", "nodes: blank total is 0");
  eq(blank.convoy.toString(), "0", "convoy: none on a blank game");

  // Bounds hold for every node across a wide spread of counts.
  const spread = deriveVisualParams(
    blankInput({
      buildings: bld({
        miningDrone: 1,
        solarArray: 9,
        copperMine: 10,
        furnace: 24,
        factory: 25,
        assembler: 1e6,
        laboratory: 3,
      }),
    }),
  );
  for (const n of spread.nodes) {
    inRange(n.height, VISUAL.towerMinH, VISUAL.towerMaxH, `node ${n.id}: height`);
    inRange(n.glow, 0, 1, `node ${n.id}: glow`);
    inRange(n.pulseDur, VISUAL.nodePulseMin, VISUAL.nodePulseMax, `node ${n.id}: pulseDur`);
    inRange(n.towers, 1, VISUAL.towerPool, `node ${n.id}: towers`);
    ok(n.visible === n.owned > 0, `node ${n.id}: visibility follows owned`);
    ok(Number.isFinite(n.fill), `node ${n.id}: fill finite`);
  }
  eq(
    spread.nodes.find((n) => n.id === "assembler")!.height.toString(),
    VISUAL.towerMaxH.toString(),
    "nodes: huge count saturates the tower height",
  );

  // Tower count tracks the milestone tiers (10 / 25 / 50 / 100).
  const tiers = [
    [0, 1],
    [1, 1],
    [9, 1],
    [10, 2],
    [25, 3],
    [50, 4],
    [100, 5],
    [1e6, 5],
  ] as const;
  for (const [count, want] of tiers) {
    const p = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: count }) }));
    eq(
      p.nodes.find((n) => n.id === "miningDrone")!.towers.toString(),
      String(want),
      `nodes: ${count} drones -> ${want} tower(s)`,
    );
  }
}

// --- node height / glow are monotonic in the owned count ---
{
  let prev = -1;
  let mono = true;
  for (const n of [0, 1, 2, 5, 12, 24, 40, 100, 1e6]) {
    const p = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: n }) }));
    const h = p.nodes.find((x) => x.id === "miningDrone")!.height;
    if (h < prev) mono = false;
    prev = h;
  }
  ok(mono, "nodes: tower height is monotonic non-decreasing");
}

// --- convoy scales with the TOTAL building count ---
{
  let prev = -1;
  let mono = true;
  let inRangeOk = true;
  for (const n of [0, 1, 5, 20, 40, 100, 1e6]) {
    const p = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: n }) }));
    if (p.convoy < prev || p.convoy > VISUAL.convoyPool) {
      mono = false;
      inRangeOk = false;
    }
    prev = p.convoy;
  }
  ok(mono && inRangeOk, "convoy: monotonic and within [0, convoyPool]");
  eq(
    deriveVisualParams(blankInput({ buildings: bld({ miningDrone: VISUAL.convoyScale }) }))
      .convoy.toString(),
    VISUAL.convoyPool.toString(),
    "convoy: full pool at convoyScale",
  );
  // Convoy speed is bounded and speeds up with activity.
  const idle = deriveVisualParams(blankInput({ buildings: bld({ miningDrone: 1 }) }));
  const busy = deriveVisualParams(
    blankInput({
      buildings: bld({ miningDrone: 1e6 }),
      outputs: outs({ ore: 1e6 }),
    }),
  );
  inRange(idle.convoyDur, VISUAL.convoyDurMin, VISUAL.convoyDurMax, "convoy: idle duration bounded");
  ok(busy.convoyDur <= idle.convoyDur, "convoy: busy runs at least as fast as idle");
}

// --- power brownout drives the amber warning (not gated by analytics) ---
{
  const brown = deriveVisualParams(blankInput({ powerFactor: 0.5, analyticsUnlocked: false }));
  eq(brown.strained.toString(), "true", "power: deficit strains the scene without analytics");
  const ok = deriveVisualParams(blankInput({ powerFactor: 1 }));
  eq(ok.strained.toString(), "false", "power: fully supplied is not strained");
}

// --- settings: animation level round-trip (restores defaults afterwards) ---
{
  const fmtBefore = getNumberFormat();
  const animBefore = getAnimationLevel();

  setAnimationLevel("subtle");
  eq(getAnimationLevel(), "subtle", "settings: animation level set/get");
  setAnimationLevel("nonsense" as never);
  eq(getAnimationLevel(), "subtle", "settings: invalid level ignored");
  setAnimationLevel("off");
  eq(getAnimationLevel(), "off", "settings: switch to off");
  setAnimationLevel("rich");
  eq(getAnimationLevel(), "rich", "settings: switch back to rich");

  // Number format still works alongside the new field.
  setNumberFormat("scientific");
  eq(getNumberFormat(), "scientific", "settings: number format unaffected");

  // Restore baseline for other consumers.
  setNumberFormat(fmtBefore);
  setAnimationLevel(animBefore);
}

console.log(`\nVisual tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} visual test(s) failed`);
}
