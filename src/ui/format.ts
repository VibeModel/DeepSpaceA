// Unified number / time formatting for the whole UI.
// The active number format is chosen in Settings and read from settings.ts.
import { getNumberFormat } from "./settings";

const SUFFIXES = [
  "",
  "K",
  "M",
  "B",
  "T",
  "Qa",
  "Qi",
  "Sx",
  "Sp",
  "Oc",
  "No",
  "Dc",
];

// Plain notation for |v| < 1000: integer, or 1 decimal for fractions.
function fmtPlain(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

// Suffix notation: K, M, B ... Dc (one tier per 3 orders of magnitude). Falls
// back to scientific notation beyond the suffix table.
function fmtSuffix(value: number): string {
  const exponent = Math.floor(Math.log10(value));
  if (exponent >= SUFFIXES.length * 3) {
    return value.toExponential(2).replace("e+", "e");
  }
  const tier = Math.floor(exponent / 3);
  const scaled = value / Math.pow(10, tier * 3);
  const suffix = SUFFIXES[tier];
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return scaled.toFixed(decimals) + suffix;
}

// Scientific notation with 3 significant digits, e.g. 3.30e211.
function fmtScientific(value: number): string {
  return value.toExponential(2).replace("e+", "e");
}

// Engineering notation: exponent forced to a multiple of 3, mantissa 1..999,
// e.g. 33.0e210 / 1.23e6.
function fmtEngineering(value: number): string {
  const exponent = Math.floor(Math.log10(value));
  const e3 = Math.floor(exponent / 3) * 3;
  const mantissa = value / Math.pow(10, e3);
  const decimals = mantissa < 10 ? 2 : mantissa < 100 ? 1 : 0;
  return mantissa.toFixed(decimals) + "e" + e3;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 0) return "-" + formatNumber(-value);
  if (value === 0) return "0";

  // Small magnitudes always use plain notation across all formats.
  if (value < 1000) return fmtPlain(value);

  switch (getNumberFormat()) {
    case "scientific":
      return fmtScientific(value);
    case "engineering":
      return fmtEngineering(value);
    default:
      return fmtSuffix(value);
  }
}

export function formatRate(value: number): string {
  return formatNumber(value) + "/s";
}

export function formatPercent(value: number): string {
  return Math.round(value * 100) + "%";
}

// Format a duration in ms as a compact human string, e.g. "2h 17m", "3d 4h".
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (seconds > 0 && days === 0 && hours === 0) parts.push(`${seconds}s`);
  return parts.length ? parts.join(" ") : "0s";
}
