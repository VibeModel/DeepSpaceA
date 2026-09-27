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
} from "./game/simulation";
import {
  buyBuilding,
  buildingUnlocked,
  getBuilding,
} from "./game/buildings";
import { researchTech, applyTechUnlocks, techLevel } from "./game/research";
import { buyUpgrade, upgradeLevel } from "./game/upgrades";
import { doPrestige } from "./game/prestige";
import { evaluateAchievements, getAchievement } from "./game/achievements";
import { MILESTONES, AUTOSAVE_MS, MANUAL_MINE_AMOUNT, TECHS, UPGRADES } from "./game/balance";
import type { GameState, BuildingId, SellableResource, TechId, UpgradeId } from "./game/types";
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

// Per-building unlock flags, used to detect newly unlocked systems. Centralised
// so that adding a building never misses a hardcoded copy.
function snapshotTrackers(): Record<BuildingId, boolean> {
  const out = {} as Record<BuildingId, boolean>;
  for (const id of Object.keys(state.buildings) as BuildingId[]) {
    out[id] = buildingUnlocked(state, id);
  }
  return out;
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
  return {
    miningDrone: "采矿无人机",
    solarArray: "太阳能阵列 Solar Array",
    furnace: "熔炼炉 Furnace",
    factory: "制造厂 Factory",
    laboratory: "实验室 Laboratory",
  }[id];
}

// ---------- Game loop ----------
function loop(): void {
  const realNow = Date.now();
  let dt = realNow - state.lastTick;
  if (dt < 0) dt = 0;
  state.lastTick = realNow;
  state.stats.lifetimePlayTime += dt;

  simulate(state, dt * timeScale);
  detectMilestones();
  detectAchievements();

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
  onPrestige() {
    const gained = doPrestige(state);
    if (gained > 0) {
      saveGame(state);
      // Reset detection trackers for the new run.
      prevCounts = { ...state.buildings };
      prevUnlocked = snapshotTrackers();
      render.toast("STELLAR REBOOT", `获得 ${gained} Core Data`, "info");
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
        state.buildings.furnace = Math.max(1, state.buildings.furnace);
        state.buildings.factory = Math.max(1, state.buildings.factory);
        break;
      case "unlockPrestige":
        state.stats.lifetimeCredits = Math.max(
          state.stats.lifetimeCredits,
          500_001,
        );
        render.toast("DEBUG", "Prestige 已解锁", "warn");
        break;
      case "wipe":
        resetSave();
        state = createNewGame();
        timeScale = 1;
        prevCounts = { ...state.buildings };
        prevUnlocked = snapshotTrackers();
        break;
    }
  },
};

render.start(handlers);
render.render(state);
requestAnimationFrame(loop);

// ---------- Keyboard shortcuts ----------
// Q = mine, A/S/D/F = buy buildings, W/E/R = sell ore/steel/components.
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
  } else {
    handlers.onSell(bind.res);
  }
});
