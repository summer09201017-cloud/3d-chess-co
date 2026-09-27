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
// 提示現在是「先畫『想一下…』、下一個 tick 才算」,等它真的算出來,不賭固定毫秒(慢機器會假紅)
await page.waitForFunction(() => Boolean(window.__chess.state.hint), null, { timeout: 30000 });
await page.waitForTimeout(150);
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
/* 🎥 0920 六站統一視角工具列(view-kit):真點擊驗三件事——
   ① 三顆預設鈕字面對(斜俯視／正俯視／對局視角)② 🔃 換邊後水平旋轉滑桿 = 180°、state 也是 180
   ③ 正俯視後俯視角度滑桿 = 88°、那顆鈕亮起、棋盤 CSS rotateX = 2deg(本站 tilt = 90 − pitch)④ 🎯 重置回 0° / 34°(對局視角亮) */
ok(await page.locator(".view-kit").count() === 1, "有 view-kit 視角工具列");
const vkLabels = await page.locator("[data-vk-view]").allTextContents();
ok(vkLabels.join("|") === "斜俯視|正俯視|對局視角", "預設視角 3 顆、字面正確", vkLabels.join("|"));
ok(await page.locator("[data-vk-range='yaw']").count() === 1 && await page.locator("[data-vk-range='pitch']").count() === 1,
  "水平旋轉 / 俯視角度 兩條滑桿都在");
await page.click("[data-vk-reset]");
await page.waitForTimeout(250);
/* 補間 320ms 靠 rAF;無頭瀏覽器的 rAF 會忽快忽慢(canvas-playwright-verify 那條老坑)⇒ 等它真的到位,不賭固定毫秒,但記下花了多久 */
const vkWait = async (fn, label) => {
  const t0 = Date.now();
  let hit = true;
  await page.waitForFunction(fn, null, { timeout: 4000 }).catch(() => { hit = false; });
  return { hit, ms: Date.now() - t0, label };
};
await page.click("[data-vk-flip]");
const flipWait = await vkWait(() => document.querySelector("[data-vk-range='yaw']").value === "180", "flip");
const afterFlip = await page.evaluate(() => ({
  yaw: document.querySelector("[data-vk-range='yaw']").value,
  rot: Math.round(window.__chess.state.cameraRotation),
}));
ok(flipWait.hit && afterFlip.yaw === "180" && afterFlip.rot === 180,
  `🔃 換邊後水平旋轉滑桿 = 180°(state 同步;補間到位 ${flipWait.ms}ms)`, JSON.stringify(afterFlip));
ok(flipWait.ms < 1500, "換邊補間 1.5 秒內到位(不卡主執行緒)", flipWait.ms + "ms");
await page.click("[data-vk-view='flat']");
await vkWait(() => document.querySelector("[data-vk-range='pitch']").value === "88", "flat");
await page.waitForTimeout(60);
const afterFlat = await page.evaluate(() => ({
  pitch: document.querySelector("[data-vk-range='pitch']").value,
  pressed: document.querySelector("[data-vk-view='flat']").getAttribute("aria-pressed"),
  rx: document.querySelector("#board").style.getPropertyValue("--board-rotate-x").trim(),
  tilt: Math.round(window.__chess.state.cameraTilt),
}));
ok(afterFlat.pitch === "88" && afterFlat.pressed === "true" && afterFlat.rx === "2deg" && afterFlat.tilt === 2,
  "正俯視:俯視角度滑桿 88°、鈕亮起、棋盤 rotateX = 2deg(不翻不跳)", JSON.stringify(afterFlat));
await page.click("[data-vk-view='top']");
await vkWait(() => document.querySelector("[data-vk-range='pitch']").value === "58", "top");
await page.waitForTimeout(60);
const afterTop = await page.evaluate(() => ({
  pitch: document.querySelector("[data-vk-range='pitch']").value,
  rx: document.querySelector("#board").style.getPropertyValue("--board-rotate-x").trim(),
}));
ok(afterTop.pitch === "58" && afterTop.rx === "32deg", "斜俯視:俯視角度 58° ⇒ rotateX 32deg", JSON.stringify(afterTop));
await page.click("[data-vk-reset]");
await page.waitForTimeout(300);
const afterReset = await page.evaluate(() => ({
  yaw: document.querySelector("[data-vk-range='yaw']").value,
  pitch: document.querySelector("[data-vk-range='pitch']").value,
  sit: document.querySelector("[data-vk-view='sit']").getAttribute("aria-pressed"),
}));
ok(afterReset.yaw === "0" && afterReset.pitch === "34" && afterReset.sit === "true",
  "🎯 重置視角回 0° / 34°,「對局視角」亮起", JSON.stringify(afterReset));
const vkBox = await page.locator(".view-kit").boundingBox();
ok(vkBox && vkBox.width > 100 && vkBox.height > 100, "工具列真的畫出來(有寬高)", JSON.stringify(vkBox));

/* ══════ 🐾 動物對手(2026-09-28,skill animal-opponent-kit;本站是 CSS 斜視 ⇒ 透明 WebGL 小窗版)══════
   檔案側對賬 → 引擎與 skill 同一份 → 真點擊三段開關 → 坐對面(小窗在棋盤投影框正上方、不擋點擊)/ 鐵則遍歷 / 頭在小窗裡 ×3 視口
   → 走一手等牠回手(figs.log 有 think + place)→ 姿勢手動推時間 → 三段開關 → 人聲 runtime → 每日 = 🦉 */
console.log("—— 🐾 動物對手 ——");
{
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { VOICE_FILES } = await import(pathToFileURL(join(root, "js", "voicePhrases.js")).href);
  const vdir = join(root, "voice");
  const mp3 = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((f) => f.endsWith(".mp3")).sort() : [];
  const want = [...VOICE_FILES].sort();
  ok(mp3.join() === want.join(), `🗣 voice/ 有 ${mp3.length} 支 mp3,跟詞庫 ${want.length} 句一一對應`);
  const sw = fs.readFileSync(join(root, "sw.js"), "utf8");
  const missing = mp3.filter((f) => !sw.includes(`"./voice/${f}"`));
  ok(missing.length === 0 && sw.includes('"./voice/manifest.json"'), `🗣 sw.js 清單含 manifest + 每支 mp3(gen-voice 照目錄重生)${missing.length ? ":漏 " + missing.join(",") : ""}`);
  ok(sw.includes("three.js/r128/three.min.js") && ["three-shim", "animals", "voice", "opponent", "voicePhrases"].every((n) => sw.includes(`"./js/${n}.js"`)), "🐾 sw.js 清單含 three CDN + js 五支");
  let manifestOk = false;
  try { const mf = JSON.parse(fs.readFileSync(join(vdir, "manifest.json"), "utf8")); manifestOk = mp3.length > 0 && mp3.every((f) => mf[f.replace(/\.mp3$/, "")] === "voice/" + f); } catch { /* 沒烤 */ }
  ok(manifestOk, "🗣 manifest.json 的鍵值跟目錄一致");
  const tiny = mp3.filter((f) => fs.statSync(join(vdir, f)).size < 2048);
  ok(tiny.length === 0, `🗣 每支 mp3 > 2KB(空檔 = 烤失敗)${tiny.length ? ":" + tiny.join(",") : ""}`);
  const webSpeech = [...fs.readdirSync(join(root, "js")).map((f) => "js/" + f), "app.js"].filter((f) => f.endsWith(".js") && fs.readFileSync(join(root, f), "utf8").includes("speech" + "Synthesis"));
  ok(webSpeech.length === 0, `🗣 沒有 Web Speech 機器聲${webSpeech.length ? ":" + webSpeech.join(",") : ""}`);
  const kit = join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "skills", "animal-opponent-kit", "assets");
  if (fs.existsSync(kit)) {
    const drift = [["animals.js", "animals.js"], ["voice.js", "voice.js"], ["three-shim.js", "three-global-shim.js"]]
      .filter(([site, asset]) => fs.readFileSync(join(root, "js", site), "utf8") !== fs.readFileSync(join(kit, asset), "utf8")).map(([site]) => site);
    ok(drift.length === 0, `🐾 引擎三支與 skill 同一份${drift.length ? ":漂移 " + drift.join(",") : ""}`);
  }
}
await page.setViewportSize({ width: 1100, height: 800 });
await page.click("#newGameButton");
await page.waitForFunction(() => window.__chess.pet && window.__chess.pet.kind === "cat" && !window.__chess.state.daily, null, { timeout: 15000 });
await page.click('#petRow [data-pet="voice"]');
await page.waitForTimeout(700);
ok(await page.locator('#petRow .pet-opt[aria-pressed="true"]').getAttribute("data-pet") === "voice", "🐾 對戰設定有三段動物開關,按了會亮");
/* 每日流程把頁面捲到底了:棋盤在視窗外 elementFromPoint 一律 null ⇒ 先把舞台捲進視窗(真人也是看著棋盤點) */
await page.evaluate(() => document.querySelector(".scene-wrap").scrollIntoView({ block: "start" }));
await page.waitForTimeout(700);
const hudHits = (box) => [...document.querySelectorAll("#mfsFull, #mfsExit, .board-toolbar, .status-card, .hero-card, .fold-bar, .control-column")].filter((el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && !(r.right < box.l || r.left > box.r || r.bottom < box.t || r.top > box.b);
}).map((el) => el.id || el.className);
const petProbe = () => page.evaluate((fn) => {
  const hits = eval(fn);
  const P = window.__chess.pet, f = P.figure;
  let neck = 0, eyes = 0, ears = 0, brows = 0, mouth = 0;
  if (f) f.group.traverse((o) => { if (o.userData.neck) neck++; if (o.userData.eye) eyes++; if (o.userData.ear) ears++; if (o.userData.brow) brows++; if (o.userData.mouth) mouth++; });
  const b = document.querySelector("#board").getBoundingClientRect();
  const p = P.probe();
  // 小窗跟棋盤本體(格子)重疊多少:只准壓進上緣一點(牠的下半身被桌子遮住),不准蓋到格子中間
  const ov = p.canvas ? Math.max(0, Math.min(p.canvas.b, b.bottom) - Math.max(p.canvas.t, b.top)) : 0;
  const centerSq = document.querySelector('[data-square="e4"]'), farSq = document.querySelector('[data-square="e8"]');
  const hitOf = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t ? (t.closest("#board") ? "board" : t.id || t.className) : "none"; };
  return { ...p, neck, eyes, ears, brows, mouth, chip: document.querySelector("#aiChip").textContent, petOn: document.body.classList.contains("pet-on"),
    capsule: !!window.THREE.CapsuleGeometry, boardTop: Math.round(b.top), overlapPx: Math.round(ov), hits: p.headBox ? hits(p.headBox) : [],
    clickCenter: hitOf(centerSq), clickFar: hitOf(farSq) };
}, `(${hudHits.toString()})`);
const pet0 = await petProbe();
ok(pet0.figure && pet0.visible && pet0.kind === "cat" && pet0.placement === "top", `🐾 標準 ⇒ 🐱 橘貓坐在棋盤對面(小窗 ${JSON.stringify(pet0.canvas)},放 ${pet0.placement})`);
ok(pet0.capsule, "🐾 three-shim 補上了 r128 沒有的 CapsuleGeometry");
ok(pet0.neck === 1 && pet0.eyes === 2 && pet0.ears === 2 && pet0.brows === 2 && pet0.mouth === 1, "🐾 人物鐵則遍歷:脖子 1、眼 2、耳 2、眉 2、嘴 1");
ok(pet0.head.inside, `🐾 桌機:頭頂在小窗裡(NDC ${pet0.head.x}, ${pet0.head.y})`);
ok(pet0.canvas.b <= pet0.boardTop + 8 && pet0.overlapPx <= 8, `🐾 小窗在棋盤本體上方、不蓋格子(小窗底 ${pet0.canvas.b} vs 棋盤頂 ${pet0.boardTop},重疊 ${pet0.overlapPx}px)`);
ok(pet0.clickCenter === "board" && pet0.clickFar === "board", `🐾 小窗不擋點擊(e4 / e8 中心 elementFromPoint = ${pet0.clickCenter} / ${pet0.clickFar})`);
ok(pet0.hits.length === 0, `🐾 桌機:牠的臉沒被 HUD / 鈕蓋到${pet0.hits.length ? ":" + pet0.hits.join(",") : ""}`);
ok(/^黑方：🐱/.test(pet0.chip) && pet0.petOn, `🐾 名牌帶動物(${pet0.chip})、body.pet-on`);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(1200);
const petLand = await petProbe();
ok(!petLand.visible || (petLand.head.inside && petLand.overlapPx <= 8 && petLand.hits.length === 0), `🐾 手機橫向(fit-play):${petLand.visible ? `坐 ${petLand.placement}、頭在小窗裡(${petLand.head.x}, ${petLand.head.y})、不蓋格子、不被蓋${petLand.hits.length ? ":" + petLand.hits.join(",") : ""}` : "放不下就藏(OK)"}`);
ok(petLand.clickCenter === "board" && petLand.clickFar === "board", "🐾 手機橫向:小窗不擋點擊");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(1200);
const petPort = await petProbe();
ok(petPort.visible && petPort.head.inside && petPort.overlapPx <= 8, `🐾 手機直向:坐 ${petPort.placement}、頭在小窗裡(${petPort.head.x}, ${petPort.head.y})、不蓋格子(重疊 ${petPort.overlapPx}px)`);
await page.setViewportSize({ width: 1100, height: 800 });
await page.waitForTimeout(900);
/* 走一手(e2→e4)等牠回手:think 在牠開算時、place / reach / hop 在牠落子後 —— 看 figs.log,不是 grep 程式碼 */
const moved = await page.evaluate(async () => {
  const c = window.__chess; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  c.handleSquareClick("e2"); c.handleSquareClick("e4");
  for (let i = 0; i < 80 && !(c.state.game.turn() === "w" && !c.state.aiThinking); i++) await sleep(250);
  await sleep(200);
  return { turn: c.state.game.turn(), log: c.pet.figs.log.map((e) => e.kind) };
});
ok(moved.turn === "w" && moved.log.includes("think") && ["place", "reach", "hop"].some((k) => moved.log.includes(k)), `🐾 事件真的接到(figs.log):${moved.log.join(",")}`);
const pose = await page.evaluate(() => {
  const O = window.__chess.pet, f = O.figure, F = O.figs;
  const said = []; const o = O.voice.say.bind(O.voice); O.voice.say = (a, e, d) => { said.push(a + ":" + e); return o(a, e, d); };
  O.react("win", "win"); F.update(0.4);
  const up = { armL: +f.arms[0].rotation.x.toFixed(2), armR: +f.arms[1].rotation.x.toFixed(2), open: f.mouthOpen.visible };
  F.update(3.5); F.update(0.5);
  const back = { armL: +f.arms[0].rotation.x.toFixed(2), smile: f.smile.visible };
  O.react("lose", "lose"); F.update(0.4);
  const sad = { pitch: +f.head.rotation.x.toFixed(2), smileZ: +f.smile.rotation.z.toFixed(2) };
  F.update(3.5); F.update(0.5);
  O.react("think", null); F.update(0.4);
  const think = { armR: +f.arms[1].rotation.x.toFixed(2), tilt: +f.head.rotation.z.toFixed(2) };
  O.cancel(); F.update(1);
  O.voice.say = o;
  return { up, back, sad, think, said };
});
ok(pose.up.armL < -2.2 && pose.up.armR < -2.2 && pose.up.open, `🐾 win:雙手高舉 + 張嘴(${JSON.stringify(pose.up)})`);
ok(Math.abs(pose.back.armL + 1.2) < 0.15 && pose.back.smile, `🐾 反應完回休息姿勢、笑臉回來(${JSON.stringify(pose.back)})`);
ok(pose.sad.pitch > 0.3 && pose.sad.smileZ < 1.6, `🐾 lose:低頭 + 苦臉(${JSON.stringify(pose.sad)})`);
ok(pose.think.armR < -1.9 && pose.think.tilt < -0.05, `🐾 think:手托腮、頭歪(${JSON.stringify(pose.think)})`);
ok(pose.said.join(" ") === "cat:win cat:lose", `🗣 同一個入口也叫了人聲:${pose.said.join(" ")}`);
await page.click('#petRow [data-pet="off"]');
await page.waitForTimeout(300);
const off = await page.evaluate(() => ({ hidden: document.querySelector("#petCanvas").hidden, visible: window.__chess.pet.figure.group.visible, saved: localStorage.getItem("3d-chess-co-pet"), chip: document.querySelector("#aiChip").textContent, petOn: document.body.classList.contains("pet-on") }));
ok(off.hidden && off.visible === false && off.saved === "off" && off.chip === "黑方：AI" && !off.petOn, `🐾 關掉 ⇒ 小窗藏起來、localStorage 記 off、名牌回「黑方：AI」(${JSON.stringify(off)})`);
await page.click('#petRow [data-pet="mute"]');
await page.waitForTimeout(300);
const mute = await page.evaluate(() => ({ hidden: document.querySelector("#petCanvas").hidden, voiceOn: window.__chess.pet.voiceOn }));
ok(mute.hidden === false && mute.voiceOn === false, `🐾 不出聲 ⇒ 還坐著、不唸(${JSON.stringify(mute)})`);
await page.click('#petRow [data-pet="voice"]');
await page.waitForFunction(() => window.__chess.voice && window.__chess.voice.ready(), null, { timeout: 10000 }).catch(() => {});
const v = await page.evaluate(() => ({ ready: window.__chess.voice.ready(), has: window.__chess.voice.has("owl", "draw"), yes: window.__chess.voice.say("cat", "win"), no: window.__chess.voice.say("cat", "nope") }));
ok(v.ready && v.has && v.yes === true && v.no === false, `🗣 人聲 runtime:manifest 載到、cat-win 送去放、沒烤的不唸(${JSON.stringify(v)})`);
await page.click("#dailyButton");
await page.waitForFunction(() => window.__chess.state.daily && window.__chess.pet.kind === "owl", null, { timeout: 5000 });
const owl = await page.evaluate(() => ({ ...window.__chess.pet.probe(), chip: document.querySelector("#aiChip").textContent }));
ok(owl.kind === "owl" && owl.visible && owl.head.inside && /🦉/.test(owl.chip), `🐾 每日殘局 ⇒ 🦉 貓頭鷹守黑方(${owl.chip};頭 ${owl.head.x}, ${owl.head.y})`);

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
