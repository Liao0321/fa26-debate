// 投影畫面的音樂與音效（只有 display.html 會用到）
// 音樂檔放在 audio/ 資料夾，檔名固定（例如 audio/break.mp3）。缺檔時安靜跳過，不會報錯。
import { LOOP_MUSIC } from "./defaults.js";

const FADE_MS = 1500;

function fadeTo(audio, target, ms, done) {
  const start = audio.volume;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    audio.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

export class SoundBoard {
  constructor() {
    this.enabled = false; // 瀏覽器規定：要使用者點一下才能播聲音
    this.volume = Number(localStorage.getItem("debate-volume") ?? 0.8);
    this.bg = null;       // 目前的背景音樂 <audio>
    this.bgKey = null;
    this.wantKey = null;  // 還沒啟用音效前，記住應該要播什麼
  }

  enable() {
    this.enabled = true;
    const k = this.wantKey;
    this.wantKey = null;
    this.bgKey = null;
    this.setMusic(k);
  }

  setVolume(v) {
    this.volume = v;
    localStorage.setItem("debate-volume", String(v));
    if (this.bg) this.bg.volume = v;
  }

  // 換背景音樂：舊的淡出、新的淡入；key 為 null ＝ 停止
  setMusic(key) {
    if (!this.enabled) { this.wantKey = key; return; }
    if (key === this.bgKey) return;
    this.bgKey = key;
    const old = this.bg;
    this.bg = null;
    if (old) fadeTo(old, 0, FADE_MS, () => { old.pause(); old.src = ""; });
    if (!key) return;
    const a = new Audio(`audio/${key}.mp3`);
    a.loop = LOOP_MUSIC.includes(key);
    a.volume = 0;
    a.addEventListener("error", () => { /* 沒有這個檔案：安靜跳過 */ });
    this.bg = a;
    // 舊音樂淡出到一半再開始新的，比較自然
    setTimeout(() => {
      if (this.bg !== a) return;
      a.play().then(() => fadeTo(a, this.volume, FADE_MS)).catch(() => {});
    }, old ? FADE_MS / 2 : 0);
  }

  // 音效（鈴聲、提醒聲）：播一次，不影響背景音樂
  effect(key) {
    if (!this.enabled) return;
    const a = new Audio(`audio/${key}.mp3`);
    a.volume = this.volume;
    a.addEventListener("error", () => {});
    a.play().catch(() => {});
  }
}
