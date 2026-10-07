// Deterministic PRNG (mulberry32). Advances `state.rngSeed` in place, so the
// same save always replays the same event/contract stream — which keeps tests
// reproducible and stops save-scumming from rerolling an unlucky event.
//
// Deliberately typed against the minimal shape it needs so this module has no
// dependencies (and therefore cannot create an import cycle).
export interface RngCarrier {
  rngSeed: number;
}

// Uniform float in [0, 1).
export function nextRandom(state: RngCarrier): number {
  let t = (state.rngSeed = (state.rngSeed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Uniform float in [min, max).
export function randomRange(state: RngCarrier, min: number, max: number): number {
  return min + nextRandom(state) * (max - min);
}

// Pick an index in [0, length) with a uniform roll.
export function randomIndex(state: RngCarrier, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.floor(nextRandom(state) * length));
}
