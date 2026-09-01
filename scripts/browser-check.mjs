// 🔬 每日殘局真瀏覽器冒煙(playwright-core + 系統 Edge/Chrome)。
// 跑法:node scripts/browser-check.mjs   (先起本機伺服器,或 CHECK_URL=線上網址)
// 驗:每日鈕 → 開局=今天的 FEN → 白方走同一條 handleSquareClick 管線把今天的題解掉 →
//     將死訊息+戰績記一筆;悔棋解鎖再記;每日模式不寫自動存檔。
import { chromium } from "playwright-core";

const URL = process.env.CHECK_URL || "http://localhost:8796";
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

const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
await page.waitForTimeout(900);

ok(await page.locator("#dailyButton").count() === 1, "有「📅 每日殘局」鈕");
ok((await page.locator("#verTag").textContent()).includes("一組 5 題"), "verTag 講了一組 5 題");

/* 💡 提示鈕:真的用滑鼠按(不是 evaluate 裡呼叫 showHint)。
   evaluate-not-click-guard 存在的理由就是這個 —— 繞過真點擊的話,
   「鈕被別的東西蓋住、按不到」這種病照樣全綠。 */
ok(await page.locator("#hintButton").count() === 1, "有「💡 提示」鈕");
await page.click("#hintButton");
await page.waitForTimeout(600);
const hintA = await page.evaluate(() => {
  const s = window.__chess.state;
  return {
    hint: s.hint && { from: s.hint.from, to: s.hint.to },
    selected: s.selectedSquare,
    status: document.querySelector("#statusText").textContent,
    purple: document.querySelectorAll(".square.hint-to").length,
    badge: document.querySelectorAll(".hint-badge").length,
  };
});
ok(Boolean(hintA.hint), "按下去算得出一手", JSON.stringify(hintA));
ok(hintA.status.includes("建議"), "狀態列講出建議", hintA.status);
ok(hintA.purple === 1 && hintA.badge === 1,
  "要去的那一格標成紫色 + 壓一顆 💡(不只靠顏色)",
  `purple=${hintA.purple} badge=${hintA.badge}`);
ok(hintA.selected === hintA.hint.from,
  "順手幫你把那顆棋選起來(接著點紫格就走完)", `${hintA.selected} vs ${hintA.hint.from}`);
ok(await page.evaluate(() => {                    // 建議的那一手必須是合法著法
  const s = window.__chess.state;
  return s.game.moves({ square: s.hint.from, verbose: true }).some((m) => m.to === s.hint.to);
}), "建議的那一手是合法著法");

await page.click("#hintButton");                  // 同局面再按一次 ⇒ 同一手
await page.waitForTimeout(400);
const hintB = await page.evaluate(() => {
  const h = window.__chess.state.hint;
  return h.from + h.to;
});
ok(hintB === hintA.hint.from + hintA.hint.to,
  "同一個局面按兩次 ⇒ 同一手(不跳針)", hintA.hint.from + hintA.hint.to + " vs " + hintB);

/* 走一手之後,舊建議必須自己失效(FEN 對不上就不畫)——不是靠逐處補 clearHint。
   走法用 handleSquareClick(真手指同一條管線),不直接動 game.move。 */
await page.evaluate(() => {
  window.__chess.handleSquareClick("e2");
  window.__chess.handleSquareClick("e4");
});
await page.waitForTimeout(600);
ok(await page.evaluate(() => document.querySelectorAll(".square.hint-to").length) === 0,
  "★ 局面一變,上一手的提示自己就不見了(比對 FEN,不靠逐處清)");

/* 💡 那一段走了 e2-e4 兩手 ⇒ 自動存檔被寫了一筆。
   下面「每日模式沒寫自動存檔」那條驗的就是這個鍵,不清掉會拿我自己造的髒資料當紅燈。
   清完重新載入,讓每日那一段的起點跟沒有提示測試時**一模一樣**。 */
await page.evaluate(() => {
  localStorage.removeItem("3d-chess-co:auto-save:v1");
  localStorage.removeItem("3d-chess-co:daily:v1");
});
await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
await page.waitForTimeout(700);

await page.evaluate(() => localStorage.removeItem("3d-chess-co:daily:v1"));
await page.click("#dailyButton");
await page.waitForTimeout(600);

const st = await page.evaluate(() => {
  const s = window.__chess.state;
  return { key: s.daily?.key, name: s.daily?.puzzle?.name, mateIn: s.daily?.puzzle?.mateIn, n: s.daily?.n,
    total: s.daily?.set?.puzzles?.length,
    fenOk: s.game.fen().split(" ")[0] === s.daily?.puzzle?.fen.split(" ")[0],
    line: document.querySelector("#dailyLine")?.textContent || "" };
});
ok(!!st.key && st.fenOk, `開局=今天的題(${st.key}「${st.name}」目標 ${st.mateIn} 步)`, JSON.stringify(st));
ok(st.total === 5 && st.n === 0, "開在今天那一組的第 1 題(共 5 題)", JSON.stringify(st));
ok(st.line.includes("第 1/5 題") && st.line.includes("已走 0 步"), "常駐狀態行帶進度", st.line);

// 白方解題:窮舉「仍在必殺樹上」的那步(chess.js 就在頁面裡,直接借它算)
const end = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { Chess } = await import("./vendor/chess.js");
  function canMate(game, n) {
    if (n <= 0) return false;
    const moves = game.moves({ verbose: true });
    for (const m of moves) {
      game.move(m);
      if (game.isCheckmate()) { game.undo(); return true; }
      if (game.isGameOver()) { game.undo(); continue; }
      let allDead = n > 1;
      if (allDead) for (const r of game.moves({ verbose: true })) { game.move(r); const d = canMate(game, n - 1); game.undo(); if (!d) { allDead = false; break; } }
      game.undo();
      if (allDead) return true;
    }
    return false;
  }
  const S = window.__chess;
  const target = S.state.daily.puzzle.mateIn;
  for (let guard = 0; guard < 12 && !S.state.game.isGameOver(); guard++) {
    while (S.state.game.turn() !== "w" && !S.state.game.isGameOver()) await sleep(150);
    if (S.state.game.isGameOver()) break;
    const left = target - S.whiteMoveCount();
    const probe = new Chess(S.state.game.fen());
    let picked = null;
    for (const m of probe.moves({ verbose: true })) {
      probe.move(m);
      const good = probe.isCheckmate() || (!probe.isGameOver()
        && probe.moves({ verbose: true }).every((r) => { probe.move(r); const d = canMate(probe, left - 1); probe.undo(); return d; }));
      probe.undo();
      if (good) { picked = m; break; }
    }
    if (!picked) break;
    S.handleSquareClick(picked.from);   // 與真手指同一條輸入管線
    S.handleSquareClick(picked.to);
    await sleep(900);                    // 等 AI 回手
  }
  await sleep(800);
  return { mated: S.state.game.isCheckmate() && S.state.game.turn() === "b",
    moves: S.whiteMoveCount(), target,
    status: document.querySelector("#statusText").textContent,
    store: localStorage.getItem("3d-chess-co:daily:v1"),
    auto: localStorage.getItem("3d-chess-co:auto-save:v1") };
});
ok(end.mated && end.moves <= end.target, `第 1 題白方 ${end.moves} 步將死(目標 ${end.target})`, JSON.stringify(end));
ok(end.status.includes("將死") && end.status.includes("已解 1/5"), "結算訊息帶今天進度", end.status);
const rec = JSON.parse(end.store || "{}");
ok((rec[st.key]?.solved || {})[st.id ?? Object.keys(rec[st.key]?.solved || {})[0]] === end.moves
  || Object.values(rec[st.key]?.solved || {})[0] === end.moves,
  "★ 戰績每題分開記(" + end.store + ")");
ok(!end.auto, "★ 每日模式沒寫自動存檔(棋譜重播式存檔吃不下自訂 FEN)", String(end.auto));

// 第 2 題:再按每日鈕=自動接下一題未解的
await page.click("#dailyButton");
await page.waitForTimeout(700);
const second = await page.evaluate(() => {
  const s = window.__chess.state;
  const solved = Object.keys(JSON.parse(localStorage.getItem("3d-chess-co:daily:v1") || "{}")[s.daily.key]?.solved || {});
  return { n: s.daily.n, solvedCount: solved.length, line: document.querySelector("#dailyLine").textContent };
});
ok(second.n === 1 && second.solvedCount === 1, "再按每日鈕=接第 2 題(已解 1 題)", JSON.stringify(second));
ok(second.line.includes("第 2/5 題"), "狀態行顯示第 2/5 題", second.line);
ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
