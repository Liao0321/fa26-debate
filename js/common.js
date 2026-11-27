// 全站共用：Firebase 初始化、登入、身分判斷、頁首選單、提示視窗
// （大部分沿用提案比賽網站 fa26-pitch 的寫法）
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  firebaseConfig, EVENT_NAME, SCHOOL_DOMAIN, OWNER_ADMINS,
} from "./firebase-config.js";
import { DEFAULT_SETTINGS, TEAM_IDS } from "./defaults.js";

export const configReady = !String(firebaseConfig.apiKey).includes("請貼上");
export const app = configReady ? initializeApp(firebaseConfig) : null;
export const auth = configReady ? getAuth(app) : null;
export const db = configReady ? getFirestore(app) : null;

// ------------------------------------------------------------
// Firestore 集合名稱
// 和提案比賽共用同一個 Firebase 專案，所以辯論比賽的集合一律加 debate_ 開頭，
// 兩個網站的資料才不會互相覆蓋。firestore.rules 裡也是用這些名稱。
// ------------------------------------------------------------
export const COL = {
  config: "debate_config",     // settings（活動設定）、rundown（流程）
  roster: "debate_roster",     // 名單
  teams: "debate_teams",       // 四組的簡報連結、發言人
  live: "debate_live",         // 即時狀態
  votes: "debate_votes",       // 評分
  comments: "debate_comments", // 留言
  awards: "debate_awards",     // MVP
  clock: "debate_clock",       // 校時用的暫存文件（每人一份）
};

// ------------------------------------------------------------
// 目前已經完成到第幾個開發階段：還沒做好的頁面，選單和首頁會顯示「準備中」
// ------------------------------------------------------------
export const BUILT_STAGE = 3;

// ---------- 小工具 ----------
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function accountOf(email) {
  return String(email || "").split("@")[0];
}

export function isSchoolEmail(email) {
  return String(email || "").toLowerCase().endsWith("@" + SCHOOL_DOMAIN);
}

// ---------- 內建瀏覽器偵測（LINE / FB / IG…） ----------
export function detectInAppBrowser() {
  const ua = navigator.userAgent || "";
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "Facebook";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/MicroMessenger/i.test(ua)) return "微信";
  if (/; wv\)/.test(ua)) return "App 內建瀏覽器";
  return null;
}

function handleInAppBrowser() {
  const inApp = detectInAppBrowser();
  if (!inApp) return null;
  // LINE：加上 openExternalBrowser=1 會自動改用手機預設瀏覽器開啟
  if (inApp === "LINE") {
    const url = new URL(location.href);
    if (url.searchParams.get("openExternalBrowser") !== "1") {
      url.searchParams.set("openExternalBrowser", "1");
      location.replace(url.toString());
    }
  }
  const bar = document.createElement("div");
  bar.className = "inapp-banner";
  bar.innerHTML = `
    <strong>⚠️ 你正在用 ${esc(inApp)} 內建瀏覽器開啟</strong>
    <span>Google 不允許在這裡登入。請點右上角「⋯」選擇「用 Safari / Chrome 開啟」，或複製網址貼到瀏覽器。</span>
    <button class="btn btn-small" type="button">複製網址</button>`;
  bar.querySelector("button").addEventListener("click", async () => {
    const clean = new URL(location.href);
    clean.searchParams.delete("openExternalBrowser");
    try {
      await navigator.clipboard.writeText(clean.toString());
      toast("已複製網址，請貼到 Safari 或 Chrome", "ok");
    } catch {
      prompt("請長按複製這個網址：", clean.toString());
    }
  });
  document.body.prepend(bar);
  return inApp;
}

// ---------- 提示訊息 ----------
export function toast(message, type = "info", ms = 3200) {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 400);
}

// 確認視窗：回傳 Promise<boolean>
// requireText：必須輸入這段文字才能按確認（用於危險操作）
export function confirmDialog({ title, body = "", okText = "確認", cancelText = "取消", danger = false, requireText = "" }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${body}</div>
        ${requireText ? `<div class="field" style="margin-top:12px">
          <label>請輸入「${esc(requireText)}」以確認</label>
          <input type="text" data-require autocomplete="off">
        </div>` : ""}
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="no" type="button">${esc(cancelText)}</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="yes" type="button">${esc(okText)}</button>
        </div>
      </div>`;
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close(false);
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) close(act === "yes");
    });
    document.body.appendChild(wrap);
    const yes = wrap.querySelector('[data-act="yes"]');
    const typed = wrap.querySelector("[data-require]");
    if (typed) {
      yes.disabled = true;
      typed.addEventListener("input", () => { yes.disabled = typed.value.trim() !== requireText; });
      typed.focus();
    } else {
      yes.focus();
    }
  });
}

// ---------- 登入 ----------
let inAppName = null;

export async function login() {
  if (!configReady) {
    toast("網站尚未設定 Firebase，請先完成 firebase-config.js", "error");
    return;
  }
  if (inAppName) {
    await confirmDialog({
      title: "請改用 Safari / Chrome 開啟",
      body: `<p>你目前在 ${esc(inAppName)} 的內建瀏覽器，Google 會擋下登入。</p>
             <p>請點右上角「⋯」→「用瀏覽器開啟」，或用上方的「複製網址」按鈕。</p>`,
      okText: "我知道了",
      cancelText: "關閉",
    });
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: SCHOOL_DOMAIN, prompt: "select_account" });
  try {
    const result = await signInWithPopup(auth, provider);
    const u = result.user;
    if (!isSchoolEmail(u.email) || !u.emailVerified) {
      await signOut(auth);
      toast(`只能使用 @${SCHOOL_DOMAIN} 的學校帳號登入`, "error", 5000);
    }
  } catch (e) {
    const messages = {
      "auth/popup-blocked": "登入視窗被瀏覽器擋住了，請允許「彈出式視窗」後再按一次登入。",
      "auth/popup-closed-by-user": "登入視窗被關閉了，請再按一次登入。",
      "auth/cancelled-popup-request": "",
      "auth/unauthorized-domain": "這個網址還沒加入 Firebase「已授權網域」，請通知管理員。",
      "auth/network-request-failed": "網路連線失敗，請確認網路後再試一次。",
      "auth/web-storage-unsupported": "瀏覽器封鎖了必要的儲存功能，請關閉無痕模式或改用 Chrome / Safari。",
    };
    const msg = e.code in messages ? messages[e.code] : `登入失敗（${e.code || e.message}），請改用 Chrome / Safari 再試一次。`;
    if (msg) toast(msg, "error", 6000);
  }
}

export function logout() {
  return signOut(auth);
}

// ---------- 身分 ----------
// 名單上的類別（一個人只能有一個類別）
// key 存進 Firestore；label 是畫面上顯示的中文
export const CATEGORIES = {
  admin:      { label: "管理員" },
  controller: { label: "控制老師" },
  teacher:    { label: "老師" },
  am_pro:     { label: "上午正方", session: "am", role: "player", side: "pro" },
  am_con:     { label: "上午反方", session: "am", role: "player", side: "con" },
  pm_pro:     { label: "下午正方", session: "pm", role: "player", side: "pro" },
  pm_con:     { label: "下午反方", session: "pm", role: "player", side: "con" },
  am_host:    { label: "上午主持", session: "am", role: "host" },
  pm_host:    { label: "下午主持", session: "pm", role: "host" },
  am_judge:   { label: "上午評審", session: "am", role: "judge" },
  pm_judge:   { label: "下午評審", session: "pm", role: "judge" },
  student:    { label: "學生" },
};

export function categoryLabel(key) {
  return CATEGORIES[key]?.label || "觀眾";
}

// 組名：後台有填就用後台的，沒填就用「上午正方」
export function teamName(teamId, settings) {
  return settings?.teamNames?.[teamId] || CATEGORIES[teamId]?.label || teamId;
}

// profile = null（未登入）或
// { uid, email, account, name, category, label, isAdmin, canControl, inRoster }
export function buildProfile(user, roster) {
  const email = user.email.toLowerCase();
  const r = roster || {};
  const category = CATEGORIES[r.category] ? r.category : null;
  const isAdmin = OWNER_ADMINS.includes(email) || r.isAdmin === true;
  const canControl = isAdmin || r.canControl === true;
  const p = {
    uid: user.uid,
    email,
    account: accountOf(email),
    name: r.name || user.displayName || accountOf(email),
    category,
    inRoster: !!roster,
    isAdmin,
    canControl,
    team: TEAM_IDS.includes(category) ? category : null, // 選手所屬的組
  };
  p.label = category ? CATEGORIES[category].label : isAdmin ? "管理員" : "觀眾";
  return p;
}

// 這個人在某一場（am / pm）的角色："player" 選手、"host" 主持、"judge" 評審、"audience" 觀眾
export function sessionRole(profile, session) {
  const c = CATEGORIES[profile?.category];
  if (c && c.session === session) return c.role;
  return "audience";
}

// 這個人在某一場投票的倍數（選手不能投，回傳 0）
export function voteWeight(profile, session, settings) {
  const role = sessionRole(profile, session);
  if (role === "player") return 0;
  if (role === "host" || role === "judge") return Number(settings?.judgeWeight) || DEFAULT_SETTINGS.judgeWeight;
  return 1;
}

function mergeSettings(data) {
  const d = data || {};
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    topics: { ...DEFAULT_SETTINGS.topics, ...(d.topics || {}) },
    teamNames: { ...DEFAULT_SETTINGS.teamNames, ...(d.teamNames || {}) },
  };
}

// 活動設定（debate_config/settings），還沒設定過就用 defaults.js 的預設值
export function watchSettings(cb) {
  if (!configReady) { cb(mergeSettings()); return () => {}; }
  return onSnapshot(doc(db, COL.config, "settings"), (snap) => {
    cb({ ...mergeSettings(snap.exists() ? snap.data() : null), _exists: snap.exists() });
  }, (err) => {
    console.error(err);
    cb(mergeSettings());
  });
}

// ---------- 頁面清單 ----------
// stage：哪個開發階段做好；show：誰看得到
export const PAGES = [
  { id: "home", href: "index.html", label: "首頁", stage: 1 },
  { id: "vote", href: "vote.html", label: "評分", desc: "每輪休息時幫正反方打分數", stage: 4, show: (p) => !!p },
  { id: "comments", href: "comments.html", label: "留言牆", desc: "留言、幫別人的留言按讚", stage: 5, show: (p) => !!p },
  { id: "team", href: "team.html", label: "選手頁", desc: "貼簡報連結、選發言人、我說完了", stage: 3, show: (p) => p && (p.team || p.isAdmin) },
  { id: "control", href: "control.html", label: "主控台", desc: "控制流程、計時、投票、留言", stage: 2, show: (p) => p && p.canControl },
  { id: "display", href: "display.html", label: "投影畫面", desc: "投影電腦全螢幕開這頁（會開新分頁）", newTab: true, stage: 2, show: (p) => p && p.isAdmin },
  { id: "admin", href: "admin.html", label: "後台", desc: "名單、題目、組名、加權設定", stage: 1, show: (p) => p && p.isAdmin },
];

export function pageReady(page) {
  return page.stage <= BUILT_STAGE;
}

// ---------- 頁首 ----------
function renderHeader(active, profile, settings) {
  const header = document.getElementById("site-header");
  if (!header) return;
  const links = PAGES.filter((n) => pageReady(n) && (!n.show || n.show(profile)))
    .map((n) => `<a href="${n.href}" ${n.newTab ? 'target="_blank" rel="noopener"' : ""} class="${n.id === active ? "active" : ""}">${n.label}</a>`)
    .join("");
  const user = profile
    ? `<div class="user-chip">
         <span class="user-account">${esc(profile.account)}</span>
         <span class="user-roles">${esc(profile.label)}</span>
       </div>
       <button class="btn btn-small btn-ghost" id="logout-btn" type="button">登出</button>`
    : `<button class="btn btn-small btn-primary" id="login-btn" type="button">學校帳號登入</button>`;
  header.innerHTML = `
    <div class="header-row container">
      <a class="brand" href="index.html">
        <img class="brand-mark" src="img/logo.svg" alt="">
        <span class="brand-text">${esc(settings?.eventName || EVENT_NAME)}</span>
      </a>
      <div class="header-user">${user}</div>
    </div>
    <nav class="main-nav"><div class="container nav-scroll">${links}</div></nav>`;
  header.querySelector("#login-btn")?.addEventListener("click", login);
  header.querySelector("#logout-btn")?.addEventListener("click", logout);
  document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
}

// 每一頁都呼叫：startPage({ active: "home", onProfile: (profile) => {...} })
// onProfile 會在「登入狀態或名單身分」改變時再次被呼叫
export function startPage({ active, onProfile = () => {} }) {
  if (!document.querySelector('link[rel="icon"]')) {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = "img/logo.svg";
    document.head.appendChild(icon);
  }
  inAppName = handleInAppBrowser();
  let profile = null;
  let settings = null;
  renderHeader(active, null, null);

  if (!configReady) {
    const warn = document.createElement("div");
    warn.className = "inapp-banner";
    warn.innerHTML = `<strong>網站尚未設定 Firebase</strong><span>請把設定貼進 js/firebase-config.js。</span>`;
    document.body.prepend(warn);
    onProfile(null);
    return;
  }

  // 頁首的活動名稱跟著後台設定
  watchSettings((s) => { settings = s; renderHeader(active, profile, settings); });

  let stopRoster = null;
  onAuthStateChanged(auth, (user) => {
    stopRoster?.();
    stopRoster = null;
    if (!user || !isSchoolEmail(user.email)) {
      profile = null;
      renderHeader(active, null, settings);
      onProfile(null);
      return;
    }
    const email = user.email.toLowerCase();
    stopRoster = onSnapshot(doc(db, COL.roster, email), (snap) => {
      profile = buildProfile(user, snap.exists() ? snap.data() : null);
      renderHeader(active, profile, settings);
      onProfile(profile);
    }, (err) => {
      console.error(err);
      profile = buildProfile(user, null);
      renderHeader(active, profile, settings);
      onProfile(profile);
    });
  });
}
