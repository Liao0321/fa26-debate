// 頒獎典禮的共用程式（不載入 Firebase，可以直接用假資料測試）
//
// debate_awards/results（只有控制者讀寫）：
//   am / pm: { winner: "pro"|"con"|null, decidedBy, flowers: {pro, con}, tomatoes: {pro, con}, voters }
//            不存分數：投影畫面只需要「丟幾朵花、幾顆番茄」
//   candidates: { am: [{ name, role }], pm: [...] }   MVP 拉霸機上轉的名字（選手、主持人、評審）
//   mvp: { am: "名字", pm: "名字" }
//   computedAt
//
// debate_live/state.ceremonyStep：0 開場、1 上午場優勝、2 下午場優勝、3 兩位 MVP
// debate_live/state.ceremonyAt：按下那一步的時間（投影畫面用來判斷要不要播動畫）

import { roleOf } from "./votes.js";

export const CEREMONY_STEPS = [
  { step: 0, label: "開場", short: "開場" },
  { step: 1, label: "揭曉上午場優勝", short: "上午場優勝", session: "am" },
  { step: 2, label: "揭曉下午場優勝", short: "下午場優勝", session: "pm" },
  { step: 3, label: "揭曉兩位 MVP", short: "MVP" },
];

export const ROLE_TEXT = { pro: "正方選手", con: "反方選手", host: "主持人", judge: "評審" };

// 每一組會被丟幾樣東西（花＋番茄）
export const THROWS_PER_TEAM = 14;
const WIN_FLOWERS = 11;

// 依加權總分換算成花的數量：優勝組 11 朵，另一組照分數比例（最少 3 朵），而且一定比優勝組少
export function flowerCounts(total, winner) {
  if (winner !== "pro" && winner !== "con") return null;
  const loser = winner === "pro" ? "con" : "pro";
  const w = Number(total?.[winner]) || 0;
  const l = Number(total?.[loser]) || 0;
  let lf = w > 0 ? Math.round((WIN_FLOWERS * l) / w) : WIN_FLOWERS - 3;
  lf = Math.max(3, Math.min(WIN_FLOWERS - 2, lf));
  const flowers = { [winner]: WIN_FLOWERS, [loser]: lf };
  const tomatoes = { [winner]: THROWS_PER_TEAM - WIN_FLOWERS, [loser]: THROWS_PER_TEAM - lf };
  return { flowers, tomatoes };
}

// 結果文件裡的一場：tally 是 votes.js 的 tallySession 結果
export function sessionResult(tally) {
  const counts = flowerCounts({ pro: tally.total.pro.total, con: tally.total.con.total }, tally.winner);
  return {
    winner: tally.winner,
    decidedBy: tally.decidedBy,
    flowers: counts?.flowers || { pro: 7, con: 7 },
    tomatoes: counts?.tomatoes || { pro: THROWS_PER_TEAM - 7, con: THROWS_PER_TEAM - 7 },
    voters: tally.voters.length,
  };
}

// 平手時老師指定優勝組（不用重新計算）：指定的那組 11 朵花，另一組 9 朵
export function manualResult(prev, winner) {
  return { ...(prev || {}), winner, decidedBy: "manual", ...flowerCounts({ pro: 1, con: 1 }, winner) };
}

// MVP 候選人：某一場的選手、主持人、評審（只放名字和身分，不放 email）
export function mvpCandidates(roster, session) {
  const order = { pro: 0, con: 1, host: 2, judge: 3 };
  return roster
    .map((r) => {
      const role = roleOf(r.category, session);
      if (role === "audience") return null;
      const kind = role === "player" ? r.category.split("_")[1] : role;
      return { name: String(r.name || r.email.split("@")[0]).trim(), role: kind };
    })
    .filter(Boolean)
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, "zh-Hant"));
}

// 固定種子的亂數：同一場每次畫出來的花堆位置都一樣（重新整理也不會跳）
export function seeded(seed) {
  let a = 0;
  for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 丟東西的順序：兩組的花和番茄混在一起；最後幾下故意讓優勝組的花晚一點出現，保留懸念
export function throwOrder(result, seed) {
  const rnd = seeded(seed);
  const items = [];
  for (const side of ["pro", "con"]) {
    for (let i = 0; i < (result?.flowers?.[side] || 0); i++) items.push({ side, kind: "flower" });
    for (let i = 0; i < (result?.tomatoes?.[side] || 0); i++) items.push({ side, kind: "tomato" });
  }
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  // 讓兩組的花數一路上咬得很緊：前面 2/3 的時間，領先不超過 1 朵
  const out = [];
  const pool = [...items];
  const count = { pro: 0, con: 0 };
  while (pool.length) {
    let k = 0;
    if (pool.length > items.length / 3) {
      k = pool.findIndex((it) => it.kind !== "flower" || count[it.side] - count[it.side === "pro" ? "con" : "pro"] < 1);
      if (k < 0) k = 0;
    }
    const [it] = pool.splice(k, 1);
    if (it.kind === "flower") count[it.side]++;
    out.push(it);
  }
  return out;
}
