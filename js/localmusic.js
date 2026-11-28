// 本機音樂：在投影電腦上選音樂檔，替每個段落指定要播哪一首
// 檔案只存在這台電腦的瀏覽器（IndexedDB），不會上傳到網站或 GitHub，所以有版權的歌也可以用
// 沒有指定檔案的段落就不播音樂

// 和 common.js 的 esc 一樣；不從 common.js 匯入，這個檔案才不會連帶載入 Firebase
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const DB_NAME = "debate-local-music";
const STORE = "files";
const MAP_KEY = "debate-music-map";   // 段落 id → 檔名 / BUILTIN / ""
const LOOP_KEY = "debate-music-loop"; // 段落 id → true / false
export const BUILTIN = "@builtin";    // 用網站 audio/ 資料夾裡的內建檔案
export const BEFORE_START = "@before"; // 流程還沒開始時（沒有目前段落）
export const EFFECTS = { bell: "時間到的鈴聲", ding: "快結束的提醒聲", drumroll: "頒獎揭曉前的鼓聲", celebrate: "揭曉後的慶祝音樂" };

// ---------- IndexedDB：存檔案本身，重新整理後還在 ----------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
}
function writeJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 無痕模式等：只是不會記住 */ }
}

export class LocalMusic {
  constructor() {
    this.files = new Map(); // 檔名 → blob URL
    this.map = readJson(MAP_KEY);
    this.loop = readJson(LOOP_KEY);
    this.ready = this.load();
  }

  async load() {
    try {
      const rows = await tx("readonly", (s) => s.getAll());
      for (const r of rows || []) this.files.set(r.name, URL.createObjectURL(r.blob));
    } catch (e) {
      console.warn("讀不到本機音樂", e);
    }
  }

  names() {
    return [...this.files.keys()].sort((a, b) => a.localeCompare(b, "zh-Hant", { numeric: true }));
  }

  async add(fileList) {
    const list = [...fileList].filter((f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|oga|flac|opus|webm)$/i.test(f.name));
    if (!list.length) return 0;
    // 先把內容讀進來複製一份：原始檔案之後被移動、改名也不影響
    const rows = await Promise.all(list.map(async (f) => ({ name: f.name, blob: new Blob([await f.arrayBuffer()], { type: f.type || "audio/mpeg" }) })));
    await tx("readwrite", (s) => { rows.forEach((r) => s.put(r)); });
    for (const r of rows) {
      if (this.files.has(r.name)) URL.revokeObjectURL(this.files.get(r.name));
      this.files.set(r.name, URL.createObjectURL(r.blob));
    }
    return list.length;
  }

  async clear() {
    await tx("readwrite", (s) => s.clear());
    this.files.forEach((u) => URL.revokeObjectURL(u));
    this.files.clear();
  }

  choice(id) { return this.map[id] ?? (id in EFFECTS ? BUILTIN : ""); }
  setChoice(id, v) { this.map[id] = v; writeJson(MAP_KEY, this.map); }
  loops(id) { return this.loop[id] ?? true; }
  setLoop(id, v) { this.loop[id] = v; writeJson(LOOP_KEY, this.loop); }

  // 這個段落要播什麼：{ key, src, loop, label } 或 null（不播）
  track(seg, builtinKey, builtinLoop) {
    const id = seg ? seg.id : BEFORE_START;
    const c = this.choice(id);
    if (c === BUILTIN) {
      if (!builtinKey) return null;
      return { key: `builtin:${builtinKey}`, src: `audio/${builtinKey}.mp3`, loop: builtinLoop, label: `網站內建：${builtinKey}` };
    }
    if (!c || !this.files.has(c)) return null;
    const loop = this.loops(id);
    return { key: `local:${c}:${loop}`, src: this.files.get(c), loop, label: c };
  }

  // 鈴聲、提醒聲：預設用網站內建
  effect(key) {
    const c = this.choice(key);
    if (c === BUILTIN) return `audio/${key}.mp3`;
    return this.files.get(c) || null;
  }
}

// ============================================================
// 選音樂的面板（工具列上按「🎵 選音樂」才打開；投影時不會自己跳出來）
// ============================================================
export function musicPanel({ music, panel, getSegments, builtinOf, onChange }) {
  const fileInput = Object.assign(document.createElement("input"), { type: "file", multiple: true, accept: "audio/*", hidden: true });
  const dirInput = Object.assign(document.createElement("input"), { type: "file", multiple: true, hidden: true });
  dirInput.setAttribute("webkitdirectory", "");
  panel.append(fileInput, dirInput);
  const body = document.createElement("div");
  panel.append(body);

  const options = (current, { allowBuiltin, builtinLabel, emptyLabel = "（不播）" }) => {
    const names = music.names();
    let html = `<option value="">${emptyLabel}</option>`;
    if (allowBuiltin) html += `<option value="${BUILTIN}" ${current === BUILTIN ? "selected" : ""}>${esc(builtinLabel)}</option>`;
    html += names.map((n) => `<option value="${esc(n)}" ${current === n ? "selected" : ""}>${esc(n)}</option>`).join("");
    if (current && current !== BUILTIN && !music.files.has(current)) {
      html += `<option value="${esc(current)}" selected>⚠️ 找不到：${esc(current)}</option>`;
    }
    return html;
  };

  const row = (id, title, builtinKey) => {
    const c = music.choice(id);
    const isFile = c && c !== BUILTIN;
    return `<tr>
      <td class="mp-seg">${title}</td>
      <td><select data-id="${esc(id)}">${options(c, { allowBuiltin: !!builtinKey, builtinLabel: `網站內建（${builtinKey}）` })}</select></td>
      <td><label class="mp-loop" title="播完從頭再播"><input type="checkbox" data-loop="${esc(id)}" ${music.loops(id) ? "checked" : ""} ${isFile ? "" : "disabled"}> 循環</label></td>
    </tr>`;
  };

  function render() {
    const segs = getSegments();
    const n = music.files.size;
    const withBuiltin = segs.filter((s) => builtinOf(s)).length;
    body.innerHTML = `
      <div class="mp-head">
        <b>🎵 本機音樂</b>
        <span class="spacer"></span>
        <button class="btn btn-small" type="button" data-act="close">✕ 關閉</button>
      </div>
      <p class="mp-note">檔案只存在這台電腦的瀏覽器裡，<b>不會上傳</b>。沒有選檔案的段落不播音樂。</p>
      <div class="mp-actions">
        <button class="btn btn-small btn-primary" type="button" data-act="files">＋ 選擇檔案</button>
        <button class="btn btn-small" type="button" data-act="dir">＋ 選擇資料夾</button>
        <span class="toolbar-hint">已載入 ${n} 首</span>
        <span class="spacer"></span>
        ${withBuiltin ? `<button class="btn btn-small" type="button" data-act="builtin" title="只改還沒選的段落">沒選的段落用網站內建</button>` : ""}
        ${n ? `<button class="btn btn-small btn-danger" type="button" data-act="clear">清除全部</button>` : ""}
      </div>
      <table class="mp-table">
        <tbody>
          ${row(BEFORE_START, "<i>流程開始前</i>", "idle")}
          ${segs.map((s) => row(s.id, `${s.session ? `<small class="mp-ses">${s.session === "am" ? "上午" : "下午"}</small>` : ""}${esc(s.title || "（未命名）")}`, builtinOf(s))).join("")}
        </tbody>
      </table>
      <h4 class="mp-sub">音效</h4>
      <table class="mp-table">
        <tbody>
          ${Object.entries(EFFECTS).map(([k, label]) => `<tr>
            <td class="mp-seg">${label}</td>
            <td><select data-id="${k}">${options(music.choice(k), { allowBuiltin: true, builtinLabel: "網站內建" })}</select></td>
            <td></td></tr>`).join("")}
        </tbody>
      </table>`;
  }

  body.addEventListener("change", (e) => {
    const sel = e.target.closest("select[data-id]");
    if (sel) { music.setChoice(sel.dataset.id, sel.value); render(); onChange(); return; }
    const cb = e.target.closest("input[data-loop]");
    if (cb) { music.setLoop(cb.dataset.loop, cb.checked); onChange(); }
  });
  body.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") close();
    else if (act === "files") fileInput.click();
    else if (act === "dir") dirInput.click();
    else if (act === "builtin") {
      for (const s of getSegments()) if (builtinOf(s) && !music.choice(s.id)) music.setChoice(s.id, BUILTIN);
      if (!music.choice(BEFORE_START)) music.setChoice(BEFORE_START, BUILTIN);
      render(); onChange();
    } else if (act === "clear") {
      if (!confirmClear(e.target)) return;
      await music.clear(); render(); onChange();
    }
  });
  // 「清除全部」按兩下才清除（不用跳出確認視窗）
  function confirmClear(btn) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = "1";
    btn.textContent = "再按一次確定清除";
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = "清除全部"; } }, 3000);
    return false;
  }
  const onPick = async (input) => {
    await music.add(input.files);
    input.value = "";
    render(); onChange();
  };
  fileInput.addEventListener("change", () => onPick(fileInput));
  dirInput.addEventListener("change", () => onPick(dirInput));

  function open() { render(); panel.classList.remove("hidden"); }
  function close() { panel.classList.add("hidden"); }
  return {
    open, close, render,
    toggle() { panel.classList.contains("hidden") ? open() : close(); },
    isOpen: () => !panel.classList.contains("hidden"),
  };
}
