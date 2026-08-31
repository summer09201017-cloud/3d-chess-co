// puzzles.js - 📅 每日殘局題庫(N 步殺)
//
// 每天一題、全世界同一題:日期(台北時間 UTC+8 換日)→ FNV-1a → 題庫輪出。
// 不用 Math.random ⇒ 任何裝置、任何時刻開,同一天必同一題(零後端)。
//
// ★ 題庫紀律(0831 立,沿用象棋每日殘局那套、再加一層更強的):
//   ① 每一題的「mateIn: N」不是宣稱,是**數學證明**——test/daily.mjs 用窮舉搜尋
//      證明「白方 N 步內必殺、且 N-1 步殺不了」(西洋棋有 chess.js 完整規則,
//      做得到象棋做不到的嚴格證明)。
//   ② 題名用「殺法模式」的通稱(後排殺/雙車梯殺…),不冒名任何棋書名局。
//   ③ FEN 是標準格式,白方先走。

// 每天出幾題(一組)。★ 5 題=一次坐下來解得完、又有「今天全解」的成就感(0831 使用者點名)。
export const DAILY_SET_SIZE = 5;

export const DAILY_PUZZLES = [
  // ── 一步殺(暖身)──
  { id: "back-rank-1", name: "後排殺", mateIn: 1,
    hint: "黑王被自己的兵關在底線——一支車就夠!",
    fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1" },
  { id: "ladder-final", name: "雙車收官", mateIn: 1,
    hint: "一支車封住第七排,另一支車下最後通牒!",
    fen: "k7/6R1/8/8/8/8/8/6KR w - - 0 1" },
  { id: "queen-kiss", name: "貼身皇后", mateIn: 1,
    hint: "皇后走到黑王臉上——有王護駕就吃不掉她!",
    fen: "6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1" },
  { id: "smother-ready", name: "悶殺一擊", mateIn: 1,
    hint: "黑王被自己人擠得沒地方走——馬跳進去就結束!",
    fen: "6rk/6pp/8/6N1/8/8/6PP/6K1 w - - 0 1" },
  { id: "diag-snipe", name: "斜線狙擊", mateIn: 1,
    hint: "皇后沿斜線瞄到角落的王——一步到位!",
    fen: "7k/6pp/8/8/8/8/1Q4PP/6K1 w - - 0 1" },
  { id: "rook-lift", name: "側翼突襲", mateIn: 1,
    hint: "王被擠在邊路——車從側面一擊!",
    fen: "7k/8/6K1/8/8/8/8/R7 w - - 0 1" },

  // ── 兩步殺 ──
  { id: "ladder-mate", name: "雙車梯殺", mateIn: 2,
    hint: "兩支車像爬樓梯:一支將軍逼王後退,另一支封路!",
    fen: "8/1k6/6R1/7R/8/8/8/6K1 w - - 0 1" },
  { id: "rooks-wall-2", name: "車車圍城", mateIn: 2,
    hint: "一支車先封六排斷退路,另一支車把王逼上底線!",
    fen: "8/2k5/5R2/7R/8/8/8/6K1 w - - 0 1" },
  { id: "corner-squeeze", name: "牆角圍捕", mateIn: 2,
    hint: "先用皇后把王釘在角落,再叫幫手收尾!",
    fen: "7k/8/5N2/8/8/8/1Q6/6K1 w - - 0 1" },
  { id: "l-shape-rooks", name: "直角雙車", mateIn: 2,
    hint: "兩支車一橫一豎擺出直角——王往哪邊躲都來不及!",
    fen: "4k3/8/R7/1R6/8/8/8/6K1 w - - 0 1" },
  { id: "rooks-chase-2", name: "雙車趕王", mateIn: 2,
    hint: "先封住王腳下那一排,再從側面下最後通牒!",
    fen: "8/4k3/1R6/R7/8/8/8/6K1 w - - 0 1" },
  { id: "queen-corner-2", name: "后王逼角", mateIn: 2,
    hint: "自己的王已經站好位——皇后繞到底線收網!",
    fen: "6k1/8/5K2/8/8/8/2Q5/8 w - - 0 1" },
  { id: "queen-hunt", name: "皇后獵王", mateIn: 2,
    hint: "先讓自己的王貼上去堵路,皇后再一擊致命!",
    fen: "7k/8/8/5K2/8/8/1Q6/8 w - - 0 1" },

  // ── 三步殺(進階)──
  { id: "ladder-3", name: "長梯趕王", mateIn: 3,
    hint: "雙車輪流將軍,把王一排一排趕到底線!",
    fen: "8/8/1k6/6R1/7R/8/8/6K1 w - - 0 1" },
  { id: "rook-box", name: "車王合圍", mateIn: 3,
    hint: "車畫出牢籠,自己的王上前一步步收網!",
    fen: "4k3/8/8/3K4/8/8/8/7R w - - 0 1" },
  { id: "rooks-march-3", name: "雙車長征", mateIn: 3,
    hint: "王還在半路上——雙車輪流將軍,三步把他押到底線!",
    fen: "8/8/2k5/6R1/7R/8/8/6K1 w - - 0 1" },
];

// 台北時間(UTC+8)的日期——「全世界同一題」需要一條固定的換日線(與撞球/象棋同式)
export function dailyPuzzleKey(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// FNV-1a:日期字串 → 32 位種子(決定性,不用 Math.random)
function dailySeed(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 單題版(舊介面;=今天那一組的第一題) */
export function puzzleForDate(key) {
  const set = puzzlesForDate(key, 1);
  return { key, index: set.indexes[0], puzzle: set.puzzles[0] };
}

/* ★ 每日一組(0831 使用者點名「不要只有 1 題」):
     決定性 Fisher-Yates 抽 count 題**不重複**,再依 mateIn 由易到難排 ⇒
     今天全世界拿到同一組、同一順序。count 超過題庫大小時自動夾住。 */
export function puzzlesForDate(key, count = DAILY_SET_SIZE) {
  const n = Math.max(1, Math.min(count | 0 || 1, DAILY_PUZZLES.length));
  const rng = mulberry32(dailySeed(key));
  const pool = DAILY_PUZZLES.map((_, i) => i);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const indexes = pool.slice(0, n)
    .sort((a, b) => DAILY_PUZZLES[a].mateIn - DAILY_PUZZLES[b].mateIn || a - b);
  return { key, indexes, puzzles: indexes.map((i) => DAILY_PUZZLES[i]) };
}
