// 觀眾留言牆：留言（可以匿名、自己取名字）、按讚、刪除自己的留言
// 預設顯示「目前場次」的留言，也可以切換上午、下午
import {
  collection, doc, query, where, onSnapshot, addDoc, updateDoc, deleteDoc,
  arrayUnion, arrayRemove, increment, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { startPage, login, db, COL, esc, toast, confirmDialog } from "./common.js";
import { SESSIONS } from "./defaults.js";
import { mountLiveBar } from "./livebar.js";

const gate = document.getElementById("gate");
const area = document.getElementById("cm-area");
const form = document.getElementById("cm-form");
const textEl = document.getElementById("cm-text");
const nameEl = document.getElementById("cm-name");
const listEl = document.getElementById("cm-list");

const NAME_KEY = "debate-comment-name";
const RATE = { max: 3, ms: 60_000 }; // 每人每分鐘最多 3 則

let profile = null;
let session = null;      // 正在看哪一場
let userPicked = false;  // 使用者自己切換過場次，就不再跟著目前場次跑
let comments = [];       // 公開的留言（hidden == false）
let mineHidden = [];     // 自己被隱藏的留言（只有自己看得到）
let sort = "hot";
let stops = [];
let mounted = false;
const sentAt = [];

try { nameEl.value = localStorage.getItem(NAME_KEY) || ""; } catch { /* 無痕模式 */ }

startPage({
  active: "comments",
  onProfile(p) {
    profile = p;
    if (!p) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>請先用學校帳號登入，才能看留言和留言。</p>
        <button class="btn btn-primary" id="gate-login" type="button">學校帳號登入</button>`;
      gate.querySelector("#gate-login").addEventListener("click", login);
      return;
    }
    gate.classList.add("hidden");
    area.classList.remove("hidden");
    if (!mounted) {
      mounted = true;
      mountLiveBar({
        onChange(state, list, index) {
          // 目前段落屬於哪一場；午餐、待機這些不屬於某一場的段落，就看前面最近的一場
          if (userPicked) return;
          let cur = null;
          for (let i = index; i >= 0 && !cur; i--) cur = list[i]?.session || null;
          cur = cur || "am";
          if (cur !== session) selectSession(cur);
        },
      });
      if (!session) selectSession("am");
    }
  },
});

function selectSession(s) {
  session = s;
  document.getElementById("cm-tabs").innerHTML = Object.entries(SESSIONS).map(([k, v]) =>
    `<button class="btn btn-small ${k === s ? "btn-primary" : ""}" data-session="${k}" type="button">${esc(v.label)}的留言</button>`).join("");
  stops.forEach((f) => f());
  comments = [];
  mineHidden = [];
  render();
  const col = collection(db, COL.comments);
  stops = [
    onSnapshot(query(col, where("session", "==", s), where("hidden", "==", false)), (snap) => {
      comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, (e) => { console.error(e); listEl.innerHTML = `<div class="card muted">讀不到留言：${esc(e.message)}</div>`; }),
    // 自己被隱藏的留言：讓作者知道它被老師隱藏了
    onSnapshot(query(col, where("session", "==", s), where("authorUid", "==", profile.uid), where("hidden", "==", true)), (snap) => {
      mineHidden = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    }, () => {}),
  ];
}

document.getElementById("cm-tabs").addEventListener("click", (e) => {
  const s = e.target.closest("[data-session]")?.dataset.session;
  if (s) { userPicked = true; selectSession(s); }
});
document.getElementById("cm-sort").addEventListener("click", (e) => {
  const s = e.target.closest("[data-sort]")?.dataset.sort;
  if (s) { sort = s; render(); }
});

const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : Date.now());
function timeText(t) {
  const d = new Date(ms(t));
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function render() {
  if (!profile) return;
  document.querySelectorAll("#cm-sort [data-sort]").forEach((b) => b.classList.toggle("btn-primary", b.dataset.sort === sort));
  document.getElementById("cm-total").textContent = `${SESSIONS[session]?.label || ""}・${comments.length} 則留言`;
  const all = [...comments, ...mineHidden];
  all.sort(sort === "hot"
    ? (a, b) => (b.likeCount || 0) - (a.likeCount || 0) || ms(b.createdAt) - ms(a.createdAt)
    : (a, b) => ms(b.createdAt) - ms(a.createdAt));
  if (!all.length) {
    listEl.innerHTML = `<div class="card muted cm-empty">還沒有人留言，當第一個吧！</div>`;
    return;
  }
  listEl.innerHTML = all.map((c) => {
    const mine = c.authorUid === profile.uid;
    const liked = (c.likedBy || []).includes(profile.uid);
    return `
      <article class="card cm-item ${c.hidden ? "is-hidden" : ""}">
        <p class="cm-text">${esc(c.text)}</p>
        <div class="row cm-meta">
          <span class="cm-author">${esc(c.authorName || "匿名")}${mine ? `<span class="badge">我</span>` : ""}</span>
          <span class="small muted">${timeText(c.createdAt)}</span>
          ${c.hidden ? `<span class="badge badge-gray">老師已隱藏，只有你看得到</span>` : ""}
          <span class="spacer"></span>
          ${mine ? `<button class="btn btn-small btn-ghost" data-del="${c.id}" type="button">刪除</button>` : ""}
          <button class="btn btn-small cm-like ${liked ? "on" : ""}" data-like="${c.id}" type="button" ${c.hidden ? "disabled" : ""}
            aria-pressed="${liked}">♥ ${c.likeCount || 0}</button>
        </div>
      </article>`;
  }).join("");
}

listEl.addEventListener("click", async (e) => {
  const likeId = e.target.closest("[data-like]")?.dataset.like;
  if (likeId) {
    const c = comments.find((x) => x.id === likeId);
    if (!c) return;
    const liked = (c.likedBy || []).includes(profile.uid);
    try {
      await updateDoc(doc(db, COL.comments, likeId), liked
        ? { likedBy: arrayRemove(profile.uid), likeCount: increment(-1) }
        : { likedBy: arrayUnion(profile.uid), likeCount: increment(1) });
    } catch (err) {
      console.error(err);
      toast("按讚失敗，請再試一次", "error");
    }
    return;
  }
  const delId = e.target.closest("[data-del]")?.dataset.del;
  if (delId) {
    const ok = await confirmDialog({ title: "刪除這則留言？", body: "<p>刪除後不能復原。</p>", okText: "刪除", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, COL.comments, delId));
      toast("已刪除", "ok");
    } catch (err) {
      toast(`刪除失敗：${err.message}`, "error");
    }
  }
});

textEl.addEventListener("input", () => {
  document.getElementById("cm-count").textContent = `${textEl.value.length}／100`;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = textEl.value.trim();
  const name = nameEl.value.trim().slice(0, 20) || "匿名";
  if (!text) { toast("請先寫一點內容", "error"); return; }
  if (text.length > 100) { toast("最多 100 字", "error"); return; }
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] > RATE.ms) sentAt.shift();
  if (sentAt.length >= RATE.max) {
    toast(`留言太快了，請等 ${Math.ceil((RATE.ms - (now - sentAt[0])) / 1000)} 秒再試`, "error");
    return;
  }
  const btn = document.getElementById("cm-send");
  btn.disabled = true;
  try {
    await addDoc(collection(db, COL.comments), {
      session,
      text,
      authorUid: profile.uid,
      authorName: name,
      likedBy: [],
      likeCount: 0,
      hidden: false,
      createdAt: serverTimestamp(),
    });
    sentAt.push(now);
    try { localStorage.setItem(NAME_KEY, nameEl.value.trim()); } catch { /* 無痕模式 */ }
    textEl.value = "";
    document.getElementById("cm-count").textContent = "0／100";
    toast(`已送出到${SESSIONS[session].label}留言牆`, "ok");
  } catch (err) {
    console.error(err);
    toast(`送出失敗：${err.message}`, "error", 5000);
  } finally {
    btn.disabled = false;
  }
});
