// 🔬 「▼ 收起選單 / ▲ 展開選單」真瀏覽器驗收(playwright-core + 系統 Edge/Chrome)。v26,2026-09-14。
// 跑法:npm run serve(py -m http.server 4174)後 node scripts/check-fold.mjs
//       線上:CHECK_URL=https://3dchesscodex.pages.dev node scripts/check-fold.mjs
// 驗(桌機 1200×800 與手機直向 390×844 各跑一輪):
//   ① 鈕看得見、整顆在畫面內、夠大好按;起點是展開的
//   ② 真點擊(page.click,不用 evaluate 呼叫)⇒ body.menu-folded、aside.control-column 的 offsetParent 變 null、
//      棋盤 getBoundingClientRect 寬高不變小(桌機要真的變大)、頁面沒橫向溢出、常用鈕仍在
//   ③ 再按 ⇒ 展開回來(class 拿掉、面板回來、鈕面/aria-expanded 對、棋盤尺寸回到原本)
//   ④ 收起後 reload ⇒ 還是收起的(localStorage 記得住),鈕仍看得見
//   ⑤ 整場零 pageerror
import { chromium } from "playwright-core";

const URL = (process.env.CHECK_URL || "http://localhost:4174").replace(/\/$/, "");
const FOLD_KEY = "3d-chess-co.menuFolded";

let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; }
  catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};

/* 首次載入會裝 SW;有些站裝完會自動 reload 一次。等到 navigation type 變 reload 再點,6 秒沒等到就放行
   (本站的 SW 不會自動 reload,這裡只是保險,免得點下去頁面正好被換掉)。 */
async function settle(page) {
  await page.waitForFunction(
    () => (performance.getEntriesByType("navigation")[0] || {}).type === "reload",
    null, { timeout: 6000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
}

async function snapshot(page) {
  return page.evaluate((key) => {
    const aside = document.querySelector("aside.control-column");
    const copy = document.querySelector(".hero-copy");
    const btn = document.querySelector("#menuFoldButton");
    let stored = null;
    try { stored = localStorage.getItem(key); } catch { /* 私密模式 */ }
    return {
      folded: document.body.classList.contains("menu-folded"),
      asideHidden: !aside || aside.offsetParent === null,
      copyHidden: !copy || copy.offsetParent === null,
      text: btn ? btn.textContent.trim() : "",
      expanded: btn ? btn.getAttribute("aria-expanded") : null,
      stored,
      docWidth: document.documentElement.scrollWidth,
    };
  }, FOLD_KEY);
}

/* 棋盤是 3D transform 過的元素,用 getBoundingClientRect 量投影後的框(前後同一 viewport 比,公平)。 */
async function boardBox(page) {
  return page.evaluate(() => {
    const r = document.querySelector("#board").getBoundingClientRect();
    return { width: r.width, height: r.height, top: r.top };
  });
}

const VIEWPORTS = [
  { name: "桌機 1200×800", viewport: { width: 1200, height: 800 }, mobile: false },
  { name: "手機直向 390×844", viewport: { width: 390, height: 844 }, mobile: true },
];

const allErrors = [];
for (const vp of VIEWPORTS) {
  console.log(`\n── ${vp.name} ──`);
  const context = await browser.newContext({
    viewport: vp.viewport,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    deviceScaleFactor: vp.mobile ? 3 : 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(vp.name + ": " + String(e)));

  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
  await settle(page);
  // 起點一律「展開」:清掉上一輪殘留的收起狀態再重載,不然 ① 量到的是收起的版面
  await page.evaluate((k) => { try { localStorage.removeItem(k); } catch { /* 私密模式 */ } }, FOLD_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // ① 鈕看得見、整顆在畫面內
  const btn = page.locator("#menuFoldButton");
  ok(await btn.count() === 1, "有 #menuFoldButton");
  ok(await btn.isVisible(), "鈕看得見");
  const bb = await btn.boundingBox();
  ok(Boolean(bb) && bb.x >= 0 && bb.x + bb.width <= vp.viewport.width + 0.5,
    `鈕整顆在畫面寬度內(x=${bb && Math.round(bb.x)} w=${bb && Math.round(bb.width)})`);
  ok(Boolean(bb) && bb.height >= 40, `鈕夠大好按(高 ${bb && Math.round(bb.height)}px ≥ 40)`);
  const before = await snapshot(page);
  ok(!before.folded && !before.asideHidden, "起點是展開的(面板看得到)", JSON.stringify(before));
  ok(before.text === "▼ 收起選單" && before.expanded === "true",
    "起點鈕面「▼ 收起選單」、aria-expanded=true", `${before.text} / ${before.expanded}`);
  const boardBefore = await boardBox(page);

  // ② 真點擊收起
  await btn.click();
  await page.waitForTimeout(350);
  const folded = await snapshot(page);
  ok(folded.folded, "按下 ⇒ body.menu-folded");
  ok(folded.asideHidden, "★ 控制面板 offsetParent 變 null(真的藏掉)");
  ok(folded.copyHidden, "標題文字也收起(棋盤往上拿到空間)");
  ok(folded.text === "▲ 展開選單" && folded.expanded === "false",
    "鈕面變「▲ 展開選單」、aria-expanded=false", `${folded.text} / ${folded.expanded}`);
  ok(folded.stored === "1", "localStorage 記了 1", String(folded.stored));
  ok(folded.docWidth <= vp.viewport.width, "收起後頁面沒有橫向溢出", `scrollWidth=${folded.docWidth}`);
  const boardAfter = await boardBox(page);
  const grewW = boardAfter.width - boardBefore.width;
  const grewH = boardAfter.height - boardBefore.height;
  ok(grewW >= -0.5 && grewH >= -0.5,
    `★ 棋盤框不變小(寬 ${Math.round(boardBefore.width)}→${Math.round(boardAfter.width)},高 ${Math.round(boardBefore.height)}→${Math.round(boardAfter.height)})`);
  if (!vp.mobile) ok(grewW > 8, `桌機:棋盤真的變大(寬 +${Math.round(grewW)}px)`);
  else ok(boardAfter.top < boardBefore.top, `手機:棋盤往上移(top ${Math.round(boardBefore.top)}→${Math.round(boardAfter.top)})`);
  ok(await page.locator("#hintButton").isVisible() && await page.locator("#undoButton").isVisible(),
    "收起後 提示/悔棋 鈕仍看得到");
  ok(await page.locator("#newGameButton").isVisible(), "收起後「重新開局」仍看得到");

  // ③ 再按 ⇒ 展開回來
  await btn.click();
  await page.waitForTimeout(350);
  const reopened = await snapshot(page);
  ok(!reopened.folded && !reopened.asideHidden && !reopened.copyHidden,
    "再按 ⇒ 展開回來(class 拿掉、面板與標題回來)", JSON.stringify(reopened));
  ok(reopened.text === "▼ 收起選單" && reopened.expanded === "true", "鈕面回「▼ 收起選單」、aria-expanded=true");
  ok(reopened.stored === "0", "localStorage 記了 0", String(reopened.stored));
  const boardBack = await boardBox(page);
  ok(Math.abs(boardBack.width - boardBefore.width) <= 1, "棋盤尺寸回到原本",
    `${Math.round(boardBefore.width)} vs ${Math.round(boardBack.width)}`);

  // ④ 收起 → reload ⇒ 記得住
  await btn.click();
  await page.waitForTimeout(250);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const persisted = await snapshot(page);
  ok(persisted.folded && persisted.asideHidden, "★ reload 後還是收起的(localStorage 記得住)", JSON.stringify(persisted));
  ok(persisted.text === "▲ 展開選單" && persisted.expanded === "false",
    "reload 後鈕面/aria 也對", `${persisted.text} / ${persisted.expanded}`);
  ok(await page.locator("#menuFoldButton").isVisible(), "reload 後鈕仍看得見(沒被收進面板裡)");

  // 收尾:展開並清掉,不留狀態給下一輪
  await btn.click();
  await page.waitForTimeout(200);
  await page.evaluate((k) => { try { localStorage.removeItem(k); } catch { /* 私密模式 */ } }, FOLD_KEY);

  ok(errors.length === 0, "這一輪零 pageerror", errors.join(" | ").slice(0, 200));
  allErrors.push(...errors);
  await context.close();
}

await browser.close();
console.log(`\n🔬 check-fold:${pass} 過 / ${fail} 失敗${allErrors.length ? "(pageerror " + allErrors.length + ")" : ""}`);
process.exit(fail ? 1 : 0);
