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

// nowIndex：目前進行到第幾段（-1 ＝ 還沒開始）
export function renderSchedule(segments, settings, nowIndex = -1) {
  const rows = scheduleRows(segments);
  return `<ol class="timeline">${rows.map((r) => {
    if (r.kind === "session") {
      return `<li class="tl-session"><div class="tl-body">
        <b>${esc(SESSIONS[r.session].label)}</b>
        <span>題目：${esc(settings.topics?.[r.session] || "")}</span>
      </div></li>`;
    }
    const isNow = r.indexes.includes(nowIndex);
    const isPast = nowIndex >= 0 && Math.max(...r.indexes) < nowIndex;
    const mins = Math.round(r.end - r.start);
    return `<li class="${isNow ? "is-now" : ""} ${isPast ? "is-past" : ""}">
      <div class="tl-time">${fmtMinutes(r.start)}${r.showEnd ? `–${fmtMinutes(r.end)}` : ""}</div>
      <div class="tl-body">
        <div class="tl-main"><b>${esc(r.title)}</b></div>
        ${isNow ? `<span class="badge badge-orange">進行中</span>` : ""}
        ${mins > 0 && !isNow ? `<span class="tl-dur">${mins} 分鐘</span>` : ""}
      </div>
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
