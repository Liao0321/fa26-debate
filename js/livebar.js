// 手機頁面頂端的小橫條：「目前進行中：XXX・剩 m:ss」
import { esc } from "./common.js";
import { startClockSync, watchRundown, watchLive, orderedRundown, currentIndex, timing, fmtClock } from "./live.js";

// onChange(state, list, index)：讓頁面也能拿到同一份資料（例如首頁的進度小卡）
export function mountLiveBar({ onChange } = {}) {
  const bar = document.createElement("div");
  bar.className = "live-bar hidden";
  bar.innerHTML = `<div class="container live-bar-inner">
    <span class="lb-label">目前進行中</span><span class="lb-title"></span><span class="lb-time"></span></div>`;
  const header = document.getElementById("site-header");
  header.after(bar);

  let rundown = [];
  let state = null;
  const update = () => {
    const list = orderedRundown(rundown, state);
    const i = currentIndex(list, state);
    const seg = list[i];
    bar.classList.toggle("hidden", !seg);
    if (seg) bar.querySelector(".lb-title").innerHTML = esc(seg.title);
    onChange?.(state, list, i);
  };
  const tick = () => {
    const t = timing(state);
    const el = bar.querySelector(".lb-time");
    if (!t.hasTimer) { el.textContent = ""; return; }
    el.textContent = t.done ? "✓ 發言完畢" : `${t.waiting ? "準備 " : t.paused ? "⏸ " : "剩 "}${fmtClock(t.remaining)}`;
    el.classList.toggle("is-over", t.remaining <= 0 && !t.done);
  };
  startClockSync();
  watchRundown((r) => { rundown = r; update(); });
  watchLive((s) => { state = s; update(); tick(); });
  setInterval(tick, 500);
}
