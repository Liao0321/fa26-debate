// 評分的共用程式：文件 ID、身分倍數、統計
// 這個檔案不載入 Firebase，統計函式可以直接用假資料測試
//
// 投票文件：debate_votes/{session}_{round}_{email}
//   { session: "am"|"pm", round: 1|2|3, email, pro: 1~5, con: 1~5, updatedAt }
//   文件裡不存倍數：統計時依名單計算，不相信前端送來的值

export const ROUNDS = [1, 2, 3];
export const SCORES = [1, 2, 3, 4, 5];
export const SIDES = ["pro", "con"];

export function voteDocId(session, round, email) {
  return `${session}_${round}_${String(email).toLowerCase()}`;
}

// 名單類別在某一場的角色："player" 選手、"host" 主持、"judge" 評審、"audience" 觀眾
// 類別格式：am_pro、am_con、am_host、am_judge、pm_…；其他（teacher、student、admin…）都是觀眾
export function roleOf(category, session) {
  const m = /^(am|pm)_(pro|con|host|judge)$/.exec(category || "");
  if (!m || m[1] !== session) return "audience";
  return m[2] === "pro" || m[2] === "con" ? "player" : m[2];
}

// 某一場的投票倍數：選手 0（不能投）、主持人和評審 judgeWeight、其他人 1
export function weightOf(category, session, judgeWeight = 3) {
  const role = roleOf(category, session);
  if (role === "player") return 0;
  if (role === "host" || role === "judge") return Number(judgeWeight) || 3;
  return 1;
}

const emptySide = () => ({ judge: 0, audience: 0, total: 0, raw: 0 });
const emptyRound = () => ({ voters: 0, judges: 0, pro: emptySide(), con: emptySide() });

// 統計某一場
//   votes：投票文件陣列
//   rosterByEmail：{ email: { name, category } }（不在名單上的人＝觀眾，倍數 1）
//   judgeWeight：評審、主持人的倍數
//   manualWinner：平手時控制老師指定的 "pro" / "con"（沒有就 null）
// 回傳：
//   { rounds: {1: {...}, 2: {...}, 3: {...}}, total: {pro, con}, winner, decidedBy, ignored, voters: [...] }
//   decidedBy："total" 總分、"judge" 評審分、"manual" 老師指定、null 還分不出來
export function tallySession(votes, rosterByEmail, session, { judgeWeight = 3, manualWinner = null } = {}) {
  const rounds = Object.fromEntries(ROUNDS.map((r) => [r, emptyRound()]));
  const total = { pro: emptySide(), con: emptySide() };
  const voters = [];
  let ignored = 0;

  for (const v of votes) {
    if (!v || v.session !== session || !ROUNDS.includes(v.round)) continue;
    const valid = SIDES.every((s) => Number.isInteger(v[s]) && v[s] >= 1 && v[s] <= 5);
    const email = String(v.email || "").toLowerCase();
    const r = rosterByEmail[email] || null;
    const role = roleOf(r?.category, session);
    const w = weightOf(r?.category, session, judgeWeight);
    if (!valid || w === 0) { ignored++; continue; }
    const kind = role === "host" || role === "judge" ? "judge" : "audience";
    const round = rounds[v.round];
    round.voters++;
    if (kind === "judge") round.judges++;
    for (const s of SIDES) {
      round[s][kind] += v[s] * w;
      round[s].total += v[s] * w;
      round[s].raw += v[s];
      total[s][kind] += v[s] * w;
      total[s].total += v[s] * w;
      total[s].raw += v[s];
    }
    voters.push({ email, name: r?.name || email.split("@")[0], role, weight: w, round: v.round, pro: v.pro, con: v.con });
  }

  let winner = null;
  let decidedBy = null;
  if (total.pro.total !== total.con.total) {
    winner = total.pro.total > total.con.total ? "pro" : "con";
    decidedBy = "total";
  } else if (total.pro.judge !== total.con.judge) {
    winner = total.pro.judge > total.con.judge ? "pro" : "con";
    decidedBy = "judge";
  } else if (manualWinner === "pro" || manualWinner === "con") {
    winner = manualWinner;
    decidedBy = "manual";
  }
  voters.sort((a, b) => a.round - b.round || (a.role === b.role ? 0 : a.role === "audience" ? 1 : -1) || a.name.localeCompare(b.name, "zh-Hant"));
  return { rounds, total, winner, decidedBy, ignored, voters };
}

// 某一輪有幾個人投了（只算人數，不看分數）
export function countVoters(votes, session, round) {
  return votes.filter((v) => v && v.session === session && v.round === round).length;
}
