// Contract tests: gating, offer generation, slot caps, accept/deliver flow,
// expiry, chart-upgrade slots and persistence. Contracts advance on ONLINE
// time, so every test drives them with an explicit dt.
// Run with: npm test
import { createNewGame } from "../src/game/state";
import {
  contractsUnlocked,
  contractSlots,
  makeContractOffer,
  tickContracts,
  canAcceptContract,
  acceptContract,
  canDeliverContract,
  deliverContract,
  contractProgress,
} from "../src/game/contracts";
import { doPrestige } from "../src/game/prestige";
import { exportSave, importSave } from "../src/game/save";
import {
  CONTRACT_MAX_ACTIVE,
  CONTRACT_SPAWN_SEC,
  CONTRACT_DURATION_SEC,
  CONTRACT_MIN_AMOUNT,
  CONTRACT_REWARD_MULT,
  SELL_PRICES,
} from "../src/game/balance";
import type { GameState } from "../src/game/types";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

// A state that has seen a prestige (the contract gate) and produces ore.
function producing(rate = 5): GameState {
  const s = createNewGame();
  s.stats.prestigeCount = 1;
  s.rates.production.ore = rate;
  return s;
}

// --- 1. Slot cap defaults ---
{
  const s = createNewGame();
  ok(contractSlots(s) === CONTRACT_MAX_ACTIVE, "base slots = CONTRACT_MAX_ACTIVE");
}

// --- 2. Locked before the first prestige ---
{
  const s = createNewGame();
  s.rates.production.ore = 5;
  ok(!contractsUnlocked(s), "fresh game: contracts locked");
  tickContracts(s, CONTRACT_SPAWN_SEC * 5);
  ok(s.contractOffers.length === 0, "fresh game: tickContracts never spawns");
}

// --- 3. No production → no offer ---
{
  const s = createNewGame();
  s.stats.prestigeCount = 1;
  ok(makeContractOffer(s) === null, "no production: no offer");
}

// --- 4. Offer shape is derived from production ---
{
  const s = producing(5);
  const offer = makeContractOffer(s);
  ok(offer !== null, "an offer is generated when production exists");
  ok(offer!.resource === "ore", "only the produced resource is offered");
  ok(offer!.amount >= CONTRACT_MIN_AMOUNT, "amount respects the minimum");
  ok(
    offer!.amount === Math.max(CONTRACT_MIN_AMOUNT, Math.ceil(5 * CONTRACT_DURATION_SEC * 0.4)),
    "amount scales with production rate",
  );
  const base = offer!.amount * SELL_PRICES.ore * CONTRACT_REWARD_MULT;
  ok(
    offer!.reward >= base * 0.9 - 1e-6 && offer!.reward <= base * 1.2 + 1e-6,
    "reward = goods value × multiplier (with jitter)",
  );
  ok(offer!.remaining > 0 && offer!.remaining === offer!.total, "offer starts on its full window");
  ok(offer!.id === 1, "offer ids start at 1 and increment");
}

// --- 5. Spawning via the timer respects the gate ---
{
  const s = producing();
  tickContracts(s, CONTRACT_SPAWN_SEC);
  ok(s.contractOffers.length === 1, "one offer spawns at the spawn interval");
}

// --- 6. Offers never exceed the slot cap ---
{
  const s = producing();
  for (let i = 0; i < 6; i++) {
    s.contractSpawnIn = 0;
    tickContracts(s, 0.001);
  }
  ok(
    s.contractOffers.length === contractSlots(s),
    "offers are capped at the slot count",
  );
}

// --- 7. Accept moves an offer into Active with a full deadline ---
{
  const s = producing();
  const offer = makeContractOffer(s)!;
  s.contractOffers.push(offer);
  ok(canAcceptContract(s, offer.id), "an offer can be accepted when slots are free");
  ok(acceptContract(s, offer.id), "accept succeeds");
  ok(s.contractOffers.length === 0, "accepted offer leaves the offer list");
  ok(s.activeContracts.length === 1, "accepted order is now active");
  ok(near(s.activeContracts[0].remaining, CONTRACT_DURATION_SEC), "deadline is the full duration");
  ok(!acceptContract(s, offer.id), "the same id cannot be accepted twice");
}

// --- 8. Active orders are capped at the slot count ---
{
  const s = producing();
  const slots = contractSlots(s);
  for (let i = 0; i < slots + 3; i++) {
    const offer = makeContractOffer(s)!;
    s.contractOffers.push(offer);
  }
  for (const c of [...s.contractOffers]) acceptContract(s, c.id);
  ok(s.activeContracts.length === slots, "active orders are capped at the slot count");
  const leftover = s.contractOffers[0];
  ok(
    leftover === undefined || !canAcceptContract(s, leftover.id),
    "further accepts are refused when full",
  );
}

// --- 9. Deliver consumes goods and pays credits ---
{
  const s = producing();
  const offer = makeContractOffer(s)!;
  s.contractOffers.push(offer);
  acceptContract(s, offer.id);
  const order = s.activeContracts[0];

  ok(!canDeliverContract(s, order.id), "cannot deliver without the goods");
  s.resources[order.resource] = order.amount;
  ok(canDeliverContract(s, order.id), "can deliver once stocked");

  const creditsBefore = s.resources.credits;
  const lifetimeBefore = s.stats.lifetimeCredits;
  ok(deliverContract(s, order.id), "deliver succeeds");
  ok(near(s.resources[order.resource], 0), "deliver consumes the goods");
  ok(near(s.resources.credits, creditsBefore + order.reward), "deliver pays the reward");
  ok(
    near(s.stats.lifetimeCredits, lifetimeBefore + order.reward),
    "deliver counts toward lifetime credits",
  );
  ok(s.activeContracts.length === 0, "delivered order is removed");
}

// --- 10. Offers and orders expire when their timers run out ---
{
  const s = producing();
  // Park the auto-spawn timer so only expiry is exercised here.
  s.contractSpawnIn = Number.MAX_SAFE_INTEGER;
  const offer = makeContractOffer(s)!;
  s.contractOffers.push(offer);
  tickContracts(s, offer.total / 2);
  ok(s.contractOffers.length === 1, "offer survives halfway");
  ok(near(contractProgress(s.contractOffers[0].remaining, offer.total), 0.5, 1e-3), "offer progress is 50%");
  tickContracts(s, offer.total);
  ok(s.contractOffers.length === 0, "offer expires after its window");

  const off2 = makeContractOffer(s)!;
  s.contractOffers.push(off2);
  acceptContract(s, off2.id);
  tickContracts(s, CONTRACT_DURATION_SEC + 1);
  ok(s.activeContracts.length === 0, "active order expires after its deadline");
}

// --- 11. The Contracts chart raises the slot count ---
{
  const s = producing();
  s.stellarUpgrades.chartContracts = 3;
  ok(contractSlots(s) === CONTRACT_MAX_ACTIVE + 3, "chartContracts adds slots");
}

// --- 12. Save round-trip preserves offers and active orders ---
{
  const s = producing();
  const offer = makeContractOffer(s)!;
  s.contractOffers.push(offer);
  const off2 = makeContractOffer(s)!;
  s.contractOffers.push(off2);
  acceptContract(s, off2.id);

  const back = importSave(exportSave(s));
  ok(back !== null, "save: round trip");
  ok(back!.contractOffers.length === 1, "save: offer preserved");
  ok(back!.activeContracts.length === 1, "save: active order preserved");
  ok(back!.activeContracts[0].id === off2.id, "save: active order id preserved");
  ok(back!.activeContracts[0].resource === off2.resource, "save: resource preserved");
  ok(near(back!.activeContracts[0].amount, off2.amount), "save: amount preserved");
  ok(back!.nextContractId === s.nextContractId, "save: id counter preserved");
}

// --- 13. A prestige wipes contracts (they are run-scoped) ---
{
  const s = producing();
  const offer = makeContractOffer(s)!;
  s.contractOffers.push(offer);
  const off2 = makeContractOffer(s)!;
  s.contractOffers.push(off2);
  acceptContract(s, off2.id);
  ok(s.contractOffers.length === 1 && s.activeContracts.length === 1, "contracts exist before prestige");

  s.runPeakCreditsPerSec = 500;
  doPrestige(s);
  ok(s.contractOffers.length === 0, "prestige clears offers");
  ok(s.activeContracts.length === 0, "prestige clears active orders");
  ok(s.nextContractId === 1, "prestige resets the id counter");
}

console.log(`\nContract tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) throw new Error(`${failed} contract test(s) failed`);
