// 主控台：控制流程、計時、投票開關、猜硬幣
// 建議用老師的手機或平板開（投影電腦只開 display.html，簡報筆才不會按到這一頁）
import {
  startPage, login, esc, toast, confirmDialog, watchSettings,
} from "./common.js";
import {
  startClockSync, watchRundown, watchLive, orderedRundown, currentIndex, timing, fmtClock, endTimeText,
  enterSegment, pause, resume, adjust, restart, setSpeakerDone, liveUpdate, initialRemaining,
} from "./live.js";
import { SESSIONS, SIDE_LABEL, TYPE_LABEL, planTimes, fmtMinutes } from "./defaults.js";

const gate = document.getElementById("gate");
const area = document.getElementById("control-area");

let settings = null;
let rundown = [];
let state = null;
let online = true;
let started = false;

startPage({
  active: "control",
  onProfile(p) {
    if (!p) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>請先登入管理員或控制老師的帳號。</p>
        <button class="btn btn-primary" id="gate-login" type="button">學校帳號登入</button>`;
      gate.querySelector("#gate-login").addEventListener("click", login);
      return;
    }
    if (!p.canControl) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>你目前的帳號（${esc(p.email)}）不是控制老師，無法使用主控台。</p>`;
      return;
    }
    gate.classList.add("hidden");
    area.classList.remove("hidden");
    if (!started) {
      started = true;
      startClockSync();
      watchSettings((s) => { settings = s; renderAll(); });
      watchRundown((r) => { rundown = r; renderAll(); });
      watchLive((s, meta) => { state = s; online = meta.online; renderAll(); });
      setInterval(tick, 250);
    }
  },
});

const list = () => orderedRundown(rundown, state);
const idx = () => currentIndex(list(), state);
const cur = () => list()[idx()] || null;

function segLabel(seg) {
  if (!seg) return "";
  const parts = [];
  if (seg.session) parts.push(SESSIONS[seg.session].label);
  if (seg.round) parts.push(`第 ${seg.round} 輪`);
  parts.push(TYPE_LABEL[seg.type] || seg.type);
  return parts.join("・");
}

function sideBadge(seg) {
  if (!seg?.side) return "";
  return `<span class="badge badge-${seg.side}">${SIDE_LABEL[seg.side]}</span>`;
}

// ---------- 目前段落卡 ----------
function renderNow() {
  const box = document.getElementById("now-card");
  const L = list();
  const i = idx();
  const seg = L[i];
  if (!state || !seg) {
    box.innerHTML = `
      <div class="row"><span class="tag">STANDBY</span>${connDot()}</div>
      <h2 style="margin:10px 0">流程還沒開始</h2>
      <p class="muted small" style="margin-top:0">按下面的按鈕，投影畫面就會從第一段「${esc(L[0]?.title || "")}」開始。</p>
      <button class="btn btn-primary btn-big ctl-wide" id="start-btn" type="button">▶ 開始流程</button>`;
    box.querySelector("#start-btn").addEventListener("click", () => act(() => enterSegment(L, 0, state)));
    return;
  }
  const next = L[i + 1];
  box.innerHTML = `
    <div class="row"><span class="tag">NOW ${i + 1} / ${L.length}</span>${sideBadge(seg)}<span class="muted small">${esc(segLabel(seg))}</span><span class="spacer"></span>${connDot()}</div>
    <h2 class="now-title">${esc(seg.title)}</h2>
    <div class="now-timer" id="now-timer"></div>
    <div class="now-status" id="now-status"></div>
    <p class="now-next"><b>下一項：</b>${next ? esc(next.title) : "（已經是最後一段）"}</p>
    ${seg.hostScript ? `<div class="host-script"><b>主持人提示</b><br>${esc(seg.hostScript)}</div>` : ""}`;
  tick();
}

function connDot() {
  return `<span class="conn ${online ? "on" : "off"}" title="${online ? "已連線" : "離線中"}">${online ? "● 連線中" : "● 離線"}</span>`;
}

function tick() {
  const el = document.getElementById("now-timer");
  if (!el) return;
  const t = timing(state);
  const warn = settings?.bellWarnSec ?? 30;
  const status = document.getElementById("now-status");
  if (!t.hasTimer) {
    el.textContent = "—";
    el.className = "now-timer is-off";
    status.textContent = "這一段不倒數";
  } else {
    el.textContent = fmtClock(t.remaining);
    el.className = `now-timer ${t.remaining <= 0 ? "is-over" : t.remaining <= warn ? "is-warn" : ""} ${t.done || t.paused ? "is-frozen" : ""}`;
    const seg = cur();
    const endText = ["break", "lunch", "idle"].includes(seg?.type) && t.remaining > 0 ? `・預計 ${endTimeText(t)} 結束` : "";
    status.textContent = t.done ? "✓ 發言完畢（等你按下一項）" : t.paused ? "⏸ 暫停中" : t.remaining <= 0 ? "時間到！（不會自動跳下一段）" : `倒數中${endText}`;
  }
  // 暫停按鈕的文字
  const pb = document.querySelector('[data-act="pause"]');
  if (pb) pb.textContent = state?.paused ? "▶ 繼續" : "⏸ 暫停";
}

// ---------- 按鈕 ----------
function renderButtons() {
  const seg = cur();
  const L = list();
  const i = idx();
  const has = !!(state && seg);
  const t = timing(state);
  const set = (a, disabled) => { document.querySelector(`[data-act="${a}"]`).disabled = disabled; };
  set("prev", !has || i <= 0);
  set("next", !has || i >= L.length - 1);
  set("pause", !has || !t.hasTimer);
  set("restart", !has || initialRemaining(seg) == null);
  set("minus", !has || !t.hasTimer);
  set("plus", !has || !t.hasTimer);
  const done = document.querySelector('[data-act="done"]');
  done.classList.toggle("hidden", seg?.type !== "speech");
  done.textContent = state?.speakerDone ? "取消「我說完了」（繼續倒數）" : "代按「我說完了」";
}

let busy = false;
async function act(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll(".ctl-btn").forEach((b) => b.classList.add("is-busy"));
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast(`操作失敗：${e.message}`, "error", 5000);
  } finally {
    // 稍微等一下，避免連按兩次跳過一段
    setTimeout(() => {
      busy = false;
      document.querySelectorAll(".ctl-btn").forEach((b) => b.classList.remove("is-busy"));
    }, 600);
  }
}

document.getElementById("main-buttons").addEventListener("click", (e) => {
  const a = e.target.closest("[data-act]")?.dataset.act;
  if (!a) return;
  const L = list();
  const i = idx();
  const seg = cur();
  if (a === "next") act(() => enterSegment(L, i + 1, state));
  if (a === "prev") act(() => enterSegment(L, i - 1, state));
  if (a === "pause") act(() => (state?.paused ? resume(state) : pause(state)));
  if (a === "plus") act(() => adjust(state, 30));
  if (a === "minus") act(() => adjust(state, -30));
  if (a === "restart") {
    confirmDialog({ title: "重新計時？", body: `<p>「${esc(seg.title)}」會從頭開始倒數。</p>`, okText: "重新計時" })
      .then((ok) => ok && act(() => restart(seg)));
  }
  if (a === "done") act(() => setSpeakerDone(state, !state?.speakerDone));
});

// ---------- 依段落出現的區塊 ----------
function renderExtra() {
  const box = document.getElementById("extra");
  const seg = cur();
  const parts = [];

  // 猜硬幣
  if (seg?.type === "coin" && seg.session) {
    const v = state?.coinFirst?.[seg.session];
    parts.push(`
      <div class="card">
        <h3 style="margin-top:0">猜硬幣結果：第三輪誰先總結？</h3>
        <p class="small muted" style="margin-top:0">現場真的擲硬幣，猜對的一方決定先講或後講，再按下結果。投影畫面會播硬幣動畫並顯示結果。</p>
        <div class="ctl-grid">
          <button class="btn ctl-btn ${v === "pro" ? "btn-pro" : ""}" data-coin="pro" type="button">正方先</button>
          <button class="btn ctl-btn ${v === "con" ? "btn-con" : ""}" data-coin="con" type="button">反方先</button>
          <button class="btn ctl-btn ctl-wide" data-coin="random" type="button">🎲 隨機</button>
        </div>
        <p style="margin-bottom:0">目前：<b>${v ? `${SIDE_LABEL[v]}先` : "還沒決定（預設正方先）"}</b></p>
      </div>`);
  }

  // 投票開關
  const v = state?.voteOpen;
  if (seg?.openVote || v) {
    const target = seg?.openVote || v;
    const isOpen = v && v.session === target.session && v.round === target.round;
    parts.push(`
      <div class="card vote-card">
        <div class="row">
          <div style="flex:1 1 200px">
            <b>評分：${SESSIONS[target.session].label}第 ${target.round} 輪</b>
            <div class="small muted">進入「休息」「評審講評」時會自動開放，離開時自動關閉；也可以手動開關。</div>
            <div class="small muted">投票人數：第 4 階段完成後顯示</div>
          </div>
          <span class="badge ${isOpen ? "badge-orange" : "badge-gray"}">${isOpen ? "開放中" : "已關閉"}</span>
          <button class="btn ${isOpen ? "btn-danger" : "btn-primary"}" data-vote="${isOpen ? "close" : "open"}" type="button">${isOpen ? "關閉評分" : "開放評分"}</button>
        </div>
      </div>`);
  }
  box.innerHTML = parts.join("");
}

document.getElementById("extra").addEventListener("click", (e) => {
  const seg = cur();
  const coin = e.target.closest("[data-coin]")?.dataset.coin;
  if (coin && seg?.session) {
    const first = coin === "random" ? (Math.random() < 0.5 ? "pro" : "con") : coin;
    act(() => liveUpdate({ coinFirst: { [seg.session]: first }, coinAt: Date.now() }));
    if (coin === "random") toast(`隨機結果：${SIDE_LABEL[first]}先`, "ok");
  }
  const vote = e.target.closest("[data-vote]")?.dataset.vote;
  if (vote) {
    const target = seg?.openVote || state?.voteOpen;
    act(() => liveUpdate({ voteOpen: vote === "open" ? { session: target.session, round: target.round } : null }));
  }
});

// ---------- 完整流程清單 ----------
function renderList() {
  const L = list();
  const i = idx();
  const times = planTimes(L);
  document.getElementById("rundown-list").innerHTML = `<ol class="ctl-list">${L.map((s, n) => `
    <li class="${n === i ? "is-now" : ""} ${i >= 0 && n < i ? "is-past" : ""}" data-jump="${n}">
      <span class="ctl-list-time">${fmtMinutes(times[n].start)}</span>
      <span class="ctl-list-title">${sideBadge(s)} ${esc(s.title)}</span>
      <span class="ctl-list-dur">${s.untilTime ? `到 ${esc(s.untilTime)}` : s.durationSec ? fmtClock(s.durationSec) : ""}</span>
    </li>`).join("")}</ol>`;
}

document.getElementById("rundown-list").addEventListener("click", async (e) => {
  const li = e.target.closest("[data-jump]");
  if (!li) return;
  const n = Number(li.dataset.jump);
  const L = list();
  if (n === idx()) return;
  const ok = await confirmDialog({
    title: "跳到這一段？",
    body: `<p>投影畫面會直接換到「<b>${esc(L[n].title)}</b>」，並重新開始倒數。</p>`,
    okText: "跳過去",
  });
  if (ok) act(() => enterSegment(L, n, state));
});

function renderAll() {
  if (!started) return;
  renderNow();
  renderButtons();
  renderExtra();
  renderList();
}
