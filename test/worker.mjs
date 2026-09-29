// 🧵 AI Worker 契約 + 世代守門(2026-09-29 真 3D 升級)
// 跑法:node test/worker.mjs(不開瀏覽器:handleRequest 是純函式、ai-client 用假 Worker 驗)
//
// 守的東西(規格第 2、3、5 節):
//   ① 請求是純資料:structuredClone 之後餵回 Worker **還能重建並走一手**(不是只長得像)
//   ② 從 initialFen 完整重播 moves:三次重複局面要跟主頁同一個結論(只拿 FEN 起局就判不出來 —— 反例驗)
//   ③ 每日殘局:initialFen = 題目 FEN,重播正確
//   ④ 世代:bump 之後舊回覆一律丟;**停用世代比對**的假 client 必紅(反例)
//   ⑤ 逾時 / Worker 拋錯 ⇒ ok:false,之後的請求會重建 Worker
import { Chess } from "../vendor/chess.js";
import { handleRequest } from "../ai-worker.js";
import { createAiClient } from "../js/ai-client.js";
import { DAILY_PUZZLES } from "../puzzles.js";

let pass = 0, fail = 0;
const ok = (name, cond, note = "") => {
  if (cond) { pass++; console.log(`  🟢 ${name}`); }
  else { fail++; console.log(`  🔴 ${name}${note ? " → " + note : ""}`); }
};
const START = new Chess().fen();
const reqFor = (game, initialFen, type = "ai", difficulty = "easy", extra = {}) => ({
  type, requestId: 1, generation: 0, initialFen, difficulty, fen: game.fen(),
  moves: game.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion ?? null })),
  ...extra,
});

console.log("① 純資料、clone 後可重建並走一手");
{
  const g = new Chess();
  g.move("e4"); g.move("e5"); g.move("Nf3");
  const req = structuredClone(reqFor(g, START));
  const res = handleRequest(req);
  ok("回覆 ok", res.ok === true, res.error);
  ok("回覆欄位齊(type/requestId/generation/fen/ok/move/error)", ["type", "requestId", "generation", "fen", "ok", "move", "error"].every((k) => k in res));
  const back = new Chess(g.fen());
  let legal = false;
  try { legal = !!back.move({ from: res.move.from, to: res.move.to, promotion: res.move.promotion ?? undefined }); } catch { legal = false; }
  ok("Worker 給的手在主頁局面合法", legal, JSON.stringify(res.move));
  ok("回覆也 structuredClone 得過", (() => { try { structuredClone(res); return true; } catch { return false; } })());
  ok("captured 是 null 或棋種字母", res.move.captured === null || /^[pnbrqk]$/.test(res.move.captured));
  ok("hint type 也能跑", handleRequest({ ...req, type: "hint" }).ok === true);
}

console.log("② 完整重播保留歷史語意(三次重複)");
{
  const g = new Chess();
  for (const san of ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]) g.move(san);
  ok("主頁:三次重複 ⇒ 和局", g.isThreefoldRepetition() && g.isGameOver());
  const res = handleRequest(structuredClone(reqFor(g, START)));
  ok("Worker 重播後也判和局(不給手)", res.ok && res.move === null, JSON.stringify(res));
  // 反例:只拿 FEN 起局(丟掉歷史)⇒ 引擎看不出三次重複,會照樣給一手 —— 證明②那條不是恆真
  const fenOnly = handleRequest({ ...reqFor(g, START), initialFen: g.fen(), moves: [] });
  ok("反例:只送 FEN 就判不出和局(給了一手)", fenOnly.ok && fenOnly.move !== null);
}

console.log("③ 每日殘局:initialFen = 題目 FEN");
{
  const pz = DAILY_PUZZLES[0];
  const g = new Chess(pz.fen);
  const res = handleRequest(structuredClone(reqFor(g, pz.fen, "hint")));
  ok(`第一題 ${pz.id} 提示可算`, res.ok && res.move, res.error);
  const bad = handleRequest({ ...reqFor(g, START) });
  ok("起點送錯(標準開局 FEN)⇒ 重播對不上就回錯,不瞎算", bad.ok === false && /match|replay/.test(bad.error));
  ok("未知難度 ⇒ 回錯", handleRequest({ ...reqFor(g, pz.fen), difficulty: "godlike" }).ok === false);
  ok("非法棋譜 ⇒ 回錯", handleRequest({ ...reqFor(new Chess(), START), moves: [{ from: "e2", to: "e5", promotion: null }] }).ok === false);
}

/* ── 假 Worker:照真的 onmessage 介面,回覆可以手動延遲 / 壞掉 ── */
function makeFakeWorker({ mode = "normal" } = {}) {
  const made = [];
  class FakeWorker {
    constructor() { this.queue = []; this.terminated = false; made.push(this); }
    postMessage(msg) {
      structuredClone(msg);   // 真 Worker 會 clone:clone 不過就該在這裡炸
      this.queue.push(msg);
      if (mode === "throw") setTimeout(() => this.onerror?.({ preventDefault() {} }), 0);
    }
    flush() {
      const q = this.queue; this.queue = [];
      for (const m of q) if (!this.terminated) this.onmessage?.({ data: handleRequest(m) });
    }
    terminate() { this.terminated = true; }
  }
  return { FakeWorker, made };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

console.log("④ 世代守門");
{
  const { FakeWorker, made } = makeFakeWorker();
  const ai = createAiClient({ url: "x", WorkerImpl: FakeWorker, timeoutMs: 1000 });
  const g = new Chess(); g.move("e4");
  const p1 = ai.request({ type: "ai", initialFen: START, moves: g.history({ verbose: true }), fen: g.fen(), difficulty: "easy" });
  ai.bump();                        // 悔棋 / 新局
  made[0].flush();                  // 舊 Worker 晚到的回覆
  ok("bump 之後舊請求回 null(丟掉)", (await p1) === null);
  ok("bump 時有在途請求 ⇒ 舊 Worker 被收掉", made[0].terminated === true);
  const p2 = ai.request({ type: "ai", initialFen: START, moves: g.history({ verbose: true }), fen: g.fen(), difficulty: "easy" });
  ok("下一個請求開了新 Worker", made.length === 2);
  made[1].flush();
  const r2 = await p2;
  ok("新世代的回覆正常收到", r2 && r2.ok && r2.move && r2.generation === ai.generation, JSON.stringify(r2));
  // 同 type 重派:舊的被取代
  const a = ai.request({ type: "hint", initialFen: START, moves: [], fen: START, difficulty: "hard" });
  const b = ai.request({ type: "hint", initialFen: START, moves: [], fen: START, difficulty: "hard" });
  made[1].flush();
  ok("同 type 重派:舊的回 null、新的收到", (await a) === null && (await b)?.ok === true);
}

console.log("④' 反例:沒有世代比對的 client 會把舊手收進新局");
{
  // 最小的「沒守門」版本:收到什麼就用什麼
  const { FakeWorker, made } = makeFakeWorker();
  const naive = () => { const w = new FakeWorker(); return { req(m) { return new Promise((res) => { w.onmessage = (e) => res(e.data); w.postMessage(m); }); }, w }; };
  const n = naive();
  const g = new Chess(); g.move("e4");
  const pr = n.req(reqFor(g, START));
  /* 這時 app 已經重開新局了 —— 但沒守門的 client 還是會把回覆交出去 */
  n.w.flush();
  const got = await pr;
  ok("反例成立:沒守門時舊回覆照樣交出(= 舊手會進新局)", got && got.move !== null && made.length === 1);
}

console.log("⑤ 逾時 / 拋錯 ⇒ ok:false,之後重建");
{
  const { FakeWorker, made } = makeFakeWorker();
  const ai = createAiClient({ url: "x", WorkerImpl: FakeWorker, timeoutMs: 20 });
  const r = await ai.request({ type: "ai", initialFen: START, moves: [], fen: START, difficulty: "easy" });   // 不 flush ⇒ 逾時
  ok("逾時 ⇒ ok:false error=timeout", r && r.ok === false && r.error === "timeout", JSON.stringify(r));
  ok("逾時的 Worker 被收掉", made[0].terminated === true);
  const p = ai.request({ type: "ai", initialFen: START, moves: [], fen: START, difficulty: "easy" });
  ok("重試開新 Worker", made.length === 2);
  made[1].flush();
  ok("重試成功", (await p)?.ok === true);

  const t = makeFakeWorker({ mode: "throw" });
  const ai2 = createAiClient({ url: "x", WorkerImpl: t.FakeWorker, timeoutMs: 1000 });
  const r2 = await ai2.request({ type: "ai", initialFen: START, moves: [], fen: START, difficulty: "easy" });
  ok("Worker 拋錯 ⇒ ok:false", r2 && r2.ok === false && r2.error === "worker-error");
  const noW = createAiClient({ url: "x", WorkerImpl: undefined });
  const r3 = await noW.request({ type: "ai", initialFen: START, moves: [], fen: START, difficulty: "easy" });
  ok("沒有 Worker(舊瀏覽器)⇒ ok:false,不同步硬算", r3 && r3.ok === false);
  await tick();
}

console.log(`\n${fail ? "🔴" : "🟢"} worker:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
