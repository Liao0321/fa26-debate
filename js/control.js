// 主控台：控制流程、計時、投票開關、猜硬幣
import {
  collection, doc, query, where, onSnapshot, updateDoc, getDocs, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// 建議用老師的手機或平板開（投影電腦只開 display.html，簡報筆才不會按到這一頁）
import {
  startPage, login, db, COL, esc, toast, confirmDialog, watchSettings,
} from "./common.js";
import {
  startClockSync, watchRundown, watchLive, orderedRundown, currentIndex, timing, fmtClock, endTimeText,
  enterSegment, pause, resume, adjust, restart, setSpeakerDone, liveUpdate, initialRemaining, segHasTimer, voteCounter,
} from "./live.js";
import { SESSIONS, SIDE_LABEL, TYPE_LABEL, planTimes, fmtMinutes } from "./defaults.js";
import { tallySession } from "./votes.js";
import { CEREMONY_STEPS, ROLE_TEXT, sessionResult, manualResult, mvpCandidates } from "./awards.js";

const gate = document.getElementById("gate");
const area = document.getElementById("control-area");

let settings = null;
let rundown = [];
let state = null;
let online = true;
let teams = {};
let started = false;
let profile = null;
let awards = undefined; // debate_awards/results（undefined 讀取中、null 還沒算）

startPage({
  active: "control",
  onProfile(p) {
    profile = p;
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
      watchLive((s, meta) => { state = s; online = meta.online; followVotes(s?.voteOpen); renderAll(); });
      onSnapshot(collection(db, COL.teams), (snap) => {
        teams = {};
        snap.forEach((d) => { teams[d.id] = d.data(); });
        renderAll();
      });
      watchComments(cmSession);
      onSnapshot(doc(db, COL.awards, "results"), (snap) => {
        awards = snap.exists() ? snap.data() : null;
        renderAll();
      }, (e) => {
        awards = null;
        document.getElementById("aw-box").innerHTML = `<div class="card muted">讀不到頒獎資料：${esc(e.message)}（安全規則可能還沒更新）</div>`;
      });
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

// 選手在選手頁選的發言人
function speakerOf(seg) {
  if (seg?.type !== "speech" || !seg.session || !seg.side || !seg.speakerFromRound) return "";
  return teams[`${seg.session}_${seg.side}`]?.speakerNames?.[`r${seg.speakerFromRound}`] || "";
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
      <div class="row">${state?.rehearsal ? `<span class="badge badge-yellow">彩排模式</span>` : ""}<span class="tag">STANDBY</span>${connDot()}</div>
      <h2 style="margin:10px 0">流程還沒開始</h2>
      <p class="muted small" style="margin-top:0">按下面的按鈕，投影畫面就會從第一段「${esc(L[0]?.title || "")}」開始。</p>
      <button class="btn btn-primary btn-big ctl-wide" id="start-btn" type="button">▶ 開始流程</button>`;
    box.querySelector("#start-btn").addEventListener("click", () => act(() => enterSegment(L, 0, state)));
    return;
  }
  const next = L[i + 1];
  box.innerHTML = `
    <div class="row">${state?.rehearsal ? `<span class="badge badge-yellow">彩排模式</span>` : ""}<span class="tag">NOW ${i + 1} / ${L.length}</span>${sideBadge(seg)}<span class="muted small">${esc(segLabel(seg))}</span><span class="spacer"></span>${connDot()}</div>
    <h2 class="now-title">${esc(seg.title)}</h2>
    ${seg.type === "speech" ? `<p style="margin:4px 0 0">🎤 發言人：<b>${esc(speakerOf(seg) || "（選手還沒選）")}</b></p>` : ""}
    <div class="now-timer" id="now-timer"></div>
    <div class="now-status" id="now-status"></div>
    <p class="now-next"><b>下一項：</b>${next ? esc(next.title) + (speakerOf(next) ? `（${esc(speakerOf(next))}）` : "") : "（已經是最後一段）"}</p>
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
    el.className = `now-timer ${t.remaining <= 0 ? "is-over" : t.remaining <= warn ? "is-warn" : ""} ${t.done || (t.paused && !t.waiting) ? "is-frozen" : ""}`;
    const seg = cur();
    const endText = ["break", "lunch", "idle"].includes(seg?.type) && t.remaining > 0 ? `・預計 ${endTimeText(t)} 結束` : "";
    status.textContent = t.done ? "✓ 發言完畢（等你按下一項）" : t.waiting ? "等待開始：選手準備好後按「▶ 開始計時」" : t.paused ? "⏸ 暫停中" : t.remaining <= 0 ? "時間到！（不會自動跳下一段）" : `倒數中${endText}`;
  }
  // 暫停按鈕的文字
  const pb = document.querySelector('[data-act="pause"]');
  if (pb) {
    const waiting = timing(state).waiting;
    pb.textContent = waiting ? "▶ 開始計時" : state?.paused ? "▶ 繼續" : "⏸ 暫停";
    pb.classList.toggle("btn-primary", !!waiting);
    pb.classList.toggle("is-pulse", !!waiting);
  }
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
// 已投票人數（只看人數，不看分數）
let voteCount = null;
const followVotes = voteCounter((n) => {
  voteCount = n;
  const el = document.querySelector("[data-votecount]");
  if (el) el.textContent = n != null ? `已投票：${n} 人` : "";
});

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
            <div class="small"><b data-votecount>${isOpen && voteCount != null ? `已投票：${voteCount} 人` : ""}</b></div>
          </div>
          <span class="badge ${isOpen ? "badge-orange" : "badge-gray"}">${isOpen ? "開放中" : "已關閉"}</span>
          <button class="btn ${isOpen ? "btn-danger" : "btn-primary"}" data-vote="${isOpen ? "close" : "open"}" type="button">${isOpen ? "關閉評分" : "開放評分"}</button>
        </div>
      </div>`);
  }
  // 頒獎典禮：揭曉步驟
  if (seg?.type === "ceremony") parts.push(`<div class="card aw-steps-card">${stepsHtml()}</div>`);
  box.innerHTML = parts.join("");
}

document.getElementById("extra").addEventListener("click", (e) => {
  if (onStepClick(e)) return;
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
// 平常只顯示目前前 2 段、後 5 段，按「展開全部」才列出整天的流程
let showAllRundown = false;
function renderList() {
  const L = list();
  const i = idx();
  const times = planTimes(L);
  const from = showAllRundown ? 0 : Math.max(0, i - 2);
  const to = showAllRundown ? L.length : Math.min(L.length, Math.max(i, 0) + 6);
  const hidden = L.length - (to - from);
  document.getElementById("rundown-list").innerHTML = `
    ${from > 0 ? `<p class="small muted ctl-list-more">⋯ 前面還有 ${from} 段</p>` : ""}
    <ol class="ctl-list" start="${from + 1}">${L.slice(from, to).map((s, k) => {
      const n = from + k;
      return `
    <li class="${n === i ? "is-now" : ""} ${i >= 0 && n < i ? "is-past" : ""}" data-jump="${n}">
      <span class="ctl-list-time">${fmtMinutes(times[n].start)}</span>
      <span class="ctl-list-title">${sideBadge(s)} ${esc(s.title)}</span>
      <span class="ctl-list-dur">${!segHasTimer(s) ? "不計時" : s.untilTime ? `到 ${esc(s.untilTime)}` : s.durationSec ? fmtClock(s.durationSec) : ""}</span>
    </li>`;
    }).join("")}</ol>
    ${to < L.length && !showAllRundown ? `<p class="small muted ctl-list-more">⋯ 後面還有 ${L.length - to} 段</p>` : ""}
    ${hidden > 0 || showAllRundown ? `<button class="btn btn-small" data-rundown-all type="button" style="margin-top:8px">${showAllRundown ? "只顯示前後幾段" : `展開全部 ${L.length} 段`}</button>` : ""}`;
}

document.getElementById("rundown-list").addEventListener("click", async (e) => {
  if (e.target.closest("[data-rundown-all]")) { showAllRundown = !showAllRundown; renderList(); return; }
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
  followCommentSession();
  renderComments();
  renderAwards();
}

// ============================================================
// 觀眾留言管理：挑 3～5 則投影、隱藏不適合的留言
// live/state.featuredCommentIds：投影中的留言（照挑選的順序）
// ============================================================
const MAX_FEATURED = 5;
let cmSession = "am";
let cmPicked = false;   // 老師自己切換過場次，就不再跟著目前段落
let cmAll = [];         // 這一場的所有留言（包含被隱藏的）
let cmStop = null;
const featured = () => (Array.isArray(state?.featuredCommentIds) ? state.featuredCommentIds : []);

// 投影留言的按鈕不用 act()：老師常常連續點好幾則，不能被「防連按」擋掉
function setFeatured(ids) {
  liveUpdate({ featuredCommentIds: ids }).catch((e) => toast(`操作失敗：${e.message}`, "error"));
}

function watchComments(s) {
  cmSession = s;
  cmStop?.();
  cmAll = [];
  cmStop = onSnapshot(query(collection(db, COL.comments), where("session", "==", s)), (snap) => {
    cmAll = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderComments();
  }, (e) => {
    document.getElementById("cm-ctl-list").innerHTML = `<p class="muted">讀不到留言：${esc(e.message)}（安全規則可能還沒更新）</p>`;
  });
}

// 跟著目前段落的場次切換（午餐、待機這些段落就看前面最近的一場）
function followCommentSession() {
  if (cmPicked) return;
  const L = list();
  let s = null;
  for (let i = idx(); i >= 0 && !s; i--) s = L[i]?.session || null;
  if (s && s !== cmSession) watchComments(s);
}

function cmLine(c, { inFeatured = false, pos = 0 } = {}) {
  const on = featured().includes(c.id);
  const full = !on && featured().length >= MAX_FEATURED;
  return `
    <div class="ctl-cm-item ${on && !inFeatured ? "is-featured" : ""} ${c.hidden ? "is-hidden" : ""}">
      ${inFeatured ? `<b class="ctl-cm-num">${pos}</b>` : ""}
      <div class="ctl-cm-body">
        <p>${esc(c.text)}</p>
        <div class="small muted">${esc(c.authorName || "匿名")}・♥ ${c.likeCount || 0}${c.hidden ? "・<b>已隱藏</b>" : ""}</div>
      </div>
      <div class="ctl-cm-acts">
        ${c.hidden ? "" : `<button class="btn btn-small ${on ? "" : "btn-primary"}" data-cm-feature="${c.id}" type="button" ${full ? "disabled" : ""}>${on ? "取消投影" : "投影"}</button>`}
        ${inFeatured ? "" : `<button class="btn btn-small ${c.hidden ? "" : "btn-ghost"}" data-cm-hide="${c.id}" type="button">${c.hidden ? "取消隱藏" : "隱藏"}</button>`}
      </div>
    </div>`;
}

function renderComments() {
  const tabs = document.getElementById("cm-ctl-tabs");
  if (!tabs) return;
  tabs.innerHTML = Object.entries(SESSIONS).map(([k, v]) =>
    `<button class="btn btn-small ${k === cmSession ? "btn-primary" : ""}" data-cm-session="${k}" type="button">${esc(v.label)}</button>`).join("")
    + `<span class="small muted">${cmAll.filter((c) => !c.hidden).length} 則留言</span>`;
  const byId = Object.fromEntries(cmAll.map((c) => [c.id, c]));
  const f = featured();
  const fx = f.map((id, i) => byId[id] ? cmLine(byId[id], { inFeatured: true, pos: i + 1 }) : "").join("");
  const other = f.length && !f.some((id) => byId[id]);
  document.getElementById("cm-featured").innerHTML = `
    <div class="row" style="margin-bottom:6px">
      <b>投影中：${f.length}／${MAX_FEATURED} 則</b>
      <span class="spacer"></span>
      ${f.length ? `<button class="btn btn-small btn-ghost" data-cm-clear type="button">全部取消</button>` : ""}
    </div>
    ${fx || (other ? `<p class="small muted" style="margin:0">投影中的留言是另一場的，切換場次就看得到。</p>`
      : `<p class="small muted" style="margin:0">還沒有挑留言。建議挑 3～5 則。</p>`)}`;
  const sorted = [...cmAll].sort((a, b) => (a.hidden - b.hidden) || (b.likeCount || 0) - (a.likeCount || 0));
  document.getElementById("cm-ctl-list").innerHTML = sorted.length
    ? sorted.map((c) => cmLine(c)).join("")
    : `<p class="muted" style="margin:0">這一場還沒有留言。</p>`;
}

document.getElementById("sec-comments").addEventListener("click", (e) => {
  const s = e.target.closest("[data-cm-session]")?.dataset.cmSession;
  if (s) { cmPicked = true; watchComments(s); renderComments(); return; }
  const fid = e.target.closest("[data-cm-feature]")?.dataset.cmFeature;
  if (fid) {
    const f = featured();
    const next = f.includes(fid) ? f.filter((x) => x !== fid) : [...f, fid].slice(0, MAX_FEATURED);
    setFeatured(next);
    return;
  }
  if (e.target.closest("[data-cm-clear]")) { setFeatured([]); return; }
  const hid = e.target.closest("[data-cm-hide]")?.dataset.cmHide;
  if (hid) {
    const c = cmAll.find((x) => x.id === hid);
    if (!c) return;
    const hide = !c.hidden;
    // 隱藏時順便從投影中拿掉
    if (hide && featured().includes(hid)) setFeatured(featured().filter((x) => x !== hid));
    updateDoc(doc(db, COL.comments, hid), { hidden: hide }).catch((err) => toast(`操作失敗：${err.message}`, "error"));
  }
});

// ============================================================
// 頒獎典禮
//   ① 計算結果（要讀名單，所以用管理員帳號）→ debate_awards/results
//   ② 選兩位 MVP（上午場、下午場各一位）
//   ③ 三個揭曉步驟：live/state.ceremonyStep（1 上午場、2 下午場、3 MVP），投影畫面播動畫
// ============================================================
const awardsRef = () => doc(db, COL.awards, "results");
const teamLabel = (id) => settings?.teamNames?.[id] || `${SESSIONS[id.split("_")[0]].label}${SIDE_LABEL[id.split("_")[1]]}`;
const stepNow = () => Number(state?.ceremonyStep) || 0;
let awBusy = false;

function awTime(t) {
  const d = t?.toDate ? t.toDate() : null;
  return d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "";
}

// 某一步能不能揭曉：缺什麼就回傳說明文字
function stepProblem(step) {
  const st = CEREMONY_STEPS[step];
  if (!st || step === 0) return "";
  if (!awards) return "還沒按「計算結果」";
  if (st.session) {
    const r = awards[st.session];
    if (!r) return "還沒按「計算結果」";
    if (!r.winner) return `${SESSIONS[st.session].label}平手，請先指定優勝組`;
    return "";
  }
  const miss = ["am", "pm"].filter((s) => !awards.mvp?.[s]).map((s) => SESSIONS[s].label);
  return miss.length ? `還沒選${miss.join("、")} MVP` : "";
}

function stepsHtml() {
  const now = stepNow();
  const inCeremony = cur()?.type === "ceremony";
  return `
    <h3 style="margin-top:0">頒獎揭曉步驟</h3>
    ${inCeremony ? "" : `<p class="small aw-warn">投影畫面要先切到「頒獎典禮」這一段，按了才看得到。</p>`}
    <div class="aw-steps">
      ${CEREMONY_STEPS.map((st) => {
        const prob = stepProblem(st.step);
        return `<button class="btn ctl-btn aw-step ${st.step === now ? "btn-primary" : ""}" data-aw-step="${st.step}" type="button" ${prob ? `title="${esc(prob)}"` : ""}>
          ${st.step ? `<b>${st.step}</b>` : ""}${esc(st.label)}${prob ? `<small>⚠️ ${esc(prob)}</small>` : st.step && st.step < now ? "<small>✓ 已揭曉</small>" : ""}</button>`;
      }).join("")}
    </div>
    <div class="row" style="margin-top:10px">
      <span class="small muted">每一步動畫播完會出現「請老師上台頒獎」。</span>
      <span class="spacer"></span>
      <button class="btn btn-small" data-aw-replay type="button" ${now ? "" : "disabled"}>↻ 重播這一步的動畫</button>
    </div>`;
}

// 揭曉按鈕：不用 act()（不會跟上一項、下一項互相擋住）
function onStepClick(e) {
  const b = e.target.closest("[data-aw-step]");
  if (b) {
    const step = Number(b.dataset.awStep);
    const prob = stepProblem(step);
    if (prob) { toast(`還不能揭曉：${prob}`, "error", 4000); return true; }
    if (step === stepNow() && step !== 0) {
      confirmDialog({ title: "重播這一步？", body: `<p>投影畫面會重新播一次「${esc(CEREMONY_STEPS[step].label)}」的動畫。</p>`, okText: "重播" })
        .then((ok) => ok && setStep(step));
      return true;
    }
    setStep(step);
    return true;
  }
  if (e.target.closest("[data-aw-replay]")) { setStep(stepNow()); return true; }
  return false;
}
function setStep(step) {
  liveUpdate({ ceremonyStep: step, ceremonyAt: Date.now() }).catch((err) => toast(`操作失敗：${err.message}`, "error"));
}

function renderAwards() {
  const box = document.getElementById("aw-box");
  if (!box || awards === undefined) return;
  const isAdmin = !!profile?.isAdmin;
  const sessionHtml = (s) => {
    const r = awards?.[s];
    if (!r) return `<div class="aw-ses"><b>${esc(SESSIONS[s].label)}</b>：還沒計算</div>`;
    const tie = !r.winner || r.decidedBy === "manual";
    const how = { total: "依加權總分", judge: "總分平手，依評審與主持人的分數", manual: "平手，老師指定" }[r.decidedBy] || "";
    return `
      <details class="aw-ses" data-aw-ses="${s}" ${!r.winner ? "open" : ""}>
        <summary><b>${esc(SESSIONS[s].label)}</b>：${r.winner ? "已算好（點開看優勝組）" : `<span class="aw-warn">${r.voters ? "平手，請指定優勝組" : "還沒有人評分"}</span>`}</summary>
        ${r.winner ? `<p style="margin:6px 0">🏆 優勝：<span class="badge badge-${r.winner}">${SIDE_LABEL[r.winner]}</span> <b>${esc(teamLabel(`${s}_${r.winner}`))}</b>
          <span class="small muted">（${how}・${r.voters} 張票）</span></p>` : ""}
        <p class="small muted" style="margin:4px 0">投影時丟的鮮花：正方 ${r.flowers?.pro ?? 0} 朵、反方 ${r.flowers?.con ?? 0} 朵（照分數比例換算，不顯示分數）</p>
        ${tie ? `<div class="row"><span class="small">指定優勝組：</span>
          ${["pro", "con"].map((side) => `<button class="btn btn-small ${r.winner === side ? `btn-${side}` : ""}" data-aw-manual="${s}:${side}" type="button">${SIDE_LABEL[side]}・${esc(teamLabel(`${s}_${side}`))}</button>`).join("")}</div>` : ""}
      </details>`;
  };
  const mvpHtml = (s) => {
    const list = awards?.candidates?.[s] || [];
    const pick = awards?.mvp?.[s] || "";
    const inList = list.some((c) => c.name === pick);
    return `<label class="aw-mvp"><b>${esc(SESSIONS[s].label)} MVP</b>
      <select data-aw-mvp="${s}" ${list.length ? "" : "disabled"}>
        <option value="">（還沒選）</option>
        ${list.map((c) => `<option value="${esc(c.name)}" ${c.name === pick ? "selected" : ""}>${esc(c.name)}（${ROLE_TEXT[c.role] || ""}）</option>`).join("")}
        ${pick && !inList ? `<option value="${esc(pick)}" selected>${esc(pick)}</option>` : ""}
      </select></label>`;
  };
  const html = `
    <div class="card">
      <div class="row">
        <h3 style="margin:0">① 計算優勝組</h3>
        <span class="spacer"></span>
        <button class="btn ${awards ? "" : "btn-primary"}" data-aw-compute type="button" ${isAdmin && !awBusy ? "" : "disabled"}>${awBusy ? "計算中…" : awards ? "重新計算" : "計算結果"}</button>
      </div>
      <p class="small muted" style="margin:6px 0 10px">${isAdmin
        ? "依三輪加權總分決定；總分一樣就看評審和主持人的分數；還是一樣就由老師指定。評分全部結束後再按一次，結果才是最新的。"
        : "計算要讀名單，請用<b>管理員帳號</b>按。控制老師可以選 MVP、平手時指定優勝組。"}
        ${awards?.computedAt ? `上次計算：${awTime(awards.computedAt)}` : ""}</p>
      ${sessionHtml("am")}${sessionHtml("pm")}
    </div>
    <div class="card">
      <h3 style="margin-top:0">② 選兩位 MVP</h3>
      <p class="small muted" style="margin-top:0">${awards?.candidates ? "投影畫面的拉霸機會轉這一場所有選手、主持人和評審的名字，最後停在你選的人。" : "先按「計算結果」，才會載入候選人名單。"}</p>
      <div class="aw-mvps">${mvpHtml("am")}${mvpHtml("pm")}</div>
    </div>
    <div class="card">${stepsHtml()}</div>`;
  // 內容沒變就不重畫（老師點開的結果、正在選的選單才不會被關掉）
  if (html === lastAwardsHtml) return;
  lastAwardsHtml = html;
  const open = [...box.querySelectorAll("details[data-aw-ses]")].filter((d) => d.open).map((d) => d.dataset.awSes);
  box.innerHTML = html;
  open.forEach((s) => { const d = box.querySelector(`details[data-aw-ses="${s}"]`); if (d) d.open = true; });
}
let lastAwardsHtml = "";

async function computeResults() {
  if (awBusy) return;
  awBusy = true;
  renderAwards();
  try {
    const [rs, vs] = await Promise.all([getDocs(collection(db, COL.roster)), getDocs(collection(db, COL.votes))]);
    const roster = rs.docs.map((d) => ({ email: d.id, ...d.data() }));
    const byEmail = Object.fromEntries(roster.map((r) => [r.email, r]));
    const votes = vs.docs.map((d) => d.data());
    const out = { candidates: {}, computedAt: serverTimestamp() };
    for (const s of Object.keys(SESSIONS)) {
      const prev = awards?.[s];
      const manual = prev?.decidedBy === "manual" ? prev.winner : null;
      out[s] = sessionResult(tallySession(votes, byEmail, s, { judgeWeight: settings?.judgeWeight ?? 3, manualWinner: manual }));
      out.candidates[s] = mvpCandidates(roster, s);
    }
    await setDoc(awardsRef(), out, { merge: true });
    const ties = Object.keys(SESSIONS).filter((s) => !out[s].winner);
    toast(ties.length ? `算好了，但${ties.map((s) => SESSIONS[s].label).join("、")}平手，請指定優勝組` : "結果算好了", ties.length ? "error" : "ok", 4000);
  } catch (e) {
    console.error(e);
    toast(`計算失敗：${e.message}`, "error", 5000);
  } finally {
    awBusy = false;
    renderAwards();
  }
}

document.getElementById("sec-awards").addEventListener("click", (e) => {
  if (onStepClick(e)) return;
  if (e.target.closest("[data-aw-compute]")) { computeResults(); return; }
  const m = e.target.closest("[data-aw-manual]")?.dataset.awManual;
  if (m) {
    const [s, side] = m.split(":");
    setDoc(awardsRef(), { [s]: manualResult(awards?.[s], side) }, { merge: true })
      .then(() => toast(`${SESSIONS[s].label}優勝：${SIDE_LABEL[side]}`, "ok"))
      .catch((err) => toast(`操作失敗：${err.message}`, "error"));
  }
});
document.getElementById("sec-awards").addEventListener("change", (e) => {
  const sel = e.target.closest("[data-aw-mvp]");
  if (!sel) return;
  setDoc(awardsRef(), { mvp: { [sel.dataset.awMvp]: sel.value } }, { merge: true })
    .then(() => toast(sel.value ? `${SESSIONS[sel.dataset.awMvp].label} MVP：${sel.value}` : "已取消", "ok"))
    .catch((err) => toast(`操作失敗：${err.message}`, "error"));
});
