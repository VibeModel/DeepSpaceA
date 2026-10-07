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
  upgradeCurrency,
} from "../game/upgrades";
import { MILESTONES, RESOURCE_IDS, SELLABLE_RESOURCES, STARGATE_INPUTS } from "../game/balance";
import { pendingCoreData, canPrestige } from "../game/prestige";
import { PRESTIGE_THRESHOLD_CPS } from "../game/balance";
import {
  stargateCost,
  stargateProgress,
  stargateModifiers,
  stargateTierName,
  nextStargateMilestone,
} from "../game/stargate";
import {
  STELLAR_UPGRADE_IDS,
  getStellarUpgrade,
  stellarLevel,
  stellarCost,
  stellarMaxed,
  isInfiniteStellar,
  canBuyStellarUpgrade,
} from "../game/stellar";
import { pendingCharts, canAscend } from "../game/ascension";
import { ASCENSION_THRESHOLD_CORE } from "../game/balance";
import { EVENTS } from "../game/balance";
import { eventProgress } from "../game/events";
import {
  contractsUnlocked,
  contractSlots,
  canDeliverContract,
  contractProgress,
} from "../game/contracts";
import {
  PLANET_LIST,
  getPlanet,
  getRegion,
  regionsForPlanet,
  regionLevel,
  regionMaxed,
  regionCost,
  canUpgradeRegion,
  planetUnlocked,
} from "../game/planets";
import {
  RECIPE_LIST,
  getRecipe,
  recipesForBuilding,
  isRecipeUnlocked,
  recipeAllocation,
} from "../game/recipes";
import type {
  Contract,
  GameState,
  BuildingId,
  BuildingDefinition,
  TechId,
  UpgradeId,
  UpgradeDefinition,
  SellableResource,
  LiveRates,
  PlanetId,
  PlanetModifiers,
  RegionId,
  RecipeId,
  RecipeOutputId,
  ResourceId,
  StellarUpgradeId,
} from "../game/types";
import { formatNumber, formatRate, formatDuration, formatPercent } from "./format";
import { getNumberFormat, getAnimationLevel, type NumberFormat, type AnimationLevel } from "./settings";
import {
  deriveVisualParams,
  toVisualInput,
  VISUAL,
  STAGE_IDS,
  type BuildingNodeVisual,
  type StageId,
} from "./visual";
import { ACHIEVEMENTS, achievementProgress } from "../game/achievements";

export type TabName =
  | "research"
  | "automation"
  | "contracts"
  | "stargate"
  | "prestige"
  | "planets"
  | "stats"
  | "achievements"
  | "settings";

export interface Handlers {
  onMine(): void;
  onSell(res: SellableResource): void;
  // Liquidate every sellable resource in one click.
  onSellAll(): void;
  onBuyBuilding(id: BuildingId): void;
  onBuyTech(id: TechId): void;
  onBuyUpgrade(id: UpgradeId): void;
  onToggleAutoSell(res: SellableResource): void;
  onToggleAutoBuy(id: BuildingId): void;
  onToggleAutoResearch(): void;
  onPrestige(dest: PlanetId): void;
  onSelectPlanet(id: PlanetId): void;
  onUpgradeRegion(id: RegionId): void;
  // Adjust a machine's recipe allocation: `delta` is added to that recipe's
  // weight (see recipes.ts). The building id comes from the clicked button.
  onSelectRecipe(bid: BuildingId, rid: RecipeId, delta: number): void;
  // Megastructure + second layer.
  onBuildStargate(): void;
  onAscend(): void;
  onBuyStellarUpgrade(id: StellarUpgradeId): void;
  // Contracts (manual delivery orders).
  onAcceptContract(id: number): void;
  onDeliverContract(id: number): void;
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
// Per-building orbital nodes (one per BuildingId, in BUILDING_LIST order) and
// the convoy ship pool. Both are created once and only toggled afterwards.
let nodeRefs: {
  id: BuildingId;
  el: HTMLElement;
  count: HTMLElement;
  towers: HTMLElement[];
  lastOwned: number;
  lastTowers: number;
}[] = [];
let convoyRefs: HTMLElement[] = [];
const VISUAL_INTERVAL = 180;
let lastVisual = 0;
let lastDotCount = -1;
let lastConvoy = -1;
// Latest per-building visual params, cached so the (more frequent) live-panel
// pass can reuse the same derived pulse without recomputing them.
let nodeParams: BuildingNodeVisual[] = [];

// Cached element references for the high-frequency live panels.
const buildingRefs: Record<string, {
  root: HTMLElement;
  count: HTMLElement;
  cost: HTMLElement;
  buy: HTMLButtonElement;
  milestone: HTMLElement;
  utilWrap?: HTMLElement;
  utilBar?: HTMLElement;
  mix?: HTMLElement;
  recipeRows?: { id: RecipeId; row: HTMLElement; count: HTMLElement }[];
}> = {};
const resRefs: Record<string, { row: HTMLElement; val: HTMLElement; delta: HTMLElement }> = {};
const liveStatRefs: Record<string, { row: HTMLElement; val: HTMLElement }> = {};
const stageRefs: Partial<Record<StageId, {
  root: HTMLElement;
  rate: HTMLElement;
  sub: HTMLElement;
  warn: HTMLElement;
  arrow?: HTMLElement;
  utilBar?: HTMLElement;
  input?: HTMLElement;
  cap?: HTMLElement;
  utilText?: HTMLElement;
  eff?: HTMLElement;
  recipeId?: RecipeId;
  machine?: BuildingId;
}>> = {};

// Power panel refs (supply / demand / percentage / bar).
const powerRefs: {
  row?: HTMLElement;
  supply?: HTMLElement;
  demand?: HTMLElement;
  pct?: HTMLElement;
  bar?: HTMLElement;
} = {};

// Region hotspots overlaid on the space scene. Rebuilt only when the planet
// changes; their labels/classes are refreshed cheaply every tick.
const REGION_POS: Record<RegionId, [number, number]> = {
  miningField: [23, 70],
  foundry: [38, 26],
  powerGrid: [65, 30],
  researchPark: [78, 66],
  logisticsHub: [50, 86],
};
let hotspotRefs: { id: RegionId; el: HTMLButtonElement; label: HTMLElement }[] = [];
let lastHotspotPlanet: PlanetId | null = null;

// Chinese labels for the model modifier keys (used in planet cards).
const MOD_LABELS: Record<keyof PlanetModifiers, string> = {
  miningMult: "采矿",
  smeltMult: "熔炼",
  factoryMult: "制造",
  researchMult: "研究",
  steelYieldMult: "钢材产出",
  componentYieldMult: "零件产出",
  globalProdMult: "全局产量",
  powerSupplyMult: "供电",
  costMult: "建筑成本",
  prestigeGainMult: "重构收益",
};

// Long labels for resource rows, and short ones for inline (chain) readouts.
const RESOURCE_LABELS: Record<ResourceId, string> = {
  ore: "铁矿 Ore",
  steel: "钢材 Steel",
  components: "零件 Components",
  credits: "信用点 Credits",
  research: "研究点 Research",
  copperOre: "铜矿 Copper Ore",
  copper: "铜材 Copper",
  circuit: "电路板 Circuit",
  alloy: "合金 Alloy",
};
const SHORT_LABEL: Record<RecipeOutputId, string> = {
  ore: "铁矿",
  steel: "钢材",
  components: "零件",
  credits: "信用点",
  research: "研究点",
  copperOre: "铜矿",
  copper: "铜材",
  circuit: "电路板",
  alloy: "合金",
  blueprints: "蓝图",
};
function shortName(name: string): string {
  return name.split(" / ")[0];
}
// Derived from the canonical BUILDINGS names (balance.ts) — never hand-copy
// a second name table here, or the UI drifts from the game data.
const BUILDING_SHORT: Record<BuildingId, string> = Object.fromEntries(
  BUILDING_LIST.map((b) => [b.id, shortName(b.name)]),
) as Record<BuildingId, string>;

// Which output id a stage's throughput is read from (mirrors visual.ts).
const STAGE_OUTPUT: Record<StageId, RecipeOutputId> = {
  mining: "ore",
  copperMining: "copperOre",
  smeltSteel: "steel",
  smeltCopper: "copper",
  makeComponents: "components",
  makeCircuit: "circuit",
  makeAlloy: "alloy",
  synthesizeBlueprint: "blueprints",
  research: "research",
};

// A resource (or the blueprint currency) is shown once the chain that produces
// it has been touched, so a fresh game is not cluttered with zeros.
function chainVisible(s: GameState, id: RecipeOutputId): boolean {
  const t = s.techs;
  switch (id) {
    case "ore":
    case "steel":
    case "components":
    case "credits":
    case "research":
      return true;
    case "copperOre":
      return s.buildings.copperMine > 0 || (t.copperProcessing ?? 0) > 0;
    case "copper":
      return (t.copperProcessing ?? 0) > 0;
    case "circuit":
      return (t.circuitFabrication ?? 0) > 0;
    case "alloy":
      return (t.alloySynthesis ?? 0) > 0;
    case "blueprints":
      return (t.alloySynthesis ?? 0) > 0 || s.blueprints > 0;
  }
}

// Rows of the live statistics panel, in display order.
const LIVE_STAT_DEFS: { key: RecipeOutputId | "runtime"; label: string }[] = [
  { key: "runtime", label: "本轮时长 Run Time" },
  { key: "ore", label: "Ore /s" },
  { key: "steel", label: "Steel /s" },
  { key: "components", label: "Components /s" },
  { key: "copperOre", label: "Copper Ore /s" },
  { key: "copper", label: "Copper /s" },
  { key: "circuit", label: "Circuit /s" },
  { key: "alloy", label: "Alloy /s" },
  { key: "blueprints", label: "Blueprints /s" },
  { key: "credits", label: "Credits /s" },
  { key: "research", label: "Research /s" },
];

const TOPBAR = () => `
  <div class="topbar">
    <h1>深空自动化局<small>DEEP SPACE AUTOMATION</small></h1>
    <div class="top-readouts">
      <div class="readout"><div class="label">Credits</div><div class="value accent" id="r-credits">0</div></div>
      <div class="readout"><div class="label">Core Data</div><div class="value core" id="r-core">0</div></div>
      <div class="readout" id="r-bp-wrap" style="display:none"><div class="label">Blueprints</div><div class="value bp" id="r-blueprints">0</div></div>
      <div class="readout" id="r-charts-wrap" style="display:none"><div class="label">Charts</div><div class="value" id="r-charts">0</div></div>
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
        <button data-debug="unlockChain">解锁铜链配方</button>
        <button data-debug="unlockPrestige">解锁 Prestige</button>
        <button data-debug="unlockPlanets">解锁所有星球</button>
        <button data-debug="unlockAscend">解锁升华</button>
        <button data-debug="stargate">星门 +1</button>
        <button data-debug="event">触发随机事件</button>
        <button data-debug="contract">生成合同</button>
        <button class="danger" data-debug="wipe">清空存档</button>
      </div>
      <div class="hint">调试工具仅用于快速验证后期内容，生产构建默认隐藏（开发版可见）。</div>
    </details>`
  : "";

// Keyboard shortcuts:
//   Q                 = manual mine
//   A S D F G H J     = buy buildings in BUILDING_ORDER
//   W E R T Y U       = sell in SELLABLE_RESOURCES order
//   X                 = sell EVERY sellable resource at once
export const MINE_KEY = "Q";
export const SELL_ALL_KEY = "X";
const BUILDING_KEYS: BuildingId[] = BUILDING_LIST.map((b) => b.id);
const BUY_KEY_CHARS = ["A", "S", "D", "F", "G", "H", "J"];
const SELL_KEY_CHARS = ["W", "E", "R", "T", "Y", "U"];
const SELL_KEYS: Record<SellableResource, string> = Object.fromEntries(
  SELLABLE_RESOURCES.map((res, i) => [res, SELL_KEY_CHARS[i]]),
) as Record<SellableResource, string>;

export type KeyBinding =
  | { type: "mine" }
  | { type: "buy"; id: BuildingId }
  | { type: "sell"; res: SellableResource }
  | { type: "sellAll" };

// Built from the same key list as the cards, so a new building can never miss a
// shortcut (or collide with a sell key).
export const KEY_BINDINGS: Record<string, KeyBinding> = (() => {
  const out: Record<string, KeyBinding> = { [MINE_KEY.toLowerCase()]: { type: "mine" } };
  BUILDING_KEYS.forEach((id, i) => {
    out[BUY_KEY_CHARS[i].toLowerCase()] = { type: "buy", id };
  });
  for (const res of SELLABLE_RESOURCES) {
    out[SELL_KEYS[res].toLowerCase()] = { type: "sell", res };
  }
  out[SELL_ALL_KEY.toLowerCase()] = { type: "sellAll" };
  return out;
})();

export function keyForBuilding(id: BuildingId): string {
  const i = BUILDING_KEYS.indexOf(id);
  return i >= 0 ? BUY_KEY_CHARS[i] : "";
}

export function keyForSell(res: SellableResource): string {
  return SELL_KEYS[res];
}

// Human-readable input → output line for a recipe row.
function recipeIOText(rid: RecipeId): string {
  const rec = getRecipe(rid);
  const ins = rec.inputs.map((i) => `${SHORT_LABEL[i.res]}×${i.amount}`).join(" + ");
  const out = `${SHORT_LABEL[rec.output]}${rec.outputAmount > 1 ? `×${rec.outputAmount}` : ""}`;
  return `${ins} → ${out}`;
}

function buildingCardHTML(b: BuildingDefinition): string {
  const recipes = recipesForBuilding(b.id);
  const mix = recipes.length > 0 ? `<div class="recipe-mix" data-ref="mix"></div>` : "";
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
    ${mix}
    <div class="row">
      <span class="cost" data-ref="cost">—</span>
      <button class="primary" data-ref="buy">购买 <kbd>${keyForBuilding(b.id)}</kbd></button>
    </div>
    <div class="milestone" data-ref="milestone"></div>
  </div>`;
}

// Short label for the title of a FLOW stage.
function stageTitle(id: StageId): string {
  switch (id) {
    case "mining":
      return "⛏ 铁矿采集 Ore Mining";
    case "copperMining":
      return "🔶 铜矿采集 Copper Mining";
    case "research":
      return "🔬 科研 Research";
    default: {
      const rec = getRecipe(id);
      return `${rec.icon} ${BUILDING_SHORT[rec.machine]} · ${shortName(rec.name)}`;
    }
  }
}

function stageVisible(s: GameState, id: StageId): boolean {
  if (id === "mining" || id === "research") return true;
  if (id === "copperMining") return s.buildings.copperMine > 0;
  const rec = getRecipe(id);
  return isRecipeUnlocked(s, rec.id) && s.buildings[rec.machine] > 0;
}

function stageRate(r: LiveRates, id: StageId): number {
  const out = STAGE_OUTPUT[id];
  if (out === "blueprints") return r.net.blueprints ?? 0;
  return r.production[out] ?? 0;
}

// Total primary-input capacity of every recipe consuming `res` (i.e. how much
// downstream machinery could consume per second).
function downstreamDemand(r: LiveRates, res: ResourceId): number {
  let total = 0;
  for (const rec of RECIPE_LIST) {
    if (rec.inputs[0]?.res === res) total += r.processors[rec.id]?.cap ?? 0;
  }
  return total;
}

function allocOf(s: GameState, bid: BuildingId, rid: RecipeId): number {
  const a = recipeAllocation(s, bid).find((x) => x.recipe.id === rid);
  return a ? a.count : 0;
}

// Aggregated utilisation across all recipes assigned to a processor building.
function aggregateUtil(r: LiveRates, bid: BuildingId): number | null {
  let capB = 0;
  let thru = 0;
  let any = false;
  for (const rec of recipesForBuilding(bid)) {
    const pr = r.processors[rec.id];
    if (!pr) continue;
    capB += pr.capBatches;
    thru += pr.throughput;
    if (pr.capBatches > 0) any = true;
  }
  if (!any) return null;
  return capB > 0 ? thru / capB : 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Machine count for a recipe badge (one decimal only for fractional splits).
function allocCountText(c: number): string {
  if (c <= 0) return "0";
  if (c < 1000 && Math.abs(c - Math.round(c)) > 1e-6) return c.toFixed(1);
  return formatNumber(Math.round(c));
}

function init(handlers: Handlers): void {
  H = handlers;
  const app = document.getElementById("app")!;
  app.innerHTML = `
    ${TOPBAR()}
    <div class="event-bar" id="event-bar"></div>
    <div class="main-grid">
      <section class="panel" id="panel-buildings">
        <h2>BUILDINGS</h2>
        <div class="manual">
          <button class="big primary" id="btn-mine">⛏ 手动采矿 (+1 铁矿) <kbd>${MINE_KEY}</kbd></button>
        </div>
        <div class="manual sell-grid">
          ${SELLABLE_RESOURCES.map(
            (res) =>
              `<button data-sell="${res}">出售 ${SHORT_LABEL[res]} <kbd>${keyForSell(res)}</kbd></button>`,
          ).join("")}
        </div>
        <div class="manual">
          <button class="primary" data-sell-all>💰 一键出售全部（清空库存） <kbd>${SELL_ALL_KEY}</kbd></button>
        </div>
        <div id="buildings-list"></div>
      </section>

      <div class="main-col">
      <section class="panel" id="panel-production">
        <h2>PRODUCTION</h2>
        <div class="space-scene" id="space-scene" data-strain="0" data-industry="0" data-ring="0">
          <div class="space-stars" aria-hidden="true"></div>
          <div class="planet-system" aria-hidden="true">
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
            <div class="convoy-layer" id="convoy-layer" aria-hidden="true"></div>
          </div>
          <div class="region-hotspots" id="region-hotspots"></div>
        </div>
        <div class="colony-belt" id="colony-belt"></div>
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
    </div>

    <div class="tabbar" id="tabbar">
      <button data-tab="research">🔬 科研 Research</button>
      <button data-tab="automation">🤖 自动化 Automation</button>
      <button data-tab="contracts">📜 合同 Contracts</button>
      <button data-tab="stargate">🌀 星门 Stargate</button>
      <button data-tab="prestige">💠 重构 Prestige</button>
      <button data-tab="planets">🪐 星球 Planets</button>
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

  // Build building cards (plus per-machine recipe allocation rows).
  const list = document.getElementById("buildings-list")!;
  for (const b of BUILDING_LIST) {
    const wrap = document.createElement("div");
    wrap.innerHTML = buildingCardHTML(b);
    const root = wrap.firstElementChild as HTMLElement;
    list.appendChild(root);
    const mix = root.querySelector('[data-ref="mix"]') as HTMLElement | null;
    let recipeRows: { id: RecipeId; row: HTMLElement; count: HTMLElement }[] | undefined;
    if (mix) {
      recipeRows = [];
      for (const rec of recipesForBuilding(b.id)) {
        const row = document.createElement("div");
        row.className = "recipe-row";
        row.dataset.recipeRow = rec.id;
        row.title = rec.description;
        row.innerHTML = `
          <span class="r-icon">${rec.icon}</span>
          <span class="r-body"><span class="r-name">${shortName(rec.name)}</span><span class="r-io">${recipeIOText(rec.id)}</span></span>
          <span class="r-ctrl">
            <button data-recipe="${rec.id}" data-machine="${b.id}" data-delta="-1">−</button>
            <span class="r-count" data-rcount>0</span>
            <button data-recipe="${rec.id}" data-machine="${b.id}" data-delta="1">+</button>
          </span>`;
        mix.appendChild(row);
        recipeRows.push({ id: rec.id, row, count: row.querySelector("[data-rcount]")! });
      }
    }
    buildingRefs[b.id] = {
      root,
      count: root.querySelector('[data-ref="count"]')!,
      cost: root.querySelector('[data-ref="cost"]')!,
      buy: root.querySelector('[data-ref="buy"]')!,
      milestone: root.querySelector('[data-ref="milestone"]')!,
      utilWrap: root.querySelector('[data-ref="utilWrap"]') as HTMLElement,
      utilBar: root.querySelector('[data-ref="utilBar"]') as HTMLElement,
      mix: mix ?? undefined,
      recipeRows,
    };
  }

  // Resource readouts (one row per resource; chain rows start hidden).
  const rr = document.getElementById("resource-readouts")!;
  for (const id of RESOURCE_IDS) {
    const row = document.createElement("div");
    row.className = "resource-row";
    row.innerHTML = `<span class="name">${RESOURCE_LABELS[id]}</span><span><span class="val" data-v></span> <span class="delta" data-d></span></span>`;
    rr.appendChild(row);
    resRefs[id] = {
      row,
      val: row.querySelector("[data-v]")!,
      delta: row.querySelector("[data-d]")!,
    };
  }

  // Flow stages: one per producer + one per recipe + research, in STAGE_IDS
  // order. All are pre-created once; updateLive only toggles visibility.
  const flow = document.getElementById("flow")!;
  for (const id of STAGE_IDS) {
    const rec = (() => {
      switch (id) {
        case "mining":
        case "copperMining":
        case "research":
          return null;
        default:
          return getRecipe(id);
      }
    })();
    const hasMetrics = rec !== null && rec.inputs.length >= 1;
    const div = document.createElement("div");
    div.className = "flow-stage";
    div.innerHTML = `
      <span class="icon">${id === "mining" ? "⛏" : id === "copperMining" ? "🔶" : id === "research" ? "🔬" : rec!.icon}</span>
      <div class="info"><div class="title">${stageTitle(id)}</div><div class="sub" data-sub></div></div>
      <div class="rate"><div class="v" data-rate>0/s</div></div>
      ${hasMetrics ? `<div class="bar" data-util style="width:120px"><span></span></div>` : ""}
      ${hasMetrics ? `<div class="metrics" data-metrics>
        <div class="m-row"><span class="m-k">输入</span><span class="m-v" data-min>—</span><span class="m-k">产能</span><span class="m-v" data-mcap>—</span></div>
        <div class="m-row"><span class="m-k">利用率</span><span class="m-v" data-mutil>—</span><span class="m-k">效率</span><span class="m-v" data-meff>—</span></div>
      </div>` : ""}
    `;
    flow.appendChild(div);
    const el: (typeof stageRefs)[StageId] = {
      root: div,
      rate: div.querySelector("[data-rate]")!,
      sub: div.querySelector("[data-sub]")!,
      warn: document.createElement("div"),
      utilBar: hasMetrics ? (div.querySelector("[data-util] span") as HTMLElement) : undefined,
      input: hasMetrics ? (div.querySelector("[data-min]") as HTMLElement) : undefined,
      cap: hasMetrics ? (div.querySelector("[data-mcap]") as HTMLElement) : undefined,
      utilText: hasMetrics ? (div.querySelector("[data-mutil]") as HTMLElement) : undefined,
      eff: hasMetrics ? (div.querySelector("[data-meff]") as HTMLElement) : undefined,
      recipeId: rec ? rec.id : undefined,
      machine: rec ? rec.machine : undefined,
    };
    el.warn.style.display = "none";
    flow.appendChild(el.warn);
    // Arrow belongs to the stage *above* it (hidden together with that stage).
    if (id !== "research") {
      const arrow = document.createElement("div");
      arrow.className = "flow-arrow";
      arrow.textContent = "↓";
      flow.appendChild(arrow);
      el.arrow = arrow;
    }
    stageRefs[id] = el;
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

  // Colony belt: one skyline cluster per building type. Layout lives here;
  // height / tower count / glow / pulse all come from visual.ts.
  const belt = document.getElementById("colony-belt")!;
  nodeRefs = [];
  BUILDING_LIST.forEach((def, i) => {
    const el = document.createElement("div");
    el.className = "colony-cluster";
    el.dataset.bid = def.id;
    el.style.setProperty("--node-delay", `${(-i * 0.41).toFixed(2)}s`);
    let towers = "";
    for (let t = 0; t < VISUAL.towerPool; t++) {
      towers += `<span class="cc-tower" data-tower="${t}"></span>`;
    }
    el.innerHTML = `
      <div class="cc-sky" data-sky>${towers}</div>
      <div class="cc-meta">
        <span class="cc-icon">${def.icon}</span>
        <span class="cc-count" data-ncount>0</span>
      </div>`;
    belt.appendChild(el);
    nodeRefs.push({
      id: def.id,
      el,
      count: el.querySelector("[data-ncount]") as HTMLElement,
      towers: [...el.querySelectorAll<HTMLElement>(".cc-tower")],
      lastOwned: -1,
      lastTowers: -1,
    });
  });

  // Convoy ships: a fixed pool travelling the orbital lanes.
  const convoyLayer = document.getElementById("convoy-layer")!;
  convoyRefs = [];
  for (let i = 0; i < VISUAL.convoyPool; i++) {
    const ship = document.createElement("span");
    ship.className = "convoy";
    const radius = VISUAL.convoyRadii[i % VISUAL.convoyRadii.length];
    ship.style.setProperty("--convoy-r", `${radius}px`);
    ship.style.setProperty("--convoy-delay", `${(-i * 1.9).toFixed(2)}s`);
    ship.innerHTML = `<span class="ship"></span>`;
    convoyLayer.appendChild(ship);
    convoyRefs.push(ship);
  }

  // Apply the persisted animation intensity to the document root.
  document.documentElement.dataset.anim = getAnimationLevel();

  // Power panel refs.
  powerRefs.row = document.getElementById("power-row") ?? undefined;
  powerRefs.supply = document.getElementById("p-supply") ?? undefined;
  powerRefs.demand = document.getElementById("p-demand") ?? undefined;
  powerRefs.pct = document.getElementById("p-pct") ?? undefined;
  powerRefs.bar = document.getElementById("p-bar") ?? undefined;

  // Live stats panel (chain rows start hidden).
  const ls = document.getElementById("live-stats")!;
  ls.innerHTML = "";
  for (const def of LIVE_STAT_DEFS) {
    const line = document.createElement("div");
    line.className = "stat-line";
    line.innerHTML = `<span class="k">${def.label}</span><span class="v" data-v>0</span>`;
    ls.appendChild(line);
    liveStatRefs[def.key] = { row: line, val: line.querySelector("[data-v]")! };
  }

  // Wire delegated events.
  // Use "mousedown" (not "click") so that rapid re-renders of the tab panels
  // (which rebuild innerHTML) cannot drop a click whose mouseup lands on a
  // freshly-replaced node. mousedown fires on press, before any re-render.
  app.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    // Planet / region actions. `data-planet` is restricted to <button> for the
    // same reason `data-anim` is (a bare attribute selector can match a wrapper
    // element — or <html> — and swallow every later branch).
    const rBtn = t.closest("[data-region]");
    if (rBtn) {
      H.onUpgradeRegion((rBtn as HTMLElement).dataset.region as RegionId);
      tabDirty = true; // refresh the planets tab immediately
      return;
    }
    const pBtn = t.closest("button[data-planet]");
    if (pBtn) {
      H.onSelectPlanet((pBtn as HTMLElement).dataset.planet as PlanetId);
      tabDirty = true;
      return;
    }
    // Sell-all first: `[data-sell]` would not match it (attribute selectors are
    // exact), but keeping the order explicit avoids surprises for readers.
    const sellAll = t.closest("button[data-sell-all]");
    if (sellAll) {
      H.onSellAll();
      return;
    }
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
    // Recipe allocation −/+ buttons. Must be a <button> so the bare attribute
    // cannot match a wrapper; checked before the tab branch.
    const recBtn = t.closest("button[data-recipe]");
    if (recBtn) {
      const el = recBtn as HTMLElement;
      H.onSelectRecipe(
        el.dataset.machine as BuildingId,
        el.dataset.recipe as RecipeId,
        Number(el.dataset.delta),
      );
      return;
    }
    // Megastructure + second layer. All restricted to <button> and checked
    // before the tab branch so the bare selectors cannot swallow later ones.
    const sgBtn = t.closest("button[data-stargate]");
    if (sgBtn) {
      H.onBuildStargate();
      tabDirty = true;
      return;
    }
    // Contracts: accept an offer / hand in an active order.
    const accBtn = t.closest("button[data-accept]");
    if (accBtn) {
      H.onAcceptContract(Number((accBtn as HTMLElement).dataset.accept));
      tabDirty = true;
      return;
    }
    const delBtn = t.closest("button[data-deliver]");
    if (delBtn) {
      H.onDeliverContract(Number((delBtn as HTMLElement).dataset.deliver));
      tabDirty = true;
      return;
    }
    const ascBtn = t.closest("button[data-ascend]");
    if (ascBtn) {
      confirmAscend();
      return;
    }
    const supBtn = t.closest("button[data-sup]");
    if (supBtn) {
      H.onBuyStellarUpgrade((supBtn as HTMLElement).dataset.sup as StellarUpgradeId);
      tabDirty = true;
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

  updateEventBar();

  const credEl = document.getElementById("r-credits");
  if (credEl) credEl.textContent = formatNumber(s.resources.credits);
  const coreEl = document.getElementById("r-core");
  if (coreEl) coreEl.textContent = formatNumber(s.coreData);
  const resTopEl = document.getElementById("r-research-top");
  if (resTopEl) resTopEl.textContent = formatNumber(s.resources.research);
  const bpWrap = document.getElementById("r-bp-wrap");
  if (bpWrap) {
    const show = chainVisible(s, "blueprints");
    bpWrap.style.display = show ? "" : "none";
    if (show) {
      const el = document.getElementById("r-blueprints");
      if (el) el.textContent = formatNumber(s.blueprints);
    }
  }
  // Stellar charts only appear once the player has ascended at least once.
  const chWrap = document.getElementById("r-charts-wrap");
  if (chWrap) {
    const show = s.ascensionCount > 0 || s.stellarCharts > 0;
    chWrap.style.display = show ? "" : "none";
    if (show) {
      const el = document.getElementById("r-charts");
      if (el) el.textContent = formatNumber(s.stellarCharts);
    }
  }

  // Resources.
  for (const id of RESOURCE_IDS) {
    const ref = resRefs[id];
    if (!ref) continue;
    const show = chainVisible(s, id);
    ref.row.style.display = show ? "" : "none";
    if (!show) continue;
    ref.val.textContent = formatNumber(s.resources[id]);
    const net = r.net[id] ?? 0;
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

    // Recipe allocation rows (processors only).
    if (ref.recipeRows) {
      for (const row of ref.recipeRows) {
        const recUnlocked = isRecipeUnlocked(s, row.id);
        const show = unlocked && recUnlocked;
        row.row.style.display = show ? "" : "none";
        if (show) row.count.textContent = allocCountText(allocOf(s, b.id, row.id));
      }
      if (ref.mix) ref.mix.style.display = unlocked ? "" : "none";
    }

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

    // Utilization bar for processors / lab.
    if (ref.utilWrap && ref.utilBar) {
      let util = 0;
      let show = true;
      if (b.id === "laboratory") {
        util = r.labActive ? 1 : 0;
      } else if (b.category === "processor") {
        const agg = aggregateUtil(r, b.id);
        if (agg === null || owned <= 0) show = false;
        else util = agg;
      } else {
        show = false;
      }
      if (show && owned > 0) {
        ref.utilWrap.style.display = "";
        const pct = Math.round(clamp01(util) * 100);
        ref.utilBar.firstElementChild!.setAttribute("style", `width:${pct}%`);
        ref.utilBar.className = "bar" + (util < 0.99 ? " warn" : " full");
      } else {
        ref.utilWrap.style.display = "none";
      }
    }

    // "Working" pulse: the card breathes while this building actually
    // contributes, and the pulse speeds up with the owned count (same curve as
    // the orbital node), so the animation literally reflects how many you own.
    let busyRate = 0;
    if (b.category === "power") busyRate = owned * (b.baseSupply ?? 0);
    else if (b.category === "producer") busyRate = r.production[b.produces!] ?? 0;
    else if (b.id === "laboratory") busyRate = r.labActive ? r.production.research ?? 0 : 0;
    else {
      for (const rec of recipesForBuilding(b.id)) {
        busyRate += r.processors[rec.id]?.throughput ?? 0;
      }
    }
    const busy = owned > 0 && busyRate > 0;
    const busyFlag = busy ? "1" : "0";
    if (ref.root.dataset.busy !== busyFlag) ref.root.dataset.busy = busyFlag;
    const node = nodeParams.find((n) => n.id === b.id);
    if (node) ref.root.style.setProperty("--pulse-dur", `${node.pulseDur.toFixed(2)}s`);
  }

  // Flow stages.
  for (const id of STAGE_IDS) {
    const ref = stageRefs[id];
    if (!ref) continue;
    const visible = stageVisible(s, id);
    ref.root.style.display = visible ? "" : "none";
    if (ref.arrow) ref.arrow.style.display = visible ? "" : "none";
    if (!visible) {
      ref.warn.style.display = "none";
      continue;
    }
    ref.rate.textContent = formatRate(stageRate(r, id));

    // Utilisation bar + bottleneck warning for processor stages.
    let primaryRes: ResourceId | null = null;
    if (ref.recipeId) {
      const pr = r.processors[ref.recipeId];
      primaryRes = getRecipe(ref.recipeId).inputs[0].res;
      if (ref.utilBar && pr) {
        const util = clamp01(pr.util);
        ref.utilBar.setAttribute("style", `width:${Math.round(util * 100)}%`);
        ref.utilBar.parentElement!.className = "bar" + (util < 0.99 ? " warn" : " full");
      }
      const showWarn =
        s.flags.analyticsUnlocked && pr !== undefined && (pr.shortage || pr.accumulating);
      if (showWarn && pr) {
        ref.warn.style.display = "";
        ref.warn.className = pr.shortage ? "warn-line" : "accum-line";
        ref.warn.textContent = pr.shortage
          ? `⚠ ${SHORT_LABEL[primaryRes]} 短缺 — 上游产能不足`
          : `⚠ ${SHORT_LABEL[primaryRes]} 积压 — 下游产能不足`;
      } else {
        ref.warn.style.display = "none";
      }
    } else {
      ref.warn.style.display = "none";
    }

    setStageSub(id, r, s);
    setStageMetrics(id, r);
  }

  // Power grid readout.
  updatePowerRow(r);

  // Planet-scene region hotspots (labels + affordability).
  updateHotspots();

  // Live stats.
  for (const def of LIVE_STAT_DEFS) {
    const ref = liveStatRefs[def.key];
    if (!ref) continue;
    const show = def.key === "runtime" || chainVisible(s, def.key);
    ref.row.style.display = show ? "" : "none";
    if (!show) continue;
    if (def.key === "runtime") {
      ref.val.textContent = formatDuration(Date.now() - s.stats.currentRunStart);
    } else if (def.key === "blueprints") {
      ref.val.textContent = formatRate(r.net.blueprints ?? 0);
    } else {
      ref.val.textContent = formatRate(r.production[def.key] ?? 0);
    }
  }

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

  // Per-building nodes: size / glow / pulse speed all follow the owned count.
  nodeParams = p.nodes;
  for (const ref of nodeRefs) {
    const n = p.nodes.find((x) => x.id === ref.id);
    if (!n) continue;
    const el = ref.el;
    el.style.setProperty("--tower-h", `${n.height.toFixed(1)}px`);
    el.style.setProperty("--node-glow", n.glow.toFixed(3));
    el.style.setProperty("--node-pulse-dur", `${n.pulseDur.toFixed(2)}s`);
    // Tower count grows with the milestone tier reached.
    if (n.towers !== ref.lastTowers) {
      for (let i = 0; i < ref.towers.length; i++) {
        ref.towers[i].classList.toggle("on", i < n.towers);
      }
      ref.lastTowers = n.towers;
    }
    // Only touch text/class when the owned count actually changed.
    if (n.owned !== ref.lastOwned) {
      ref.count.textContent = formatNumber(n.owned);
      el.classList.toggle("on", n.visible);
      ref.lastOwned = n.owned;
    }
  }

  // Convoy lanes: the pool is fixed, only visibility and speed change.
  if (p.convoy !== lastConvoy) {
    for (let i = 0; i < convoyRefs.length; i++) {
      convoyRefs[i].classList.toggle("on", i < p.convoy);
    }
    lastConvoy = p.convoy;
  }
  for (const ship of convoyRefs) {
    ship.style.setProperty("--convoy-dur", `${p.convoyDur.toFixed(2)}s`);
  }

  // Per-stage pipeline sweep speed.
  let panelFlow: number = VISUAL.flowMax;
  for (const id of STAGE_IDS) {
    const dur = p.flowDur[id] ?? VISUAL.flowMax;
    stageRefs[id]?.root.style.setProperty("--flow-dur", dur.toFixed(2) + "s");
    if (dur > panelFlow) panelFlow = dur;
  }

  // Arrows share a panel-level sweep speed (use the slowest active stage).
  prodPanelRef?.style.setProperty("--flow-dur", panelFlow.toFixed(2) + "s");

  // Top-bar credits pulse.
  if (topbarRef) {
    topbarRef.style.setProperty("--credit-dur", p.creditDur.toFixed(2) + "s");
    const active = p.creditActive ? "1" : "0";
    if (topbarRef.dataset.active !== active) topbarRef.dataset.active = active;
  }
}

// Numeric diagnostics per stage, shown once "Production Analytics" is unlocked.
function setStageSub(id: StageId, r: LiveRates, s: GameState): void {
  const ref = stageRefs[id];
  if (!ref) return;
  const el = ref.sub;
  if (!s.flags.analyticsUnlocked) {
    el.textContent = "";
    return;
  }
  const rate = formatRate;
  // Brownout-aware note appended to every diagnostic.
  const powerNote = r.powerFactor < 0.995 ? ` · ⚡ 电力 ${formatPercent(r.powerFactor)}` : "";

  if (id === "mining" || id === "copperMining") {
    const res: ResourceId = id === "mining" ? "ore" : "copperOre";
    const prod = r.production[res] ?? 0;
    const demand = downstreamDemand(r, res);
    let txt: string;
    if (demand <= 0) txt = "尚无下游加工产能";
    else if (demand > prod * 1.001) txt = `下游需求 ${rate(demand)} · ${SHORT_LABEL[res]}不足`;
    else txt = `下游需求 ${rate(demand)}`;
    el.textContent = txt + powerNote;
    return;
  }

  if (id === "research") {
    if (s.buildings.laboratory <= 0) {
      el.textContent = "尚未建造实验室";
    } else {
      el.textContent = (r.labActive
        ? `研究产出 ${rate(r.production.research)}`
        : "⚠ 信用点不足，实验室停机") + powerNote;
    }
    return;
  }

  // Processor recipe stage.
  const rec = getRecipe(id);
  const pr = r.processors[rec.id];
  if (!pr || pr.capBatches <= 0) {
    el.textContent = "未分配产能（用卡片上的 − / + 调配台数）";
    return;
  }
  const util = Math.round(clamp01(pr.util) * 100);
  const primary = rec.inputs[0];
  const prod = r.production[primary.res] ?? 0;
  let txt: string;
  if (pr.util >= 0.99 && pr.accumulating) {
    const allocCount = allocOf(s, rec.machine, rec.id);
    const perMachine = pr.cap / Math.max(allocCount, 1e-9);
    const need = Math.max(1, Math.ceil(prod / Math.max(perMachine, 1e-9)) - Math.round(allocCount));
    txt = `利用率 ${util}% · ${SHORT_LABEL[primary.res]}盈余 · 建议 +${need} 台`;
  } else if (pr.util < 0.99) {
    txt = `利用率 ${util}% · ${SHORT_LABEL[primary.res]}缺口 · 上游不足`;
  } else {
    txt = `利用率 ${util}% · 满负荷`;
  }
  if (rec.inputs.length > 1) {
    const extra = rec.inputs
      .slice(1)
      .map((i) => `${SHORT_LABEL[i.res]} ${rate(pr.perInput[i.res] ?? 0)}`)
      .join(" · ");
    txt += ` · 需 ${extra}`;
  }
  el.textContent = txt + powerNote;
}

// Structured bottleneck metrics: Input / Capacity / Utilisation / Efficiency.
function setStageMetrics(id: StageId, r: LiveRates): void {
  const ref = stageRefs[id];
  if (!ref || !ref.recipeId || !ref.input || !ref.cap || !ref.utilText || !ref.eff) return;
  const pr = r.processors[ref.recipeId];
  if (!pr) return;
  ref.input.textContent = formatRate(pr.input);
  ref.cap.textContent = formatRate(pr.cap);
  ref.utilText.textContent = formatPercent(pr.cap > 0 ? pr.input / pr.cap : 0);
  ref.eff.textContent = "×" + pr.yield.toFixed(2);
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

// ---------- Region hotspots (planet scene overlay) ----------

// Rebuild the hotspot buttons for the current planet's regions. Called only
// when the planet actually changes.
function rebuildHotspots(): void {
  const wrap = document.getElementById("region-hotspots");
  if (!wrap) return;
  wrap.innerHTML = "";
  hotspotRefs = [];
  for (const def of regionsForPlanet(S.planet)) {
    const btn = document.createElement("button");
    btn.className = "region-hotspot";
    btn.dataset.region = def.id;
    const pos = REGION_POS[def.id] ?? [50, 50];
    btn.style.left = `${pos[0]}%`;
    btn.style.top = `${pos[1]}%`;
    btn.title = `${def.name} — ${def.description}`;
    btn.innerHTML = `<span class="rh-icon">${def.icon}</span><span class="rh-lv" data-rh-lv>Lv.0</span>`;
    wrap.appendChild(btn);
    hotspotRefs.push({
      id: def.id,
      el: btn,
      label: btn.querySelector("[data-rh-lv]") as HTMLElement,
    });
  }
  lastHotspotPlanet = S.planet;
}

// Cheap per-tick refresh of the hotspot labels/classes.
function updateHotspots(): void {
  if (!sceneRef) return;
  if (S.planet !== lastHotspotPlanet) rebuildHotspots();
  for (const h of hotspotRefs) {
    const lv = regionLevel(S, h.id);
    const maxed = regionMaxed(S, h.id);
    const afford = canUpgradeRegion(S, h.id);
    h.label.textContent = maxed ? `Lv.${lv} ✓` : `Lv.${lv}`;
    h.el.classList.toggle("maxed", maxed);
    h.el.classList.toggle("unaffordable", !maxed && !afford);
    h.el.title = `${getRegion(h.id).name} · Lv.${lv}/${getRegion(h.id).maxLevel}`;
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
  else if (currentTab === "contracts") el.innerHTML = renderContracts();
  else if (currentTab === "stargate") el.innerHTML = renderStargate();
  else if (currentTab === "prestige") el.innerHTML = renderPrestige();
  else if (currentTab === "planets") el.innerHTML = renderPlanets();
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
    for (const res of SELLABLE_RESOURCES) {
      // Only offer toggles for chains the player has actually reached.
      if (!chainVisible(s, res)) continue;
      const on = s.autoSell[res];
      html += `<div class="up-card">
        <div class="uname">${SHORT_LABEL[res]}</div>
        <div class="udesc">自动出售超过储备的多余${SHORT_LABEL[res]}。</div>
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

// One permanent-upgrade card. The wallet/suffix come from the upgrade's
// currency so blueprint upgrades render beside their own balance.
function upgradeCardHTML(s: GameState, u: UpgradeDefinition): string {
  const level = upgradeLevel(s, u.id);
  const infinite = isInfiniteUpgrade(u.id);
  const maxed = upgradeMaxed(s, u.id);
  const cost = upgradeCost(s, u.id);
  const bp = upgradeCurrency(u.id) === "blueprints";
  const wallet = bp ? s.blueprints : s.coreData;
  const affordable = wallet >= cost;
  const suffix = bp ? "BP" : "CD";
  const levelBadge = infinite && level > 0 ? `<span class="tlevel">Lv.${level}</span>` : "";
  let btn: string;
  if (maxed) btn = `<button disabled>✓ 已拥有</button>`;
  else {
    const label = infinite && level > 0 ? `升级到 Lv.${level + 1}` : "购买";
    btn = `<button class="primary" data-up="${u.id}" ${affordable ? "" : "disabled"}>${label} (${formatNumber(cost)} ${suffix})</button>`;
  }
  return `<div class="up-card">
      <div class="uname">${u.icon} ${u.name} ${levelBadge}</div>
      <div class="udesc">${u.description}</div>
      ${btn}
    </div>`;
}

// One second-layer (stellar chart) upgrade card, bought with charts.
function stellarUpgradeCardHTML(s: GameState, id: StellarUpgradeId): string {
  const def = getStellarUpgrade(id);
  const level = stellarLevel(s, id);
  const infinite = isInfiniteStellar(id);
  const maxed = stellarMaxed(s, id);
  const cost = stellarCost(s, id);
  const affordable = canBuyStellarUpgrade(s, id);
  const levelBadge = infinite && level > 0 ? `<span class="tlevel">Lv.${level}</span>` : "";
  let btn: string;
  if (maxed) btn = `<button disabled>✓ 已拥有</button>`;
  else {
    const label = infinite && level > 0 ? `升级到 Lv.${level + 1}` : "购买";
    btn = `<button class="primary" data-sup="${id}" ${affordable ? "" : "disabled"}>${label} (${formatNumber(cost)} 🗺)</button>`;
  }
  return `<div class="up-card">
      <div class="uname">${def.icon} ${def.name} ${levelBadge}</div>
      <div class="udesc">${def.description}</div>
      ${btn}
    </div>`;
}

// ---------- Contracts tab ----------

function contractCardHTML(c: Contract, active: boolean): string {
  const have = S.resources[c.resource] ?? 0;
  const enough = !active || canDeliverContract(S, c.id);
  const pct = Math.round(contractProgress(c.remaining, c.total) * 100);
  const low = c.remaining / c.total < 0.25;
  const barCls = active && enough ? " full" : low ? " warn" : "";
  let btn: string;
  if (!active) {
    btn = `<button class="primary" data-accept="${c.id}">接受订单 Accept</button>`;
  } else {
    btn = `<button class="primary" data-deliver="${c.id}" ${enough ? "" : "disabled"}>${
      enough ? "交付 Deliver" : "库存不足"
    }</button>`;
  }
  return `<div class="contract-card${active ? " active" : ""}">
    <div class="c-head"><span class="c-icon">${active ? "🚚" : "📜"}</span><span class="c-name">${
      active ? "执行中" : "待接受"
    } #${c.id}</span></div>
    <div class="c-body">交付 <b style="color:var(--accent-2)">${formatNumber(c.amount)}</b> ${SHORT_LABEL[c.resource]}</div>
    <div class="c-sub">库存 ${formatNumber(have)} / ${formatNumber(c.amount)}</div>
    <div class="c-reward">奖励 <b style="color:var(--good)">${formatNumber(c.reward)}</b> Credits</div>
    <div class="bar${barCls}"><span style="width:${pct}%"></span></div>
    <div class="c-timer">${active ? "交付倒计时" : "接单窗口"} ${Math.ceil(c.remaining)}s</div>
    ${btn}
  </div>`;
}

function renderContracts(): string {
  const s = S;
  let html = `<h3 style="color:var(--accent)">📜 合同 / Contracts</h3>`;
  if (!contractsUnlocked(s)) {
    html += `<p class="hint">🔒 完成首次「重构」后解锁合同：外部买家会下达限时订单，按时交付即可换取高于市场价的信用点。</p>`;
    return html;
  }
  const slots = contractSlots(s);
  html += `<p class="hint">限时订单按<b>在线时间</b>倒计时（离线不会过期）。交付即得信用点，无需占用出售配额。解锁槽位：<b>${slots}</b>（升「合同星图」可增加）。</p>`;

  html += `<h3 style="color:var(--accent);margin-top:16px">执行中 Active (${s.activeContracts.length}/${slots})</h3>`;
  if (s.activeContracts.length === 0) {
    html += `<p class="hint">暂无进行中的订单。</p>`;
  } else {
    html += `<div class="grid-cards">`;
    for (const c of s.activeContracts) html += contractCardHTML(c, true);
    html += `</div>`;
  }

  html += `<h3 style="color:var(--accent);margin-top:18px">可接受 Offers (${s.contractOffers.length})</h3>`;
  if (s.contractOffers.length === 0) {
    html += `<p class="hint">暂时没有新订单，稍等片刻会出现。</p>`;
  } else {
    html += `<div class="grid-cards">`;
    for (const c of s.contractOffers) html += contractCardHTML(c, false);
    html += `</div>`;
  }
  return html;
}

// ---------- Event bar (per-tick, outside the tab panels) ----------

function updateEventBar(): void {
  const el = document.getElementById("event-bar");
  if (!el) return;
  const events = S.activeEvents;
  if (!events || events.length === 0) {
    if (el.childElementCount > 0) el.innerHTML = "";
    if (el.style.display !== "none") el.style.display = "none";
    return;
  }
  el.style.display = "";
  let html = `<span class="ev-label">事件 Events</span>`;
  for (const ev of events) {
    const def = EVENTS[ev.id];
    if (!def) continue;
    const pct = Math.round(eventProgress(ev.remaining, ev.total) * 100);
    html += `<span class="ev-chip ${def.good ? "good" : "bad"}" title="${def.description}">
      <span class="ev-icon">${def.icon}</span>
      <span class="ev-name">${shortName(def.name)}</span>
      <span class="ev-timer">${Math.ceil(ev.remaining)}s</span>
      <span class="ev-bar"><span style="width:${pct}%"></span></span>
    </span>`;
  }
  // Only rewrite when the text actually changed, to avoid thrashing the DOM
  // every frame (the countdown ticks once per second).
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderStargate(): string {
  const s = S;
  const cost = stargateCost(s);
  const progress = stargateProgress(s);
  const can = progress >= 1;
  const mods = stargateModifiers(s);
  const tierName = stargateTierName(s.stargateLevel);
  const next = nextStargateMilestone(s.stargateLevel);

  let html = `<h3 style="color:var(--accent)">🌀 星门 / Stargate</h3>`;
  html += `<p class="hint">消耗全链产物（钢材 / 零件 / 电路板 / 合金）逐级建造的巨型结构。层级<b>无限</b>，每级永久提升全局产量与供电、降低建筑成本；跨重构与升华保留。</p>`;
  html += `<p>当前层级：<b style="color:var(--accent-2);font-size:18px">T${s.stargateLevel}</b>${tierName ? ` · <b>${tierName}</b>` : ""}</p>`;
  html += `<p>永久加成：全局产量 <b>×${formatNumber(mods.globalProdMult)}</b> · 供电 <b>×${formatNumber(mods.powerSupplyMult)}</b> · 建筑成本 <b>×${mods.costMult.toFixed(3)}</b></p>`;

  html += `<h3 style="color:var(--accent);margin-top:18px">下一级 T${s.stargateLevel + 1}</h3>`;
  html += `<div class="bar${can ? " full" : ""}"><span style="width:${Math.round(progress * 100)}%"></span></div>`;
  html += `<p class="hint">已备货 ${Math.round(progress * 100)}%</p>`;
  html += `<div class="grid-cards">`;
  for (const res of STARGATE_INPUTS) {
    const need = cost[res] ?? 0;
    const have = s.resources[res] ?? 0;
    const ok = have >= need;
    html += `<div class="up-card">
      <div class="uname">${SHORT_LABEL[res]}</div>
      <div class="udesc">需要 <b style="color:${ok ? "var(--good)" : "var(--warn)"}">${formatNumber(need)}</b> · 持有 ${formatNumber(have)}</div>
    </div>`;
  }
  html += `</div>`;
  html += `<button class="big primary" data-stargate ${can ? "" : "disabled"}>${can ? `🌀 建造 T${s.stargateLevel + 1}` : "资源不足"}</button>`;
  if (next) {
    html += `<p class="hint">下一个里程碑：T${next.level} · ${next.name}（产量再 ×${next.bonus}）</p>`;
  }
  return html;
}

function confirmAscend(): void {
  const gain = pendingCharts(S);
  openModal(`
    <h3 style="color:var(--accent-2)">确认升华 Ascend</h3>
    <div class="body">
      你将获得 <b style="color:var(--accent-2)">${formatNumber(gain)} 星图</b>，并重置：<br>
      核心数据、永久升级（可保留 25%）、以及整轮进度。<br>
      <span class="hint">星门层级、星图 / 星图升级、成就与统计都会保留。</span>
    </div>
    <div class="actions">
      <button id="btn-modal-close">取消</button>
      <button class="primary" id="btn-ascend-confirm">确认升华</button>
    </div>`);
  // Modal lives outside #app, so bind directly (same as reset/import/prestige).
  document.getElementById("btn-ascend-confirm")!.onclick = () => {
    H.onAscend();
    closeModal();
  };
}

function renderPrestige(): string {
  const s = S;
  const gain = pendingCoreData(s);
  const can = canPrestige(s);
  let html = `<h3 style="color:var(--accent)">星球重构 / Stellar Reboot</h3>`;
  html += `<p>本轮峰值收入: <b>${formatRate(s.runPeakCreditsPerSec)}</b>（阈值 ${formatRate(PRESTIGE_THRESHOLD_CPS)} · 推得越高，收益越多）</p>`;
  html += `<p>重构将重置：铁矿、钢材、零件、铜链资源、信用点、建筑、配方配比、普通科技与区域等级。<br>保留：核心数据、蓝图、永久升级、统计。</p>`;
  const dest = getPlanet(s.nextPlanet);
  html += `<p>下次重构目的地：<b style="color:var(--accent)">${dest.icon} ${dest.name}</b>（在「🪐 星球」页更改）</p>`;
  html += `<div class="modal" style="border:none;padding:0;max-width:none;background:none"><div class="body" style="margin:0">`;
  html += `<p>立即重构可获得：<b style="color:var(--accent-2);font-size:18px">${formatNumber(gain)} Core Data</b></p>`;
  const disabledLabel =
    s.runPeakCreditsPerSec < PRESTIGE_THRESHOLD_CPS ? "本轮峰值未达阈值" : "暂无收益";
  html += `<button class="big primary" id="btn-prestige" ${can ? "" : "disabled"}>${can ? "💠 执行重构 Reboot Now" : disabledLabel}</button>`;
  html += `</div></div>`;

  // Blueprint upgrades (crafted currency).
  html += `<h3 style="color:var(--accent);margin-top:20px">蓝图升级 Blueprint Upgrades</h3>`;
  html += `<p class="hint">使用「蓝图」购买，跨轮保留。蓝图由装配机合成（电路板 + 合金）。</p>`;
  html += `<p>当前持有蓝图：<b style="color:var(--accent-2);font-size:18px">${formatNumber(s.blueprints)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const u of UPGRADE_LIST) {
    if (upgradeCurrency(u.id) !== "blueprints") continue;
    html += upgradeCardHTML(s, u);
  }
  html += `</div>`;

  // Permanent upgrades (Core Data).
  html += `<h3 style="color:var(--accent);margin-top:20px">永久升级 Permanent Upgrades</h3>`;
  html += `<p class="hint">使用 Core Data 购买，跨轮保留。</p>`;
  html += `<p>当前持有 Core Data：<b style="color:var(--accent-2);font-size:18px">${formatNumber(s.coreData)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const u of UPGRADE_LIST) {
    if (upgradeCurrency(u.id) === "blueprints") continue;
    html += upgradeCardHTML(s, u);
  }
  html += `</div>`;

  // Second layer: ascension (stellar charts).
  html += `<h3 style="color:var(--accent);margin-top:24px">第二层 · 升华 Ascension</h3>`;
  const chartGain = pendingCharts(s);
  const canAsc = canAscend(s);
  const locked = s.lifetimeCoreData < ASCENSION_THRESHOLD_CORE;
  if (locked) {
    html += `<p class="hint">🔒 需要累计核心数据达到 ${formatNumber(ASCENSION_THRESHOLD_CORE)} 才能升华（当前 ${formatNumber(s.lifetimeCoreData)}）。</p>`;
  } else {
    html += `<p class="hint">升华清空核心数据与永久升级（购「记忆回溯」可保留 25%），换取跨层保留的<b>星图</b>。星门、星图、成就与统计都会保留。</p>`;
    html += `<p>本次升华可获得：<b style="color:var(--accent-2);font-size:18px">${formatNumber(chartGain)} 星图</b>（已领取额度 ${formatNumber(s.chartsGranted)}）</p>`;
    html += `<button class="big primary" data-ascend ${canAsc ? "" : "disabled"}>${canAsc ? "🌌 执行升华 Ascend" : "暂无可领星图"}</button>`;
  }
  html += `<p style="margin-top:12px">当前持有星图：<b style="color:var(--accent-2);font-size:18px">${formatNumber(s.stellarCharts)}</b> · 已升华 ${formatNumber(s.ascensionCount)} 次</p>`;
  html += `<div class="grid-cards">`;
  for (const id of STELLAR_UPGRADE_IDS) html += stellarUpgradeCardHTML(s, id);
  html += `</div>`;
  return html;
}

function renderPlanets(): string {
  const s = S;
  const current = getPlanet(s.planet);
  const dest = getPlanet(s.nextPlanet);
  let html = `<h3 style="color:var(--accent)">🪐 星球 / Planets</h3>`;
  html += `<p class="hint">切换星球的唯一方式是「重构」：选定目的地后，下次重构将在该星球重建整轮进度。区域等级每轮重置。</p>`;
  html += `<p>当前星球：<b style="color:var(--accent)">${current.icon} ${current.name}</b> · 下次重构目的地：<b style="color:var(--accent-2)">${dest.icon} ${dest.name}</b></p>`;

  // Planet cards.
  html += `<div class="grid-cards">`;
  for (const p of PLANET_LIST) {
    const unlocked = planetUnlocked(s, p.id);
    const selected = s.nextPlanet === p.id;
    const isCurrent = s.planet === p.id;
    const cls = "up-card" + (selected ? " selected" : "") + (unlocked ? "" : " locked");
    let btn: string;
    if (!unlocked) {
      btn = `<button disabled>🔒 ${unlockText(p.id)}</button>`;
    } else if (selected) {
      btn = `<button disabled>✓ 已选为目的地</button>`;
    } else {
      btn = `<button class="primary" data-planet="${p.id}">设为目的地</button>`;
    }
    html += `<div class="${cls}">
      <div class="uname">${p.icon} ${p.name}${isCurrent ? ` <span class="tlevel">当前</span>` : ""}</div>
      <div class="udesc">${p.description}</div>
      <div class="udesc">${planetModText(p.id)}</div>
      ${btn}
    </div>`;
  }
  html += `</div>`;

  // Region upgrades for the current planet.
  html += `<h3 style="color:var(--accent);margin-top:20px">区域升级 / Regions · ${current.icon} ${current.name}</h3>`;
  html += `<p class="hint">用 Credits 升级本星球的区域，获得产量 / 电力 / 研究加成；等级每轮重置。</p>`;
  html += `<p>可用 Credits：<b>${formatNumber(s.resources.credits)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const def of regionsForPlanet(s.planet)) {
    const lv = regionLevel(s, def.id);
    const maxed = regionMaxed(s, def.id);
    const cost = regionCost(s, def.id);
    const afford = canUpgradeRegion(s, def.id);
    let btn: string;
    if (maxed) {
      btn = `<button disabled>✓ 已满级</button>`;
    } else {
      btn = `<button class="primary" data-region="${def.id}" ${afford ? "" : "disabled"}>升级到 Lv.${lv + 1} (${formatNumber(cost)} Credits)</button>`;
    }
    html += `<div class="up-card">
      <div class="uname">${def.icon} ${def.name} <span class="tlevel">Lv.${lv}/${def.maxLevel}</span></div>
      <div class="udesc">${def.description}</div>
      <div class="bar"><span style="width:${Math.round((lv / def.maxLevel) * 100)}%"></span></div>
      ${btn}
    </div>`;
  }
  html += `</div>`;
  return html;
}

// Human-readable modifier summary for a planet card.
function planetModText(id: PlanetId): string {
  const modifiers = getPlanet(id).modifiers;
  const parts: string[] = [];
  for (const k of Object.keys(modifiers) as (keyof PlanetModifiers)[]) {
    const v = modifiers[k];
    if (typeof v !== "number" || v === 1) continue;
    parts.push(`${MOD_LABELS[k]} ×${v}`);
  }
  return parts.length ? `修正：${parts.join(" · ")}` : "修正：无（均衡稳定）";
}

// Human-readable unlock criteria for a locked planet card.
function unlockText(id: PlanetId): string {
  const u = getPlanet(id).unlock;
  const parts: string[] = [];
  if (u.prestigeCount !== undefined) parts.push(`重构次数 ≥ ${u.prestigeCount}`);
  if (u.lifetimeCoreData !== undefined) {
    parts.push(`累计核心数据 ≥ ${formatNumber(u.lifetimeCoreData)}`);
  }
  return parts.length ? `解锁：${parts.join("，")}` : "";
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
    ["累计铜矿 Total Copper Ore", formatNumber(s.stats.totalCopperOre)],
    ["累计铜材 Total Copper", formatNumber(s.stats.totalCopper)],
    ["累计电路板 Total Circuit", formatNumber(s.stats.totalCircuit)],
    ["累计合金 Total Alloy", formatNumber(s.stats.totalAlloy)],
    ["累计蓝图 Total Blueprints", formatNumber(s.stats.totalBlueprints)],
    ["累计信用 Lifetime Credits", formatNumber(s.stats.lifetimeCredits)],
    ["建筑购买 Buildings Bought", formatNumber(s.stats.buildingsPurchased)],
    ["重构次数 Prestige Count", formatNumber(s.stats.prestigeCount)],
    ["最佳 Credits/s Best", formatRate(s.stats.bestCreditsPerSec)],
    [
      "电力 Power",
      `${formatNumber(s.rates.powerSupply)} / ${formatNumber(s.rates.powerDemand)} · ${formatPercent(s.rates.powerFactor)}`,
    ],
    ["核心数据 Core Data", formatNumber(s.coreData)],
    ["蓝图 Blueprints", formatNumber(s.blueprints)],
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
  const dest = getPlanet(S.nextPlanet);
  openModal(`
    <h3 style="color:var(--accent-2)">确认星球重构</h3>
    <div class="body">你将获得核心数据并重置当前轮进度，在新星球重建：<br>
      <b style="color:var(--accent)">${dest.icon} ${dest.name}</b><br>
      <span class="hint">目的地可在「🪐 星球」页更改。</span>
    </div>
    <div class="actions">
      <button id="btn-modal-close">取消</button>
      <button class="primary" id="btn-prestige-confirm">确认重构</button>
    </div>`);
  // The modal lives under document.body, outside #app, so the delegated
  // #app handler never sees it — bind directly (same as reset/import).
  document.getElementById("btn-prestige-confirm")!.onclick = () => {
    H.onPrestige(S.nextPlanet);
    closeModal();
  };
}

// ---------- Public API ----------

// Offline welcome modal. `produced` is the per-output inventory gained (keyed
// like LiveRates.net, including blueprints); only non-zero, visible rows show.
export function showOffline(elapsedMs: number, produced: Record<RecipeOutputId, number>): void {
  const order: RecipeOutputId[] = [
    "ore",
    "steel",
    "components",
    "copperOre",
    "copper",
    "circuit",
    "alloy",
    "blueprints",
    "credits",
    "research",
  ];
  let lines = "";
  for (const id of order) {
    const amt = produced[id] ?? 0;
    if (amt <= 0) continue;
    lines += `<div class="line"><span>${SHORT_LABEL[id]}</span><span>+${formatNumber(amt)}</span></div>`;
  }
  if (!lines) lines = `<div class="line"><span>无显著产出</span><span>—</span></div>`;
  openModal(`
    <h3>欢迎回来 Welcome Back</h3>
    <div class="body">
      <p>离线时间 Offline: <b>${formatDuration(elapsedMs)}</b></p>
      ${lines}
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

// Visual feedback for a successful region upgrade: pop every visible control
// bound to that region (hotspot over the scene + the card in the planets tab).
export function feedbackRegion(id: RegionId): void {
  document.querySelectorAll(`[data-region="${id}"]`).forEach((node) => {
    const el = node as HTMLElement;
    el.classList.remove("pop");
    void el.offsetWidth; // restart animation
    el.classList.add("pop");
    setTimeout(() => el.classList.remove("pop"), 450);
  });
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
