// Achievements: pure trophies with NO gameplay effect. Each is a single
// monotonic metric compared against a target, so progress is displayable.
//
// They are stored on GameState.achievements and survive prestige.
// Pure module (no DOM) so it can be unit-tested directly.

import type { AchievementId, GameState } from "./types";

export interface AchievementDefinition {
  id: AchievementId;
  name: string;
  icon: string;
  description: string;
  target: number;
  // A monotonic, non-negative measure of progress toward this achievement.
  metric: (s: GameState) => number;
}

function maxBuilding(s: GameState): number {
  const b = s.buildings;
  return Math.max(b.miningDrone, b.solarArray, b.furnace, b.factory, b.laboratory);
}

function ownedTechs(s: GameState): number {
  let n = 0;
  for (const key of Object.keys(s.techs) as (keyof typeof s.techs)[]) {
    if (s.techs[key] > 0) n++;
  }
  return n;
}

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { id: "firstOre", name: "初次着陆", icon: "⛏", description: "开采出第一份铁矿。", target: 1, metric: (s) => s.stats.totalOre },
  { id: "firstDrone", name: "首台无人机", icon: "🤖", description: "购买第一台采矿无人机。", target: 1, metric: (s) => s.buildings.miningDrone },
  { id: "smelter", name: "熔炼上线", icon: "🔥", description: "建造第一座熔炼炉。", target: 1, metric: (s) => s.buildings.furnace },
  { id: "assembly", name: "制造链", icon: "⚙", description: "建造第一座制造厂。", target: 1, metric: (s) => s.buildings.factory },
  { id: "lab", name: "科研启航", icon: "🔬", description: "建造第一座实验室。", target: 1, metric: (s) => s.buildings.laboratory },
  { id: "solar", name: "通电基地", icon: "☀", description: "建造第一座太阳能阵列。", target: 1, metric: (s) => s.buildings.solarArray },

  { id: "oreBaron", name: "铁矿大亨", icon: "📦", description: "累计开采 100K 铁矿。", target: 1e5, metric: (s) => s.stats.totalOre },
  { id: "steelWill", name: "钢铁意志", icon: "🏗", description: "累计生产 10K 钢材。", target: 1e4, metric: (s) => s.stats.totalSteel },
  { id: "partsMaster", name: "零件大师", icon: "🔧", description: "累计生产 1K 机械零件。", target: 1e3, metric: (s) => s.stats.totalComponents },
  { id: "firstMillion", name: "百万信用", icon: "💰", description: "累计赚取 1M 信用点。", target: 1e6, metric: (s) => s.stats.lifetimeCredits },

  { id: "reboot", name: "重构先驱", icon: "💠", description: "完成第一次星球重构。", target: 1, metric: (s) => s.stats.prestigeCount },
  { id: "cycleFive", name: "循环往复", icon: "🔁", description: "完成 5 次星球重构。", target: 5, metric: (s) => s.stats.prestigeCount },
  { id: "coreHoarder", name: "核心积累", icon: "🗄", description: "累计获得 100 核心数据。", target: 100, metric: (s) => s.lifetimeCoreData },

  { id: "scholar", name: "学者", icon: "📐", description: "研究 8 项科技。", target: 8, metric: ownedTechs },
  { id: "milestoneMaster", name: "里程碑大师", icon: "🏆", description: "任一建筑达到 100 台。", target: 100, metric: maxBuilding },
  { id: "gridStable", name: "大型电网", icon: "🔌", description: "电网供电达到 100/s。", target: 100, metric: (s) => s.rates?.powerSupply ?? 0 },
  { id: "highThroughput", name: "高效生产", icon: "📈", description: "信用点收入达到 100/s。", target: 100, metric: (s) => s.stats.bestCreditsPerSec },
  { id: "timeTraveler", name: "时间旅者", icon: "⏱", description: "累计游玩 1 小时。", target: 3.6e6, metric: (s) => s.stats.lifetimePlayTime },
];

// A default map with EVERY achievement id present and false. This must be
// exhaustive: the save loader only deep-merges keys that already exist on the
// default object, so an empty {} would make saved achievements vanish.
export function emptyAchievementMap(): Record<AchievementId, boolean> {
  const m = {} as Record<AchievementId, boolean>;
  for (const a of ACHIEVEMENTS) m[a.id] = false;
  return m;
}

export function getAchievement(id: AchievementId): AchievementDefinition {
  const found = ACHIEVEMENTS.find((a) => a.id === id);
  if (!found) throw new Error(`unknown achievement: ${id}`);
  return found;
}

// Mark any newly satisfied achievements as unlocked and return their ids.
export function evaluateAchievements(state: GameState): AchievementId[] {
  if (!state.achievements) return [];
  const unlocked: AchievementId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    if (a.metric(state) >= a.target) {
      state.achievements[a.id] = true;
      unlocked.push(a.id);
    }
  }
  return unlocked;
}

export function achievementProgress(
  state: GameState,
  a: AchievementDefinition,
): { current: number; target: number; pct: number } {
  const current = a.metric(state);
  const pct = a.target > 0 ? Math.min(1, current / a.target) : 1;
  return { current, target: a.target, pct };
}
