// UI preferences (display formatting + animation intensity). Persisted
// separately from the game save so that resetting the game / prestige does NOT
// clear display preferences.

export type NumberFormat = "suffix" | "scientific" | "engineering";
export type AnimationLevel = "rich" | "subtle" | "off";

const STORAGE_KEY = "deepspace_ui_settings";

const VALID_FORMATS: NumberFormat[] = ["suffix", "scientific", "engineering"];
const VALID_ANIM: AnimationLevel[] = ["rich", "subtle", "off"];

let current: NumberFormat = "suffix";
// Default "rich" — the lively-but-tasteful intensity.
let anim: AnimationLevel = "rich";

function isNumberFormat(v: unknown): v is NumberFormat {
  return typeof v === "string" && (VALID_FORMATS as string[]).includes(v);
}

function isAnimationLevel(v: unknown): v is AnimationLevel {
  return typeof v === "string" && (VALID_ANIM as string[]).includes(v);
}

export function getNumberFormat(): NumberFormat {
  return current;
}

export function setNumberFormat(fmt: NumberFormat): void {
  if (!isNumberFormat(fmt)) return;
  current = fmt;
  saveUiSettings();
}

export function getAnimationLevel(): AnimationLevel {
  return anim;
}

export function setAnimationLevel(level: AnimationLevel): void {
  if (!isAnimationLevel(level)) return;
  anim = level;
  saveUiSettings();
}

export function saveUiSettings(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ numberFormat: current, animationLevel: anim }),
    );
  } catch {
    /* no localStorage (Node / private mode) — ignore */
  }
}

// Load persisted UI settings into module state. Safe to call in Node (no-op).
// Missing / invalid fields fall back to defaults, so old saves stay compatible.
export function loadUiSettings(): {
  numberFormat: NumberFormat;
  animationLevel: AnimationLevel;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { numberFormat?: unknown; animationLevel?: unknown };
      if (isNumberFormat(parsed.numberFormat)) current = parsed.numberFormat;
      if (isAnimationLevel(parsed.animationLevel)) anim = parsed.animationLevel;
    }
  } catch {
    /* ignore */
  }
  return { numberFormat: current, animationLevel: anim };
}
