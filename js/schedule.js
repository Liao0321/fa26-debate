// 首頁賽程：把流程（rundown）整理成時間軸
import { esc } from "./common.js";
import { SESSIONS, planTimes, fmtMinutes } from "./defaults.js";

// 把同一個 group 的連續段落合成一列；場次開頭加一條分隔列
export function scheduleRows(segments) {
  const times = planTimes(segments);
  const rows = [];
  let lastSession = null;
  segments.forEach((s, i) => {
    if (s.session && s.session !== lastSession) {
      rows.push({ kind: "session", session: s.session });
    }
    lastSession = s.session;
    const key = s.group ? `${s.session}|${s.group}` : `seg|${s.id}`;
    const last = rows[rows.length - 1];
    if (last && last.kind === "item" && last.key === key) {
      last.end = times[i].end;
      last.indexes.push(i);
      return;
    }
    rows.push({
      kind: "item", key, title: s.group || s.title,
      start: times[i].start, end: times[i].end, indexes: [i],
      showEnd: !!s.untilTime || s.durationSec > 0,
    });
  });
  // 每一列的結束時間＝下一列的開始時間（老師的時間表每一輪都有留緩衝，例如第一輪 16 分鐘的內容排 20 分鐘）
  const items = rows.filter((r) => r.kind === "item");
  items.forEach((r, i) => {
    const next = items[i + 1];
    if (next && next.start > r.end) { r.end = next.start; r.showEnd = true; }
  });
  return rows;
}

// 每一列屬於哪一種：三輪比賽是主角；休息、開場前的準備淡化；午餐、頒獎用不同的設計
function rowKind(r, segments) {
  const segs = r.indexes.map((i) => segments[i]);
  const types = segs.map((s) => s.type);
  if (types.includes("ceremony") || segs.some((s) => s.waitingRoom)) return "ceremony";
  if (types.includes("lunch")) return "lunch";
  if (types.every((t) => t === "break")) return "break";
  if (segs.some((s) => s.round)) return "round";
  return "minor";
}

const ROUND_NUM = { 1: "1", 2: "2", 3: "3" };

// 這一輪選手可以說話多久：照流程裡的實際設定，例如「每一方發言 5 分鐘」「提問 2 分鐘」
const TALK = [
  { type: "speech", label: "發言" },
  { type: "cross", label: "提問" },
];
const fmtMin = (sec) => String(Math.round((sec / 60) * 10) / 10);
function talkLines(segs) {
  return TALK.map(({ type, label }) => {
    const durs = [...new Set(segs.filter((s) => s.type === type && s.durationSec > 0).map((s) => s.durationSec))].sort((a, b) => a - b);
    if (!durs.length) return null;
    const n = durs.length === 1 ? fmtMin(durs[0]) : `${fmtMin(durs[0])}～${fmtMin(durs[durs.length - 1])}`;
    return { label, n };
  }).filter(Boolean);
}

// nowIndex：目前進行到第幾段（-1 ＝ 還沒開始）
export function renderSchedule(segments, settings, nowIndex = -1) {
  const rows = scheduleRows(segments);
  // 「頒獎典禮即將開始」（待機室）和「頒獎典禮」合成一張卡片
  const merged = [];
  rows.forEach((r) => {
    if (r.kind === "item") r.type = rowKind(r, segments);
    const last = merged[merged.length - 1];
    if (r.type === "ceremony" && last?.type === "ceremony") {
      last.waitStart = last.waitStart ?? last.start;
      last.start = r.start; last.end = r.end;
      last.title = r.title; last.indexes.push(...r.indexes);
      return;
    }
    merged.push(r);
  });
  const nowBadge = `<span class="sc-now">進行中</span>`;
  return `<ol class="sched">${merged.map((r) => {
    if (r.kind === "session") {
      return `<li class="sc-session">
        <span class="sc-session-name">${esc(SESSIONS[r.session].label)}</span>
        <span class="sc-session-topic">${esc(settings.topics?.[r.session] || "")}</span>
      </li>`;
    }
    const isNow = r.indexes.includes(nowIndex);
    const isPast = nowIndex >= 0 && Math.max(...r.indexes) < nowIndex;
    const cls = `${isNow ? "is-now" : ""} ${isPast ? "is-past" : ""}`;
    const time = `${fmtMinutes(r.start)}${r.showEnd ? `–${fmtMinutes(r.end)}` : ""}`;
    const seg = segments[r.indexes[0]];
    if (r.type === "round") {
      const [, name = r.title] = r.title.split("：");
      const talk = talkLines(r.indexes.map((i) => segments[i]));
      return `<li class="sc-round ${cls}">
        <div class="sc-round-num"><small>ROUND</small>${ROUND_NUM[seg.round] || ""}</div>
        <div class="sc-round-body">
          <b>${esc(name)}</b>
          <span class="sc-round-time">${time}</span>
        </div>
        ${talk.length ? `<div class="sc-round-talk">${talk.map((t) =>
          `<span><em>每一方${t.label}</em><b>${t.n}</b> 分鐘</span>`).join("")}</div>` : ""}
        ${isNow ? nowBadge : ""}
      </li>`;
    }
    if (r.type === "lunch") {
      return `<li class="sc-lunch ${cls}">
        <span class="sc-emoji" aria-hidden="true">🍱</span>
        <div><b>${esc(r.title)}</b><span>${time}</span></div>
        ${isNow ? nowBadge : ""}
      </li>`;
    }
    if (r.type === "ceremony") {
      return `<li class="sc-ceremony ${cls}">
        <span class="sc-emoji" aria-hidden="true">🏆</span>
        <div><b>${esc(r.title)}</b>
          <span>${fmtMinutes(r.start)} 開始${r.waitStart != null ? `・${fmtMinutes(r.waitStart)} 待機室開放` : ""}</span></div>
        ${isNow ? nowBadge : ""}
      </li>`;
    }
    // 休息、開場前的準備：細細一行
    return `<li class="sc-minor ${r.type === "break" ? "sc-break" : ""} ${cls}">
      <span class="sc-minor-time">${time}</span><span>${esc(r.title)}</span>${isNow ? nowBadge : ""}
    </li>`;
  }).join("")}</ol>`;
}

// 比賽還沒有「即時狀態」時，依照現在時間猜目前在哪一段（只在比賽當天）
export function indexByClock(segments, eventDate) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  if (today !== eventDate) return -1;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const times = planTimes(segments);
  let idx = -1;
  times.forEach((t, i) => { if (t.start <= minutes) idx = i; });
  return idx;
}
