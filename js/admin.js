// 後台：活動設定（名稱、題目、組名、加權）、名單
import {
  collection, doc, setDoc, onSnapshot, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  startPage, login, db, COL, esc, toast, confirmDialog, isSchoolEmail, watchSettings,
  CATEGORIES, categoryLabel,
} from "./common.js";
import { SCHOOL_DOMAIN, OWNER_ADMINS } from "./firebase-config.js";
import { TOPIC_OPTIONS, TEAM_IDS } from "./defaults.js";

const gate = document.getElementById("gate");
const area = document.getElementById("admin-area");
const input = document.getElementById("roster-input");
const previewBox = document.getElementById("preview");
const currentBox = document.getElementById("current-roster");

let started = false;
let currentRoster = []; // [{ email, ...data }]
let parsed = null;
let settings = null;

startPage({
  active: "admin",
  onProfile(p) {
    if (!p) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>請先登入管理員帳號。</p>
        <button class="btn btn-primary" id="gate-login" type="button">學校帳號登入</button>`;
      gate.querySelector("#gate-login").addEventListener("click", login);
      return;
    }
    if (!p.isAdmin) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>你目前的帳號（${esc(p.email)}）不是管理員，無法進入後台。</p>`;
      return;
    }
    gate.classList.add("hidden");
    area.classList.remove("hidden");
    if (!started) {
      started = true;
      watchRoster();
      watchSettings((s) => { settings = s; fillSettingsOnce(); });
    }
  },
});

// ============================================================
// 活動設定
// ============================================================
let settingsFilled = false;

// 題目下拉選單：選了就填進下面的輸入框；輸入框也可以自己打
document.querySelectorAll("[data-topic-select]").forEach((sel) => {
  sel.innerHTML = `<option value="">— 從備選題目挑選 —</option>`
    + TOPIC_OPTIONS.map((t) => `<option>${esc(t)}</option>`).join("");
  sel.addEventListener("change", () => {
    if (sel.value) document.querySelector(`[data-topic="${sel.dataset.topicSelect}"]`).value = sel.value;
  });
});
document.querySelectorAll("[data-topic]").forEach((inp) => {
  inp.addEventListener("input", () => syncTopicSelect(inp.dataset.topic));
});
function syncTopicSelect(s) {
  const v = document.querySelector(`[data-topic="${s}"]`).value.trim();
  document.querySelector(`[data-topic-select="${s}"]`).value = TOPIC_OPTIONS.includes(v) ? v : "";
}

// 只在第一次載入時填入，避免打字打到一半被覆蓋
function fillSettingsOnce() {
  if (settingsFilled || !settings) return;
  settingsFilled = true;
  document.getElementById("event-name").value = settings.eventName;
  for (const s of ["am", "pm"]) {
    document.querySelector(`[data-topic="${s}"]`).value = settings.topics[s] || "";
    syncTopicSelect(s);
  }
  for (const t of TEAM_IDS) {
    document.querySelector(`[data-team="${t}"]`).value = settings.teamNames[t] || "";
  }
  document.getElementById("judge-weight").value = settings.judgeWeight;
  document.getElementById("bell-warn").value = settings.bellWarnSec;
}

document.getElementById("save-settings").addEventListener("click", async () => {
  const eventName = document.getElementById("event-name").value.trim();
  const topics = {
    am: document.querySelector('[data-topic="am"]').value.trim(),
    pm: document.querySelector('[data-topic="pm"]').value.trim(),
  };
  const teamNames = Object.fromEntries(TEAM_IDS.map((t) => [t, document.querySelector(`[data-team="${t}"]`).value.trim()]));
  const judgeWeight = Number(document.getElementById("judge-weight").value);
  const bellWarnSec = Number(document.getElementById("bell-warn").value);

  if (!eventName) return toast("活動名稱不能空白", "error");
  if (!topics.am || !topics.pm) return toast("上午、下午的題目都要填", "error");
  if (!Number.isInteger(judgeWeight) || judgeWeight < 1 || judgeWeight > 10) return toast("倍數必須是 1～10 的整數", "error");
  if (!Number.isInteger(bellWarnSec) || bellWarnSec < 0 || bellWarnSec > 120) return toast("提醒秒數必須是 0～120 的整數", "error");

  try {
    await setDoc(doc(db, COL.config, "settings"),
      { eventName, topics, teamNames, judgeWeight, bellWarnSec, updatedAt: serverTimestamp() }, { merge: true });
    toast("活動設定已儲存", "ok");
  } catch (e) {
    toast(`儲存失敗：${e.message}`, "error", 6000);
  }
});

// ============================================================
// 名單：解析貼上的文字
// ============================================================

// 類別文字 → 類別代號（去掉空白後比對；也接受一些常見寫法）
const CATEGORY_ALIASES = {
  admin: ["管理員", "管理者", "admin"],
  controller: ["控制老師", "主控老師", "控制者", "控制", "controller"],
  teacher: ["老師", "教師", "一般老師", "領航老師", "teacher"],
  am_pro: ["上午正方"],
  am_con: ["上午反方"],
  pm_pro: ["下午正方"],
  pm_con: ["下午反方"],
  am_host: ["上午主持", "上午主持人"],
  pm_host: ["下午主持", "下午主持人"],
  am_judge: ["上午評審"],
  pm_judge: ["下午評審"],
  student: ["學生", "觀眾", "student"],
};
const ALIAS_TO_KEY = new Map();
for (const [key, list] of Object.entries(CATEGORY_ALIASES)) list.forEach((a) => ALIAS_TO_KEY.set(a.toLowerCase(), key));

function parseCategory(text) {
  return ALIAS_TO_KEY.get(text.replace(/\s/g, "").toLowerCase()) || null;
}

function parseRoster(text) {
  const people = new Map(); // email -> person
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/[,，｜|]/))
      .map((c) => c.trim())
      .filter(Boolean);
    const row = { line: i + 1, raw: line, error: null };
    const emailCell = cells.find((c) => c.includes("@"));
    if (!emailCell) {
      // 沒有 email 的列：多半是標題列，略過
      if (/email|信箱|類別|名字|姓名/i.test(line)) return;
      row.error = "找不到 email";
      rows.push(row);
      return;
    }
    const email = emailCell.toLowerCase();
    let category = null;
    let name = "";
    for (const c of cells) {
      if (c === emailCell) continue;
      const cat = parseCategory(c);
      if (cat && !category) category = cat;
      else if (!name) name = c;
    }
    if (!isSchoolEmail(email)) row.error = `不是 @${SCHOOL_DOMAIN} 帳號`;
    else if (!category) row.error = "看不懂類別（請看上方可填的類別）";
    rows.push(row);
    if (row.error) return;

    const p = people.get(email) || { email, name: "", category, errors: [] };
    if (name && !p.name) p.name = name;
    if (p.category !== category) {
      p.errors.push(`同時是「${categoryLabel(p.category)}」和「${categoryLabel(category)}」，一個人只能有一個類別`);
    }
    people.set(email, p);
  });

  const list = [...people.values()];
  const rowErrors = rows.filter((r) => r.error);
  const personErrors = list.filter((p) => p.errors.length);
  return { rows, list, rowErrors, personErrors, ok: !rowErrors.length && !personErrors.length };
}

function countBy(list) {
  const c = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, 0]));
  list.forEach((p) => { if (c[p.category] != null) c[p.category]++; });
  return c;
}

function summaryText(list) {
  const c = countBy(list);
  const parts = Object.keys(CATEGORIES).filter((k) => c[k]).map((k) => `${categoryLabel(k)} ${c[k]}`);
  return `共 ${list.length} 人：${parts.join("、") || "（無）"}`;
}

// 不擋儲存、只提醒的事項
function warnings(list) {
  const c = countBy(list);
  const w = [];
  for (const t of TEAM_IDS) if (c[t] !== 3) w.push(`${categoryLabel(t)}有 ${c[t]} 人（通常是 3 人）`);
  for (const s of ["am", "pm"]) {
    if (!c[`${s}_host`]) w.push(`${categoryLabel(`${s}_host`)}還沒有人`);
    if (!c[`${s}_judge`]) w.push(`${categoryLabel(`${s}_judge`)}還沒有人`);
  }
  if (!c.controller && !c.admin) w.push("還沒有「控制老師」（只有廖老師能操作主控台）");
  return w;
}

document.getElementById("preview-btn").addEventListener("click", () => {
  parsed = parseRoster(input.value);
  previewBox.classList.remove("hidden");
  if (!parsed.rows.length) {
    previewBox.innerHTML = `<p class="muted">沒有讀到任何資料。</p>`;
    return;
  }
  const errorRows = parsed.rowErrors.map((r) =>
    `<tr class="row-error"><td>第 ${r.line} 行</td><td>${esc(r.raw)}</td><td>${esc(r.error)}</td></tr>`).join("");
  const personErrRows = parsed.personErrors.map((p) =>
    `<tr class="row-error"><td>${esc(p.email)}</td><td>${esc(p.name)}</td><td>${esc(p.errors.join("；"))}</td></tr>`).join("");
  const order = Object.keys(CATEGORIES);
  const okRows = [...parsed.list]
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .map((p) => `
    <tr class="${p.errors.length ? "row-error" : ""}">
      <td>${esc(categoryLabel(p.category))}</td><td>${esc(p.name)}</td><td>${esc(p.email)}</td>
    </tr>`).join("");
  const warns = warnings(parsed.list);

  previewBox.innerHTML = `
    ${parsed.ok ? "" : `
      <div class="card" style="background:var(--red-soft);margin-bottom:16px">
        <h3>⚠️ 有 ${parsed.rowErrors.length + parsed.personErrors.length} 個問題要先修正</h3>
        <div class="table-wrap"><table><thead><tr><th>位置</th><th>內容</th><th>問題</th></tr></thead>
        <tbody>${errorRows}${personErrRows}</tbody></table></div>
      </div>`}
    <p><b>${esc(summaryText(parsed.list))}</b></p>
    ${warns.length ? `<div class="card" style="background:var(--yellow-soft);box-shadow:var(--shadow-sm);padding:12px 16px">
      <b>提醒（不影響儲存）</b>
      <ul class="small" style="margin:6px 0 0">${warns.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="table-wrap" style="margin:12px 0"><table>
      <thead><tr><th>類別</th><th>名字</th><th>email</th></tr></thead>
      <tbody>${okRows}</tbody></table></div>
    <button class="btn btn-primary btn-big" id="save-roster-btn" type="button" ${parsed.ok ? "" : "disabled"}>
      儲存名單（取代目前全部名單）
    </button>`;
  document.getElementById("save-roster-btn").addEventListener("click", saveRoster);
});

// ============================================================
// 名單：儲存
// ============================================================
async function saveRoster() {
  if (!parsed?.ok) return;
  const list = parsed.list;
  const newEmails = new Set(list.map((p) => p.email));
  const removed = currentRoster.filter((r) => !newEmails.has(r.email));
  const yes = await confirmDialog({
    title: "確定要儲存名單嗎？",
    body: `<p>${esc(summaryText(list))}</p>
      ${removed.length ? `<p>將移除 ${removed.length} 人：${removed.map((r) => esc(r.name || r.email)).join("、")}</p>` : ""}`,
    okText: "儲存",
  });
  if (!yes) return;

  try {
    const ops = [];
    list.forEach((p) => {
      ops.push((b) => b.set(doc(db, COL.roster, p.email), {
        name: p.name || "",
        category: p.category,
        isAdmin: p.category === "admin",
        canControl: p.category === "admin" || p.category === "controller",
        updatedAt: serverTimestamp(),
      }));
    });
    removed.forEach((r) => ops.push((b) => b.delete(doc(db, COL.roster, r.email))));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      ops.slice(i, i + 400).forEach((op) => op(batch));
      await batch.commit();
    }
    toast("名單已儲存", "ok");
    previewBox.classList.add("hidden");
  } catch (e) {
    console.error(e);
    toast(`儲存失敗：${e.message}`, "error", 6000);
  }
}

// ============================================================
// 目前名單
// ============================================================
function watchRoster() {
  onSnapshot(collection(db, COL.roster), (snap) => {
    currentRoster = snap.docs.map((d) => ({ email: d.id, ...d.data() }));
    renderCurrent();
  }, (e) => {
    currentBox.innerHTML = `<p class="badge badge-red">讀取名單失敗：${esc(e.message)}</p>`;
  });
}

function renderCurrent() {
  const owners = OWNER_ADMINS.filter((e) => !currentRoster.some((r) => r.email === e));
  if (!currentRoster.length) {
    currentBox.innerHTML = `<div class="empty-state">目前沒有名單，請在上方貼上後儲存。</div>`;
    return;
  }
  const byName = (a, b) => (a.name || a.email).localeCompare(b.name || b.email, "zh-Hant");
  const group = (title, people, cls = "") => `
    <div class="card">
      <h3 class="${cls}">${esc(title)} <span class="badge">${people.length} 人</span></h3>
      ${people.length ? `<div class="table-wrap"><table>
        <thead><tr><th>名字</th><th>email</th><th>類別</th></tr></thead>
        <tbody>${people.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${esc(categoryLabel(p.category))}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="muted">（尚無）</p>`}
    </div>`;
  const of = (...keys) => currentRoster.filter((p) => keys.includes(p.category)).sort(byName);
  const unknown = currentRoster.filter((p) => !CATEGORIES[p.category]);

  currentBox.innerHTML = `
    <p><b>${esc(summaryText(currentRoster))}</b>
      ${owners.length ? `<br><span class="muted small">另外 ${owners.map(esc).join("、")} 固定是管理員。</span>` : ""}</p>
    ${group("管理員／控制老師／老師", of("admin", "controller", "teacher"))}
    <div class="grid-2">
      ${group("上午正方", of("am_pro"), "pro-text")}
      ${group("上午反方", of("am_con"), "con-text")}
    </div>
    ${group("上午主持＋評審", of("am_host", "am_judge"))}
    <div class="grid-2">
      ${group("下午正方", of("pm_pro"), "pro-text")}
      ${group("下午反方", of("pm_con"), "con-text")}
    </div>
    ${group("下午主持＋評審", of("pm_host", "pm_judge"))}
    ${group("學生（觀眾）", of("student"))}
    ${unknown.length ? group("⚠️ 類別看不懂（請重新貼上名單）", unknown) : ""}`;
}

document.getElementById("load-current-btn").addEventListener("click", () => {
  const order = Object.keys(CATEGORIES);
  input.value = [...currentRoster]
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .map((p) => `${categoryLabel(p.category)}\t${p.name || ""}\t${p.email}`)
    .join("\n");
  toast("已把目前名單填回輸入框，可以修改後再預覽儲存", "ok");
});
