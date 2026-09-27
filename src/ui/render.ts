import {
  BUILDING_LIST,
  buildingCost,
  milestoneTiers,
  nextMilestone,
  buildingUnlocked,
} from "../game/buildings";
import {
  TECH_LIST,
  techCost,
  techLevel,
  techMaxed,
  isInfiniteTech,
} from "../game/research";
import {
  UPGRADE_LIST,
  upgradeCost,
  upgradeLevel,
  upgradeMaxed,
  isInfiniteUpgrade,
} from "../game/upgrades";
import { MILESTONES } from "../game/balance";
import { pendingCoreData, canPrestige } from "../game/prestige";
import { PRESTIGE_THRESHOLD_CREDITS } from "../game/balance";
import type {
  GameState,
  BuildingId,
  TechId,
  UpgradeId,
  SellableResource,
  LiveRates,
} from "../game/types";
import { formatNumber, formatRate, formatDuration, formatPercent } from "./format";
import { getNumberFormat, getAnimationLevel, type NumberFormat, type AnimationLevel } from "./settings";
import { deriveVisualParams, toVisualInput, VISUAL } from "./visual";
import { ACHIEVEMENTS, achievementProgress } from "../game/achievements";

export type TabName =
  | "research"
  | "automation"
  | "prestige"
  | "stats"
  | "achievements"
  | "settings";

export interface Handlers {
  onMine(): void;
  onSell(res: SellableResource): void;
  onBuyBuilding(id: BuildingId): void;
  onBuyTech(id: TechId): void;
  onBuyUpgrade(id: UpgradeId): void;
  onToggleAutoSell(res: SellableResource): void;
  onToggleAutoBuy(id: BuildingId): void;
  onToggleAutoResearch(): void;
  onPrestige(): void;
  onSetTab(tab: TabName): void;
  onSetNumberFormat(fmt: NumberFormat): void;
  onSetAnimation(level: AnimationLevel): void;
  onExport(): string;
  onImport(code: string): boolean;
  onManualSave(): void;
  onReset(): void;
  onDebug(action: string): void;
}

let S: GameState;
let H: Handlers;
let currentTab: TabName = "research";
let tabDirty = true;
let lastTabRender = 0;

// Visual-scene state. The scene root is the single place where number-driven
// CSS variables are written, and only every VISUAL_INTERVAL ms.
let sceneRef: HTMLElement | null = null;
let prodPanelRef: HTMLElement | null = null;
let topbarRef: HTMLElement | null = null;
let lightRefs: HTMLElement[] = [];
const VISUAL_INTERVAL = 180;
let lastVisual = 0;
let lastDotCount = -1;

// Cached element references for the high-frequency live panels.
const refs: Record<string, HTMLElement> = {};
const buildingRefs: Record<string, {
  root: HTMLElement;
  count: HTMLElement;
  cost: HTMLElement;
  buy: HTMLButtonElement;
  milestone: HTMLElement;
  utilWrap?: HTMLElement;
  utilBar?: HTMLElement;
}> = {};
const resRefs: Record<string, { row: HTMLElement; val: HTMLElement; delta: HTMLElement }> = {};
const stageRefs: Record<string, {
  root: HTMLElement;
  rate: HTMLElement;
  sub: HTMLElement;
  utilWrap?: HTMLElement;
  utilBar?: HTMLElement;
  warn?: HTMLElement;
  input?: HTMLElement;
  cap?: HTMLElement;
  utilText?: HTMLElement;
  eff?: HTMLElement;
}> = {};

// Power panel refs (supply / demand / percentage / bar).
const powerRefs: {
  row?: HTMLElement;
  supply?: HTMLElement;
  demand?: HTMLElement;
  pct?: HTMLElement;
  bar?: HTMLElement;
} = {};

const TOPBAR = () => `
  <div class="topbar">
    <h1>深空自动化局<small>DEEP SPACE AUTOMATION</small></h1>
    <div class="top-readouts">
      <div class="readout"><div class="label">Credits</div><div class="value accent" id="r-credits">0</div></div>
      <div class="readout"><div class="label">Core Data</div><div class="value core" id="r-core">0</div></div>
      <div class="readout"><div class="label">Research</div><div class="value" id="r-research-top">0</div></div>
    </div>
  </div>`;

// Debug panel is only rendered in development builds. In production it is
// completely absent from the DOM so players cannot cheat via devtools.
const debugBlock = import.meta.env.DEV
  ? `
    <details class="debug">
      <summary>🛠 Developer / Debug Panel</summary>
      <div class="dbg-controls">
        <button data-debug="credits">+10K Credits</button>
        <button data-debug="ore">+10K Ore</button>
        <button data-debug="research">+100 Research</button>
        <button data-debug="speed10">时间 ×10</button>
        <button data-debug="speed100">时间 ×100</button>
        <button data-debug="unlockBuildings">解锁所有建筑</button>
        <button data-debug="unlockPrestige">解锁 Prestige</button>
        <button class="danger" data-debug="wipe">清空存档</button>
      </div>
      <div class="hint">调试工具仅用于快速验证后期内容，生产构建默认隐藏（开发版可见）。</div>
    </details>`
  : "";

// Keyboard shortcuts:
//   Q            = manual mine
//   A S D F G    = buy buildings in list order (drone / solar / furnace / factory / lab)
//   W E R        = sell ore / steel / components
export const MINE_KEY = "Q";
const BUILDING_KEYS: BuildingId[] = [
  "miningDrone",
  "solarArray",
  "furnace",
  "factory",
  "laboratory",
];
const BUY_KEY_CHARS = ["A", "S", "D", "F", "G"];
const SELL_KEYS: Record<SellableResource, string> = {
  ore: "W",
  steel: "E",
  components: "R",
};

export const KEY_BINDINGS: Record<
  string,
  { type: "mine" } | { type: "buy"; id: BuildingId } | { type: "sell"; res: SellableResource }
> = {
  q: { type: "mine" },
  a: { type: "buy", id: "miningDrone" },
  s: { type: "buy", id: "solarArray" },
  d: { type: "buy", id: "furnace" },
  f: { type: "buy", id: "factory" },
  g: { type: "buy", id: "laboratory" },
  w: { type: "sell", res: "ore" },
  e: { type: "sell", res: "steel" },
  r: { type: "sell", res: "components" },
};

export function keyForBuilding(id: BuildingId): string {
  const i = BUILDING_KEYS.indexOf(id);
  return i >= 0 ? BUY_KEY_CHARS[i] : "";
}

export function keyForSell(res: SellableResource): string {
  return SELL_KEYS[res];
}

function buildingCardHTML(b: { id: BuildingId; icon: string; name: string; description: string }): string {
  return `
  <div class="building" data-bid="${b.id}">
    <div class="head">
      <span class="icon">${b.icon}</span>
      <span class="name">${b.name}</span>
      <span class="count" data-ref="count">0</span>
    </div>
    <div class="desc">${b.description}</div>
    <div data-ref="utilWrap" style="display:none">
      <div class="bar" data-ref="utilBar"><span></span></div>
    </div>
    <div class="row">
      <span class="cost" data-ref="cost">—</span>
      <button class="primary" data-ref="buy">购买 <kbd>${keyForBuilding(b.id)}</kbd></button>
    </div>
    <div class="milestone" data-ref="milestone"></div>
  </div>`;
}

function init(handlers: Handlers): void {
  H = handlers;
  const app = document.getElementById("app")!;
  app.innerHTML = `
    ${TOPBAR()}
    <div class="main-grid">
      <section class="panel" id="panel-buildings">
        <h2>BUILDINGS</h2>
        <div class="manual">
          <button class="big primary" id="btn-mine">⛏ 手动采矿 (+1 铁矿) <kbd>${MINE_KEY}</kbd></button>
        </div>
        <div class="manual">
          <button data-sell="ore">出售 矿石 <kbd>${keyForSell("ore")}</kbd></button>
          <button data-sell="steel">出售 钢材 <kbd>${keyForSell("steel")}</kbd></button>
          <button data-sell="components">出售 零件 <kbd>${keyForSell("components")}</kbd></button>
        </div>
        <div id="buildings-list"></div>
      </section>

      <section class="panel" id="panel-production">
        <h2>PRODUCTION</h2>
        <div class="space-scene" id="space-scene" data-strain="0" data-industry="0" data-ring="0" aria-hidden="true">
          <div class="space-stars"></div>
          <div class="planet-system">
            <div class="planet-halo"></div>
            <div class="orbit orbit-inner"><span class="sat"></span></div>
            <div class="orbit orbit-outer"><span class="sat"></span></div>
            <div class="planet">
              <div class="planet-surface"></div>
              <div class="planet-clouds"></div>
              <div class="planet-rim"></div>
              <div class="base-lights" id="base-lights"></div>
            </div>
            <div class="planet-ring"></div>
          </div>
        </div>
        <div id="resource-readouts"></div>
        <div class="power-row" id="power-row">
          <div class="p-head">
            <span class="p-label">⚡ 电力 Power</span>
            <span class="p-vals"><span id="p-supply">0</span> / <span id="p-demand">0</span> · <span id="p-pct">100%</span></span>
          </div>
          <div class="bar" id="p-bar"><span></span></div>
        </div>
        <h2 style="margin-top:14px">FLOW</h2>
        <div id="flow"></div>
      </section>

      <section class="panel" id="panel-stats">
        <h2>STATISTICS</h2>
        <div id="live-stats"></div>
      </section>
    </div>

    <div class="tabbar" id="tabbar">
      <button data-tab="research">🔬 科研 Research</button>
      <button data-tab="automation">🤖 自动化 Automation</button>
      <button data-tab="prestige">💠 重构 Prestige</button>
      <button data-tab="stats">📈 数据 Statistics</button>
      <button data-tab="achievements">🏆 成就 Achievements</button>
      <button data-tab="settings">⚙ 设置 Settings</button>
    </div>
    <div class="tab-panel" id="tab-content"></div>

    <section class="panel" style="margin-top:14px">
      <h2>SAVE / DATA</h2>
      <div class="save-controls">
        <button id="btn-save">💾 手动保存</button>
        <button id="btn-export">📤 导出存档</button>
        <button id="btn-import">📥 导入存档</button>
        <button class="danger" id="btn-reset">🗑 重置存档</button>
      </div>
    </section>

    ${debugBlock}

    <div id="toasts"></div>
  `;

  // Build building cards.
  const list = document.getElementById("buildings-list")!;
  for (const b of BUILDING_LIST) {
    const wrap = document.createElement("div");
    wrap.innerHTML = buildingCardHTML(b);
    const root = wrap.firstElementChild as HTMLElement;
    list.appendChild(root);
    buildingRefs[b.id] = {
      root,
      count: root.querySelector('[data-ref="count"]')!,
      cost: root.querySelector('[data-ref="cost"]')!,
      buy: root.querySelector('[data-ref="buy"]')!,
      milestone: root.querySelector('[data-ref="milestone"]')!,
      utilWrap: root.querySelector('[data-ref="utilWrap"]') as HTMLElement,
      utilBar: root.querySelector('[data-ref="utilBar"]') as HTMLElement,
    };
  }

  // Resource readouts.
  const rr = document.getElementById("resource-readouts")!;
  const resDefs: [string, string][] = [
    ["ore", "铁矿 Ore"],
    ["steel", "钢材 Steel"],
    ["components", "零件 Components"],
    ["credits", "信用点 Credits"],
    ["research", "研究点 Research"],
  ];
  for (const [id, name] of resDefs) {
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `<span class="name">${name}</span><span><span class="val" data-v></span> <span class="delta" data-d></span></span>`;
    rr.appendChild(row);
    resRefs[id] = {
      row,
      val: row.querySelector("[data-v]")!,
      delta: row.querySelector("[data-d]")!,
    };
  }

  // Flow stages.
  const flow = document.getElementById("flow")!;
  const stages: [string, string, string, boolean][] = [
    ["mining", "⛏", "采矿 Mining", false],
    ["smelting", "🔥", "熔炼 Smelting", true],
    ["manufacturing", "⚙", "制造 Manufacturing", true],
    ["research", "🔬", "科研 Research", false],
  ];
  for (const [id, icon, title, hasUtil] of stages) {
    const div = document.createElement("div");
    div.className = "flow-stage";
    div.innerHTML = `
      <span class="icon">${icon}</span>
      <div class="info"><div class="title">${title}</div><div class="sub" data-sub></div></div>
      <div class="rate"><div class="v" data-rate>0/s</div></div>
      ${hasUtil ? `<div class="bar" data-util style="width:120px"><span></span></div>` : ""}
      ${hasUtil ? `<div class="metrics" data-metrics>
        <div class="m-row"><span class="m-k">输入</span><span class="m-v" data-min>—</span><span class="m-k">产能</span><span class="m-v" data-mcap>—</span></div>
        <div class="m-row"><span class="m-k">利用率</span><span class="m-v" data-mutil>—</span><span class="m-k">效率</span><span class="m-v" data-meff>—</span></div>
      </div>` : ""}
    `;
    flow.appendChild(div);
    if (id !== "research") {
      const arrow = document.createElement("div");
      arrow.className = "flow-arrow";
      arrow.textContent = "↓";
      flow.appendChild(arrow);
    }
    stageRefs[id] = {
      root: div,
      rate: div.querySelector("[data-rate]")!,
      sub: div.querySelector("[data-sub]")!,
      utilWrap: hasUtil ? div.querySelector("[data-util]") as HTMLElement : undefined,
      utilBar: hasUtil ? (div.querySelector("[data-util] span") as HTMLElement) : undefined,
      warn: undefined,
      input: hasUtil ? (div.querySelector("[data-min]") as HTMLElement) : undefined,
      cap: hasUtil ? (div.querySelector("[data-mcap]") as HTMLElement) : undefined,
      utilText: hasUtil ? (div.querySelector("[data-mutil]") as HTMLElement) : undefined,
      eff: hasUtil ? (div.querySelector("[data-meff]") as HTMLElement) : undefined,
    };
    // attach a warning line element under the stage
    const warn = document.createElement("div");
    warn.style.display = "none";
    flow.appendChild(warn);
    stageRefs[id].warn = warn;
  }

  // Space scene: cache refs and build the fixed light-dot pool exactly once.
  // The pool size must match VISUAL.dotPool.
  sceneRef = document.getElementById("space-scene");
  prodPanelRef = document.getElementById("panel-production");
  topbarRef = document.querySelector<HTMLElement>(".topbar");
  const lights = document.getElementById("base-lights")!;
  lightRefs = [];
  const DOT_POS: [number, number][] = [
    [46, 38], [38, 52], [55, 60], [62, 44], [30, 44], [50, 72], [64, 66],
    [42, 26], [58, 30], [34, 62], [50, 50], [68, 54], [44, 82], [26, 56],
  ];
  for (const [x, y] of DOT_POS.slice(0, VISUAL.dotPool)) {
    const d = document.createElement("span");
    d.className = "dot";
    d.style.left = `${x}%`;
    d.style.top = `${y}%`;
    lights.appendChild(d);
    lightRefs.push(d);
  }
  // Apply the persisted animation intensity to the document root.
  document.documentElement.dataset.anim = getAnimationLevel();

  // Power panel refs.
  powerRefs.row = document.getElementById("power-row") ?? undefined;
  powerRefs.supply = document.getElementById("p-supply") ?? undefined;
  powerRefs.demand = document.getElementById("p-demand") ?? undefined;
  powerRefs.pct = document.getElementById("p-pct") ?? undefined;
  powerRefs.bar = document.getElementById("p-bar") ?? undefined;

  // Live stats panel.
  const ls = document.getElementById("live-stats")!;
  ls.innerHTML = `
    <div class="stat-line"><span class="k">本轮时长 Run Time</span><span class="v" id="ls-runtime">0s</span></div>
    <div class="stat-line"><span class="k">Ore /s</span><span class="v" id="ls-ore">0</span></div>
    <div class="stat-line"><span class="k">Steel /s</span><span class="v" id="ls-steel">0</span></div>
    <div class="stat-line"><span class="k">Components /s</span><span class="v" id="ls-comp">0</span></div>
    <div class="stat-line"><span class="k">Credits /s</span><span class="v" id="ls-credits">0</span></div>
    <div class="stat-line"><span class="k">Research /s</span><span class="v" id="ls-research">0</span></div>`;

  // Wire delegated events.
  // Use "mousedown" (not "click") so that rapid re-renders of the tab panels
  // (which rebuild innerHTML) cannot drop a click whose mouseup lands on a
  // freshly-replaced node. mousedown fires on press, before any re-render.
  app.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    const sell = t.closest("[data-sell]");
    if (sell) {
      H.onSell((sell as HTMLElement).dataset.sell as SellableResource);
      return;
    }
    const buy = t.closest('[data-ref="buy"]');
    if (buy) {
      const card = buy.closest("[data-bid]") as HTMLElement;
      H.onBuyBuilding(card.dataset.bid as BuildingId);
      return;
    }
    const tabBtn = t.closest("[data-tab]");
    if (tabBtn) {
      currentTab = (tabBtn as HTMLElement).dataset.tab as TabName;
      tabDirty = true;
      H.onSetTab(currentTab);
      return;
    }
    const techBtn = t.closest("[data-tech]");
    if (techBtn) {
      H.onBuyTech((techBtn as HTMLElement).dataset.tech as TechId);
      return;
    }
    const upBtn = t.closest("[data-up]");
    if (upBtn) {
      H.onBuyUpgrade((upBtn as HTMLElement).dataset.up as UpgradeId);
      return;
    }
    const asBtn = t.closest("[data-autosell]");
    if (asBtn) {
      H.onToggleAutoSell((asBtn as HTMLElement).dataset.autosell as SellableResource);
      return;
    }
    const abBtn = t.closest("[data-autobuy]");
    if (abBtn) {
      H.onToggleAutoBuy((abBtn as HTMLElement).dataset.autobuy as BuildingId);
      return;
    }
    const arBtn = t.closest("[data-autoresearch]");
    if (arBtn) {
      H.onToggleAutoResearch();
      return;
    }
    // Match only the settings <button>s. A bare "[data-anim]" would also match
    // <html data-anim=...> (set by init for the animation level), swallowing the
    // click for every button that has no earlier data-* branch.
    const fmtBtn = t.closest("button[data-numfmt]");
    if (fmtBtn) {
      H.onSetNumberFormat((fmtBtn as HTMLElement).dataset.numfmt as NumberFormat);
      tabDirty = true; // re-render settings tab immediately to update highlight
      return;
    }
    const animBtn = t.closest("button[data-anim]");
    if (animBtn) {
      H.onSetAnimation((animBtn as HTMLElement).dataset.anim as AnimationLevel);
      document.documentElement.dataset.anim = getAnimationLevel(); // take effect now
      tabDirty = true; // re-render settings tab immediately to update highlight
      return;
    }
    const dbg = t.closest("[data-debug]");
    if (dbg) {
      H.onDebug((dbg as HTMLElement).dataset.debug!);
      return;
    }
    if (t.id === "btn-mine") H.onMine();
    else if (t.id === "btn-save") H.onManualSave();
    else if (t.id === "btn-export") openExportModal();
    else if (t.id === "btn-import") openImportModal();
    else if (t.id === "btn-reset") openResetModal();
    else if (t.id === "btn-prestige") confirmPrestige();
    else if (t.id === "btn-modal-close" || t.id === "modal-backdrop") closeModal();
  });

  document.getElementById("tabbar")!.addEventListener("click", () => {
    // active class handled in renderTab
  });
}

// ---------- Live panel updates ----------

function updateLive(): void {
  const s = S;
  const r = s.rates;

  refs["r-credits"] = document.getElementById("r-credits")!;
  refs["r-core"] = document.getElementById("r-core")!;
  refs["r-research-top"] = document.getElementById("r-research-top")!;
  refs["r-credits"].textContent = formatNumber(s.resources.credits);
  refs["r-core"].textContent = formatNumber(s.coreData);
  refs["r-research-top"].textContent = formatNumber(s.resources.research);

  // Resources.
  for (const id of ["ore", "steel", "components", "credits", "research"]) {
    const ref = resRefs[id];
    const val = (s.resources as any)[id] as number;
    ref.val.textContent = formatNumber(val);
    const net = (r as any)[id] as number;
    const sign = net >= 0 ? "+" : "";
    ref.delta.textContent = `${sign}${formatRate(net)}`;
    ref.delta.className = "delta " + (net >= 0 ? "pos" : "neg");
    // Direction-driven pulse on the value (number-driven feedback).
    const dir = net > 1e-9 ? "up" : net < -1e-9 ? "down" : "flat";
    if (ref.row.dataset.flow !== dir) ref.row.dataset.flow = dir;
  }

  // Buildings.
  for (const b of BUILDING_LIST) {
    const ref = buildingRefs[b.id];
    const owned = s.buildings[b.id];
    const unlocked = buildingUnlocked(s, b.id);
    ref.root.classList.toggle("locked", !unlocked);
    ref.count.textContent = formatNumber(owned);
    if (!unlocked) {
      ref.cost.textContent = "🔒 未解锁（先建造前置建筑）";
      ref.buy.disabled = true;
      ref.milestone.textContent = "";
      if (ref.utilWrap) ref.utilWrap.style.display = "none";
      continue;
    }
    const cost = buildingCost(s, b.id);
    ref.cost.innerHTML = `下个花费: <b>${formatNumber(cost)}</b> Credits`;
    ref.buy.disabled = s.resources.credits < cost;
    // Power buildings have no production milestone — show their grid
    // contribution instead.
    if (b.category === "power") {
      const per = b.baseSupply ?? 0;
      ref.milestone.innerHTML =
        `☀ 本阵列供电 ${formatRate(owned * per)} · 电网 ${formatPercent(r.powerFactor)}`;
    } else {
      const tiers = milestoneTiers(b.id, owned);
      const next = nextMilestone(b.id, owned);
      let mtxt = `里程碑 ${tiers}/${MILESTONES.length}`;
      if (next !== null) {
        mtxt += ` · <span class="next">下一个 @ ${next}: ×2 产量</span>`;
      } else {
        mtxt += ` · <span class="done">全部达成</span>`;
      }
      ref.milestone.innerHTML = mtxt;
    }

    // Utilization bar for processor / lab.
    if (ref.utilWrap && ref.utilBar) {
      let util = 0;
      let show = true;
      if (b.id === "furnace") util = r.furnaceUtil;
      else if (b.id === "factory") util = r.factoryUtil;
      else if (b.id === "laboratory") util = r.labActive ? 1 : 0;
      else show = false;
      if (show && owned > 0) {
        ref.utilWrap.style.display = "";
        const pct = Math.round(util * 100);
        ref.utilBar.firstElementChild!.setAttribute(
          "style",
          `width:${pct}%`,
        );
        ref.utilBar.className = "bar" + (util < 0.99 ? " warn" : " full");
      } else {
        ref.utilWrap.style.display = "none";
      }
    }
  }

  // Flow stages.
  setStage("mining", r.oreProd, null, null);
  setStage("smelting", r.steelProd, r.furnaceUtil, {
    shortage: r.oreShortage,
    accum: r.oreAccumulating,
    label: "Ore",
  });
  setStage("manufacturing", r.compProd, r.factoryUtil, {
    shortage: r.steelShortage,
    accum: r.steelAccumulating,
    label: "Steel",
  });
  setStage("research", r.researchProd, null, null);

  // Numeric diagnostics (Production Analytics unlock).
  setStageSub("mining", r, s);
  setStageSub("smelting", r, s);
  setStageSub("manufacturing", r, s);
  setStageSub("research", r, s);

  // Structured bottleneck metrics (Input / Capacity / Utilisation / Efficiency).
  setStageMetrics("smelting", r);
  setStageMetrics("manufacturing", r);

  // Power grid readout.
  updatePowerRow(r);

  // Live stats.
  const runMs = Date.now() - s.stats.currentRunStart;
  document.getElementById("ls-runtime")!.textContent = formatDuration(runMs);
  document.getElementById("ls-ore")!.textContent = formatRate(r.oreProd);
  document.getElementById("ls-steel")!.textContent = formatRate(r.steelProd);
  document.getElementById("ls-comp")!.textContent = formatRate(r.compProd);
  document.getElementById("ls-credits")!.textContent = formatRate(r.credits);
  document.getElementById("ls-research")!.textContent = formatRate(r.researchProd);

  // Drive the planet scene / number animations (throttled internally).
  updateVisuals();
}

// Push live numbers into CSS custom properties on the scene root, at a low
// frequency so CSS transitions/looping animations do the smoothing. Nothing
// here writes per frame.
function updateVisuals(): void {
  const root = sceneRef;
  if (!root) return;
  const now = performance.now();
  if (now - lastVisual < VISUAL_INTERVAL) return;
  lastVisual = now;

  const p = deriveVisualParams(toVisualInput(S));
  const set = (k: string, v: string) => root.style.setProperty(k, v);

  set("--glow", p.glow.toFixed(3));
  set("--activity", p.activity.toFixed(3));
  set("--breathe-dur", p.breatheDur.toFixed(2) + "s");
  set("--orbit-dur", p.orbitDur.toFixed(2) + "s");

  const strain = p.strained ? "1" : "0";
  if (root.dataset.strain !== strain) root.dataset.strain = strain;
  const industry = p.hasIndustry ? "1" : "0";
  if (root.dataset.industry !== industry) root.dataset.industry = industry;
  const ring = p.hasRing ? "1" : "0";
  if (root.dataset.ring !== ring) root.dataset.ring = ring;

  // Light pool: only touch the DOM when the count actually changes.
  if (p.dotCount !== lastDotCount) {
    for (let i = 0; i < lightRefs.length; i++) {
      lightRefs[i].classList.toggle("on", i < p.dotCount);
    }
    lastDotCount = p.dotCount;
  }

  // Per-stage pipeline sweep speed.
  stageRefs.mining.root.style.setProperty("--flow-dur", p.flowDur.mining.toFixed(2) + "s");
  stageRefs.smelting.root.style.setProperty("--flow-dur", p.flowDur.smelting.toFixed(2) + "s");
  stageRefs.manufacturing.root.style.setProperty("--flow-dur", p.flowDur.manufacturing.toFixed(2) + "s");
  stageRefs.research.root.style.setProperty("--flow-dur", p.flowDur.research.toFixed(2) + "s");

  // Arrows share a panel-level sweep speed (use the slowest active stage).
  const panelFlow = Math.max(
    p.flowDur.mining,
    p.flowDur.smelting,
    p.flowDur.manufacturing,
    p.flowDur.research,
  );
  prodPanelRef?.style.setProperty("--flow-dur", panelFlow.toFixed(2) + "s");

  // Top-bar credits pulse.
  if (topbarRef) {
    topbarRef.style.setProperty("--credit-dur", p.creditDur.toFixed(2) + "s");
    const active = p.creditActive ? "1" : "0";
    if (topbarRef.dataset.active !== active) topbarRef.dataset.active = active;
  }
}

function setStage(
  id: string,
  rate: number,
  util: number | null,
  warn: { shortage: boolean; accum: boolean; label: string } | null,
): void {
  const ref = stageRefs[id];
  ref.rate.textContent = formatRate(rate);
  if (ref.utilBar && util !== null) {
    const pct = Math.round(util * 100);
    ref.utilBar.setAttribute("style", `width:${pct}%`);
    const wrap = ref.utilBar.parentElement!;
    wrap.className = "bar" + (util < 0.99 ? " warn" : " full");
  }
  if (ref.warn && warn) {
    const showWarn = S.flags.analyticsUnlocked && (warn.shortage || warn.accum);
    if (showWarn) {
      ref.warn.style.display = "";
      ref.warn.className = warn.shortage ? "warn-line" : "accum-line";
      ref.warn.textContent = warn.shortage
        ? `⚠ ${warn.label} 短缺 — 上游产能不足`
        : `⚠ ${warn.label} 积压 — 下游产能不足`;
    } else {
      ref.warn.style.display = "none";
    }
  }
}

// Numeric diagnostics per stage, shown once "Production Analytics" is unlocked.
function setStageSub(id: string, r: LiveRates, s: GameState): void {
  const el = stageRefs[id].sub;
  if (!s.flags.analyticsUnlocked) {
    el.textContent = "";
    return;
  }
  const rate = formatRate;
  // Brownout-aware capacities so a power shortage is not blamed on raw material.
  const furnaceCapEff = r.furnaceCap * r.powerFactor;
  const factoryCapEff = r.factoryCap * r.powerFactor;
  let txt = "";

  if (id === "mining") {
    if (r.furnaceCap <= 0) {
      txt = "尚无下游熔炼炉";
    } else {
      txt =
        r.furnaceCap > r.oreProd * 1.001
          ? `下游需求 ${rate(r.furnaceCap)} · 采矿不足`
          : `下游需求 ${rate(r.furnaceCap)}`;
    }
  } else if (id === "smelting") {
    if (r.furnaceCap <= 0) {
      txt = "尚未建造熔炼炉";
    } else {
      const util = Math.round(r.furnaceUtil * 100);
      if (r.oreProd > furnaceCapEff * 1.001) {
        const have = s.buildings.furnace;
        const need = Math.max(1, Math.ceil((have * r.oreProd) / r.furnaceCap) - have);
        txt = `利用率 ${util}% · 铁矿盈余 ${rate(r.oreProd - furnaceCapEff)} · 建议 +${need} 熔炉`;
      } else if (r.furnaceUtil < 0.99) {
        txt = `利用率 ${util}% · 铁矿缺口 ${rate(furnaceCapEff - r.oreProd)} · 采矿不足`;
      } else {
        txt = `利用率 ${util}% · 满负荷`;
      }
    }
  } else if (id === "manufacturing") {
    if (r.factoryCap <= 0) {
      txt = "尚未建造制造厂";
    } else {
      const util = Math.round(r.factoryUtil * 100);
      if (r.steelProd > factoryCapEff * 1.001) {
        const have = s.buildings.factory;
        const need = Math.max(1, Math.ceil((have * r.steelProd) / r.factoryCap) - have);
        txt = `利用率 ${util}% · 钢材盈余 ${rate(r.steelProd - factoryCapEff)} · 建议 +${need} 制造厂`;
      } else if (r.factoryUtil < 0.99) {
        txt = `利用率 ${util}% · 钢材缺口 ${rate(factoryCapEff - r.steelProd)} · 熔炼不足`;
      } else {
        txt = `利用率 ${util}% · 满负荷`;
      }
    }
  } else if (id === "research") {
    if (s.buildings.laboratory <= 0) {
      txt = "尚未建造实验室";
    } else {
      txt = r.labActive
        ? `研究产出 ${rate(r.researchProd)}`
        : "⚠ 信用点不足，实验室停机";
    }
  }

  // Explain a brownout on any stage it affects.
  const powerNote =
    r.powerFactor < 0.995 ? ` · ⚡ 电力 ${formatPercent(r.powerFactor)}` : "";
  el.textContent = txt + (txt ? powerNote : "");
}

// Structured bottleneck metrics: Input / Capacity / Utilisation / Efficiency.
function setStageMetrics(id: "smelting" | "manufacturing", r: LiveRates): void {
  const ref = stageRefs[id];
  if (!ref.input || !ref.cap || !ref.utilText || !ref.eff) return;
  const input = id === "smelting" ? r.furnaceInput : r.factoryInput;
  const cap = id === "smelting" ? r.furnaceCap : r.factoryCap;
  const eff = id === "smelting" ? r.furnaceYield : r.factoryYield;
  ref.input.textContent = formatRate(input);
  ref.cap.textContent = formatRate(cap);
  ref.utilText.textContent = formatPercent(cap > 0 ? input / cap : 0);
  ref.eff.textContent = "×" + eff.toFixed(2);
}

// Power grid readout (supply / demand / percentage + bar).
function updatePowerRow(r: LiveRates): void {
  if (!powerRefs.supply) return;
  powerRefs.supply.textContent = formatNumber(r.powerSupply);
  if (powerRefs.demand) powerRefs.demand.textContent = formatNumber(r.powerDemand);
  if (powerRefs.pct) powerRefs.pct.textContent = formatPercent(r.powerFactor);
  if (powerRefs.bar) {
    const pct = Math.round(Math.min(1, r.powerFactor) * 100);
    powerRefs.bar.firstElementChild?.setAttribute("style", `width:${pct}%`);
    powerRefs.bar.className = "bar" + (r.powerFactor < 0.995 ? " warn" : " full");
  }
  if (powerRefs.row) {
    powerRefs.row.classList.toggle("deficit", r.powerFactor < 0.995 && r.powerDemand > 0);
  }
}

// ---------- Tab rendering ----------

function renderTab(): void {
  const el = document.getElementById("tab-content")!;
  // active button styling
  document.querySelectorAll("#tabbar button").forEach((b) => {
    b.classList.toggle("active", (b as HTMLElement).dataset.tab === currentTab);
  });

  if (currentTab === "research") el.innerHTML = renderResearch();
  else if (currentTab === "automation") el.innerHTML = renderAutomation();
  else if (currentTab === "prestige") el.innerHTML = renderPrestige();
  else if (currentTab === "achievements") el.innerHTML = renderAchievements();
  else if (currentTab === "settings") el.innerHTML = renderSettings();
  else el.innerHTML = renderStats();
}

function renderAchievements(): string {
  const s = S;
  const unlockedCount = ACHIEVEMENTS.filter((a) => s.achievements[a.id]).length;
  let html = `<h3 style="color:var(--accent)">🏆 成就 / Achievements</h3>`;
  html += `<p style="margin-top:0;color:var(--muted)">已解锁 <b style="color:var(--accent)">${unlockedCount}</b> / ${ACHIEVEMENTS.length}</p>`;
  html += `<div class="grid-cards">`;
  for (const a of ACHIEVEMENTS) {
    const done = !!s.achievements[a.id];
    const { current, target, pct } = achievementProgress(s, a);
    const pctText = formatPercent(pct);
    html += `<div class="ach-card${done ? " done" : " locked"}">
      <div class="a-head"><span class="a-icon">${a.icon}</span><span class="a-name">${a.name}</span>${done ? `<span class="a-check">✓</span>` : ""}</div>
      <div class="a-desc">${a.description}</div>
      <div class="bar"><span style="width:${Math.round(pct * 100)}%"></span></div>
      <div class="a-progress">${done ? "已达成" : `${formatNumber(current)} / ${formatNumber(target)} · ${pctText}`}</div>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function renderResearch(): string {
  const s = S;
  let html = `<p style="margin-top:0;color:var(--muted)">研究点 Research: <b style="color:var(--accent)">${formatNumber(s.resources.research)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const t of TECH_LIST) {
    const level = techLevel(s, t.id);
    const infinite = isInfiniteTech(t.id);
    const maxed = techMaxed(s, t.id);
    const prereq = t.requires.every((r) => s.techs[r] > 0);
    const cost = techCost(s, t.id);
    const affordable = s.resources.research >= cost;
    const locked = level === 0 && !prereq;
    const cls = "tech-card" + (locked ? " locked" : "") + (infinite ? " repeatable" : "");
    const levelBadge = infinite && level > 0 ? `<span class="tlevel">Lv.${level}</span>` : "";
    let btn = "";
    if (maxed) btn = `<button disabled>✓ 已研究</button>`;
    else if (locked) btn = `<button disabled>🔒 前置未解锁</button>`;
    else {
      const label = infinite && level > 0 ? `升级到 Lv.${level + 1}` : "研究";
      btn = `<button class="primary" data-tech="${t.id}" ${affordable ? "" : "disabled"}>${label} (${formatNumber(cost)} RP)</button>`;
    }
    html += `
      <div class="${cls}">
        <div class="branch">${t.branch}</div>
        <div class="tname">${t.icon} ${t.name} ${levelBadge}</div>
        <div class="tdesc">${t.description}</div>
        ${btn}
      </div>`;
  }
  html += `</div>`;
  return html;
}

function renderAutomation(): string {
  const s = S;
  let html = "";
  // Auto-sell
  html += `<h3 style="color:var(--accent)">自动出售 Auto-Sell</h3>`;
  if (!s.flags.autoSellUnlocked) {
    html += `<p class="hint">🔒 需要科技「自动交易 Automated Trading」或永久升级「自动物流」。</p>`;
  } else {
    html += `<div class="grid-cards">`;
    for (const res of ["ore", "steel", "components"] as SellableResource[]) {
      const on = s.autoSell[res];
      html += `<div class="up-card">
        <div class="uname">${res}</div>
        <div class="udesc">自动出售超过储备的多余${res === "ore" ? "铁矿" : res === "steel" ? "钢材" : "零件"}。</div>
        <button class="toggle ${on ? "on" : ""}" data-autosell="${res}">${on ? "✓ 已开启" : "关闭"}</button>
      </div>`;
    }
    html += `</div>`;
  }
  // Auto-buy
  html += `<h3 style="color:var(--accent);margin-top:18px">自动购买 Auto-Buy</h3>`;
  if (!s.flags.autoBuyUnlocked) {
    html += `<p class="hint">🔒 需要科技「自动采购 Auto-Buy Logic」。</p>`;
  } else {
    html += `<p class="hint">当 Credits 超过该建筑当前价格的 1.5 倍时，自动购买（每帧最多 5 台）。</p>`;
    html += `<div class="grid-cards">`;
    for (const b of BUILDING_LIST) {
      const on = s.autoBuy[b.id];
      const unlocked = buildingUnlocked(s, b.id);
      html += `<div class="up-card">
        <div class="uname">${b.icon} ${b.name}</div>
        <div class="udesc">当前 ${formatNumber(s.buildings[b.id])} 台</div>
        <button class="toggle ${on ? "on" : ""}" data-autobuy="${b.id}" ${unlocked ? "" : "disabled"}>${on ? "✓ 已开启" : "关闭"}</button>
      </div>`;
    }
    html += `</div>`;
  }
  // Auto-research
  html += `<h3 style="color:var(--accent);margin-top:18px">自动科研 Auto-Research</h3>`;
  if (!s.flags.autoResearchUnlocked) {
    html += `<p class="hint">🔒 需要科技「自动科研 Automated Research」。</p>`;
  } else {
    const on = s.autoResearch;
    html += `<div class="up-card">
      <div class="uname">🤖 自动购买科技</div>
      <div class="udesc">自动购买可负担的科技：优先"解锁型"，其次最便宜的"无限升级"。</div>
      <button class="toggle ${on ? "on" : ""}" data-autoresearch>${on ? "✓ 已开启" : "关闭"}</button>
    </div>`;
  }
  return html;
}

function renderPrestige(): string {
  const s = S;
  const gain = pendingCoreData(s);
  const can = canPrestige(s);
  let html = `<h3 style="color:var(--accent)">星球重构 / Stellar Reboot</h3>`;
  html += `<p>累计赚取 Credits: <b>${formatNumber(s.stats.lifetimeCredits)}</b>（阈值 ${formatNumber(PRESTIGE_THRESHOLD_CREDITS)}）</p>`;
  html += `<p>重构将重置：铁矿、钢材、零件、信用点、建筑、普通科技与研究。<br>保留：核心数据、永久升级、统计。</p>`;
  html += `<div class="modal" style="border:none;padding:0;max-width:none;background:none"><div class="body" style="margin:0">`;
  html += `<p>立即重构可获得：<b style="color:var(--accent-2);font-size:18px">${formatNumber(gain)} Core Data</b></p>`;
  const disabledLabel =
    s.stats.lifetimeCredits < PRESTIGE_THRESHOLD_CREDITS ? "未达阈值" : "暂无新收益";
  html += `<button class="big primary" id="btn-prestige" ${can ? "" : "disabled"}>${can ? "💠 执行重构 Reboot Now" : disabledLabel}</button>`;
  html += `</div></div>`;
  // Permanent upgrades
  html += `<h3 style="color:var(--accent);margin-top:20px">永久升级 Permanent Upgrades</h3>`;
  html += `<p class="hint">使用 Core Data 购买，跨轮保留。</p>`;
  html += `<p>当前持有 Core Data：<b style="color:var(--accent-2);font-size:18px">${formatNumber(s.coreData)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const u of UPGRADE_LIST) {
    const level = upgradeLevel(s, u.id);
    const infinite = isInfiniteUpgrade(u.id);
    const maxed = upgradeMaxed(s, u.id);
    const cost = upgradeCost(s, u.id);
    const affordable = s.coreData >= cost;
    const levelBadge = infinite && level > 0 ? `<span class="tlevel">Lv.${level}</span>` : "";
    let btn = "";
    if (maxed) btn = `<button disabled>✓ 已拥有</button>`;
    else {
      const label = infinite && level > 0 ? `升级到 Lv.${level + 1}` : "购买";
      btn = `<button class="primary" data-up="${u.id}" ${affordable ? "" : "disabled"}>${label} (${formatNumber(cost)} CD)</button>`;
    }
    html += `<div class="up-card">
      <div class="uname">${u.icon} ${u.name} ${levelBadge}</div>
      <div class="udesc">${u.description}</div>
      ${btn}
    </div>`;
  }
  html += `</div>`;
  return html;
}

function renderSettings(): string {
  const current = getNumberFormat();
  const options: { id: NumberFormat; title: string; desc: string }[] = [
    {
      id: "suffix",
      title: "后缀缩写 Suffix",
      desc: "K / M / B / T … Dc，超过 10³⁶ 回落科学计数。",
    },
    {
      id: "scientific",
      title: "科学计数法 Scientific",
      desc: "如 3.30e211（3 位有效数字）。",
    },
    {
      id: "engineering",
      title: "工程计数法 Engineering",
      desc: "指数为 3 的倍数，如 33.0e210。",
    },
  ];

  let html = `<h3 style="color:var(--accent)">设置 / Settings</h3>`;
  html += `<h4 style="margin:14px 0 6px">数字显示 Number Format</h4>`;
  html += `<p class="hint" style="margin-top:0">选择全站数字的显示方式（资源、成本、速率、诊断等）。</p>`;
  html += `<div class="grid-cards">`;
  for (const o of options) {
    const active = o.id === current;
    html += `<div class="up-card${active ? " selected" : ""}">
      <div class="uname">${o.title}${active ? " ✓" : ""}</div>
      <div class="udesc">${o.desc}</div>
      <button class="${active ? "" : "primary"}" data-numfmt="${o.id}" ${active ? "disabled" : ""}>${active ? "使用中" : "选择"}</button>
    </div>`;
  }
  html += `</div>`;

  // Live preview under the active format.
  html += `<h4 style="margin:16px 0 6px">预览 Preview</h4>`;
  html += `<div class="up-card">
    <div class="udesc">1,234,567 → <b>${formatNumber(1234567)}</b></div>
    <div class="udesc">3.3×10²¹¹ → <b>${formatNumber(3.3e211)}</b></div>
    <div class="udesc">42 → <b>${formatNumber(42)}</b></div>
  </div>`;

  // Animation intensity.
  const animLevel = getAnimationLevel();
  const animOptions: { id: AnimationLevel; title: string; desc: string }[] = [
    {
      id: "rich",
      title: "中等·生动 Rich",
      desc: "星球呼吸、流水线流动、数值脉冲与购买弹跳全开（随产量变化）。",
    },
    {
      id: "subtle",
      title: "克制 Subtle",
      desc: "保留静态星球与数值颜色提示，停掉闪烁、流动与脉冲。",
    },
    {
      id: "off",
      title: "关闭 Off",
      desc: "完全静止；仅保留数值颜色与统计信息。",
    },
  ];
  html += `<h4 style="margin:18px 0 6px">动画 Animation</h4>`;
  html += `<p class="hint" style="margin-top:0">控制界面动效强度，不影响任何游戏数值；系统"减少动态效果"优先。</p>`;
  html += `<div class="grid-cards">`;
  for (const o of animOptions) {
    const active = o.id === animLevel;
    html += `<div class="up-card${active ? " selected" : ""}">
      <div class="uname">${o.title}${active ? " ✓" : ""}</div>
      <div class="udesc">${o.desc}</div>
      <button class="${active ? "" : "primary"}" data-anim="${o.id}" ${active ? "disabled" : ""}>${active ? "使用中" : "选择"}</button>
    </div>`;
  }
  html += `</div>`;
  return html;
}

function renderStats(): string {
  const s = S;
  const runMs = Date.now() - s.stats.currentRunStart;
  const lines: [string, string][] = [
    ["本轮时长 Current Run", formatDuration(runMs)],
    ["累计游玩 Lifetime Play", formatDuration(s.stats.lifetimePlayTime)],
    ["累计铁矿 Total Ore", formatNumber(s.stats.totalOre)],
    ["累计钢材 Total Steel", formatNumber(s.stats.totalSteel)],
    ["累计零件 Total Components", formatNumber(s.stats.totalComponents)],
    ["累计信用 Lifetime Credits", formatNumber(s.stats.lifetimeCredits)],
    ["建筑购买 Buildings Bought", formatNumber(s.stats.buildingsPurchased)],
    ["重构次数 Prestige Count", formatNumber(s.stats.prestigeCount)],
    ["最佳 Credits/s Best", formatRate(s.stats.bestCreditsPerSec)],
    [
      "电力 Power",
      `${formatNumber(s.rates.powerSupply)} / ${formatNumber(s.rates.powerDemand)} · ${formatPercent(s.rates.powerFactor)}`,
    ],
    ["核心数据 Core Data", formatNumber(s.coreData)],
  ];
  let html = `<div style="max-width:560px">`;
  for (const [k, v] of lines) {
    html += `<div class="stat-line"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  }
  html += `</div>`;
  return html;
}

// ---------- Modals & toasts ----------

function openModal(inner: string): void {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal">${inner}</div>`;
  // Dismiss on "mousedown", not "click". Modals are opened from a delegated
  // "mousedown" handler on #app; the "click" that follows that same press can
  // land on the freshly-added backdrop (the original button node gets
  // re-rendered away in between) and would close the modal instantly. Keying
  // dismissal to the press itself — which must originate on the backdrop —
  // avoids that race entirely.
  backdrop.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if (t === backdrop || t.id === "btn-modal-close") closeModal();
  });
  document.body.appendChild(backdrop);
}

function closeModal(): void {
  const b = document.getElementById("modal-backdrop");
  if (b) b.remove();
}

function openExportModal(): void {
  const code = H.onExport();
  openModal(`
    <h3>导出存档 Export</h3>
    <div class="body">复制下面的文本以备份你的存档。</div>
    <textarea readonly id="exp-text">${code}</textarea>
    <div class="actions"><button id="btn-modal-close">关闭</button></div>`);
  const ta = document.getElementById("exp-text") as HTMLTextAreaElement;
  ta.focus();
  ta.select();
}

function openImportModal(): void {
  openModal(`
    <h3>导入存档 Import</h3>
    <div class="body">粘贴之前导出的存档文本，将覆盖当前进度。</div>
    <textarea id="imp-text" placeholder="粘贴存档..."></textarea>
    <div class="actions">
      <button id="btn-modal-close">取消</button>
      <button class="primary" id="btn-do-import">导入</button>
    </div>`);
  document.getElementById("btn-do-import")!.onclick = () => {
    const code = (document.getElementById("imp-text") as HTMLTextAreaElement).value;
    const ok = H.onImport(code);
    if (ok) closeModal();
    else alert("导入失败：存档格式无效。");
  };
}

function openResetModal(): void {
  openModal(`
    <h3 style="color:var(--danger)">重置存档 Reset</h3>
    <div class="body">这将<strong>永久删除</strong>当前所有进度（包括核心数据）。确定吗？</div>
    <div class="actions">
      <button id="btn-modal-close">取消</button>
      <button class="danger" id="btn-do-reset">确认重置</button>
    </div>`);
  document.getElementById("btn-do-reset")!.onclick = () => {
    H.onReset();
    closeModal();
  };
}

function confirmPrestige(): void {
  openModal(`
    <h3 style="color:var(--accent-2)">确认星球重构</h3>
    <div class="body">你将获得核心数据并重置当前轮进度。永久升级与统计保留。</div>
    <div class="actions">
      <button id="btn-modal-close">取消</button>
      <button class="primary" id="btn-prestige-confirm">确认重构</button>
    </div>`);
  // The modal lives under document.body, outside #app, so the delegated
  // #app handler never sees it — bind directly (same as reset/import).
  document.getElementById("btn-prestige-confirm")!.onclick = () => {
    H.onPrestige();
    closeModal();
  };
}

// ---------- Public API ----------

export function showOffline(elapsedMs: number, produced: { ore: number; steel: number; components: number; credits: number; research: number }): void {
  openModal(`
    <h3>欢迎回来 Welcome Back</h3>
    <div class="body">
      <p>离线时间 Offline: <b>${formatDuration(elapsedMs)}</b></p>
      <div class="line"><span>铁矿 Ore</span><span>+${formatNumber(produced.ore)}</span></div>
      <div class="line"><span>钢材 Steel</span><span>+${formatNumber(produced.steel)}</span></div>
      <div class="line"><span>零件 Components</span><span>+${formatNumber(produced.components)}</span></div>
      <div class="line"><span>信用 Credits</span><span>+${formatNumber(produced.credits)}</span></div>
      <div class="line"><span>研究 Research</span><span>+${formatNumber(produced.research)}</span></div>
    </div>
    <div class="actions"><button class="primary" id="btn-modal-close">好的</button></div>`);
}

export function toast(title: string, sub: string, type: "info" | "warn" = "info"): void {
  const wrap = document.getElementById("toasts")!;
  const el = document.createElement("div");
  el.className = "toast" + (type === "warn" ? " warn" : "");
  el.innerHTML = `<div class="t-title">${title}</div><div class="t-sub">${sub}</div>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export function render(state: GameState): void {
  S = state;
  updateLive();
  const now = performance.now();
  if (tabDirty || now - lastTabRender > 250) {
    renderTab();
    lastTabRender = now;
    tabDirty = false;
  }
}

export function setTab(tab: TabName): void {
  currentTab = tab;
  tabDirty = true;
}

export function start(handlers: Handlers): void {
  init(handlers);
}

// Visual feedback for a manual mine click: a floating "+N" near the button
// and a brief flash on the ore readout, so the click clearly registers.
export function feedbackMine(amount: number): void {
  const btn = document.getElementById("btn-mine");
  if (btn) {
    const rect = btn.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "float-num";
    f.textContent = `+${formatNumber(amount)} 铁矿`;
    f.style.left = `${rect.left + rect.width / 2}px`;
    f.style.top = `${rect.top}px`;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 800);
  }
  const oreRow = resRefs["ore"]?.val;
  if (oreRow) {
    oreRow.classList.remove("flash");
    void oreRow.offsetWidth; // restart animation
    oreRow.classList.add("flash");
    setTimeout(() => oreRow.classList.remove("flash"), 500);
  }
}

// Visual feedback for a successful building purchase: card pop + count bump.
export function feedbackPurchase(id: BuildingId): void {
  const ref = buildingRefs[id];
  if (!ref) return;
  ref.root.classList.remove("bought");
  void ref.root.offsetWidth; // restart animation
  ref.root.classList.add("bought");
  ref.count.classList.remove("bump");
  void ref.count.offsetWidth;
  ref.count.classList.add("bump");
  setTimeout(() => {
    ref.root.classList.remove("bought");
    ref.count.classList.remove("bump");
  }, 400);
}

// One-shot celebration on the planet scene (milestone reached / unlock).
export function celebrateScene(): void {
  const root = sceneRef;
  if (!root) return;
  root.classList.remove("celebrate");
  void root.offsetWidth;
  root.classList.add("celebrate");
  setTimeout(() => root.classList.remove("celebrate"), 950);
}

// Brief glow on a building card, e.g. when a new system unlocks.
export function highlightBuilding(id: BuildingId): void {
  const ref = buildingRefs[id];
  if (!ref) return;
  ref.root.classList.remove("unlocked");
  void ref.root.offsetWidth;
  ref.root.classList.add("unlocked");
  setTimeout(() => ref.root.classList.remove("unlocked"), 1250);
}
