/* 🔬 📅 每日殘局(N 步殺)驗算。
   跑法:node test/daily.mjs

   釘四件:
     ①題庫合法:FEN 載得進 chess.js、白先、開局不是已結束的局
     ②★★ mateIn 是**證明**不是宣稱:窮舉搜尋證「白 N 步內必殺(任何防守)
       且 N-1 步殺不了」——標籤必須精確,不准把四步殺寫成三步殺騙孩子
     ③決定性:同一天必同一題、UTC+8 換日、400 天輪出蓋滿題庫
     ④可玩性:證明器當白方 vs 站上高手 AI 當黑方,實打 N 步內將死
       (證明保證「任何防守 ≤N」,這條驗的是與產品 AI 的整合沒接歪) */
import { Chess } from "../vendor/chess.js";
import { DAILY_PUZZLES, dailyPuzzleKey, puzzleForDate } from "../puzzles.js";
import { DIFFICULTY_PRESETS, getBestMove } from "../ai.js";

let pass = 0, fail = 0;
const ok = (label, cond, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + label); }
  else { fail++; console.log("  🔴 " + label + (note ? "  → " + String(note).slice(0, 200) : "")); }
};
const section = (s) => console.log("\n── " + s + " ──");

/* ══ N 步殺證明器 ══
   canMate(game, n):輪白走、還剩 n 步白棋,白能不能**強制**將殺。
   白方:存在一步,使得(立刻將殺)或(黑的**每一個**回應都走進 canMate(n-1))。
   ★ 將軍步優先試(殺局幾乎都由將軍組成,剪枝快一個數量級)。 */
function canMate(game, n) {
  if (n <= 0) return false;
  const moves = game.moves({ verbose: true });
  moves.sort((a, b) => (b.san.includes("#") || b.san.includes("+")) - (a.san.includes("#") || a.san.includes("+")));
  for (const m of moves) {
    game.move(m);
    if (game.isCheckmate()) { game.undo(); return true; }
    if (game.isGameOver()) { game.undo(); continue; }   // 逼和/僵局=這條路失敗
    let allDead = n > 1;                                 // n=1 時黑還有回應=失敗
    if (allDead) {
      for (const reply of game.moves({ verbose: true })) {
        game.move(reply);
        const dead = canMate(game, n - 1);
        game.undo();
        if (!dead) { allDead = false; break; }
      }
    }
    game.undo();
    if (allDead) return true;
  }
  return false;
}
/** 找最小殺步數(≤cap;找不到回 0)——標錯 N 時give 修正建議 */
function minMate(fen, cap = 4) {
  for (let n = 1; n <= cap; n++) {
    if (canMate(new Chess(fen), n)) return n;
  }
  return 0;
}

/* ══ ① 合法 ══ */
section("① 題庫合法(" + DAILY_PUZZLES.length + " 題)");
for (const p of DAILY_PUZZLES) {
  let why = "";
  try {
    const g = new Chess(p.fen);
    if (g.turn() !== "w") why = "不是白先";
    else if (g.isGameOver()) why = "開局就結束了";
  } catch (e) { why = "FEN 壞了: " + e.message; }
  ok(`「${p.name}」FEN 合法、白先、局面活著`, !why, why);
}

/* ══ ② 證明 mateIn ══ */
section("② ★ mateIn 是證明不是宣稱(N 步必殺、N-1 步殺不了)");
for (const p of DAILY_PUZZLES) {
  const t0 = Date.now();
  const provedN = canMate(new Chess(p.fen), p.mateIn);
  const notLess = p.mateIn === 1 ? true : !canMate(new Chess(p.fen), p.mateIn - 1);
  const ms = Date.now() - t0;
  const good = provedN && notLess;
  ok(`「${p.name}」精確 ${p.mateIn} 步殺(證明耗時 ${ms}ms)`, good,
    good ? "" : `實際最小殺步=${minMate(p.fen)}(0=4 步內殺不掉)`);
}

/* ══ ③ 決定性 ══ */
section("③ 決定性與輪出");
{
  const t = Date.UTC(2026, 7, 31, 15, 59);
  ok("UTC 15:59 仍是台北 8/31", dailyPuzzleKey(t) === "2026-08-31");
  ok("UTC 16:00 換成台北 9/01", dailyPuzzleKey(t + 60000) === "2026-09-01");
  const a = puzzleForDate("2026-08-31"), b = puzzleForDate("2026-08-31");
  ok("同一天必同一題", a.index === b.index);
  const hit = new Set();
  for (let i = 0; i < 400; i++) hit.add(puzzleForDate(dailyPuzzleKey(Date.UTC(2026, 7, 31) + i * 86400000)).index);
  ok("400 天內每一題都出過場", hit.size === DAILY_PUZZLES.length, `${hit.size}/${DAILY_PUZZLES.length}`);
}

/* ══ ④ 對產品 AI 實打 ══ */
section("④ 證明器執白 vs 站上高手 AI 執黑:N 步內真的殺得掉");
for (const p of DAILY_PUZZLES) {
  const g = new Chess(p.fen);
  let whiteMoves = 0;
  let mated = false;
  while (whiteMoves < p.mateIn && !g.isGameOver()) {
    // 白:挑「仍在必殺樹上」的那步(剩餘步數遞減)
    const left = p.mateIn - whiteMoves;
    let picked = null;
    for (const m of g.moves({ verbose: true })) {
      g.move(m);
      const okBranch = g.isCheckmate() || (!g.isGameOver()
        && g.moves({ verbose: true }).every((r) => { g.move(r); const d = canMate(g, left - 1); g.undo(); return d; }));
      g.undo();
      if (okBranch) { picked = m; break; }
    }
    if (!picked) break;
    g.move(picked);
    whiteMoves++;
    if (g.isCheckmate()) { mated = true; break; }
    if (g.isGameOver()) break;
    const black = getBestMove(g, DIFFICULTY_PRESETS.hard);
    if (!black) break;
    g.move(black);
  }
  ok(`「${p.name}」對高手 AI ${whiteMoves} 步將死`, mated && whiteMoves <= p.mateIn, `mated=${mated} moves=${whiteMoves}`);
}

console.log(`\n🔬 daily:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
