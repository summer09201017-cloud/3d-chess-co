/* ai-client.js — 主執行緒這一端的 AI 派工(2026-09-29 真 3D 升級)
 *
 * 一條 Worker、每種 type 同時最多一個在途請求。三道守門,少一道都是零紅字的 bug:
 *   ① 世代(generation):重開 / 悔棋 / 讀檔 / 換題 / 續玩 / 改難度 ⇒ app 呼叫 bump(),舊回覆一到就丟
 *      (gomoku3d 實錄:少這條,悔棋後電腦會把上一局算好的那手下進新局)。
 *   ② requestId:同一世代裡又派了一次(例如提示重按),只收最新那一個。
 *   ③ 逾時 30 秒 / Worker 拋錯 / 啟動失敗 ⇒ 回 { ok:false },並把這條 Worker 收掉,下一次請求重建(= 「重試 AI」)。
 * ⚠ 不在主執行緒同步退回原搜尋:那會凍住 3D 畫面,正是這次要解的問題(規格第 3 節)。
 *
 * 用法:
 *   const ai = createAiClient();
 *   const r = await ai.request({ type: "ai", initialFen, moves, fen, difficulty });
 *   // r = null(被新世代 / 新請求取代,什麼都別做)| worker 回覆 { ok, move, error, ... }
 */
export const AI_TIMEOUT_MS = 30000;

export function createAiClient({ url = new URL("../ai-worker.js", import.meta.url), timeoutMs = AI_TIMEOUT_MS, WorkerImpl = globalThis.Worker } = {}) {
  let worker = null;
  let generation = 0;
  let nextId = 1;
  const pending = new Map();   // type → { requestId, generation, resolve, timer }
  const log = [];              // 驗收用:最近 30 筆 { type, requestId, generation, outcome }

  const note = (entry) => { log.push(entry); if (log.length > 30) log.shift(); };

  function kill(reason) {
    if (worker) { try { worker.terminate(); } catch { /* 已經掛了 */ } }
    worker = null;
    for (const [type, p] of pending) {
      clearTimeout(p.timer);
      note({ type, requestId: p.requestId, generation: p.generation, outcome: reason });
      p.resolve({ type, requestId: p.requestId, generation: p.generation, ok: false, move: null, error: reason });
    }
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    if (typeof WorkerImpl !== "function") throw new Error("Web Worker 不支援");
    worker = new WorkerImpl(url, { type: "module" });
    worker.onmessage = (e) => {
      const msg = e.data || {};
      const p = pending.get(msg.type);
      if (!p || p.requestId !== msg.requestId) { note({ type: msg.type, requestId: msg.requestId, generation: msg.generation, outcome: "stale-id" }); return; }
      pending.delete(msg.type);
      clearTimeout(p.timer);
      if (msg.generation !== generation) { note({ type: msg.type, requestId: msg.requestId, generation: msg.generation, outcome: "stale-gen" }); p.resolve(null); return; }
      note({ type: msg.type, requestId: msg.requestId, generation: msg.generation, outcome: msg.ok ? "ok" : "error" });
      p.resolve(msg);
    };
    worker.onerror = (e) => { e?.preventDefault?.(); kill("worker-error"); };
    worker.onmessageerror = () => kill("worker-message-error");
    return worker;
  }

  return {
    get generation() { return generation; },
    log,
    /** 局面換了(新局 / 悔棋 / 讀檔 / 換題 / 續玩 / 改難度):在途的全部作廢,回覆一到就丟 */
    bump() {
      generation++;
      const hadPending = pending.size > 0;
      for (const [type, p] of pending) { clearTimeout(p.timer); note({ type, requestId: p.requestId, generation: p.generation, outcome: "cancelled" }); p.resolve(null); }
      pending.clear();
      /* 還在算的搜尋不會自己停:不收掉的話,新局的第一個請求要排在舊搜尋後面等(Worker 是單執行緒)⇒ 直接換一條新的 */
      if (hadPending && worker) { try { worker.terminate(); } catch { /* 已經掛了 */ } worker = null; }
      return generation;
    },
    busy(type) { return pending.has(type); },
    /** 派一個請求;同 type 還有在途的 ⇒ 舊的作廢(resolve null) */
    request({ type, initialFen, moves, fen, difficulty }) {
      const requestId = nextId++;
      const gen = generation;
      const prev = pending.get(type);
      if (prev) { clearTimeout(prev.timer); pending.delete(type); note({ type, requestId: prev.requestId, generation: prev.generation, outcome: "superseded" }); prev.resolve(null); }
      return new Promise((resolve) => {
        let w;
        try { w = ensureWorker(); }
        catch (err) { note({ type, requestId, generation: gen, outcome: "no-worker" }); resolve({ type, requestId, generation: gen, fen, ok: false, move: null, error: String(err && err.message || err) }); return; }
        const timer = setTimeout(() => {
          if (pending.get(type)?.requestId !== requestId) return;
          kill("timeout");   // 算不完的 Worker 收掉,下一次請求重建一條新的
        }, timeoutMs);
        pending.set(type, { requestId, generation: gen, resolve, timer });
        // 只送純資料:moves 逐筆重建成 {from,to,promotion},不把 chess.js 的 verbose move(含 flags / san / 方法)整包丟過去
        const payload = {
          type, requestId, generation: gen, initialFen, fen, difficulty,
          moves: (moves || []).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion ?? null })),
        };
        try { w.postMessage(payload); }
        catch (err) { pending.delete(type); clearTimeout(timer); resolve({ type, requestId, generation: gen, fen, ok: false, move: null, error: String(err && err.message || err) }); }
      });
    },
    /** 重試 AI:把壞掉 / 卡住的那條收掉,下一次請求重建 */
    reset() { kill("reset"); },
    dispose() { kill("disposed"); },
  };
}
