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

function evaluateBoard(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === "w" ? -MATE_SCORE : MATE_SCORE;
  }

  if (chess.isDraw()) {
    return 0;
  }

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

  const mobility = chess.moves().length * 2;
  score += chess.turn() === "w" ? mobility : -mobility;

  if (chess.isCheck()) {
    score += chess.turn() === "w" ? -28 : 28;
  }

  return score;
}

function moveOrderScore(chess, move) {
  let score = 0;

  if (move.captured) {
    score += 10 * PIECE_VALUES[move.captured] - PIECE_VALUES[move.piece];
  }

  if (move.promotion) {
    score += PIECE_VALUES[move.promotion];
  }

  chess.move(move);

  if (chess.isCheckmate()) {
    score += MATE_SCORE;
  } else if (chess.isCheck()) {
    score += 40;
  }

  chess.undo();
  return score;
}

function orderMoves(chess, moves) {
  return [...moves].sort((left, right) => moveOrderScore(chess, right) - moveOrderScore(chess, left));
}

function negamax(chess, depth, alpha, beta, colorSign) {
  if (depth === 0 || chess.isGameOver()) {
    return colorSign * evaluateBoard(chess);
  }

  let bestScore = -Infinity;
  const moves = orderMoves(chess, chess.moves({ verbose: true }));

  for (const move of moves) {
    chess.move(move);
    const score = -negamax(chess, depth - 1, -beta, -alpha, -colorSign);
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

export function getBestMove(chess, preset = DIFFICULTY_PRESETS.medium) {
  const moves = chess.moves({ verbose: true });

  if (!moves.length) {
    return null;
  }

  const colorSign = chess.turn() === "w" ? 1 : -1;
  const scoredMoves = [];
  let bestScore = -Infinity;

  for (const move of orderMoves(chess, moves)) {
    chess.move(move);
    const score = -negamax(chess, preset.depth - 1, -Infinity, Infinity, -colorSign);
    chess.undo();

    scoredMoves.push({ move, score });

    if (score > bestScore) {
      bestScore = score;
    }
  }

  const tolerance = 40 + preset.randomness * 160;
  const candidates = scoredMoves.filter((entry) => entry.score >= bestScore - tolerance);
  const bucket = candidates.length ? candidates : scoredMoves;
  const pickIndex = Math.floor(Math.random() * bucket.length);

  return bucket[pickIndex].move;
}
