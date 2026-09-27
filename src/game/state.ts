import { SAVE_VERSION } from "./balance";
import type { GameState } from "./types";
import { applyTechUnlocks } from "./research";
import { emptyAchievementMap } from "./achievements";
import { emptyRegionMap } from "./planets";

// A fresh, empty run (used at new game and after each prestige). Keeps only
// the fields that should NOT be wiped by a prestige.
export function freshRunState(): Omit<
  GameState,
  | "version"
  | "coreData"
  | "lifetimeCoreData"
  | "prestigeGranted"
  | "permanentUpgrades"
  | "achievements"
  | "stats"
  | "timestamp"
  | "lastTick"
  // nextPlanet persists across prestiges, so it must NOT be reset here.
  | "nextPlanet"
> {
  return {
    planet: "homeworld",
    regions: emptyRegionMap(),
    resources: {
      ore: 0,
      steel: 0,
      components: 0,
      credits: 0,
      research: 0,
    },
    buildings: {
      miningDrone: 0,
      solarArray: 0,
      furnace: 0,
      factory: 0,
      laboratory: 0,
    },
    techs: {
      highPressureDrill: 0,
      advancedAlloys: 0,
      precisionMfg: 0,
      massProduction: 0,
      overclockedDrills: 0,
      automatedSmelting: 0,
      automatedAssembly: 0,
      gridOptimization: 0,
      automatedTrading: 0,
      autoBuyLogic: 0,
      smartLogistics: 0,
      researchMethodology: 0,
      productionAnalytics: 0,
      efficientLabs: 0,
      quantumComputing: 0,
      coreSynthesis: 0,
      automatedResearch: 0,
    },
    autoSell: {
      ore: false,
      steel: false,
      components: false,
    },
    autoBuy: {
      miningDrone: false,
      solarArray: false,
      furnace: false,
      factory: false,
      laboratory: false,
    },
    autoResearch: false,
    flags: {
      autoSellUnlocked: false,
      autoBuyUnlocked: false,
      analyticsUnlocked: false,
      autoResearchUnlocked: false,
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
      furnaceCap: 0,
      factoryCap: 0,
      furnaceInput: 0,
      factoryInput: 0,
      furnaceYield: 1,
      factoryYield: 1,
      powerSupply: 0,
      powerDemand: 0,
      powerFactor: 1,
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
    prestigeGranted: 0,
    nextPlanet: "homeworld",
    achievements: emptyAchievementMap(),
    permanentUpgrades: {
      fasterBoot: 0,
      industrialMemory: 0,
      automatedLogistics: 0,
      researchArchive: 0,
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

  // Faster Boot: start each run with 2 mining drones per level.
  const fb = state.permanentUpgrades.fasterBoot || 0;
  if (fb > 0) {
    state.buildings.miningDrone = 2 * fb;
  }

  applyTechUnlocks(state);
  return state;
}
