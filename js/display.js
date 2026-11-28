// 投影畫面：依照主控台的即時狀態自動切換，不需要操作
// 投影電腦請用管理員（或控制老師）帳號開這頁，然後按「全螢幕」
import { setPixelText } from "./pixelnum.js";
import { collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { startPage, login, db, COL, esc, watchSettings, teamName } from "./common.js";
import {
  startClockSync, watchRundown, watchLive, voteCounter, orderedRundown, currentIndex, timing, fmtClock, endTimeText, serverNow,
} from "./live.js";
import { SESSIONS, SIDE_LABEL, TYPE_LABEL, fmtMinutes, LOOP_MUSIC } from "./defaults.js";
import { SoundBoard } from "./sound.js";
import { LocalMusic, musicPanel } from "./localmusic.js";
import { slidesEmbedUrl } from "./slides.js";

const stage = document.getElementById("stage");
const toolbar = document.getElementById("toolbar");
const sound = new SoundBoard();
const music = new LocalMusic();

// 這一段要播的音樂：依「🎵 選音樂」面板的設定（沒選＝不播）
// 「網站內建」用的是後台流程裡設定的音樂（還沒開始＝待機音樂）
const builtinOf = (seg) => (seg ? seg.music || null : "idle");
const musicFor = (seg) => {
  const k = builtinOf(seg);
  return music.track(seg, k, LOOP_MUSIC.includes(k));
};

const data = { settings: null, rundown: [], state: null, teams: {}, online: true, ready: false };
let started = false;

startPage({
  active: "",
  onProfile(p) {
    if (!p) {
      stage.innerHTML = `<div class="d-center">
        <p class="d-muted">投影畫面需要管理員或控制老師的帳號</p>
        <button class="btn btn-primary btn-big" id="screen-login" type="button">登入</button></div>`;
      stage.querySelector("#screen-login").addEventListener("click", login);
      return;
    }
    if (!p.canControl) {
      stage.innerHTML = `<div class="d-center"><p class="d-muted">${esc(p.email)} 不是管理員或控制老師，無法開啟投影畫面。</p></div>`;
      return;
    }
    if (!started) {
      started = true;
      subscribe();
      document.getElementById("sound-gate").classList.toggle("hidden", sound.enabled);
      setInterval(tick, 200);
    }
  },
});

function subscribe() {
  startClockSync();
  let got = 0;
  const ready = () => { if (++got >= 3) data.ready = true; render(); };
  watchSettings((s) => { data.settings = s; document.getElementById("tb-name").textContent = s.eventName; ready(); });
  watchRundown((r) => { data.rundown = r; ready(); });
  watchLive((s, meta) => { data.state = s; data.online = meta.online; followVotes(s?.voteOpen); followFeatured(s?.featuredCommentIds); ready(); });
  onSnapshot(collection(db, COL.teams), (snap) => {
    data.teams = {};
    snap.forEach((d) => { data.teams[d.id] = d.data(); });
    render();
  }, (e) => console.warn(e));
}

const list = () => orderedRundown(data.rundown, data.state);

// ============================================================
// 畫面
// ============================================================
let lastViewKey = "";

function render() {
  if (!data.ready || !data.settings) return;
  const L = list();
  const i = currentIndex(L, data.state);
  const seg = L[i] || null;
  const next = L[i + 1] || null;

  sound.setMusic(musicFor(seg));

  renderTopline(seg);

  // 只有「畫面內容」真的改變時才重畫（倒數數字由 tick() 每 0.2 秒更新），動畫才不會一直重來
  const viewKey = JSON.stringify([
    seg?.id, seg?.title, next?.title, data.state?.coinFirst, data.state?.coinAt, data.state?.voteOpen,
    data.settings.topics, data.settings.teamNames, data.settings.eventName,
    data.teams, showCommentsHere(seg) ? featuredList() : null,
  ]);
  // 簡報：先把「這一場」（或下一段所屬那一場）的兩份簡報載好
  ensureSlides(seg?.session || next?.session || null);

  if (viewKey === lastViewKey) return;
  lastViewKey = viewKey;

  const slideTeam = seg?.showSlides && seg.session ? `${seg.session}_${seg.showSlides}` : null;
  if (slideTeam && slideFrames[slideTeam]) return renderSlidesSegment(seg, next, slideTeam);
  showSlides(null);

  if (!seg) return renderStandby();
  if (seg.waitingRoom) return renderWaiting(seg);
  if (seg.type === "coin") return renderCoin(seg, next);
  if (seg.type === "ceremony") return renderCeremony(seg);
  renderSegment(seg, next);
}

function renderTopline(seg) {
  const s = data.settings;
  document.getElementById("d-context").innerHTML = seg?.session
    ? `<b>${esc(SESSIONS[seg.session].label)}</b>　題目：${esc(s.topics[seg.session])}`
    : `<b>${esc(s.eventName)}</b>`;
  document.getElementById("d-conn").className = `d-conn ${data.online ? "" : "off"}`;
  document.getElementById("d-conn").title = data.online ? "已連線" : "離線中：倒數照常進行，連線後自動同步";
}

// 這一段的發言人名字（選手在選手頁選的）
function speakerName(seg) {
  if (!seg || seg.type !== "speech" || !seg.session || !seg.side || !seg.speakerFromRound) return "";
  return data.teams[`${seg.session}_${seg.side}`]?.speakerNames?.[`r${seg.speakerFromRound}`] || "";
}
const withSpeaker = (seg) => seg ? `${esc(seg.title)}${speakerName(seg) ? `（${esc(speakerName(seg))}）` : ""}` : "";

const timerHtml = (cls = "") => `<div class="d-timer ${cls}" data-timer></div>`;
const statusHtml = () => `<div class="d-status" data-status></div>`;
const nextHtml = (next) => next ? `<div class="d-next"><b>下一項：</b>${withSpeaker(next)}</div>` : "";

// 段落上方的小標籤只放「ROUND n」：像素字型只適合英文數字，中英混排上下會對不齊

// ---------- 一般段落 ----------
function renderSegment(seg, next) {
  const side = seg.side || "";
  let center = `
    ${seg.round ? `<span class="d-pill ${side}">ROUND ${seg.round}</span>` : ""}
    <h1 class="d-title ${side}">${esc(seg.title)}</h1>
    ${speakerName(seg) ? `<div class="d-speaker">🎤 ${esc(speakerName(seg))}</div>` : ""}`;
  if (seg.showSlides) center += `<div class="d-muted small">本組未提供簡報</div>`;
  let panel = "";

  if (seg.showPlayers && seg.session) {
    center += timerHtml("small") + statusHtml() + playersHtml(seg.session);
  } else if (seg.showTopics) {
    center += timerHtml("small") + statusHtml() + `<div class="d-info" data-endinfo></div>` + topicsHtml();
  } else if (showCommentsHere(seg)) {
    center += featuredHtml();
  } else {
    center += timerHtml() + statusHtml();
    if (seg.type === "lunch") center += `<div class="d-info" data-endinfo></div>`;
  }
  center += nextHtml(next);

  // 休息、評審講評：右邊放投票 QR code
  if (seg.type === "break" || seg.type === "commentary") panel = votePanelHtml(seg);

  stage.innerHTML = `
    <div class="d-band ${side}"></div>
    <div class="d-main">
      <div class="d-col">${center}</div>
      ${panel ? `<aside class="d-side-panel">${panel}</aside>` : ""}
    </div>`;
  drawQr();
  showVoteCount();
  tick();
}

function playersHtml(session) {
  const team = (side) => {
    const id = `${session}_${side}`;
    const names = data.teams[id]?.members || [];
    return `<div class="d-team ${side}">
      <h3>${SIDE_LABEL[side]}｜${esc(teamName(id, data.settings))}</h3>
      <ol>${names.length ? names.map((n) => `<li>${esc(n)}</li>`).join("") : "<li>（名單尚未設定）</li>"}</ol>
    </div>`;
  };
  return `<div class="d-players">${team("pro")}<div class="d-vs">VS</div>${team("con")}</div>`;
}

function topicsHtml() {
  return `<div class="d-topics">${["am", "pm"].map((s) => `
    <div class="d-topic"><div class="head">${SESSIONS[s].label} ${SESSIONS[s].start}</div><p>${esc(data.settings.topics[s])}</p></div>`).join("")}</div>`;
}

function votePanelHtml(seg) {
  const v = data.state?.voteOpen;
  const round = seg.openVote?.round;
  const isOpen = v && seg.openVote && v.session === seg.openVote.session && v.round === seg.openVote.round;
  return `
    <div class="d-qr-card">
      <div class="d-qr" id="vote-qr"></div>
      <div class="d-vote-state ${isOpen ? "" : "off"}">${round ? `第 ${round} 輪評分${isOpen ? "開放中" : "已關閉"}` : "評分"}</div>
      <div class="d-vote-count" data-votecount></div>
    </div>
    ${seg.type === "break" ? `<div class="d-info" data-endinfo></div>` : ""}`;
}

// ---------- 老師挑的觀眾留言（live/state.featuredCommentIds） ----------
// 「宣讀高人氣觀眾留言」和第三輪主持人開場（回顧前兩輪＋觀眾留言）時顯示
const showCommentsHere = (seg) => !!seg && (seg.type === "comments" || /-r3-recap$/.test(seg.id || ""));
const featuredDocs = {};   // id → 留言資料（null＝讀取中或已刪除）
const featuredStops = {};
let featuredIds = [];
function followFeatured(ids) {
  featuredIds = Array.isArray(ids) ? ids.slice(0, 5) : [];
  for (const id of Object.keys(featuredStops)) {
    if (!featuredIds.includes(id)) { featuredStops[id](); delete featuredStops[id]; delete featuredDocs[id]; }
  }
  for (const id of featuredIds) {
    if (featuredStops[id]) continue;
    featuredDocs[id] = null;
    featuredStops[id] = onSnapshot(doc(db, COL.comments, id), (snap) => {
      featuredDocs[id] = snap.exists() ? snap.data() : null;
      render();
    }, (e) => console.warn(e));
  }
}
const featuredList = () => featuredIds.map((id) => featuredDocs[id]).filter((c) => c && !c.hidden)
  .map((c) => ({ text: c.text, name: c.authorName || "匿名", likes: c.likeCount || 0 }));
function featuredHtml() {
  const L = featuredList();
  if (!L.length) return `<div class="d-placeholder">老師還沒有挑選留言</div>`;
  return `<div class="d-comments n${L.length}">${L.map((c, i) => `
    <div class="d-comment">
      <span class="d-comment-no">${i + 1}</span>
      <p>${esc(c.text)}</p>
      <div class="d-comment-meta">— ${esc(c.name)}<span>♥ ${c.likes}</span></div>
    </div>`).join("")}</div>`;
}

// 已投票人數：只顯示人數，不顯示分數
let voteCount = null;
const followVotes = voteCounter((n) => { voteCount = n; showVoteCount(); });
function showVoteCount() {
  document.querySelectorAll("[data-votecount]").forEach((el) => {
    el.textContent = voteCount == null ? "" : `已有 ${voteCount} 人評分`;
  });
}

function voteUrl() {
  return new URL("vote.html", location.href).href.replace(/\?.*$/, "");
}

function drawQr() {
  const box = document.getElementById("vote-qr");
  if (!box || typeof window.qrcode !== "function") return;
  const qr = window.qrcode(0, "M");
  qr.addData(voteUrl());
  qr.make();
  box.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

// ============================================================
// 簡報
// ============================================================
const slideLayer = document.getElementById("slides-layer");
const slideFrames = {};   // teamId → <iframe>
let slidesSession = null;
let shownSlides = null;

// 同一場的兩份簡報一開始就載入；網址沒變就不重新載入
function ensureSlides(session) {
  if (!session) return;
  if (session !== slidesSession) {
    // 換場了（例如午餐後）：移除上一場的簡報
    for (const id of Object.keys(slideFrames)) {
      if (!id.startsWith(`${session}_`)) { slideFrames[id].remove(); delete slideFrames[id]; }
    }
    slidesSession = session;
  }
  for (const side of ["pro", "con"]) {
    const id = `${session}_${side}`;
    const src = slidesEmbedUrl(data.teams[id]?.slidesUrl || "");
    const f = slideFrames[id];
    if (!src) {
      if (f) { f.remove(); delete slideFrames[id]; }
      continue;
    }
    if (f && f.dataset.src === src) continue;
    if (f) f.remove();
    const iframe = document.createElement("iframe");
    iframe.dataset.src = src;
    iframe.src = src;
    iframe.title = `${SIDE_LABEL[side]}簡報`;
    iframe.allowFullscreen = true;
    iframe.className = "slide-frame";
    slideLayer.appendChild(iframe);
    slideFrames[id] = iframe;
    if (shownSlides === id) focusSlides();
  }
}

function showSlides(teamId) {
  shownSlides = teamId;
  for (const [id, f] of Object.entries(slideFrames)) f.classList.toggle("on", id === teamId);
  // 不用 display:none 藏起來（簡報在 0×0 的框裡載入可能會版面錯亂），改成移到畫面外
  slideLayer.classList.toggle("is-off", !teamId);
  if (teamId) { placeSlides(); focusSlides(); }
}

// 讓簡報筆的按鍵（方向鍵、PageDown）送進簡報：把鍵盤焦點交給簡報。簡報可能還在載入，多試幾次
function focusSlides() {
  const id = shownSlides;
  [0, 150, 600, 1500, 3000].forEach((ms) => setTimeout(() => {
    if (shownSlides !== id || !slideFrames[id]) return;
    try {
      slideFrames[id].focus();
      slideFrames[id].contentWindow?.focus();
    } catch (e) {
      console.warn("無法把焦點交給簡報", e);
    }
  }, ms));
}

// 簡報圖層對齊左邊的 16:9 區域
function placeSlides() {
  const area = document.getElementById("slides-area");
  if (!area || !shownSlides) return;
  const r = area.getBoundingClientRect();
  let w = r.width;
  let h = w * 9 / 16;
  if (h > r.height) { h = r.height; w = h * 16 / 9; }
  Object.assign(slideLayer.style, {
    left: `${r.left + (r.width - w) / 2}px`,
    top: `${r.top + (r.height - h) / 2}px`,
    width: `${w}px`,
    height: `${h}px`,
  });
}
window.addEventListener("resize", placeSlides);
document.addEventListener("fullscreenchange", () => { setTimeout(placeSlides, 100); focusSlides(); });

function renderSlidesSegment(seg, next, teamId) {
  const side = seg.showSlides;
  const name = speakerName(seg);
  stage.innerHTML = `
    <div class="d-band ${side}"></div>
    <div class="d-main with-slides">
      <div class="d-slides-area" id="slides-area"></div>
      <aside class="d-info-col">
        <div class="d-side-head ${side}">
          <span>${SIDE_LABEL[side]}｜${esc(teamName(teamId, data.settings))}</span>
        </div>
        <h1 class="d-info-title">${esc(seg.title)}</h1>
        ${name ? `<div class="d-speaker">🎤 ${esc(name)}</div>` : ""}
        ${timerHtml("in-col")}
        ${statusHtml()}
        ${next ? `<div class="d-next d-next-col"><b>下一項</b><br>${withSpeaker(next)}</div>` : ""}
      </aside>
    </div>`;
  showSlides(teamId);
  tick();
}

// ---------- 還沒開始 ----------
function renderStandby() {
  stage.innerHTML = `
    <div class="d-band"></div>
    <div class="d-center">
      <span class="d-pill">DEBATE DAY</span>
      <h1 class="d-title" style="font-size:clamp(48px,8vw,160px)">${esc(data.settings.eventName)}</h1>
      ${topicsHtml()}
    </div>`;
}

// ---------- 頒獎典禮（第 6 階段完成揭曉動畫） ----------
function renderCeremony(seg) {
  stage.innerHTML = `
    <div class="d-band"></div>
    <div class="d-center">
      <span class="d-pill">AWARDS</span>
      <h1 class="d-title" style="font-size:clamp(48px,9vw,180px)">${esc(seg.title)}</h1>
      <div class="d-placeholder">揭曉動畫會在第 6 階段完成</div>
    </div>`;
}

// ---------- 擲硬幣 ----------
let seenCoinAt = undefined;
function renderCoin(seg, next) {
  const first = data.state?.coinFirst?.[seg.session] || null;
  const coinAt = data.state?.coinAt || null;
  // 第一次載入頁面時，如果結果早就決定了，就直接顯示結果，不重播動畫
  const animate = first && seenCoinAt !== undefined && coinAt !== seenCoinAt;
  seenCoinAt = coinAt;
  const coinCls = !first ? "idle" : animate ? `flip-${first}` : `show-${first}`;
  stage.innerHTML = `
    <div class="d-band"></div>
    <div class="d-main"><div class="d-col">
      ${seg.round ? `<span class="d-pill">ROUND ${seg.round}</span>` : ""}
      <h1 class="d-title">${esc(seg.title)}</h1>
      <div class="coin-wrap"><div class="coin3d ${coinCls}">
        <div class="coin-face front">正</div><div class="coin-face back">反</div>
      </div></div>
      <div id="coin-result">${first && !animate ? coinResultHtml(first) : `<div class="d-status">${first ? "" : "猜對的一方決定先講還是後講"}</div>`}</div>
      ${nextHtml(next)}
    </div></div>`;
  if (animate) {
    setTimeout(() => {
      const box = document.getElementById("coin-result");
      if (box) box.innerHTML = coinResultHtml(first);
    }, 2700);
  }
}

function coinResultHtml(first) {
  const other = first === "pro" ? "con" : "pro";
  return `<div class="coin-result ${first}">${SIDE_LABEL[first]}先總結！</div>
    <div class="d-muted">接著由${SIDE_LABEL[other]}壓軸</div>`;
}

// ---------- 待機室（頒獎前） ----------
let tickerTimer = null;
function renderWaiting(seg) {
  const s = data.settings;
  const sparkles = Array.from({ length: 18 }, () => {
    const left = Math.random() * 100;
    const dur = 6 + Math.random() * 8;
    const delay = -Math.random() * dur;
    const size = 0.6 + Math.random() * 1.2;
    return `<i class="w-sparkle" style="left:${left}%;bottom:-2vh;width:${size}vh;height:${size}vh;animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join("");
  stage.innerHTML = `
    <div class="waiting">
      ${sparkles}
      <div class="w-soon">STARTING SOON</div>
      <div class="w-trophy-wrap"><div class="w-trophy" id="w-trophy"></div></div>
      <h1 class="w-title">${esc(seg.title)}</h1>
      <div class="w-timer" data-timer></div>
      <div class="w-progress"><div id="w-progress"></div></div>
      <div class="w-eq">${"<i></i>".repeat(14)}</div>
      <div class="w-ticker" id="w-ticker"></div>
    </div>`;
  drawTrophy();

  const lines = [
    "🏆 上午場和下午場的冠軍是誰？答案就在幾分鐘後！",
    `☀️ 上午場：${teamName("am_pro", s)} VS ${teamName("am_con", s)}`,
    `🌙 下午場：${teamName("pm_pro", s)} VS ${teamName("pm_con", s)}`,
    "🎤 今天的 MVP 會是誰？猜猜看！",
    "🗳️ 三輪評分加總決定勝負，評審和主持人的票是大票",
    "👏 先給今天所有選手、主持人和評審一個掌聲！",
    "📸 頒獎結束後要拍大合照，先別走喔！",
  ];
  let n = 0;
  const show = () => {
    const el = document.getElementById("w-ticker");
    if (!el) { clearInterval(tickerTimer); return; }
    el.innerHTML = `<span>${esc(lines[n++ % lines.length])}</span>`;
  };
  clearInterval(tickerTimer);
  show();
  tickerTimer = setInterval(show, 5000);
  tick();
}

// 像素獎盃：每個字元是一格
function drawTrophy() {
  const el = document.getElementById("w-trophy");
  if (!el) return;
  const art = [
    "..KKKKKKKKKK..",
    "KKYWWYYYYYDYKK",
    "KYKYWYYYYYDKYK",
    "KYKYWYYYYYDKYK",
    ".KKYWYYYYYDKK.",
    "...KYYYYYDK...",
    "....KYYYDK....",
    ".....KYDK.....",
    "......YD......",
    "......YD......",
    "....KOOOOK....",
    "...KOOOOOOK...",
    "...KKKKKKKK...",
  ];
  const col = { Y: "#ffd24d", W: "#fff6d6", D: "#d9a520", K: "#141414", O: "#ff8a1f" };
  const shadows = [];
  art.forEach((row, y) => [...row].forEach((c, x) => {
    if (col[c]) shadows.push(`${x - 7}px ${y - 6}px 0 ${col[c]}`);
  }));
  el.style.boxShadow = shadows.join(",");
  el.style.setProperty("--px", String(Math.max(6, Math.round(window.innerHeight * 0.014))));
}
window.addEventListener("resize", drawTrophy);

// ============================================================
// 每 0.2 秒：更新倒數、狀態文字、鈴聲
// ============================================================
let soundKey = "";
let prevRemaining = null;

function tick() {
  const d = new Date(serverNow());
  document.getElementById("d-clock").textContent = fmtMinutes(d.getHours() * 60 + d.getMinutes());
  if (!data.ready) return;

  const L = list();
  const seg = L[currentIndex(L, data.state)];
  const t = timing(data.state);
  const warn = Number(data.settings?.bellWarnSec ?? 30);

  document.querySelectorAll("[data-timer]").forEach((el) => {
    if (!t.hasTimer) { setPixelText(el, ""); return; }
    setPixelText(el, fmtClock(t.remaining));
    el.classList.toggle("is-warn", t.remaining > 0 && t.remaining <= warn);
    el.classList.toggle("is-over", t.remaining <= 0);
    el.classList.toggle("is-frozen", t.done || (t.paused && !t.waiting));
  });
  document.querySelectorAll("[data-status]").forEach((el) => {
    el.className = `d-status ${t.done ? "done" : ""}`;
    el.textContent = t.done ? "✓ 發言完畢" : t.waiting ? "準備中…" : t.paused ? "⏸ 暫停" : t.hasTimer && t.remaining <= 0 ? "時間到！" : "";
  });
  document.querySelectorAll("[data-endinfo]").forEach((el) => {
    const label = seg?.type === "lunch" ? "下午場開始" : "下一段開始";
    el.innerHTML = t.hasTimer && t.remaining > 0 ? `${label}<big>${endTimeText(t)}</big>` : `${label}<big>等主持人宣布</big>`;
  });
  const bar = document.getElementById("w-progress");
  if (bar && t.hasTimer && data.state.remainingAtStart > 0) {
    bar.style.width = `${Math.min(100, Math.max(0, (1 - t.remaining / data.state.remainingAtStart) * 100))}%`;
  }

  // 鈴聲：只在「這台電腦親眼看到」倒數跨過門檻時響一次（重新整理不會重響）
  const key = `${data.state?.segmentId}|${data.state?.startedAt?.toMillis?.()}|${data.state?.remainingAtStart}`;
  if (key !== soundKey) { soundKey = key; prevRemaining = null; }
  if (t.hasTimer && t.running) {
    if (prevRemaining != null) {
      if (prevRemaining > 0 && t.remaining <= 0) sound.effect(music.effect("bell"));
      else if (warn > 0 && prevRemaining > warn && t.remaining <= warn) sound.effect(music.effect("ding"));
    }
    prevRemaining = t.remaining;
  } else {
    prevRemaining = null;
  }
}

// ============================================================
// 工具列、音效、全螢幕、防休眠
// ============================================================
const gate = document.getElementById("sound-gate");
function enableSound() {
  sound.enable();
  gate.classList.add("hidden");
  const b = document.getElementById("sound-btn");
  b.textContent = "🔊 音效已啟用";
  b.disabled = true;
  keepAwake();
  focusSlides(); // 點按鈕時焦點會跑到頁面上，交回給簡報
}
gate.querySelector("button").addEventListener("click", enableSound);
document.getElementById("sound-btn").addEventListener("click", enableSound);

// ---------- 本機音樂：工具列上的小播放器＋選音樂面板 ----------
const musicUi = musicPanel({
  music,
  panel: document.getElementById("music-panel"),
  getSegments: () => list(),
  builtinOf,
  onChange: () => render(),
});
document.getElementById("music-btn").addEventListener("click", () => { musicUi.toggle(); showToolbar(); });
const mpToggle = document.getElementById("mp-toggle");
const mpName = document.getElementById("mp-name");
mpToggle.addEventListener("click", () => sound.togglePause());
sound.onChange = (st) => {
  mpName.textContent = st.label || "（這一段不播音樂）";
  mpName.title = st.label;
  mpToggle.textContent = st.playing ? "⏸" : "▶";
  mpToggle.disabled = !st.hasTrack;
  mpToggle.title = st.playing ? "暫停" : "播放";
};
sound.changed();
music.ready.then(() => render());

const vol = document.getElementById("volume");
vol.value = sound.volume;
vol.addEventListener("input", () => sound.setVolume(Number(vol.value)));

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}
document.getElementById("fullscreen").addEventListener("click", () => { toggleFullscreen(); focusSlides(); });
// 不小心點到投影畫面（不是簡報）時，焦點也交回給簡報
document.addEventListener("click", (e) => { if (!e.target.closest("input, button, select, .music-panel")) focusSlides(); });
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === "f" || e.key === "F") toggleFullscreen();
});

// 工具列和滑鼠游標：3 秒不動就隱藏
let hideTimer;
function showToolbar() {
  toolbar.classList.remove("is-hidden");
  document.body.classList.remove("no-cursor");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (musicUi.isOpen()) return showToolbar(); // 選音樂面板開著時，工具列不要藏起來
    toolbar.classList.add("is-hidden");
    document.body.classList.add("no-cursor");
  }, 3000);
}
document.addEventListener("mousemove", showToolbar);
showToolbar();

// 防止投影電腦休眠
let wakeLock = null;
async function keepAwake() {
  try {
    if ("wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (e) {
    console.warn("無法防止休眠", e);
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && sound.enabled) keepAwake();
});

// 網路斷線／恢復：連線燈立刻反應（倒數照常用本機時間繼續跑）
window.addEventListener("offline", () => { data.online = false; render(); });
window.addEventListener("online", () => { render(); });
