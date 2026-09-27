// Visual mapping tests (normalisation + deriveVisualParams + settings round-trip).
// Run with: npm test
import {
  VISUAL,
  norm,
  logNorm,
  deriveVisualParams,
  type VisualInput,
} from "../src/ui/visual";
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

// A blank-slate game: nothing built, nothing produced.
function blankInput(over: Partial<VisualInput> = {}): VisualInput {
  return {
    oreProd: 0,
    steelProd: 0,
    compProd: 0,
    researchProd: 0,
    creditsRate: 0,
    oreShortage: false,
    steelShortage: false,
    oreAccumulating: false,
    steelAccumulating: false,
    buildings: { miningDrone: 0, furnace: 0, factory: 0, laboratory: 0 },
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
      oreProd: 1e18,
      steelProd: 1e18,
      compProd: 1e18,
      researchProd: 1e18,
      creditsRate: 1e18,
      buildings: { miningDrone: 1e6, furnace: 1e6, factory: 1e6, laboratory: 1e6 },
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
  for (const k of ["mining", "smelting", "manufacturing", "research"] as const) {
    inRange(huge.flowDur[k], VISUAL.flowMin, VISUAL.flowMax, `huge: flowDur.${k}`);
  }
  inRange(huge.dotCount, 0, VISUAL.dotPool, "huge: dotCount");
  eq(huge.hasRing.toString(), "true", "huge: ring unlocked");
  eq(huge.hasIndustry.toString(), "true", "huge: industry present");
}

// --- flowDur / breatheDur bounds across a spread of rates ---
{
  for (const rate of [0, 0.1, 1, 40, 120, 1e6]) {
    const p = deriveVisualParams(
      blankInput({ oreProd: rate, steelProd: rate, compProd: rate, researchProd: rate }),
    );
    inRange(p.flowDur.mining, VISUAL.flowMin, VISUAL.flowMax, `flow mining @${rate}`);
    inRange(p.breatheDur, VISUAL.breatheMin, VISUAL.breatheMax, `breathe @${rate}`);
  }
}

// --- strain gating on analyticsUnlocked ---
{
  const straind = deriveVisualParams(
    blankInput({ oreShortage: true, analyticsUnlocked: true }),
  );
  eq(straind.strained.toString(), "true", "strain: shown when analytics unlocked");
  const gated = deriveVisualParams(
    blankInput({ oreShortage: true, analyticsUnlocked: false }),
  );
  eq(gated.strained.toString(), "false", "strain: hidden before analytics");
}

// --- dotCount monotonic in building count, capped at dotPool ---
{
  let prev = -1;
  let monotonic = true;
  for (const n of [0, 1, 5, 12, 24, 100, 1e6]) {
    const p = deriveVisualParams(
      blankInput({ buildings: { miningDrone: n, furnace: 0, factory: 0, laboratory: 0 } }),
    );
    if (p.dotCount < prev || p.dotCount > VISUAL.dotPool) monotonic = false;
    prev = p.dotCount;
  }
  ok(monotonic, "dots: monotonic non-decreasing and <= dotPool");
  eq(
    deriveVisualParams(
      blankInput({ buildings: { miningDrone: VISUAL.buildingDotScale, furnace: 0, factory: 0, laboratory: 0 } }),
    ).dotCount.toString(),
    VISUAL.dotPool.toString(),
    "dots: full pool at buildingDotScale",
  );
}

// --- hasIndustry / hasRing triggers ---
{
  const f = deriveVisualParams(blankInput({ buildings: { miningDrone: 1, furnace: 1, factory: 0, laboratory: 0 } }));
  eq(f.hasIndustry.toString(), "true", "industry: furnace triggers it");
  const r = deriveVisualParams(blankInput({ buildings: { miningDrone: 0, furnace: 0, factory: 0, laboratory: 25 } }));
  eq(r.hasRing.toString(), "true", "ring: laboratory at threshold triggers it");
  const r2 = deriveVisualParams(blankInput({ buildings: { miningDrone: 24, furnace: 0, factory: 0, laboratory: 0 } }));
  eq(r2.hasRing.toString(), "false", "ring: below threshold stays off");
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
