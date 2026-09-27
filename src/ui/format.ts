// Unified number / time formatting for the whole UI.

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

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 0) return "-" + formatNumber(-value);
  if (value === 0) return "0";

  if (value < 1000) {
    // Small numbers: show up to 1 decimal for fractional, none for whole.
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  }

  const exponent = Math.floor(Math.log10(value));
  // Beyond our suffix table, fall back to scientific notation.
  if (exponent >= SUFFIXES.length * 3) {
    return value.toExponential(2).replace("e+", "e");
  }

  const tier = Math.floor(exponent / 3);
  const scaled = value / Math.pow(10, tier * 3);
  const suffix = SUFFIXES[tier];
  // 1–2 significant decimals depending on magnitude.
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return scaled.toFixed(decimals) + suffix;
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
