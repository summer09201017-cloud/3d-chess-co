const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const MATE_SCORE = 1_000_000;

const TABLES = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
      0,   0,   0,   5,   5,   0,   0,   0,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      5,  10,  10,  10,  10,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

export const DIFFICULTY_PRESETS = {
  easy: {
    label: "輕鬆",
    depth: 1,
    randomness: 0.52,
    thinkTime: 260,
  },
  medium: {
    label: "標準",
    depth: 2,
    randomness: 0.18,
    thinkTime: 420,
  },
  hard: {
    label: "高手",
    depth: 3,
    randomness: 0.04,
    thinkTime: 620,
  },
};

function mirrorIndex(index) {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return (7 - row) * 8 + col;
}

function pieceSquareScore(piece, row, col) {
  const index = row * 8 + col;
  const table = TABLES[piece.type];

  if (!table) {
    return 0;
  }

  return piece.color === "w" ? table[index] : table[mirrorIndex(index)];
}

/* ══════════ 搜尋成本鐵則(2026-09-07 提速,自 3D-Chess 搬來)══════════
   實測(Node,高手檔 depth 3):開局 8.9 秒、中局一手 **121 秒**;標準檔中局 2.8 秒。
   病根不在演算法深度,在「每個節點重複產生合法著法幾十次」:
   chess.js 1.4 的 isCheckmate()/isStalemate()/isGameOver()/isDraw()/moves() 每支都會呼叫 _moves()
   重新產生全部合法著法;moves() 還要替每一手算 SAN(為了 +/# 得 make/undo 一次 → O(n) 次生成);
   而原本的 orderMoves 在 sort 的**比較函式裡**對每一手 move()+isCheckmate()+undo()(n·log n 次,
   每次又是 3 次生成)。一個中局節點光排序就上千次著法生成。
   現在的原則:**一個節點只呼叫一次 moves({verbose:true})**,終局、機動性、排序全部從這一份推:
   - 沒棋可走 ⇒ 被將=將死、否則困斃(不呼叫 isCheckmate/isStalemate)
   - 五十步/子力不足/三次重複 ⇒ 用各自的 O(1)/掃盤 API(不呼叫 isDraw,它會再算一次困斃)
   - 機動性 = moves.length(同一份)
   - 排序的「將死/將軍」加分看 SAN 尾巴 '#'/'+'(chess.js 算 SAN 時已經 make/undo 過,白送的),不再真走
   分數與原版逐一相同(有差分測試),只是快。 */

/** 靜態評估:子力 + 位置表 + 機動性 + 被將懲罰。呼叫端保證這個局面「有棋可走且不是規則和棋」。 */
function evaluateStatic(chess, mobilityCount) {
  let score = 0;
  const board = chess.board();

  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      const piece = board[row][col];

      if (!piece) {
        continue;
      }

      const material = PIECE_VALUES[piece.type] + pieceSquareScore(piece, row, col);
      score += piece.color === "w" ? material : -material;
    }
  }

  const mobility = mobilityCount * 2;
  score += chess.turn() === "w" ? mobility : -mobility;

  if (chess.isCheck()) {
    score += chess.turn() === "w" ? -28 : 28;
  }

  return score;
}

/** 與 chess.isDraw() 同義,但困斃已由「沒棋可走」處理掉,不再為它重新產生著法 */
function isDrawByRule(chess) {
  return chess.isDrawByFiftyMoves() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition();
}

/** 終局或葉子的分數(白方視角)。moves = 這個局面的全部合法著法(呼叫端已產生) */
function evaluateNode(chess, moves) {
  if (moves.length === 0) {
    if (chess.isCheck()) {
      return chess.turn() === "w" ? -MATE_SCORE : MATE_SCORE;   // 將死
    }
    return 0;                                                    // 困斃
  }

  if (isDrawByRule(chess)) {
    return 0;
  }

  return evaluateStatic(chess, moves.length);
}

/** 排序分:吃子(MVV-LVA)+ 升變 + 將死/將軍(看 SAN 尾巴,不真走)。與原版的鍵完全相同 */
function moveOrderScore(move) {
  let score = 0;

  if (move.captured) {
    score += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
  }

  if (move.promotion) {
    score += PIECE_VALUES[move.promotion];
  }

  const last = move.san.charCodeAt(move.san.length - 1);
  if (last === 35 /* '#' */) {
    score += MATE_SCORE;
  } else if (last === 43 /* '+' */) {
    score += 40;
  }

  return score;
}

/** 每一手的排序分只算一次,再排(原本在 sort 比較函式裡反覆算,而且每次都真走一遍) */
function orderMoves(moves) {
  const scored = moves.map((move) => ({ move, key: moveOrderScore(move) }));
  scored.sort((left, right) => right.key - left.key);
  return scored.map((entry) => entry.move);
}

/** 是否為終局(沒棋可走或規則和棋)—— 用已產生好的 moves 判,不另外呼叫 isGameOver() */
function isTerminal(chess, moves) {
  return moves.length === 0 || isDrawByRule(chess);
}

/* ── 底層快路徑 ──
   公開 API 的真正成本在「漂亮化」:move()/undo() 每次都 new Move()(重算 SAN ⇒ 又一次 _moves()、再兩次 fen()),
   moves({verbose:true}) 則是每一手一個 Move ⇒ 一個節點 O(n) 次全著法生成。只用公開 API 怎麼排都快不了幾倍
   (第一版實測只有 1.9~3.5x,標準檔甚至變慢)。
   搜尋樹內改用 vendored chess.js 1.4 的底層 _moves/_makeMove/_undoMove:一個節點就一次 _moves(),不算 SAN、不算 FEN。
   三次重複的計數照公開 move()/undo() 的做法鏡射(_incPositionCount / _decPositionCount(舊 hash)),語意與原版相同。
   ★ vendor/chess.js 是釘死 1.4.0、隨站出貨的檔(README:不要換 CDN,離線要能玩),內部方法不會被升級偷改;
     萬一換版少了這些方法,supportsFastPath() 回 false,自動退回公開 API 路徑(慢,但分數相同)。 */
function supportsFastPath(chess) {
  return typeof chess._moves === "function"
    && typeof chess._makeMove === "function"
    && typeof chess._undoMove === "function"
    && typeof chess._incPositionCount === "function"
    && typeof chess._decPositionCount === "function"
    && "_hash" in chess;
}

/** 底層著法的排序:吃子(MVV-LVA)+ 升變。沒有 SAN 就不看將軍加分 —— 排序只影響剪枝快慢,不影響分數 */
function orderInternalMoves(moves) {
  const V = PIECE_VALUES;
  const scored = moves.map((move) => ({
    move,
    key: (move.captured ? 10 * V[move.captured] - V[move.piece] : 0) + (move.promotion ? V[move.promotion] : 0),
  }));
  scored.sort((left, right) => right.key - left.key);
  return scored.map((entry) => entry.move);
}

function negamaxFast(chess, depth, alpha, beta, colorSign) {
  const moves = chess._moves();

  if (depth === 0 || isTerminal(chess, moves)) {
    return colorSign * evaluateNode(chess, moves);
  }

  let bestScore = -Infinity;

  for (const move of orderInternalMoves(moves)) {
    chess._makeMove(move);
    chess._incPositionCount();
    const score = -negamaxFast(chess, depth - 1, -beta, -alpha, -colorSign);
    const hash = chess._hash;
    chess._undoMove();
    chess._decPositionCount(hash);

    if (score > bestScore) {
      bestScore = score;
    }

    if (score > alpha) {
      alpha = score;
    }

    if (alpha >= beta) {
      break;
    }
  }

  return bestScore;
}

/** 公開 API 路徑(備援):與 negamaxFast 同一套判定,只是走 moves({verbose})/move()/undo() */
function negamaxPublic(chess, depth, alpha, beta, colorSign) {
  const moves = chess.moves({ verbose: true });

  if (depth === 0 || isTerminal(chess, moves)) {
    return colorSign * evaluateNode(chess, moves);
  }

  let bestScore = -Infinity;

  for (const move of orderMoves(moves)) {
    chess.move(move);
    const score = -negamaxPublic(chess, depth - 1, -beta, -alpha, -colorSign);
    chess.undo();

    if (score > bestScore) {
      bestScore = score;
    }

    if (score > alpha) {
      alpha = score;
    }

    if (alpha >= beta) {
      break;
    }
  }

  return bestScore;
}

function negamax(chess, depth, alpha, beta, colorSign) {
  return supportsFastPath(chess)
    ? negamaxFast(chess, depth, alpha, beta, colorSign)
    : negamaxPublic(chess, depth, alpha, beta, colorSign);
}

/** 根層搜尋:回每一手的分數與候選門檻(給 getBestMove 挑,也給差分測試對賬)。
    ★ 根層視窗只收到「最佳 − 容忍度 − 1」,不是收到最佳:候選桶要的是「分數 ≥ 最佳 − 容忍度」的每一手都有**精確**分數;
      比門檻低的手可以只拿到上界(fail-soft),反正本來就進不了桶。候選集合與原版完全相同,但門檻以下的枝不再白算。 */
export function analyzeRootMoves(chess, preset = DIFFICULTY_PRESETS.medium) {
  const moves = chess.moves({ verbose: true });

  if (!moves.length) {
    return null;
  }

  const colorSign = chess.turn() === "w" ? 1 : -1;
  const tolerance = 40 + preset.randomness * 160;
  const scoredMoves = [];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const move of orderMoves(moves)) {
    chess.move(move);
    const score = -negamax(chess, preset.depth - 1, -Infinity, -alpha, -colorSign);
    chess.undo();

    scoredMoves.push({ move, score });

    if (score > bestScore) {
      bestScore = score;
      alpha = bestScore - tolerance - 1;
    }
  }

  return { scoredMoves, bestScore, tolerance };
}

export function getBestMove(chess, preset = DIFFICULTY_PRESETS.medium) {
  const analysis = analyzeRootMoves(chess, preset);

  if (!analysis) {
    return null;
  }

  const { scoredMoves, bestScore, tolerance } = analysis;
  const candidates = scoredMoves.filter((entry) => entry.score >= bestScore - tolerance);
  const bucket = candidates.length ? candidates : scoredMoves;
  const pickIndex = Math.floor(Math.random() * bucket.length);

  return bucket[pickIndex].move;
}
