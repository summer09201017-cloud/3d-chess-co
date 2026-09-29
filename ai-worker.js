/* ai-worker.js — 電腦與 💡 提示在背景執行緒思考,主執行緒的 3D 畫面繼續跑(2026-09-29 真 3D 升級;board3d-kit 坑 7)
 *
 * ★ 規則與棋力一個字都沒搬家:引擎是同一支 vendor/chess.js,搜尋是同一支 ai.js(getBestMove / getHintMove),
 *   只是換一條執行緒跑。深度、隨機比率、提示門檻全部照舊。
 * ★ 請求(js/ai-client.js 送來,全是可結構化複製的純資料,不送 Chess 實例):
 *   { type: "ai"|"hint", requestId, generation, initialFen, moves: [{from,to,promotion}], fen, difficulty }
 *   從 initialFen 把 moves **完整重播**(不是直接 new Chess(fen)):三次重複局面、五十步規則要靠歷史才判得出來,
 *   只拿 FEN 起局,AI 會看不到「再走一次就和局」。重播完的 FEN 必須等於請求的 fen,對不上就回錯,不瞎算。
 * ★ 回覆:{ type, requestId, generation, fen, ok, move: null|{from,to,promotion,captured}, error: null|string }
 *   captured 為 null 或 p/n/b/r/q/k。主執行緒自己再驗一次世代 / 局面 / 合法性才採用。
 */
import { Chess } from "./vendor/chess.js";
import { DIFFICULTY_PRESETS, getBestMove, getHintMove } from "./ai.js";

/** 純函式版(test/worker.mjs 直接呼叫,不必開 Worker) */
export function handleRequest(req) {
  const base = {
    type: req && req.type, requestId: req && req.requestId, generation: req && req.generation, fen: req && req.fen,
  };
  try {
    if (!req || (req.type !== "ai" && req.type !== "hint")) throw new Error("unknown request type");
    const preset = DIFFICULTY_PRESETS[req.difficulty];
    if (!preset) throw new Error("unknown difficulty");
    const chess = new Chess(req.initialFen);
    for (const m of req.moves || []) {
      const ok = chess.move({ from: m.from, to: m.to, promotion: m.promotion ?? undefined });
      if (!ok) throw new Error(`replay failed at ${m.from}${m.to}`);
    }
    if (chess.fen() !== req.fen) throw new Error("replayed position does not match fen");
    if (chess.isGameOver()) return { ...base, ok: true, move: null, error: null };
    const best = req.type === "hint" ? getHintMove(chess) : getBestMove(chess, preset);
    if (!best) return { ...base, ok: true, move: null, error: null };
    return {
      ...base, ok: true, error: null,
      move: { from: best.from, to: best.to, promotion: best.promotion ?? null, captured: best.captured ?? null },
    };
  } catch (err) {
    return { ...base, ok: false, move: null, error: String((err && err.message) || err) };
  }
}

if (typeof self !== "undefined" && typeof self.postMessage === "function" && typeof window === "undefined") {
  self.onmessage = (e) => { self.postMessage(handleRequest(e.data)); };
}
