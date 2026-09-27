// Number-format tests (suffix / scientific / engineering). Run with: npm test
import { formatNumber } from "../src/ui/format";
import { setNumberFormat } from "../src/ui/settings";

let passed = 0;
let failed = 0;

function eq(got: string, want: string, msg: string): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg} — got "${got}", want "${want}"`);
  }
}

// --- suffix (default) ---
setNumberFormat("suffix");
eq(formatNumber(0), "0", "suffix: 0");
eq(formatNumber(42), "42", "suffix: small integer");
eq(formatNumber(3.5), "3.5", "suffix: small fraction");
eq(formatNumber(1234), "1.23K", "suffix: thousands");
eq(formatNumber(1234567), "1.23M", "suffix: millions");
eq(formatNumber(2500), "2.50K", "suffix: two decimals under 10");
eq(formatNumber(-2500), "-2.50K", "suffix: negative");
eq(formatNumber(1e40), "1.00e40", "suffix: beyond suffix table -> scientific");
eq(formatNumber(Infinity), "0", "suffix: non-finite -> 0");
eq(formatNumber(NaN), "0", "suffix: NaN -> 0");

// --- scientific ---
setNumberFormat("scientific");
eq(formatNumber(999), "999", "sci: <1000 stays plain");
eq(formatNumber(1234), "1.23e3", "sci: thousands");
eq(formatNumber(1234567), "1.23e6", "sci: millions");
eq(formatNumber(3.3e211), "3.30e211", "sci: huge number");
eq(formatNumber(-1234), "-1.23e3", "sci: negative");

// --- engineering ---
setNumberFormat("engineering");
eq(formatNumber(1234), "1.23e3", "eng: thousands");
eq(formatNumber(12500), "12.5e3", "eng: 12.5e3");
eq(formatNumber(1234567), "1.23e6", "eng: millions");
eq(formatNumber(3.3e211), "33.0e210", "eng: huge number, exp multiple of 3");
eq(formatNumber(999), "999", "eng: <1000 stays plain");

// Restore the default so other consumers/tests see the baseline.
setNumberFormat("suffix");

console.log(`\nFormat tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  throw new Error(`${failed} format test(s) failed`);
}
