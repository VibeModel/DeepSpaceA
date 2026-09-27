import {
  BUILDING_LIST,
  buildingCost,
  milestoneTiers,
  nextMilestone,
  buildingUnlocked,
} from "../game/buildings";
import { TECH_LIST } from "../game/research";
import { UPGRADE_LIST } from "../game/upgrades";
import { MILESTONES } from "../game/balance";
import { pendingCoreData, canPrestige } from "../game/prestige";
import { PRESTIGE_THRESHOLD_CREDITS } from "../game/balance";
import type {
  GameState,
  BuildingId,
  TechId,
  UpgradeId,
  SellableResource,
} from "../game/types";
import { formatNumber, formatRate, formatDuration } from "./format";

export type TabName = "research" | "automation" | "prestige" | "stats";

export interface Handlers {
  onMine(): void;
  onSell(res: SellableResource): void;
  onBuyBuilding(id: BuildingId): void;
  onBuyTech(id: TechId): void;
  onBuyUpgrade(id: UpgradeId): void;
  onToggleAutoSell(res: SellableResource): void;
  onToggleAutoBuy(id: BuildingId): void;
  onPrestige(): void;
  onSetTab(tab: TabName): void;
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
const resRefs: Record<string, { val: HTMLElement; delta: HTMLElement }> = {};
const stageRefs: Record<string, {
  rate: HTMLElement;
  utilWrap?: HTMLElement;
  utilBar?: HTMLElement;
  warn?: HTMLElement;
}> = {};

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
      <button class="primary" data-ref="buy">购买</button>
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
          <button class="big primary" id="btn-mine">⛏ 手动采矿 (+1 铁矿)</button>
        </div>
        <div class="manual">
          <button data-sell="ore">出售 矿石</button>
          <button data-sell="steel">出售 钢材</button>
          <button data-sell="components">出售 零件</button>
        </div>
        <div id="buildings-list"></div>
      </section>

      <section class="panel" id="panel-production">
        <h2>PRODUCTION</h2>
        <div id="resource-readouts"></div>
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
    `;
    flow.appendChild(div);
    if (id !== "research") {
      const arrow = document.createElement("div");
      arrow.className = "flow-arrow";
      arrow.textContent = "↓";
      flow.appendChild(arrow);
    }
    stageRefs[id] = {
      rate: div.querySelector("[data-rate]")!,
      utilWrap: hasUtil ? div.querySelector("[data-util]") as HTMLElement : undefined,
      utilBar: hasUtil ? (div.querySelector("[data-util] span") as HTMLElement) : undefined,
      warn: undefined,
    };
    // attach a warning line element under the stage
    const warn = document.createElement("div");
    warn.style.display = "none";
    flow.appendChild(warn);
    stageRefs[id].warn = warn;
  }

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
  app.addEventListener("click", (e) => {
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
    else if (t.id === "btn-prestige-confirm") {
      H.onPrestige();
      closeModal();
    } else if (t.id === "btn-modal-close" || t.id === "modal-backdrop") closeModal();
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
    // Milestone text.
    const tiers = milestoneTiers(b.id, owned);
    const next = nextMilestone(b.id, owned);
    let mtxt = `里程碑 ${tiers}/${MILESTONES.length}`;
    if (next !== null) {
      mtxt += ` · <span class="next">下一个 @ ${next}: ×2 产量</span>`;
    } else {
      mtxt += ` · <span class="done">全部达成</span>`;
    }
    ref.milestone.innerHTML = mtxt;

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

  // Live stats.
  const runMs = Date.now() - s.stats.currentRunStart;
  document.getElementById("ls-runtime")!.textContent = formatDuration(runMs);
  document.getElementById("ls-ore")!.textContent = formatRate(r.oreProd);
  document.getElementById("ls-steel")!.textContent = formatRate(r.steelProd);
  document.getElementById("ls-comp")!.textContent = formatRate(r.compProd);
  document.getElementById("ls-credits")!.textContent = formatRate(r.credits);
  document.getElementById("ls-research")!.textContent = formatRate(r.researchProd);
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
  else el.innerHTML = renderStats();
}

function renderResearch(): string {
  const s = S;
  let html = `<p style="margin-top:0;color:var(--muted)">研究点 Research: <b style="color:var(--accent)">${formatNumber(s.resources.research)}</b></p>`;
  html += `<div class="grid-cards">`;
  for (const t of TECH_LIST) {
    const owned = s.techs[t.id];
    const prereq = t.requires.every((r) => s.techs[r]);
    const affordable = s.resources.research >= t.cost;
    const locked = !owned && !prereq;
    const cls = "tech-card" + (locked ? " locked" : "");
    let btn = "";
    if (owned) btn = `<button disabled>✓ 已研究</button>`;
    else if (locked) btn = `<button disabled>🔒 前置未解锁</button>`;
    else btn = `<button class="primary" data-tech="${t.id}" ${affordable ? "" : "disabled"}>研究 (${formatNumber(t.cost)} RP)</button>`;
    html += `
      <div class="${cls}">
        <div class="branch">${t.branch}</div>
        <div class="tname">${t.icon} ${t.name}</div>
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
  return html;
}

function renderPrestige(): string {
  const s = S;
  const gain = pendingCoreData(s);
  const can = canPrestige(s);
  let html = `<h3 style="color:var(--accent)">星球重构 / Stellar Reboot</h3>`;
  html += `<p>累计赚取 Credits: <b>${formatNumber(s.stats.lifetimeCredits)}</b> / 阈值 ${formatNumber(PRESTIGE_THRESHOLD_CREDITS)}</p>`;
  html += `<p>重构将重置：铁矿、钢材、零件、信用点、建筑、普通科技与研究。<br>保留：核心数据、永久升级、统计。</p>`;
  html += `<div class="modal" style="border:none;padding:0;max-width:none;background:none"><div class="body" style="margin:0">`;
  html += `<p>立即重构可获得：<b style="color:var(--accent-2);font-size:18px">${formatNumber(gain)} Core Data</b></p>`;
  html += `<button class="big primary" id="btn-prestige" ${can ? "" : "disabled"}>${can ? "💠 执行重构 Reboot Now" : "未达阈值"}</button>`;
  html += `</div></div>`;
  // Permanent upgrades
  html += `<h3 style="color:var(--accent);margin-top:20px">永久升级 Permanent Upgrades</h3>`;
  html += `<p class="hint">使用 Core Data 购买，跨轮保留。</p>`;
  html += `<div class="grid-cards">`;
  for (const u of UPGRADE_LIST) {
    const owned = s.permanentUpgrades[u.id];
    const affordable = s.coreData >= u.cost;
    let btn = "";
    if (owned) btn = `<button disabled>✓ 已拥有</button>`;
    else btn = `<button class="primary" data-up="${u.id}" ${affordable ? "" : "disabled"}>购买 (${formatNumber(u.cost)} CD)</button>`;
    html += `<div class="up-card">
      <div class="uname">${u.icon} ${u.name}</div>
      <div class="udesc">${u.description}</div>
      ${btn}
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
  backdrop.addEventListener("click", (e) => {
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
