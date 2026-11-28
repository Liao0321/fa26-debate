// ============================================================
// 即時狀態與計時（主控台、投影畫面、手機頂端進度條共用）
//
// 計時原則：不每秒寫資料庫。debate_live/state 只存
//   startedAt（這一段開始或繼續的「伺服器時間」）＋ remainingAtStart（那時剩幾秒）
// 每台裝置自己算：剩餘 = remainingAtStart − (伺服器現在時間 − startedAt)
// ============================================================
import {
  doc, onSnapshot, setDoc, updateDoc, getDocFromServer, serverTimestamp, collection, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, auth, COL, configReady, isSchoolEmail } from "./common.js";
import { buildDefaultRundown, normalizeRundown, toMinutes, fmtMinutes } from "./defaults.js";

// ---------- 校時：算出「本機時間和伺服器時間差多少」 ----------
let clockOffset = 0; // 伺服器時間 − 本機時間（毫秒）
export function serverNow() { return Date.now() + clockOffset; }

async function syncClock(user) {
  try {
    // 寫一筆伺服器時間到自己的暫存文件，再讀回來比較
    const ref = doc(db, COL.clock, user.uid);
    const t0 = Date.now();
    await setDoc(ref, { t: serverTimestamp() });
    const t1 = Date.now();
    const snap = await getDocFromServer(ref);
    const server = snap.data()?.t?.toMillis?.();
    if (server) clockOffset = server - (t0 + t1) / 2;
  } catch (e) {
    console.warn("校時失敗，使用本機時間", e);
  }
}

let clockStarted = false;
export function startClockSync() {
  if (clockStarted || !configReady) return;
  clockStarted = true;
  onAuthStateChanged(auth, (u) => {
    if (u && isSchoolEmail(u.email)) {
      syncClock(u);
      // 每 10 分鐘再校一次（電腦休眠醒來後時間可能會跳）
      setInterval(() => syncClock(u), 10 * 60 * 1000);
    }
  });
}

// ---------- 讀取流程與即時狀態 ----------
export function watchRundown(cb) {
  if (!configReady) { cb(buildDefaultRundown(), false); return () => {}; }
  return onSnapshot(doc(db, COL.config, "rundown"), (snap) => {
    const segs = snap.exists() ? normalizeRundown(snap.data().segments) : [];
    cb(segs.length ? segs : buildDefaultRundown(), snap.exists());
  }, (err) => {
    console.error(err);
    cb(buildDefaultRundown(), false);
  });
}

// cb(state 或 null（還沒開始）, { online })
export function watchLive(cb) {
  if (!configReady) { cb(null, { online: false }); return () => {}; }
  return onSnapshot(doc(db, COL.live, "state"), { includeMetadataChanges: true }, (snap) => {
    const state = snap.exists() ? snap.data({ serverTimestamps: "estimate" }) : null;
    cb(state, { online: !snap.metadata.fromCache && navigator.onLine });
  }, (err) => {
    console.error(err);
    cb(null, { online: false });
  });
}

// ---------- 擲硬幣後的實際順序 ----------
// 某一場擲硬幣結果是「反方先」時，把第三輪的正方、反方總結對調
export function orderedRundown(segments, state) {
  const list = [...segments];
  for (const s of ["am", "pm"]) {
    if (state?.coinFirst?.[s] !== "con") continue;
    const a = list.findIndex((x) => x.id === `${s}-r3-pro`);
    const b = list.findIndex((x) => x.id === `${s}-r3-con`);
    if (a >= 0 && b >= 0 && a < b) [list[a], list[b]] = [list[b], list[a]];
  }
  return list;
}

// 目前段落：用 segmentId 找（後台增刪段落時比較不會錯位），找不到才用 index
export function currentIndex(list, state) {
  if (!state) return -1;
  if (state.segmentId) {
    const i = list.findIndex((x) => x.id === state.segmentId);
    if (i >= 0) return i;
  }
  return Number.isInteger(state.index) && state.index < list.length ? state.index : -1;
}

// ---------- 計時 ----------
const ms = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : null);

// 主持人的段落（開場、介紹、宣布、讀留言、猜硬幣）、評審講評、頒獎都不計時：主持人自己控時
// 只有選手發言、提問、休息、午餐、待機（倒數到某個時間）才在投影幕上倒數
// 時長（durationSec）仍然用來排首頁賽程的預定時間
export const UNTIMED_TYPES = ["host", "comments", "coin", "commentary", "ceremony"];
export const segHasTimer = (seg) => !!seg && !UNTIMED_TYPES.includes(seg.type);

// 進入一個段落時的倒數秒數；null ＝ 這段不倒數
export function initialRemaining(seg) {
  if (!segHasTimer(seg)) return null;
  const until = toMinutes(seg.untilTime);
  if (until != null) {
    const now = new Date(serverNow());
    const target = new Date(now);
    target.setHours(Math.floor(until / 60), until % 60, 0, 0);
    return Math.max(0, Math.round((target - now) / 1000));
  }
  return seg.durationSec > 0 ? seg.durationSec : null;
}

// 回傳 { hasTimer, remaining(秒，可能是負的), running, paused, done }
export function timing(state) {
  if (!state || state.remainingAtStart == null) return { hasTimer: false };
  const started = ms(state.startedAt) ?? serverNow();
  let remaining;
  if (state.speakerDone) {
    const doneAt = ms(state.speakerDoneAt) ?? serverNow();
    remaining = state.paused ? state.remainingAtStart : state.remainingAtStart - (doneAt - started) / 1000;
  } else if (state.paused) {
    remaining = state.remainingAtStart;
  } else {
    remaining = state.remainingAtStart - (serverNow() - started) / 1000;
  }
  return {
    hasTimer: true,
    remaining,
    paused: !!state.paused,
    waiting: !!state.paused && !!state.waitingStart && !state.speakerDone, // 還沒按「開始計時」
    done: !!state.speakerDone,
    running: !state.paused && !state.speakerDone,
  };
}

// 秒數 → "4:59"、"-0:12"
export function fmtClock(sec) {
  if (sec == null || Number.isNaN(sec)) return "";
  const neg = sec <= -1;
  const v = sec > 0 ? Math.ceil(sec) : Math.floor(-sec);
  const m = Math.floor(v / 60);
  const s = String(v % 60).padStart(2, "0");
  return `${neg ? "-" : ""}${m}:${s}`;
}

// 這段結束（＝下一段開始）的時間，例如 "10:46"
export function endTimeText(t) {
  if (!t?.hasTimer) return "";
  const d = new Date(serverNow() + Math.max(0, t.remaining) * 1000);
  return fmtMinutes(d.getHours() * 60 + d.getMinutes() + (d.getSeconds() >= 30 ? 1 : 0));
}

// ---------- 主控台的寫入 ----------
const stateRef = () => doc(db, COL.live, "state");

export function liveUpdate(patch) {
  return setDoc(stateRef(), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

// 進入某一段時的投票狀態：
//   段落有設定 openVote → 開放那一輪
//   第 3 輪（評審講評時開放）→ 同一場的下一段（感謝選手）還繼續開放，讓大家把握最後時間
//   其他情況 → 關閉
function voteFor(seg, state) {
  if (seg.openVote) return { session: seg.openVote.session, round: seg.openVote.round };
  const v = state?.voteOpen;
  if (v && v.round === 3 && v.session === seg.session) return v;
  return null;
}

// 進入某一段：重新計時；依照段落設定自動開放或關閉投票
// 選手上台的段落（發表、提問）換過去時先不倒數，等主控台按「開始計時」
// （老師的時間表有抓遞麥克風、走上台的緩衝）
export function waitsForStart(seg) {
  if (!seg || initialRemaining(seg) == null) return false;
  if (typeof seg.waitStart === "boolean") return seg.waitStart;
  return seg.type === "speech" || seg.type === "cross";
}

export function enterSegment(list, index, state) {
  const seg = list[index];
  if (!seg) return Promise.resolve();
  const wait = waitsForStart(seg);
  return liveUpdate({
    index,
    segmentId: seg.id,
    startedAt: serverTimestamp(),
    remainingAtStart: initialRemaining(seg),
    paused: wait,
    waitingStart: wait,
    speakerDone: false,
    speakerDoneAt: null,
    voteOpen: voteFor(seg, state),
    // 誰可以按「我說完了」：哪一組（例如 am_pro）的第幾輪發言人；不是選手發言的段落就是 null
    speakerTeam: seg.type === "speech" && seg.session && seg.side ? `${seg.session}_${seg.side}` : null,
    speakerRound: seg.type === "speech" && seg.speakerFromRound ? seg.speakerFromRound : null,
    // 頒獎典禮：每次換段落都回到開場畫面（彩排按過的步驟不會留到正式典禮）
    ceremonyStep: 0,
    ceremonyAt: null,
  });
}

export function pause(state) {
  const t = timing(state);
  if (!t.hasTimer || t.paused) return Promise.resolve();
  return liveUpdate({ paused: true, remainingAtStart: t.remaining });
}

export function resume(state) {
  if (!state?.paused) return Promise.resolve();
  const patch = { paused: false, waitingStart: false, startedAt: serverTimestamp() };
  if (state.speakerDone) patch.speakerDoneAt = serverTimestamp();
  return liveUpdate(patch);
}

// 加減秒數（delta 可以是負的）
export function adjust(state, delta) {
  const t = timing(state);
  if (!t.hasTimer) return Promise.resolve();
  const remaining = t.remaining + delta;
  if (t.paused) return liveUpdate({ remainingAtStart: remaining });
  const patch = { remainingAtStart: remaining, startedAt: serverTimestamp() };
  if (t.done) patch.speakerDoneAt = serverTimestamp(); // 停住的時間也一起更新
  return liveUpdate(patch);
}

export function restart(seg) {
  const wait = waitsForStart(seg);
  return liveUpdate({
    startedAt: serverTimestamp(),
    remainingAtStart: initialRemaining(seg),
    paused: wait,
    waitingStart: wait,
    speakerDone: false,
    speakerDoneAt: null,
  });
}

// 「我說完了」：計時停住，但不會自動換下一段
export function setSpeakerDone(state, done) {
  if (done) return liveUpdate({ speakerDone: true, speakerDoneAt: serverTimestamp() });
  // 取消：從停住的秒數繼續倒數
  const t = timing(state);
  return liveUpdate({
    speakerDone: false,
    speakerDoneAt: null,
    remainingAtStart: t.hasTimer ? t.remaining : null,
    startedAt: serverTimestamp(),
  });
}

// 發言人本人在選手頁按「我說完了」（安全規則只允許改這兩個欄位）
export function speakerPressDone() {
  return updateDoc(stateRef(), { speakerDone: true, speakerDoneAt: serverTimestamp() });
}

// ---------- 已投票人數（主控台、投影畫面用；只算人數，不看分數） ----------
// const follow = voteCounter((n) => …)；每次狀態更新時呼叫 follow(state.voteOpen)
// n：這一輪已經投票的人數；null＝沒有開放或讀不到
export function voteCounter(onCount) {
  let key = "";
  let stop = null;
  return (v) => {
    const k = v && v.session && v.round ? `${v.session}_${v.round}` : "";
    if (k === key) return;
    key = k;
    stop?.();
    stop = null;
    onCount(null);
    if (!k) return;
    const q = query(collection(db, COL.votes), where("session", "==", v.session), where("round", "==", v.round));
    stop = onSnapshot(q, (snap) => { if (key === k) onCount(snap.size); }, (e) => { console.warn("讀不到投票人數", e); onCount(null); });
  };
}
