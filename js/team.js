// 選手頁：打開老師建好的簡報、選每輪發言人、「我說完了」
import {
  doc, onSnapshot, setDoc, updateDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  startPage, login, db, COL, esc, toast, watchSettings, teamName, CATEGORIES,
} from "./common.js";
import { TEAM_IDS, SESSIONS, SIDE_LABEL } from "./defaults.js";
import { mountLiveBar } from "./livebar.js";
import { speakerPressDone, timing } from "./live.js";
import { isSlidesUrl, slidesEmbedUrl, slidesEditUrl } from "./slides.js";

const gate = document.getElementById("gate");
const area = document.getElementById("team-area");

let profile = null;
let settings = null;
let teamId = null;     // 正在看哪一組
let pub = {};          // debate_teams/{teamId}：members（名字）、slidesUrl、speakerNames
let priv = null;       // debate_teams/{teamId}/private/info：members [{email,name}]、speakers
let live = { state: null, list: [], index: -1 };
let stops = [];
let liveMounted = false;

startPage({
  active: "team",
  onProfile(p) {
    profile = p;
    if (!p) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>請先用學校帳號登入。</p>
        <button class="btn btn-primary" id="gate-login" type="button">學校帳號登入</button>`;
      gate.querySelector("#gate-login").addEventListener("click", login);
      return;
    }
    if (!p.team && !p.isAdmin) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>這一頁是給選手用的。你目前的身分是「${esc(p.label)}」。</p>`;
      return;
    }
    gate.classList.add("hidden");
    area.classList.remove("hidden");
    if (!liveMounted) {
      liveMounted = true;
      watchSettings((s) => { settings = s; renderHead(); renderSpeakers(); });
      mountLiveBar({ onChange(state, list, index) { live = { state, list, index }; renderDone(); } });
      setInterval(renderDoneTimer, 500);
    }
    // 管理員可以切換看四組（幫忙貼連結、選發言人）
    if (p.isAdmin && !p.team) {
      const tabs = document.getElementById("admin-tabs");
      tabs.classList.remove("hidden");
      tabs.innerHTML = `<span class="muted small">管理員：選擇組別</span>` + TEAM_IDS.map((t) =>
        `<button class="btn btn-small" data-team="${t}" type="button">${esc(CATEGORIES[t].label)}</button>`).join("");
      tabs.onclick = (e) => { const t = e.target.closest("[data-team]")?.dataset.team; if (t) selectTeam(t); };
      if (!teamId) selectTeam(TEAM_IDS[0]);
    } else if (teamId !== p.team) {
      selectTeam(p.team);
    }
  },
});

function selectTeam(t) {
  teamId = t;
  document.querySelectorAll("#admin-tabs [data-team]").forEach((b) => b.classList.toggle("btn-primary", b.dataset.team === t));
  stops.forEach((s) => s());
  pub = {};
  priv = null;
  speakersDirty = false;
  stops = [
    onSnapshot(doc(db, COL.teams, t), (snap) => {
      pub = snap.exists() ? snap.data() : {};
      renderHead();
      fillSlides();
      renderDone();
    }, (e) => toast(`讀取組別資料失敗：${e.message}`, "error")),
    onSnapshot(doc(db, COL.teams, t, "private", "info"), (snap) => {
      priv = snap.exists() ? snap.data() : { members: [], memberEmails: [] };
      renderSpeakers();
      renderDone();
    }, (e) => {
      console.error(e);
      priv = { members: [], memberEmails: [] };
      renderSpeakers();
    }),
  ];
}

const session = () => teamId?.split("_")[0];
const side = () => teamId?.split("_")[1];

// ---------- 組別標題 ----------
function renderHead() {
  if (!teamId) return;
  const names = pub.members || [];
  document.getElementById("team-head").className = `card team-head ${side()}`;
  document.getElementById("team-head").innerHTML = `
    <div class="row"><span class="badge badge-${side()}">${SIDE_LABEL[side()]}</span><span class="muted small">${SESSIONS[session()].label} ${SESSIONS[session()].start}</span></div>
    <h1 class="page-title" style="margin:8px 0 4px">${esc(teamName(teamId, settings))}</h1>
    <p style="margin:0"><b>題目：</b>${esc(settings?.topics?.[session()] || "")}</p>
    <p class="muted small" style="margin:6px 0 0">組員：${names.length ? names.map(esc).join("、") : "（名單尚未設定，請通知老師）"}</p>`;
}

// ---------- 簡報 ----------
// 四份簡報由老師在 Google Drive 建好、在後台設定網址；選手這裡只要點開來編輯

function fillSlides() {
  const url = pub.slidesUrl || "";
  const ok = isSlidesUrl(url);
  const msg = document.getElementById("slides-msg");
  msg.innerHTML = ok
    ? "老師已經幫你們建好簡報，點下面的按鈕直接編輯。改完<b>不用</b>做任何事，投影畫面會顯示最新版本。<br><span class=\"small muted\">如果打開說「需要存取權」，請確認你登入的是學校帳號，或請老師把你加成編輯者。</span>"
    : "老師還沒有設定你們這組的簡報，請稍等或通知老師。";
  const open = document.getElementById("open-slides");
  open.classList.toggle("hidden", !ok);
  if (ok) open.href = slidesEditUrl(url);
  const box = document.getElementById("slides-preview");
  const src = ok ? slidesEmbedUrl(url) : "";
  box.classList.toggle("hidden", !ok);
  if (ok && box.dataset.src !== src) {
    box.dataset.src = src;
    box.innerHTML = `<p class="small muted" style="margin:12px 0 6px">▼ 投影畫面會長這樣</p>
      <div class="slides-frame"><iframe src="${esc(src)}" title="簡報預覽" allowfullscreen></iframe></div>`;
  }
}

// 儲存失敗時，用看得懂的話說明原因
function saveErrorText(e) {
  if (e.code === "not-found") return "儲存失敗：這組的資料還沒建立。請老師到後台「名單」按一次「儲存名單」。";
  if (e.code === "permission-denied") return "儲存失敗：沒有權限。可能是 Firebase 規則還沒更新，或你不是這一組的組員。";
  return `儲存失敗：${e.message}`;
}

// ---------- 發言人 ----------
let speakersDirty = false;

function renderSpeakers() {
  if (!priv || speakersDirty) return;
  const members = priv.members || [];
  const sp = priv.speakers || {};
  const box = document.getElementById("speakers");
  if (!members.length) {
    box.innerHTML = `<p class="muted">名單尚未設定，請通知老師。</p>`;
    return;
  }
  const what = { 1: "發表觀點", 2: "回應問題", 3: "總結" };
  box.innerHTML = [1, 2, 3].map((r) => `
    <div class="field">
      <label for="sp-r${r}">第 ${r} 輪：${what[r]}</label>
      <select id="sp-r${r}" data-round="${r}">
        <option value="">（還沒決定）</option>
        ${members.map((m) => `<option value="${esc(m.email)}" ${sp[`r${r}`] === m.email ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      </select>
    </div>`).join("");
}
document.getElementById("speakers").addEventListener("change", () => { speakersDirty = true; });

document.getElementById("save-speakers").addEventListener("click", async () => {
  const members = priv?.members || [];
  const speakers = {};
  const speakerNames = {};
  document.querySelectorAll("#speakers select").forEach((sel) => {
    const r = `r${sel.dataset.round}`;
    speakers[r] = sel.value || null;
    speakerNames[r] = members.find((m) => m.email === sel.value)?.name || "";
  });
  try {
    // email 存在不公開的文件；名字存在公開的文件（投影畫面顯示用）。兩個一起寫入
    const batch = writeBatch(db);
    if (profile?.isAdmin) {
      batch.set(doc(db, COL.teams, teamId, "private", "info"), { speakers }, { merge: true });
      batch.set(doc(db, COL.teams, teamId), { speakerNames, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      batch.update(doc(db, COL.teams, teamId, "private", "info"), { speakers });
      batch.update(doc(db, COL.teams, teamId), { speakerNames, updatedAt: serverTimestamp() });
    }
    await batch.commit();
    speakersDirty = false;
    toast("發言人已儲存", "ok");
  } catch (e) {
    toast(saveErrorText(e), "error", 8000);
  }
});

// ---------- 我說完了 ----------
// 只有「目前段落是這組的發言、而且發言人是我本人」才會出現
function isMyTurn() {
  const s = live.state;
  if (!s || !profile || !priv) return false;
  if (s.speakerTeam !== teamId || !s.speakerRound) return false;
  return priv.speakers?.[`r${s.speakerRound}`] === profile.email;
}

function renderDone() {
  const box = document.getElementById("done-box");
  const seg = live.list[live.index];
  if (!isMyTurn()) {
    // 管理員看別組時，提示目前是誰在講
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const done = !!live.state.speakerDone;
  box.innerHTML = `
    <div class="card done-card ${done ? "is-done" : ""}">
      <p class="small" style="margin:0">現在輪到你：<b>${esc(seg?.title || "")}</b></p>
      <div class="done-timer" id="done-timer"></div>
      ${done
        ? `<div class="done-ok">✓ 已通知主持人，等待下一項</div>`
        : `<button class="btn btn-primary done-btn" id="done-btn" type="button">我說完了</button>
           <p class="small muted" style="margin:8px 0 0">講完了就按這個，投影畫面的計時會停下來。</p>`}
    </div>`;
  box.querySelector("#done-btn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await speakerPressDone();
    } catch (err) {
      e.target.disabled = false;
      toast(`沒有成功：${err.message}`, "error", 6000);
    }
  });
  renderDoneTimer();
}

function renderDoneTimer() {
  const el = document.getElementById("done-timer");
  if (!el || !live.state) return;
  const t = timing(live.state);
  if (!t.hasTimer) { el.textContent = ""; return; }
  const v = Math.round(t.remaining);
  const m = Math.floor(Math.abs(v) / 60);
  const s = String(Math.abs(v) % 60).padStart(2, "0");
  el.textContent = `${v < 0 ? "-" : ""}${m}:${s}`;
  el.classList.toggle("is-over", v < 0);
}
