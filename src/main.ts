import "./styles/main.css";
import "./styles/space.css";
import { createNewGame } from "./game/state";
import {
  loadGame,
  saveGame,
  applyOfflineProgress,
  exportSave,
  importSave,
  resetSave,
} from "./game/save";
import {
  simulate,
  manualMine,
  sellResource,
  sellAllResources,
} from "./game/simulation";
import {
  buyBuilding,
  buildingUnlocked,
  getBuilding,
} from "./game/buildings";
import { researchTech, applyTechUnlocks, techLevel } from "./game/research";
import { buyUpgrade, upgradeLevel } from "./game/upgrades";
import { doPrestige } from "./game/prestige";
import { buildStargate, stargateTierName } from "./game/stargate";
import {
  buyStellarUpgrade,
  getStellarUpgrade,
  stellarLevel,
} from "./game/stellar";
import { doAscend } from "./game/ascension";
import { forceSpawnEvent } from "./game/events";
import {
  tickContracts,
  acceptContract,
  deliverContract,
  makeContractOffer,
} from "./game/contracts";
import {
  planetUnlocked,
  PLANET_LIST,
  getPlanet,
  getRegion,
  regionLevel,
  upgradeRegion,
} from "./game/planets";
import { evaluateAchievements, getAchievement } from "./game/achievements";
import { isRecipeUnlocked } from "./game/recipes";
import { MILESTONES, AUTOSAVE_MS, MANUAL_MINE_AMOUNT, TECHS, UPGRADES } from "./game/balance";
import type {
  GameState,
  BuildingId,
  SellableResource,
  TechId,
  UpgradeId,
  PlanetId,
  RegionId,
  RecipeId,
  StellarUpgradeId,
} from "./game/types";
import * as render from "./ui/render";
import { loadUiSettings, setNumberFormat, setAnimationLevel, type NumberFormat, type AnimationLevel } from "./ui/settings";

// Apply persisted UI preferences (number format) before any number is rendered.
loadUiSettings();

let state: GameState = loadGame() ?? createNewGame();

// Apply offline progress once at startup.
const offline = applyOfflineProgress(state);
if (offline && (offline.produced.ore > 0 || offline.produced.credits > 0)) {
  render.showOffline(offline.elapsedMs, offline.produced);
}

let timeScale = 1;
let lastAutosave = Date.now();
let prevCounts: Record<BuildingId, number> = { ...state.buildings };
let prevUnlocked: Record<BuildingId, boolean> = snapshotTrackers();
let prevPlanetUnlocked: Record<PlanetId, boolean> = snapshotPlanetUnlocks();

// Per-building unlock flags, used to detect newly unlocked systems. Centralised
// so that adding a building never misses a hardcoded copy.
function snapshotTrackers(): Record<BuildingId, boolean> {
  const out = {} as Record<BuildingId, boolean>;
  for (const id of Object.keys(state.buildings) as BuildingId[]) {
    out[id] = buildingUnlocked(state, id);
  }
  return out;
}

// Planet unlock is derived from persistent stats, so track the previous frame's
// set to fire a toast only on the transition.
function snapshotPlanetUnlocks(): Record<PlanetId, boolean> {
  const out = {} as Record<PlanetId, boolean>;
  for (const p of PLANET_LIST) out[p.id] = planetUnlocked(state, p.id);
  return out;
}

function detectPlanetUnlocks(): void {
  for (const p of PLANET_LIST) {
    const was = prevPlanetUnlocked[p.id];
    const now = planetUnlocked(state, p.id);
    if (!was && now) {
      render.toast("PLANET UNLOCKED", `${p.icon} ${p.name} 已解锁`, "info");
      render.celebrateScene();
    }
    prevPlanetUnlocked[p.id] = now;
  }
}

function detectMilestones(): void {
  for (const id of Object.keys(state.buildings) as BuildingId[]) {
    const before = prevCounts[id];
    const after = state.buildings[id];
    // Power buildings have no production milestone (supply is not scaled by
    // milestones), so skip the misleading "产量 ×2" toast for them.
    const isPower = getBuilding(id).category === "power";
    if (after > before && !isPower) {
      for (const m of MILESTONES) {
        if (before < m && after >= m) {
          render.toast(
            "MILESTONE UNLOCKED",
            `${id} 达到 ${m} → 产量 ×2`,
            "warn",
          );
          render.celebrateScene();
          render.highlightBuilding(id);
        }
      }
    }
    // New system unlock.
    const wasU = prevUnlocked[id];
    const nowU = buildingUnlocked(state, id);
    if (!wasU && nowU && id !== "miningDrone") {
      render.toast("NEW SYSTEM", buildingName(id), "info");
      render.celebrateScene();
      render.highlightBuilding(id);
    }
    prevCounts[id] = after;
    prevUnlocked[id] = nowU;
  }
}

// Unlock any newly satisfied achievements (pure trophies).
function detectAchievements(): void {
  const newly = evaluateAchievements(state);
  for (const id of newly) {
    const a = getAchievement(id);
    render.toast(`${a.icon} 成就达成`, a.name, "info");
  }
  if (newly.length > 0) render.celebrateScene();
}

function buildingName(id: BuildingId): string {
  return getBuilding(id).name;
}

// ---------- Game loop ----------
function loop(): void {
  const realNow = Date.now();
  let dt = realNow - state.lastTick;
  if (dt < 0) dt = 0;
  state.lastTick = realNow;
  state.stats.lifetimePlayTime += dt;

  simulate(state, dt * timeScale);
  // Contracts run on ONLINE wall-clock time (never scaled, never offline), so
  // an away player never returns to an expired order.
  tickContracts(state, dt / 1000);
  detectMilestones();
  detectAchievements();
  detectPlanetUnlocks();

  if (realNow - lastAutosave > AUTOSAVE_MS) {
    saveGame(state);
    lastAutosave = realNow;
  }

  render.render(state);
  requestAnimationFrame(loop);
}

// ---------- Save on unload ----------
window.addEventListener("beforeunload", () => {
  saveGame(state);
});

// ---------- Handlers ----------
const handlers: render.Handlers = {
  onMine() {
    manualMine(state);
    render.feedbackMine(MANUAL_MINE_AMOUNT);
  },
  onSell(res: SellableResource) {
    sellResource(state, res, 1);
  },
  onSellAll() {
    const gained = sellAllResources(state);
    if (gained > 0) {
      render.toast("SELL ALL", `出售全部库存 · +${Math.round(gained)} Credits`, "info");
    }
  },
  onBuyBuilding(id: BuildingId) {
    if (buyBuilding(state, id)) render.feedbackPurchase(id);
  },
  onBuyTech(id: TechId) {
    if (researchTech(state, id)) {
      saveGame(state);
      const lv = techLevel(state, id);
      render.toast("RESEARCH", `${TECHS[id].name} Lv.${lv}`, "info");
    }
  },
  onBuyUpgrade(id: UpgradeId) {
    if (buyUpgrade(state, id)) {
      saveGame(state);
      render.toast("UPGRADE", `${UPGRADES[id].name} Lv.${upgradeLevel(state, id)}`, "info");
    }
  },
  onToggleAutoSell(res: SellableResource) {
    state.autoSell[res] = !state.autoSell[res];
  },
  onToggleAutoBuy(id: BuildingId) {
    state.autoBuy[id] = !state.autoBuy[id];
  },
  onToggleAutoResearch() {
    state.autoResearch = !state.autoResearch;
  },
  onPrestige(dest: PlanetId) {
    const gained = doPrestige(state, dest);
    if (gained > 0) {
      saveGame(state);
      // Reset detection trackers for the new run.
      prevCounts = { ...state.buildings };
      prevUnlocked = snapshotTrackers();
      prevPlanetUnlocked = snapshotPlanetUnlocks();
      const p = getPlanet(state.planet);
      render.toast("STELLAR REBOOT", `获得 ${gained} Core Data · 着陆 ${p.icon} ${p.name}`, "info");
      render.celebrateScene();
    }
  },
  onSelectPlanet(id: PlanetId) {
    if (!planetUnlocked(state, id)) return;
    state.nextPlanet = id;
    saveGame(state);
    const p = getPlanet(id);
    render.toast("DESTINATION SET", `下次重构目的地：${p.icon} ${p.name}`, "info");
  },
  onUpgradeRegion(id: RegionId) {
    if (upgradeRegion(state, id)) {
      render.feedbackRegion(id);
      saveGame(state);
      render.toast(
        "REGION UPGRADED",
        `${getRegion(id).name} → Lv.${regionLevel(state, id)}`,
        "info",
      );
    }
  },
  onSelectRecipe(bid: BuildingId, rid: RecipeId, delta: number) {
    // Ignore clicks on recipes that are still locked (defensive: the UI hides
    // them, but a stale DOM node could linger for a frame).
    if (!isRecipeUnlocked(state, rid)) return;
    const mix = state.recipeMix[bid];
    if (!mix) return;
    const cur = mix[rid] ?? 0;
    mix[rid] = Math.max(0, cur + delta);
    saveGame(state);
  },
  onBuildStargate() {
    if (buildStargate(state)) {
      saveGame(state);
      render.toast(
        "STARGATE ONLINE",
        `T${state.stargateLevel} · ${stargateTierName(state.stargateLevel) || "结构成型"}`,
        "info",
      );
      render.celebrateScene();
    }
  },
  onAscend() {
    const gained = doAscend(state);
    if (gained > 0) {
      saveGame(state);
      prevCounts = { ...state.buildings };
      prevUnlocked = snapshotTrackers();
      prevPlanetUnlocked = snapshotPlanetUnlocks();
      render.toast("ASCENSION", `获得 ${gained} 星图 · 第 ${state.ascensionCount} 次升华`, "info");
      render.celebrateScene();
    }
  },
  onBuyStellarUpgrade(id: StellarUpgradeId) {
    if (buyStellarUpgrade(state, id)) {
      saveGame(state);
      render.toast("CHART UPGRADE", `${getStellarUpgrade(id).name} → Lv.${stellarLevel(state, id)}`, "info");
    }
  },
  onAcceptContract(id: number) {
    if (acceptContract(state, id)) {
      saveGame(state);
      render.toast("CONTRACT", `已接受订单 #${id}`, "info");
    }
  },
  onDeliverContract(id: number) {
    const before = state.activeContracts.find((c) => c.id === id);
    if (deliverContract(state, id)) {
      saveGame(state);
      render.toast(
        "CONTRACT COMPLETE",
        `订单 #${id} 完成 · +${before ? Math.round(before.reward) : 0} Credits`,
        "info",
      );
    }
  },
  onSetTab() {
    /* render handles active styling */
  },
  onSetNumberFormat(fmt: NumberFormat) {
    setNumberFormat(fmt); // also persists to localStorage
  },
  onSetAnimation(level: AnimationLevel) {
    setAnimationLevel(level); // also persists to localStorage
  },
  onExport() {
    return exportSave(state);
  },
  onImport(code: string) {
    const imported = importSave(code);
    if (!imported) return false;
    applyTechUnlocks(imported);
    state = imported;
    prevCounts = { ...state.buildings };
    prevUnlocked = snapshotTrackers();
    prevPlanetUnlocked = snapshotPlanetUnlocks();
    saveGame(state);
    return true;
  },
  onManualSave() {
    saveGame(state);
    render.toast("SAVED", "进度已保存", "info");
  },
  onReset() {
    resetSave();
    state = createNewGame();
    prevCounts = { ...state.buildings };
    prevUnlocked = snapshotTrackers();
    prevPlanetUnlocked = snapshotPlanetUnlocks();
  },
  onDebug(action: string) {
    switch (action) {
      case "credits":
        state.resources.credits += 10_000;
        break;
      case "ore":
        state.resources.ore += 10_000;
        break;
      case "research":
        state.resources.research += 100;
        break;
      case "speed10":
        timeScale = 10;
        render.toast("DEBUG", "时间加速 ×10", "warn");
        break;
      case "speed100":
        timeScale = 100;
        render.toast("DEBUG", "时间加速 ×100", "warn");
        break;
      case "unlockBuildings":
        state.buildings.miningDrone = Math.max(1, state.buildings.miningDrone);
        state.buildings.solarArray = Math.max(1, state.buildings.solarArray);
        state.buildings.copperMine = Math.max(1, state.buildings.copperMine);
        state.buildings.furnace = Math.max(1, state.buildings.furnace);
        state.buildings.factory = Math.max(1, state.buildings.factory);
        state.buildings.assembler = Math.max(1, state.buildings.assembler);
        break;
      case "unlockChain":
        // Grant the whole copper → circuit → alloy → blueprint chain.
        state.buildings.copperMine = Math.max(1, state.buildings.copperMine);
        state.buildings.furnace = Math.max(1, state.buildings.furnace);
        state.buildings.factory = Math.max(1, state.buildings.factory);
        state.buildings.assembler = Math.max(1, state.buildings.assembler);
        state.techs.copperProcessing = Math.max(1, state.techs.copperProcessing);
        state.techs.circuitFabrication = Math.max(1, state.techs.circuitFabrication);
        state.techs.alloySynthesis = Math.max(1, state.techs.alloySynthesis);
        state.resources.credits += 10_000;
        applyTechUnlocks(state);
        render.toast("DEBUG", "铜链配方已解锁", "warn");
        break;
      case "unlockPrestige":
        state.runPeakCreditsPerSec = Math.max(
          state.runPeakCreditsPerSec,
          500,
        );
        render.toast("DEBUG", "Prestige 已解锁", "warn");
        break;
      case "unlockPlanets":
        state.stats.prestigeCount = Math.max(state.stats.prestigeCount, 3);
        state.lifetimeCoreData = Math.max(state.lifetimeCoreData, 80);
        render.toast("DEBUG", "所有星球已解锁", "warn");
        break;
      case "unlockAscend":
        state.lifetimeCoreData = Math.max(state.lifetimeCoreData, 60);
        render.toast("DEBUG", "升华已解锁", "warn");
        break;
      case "stargate":
        state.stargateLevel += 1;
        render.toast("DEBUG", `星门 → T${state.stargateLevel}`, "warn");
        break;
      case "event":
        // Events are gated behind the first prestige; unlock and fire one.
        state.stats.prestigeCount = Math.max(state.stats.prestigeCount, 1);
        forceSpawnEvent(state);
        render.toast("DEBUG", `触发事件（共 ${state.activeEvents.length} 个）`, "warn");
        break;
      case "contract":
        state.stats.prestigeCount = Math.max(state.stats.prestigeCount, 1);
        {
          const offer = makeContractOffer(state);
          if (offer) {
            state.contractOffers.push(offer);
            render.toast("DEBUG", `生成合同 #${offer.id}`, "warn");
          } else {
            render.toast("DEBUG", "没有可下单的资源（先建产线）", "warn");
          }
        }
        break;
      case "wipe":
        resetSave();
        state = createNewGame();
        timeScale = 1;
        prevCounts = { ...state.buildings };
        prevUnlocked = snapshotTrackers();
        prevPlanetUnlocked = snapshotPlanetUnlocks();
        break;
    }
  },
};

render.start(handlers);
render.render(state);
requestAnimationFrame(loop);

// ---------- Keyboard shortcuts ----------
// Q = mine, A/S/D/F/G/H/J = buy buildings, W/E/R/T/Y/U = sell resources.
// Ignored while typing in inputs (e.g. the import textarea) or with modifiers.
window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const bind = render.KEY_BINDINGS[e.key.toLowerCase()];
  if (!bind) return;
  e.preventDefault();
  if (bind.type === "mine") {
    handlers.onMine();
  } else if (bind.type === "buy") {
    if (buildingUnlocked(state, bind.id)) handlers.onBuyBuilding(bind.id);
  } else if (bind.type === "sellAll") {
    handlers.onSellAll();
  } else {
    handlers.onSell(bind.res);
  }
});
