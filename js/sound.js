// 投影畫面的音樂與音效（只有 display.html 會用到）
// 要播哪個檔案由 display.js 決定（本機檔案或網站內建 audio/*.mp3）。缺檔時安靜跳過，不會報錯。

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
    this.track = null;
    this.paused = false;
    this.onChange = null;
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

  // 換背景音樂：舊的淡出、新的淡入；track 為 null ＝ 停止
  // track = { key, src, loop, label }：key 一樣就不重播（同一首歌跨段落會接著播）
  setMusic(track) {
    if (!this.enabled) { this.wantKey = track; return; }
    const key = track?.key ?? null;
    if (key === this.bgKey) return;
    this.bgKey = key;
    this.track = track || null;
    this.paused = false;
    const old = this.bg;
    this.bg = null;
    if (old) fadeTo(old, 0, FADE_MS, () => { old.pause(); old.src = ""; });
    if (!track) { this.changed(); return; }
    const a = new Audio(track.src);
    a.loop = !!track.loop;
    a.volume = 0;
    a.addEventListener("error", () => { /* 沒有這個檔案：安靜跳過 */ });
    a.addEventListener("ended", () => this.changed());
    this.bg = a;
    this.changed();
    // 舊音樂淡出到一半再開始新的，比較自然
    setTimeout(() => {
      if (this.bg !== a || this.paused) return;
      a.play().then(() => { fadeTo(a, this.volume, FADE_MS); this.changed(); }).catch((e) => console.warn("音樂播不出來", e));
    }, old ? FADE_MS / 2 : 0);
  }

  // 工具列小播放器：暫停／繼續目前的背景音樂
  togglePause() {
    const a = this.bg;
    if (!a) return;
    if (this.paused || a.paused) {
      this.paused = false;
      if (a.ended) a.currentTime = 0;
      a.volume = this.volume;
      a.play().catch(() => {});
    } else {
      this.paused = true;
      a.pause();
    }
    this.changed();
  }

  // 現在的狀態（給小播放器顯示）
  status() {
    const a = this.bg;
    return {
      label: this.track?.label || "",
      playing: !!a && !a.paused && !a.ended,
      hasTrack: !!a,
    };
  }
  changed() { this.onChange?.(this.status()); }

  // 音效（鈴聲、提醒聲）：播一次，不影響背景音樂；src 為 null ＝ 不播
  // 回傳 <audio>，需要時可以提早停掉（例如揭曉時把鼓聲收掉）
  effect(src) {
    if (!this.enabled || !src) return null;
    const a = new Audio(src);
    a.volume = this.volume;
    a.addEventListener("error", () => {});
    a.play().catch(() => {});
    return a;
  }

  // 淡出並停止一個音效
  stopEffect(a, ms = 800) {
    if (!a) return;
    fadeTo(a, 0, ms, () => { a.pause(); a.src = ""; });
  }
}
