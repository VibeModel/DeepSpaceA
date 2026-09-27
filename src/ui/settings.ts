// UI preferences (display formatting). Persisted separately from the game save
// so that resetting the game / prestige does NOT clear display preferences.

export type NumberFormat = "suffix" | "scientific" | "engineering";

const STORAGE_KEY = "deepspace_ui_settings";

const VALID_FORMATS: NumberFormat[] = ["suffix", "scientific", "engineering"];

let current: NumberFormat = "suffix";

function isNumberFormat(v: unknown): v is NumberFormat {
  return typeof v === "string" && (VALID_FORMATS as string[]).includes(v);
}

export function getNumberFormat(): NumberFormat {
  return current;
}

export function setNumberFormat(fmt: NumberFormat): void {
  if (!isNumberFormat(fmt)) return;
  current = fmt;
  saveUiSettings();
}

export function saveUiSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ numberFormat: current }));
  } catch {
    /* no localStorage (Node / private mode) — ignore */
  }
}

// Load persisted UI settings into module state. Safe to call in Node (no-op).
export function loadUiSettings(): { numberFormat: NumberFormat } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { numberFormat?: unknown };
      if (isNumberFormat(parsed.numberFormat)) current = parsed.numberFormat;
    }
  } catch {
    /* ignore */
  }
  return { numberFormat: current };
}
