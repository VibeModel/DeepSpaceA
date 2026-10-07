// Contracts — manual delivery orders. Unlike events these advance on ONLINE
// wall-clock time only (the caller passes a real-time dt, never the scaled
// simulation dt), so an offline player never returns to a failed contract.
//
// Run-scoped: a prestige wipes offers and active orders, so an order always
// reflects the production capacity of the run it was generated in.
import {
  SELLABLE_RESOURCES,
  SELL_PRICES,
  CONTRACT_SPAWN_SEC,
  CONTRACT_DURATION_SEC,
  CONTRACT_OFFER_WINDOW_SEC,
  CONTRACT_REWARD_MULT,
  CONTRACT_AMOUNT_FRACTION,
  CONTRACT_MIN_AMOUNT,
} from "./balance";
import { randomRange, randomIndex } from "./rng";
import { stellarModifiers } from "./stellar";
import { capNumber } from "./num";
import type { Contract, GameState } from "./types";

export function contractsUnlocked(state: GameState): boolean {
  return state.stats.prestigeCount >= 1 || state.ascensionCount >= 1;
}

// How many offers and active orders are allowed at once (raised by the
// "Contracts" chart upgrade).
export function contractSlots(state: GameState): number {
  return Math.max(1, Math.floor(stellarModifiers(state).contractSlots));
}

// Build one offer from the run's current production. Only resources the run
// actually produces are ever offered, and the amount is scaled to what can be
// made during the deadline window so every offer is achievable.
export function makeContractOffer(state: GameState): Contract | null {
  const candidates = SELLABLE_RESOURCES.filter(
    (res) => (state.rates.production[res] ?? 0) > 0,
  );
  if (candidates.length === 0) return null;

  const resource = candidates[randomIndex(state, candidates.length)];
  const rate = state.rates.production[resource] ?? 0;
  const amount = Math.max(
    CONTRACT_MIN_AMOUNT,
    Math.ceil(rate * CONTRACT_DURATION_SEC * CONTRACT_AMOUNT_FRACTION),
  );
  const reward = capNumber(
    amount * SELL_PRICES[resource] * CONTRACT_REWARD_MULT * randomRange(state, 0.9, 1.2),
  );
  const window = CONTRACT_OFFER_WINDOW_SEC * randomRange(state, 0.85, 1.15);
  return {
    id: state.nextContractId++,
    resource,
    amount,
    reward,
    remaining: window,
    total: window,
  };
}

// Advance offer windows and delivery deadlines by `dtSec` of ONLINE time, and
// generate a new offer when the spawn timer elapses.
export function tickContracts(state: GameState, dtSec: number): void {
  if (dtSec <= 0) return;
  if (!contractsUnlocked(state)) {
    if (state.contractOffers.length > 0) state.contractOffers = [];
    if (state.activeContracts.length > 0) state.activeContracts = [];
    return;
  }

  const expire = (list: Contract[]): Contract[] => {
    if (list.length === 0) return list;
    const kept: Contract[] = [];
    for (const c of list) {
      c.remaining -= dtSec;
      if (c.remaining > 0) kept.push(c);
    }
    return kept;
  };
  state.contractOffers = expire(state.contractOffers);
  state.activeContracts = expire(state.activeContracts);

  state.contractSpawnIn -= dtSec;
  if (state.contractSpawnIn <= 0) {
    state.contractSpawnIn = CONTRACT_SPAWN_SEC;
    if (state.contractOffers.length < contractSlots(state)) {
      const offer = makeContractOffer(state);
      if (offer) state.contractOffers.push(offer);
    }
  }
}

export function canAcceptContract(state: GameState, id: number): boolean {
  if (!state.contractOffers.some((c) => c.id === id)) return false;
  return state.activeContracts.length < contractSlots(state);
}

export function acceptContract(state: GameState, id: number): boolean {
  if (!canAcceptContract(state, id)) return false;
  const idx = state.contractOffers.findIndex((c) => c.id === id);
  const [offer] = state.contractOffers.splice(idx, 1);
  state.activeContracts.push({
    ...offer,
    remaining: CONTRACT_DURATION_SEC,
    total: CONTRACT_DURATION_SEC,
  });
  return true;
}

export function canDeliverContract(state: GameState, id: number): boolean {
  const c = state.activeContracts.find((x) => x.id === id);
  if (!c) return false;
  return (state.resources[c.resource] ?? 0) >= c.amount;
}

// Hand in the goods: consume the resource and pay the reward.
export function deliverContract(state: GameState, id: number): boolean {
  if (!canDeliverContract(state, id)) return false;
  const idx = state.activeContracts.findIndex((x) => x.id === id);
  const c = state.activeContracts[idx];
  state.resources[c.resource] = capNumber(state.resources[c.resource] - c.amount);
  state.resources.credits = capNumber(state.resources.credits + c.reward);
  state.stats.lifetimeCredits = capNumber(state.stats.lifetimeCredits + c.reward);
  state.activeContracts.splice(idx, 1);
  return true;
}

// Remaining fraction (0..1) of a contract timer, for the UI progress bar.
export function contractProgress(remaining: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, remaining / total));
}
