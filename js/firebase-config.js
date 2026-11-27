// ============================================================
// 這是整個網站「唯一需要你修改」的設定檔
// 目前沿用提案比賽網站的 Firebase 專案（fa26-pitch）
// 辯論比賽的資料都放在 debate_ 開頭的集合，不會動到提案比賽的資料
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyCoO6qcfDOlyMgxxfhQeyB5CVqbDKK-gT4",
  authDomain: "fa26-pitch.firebaseapp.com",
  projectId: "fa26-pitch",
  storageBucket: "fa26-pitch.firebasestorage.app",
  messagingSenderId: "231024665286",
  appId: "1:231024665286:web:cebe921b656f2b2fd7adc7",
};

// 活動名稱（後台「活動設定」可以改，這裡是還沒設定時的預設值）
export const EVENT_NAME = "FA26 辯論比賽";

// 比賽日期（首頁的賽程會在當天標出「進行中」的項目）
export const EVENT_DATE = "2026-12-04";

// 只允許這個網域的 Google 帳號登入
export const SCHOOL_DOMAIN = "g.nccu.edu.tw";

// 永遠是管理員的 email（就算名單還沒建立也能進後台）
// ⚠️ 如果要改，firestore.rules 裡的 isOwnerAdmin() 也要一起改
export const OWNER_ADMINS = ["s.w.liao@g.nccu.edu.tw"];
