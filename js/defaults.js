// ============================================================
// 預設資料：活動設定、題目、當天流程（rundown）
// 管理員在後台存檔後，網站會改用 Firestore 裡的資料；這裡只是「還沒設定時」的預設值
// ⚠️ 名單、email、分數不要寫在這裡（repo 是公開的）
// ============================================================

// 後台題目下拉選單的備選題目（老師的 Excel）
export const TOPIC_OPTIONS = [
  "監獄是否能強迫犯罪者勞動？",
  "應不應該放棄去太空，把資金拿來幫助底層人民？",
  "父母生孩子前，是否應該接受考試？",
  "民主投票是不是多數暴力？",
  "子女是否應該償還父母的債務？",
  "約會費用是否應該兩個人平分？",
];

// 四組的代號（Firestore 文件 ID 也用這個）
export const TEAM_IDS = ["am_pro", "am_con", "pm_pro", "pm_con"];

export const SESSIONS = {
  am: { label: "上午場", start: "10:00" },
  pm: { label: "下午場", start: "13:00" },
};

export const SIDE_LABEL = { pro: "正方", con: "反方" };

export const DEFAULT_SETTINGS = {
  eventName: "FA26 辯論比賽",
  topics: { am: TOPIC_OPTIONS[0], pm: TOPIC_OPTIONS[5] },
  teamNames: { am_pro: "", am_con: "", pm_pro: "", pm_con: "" }, // 空白＝用「上午正方」這類預設名稱
  judgeWeight: 3, // 主持人、評審的分數倍數
  bellWarnSec: 30, // 剩幾秒時輕響提醒
};

// ------------------------------------------------------------
// 流程的每一個「段落」
//   durationSec：時長（秒）；0 ＝ 不倒數
//   untilTime：倒數到某個時間（例如 "10:00"），有填就不看 durationSec
//   planStart：預定開始時間（只用來排首頁賽程，實際以主控台按「下一項」為準）
//   group：首頁賽程把同一組的段落合成一列
// ------------------------------------------------------------
function seg(o) {
  return {
    session: null, round: null, type: "idle", side: null, title: "",
    durationSec: 0, untilTime: null, planStart: null, group: null,
    speakerFromRound: null, showSlides: null, music: null, openVote: null,
    showPlayers: false, showTopics: false, hostScript: "",
    ...o,
  };
}

// 上午場、下午場共用的模板
export function buildSession(s) {
  const S = (o) => seg({ session: s, ...o });
  const g1 = "第一輪：發表觀點";
  const g2 = "第二輪：回應問題";
  const g3 = "第三輪：總結＋講評";
  const isAm = s === "am";
  return [
    // ---------- 第一輪 ----------
    S({ id: `${s}-r1-intro`, round: 1, type: "host", group: g1, title: "主持人介紹選手與題目", durationSec: 60,
      planStart: SESSIONS[s].start, music: "intro", showPlayers: true,
      hostScript: "第一輪主持人開場：介紹題目、正反方 6 位選手，請選手起立揮手。" }),
    S({ id: `${s}-r1-pro`, round: 1, type: "speech", side: "pro", group: g1, title: "正方 ❶ 發表觀點", durationSec: 300,
      speakerFromRound: 1, showSlides: "pro", hostScript: "請正方一辯上台發表觀點，5 分鐘，台下邊聽邊做筆記。" }),
    S({ id: `${s}-r1-con`, round: 1, type: "speech", side: "con", group: g1, title: "反方 ❶ 發表觀點", durationSec: 300,
      speakerFromRound: 1, showSlides: "con", hostScript: "謝謝正方。請反方一辯上台發表觀點，5 分鐘。" }),
    S({ id: `${s}-r1-pro-cross`, round: 1, type: "cross", side: "pro", group: g1, title: "正方三人自由提問", durationSec: 120,
      hostScript: "質詢環節：只問問題、先不回答。請正方三位選手向反方提問，2 分鐘。" }),
    S({ id: `${s}-r1-con-cross`, round: 1, type: "cross", side: "con", group: g1, title: "反方三人自由提問", durationSec: 120,
      hostScript: "換反方三位選手向正方提問，2 分鐘。對手先不回答。" }),
    S({ id: `${s}-r1-announce`, round: 1, type: "host", group: g1, title: "宣布休息投票＋第二輪開始時間", durationSec: 60,
      hostScript: "宣布 30 分鐘休息：正方到小教室 B、反方到小教室 C；觀眾和評審掃 QR Code 做第一輪投票、留言。說出第二輪開始時間。" }),
    S({ id: `${s}-r1-break`, round: 1, type: "break", group: "休息＋第 1 輪評分", title: "休息＋準備・第 1 輪評分", durationSec: 1800,
      music: "break", openVote: { session: s, round: 1 } }),

    // ---------- 第二輪 ----------
    S({ id: `${s}-r2-con-recap`, round: 2, type: "host", side: "con", group: g2, title: "主持人回顧反方論點與被問的問題", durationSec: 60,
      hostScript: "第二輪主持人開場：回顧上一輪反方的主張，以及正方問了反方什麼。" }),
    S({ id: `${s}-r2-con`, round: 2, type: "speech", side: "con", group: g2, title: "反方 ❷ 回應問題", durationSec: 300,
      speakerFromRound: 2, showSlides: "con", hostScript: "請反方二辯上台回應正方的問題，5 分鐘。" }),
    S({ id: `${s}-r2-pro-recap`, round: 2, type: "host", side: "pro", group: g2, title: "主持人回顧正方論點與被問的問題", durationSec: 60,
      hostScript: "謝謝反方。回顧上一輪正方的主張，以及反方問了正方什麼。" }),
    S({ id: `${s}-r2-pro`, round: 2, type: "speech", side: "pro", group: g2, title: "正方 ❷ 回應問題", durationSec: 300,
      speakerFromRound: 2, showSlides: "pro", hostScript: "請正方二辯上台回應反方的問題，5 分鐘。" }),
    S({ id: `${s}-r2-comments`, round: 2, type: "comments", group: g2, title: "宣讀高人氣觀眾留言", durationSec: 300,
      hostScript: "宣讀投影上的觀眾留言，請雙方帶回小教室討論，在第三輪總結時回應。" }),
    S({ id: `${s}-r2-announce`, round: 2, type: "host", group: g2, title: "宣布休息投票＋第三輪開始時間", durationSec: 60,
      hostScript: "請大家掃 QR Code 做第二輪投票。20 分鐘休息，雙方選出第三輪總結的人。說出第三輪開始時間。" }),
    S({ id: `${s}-r2-break`, round: 2, type: "break", group: "休息＋第 2 輪評分", title: "休息＋準備・第 2 輪評分", durationSec: 1200,
      music: "break", openVote: { session: s, round: 2 } }),

    // ---------- 第三輪 ----------
    S({ id: `${s}-r3-recap`, round: 3, type: "host", group: g3, title: "主持人回顧前兩輪＋觀眾留言", durationSec: 120,
      hostScript: "第三輪主持人開場：回顧正反方前兩輪的重點，以及觀眾最關心的提問。" }),
    S({ id: `${s}-r3-coin`, round: 3, type: "coin", group: g3, title: "猜硬幣決定總結順序", durationSec: 60,
      hostScript: "請正反方各一位代表上台猜硬幣，猜對的一方選先講或後講。結果請在主控台按下。" }),
    S({ id: `${s}-r3-pro`, round: 3, type: "speech", side: "pro", group: g3, title: "正方 ❸ 總結", durationSec: 300,
      speakerFromRound: 3, showSlides: "pro", hostScript: "請正方三辯上台總結，5 分鐘。提醒：總結不能提出全新證據。" }),
    S({ id: `${s}-r3-con`, round: 3, type: "speech", side: "con", group: g3, title: "反方 ❸ 總結", durationSec: 300,
      speakerFromRound: 3, showSlides: "con", hostScript: "請反方三辯上台總結，5 分鐘。" }),
    S({ id: `${s}-r3-commentary`, round: 3, type: "commentary", group: g3, title: "評審講評・第 3 輪評分", durationSec: 600,
      openVote: { session: s, round: 3 },
      hostScript: "請四位評審講評，每人 2 分鐘。提醒大家完成第三輪投票。" }),
    S({ id: `${s}-end`, round: 3, type: "host", group: g3,
      title: isAm ? "感謝選手，結果下午公布" : "感謝選手，接下來是頒獎典禮",
      durationSec: 0,
      hostScript: isAm
        ? "上午場結果會在下午頒獎典禮統一公布。請大家拍手感謝六位選手與評審，然後去吃飯！（不要公布任何分數）"
        : "請大家拍手感謝下午場六位選手與評審，休息一下，接下來就是頒獎典禮！（不要公布任何分數）" }),
  ];
}

export function buildDefaultRundown() {
  return [
    seg({ id: "setup", type: "idle", title: "場地布置", planStart: "08:30", untilTime: "09:00", music: "idle", showTopics: true }),
    seg({ id: "rules", type: "host", title: "規則講解、分組", planStart: "09:00", durationSec: 1200 }),
    seg({ id: "prep", type: "idle", title: "準備階段", planStart: "09:20", untilTime: "10:00", music: "idle", showTopics: true,
      hostScript: "選手查資料，評審練習講評、選出主持人。" }),
    ...buildSession("am"),
    seg({ id: "lunch", type: "lunch", title: "午餐", planStart: "12:00", durationSec: 3600, music: "lunch" }),
    ...buildSession("pm"),
    seg({ id: "waiting", type: "idle", title: "頒獎典禮即將開始", untilTime: "15:05", music: "idle", waitingRoom: true,
      hostScript: "待機畫面：倒數到頒獎典禮開始。" }),
    seg({ id: "ceremony", type: "ceremony", title: "頒獎典禮", planStart: "15:05", durationSec: 1500 }),
  ];
}

// ------------------------------------------------------------
// 依照 planStart、durationSec、untilTime 算出每段的預定開始時間（分鐘數）
// ------------------------------------------------------------
export function toMinutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2})[:：](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function planTimes(segments) {
  let cursor = null;
  return segments.map((s) => {
    const anchor = toMinutes(s.planStart);
    const start = anchor ?? cursor ?? 0;
    const until = toMinutes(s.untilTime);
    const end = until != null && until > start ? until : start + (s.durationSec || 0) / 60;
    cursor = end;
    return { start, end };
  });
}
