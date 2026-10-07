import {
  BUILDING_ORDER,
  RESOURCE_IDS,
  SAVE_VERSION,
  SELLABLE_RESOURCES,
  EVENT_SPAWN_SEC,
  CONTRACT_SPAWN_SEC,
} from "./balance";
import type {
  BuildingId,
  GameState,
  ResourceId,
  SellableResource,
  TechId,
} from "./types";
import { applyTechUnlocks, TECH_LIST } from "./research";
import { emptyAchievementMap } from "./achievements";
import { emptyRegionMap } from "./planets";
import { emptyStellarUpgradeMap } from "./stellar";
import { defaultRecipeMix } from "./recipes";
import { emptyRates } from "./simulation";

// A fresh, empty run (used at new game and after each prestige). Keeps only
// the fields that should NOT be wiped by a prestige. Everything is generated
// from the canonical `*_IDS` / `*_LIST` sources so adding a resource, building
// or tech never leaves a hole in the defaults.
export function freshRunState(): Omit<
  GameState,
  | "version"
  | "coreData"
  | "lifetimeCoreData"
  | "blueprints"
  | "permanentUpgrades"
  | "achievements"
  | "stats"
  | "timestamp"
  | "lastTick"
  // nextPlanet persists across prestiges, so it must NOT be reset here.
  | "nextPlanet"
  // Megastructure + second-layer meta (survive both resets).
  | "stargateLevel"
  | "stellarCharts"
  | "lifetimeStellarCharts"
  | "chartsGranted"
  | "stellarUpgrades"
  | "ascensionCount"
  | "rngSeed"
> {
  const resources = {} as Record<ResourceId, number>;
  for (const id of RESOURCE_IDS) resources[id] = 0;

  const buildings = {} as Record<BuildingId, number>;
  for (const id of BUILDING_ORDER) buildings[id] = 0;

  const techs = {} as Record<TechId, number>;
  for (const t of TECH_LIST) techs[t.id] = 0;

  const autoBuy = {} as Record<BuildingId, boolean>;
  for (const id of BUILDING_ORDER) autoBuy[id] = false;

  const autoSell = {} as Record<SellableResource, boolean>;
  for (const id of SELLABLE_RESOURCES) autoSell[id] = false;

  return {
    planet: "homeworld",
    regions: emptyRegionMap(),
    resources,
    buildings,
    techs,
    recipeMix: defaultRecipeMix(),
    runPeakCreditsPerSec: 0,
    // Run-scoped random events + contracts. Both are wiped by a prestige (and
    // an ascension), because they are tied to the current run's production.
    activeEvents: [],
    eventSpawnIn: EVENT_SPAWN_SEC,
    contractOffers: [],
    activeContracts: [],
    contractSpawnIn: CONTRACT_SPAWN_SEC,
    nextContractId: 1,
    autoSell,
    autoBuy,
    autoResearch: false,
    flags: {
      autoSellUnlocked: false,
      autoBuyUnlocked: false,
      analyticsUnlocked: false,
      autoResearchUnlocked: false,
    },
    rates: emptyRates(),
  };
}

// Run-start bonuses granted by permanent upgrades. Shared by createNewGame and
// doPrestige so the two never drift apart.
export function applyRunStartBonuses(state: GameState): void {
  const fb = state.permanentUpgrades.fasterBoot || 0;
  if (fb > 0) {
    state.buildings.miningDrone = Math.max(state.buildings.miningDrone, 2 * fb);
  }
  const ab = state.permanentUpgrades.assemblerBoot || 0;
  if (ab > 0) {
    state.buildings.assembler = Math.max(state.buildings.assembler, ab);
  }
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
    blueprints: 0,
    // Deterministic PRNG seed so a fresh game is reproducible in tests.
    rngSeed: 0x9e3779b9,
    stargateLevel: 0,
    stellarCharts: 0,
    lifetimeStellarCharts: 0,
    chartsGranted: 0,
    stellarUpgrades: emptyStellarUpgradeMap(),
    ascensionCount: 0,
    nextPlanet: "homeworld",
    achievements: emptyAchievementMap(),
    permanentUpgrades: {
      fasterBoot: 0,
      industrialMemory: 0,
      automatedLogistics: 0,
      researchArchive: 0,
      copperExtractor: 0,
      circuitOverclock: 0,
      alloyMastery: 0,
      assemblerBoot: 0,
    },
    stats: {
      currentRunStart: now,
      lifetimePlayTime: 0,
      totalOre: 0,
      totalSteel: 0,
      totalComponents: 0,
      totalCopperOre: 0,
      totalCopper: 0,
      totalCircuit: 0,
      totalAlloy: 0,
      totalBlueprints: 0,
      lifetimeCredits: 0,
      buildingsPurchased: 0,
      prestigeCount: 0,
      bestCreditsPerSec: 0,
    },
    ...freshRunState(),
  };

  applyRunStartBonuses(state);
  applyTechUnlocks(state);
  return state;
}
