import { SAVE_VERSION } from "./balance";
import type { GameState } from "./types";
import { applyTechUnlocks } from "./research";

// A fresh, empty run (used at new game and after each prestige). Keeps only
// the fields that should NOT be wiped by a prestige.
export function freshRunState(): Omit<
  GameState,
  | "version"
  | "coreData"
  | "lifetimeCoreData"
  | "permanentUpgrades"
  | "stats"
  | "timestamp"
  | "lastTick"
> {
  return {
    resources: {
      ore: 0,
      steel: 0,
      components: 0,
      credits: 0,
      research: 0,
    },
    buildings: {
      miningDrone: 0,
      furnace: 0,
      factory: 0,
      laboratory: 0,
    },
    techs: {
      highPressureDrill: false,
      advancedAlloys: false,
      precisionMfg: false,
      massProduction: false,
      overclockedDrills: false,
      automatedSmelting: false,
      automatedAssembly: false,
      automatedTrading: false,
      autoBuyLogic: false,
      smartLogistics: false,
      researchMethodology: false,
      productionAnalytics: false,
      efficientLabs: false,
      quantumComputing: false,
      coreSynthesis: false,
    },
    autoSell: {
      ore: false,
      steel: false,
      components: false,
    },
    autoBuy: {
      miningDrone: false,
      furnace: false,
      factory: false,
      laboratory: false,
    },
    flags: {
      autoSellUnlocked: false,
      autoBuyUnlocked: false,
      analyticsUnlocked: false,
    },
    rates: {
      ore: 0,
      steel: 0,
      components: 0,
      research: 0,
      credits: 0,
      oreProd: 0,
      steelProd: 0,
      compProd: 0,
      researchProd: 0,
      furnaceUtil: 0,
      factoryUtil: 0,
      labActive: false,
      oreShortage: false,
      oreAccumulating: false,
      steelShortage: false,
      steelAccumulating: false,
    },
  };
}

// Build a brand new game state (first ever play). Applies starting permanent
// upgrades such as "Faster Boot".
export function createNewGame(): GameState {
  const now = Date.now();
  const state: GameState = {
    version: SAVE_VERSION,
    timestamp: now,
    lastTick: now,
    coreData: 0,
    lifetimeCoreData: 0,
    permanentUpgrades: {
      fasterBoot: false,
      industrialMemory: false,
      automatedLogistics: false,
      researchArchive: false,
    },
    stats: {
      currentRunStart: now,
      lifetimePlayTime: 0,
      totalOre: 0,
      totalSteel: 0,
      totalComponents: 0,
      lifetimeCredits: 0,
      buildingsPurchased: 0,
      prestigeCount: 0,
      bestCreditsPerSec: 0,
    },
    ...freshRunState(),
  };

  // Faster Boot: start each run with 2 mining drones.
  if (state.permanentUpgrades.fasterBoot) {
    state.buildings.miningDrone = 2;
  }

  applyTechUnlocks(state);
  return state;
}
