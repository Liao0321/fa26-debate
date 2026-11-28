// 投影畫面：頒獎典禮
//   第 0 步：開場（三個揭曉項目）
//   第 1、2 步：舞台上正反兩組的像素小人，觀眾丟鮮花或番茄；番茄砸爛後消失，鮮花留在腳邊，花多的那組優勝
//   第 3 步：兩台拉霸機轉所有選手、主持人、評審的名字，停在 MVP
//   每一步最後都會出現「請老師上台頒獎」
// 只有主控台剛按下那一步時才播動畫；重新整理或晚一點才打開，直接顯示結果
import { esc, teamName } from "./common.js";
import { SESSIONS, SIDE_LABEL } from "./defaults.js";
import { CEREMONY_STEPS, ROLE_TEXT, seeded, throwOrder } from "./awards.js";

const SIDES = ["pro", "con"];
const TEAM_COLOR = { pro: "#ffc21a", con: "#2f9e5f" };
const TEAM_DARK = { pro: "#c98f00", con: "#1b6b3e" };

// ---------- 像素圖：每個字元是一格，連續同色的格子合成一個長方形 ----------
function pixelSvg(art, pal, cls = "", extra = "") {
  const h = art.length;
  const w = art[0].length;
  let rects = "";
  art.forEach((row, y) => {
    let x = 0;
    while (x < w) {
      const c = row[x];
      let n = 1;
      while (x + n < w && row[x + n] === c) n++;
      if (pal[c]) rects += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${pal[c]}"/>`;
      x += n;
    }
  });
  return `<svg class="${cls}" ${extra} viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

const PERSON = [
  "....KKKK....",
  "...KHHHHK...",
  "..KHHHHHHK..",
  "..KHSSSSHK..",
  "..KSKSSKSK..",
  "..KSCSSCSK..",
  "..KSSPPSSK..",
  "...KKSSKK...",
  "..KTTTTTTK..",
  ".KSTTTTTTSK.",
  ".KSTTWWTTSK.",
  ".KKTTTTTTKK.",
  "...KBBBBK...",
  "...KBKKBK...",
  "...KBKKBK...",
  "..KKK..KKK..",
];
const HAIR = ["#2b2118", "#4a2f1b", "#1c1c28", "#6b3d1f", "#3a2a22"];
const SKIN = ["#ffd7b0", "#f6c79b", "#ecb98a"];
function person(side, i) {
  return pixelSvg(PERSON, {
    K: "#141414", H: HAIR[i % HAIR.length], S: SKIN[i % SKIN.length], C: "#ff9fa8", P: "#c0392b",
    T: TEAM_COLOR[side], W: "#ffffff", B: "#3b4a6b",
  }, "cer-person");
}

const HEAD = [
  "..KKKK..",
  ".KHHHHK.",
  "KHHHHHHK",
  "KHHHHHHK",
  "KHHHHHHK",
  ".KHHHHK.",
  "KKTTTTKK",
  "KTTTTTTK",
];
const SHIRTS = ["#ff8a1f", "#5b8def", "#e5484d", "#9b6bd6", "#2fb3a6", "#f2c94c", "#ef7fb0"];
const audienceHead = (i) => pixelSvg(HEAD, { K: "#141414", H: HAIR[i % HAIR.length], T: SHIRTS[i % SHIRTS.length] }, "cer-head");

const FLOWER = [
  ".PP.PP.",
  "PPPPPPP",
  "PPPYPPP",
  ".PPPPP.",
  "..PPP..",
  "...G...",
  ".LLG...",
  "...G...",
];
const PETALS = ["#ff7eb6", "#ff5a7a", "#ffffff", "#b98cff", "#ffd24d"];
const flower = (i) => pixelSvg(FLOWER, { P: PETALS[i % PETALS.length], Y: "#ffb000", G: "#2f9e5f", L: "#7dcc9c" }, "cer-thing");

const TOMATO = [
  "..GGG..",
  ".RRGRR.",
  "RRRRRWR",
  "RRRRRRR",
  "RRRRRRR",
  ".RRRRR.",
  "..RRR..",
];
const tomato = () => pixelSvg(TOMATO, { R: "#e5484d", G: "#2f9e5f", W: "#ffc2c2" }, "cer-thing");
const SPLAT = [
  "R....R...R.",
  ".R..RRR.R..",
  "..RRRRRRR.R",
  "RRRRYRRRRR.",
  ".RRRRRRYRRR",
  "..R.RR..R..",
];
const splat = () => pixelSvg(SPLAT, { R: "#d93a3f", Y: "#ffd24d" }, "cer-thing");

const CROWN = [
  "Y..Y..Y",
  "YY.Y.YY",
  "YYYYYYY",
  "YRYYYBY",
  "YYYYYYY",
];
const crown = () => pixelSvg(CROWN, { Y: "#ffd24d", R: "#e5484d", B: "#5b8def" }, "cer-crown");

// ---------- 計時器：換畫面時全部取消 ----------
let run = 0;
let timers = [];
let sounds = [];
let ctx = null;
export function stopCeremony() {
  run++;
  timers.forEach(clearTimeout);
  timers = [];
  sounds.forEach((a) => ctx?.sound.stopEffect(a, 400));
  sounds = [];
}
function later(ms, fn) {
  const my = run;
  timers.push(setTimeout(() => { if (my === run) fn(); }, ms));
}
function playEffect(key, { loop = false, stopAfter = 0 } = {}) {
  const a = ctx.sound.effect(ctx.music.effect(key));
  if (!a) return null;
  a.loop = loop;
  sounds.push(a);
  if (stopAfter) later(stopAfter, () => ctx.sound.stopEffect(a, 1500));
  return a;
}
function stopSound(a) {
  if (!a) return;
  ctx.sound.stopEffect(a, 500);
  sounds = sounds.filter((x) => x !== a);
}

// ============================================================
// 進入點
//   o = { stage, step, animate, awards, teams, settings, sound, music }
// ============================================================
export function renderCeremony(o) {
  stopCeremony();
  ctx = o;
  const step = CEREMONY_STEPS[o.step] ? o.step : 0;
  if (step === 0) return renderIntro(o);
  if (step === 3) return renderMvp(o);
  return renderFlowers(o, CEREMONY_STEPS[step].session);
}

const awardBanner = (text) => `<div class="cer-award" id="cer-award">🎖️ ${esc(text)}</div>`;

// ---------- 第 0 步：開場 ----------
function renderIntro(o) {
  o.stage.innerHTML = `
    <div class="cer cer-intro">
      ${curtains()}
      <div class="cer-intro-box">
        <div class="cer-kicker">AWARDS</div>
        <h1 class="cer-intro-title">頒獎典禮</h1>
        <ol class="cer-plan">
          ${CEREMONY_STEPS.slice(1).map((s) => `<li><b>${s.step}</b>${esc(s.label)}</li>`).join("")}
        </ol>
      </div>
      ${audienceRow()}
    </div>`;
}

const curtains = () => `<div class="cer-curtain left"></div><div class="cer-curtain right"></div><div class="cer-valance"></div>`;

function audienceRow() {
  const n = 18;
  return `<div class="cer-audience">${Array.from({ length: n }, (_, i) =>
    `<span class="cer-fan" style="left:${(i + 0.5) * (100 / n)}%;animation-delay:${-(i * 0.37) % 1.4}s">${audienceHead(i)}</span>`).join("")}</div>`;
}

// ---------- 第 1、2 步：鮮花和番茄 ----------
// 舞台座標（畫面寬高的百分比）
const GROUP_X = { pro: 27, con: 73 };
const FEET_Y = 70;       // 小人腳底
const PILE_Y = 77;       // 花堆最底下
const PILE_W = 11;       // 花堆半寬

function pileSlots(n, side, seed) {
  const rnd = seeded(`${seed}-${side}`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 4);
    const spread = PILE_W * Math.max(0.3, 1 - layer * 0.25);
    out.push({
      x: GROUP_X[side] + (rnd() * 2 - 1) * spread,
      y: PILE_Y - layer * 3.4 - rnd() * 1.4,
      r: Math.round(rnd() * 70 - 35),
    });
  }
  return out;
}

function renderFlowers(o, session) {
  const r = o.awards?.[session];
  const title = `${SESSIONS[session].label}優勝`;
  const names = (side) => (o.teams[`${session}_${side}`]?.members || []).slice(0, 4);
  const group = (side) => {
    const list = names(side);
    const people = (list.length ? list : ["", "", ""]).map((n, i) =>
      `<div class="cer-player" style="animation-delay:${-i * 0.23}s">${person(side, i + (side === "con" ? 2 : 0))}${n ? `<span class="cer-name">${esc(n)}</span>` : ""}</div>`).join("");
    return `
      <div class="cer-group ${side}" id="cer-g-${side}" style="left:${GROUP_X[side]}%">
        <div class="cer-team">${crown()}<span class="cer-side">${SIDE_LABEL[side]}</span>${esc(teamName(`${session}_${side}`, o.settings))}</div>
        <div class="cer-people">${people}</div>
      </div>
      <div class="cer-count ${side}" style="left:${GROUP_X[side]}%"><span>🌸</span><b id="cer-n-${side}">0</b></div>
      <div class="cer-spot ${side}" id="cer-spot-${side}" style="left:${GROUP_X[side]}%"></div>`;
  };
  o.stage.innerHTML = `
    <div class="cer cer-flowers" id="cer">
      ${curtains()}
      <div class="cer-heading" id="cer-heading"><span class="cer-kicker">AWARDS ${CEREMONY_STEPS.findIndex((s) => s.session === session)}</span>${esc(title)}揭曉</div>
      <div class="cer-floor"></div>
      ${group("pro")}${group("con")}
      <div class="cer-layer" id="cer-pile"></div>
      <div class="cer-layer" id="cer-fly"></div>
      ${audienceRow()}
      <div class="cer-banner-slot" id="cer-banner"></div>
      <div class="cer-confetti" id="cer-confetti"></div>
    </div>`;

  if (!r?.winner) {
    document.getElementById("cer-banner").innerHTML = `<div class="cer-winner none">結果還沒確定（主控台要先計算結果）</div>`;
    return;
  }
  const seed = `${session}`;
  const slots = { pro: pileSlots(r.flowers.pro, "pro", seed), con: pileSlots(r.flowers.con, "con", seed) };
  const winnerHtml = () => `
    <div class="cer-winner ${r.winner}">
      <small>🏆 ${esc(title)}</small>
      <span>${SIDE_LABEL[r.winner]}・${esc(teamName(`${session}_${r.winner}`, o.settings))}</span>
    </div>`;

  if (!o.animate) {
    for (const side of SIDES) {
      slots[side].forEach((s, i) => placeFlower(side, s, i, false));
      document.getElementById(`cer-n-${side}`).textContent = String(r.flowers[side]);
    }
    reveal(r.winner, winnerHtml, false);
    document.getElementById("cer").insertAdjacentHTML("beforeend", awardBanner("請老師上台頒獎"));
    return;
  }

  // ---- 動畫 ----
  const order = throwOrder(r, seed);
  const used = { pro: 0, con: 0 };
  const drum = playEffect("drumroll", { loop: true });
  const gap = Math.max(180, Math.min(320, 8000 / order.length));
  const start = 1400;
  order.forEach((it, i) => {
    later(start + i * gap, () => {
      if (it.kind === "flower") {
        const k = used[it.side]++;
        throwThing(it, slots[it.side][k], k);
      } else {
        throwThing(it, tomatoSpot(it.side), i);
      }
    });
  });
  const end = start + order.length * gap + 1300;
  later(end, () => {
    stopSound(drum);
    reveal(r.winner, winnerHtml, true);
    playEffect("celebrate", { stopAfter: 14000 });
  });
  later(end + 3500, () => {
    document.getElementById("cer")?.insertAdjacentHTML("beforeend", awardBanner("請老師上台頒獎"));
  });
}

function tomatoSpot(side) {
  return {
    x: GROUP_X[side] + (Math.random() * 2 - 1) * PILE_W * 0.9,
    y: FEET_Y + 2 + Math.random() * 8,
    r: 0,
  };
}

function placeFlower(side, s, i, pop) {
  const el = document.createElement("div");
  el.className = `cer-flower ${pop ? "pop" : ""}`;
  el.style.left = `${s.x}%`;
  el.style.top = `${s.y}%`;
  el.style.setProperty("--r", `${s.r}deg`);
  el.innerHTML = flower(i + (side === "con" ? 2 : 0));
  document.getElementById("cer-pile")?.append(el);
}

// 從觀眾席丟出去：拋物線飛到目標位置
function throwThing(it, target, i) {
  const box = document.getElementById("cer");
  const fly = document.getElementById("cer-fly");
  if (!box || !fly) return;
  const W = box.clientWidth;
  const H = box.clientHeight;
  const x0 = (0.06 + Math.random() * 0.88) * W;
  const y0 = 0.97 * H;
  const x1 = (target.x / 100) * W;
  const y1 = (target.y / 100) * H;
  const peak = Math.min(y0, y1) - H * (0.28 + Math.random() * 0.1);
  const el = document.createElement("div");
  el.className = "cer-proj";
  el.innerHTML = it.kind === "flower" ? flower(i + (it.side === "con" ? 2 : 0)) : tomato();
  fly.append(el);
  const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
  const frames = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    // 二次貝茲曲線：起點、最高點附近的控制點、終點
    const cx = (x0 + x1) / 2;
    const cy = 2 * peak - (y0 + y1) / 2;
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1;
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1;
    const s = 1.25 - 0.35 * t; // 越飛越遠，稍微變小
    frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${spin * t}deg) scale(${s})` });
  }
  const anim = el.animate(frames, { duration: 950, easing: "linear", fill: "forwards" });
  anim.onfinish = () => {
    el.remove();
    if (it.kind === "flower") {
      placeFlower(it.side, target, i, true);
      const n = document.getElementById(`cer-n-${it.side}`);
      if (n) { n.textContent = String(Number(n.textContent) + 1); bump(n.parentElement); }
    } else {
      // 番茄：砸爛，停一下，再默默消失
      const sp = document.createElement("div");
      sp.className = "cer-splat";
      sp.style.left = `${target.x}%`;
      sp.style.top = `${target.y}%`;
      sp.innerHTML = splat();
      document.getElementById("cer-pile")?.append(sp);
      sp.addEventListener("animationend", () => sp.remove());
      const g = document.getElementById(`cer-g-${it.side}`);
      if (g) { g.classList.remove("flinch"); void g.offsetWidth; g.classList.add("flinch"); }
    }
  };
}

function bump(el) {
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function reveal(winner, winnerHtml, withConfetti) {
  document.getElementById("cer")?.classList.add("revealed", `win-${winner}`);
  document.getElementById(`cer-g-${winner}`)?.classList.add("winner");
  document.getElementById(`cer-spot-${winner}`)?.classList.add("on");
  const b = document.getElementById("cer-banner");
  if (b) b.innerHTML = winnerHtml();
  if (withConfetti) confetti();
}

function confetti(n = 90) {
  const box = document.getElementById("cer-confetti");
  if (!box) return;
  const colors = ["#ff8a1f", "#ffd24d", "#ff7eb6", "#5b8def", "#2f9e5f", "#ffffff", "#e5484d"];
  box.insertAdjacentHTML("beforeend", Array.from({ length: n }, (_, i) => {
    const left = Math.random() * 100;
    const dur = 2.6 + Math.random() * 2.4;
    const delay = Math.random() * 0.9;
    const size = 0.8 + Math.random() * 1.1;
    return `<i style="left:${left}%;width:${size}vh;height:${size * (0.5 + Math.random())}vh;background:${colors[i % colors.length]};animation-duration:${dur}s;animation-delay:${delay}s;--sway:${(Math.random() * 2 - 1) * 8}vw"></i>`;
  }).join(""));
  later(6500, () => { if (box.isConnected) box.innerHTML = ""; });
}

// ---------- 第 3 步：MVP 拉霸機 ----------
const MVP_SESSIONS = ["am", "pm"];
const SPIN = { am: 5600, pm: 8800 }; // 上午場先停，下午場後停

function renderMvp(o) {
  const mvp = o.awards?.mvp || {};
  const cands = o.awards?.candidates || {};
  // 轉輪上的名字：先放所有候選人（兩場都放，比較熱鬧），最後一格是 MVP
  const everyone = [...new Set([...(cands.am || []), ...(cands.pm || [])].map((c) => c.name).filter(Boolean))];
  const roleOf = (s) => (cands[s] || []).find((c) => c.name === mvp[s])?.role;
  const strip = (s) => {
    const rnd = seeded(`mvp-${s}`);
    const pool = everyone.length ? everyone : [mvp[s] || "？"];
    const items = [];
    while (items.length < 34) {
      const copy = [...pool];
      for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      items.push(...copy);
    }
    items.length = 34;
    if (items[33] === mvp[s]) items[33] = pool.find((n) => n !== mvp[s]) || items[33];
    items.push(mvp[s] || "？");
    return items;
  };
  const machine = (s) => {
    const items = strip(s);
    const role = roleOf(s);
    return `
      <div class="slot" id="slot-${s}">
        <div class="slot-top"><span class="slot-label">${esc(SESSIONS[s].label)} MVP</span></div>
        <div class="slot-lights">${"<i></i>".repeat(12)}</div>
        <div class="slot-window">
          <div class="slot-strip" id="strip-${s}" data-count="${items.length}">
            ${items.map((n) => `<div class="slot-item">${esc(n)}</div>`).join("")}
          </div>
          <div class="slot-glass"></div>
        </div>
        <div class="slot-role" id="role-${s}">${role ? `${esc(SESSIONS[s].label)}${esc(ROLE_TEXT[role] || "")}` : ""}</div>
        <div class="slot-lever"><i></i><b></b></div>
      </div>`;
  };
  o.stage.innerHTML = `
    <div class="cer cer-mvp" id="cer">
      ${curtains()}
      <div class="cer-heading"><span class="cer-kicker">AWARDS 3</span>兩位 MVP 揭曉</div>
      <div class="slots">${MVP_SESSIONS.map(machine).join("")}</div>
      ${audienceRow()}
      <div class="cer-confetti" id="cer-confetti"></div>
    </div>`;

  const settle = (s, ms) => {
    const el = document.getElementById(`strip-${s}`);
    if (!el) return;
    const n = Number(el.dataset.count);
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.08,.6,.12,1)` : "none";
    el.style.transform = `translateY(${-(n - 1) * 100 / n}%)`;
  };
  const stopped = (s, big) => {
    document.getElementById(`slot-${s}`)?.classList.add("stopped");
    if (big) confetti(120); else confetti(50);
  };

  if (!o.animate) {
    MVP_SESSIONS.forEach((s) => { settle(s, 0); document.getElementById(`slot-${s}`)?.classList.add("stopped"); });
    document.getElementById("cer").insertAdjacentHTML("beforeend", awardBanner("請老師上台頒獎"));
    return;
  }
  const drum = playEffect("drumroll", { loop: true });
  // 拉霸：拉桿往下，下一個畫面開始轉
  document.querySelectorAll(".slot").forEach((el) => el.classList.add("pull"));
  later(700, () => {
    MVP_SESSIONS.forEach((s) => {
      document.getElementById(`slot-${s}`)?.classList.add("spinning");
      settle(s, SPIN[s]);
    });
  });
  later(700 + SPIN.am, () => {
    document.getElementById("slot-am")?.classList.remove("spinning");
    stopped("am", false);
    playEffect("ding");
  });
  later(700 + SPIN.pm, () => {
    document.getElementById("slot-pm")?.classList.remove("spinning");
    stopSound(drum);
    stopped("pm", true);
    playEffect("celebrate", { stopAfter: 14000 });
  });
  later(700 + SPIN.pm + 3500, () => {
    document.getElementById("cer")?.insertAdjacentHTML("beforeend", awardBanner("請老師上台頒獎"));
  });
}
