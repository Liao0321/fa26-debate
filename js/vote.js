// 評分頁：每輪休息時，幫正方、反方各打 1～5 分
// 開放期間可以修改（以最後一次為準）；該場選手不能投；頒獎前看不到任何人的分數
import {
  doc, onSnapshot, setDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { startPage, login, db, COL, esc, toast, watchSettings, teamName } from "./common.js";
import { SESSIONS, SIDE_LABEL, planTimes, fmtMinutes } from "./defaults.js";
import { mountLiveBar } from "./livebar.js";
import { voteDocId, roleOf, weightOf, SCORES, SIDES } from "./votes.js";

const gate = document.getElementById("gate");
const area = document.getElementById("vote-area");

let profile = null;
let settings = null;
let live = { state: null, list: [], index: -1 };
let mounted = false;

// 目前開放的那一輪
let openKey = "";      // "am_1"
let teams = {};        // 這一場兩組的公開資料（組名、發言人名字）
let mine = undefined;  // 我這一輪已經送出的票（undefined＝讀取中、null＝還沒投）
let picks = { pro: null, con: null };
let dirty = false;     // 選了但還沒送出
let saving = false;
let stops = [];

startPage({
  active: "vote",
  onProfile(p) {
    profile = p;
    if (!p) {
      area.classList.add("hidden");
      gate.classList.remove("hidden");
      gate.innerHTML = `<p>請先用學校帳號登入，才能評分。</p>
        <button class="btn btn-primary" id="gate-login" type="button">學校帳號登入</button>`;
      gate.querySelector("#gate-login").addEventListener("click", login);
      return;
    }
    gate.classList.add("hidden");
    area.classList.remove("hidden");
    if (!mounted) {
      mounted = true;
      watchSettings((s) => { settings = s; render(); });
      mountLiveBar({ onChange(state, list, index) { live = { state, list, index }; follow(); render(); } });
    }
    follow();
    render();
  },
});

const voteOpen = () => {
  const v = live.state?.voteOpen;
  return v && SESSIONS[v.session] && [1, 2, 3].includes(v.round) ? v : null;
};

// 開放的那一輪換了：重新讀「我的票」和兩組資料
function follow() {
  const v = voteOpen();
  const key = v && profile ? `${v.session}_${v.round}_${profile.email}` : "";
  if (key === openKey) return;
  openKey = key;
  stops.forEach((s) => s());
  stops = [];
  mine = undefined;
  picks = { pro: null, con: null };
  dirty = false;
  teams = {};
  if (!key) return;
  stops.push(onSnapshot(doc(db, COL.votes, voteDocId(v.session, v.round, profile.email)), (snap) => {
    mine = snap.exists() ? snap.data() : null;
    if (!dirty) picks = { pro: mine?.pro ?? null, con: mine?.con ?? null };
    render();
  }, (e) => { console.warn(e); mine = null; render(); }));
  for (const side of SIDES) {
    const id = `${v.session}_${side}`;
    stops.push(onSnapshot(doc(db, COL.teams, id), (snap) => {
      teams[id] = snap.exists() ? snap.data() : {};
      render();
    }, (e) => console.warn(e)));
  }
}

// ---------- 畫面 ----------
function render() {
  if (!profile || !mounted) return;
  const v = voteOpen();
  if (!v) return renderClosed();

  const role = roleOf(profile.category, v.session);
  const head = `
    <div class="card vote-head">
      <div class="row">
        <span class="badge badge-orange">${esc(SESSIONS[v.session].label)}</span>
        <b class="vote-round">第 ${v.round} 輪評分開放中</b>
      </div>
      <p class="small muted" style="margin:8px 0 0">題目：${esc(settings?.topics?.[v.session] || "")}</p>
    </div>`;

  if (role === "player") {
    area.innerHTML = head + `<div class="card vote-msg"><p class="vote-big">你是本場選手，這一場不用評分 🙌</p>
      <p class="muted small" style="margin-bottom:0">${v.session === "am" ? "下午場" : "上午場"}你就是觀眾，到時候再來評分。</p></div>`;
    return;
  }

  const w = weightOf(profile.category, v.session, settings?.judgeWeight);
  const sideCard = (side) => {
    const id = `${v.session}_${side}`;
    const speaker = teams[id]?.speakerNames?.[`r${v.round}`] || "";
    return `
      <div class="card vote-side ${side}">
        <div class="row">
          <span class="badge badge-${side}">${SIDE_LABEL[side]}</span>
          <b class="vote-team">${esc(teamName(id, settings))}</b>
        </div>
        <p class="small muted" style="margin:6px 0 12px">${speaker ? `本輪發言人：${esc(speaker)}` : "本輪發言人：未設定"}</p>
        <div class="score-row" role="radiogroup" aria-label="${SIDE_LABEL[side]}的分數">
          ${SCORES.map((n) => `<button class="score-btn ${picks[side] === n ? "on" : ""} ${picks[side] >= n ? "lit" : ""}"
            type="button" role="radio" aria-checked="${picks[side] === n}" data-side="${side}" data-score="${n}">${n}</button>`).join("")}
        </div>
        <div class="score-hint small muted"><span>1 不太好</span><span>5 非常好</span></div>
      </div>`;
  };

  const ready = SIDES.every((s) => picks[s]);
  const sent = mine && !dirty;
  let status = "";
  if (mine === undefined) status = `<span class="muted">讀取中…</span>`;
  else if (sent) status = `<span class="vote-ok">✓ 已送出第 ${v.round} 輪評分，可以在關閉前修改</span>`;
  else if (mine && dirty) status = `<span class="muted">你改了分數，記得再按一次送出</span>`;
  else if (!ready) status = `<span class="muted">兩組都要打分數才能送出</span>`;

  area.innerHTML = head + sideCard("pro") + sideCard("con") + `
    <div class="card vote-submit">
      <button class="btn btn-primary btn-big vote-send" id="vote-send" type="button" ${!ready || saving || sent || mine === undefined ? "disabled" : ""}>
        ${saving ? "送出中…" : mine ? "更新評分" : "送出評分"}</button>
      <div class="vote-status">${status}</div>
      ${w > 1 ? `<p class="small muted" style="margin:8px 0 0">你這一場是${roleOf(profile.category, v.session) === "host" ? "主持人" : "評審"}，分數 ×${w}。</p>` : ""}
    </div>
    <p class="small muted" style="text-align:center">分數只有老師看得到，頒獎典禮才會公布結果。</p>`;
}

function renderClosed() {
  const L = live.list;
  const times = planTimes(L);
  let next = null;
  for (let i = Math.max(0, live.index + 1); i < L.length; i++) {
    if (L[i].openVote) { next = { seg: L[i], at: fmtMinutes(times[i].start) }; break; }
  }
  area.innerHTML = `
    <div class="card vote-msg">
      <p class="vote-big">目前沒有開放評分</p>
      <p style="margin-bottom:0">${next
        ? `下一次評分在：<b>${esc(next.seg.title)}</b>（約 ${next.at}）`
        : "今天的評分都結束了，謝謝你！"}</p>
      <p class="small muted" style="margin-bottom:0">開放時這一頁會自動出現評分按鈕，不用重新整理。</p>
    </div>`;
}


area.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-score]");
  if (b) {
    picks = { ...picks, [b.dataset.side]: Number(b.dataset.score) };
    dirty = !(mine && mine.pro === picks.pro && mine.con === picks.con);
    render();
    return;
  }
  if (e.target.closest("#vote-send")) submit();
});

async function submit() {
  const v = voteOpen();
  if (!v || !profile || !SIDES.every((s) => picks[s]) || saving) return;
  saving = true;
  render();
  try {
    await setDoc(doc(db, COL.votes, voteDocId(v.session, v.round, profile.email)), {
      session: v.session,
      round: v.round,
      email: profile.email,
      pro: picks.pro,
      con: picks.con,
      updatedAt: serverTimestamp(),
    });
    dirty = false;
    toast(`已送出第 ${v.round} 輪評分`, "ok");
  } catch (e) {
    console.error(e);
    toast(e.code === "permission-denied"
      ? "送出失敗：評分可能剛好關閉了，或你是本場選手。"
      : `送出失敗：${e.message}`, "error", 5000);
  } finally {
    saving = false;
    render();
  }
}
