// Number-safety helpers. All game numbers are plain JS doubles (max ~1.8e308);
// these helpers keep values finite and bounded so exponential growth from
// infinite upgrades can never produce Infinity/NaN or silently wipe state.
import { MAX_VALUE } from "./balance";

// Clamp a value into [0, MAX_VALUE].
// Infinity -> MAX_VALUE (cap, never wipe), -Infinity/NaN -> 0, negatives -> 0.
export function capNumber(v: number, cap = MAX_VALUE): number {
  if (Number.isNaN(v)) return 0;
  if (v === Infinity) return cap;
  if (v === -Infinity) return 0;
  if (v < 0) return 0;
  return v > cap ? cap : v;
}

// base^exp clamped to `cap`. Returns `cap` when the result overflows or is
// non-finite, and 0 for NaN inputs, so callers never see Infinity.
export function safePow(base: number, exp: number, cap = MAX_VALUE): number {
  const r = Math.pow(base, exp);
  if (Number.isNaN(r)) return 0;
  if (!Number.isFinite(r) || r > cap) return cap;
  return r;
}
