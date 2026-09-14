// 🔬 ⛶ 放大 / fit-play「玩的版面」真瀏覽器驗收(v27,2026-09-14;playwright-core + 系統 Edge/Chrome)。
// 跑法:npm run serve(或任何靜態伺服器)後 node scripts/check-fit.mjs
//       線上:CHECK_URL=https://3dchesscodex.pages.dev node scripts/check-fit.mjs
// 由來:使用者 0914「按了放大棋盤沒變大」「手機橫向棋盤在畫面外」「PC 版完全沒有 ⛶」。
// 驗三個版面,全部真點擊(page.click / mouse),不用 evaluate 直呼函式:
//   桌機 1280×720:① ⛶ 看得見 ② 按 ⇒ body.immersive+fit-play、hero 藏、棋盤投影框整個在畫面內且 ≥55% 高、
//                 頁面不捲、✕ 離開看得見 ③ 按 ✕ ⇒ 全部復原
//   手機橫向 844×390:④ 不按任何鈕就已是 fit-play(自動滿版)、棋盤在畫面內且 ≥70% 高、工具列在右欄
//                 ⑤ 「☰ 選單」⇒ panels-open、設定欄回來;再按 ⇒ 收回
//   手機直向 390×844:⑥ 按 ⛶ ⇒ 棋盤寬 ≥90% 螢幕、投影高 ≥ 240px(俯角上限 44°)、頁面不捲、狀態列看得見 ⑦ 按 ✕ 復原
//   ⑧ 整場零 pageerror
import { chromium, devices } from "playwright-core";

const URL = (process.env.CHECK_URL || "http://localhost:4174").replace(/\/$/, "");
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};
const errors = [];

const snap = (page) => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom), vis: !!e.offsetParent && getComputedStyle(e).display !== "none" && getComputedStyle(e).visibility !== "hidden" }; };
  const fixedVis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== "none" && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0; };
  return {
    body: document.body.className, vw: innerWidth, vh: innerHeight,
    scrollH: document.documentElement.scrollHeight,
    board: r("#board"), status: r("#statusText"), hero: r(".hero-card"), controls: r("#controlColumn"), toolbar: r(".board-toolbar"),
    fullVis: fixedVis("#mfsFull"), exitVis: fixedVis("#mfsExit"),
    chipsVisible: [...document.querySelectorAll(".board-toolbar button")].filter((b) => { const x = b.getBoundingClientRect(); return x.width > 0 && x.top >= 0 && x.bottom <= innerHeight; }).length,
    menuChip: r("#playMenuButton"),
  };
});
const inView = (b, s) => b && b.x >= -1 && b.y >= -1 && b.right <= s.vw + 1 && b.bottom <= s.vh + 1;
/* 等棋盤投影框穩定(俯角有 180ms transition,進真全螢幕時瀏覽器還會重排一輪 ⇒ 固定等 450ms 會量到過渡中的框;
   0914 實測 300ms 時 h=183、600ms 才到 268)。連兩次取樣相同就算穩,最多等 2.5 秒。 */
const settleBoard = async (page) => {
  let last = "";
  await page.waitForTimeout(700);   // 進真全螢幕那一下 headless 會先停一拍再跑 transition:先等它開始動,再等它停
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => { const r = document.getElementById("board").getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); });
    if (now === last) return;
    last = now;
  }
};
const clickFixed = async (page, sel) => { const b = await page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); await page.mouse.click(b.x, b.y); await settleBoard(page); };

/* ── 桌機 ── */
console.log("── 桌機 1280×720 ──");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push("desktop: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(600);
  let s = await snap(page);
  ok(s.fullVis, "① 桌機右上角看得到 ⛶(以前只給觸控裝置)");
  ok(!s.body.includes("fit-play"), "① 沒按之前是一般版面(桌機不自動滿版)", s.body);
  const before = s.board;
  await clickFixed(page, "#mfsFull");
  s = await snap(page);
  ok(s.body.includes("immersive") && s.body.includes("fit-play"), "② 按 ⛶ ⇒ body.immersive + body.fit-play", s.body);
  ok(s.hero && !s.hero.vis, "② 標題卡藏起來");
  ok(inView(s.board, s), "② 棋盤投影框整個在畫面內", JSON.stringify(s.board));
  ok(s.board && s.board.h >= s.vh * 0.55, "② 棋盤投影高 ≥ 55% 螢幕(真的放大,不是只藏標題)", `${s.board?.h}/${s.vh}`);
  ok(s.board && before && s.board.h > before.h * 1.05, "② 比按之前更大", `${before?.h} → ${s.board?.h}`);
  ok(s.scrollH <= s.vh + 2, "② 整頁一屏、不用捲", `${s.scrollH} vs ${s.vh}`);
  ok(s.exitVis && !s.fullVis, "② ✕ 離開看得見、⛶ 藏起來(出口不是隱形的)");
  ok(s.chipsVisible >= 7, "② 工具列鈕(提示/悔棋/上一步…)都在畫面內", String(s.chipsVisible));
  ok(s.status && s.status.vis && inView(s.status, s), "② 狀態列(輪到誰)看得見");
  await clickFixed(page, "#mfsExit");
  s = await snap(page);
  ok(!s.body.includes("immersive") && !s.body.includes("fit-play"), "③ 按 ✕ ⇒ 沉浸與 fit-play 都關", s.body);
  ok(s.hero && s.hero.vis && s.fullVis, "③ 標題卡回來、⛶ 回來");
  await page.close();
}

/* ── 手機橫向 ── */
console.log("── 手機橫向 844×390 ──");
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("landscape: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(700);
  let s = await snap(page);
  ok(s.body.includes("fit-play") && !s.body.includes("immersive"), "④ 轉橫向不用按鈕就自動滿版(fit-play)", s.body);
  ok(inView(s.board, s), "④ 棋盤投影框整個在畫面內(以前頂端在 y=346/390)", JSON.stringify(s.board));
  ok(s.board && s.board.h >= s.vh * 0.7, "④ 棋盤投影高 ≥ 70% 螢幕", `${s.board?.h}/${s.vh}`);
  ok(s.toolbar && s.toolbar.x >= s.vw - 140, "④ 工具列直排在右欄", JSON.stringify(s.toolbar));
  ok(s.chipsVisible >= 6, "④ 右欄至少 6 顆鈕在畫面內(其餘可捲)", String(s.chipsVisible));
  ok(s.scrollH <= s.vh + 2, "④ 整頁一屏、不用捲", `${s.scrollH} vs ${s.vh}`);
  ok(s.fullVis, "④ ⛶ 仍看得見(要真全螢幕收網址列時按它)");
  ok(s.menuChip && s.menuChip.vis && inView(s.menuChip, s), "⑤ 「☰ 選單」鈕在畫面內");
  await page.click("#playMenuButton");
  await settleBoard(page);
  s = await snap(page);
  ok(s.body.includes("panels-open"), "⑤ 按 ☰ ⇒ body.panels-open", s.body);
  ok(s.controls && s.controls.vis, "⑤ 設定欄(AI 強度/存檔/步數)回來了");
  ok(s.scrollH > s.vh, "⑤ 這時是一般長頁版面(可捲去看設定)", `${s.scrollH}`);
  await page.click("#playMenuButton");
  await settleBoard(page);
  s = await snap(page);
  ok(!s.body.includes("panels-open") && inView(s.board, s), "⑤ 再按 ⇒ 收回、棋盤又整個在畫面內");
  await ctx.close();
}

/* ── 手機直向 ── */
console.log("── 手機直向 390×844 ──");
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("portrait: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(700);
  let s = await snap(page);
  ok(!s.body.includes("fit-play"), "⑥ 直向沒按之前是一般版面", s.body);
  const before = s.board;
  await clickFixed(page, "#mfsFull");
  s = await snap(page);
  ok(s.body.includes("fit-play"), "⑥ 按 ⛶ ⇒ fit-play", s.body);
  ok(inView(s.board, s), "⑥ 棋盤投影框整個在畫面內", JSON.stringify(s.board));
  ok(s.board && s.board.w >= s.vw * 0.9, "⑥ 棋盤寬 ≥ 90% 螢幕", `${s.board?.w}/${s.vw}`);
  ok(s.board && s.board.h >= 240, "⑥ 棋盤投影高 ≥ 240px(俯角上限 44°,比 52° 高一截)", `${before?.h} → ${s.board?.h}`);
  ok(s.scrollH <= s.vh + 2, "⑥ 整頁一屏、不用捲(以前還有 3000px 要捲)", `${s.scrollH} vs ${s.vh}`);
  ok(s.status && s.status.vis && inView(s.status, s), "⑥ 狀態列看得見");
  ok(s.exitVis, "⑥ ✕ 離開看得見");
  await clickFixed(page, "#mfsExit");
  s = await snap(page);
  ok(!s.body.includes("fit-play") && s.hero && s.hero.vis, "⑦ 按 ✕ ⇒ 復原、標題卡回來", s.body);
  await ctx.close();
}

ok(errors.length === 0, "⑧ 整場零 pageerror", errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\ncheck-fit: ${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
