// Google Slides 網址處理
// 選手貼的是一般網址（.../presentation/d/{ID}/edit...），這裡轉成可以嵌入的網址

// 回傳 { kind: "id" | "pub", id } 或 null
export function parseSlidesUrl(url) {
  const s = String(url || "").trim();
  if (!/^https:\/\/docs\.google\.com\/presentation\//.test(s)) return null;
  // 「發布到網路」的網址：/presentation/d/e/2PACX-.../pub
  let m = s.match(/\/presentation\/d\/e\/([\w-]+)/);
  if (m) return { kind: "pub", id: m[1] };
  m = s.match(/\/presentation\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (m) return { kind: "id", id: m[1] };
  return null;
}

export function isSlidesUrl(url) {
  return !!parseSlidesUrl(url);
}

// slide：要從第幾頁開始（1 起算，可省略）
export function slidesEmbedUrl(url, slide = null) {
  const p = parseSlidesUrl(url);
  if (!p) return "";
  const base = p.kind === "pub"
    ? `https://docs.google.com/presentation/d/e/${p.id}/embed`
    : `https://docs.google.com/presentation/d/${p.id}/embed`;
  const q = "start=false&loop=false&delayms=60000&rm=minimal";
  return `${base}?${q}${slide ? `&slide=${slide}` : ""}`;
}

// 給人點開的網址（新分頁檢視）
export function slidesViewUrl(url) {
  const p = parseSlidesUrl(url);
  if (!p) return "";
  return p.kind === "pub"
    ? `https://docs.google.com/presentation/d/e/${p.id}/pub`
    : `https://docs.google.com/presentation/d/${p.id}/view`;
}

// 給選手編輯用的網址（老師在 Google Drive 把四份簡報設成組員可編輯）
export function slidesEditUrl(url) {
  const p = parseSlidesUrl(url);
  if (!p) return "";
  return p.kind === "pub"
    ? `https://docs.google.com/presentation/d/e/${p.id}/pub`
    : `https://docs.google.com/presentation/d/${p.id}/edit`;
}
