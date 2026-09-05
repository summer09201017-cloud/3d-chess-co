import { Chess } from "./vendor/chess.js";
import { DIFFICULTY_PRESETS, getBestMove } from "./ai.js";
import { dailyPuzzleKey, puzzlesForDate } from "./puzzles.js";

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const AUTO_SAVE_KEY = "3d-chess-co:auto-save:v1";
const SLOT_PREFIX = "3d-chess-co:slot:";
const SAVE_SLOT_IDS = [1, 2, 3];
const DEFAULT_BOARD_MODE = "3d";
const DEFAULT_CAMERA_ROTATION = 0;
const DEFAULT_CAMERA_TILT = 58;

const boardElement = document.querySelector("#board");
const boardSceneElement = document.querySelector("#boardScene");
const statusTextElement = document.querySelector("#statusText");
const installHintElement = document.querySelector("#installHint");
const installButtonElement = document.querySelector("#installButton");
const newGameButtonElement = document.querySelector("#newGameButton");
const hintButtonElement = document.querySelector("#hintButton");
const undoButtonElement = document.querySelector("#undoButton");
const prevMoveButtonElement = document.querySelector("#prevMoveButton");
const nextMoveButtonElement = document.querySelector("#nextMoveButton");
const latestMoveButtonElement = document.querySelector("#latestMoveButton");
const continueFromHereButtonElement = document.querySelector("#continueFromHereButton");
const jumpStartButtonElement = document.querySelector("#jumpStartButton");
const difficultySelectElement = document.querySelector("#difficultySelect");
const displayModeSelectElement = document.querySelector("#displayModeSelect");
const rotateLeftButtonElement = document.querySelector("#rotateLeftButton");
const rotateResetButtonElement = document.querySelector("#rotateResetButton");
const rotateRightButtonElement = document.querySelector("#rotateRightButton");
const rotationRangeElement = document.querySelector("#rotationRange");
const tiltRangeElement = document.querySelector("#tiltRange");
const viewHintElement = document.querySelector("#viewHint");
const turnValueElement = document.querySelector("#turnValue");
const modeValueElement = document.querySelector("#modeValue");
const moveCountValueElement = document.querySelector("#moveCountValue");
const lastMoveValueElement = document.querySelector("#lastMoveValue");
const saveSlotsElement = document.querySelector("#saveSlots");
const historyListElement = document.querySelector("#historyList");

const state = {
  game: new Chess(),
  selectedSquare: null,
  legalTargets: [],
  difficulty: "medium",
  aiThinking: false,
  aiTimerId: 0,
  displayPly: null,
  boardMode: DEFAULT_BOARD_MODE,
  cameraRotation: DEFAULT_CAMERA_ROTATION,
  cameraTilt: DEFAULT_CAMERA_TILT,
  dragState: null,
  suppressSquareClick: false,
  deferredInstallPrompt: null,
  messageOverride: "",
  messageTimeoutId: 0,
  daily: null,          // 📅 每日殘局:null=一般對局;{ key, index, puzzle }=今天這一題
  dailySaved: false,    // 這一局的成績記過了沒(悔棋會解鎖,重殺可再記——取當日最少)
  /* 💡 AI 提示:{ fen, from, to } —— fen 是算它的時候那個局面。
     局面沒變就重用同一手,不重算:getBestMove 的同分手順序不保證穩定,
     每按一次重算會讓建議在幾手之間跳來跳去,看起來像跳針。 */
  hint: null,
};

const boardSquares = new Map();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

function applyBoardView() {
  const effectiveTilt = state.boardMode === "3d" ? clamp(state.cameraTilt, 20, 76) : 0;
  const normalizedRotation = normalizeRotation(state.cameraRotation);

  boardElement.classList.toggle("three-d", state.boardMode === "3d");
  boardElement.classList.toggle("two-d", state.boardMode === "2d");
  boardSceneElement.classList.toggle("is-dragging", Boolean(state.dragState));
  boardElement.style.setProperty("--board-rotate-x", `${effectiveTilt}deg`);
  boardElement.style.setProperty("--board-rotate-z", `${normalizedRotation}deg`);
}

function syncViewControls() {
  const normalizedRotation = Math.round(normalizeRotation(state.cameraRotation)) % 360;
  const clampedTilt = Math.round(clamp(state.cameraTilt, 20, 76));

  displayModeSelectElement.value = state.boardMode;
  rotationRangeElement.value = String(normalizedRotation);
  tiltRangeElement.value = String(clampedTilt);
  tiltRangeElement.disabled = state.boardMode !== "3d";
  viewHintElement.textContent = state.boardMode === "3d"
    ? `目前為 3D 模式，可拖曳棋盤做 360 度旋轉。水平 ${normalizedRotation}°，俯視 ${clampedTilt}°。`
    : `目前為 2D 模式，可 360 度旋轉棋盤方向；切回 3D 時會保留原本立體角度。`;
}

function updateBoardView({
  boardMode = state.boardMode,
  cameraRotation = state.cameraRotation,
  cameraTilt = state.cameraTilt,
  persist = false,
} = {}) {
  state.boardMode = boardMode === "2d" ? "2d" : "3d";
  state.cameraRotation = normalizeRotation(cameraRotation);
  state.cameraTilt = clamp(cameraTilt, 20, 76);

  applyBoardView();
  syncViewControls();

  if (persist) {
    saveAuto();
  }
}

function getHistory() {
  return state.game.history({ verbose: true });
}

function getDisplayPly() {
  return state.displayPly ?? getHistory().length;
}

function isViewingHistory() {
  return getDisplayPly() < getHistory().length;
}

function buildGameFromMoves(moves = []) {
  const game = new Chess();

  for (const move of moves) {
    game.move({
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? undefined,
    });
  }

  return game;
}

function getDisplayedGame() {
  const history = getHistory();
  const ply = getDisplayPly();

  if (ply === history.length) {
    return state.game;
  }

  return buildGameFromMoves(history.slice(0, ply));
}

function getLastMove(game = state.game) {
  const history = game.history({ verbose: true });
  return history[history.length - 1] ?? null;
}

function clearSelection() {
  state.selectedSquare = null;
  state.legalTargets = [];
}

/* 💡 提示只在「算它的那個局面」上有效。
   ★ 不去每一個會改動棋盤的地方補一行 clearHint() —— 那種接線方式漏一處就是
     「提示指著一格早就過期的棋」,而且不會有任何東西報錯(crowd-kit 第五條鐵則
     講的同一件事:一個錨點,不要逐處補)。這裡改成**用的時候比對 FEN**,
     結構上不可能過期。 */
function getActiveHint() {
  if (!state.hint) return null;
  return state.hint.fen === state.game.fen() ? state.hint : null;
}

/* 💡 AI 提示:借的是**同一支** getBestMove —— 提示與對手同源。
   走法本身來自 chess.js 的 moves(),所以合法性不用另外驗(這一站沒有
   3D-Xiangqi 那種「簡化版走法產生器」的落差)。
   文案三態不可混講:有建議 / 這局已經結束 / 真的沒有合法著法。 */
function showHint() {
  if (state.aiThinking) return;
  if (getDisplayPly() !== getHistory().length) {   // 回看歷史時不給(盤上不是當前局面)
    setMessage("💡 先按「回到最新」,提示只對當前局面有效。");
    render();
    return;
  }
  if (state.game.isGameOver()) {
    setMessage("💡 這一局已經結束了。");
    render();
    return;
  }
  const cached = getActiveHint();
  if (cached) {                                     // 同局面 ⇒ 同一手,不重算
    applyHintSelection(cached);
    return;
  }
  const preset = DIFFICULTY_PRESETS[state.difficulty];
  let best = null;
  try {
    best = getBestMove(state.game, preset);
  } catch (error) {
    console.error("[hint] getBestMove threw:", error);
    setMessage("💡 這一手算不出來,先自己走走看。");
    render();
    return;
  }
  if (!best) {
    setMessage("💡 找不到可走的棋了。");
    render();
    return;
  }
  state.hint = { fen: state.game.fen(), from: best.from, to: best.to };
  applyHintSelection(state.hint);
}

/* 提示 = 幫你把那顆棋選起來 + 把要去的格子標成紫色。
   選起來這一步是刻意的:孩子接著只要點那個紫格就走完了,不用自己再找一次那顆棋。 */
function applyHintSelection(hint) {
  const moves = state.game.moves({ square: hint.from, verbose: true });
  state.selectedSquare = hint.from;
  state.legalTargets = moves.map((move) => move.to);
  const piece = state.game.get(hint.from);
  const target = state.game.get(hint.to);
  const name = piece ? PIECE_NAMES[piece.type] ?? "這顆" : "這顆";
  setMessage(
    `💡 建議:${name} ${hint.from} → ${hint.to}`
      + (target ? `,吃掉對方的${PIECE_NAMES[target.type] ?? "棋"}` : "")
      + "(紫格就是要去的地方)",
    5200,
  );
  /* ⚠ setMessage 只寫進 state,畫面要等它自己的 timeout 到期才重畫 ——
     不在這裡叫一次 render(),訊息與紫格**兩樣都不會出現**,
     而 state 裡看起來一切正常(首跑冒煙就是這樣:hint 算出來了、selected 也對了,
     畫面上卻什麼都沒有)。 */
  render();
}

function cancelAiThink() {
  if (state.aiTimerId) {
    window.clearTimeout(state.aiTimerId);
  }

  state.aiTimerId = 0;
  state.aiThinking = false;
}

function setMessage(text, duration = 2400) {
  window.clearTimeout(state.messageTimeoutId);
  state.messageOverride = text;
  state.messageTimeoutId = window.setTimeout(() => {
    state.messageOverride = "";
    render();
  }, duration);
}

function squareColor(fileIndex, rank) {
  return (fileIndex + rank) % 2 === 0 ? "light" : "dark";
}

function getPieceDisplayMetrics(fileIndex, rank) {
  return {
    heightScale: 1.34,
    sizeScale: 1,
    lift: 36,
  };
}

/* 棋子中文名:describeSquare(旁白)與 💡 提示共用同一份。
   ⚠ 刻意不複製第二份 —— 兩份真相遲早漂移,而漂移的那天畫面上兩處會叫同一顆棋不同名字。 */
const PIECE_NAMES = {
  p: "兵",
  n: "馬",
  b: "象",
  r: "車",
  q: "后",
  k: "王",
};

function describeSquare(squareName, piece) {
  if (!piece) {
    return `${squareName} 空格`;
  }

  const color = piece.color === "w" ? "白" : "黑";

  return `${squareName}，${color}${PIECE_NAMES[piece.type]}`;
}

function findKingSquare(game, color) {
  for (let rank = 8; rank >= 1; rank -= 1) {
    for (const file of FILES) {
      const piece = game.get(`${file}${rank}`);

      if (piece?.type === "k" && piece.color === color) {
        return `${file}${rank}`;
      }
    }
  }

  return "";
}

function getKnightFacingClass(piece, fileIndex) {
  return piece.type === "n"
    ? (fileIndex < 4 ? "piece-left-facing" : "piece-right-facing")
    : "";
}

function createPieceElement(piece, fileIndex, rank) {
  const displayMetrics = getPieceDisplayMetrics(fileIndex, rank);
  const knightFacingClass = getKnightFacingClass(piece, fileIndex);
  const pieceElement = document.createElement("span");
  const pieceShadow = document.createElement("span");
  const pieceCore = document.createElement("span");
  const pieceBase = document.createElement("span");
  const pieceBody = document.createElement("span");
  const pieceTop = document.createElement("span");
  const pieceDetail = document.createElement("span");

  pieceElement.className = `piece piece-${piece.type} ${knightFacingClass} ${piece.color === "w" ? "white" : "black"}`.trim();
  pieceShadow.className = "piece-shadow";
  pieceCore.className = "piece-core";
  pieceBase.className = "piece-base";
  pieceBody.className = "piece-body";
  pieceTop.className = "piece-top";
  pieceDetail.className = "piece-detail";
  pieceElement.style.setProperty("--piece-height-scale", displayMetrics.heightScale.toFixed(3));
  pieceElement.style.setProperty("--piece-size-scale", displayMetrics.sizeScale.toFixed(3));
  pieceElement.style.setProperty("--piece-lift", `${displayMetrics.lift.toFixed(1)}px`);
  pieceCore.append(pieceBase, pieceBody, pieceTop, pieceDetail);
  pieceElement.append(pieceShadow, pieceCore);
  return pieceElement;
}

function getPieceKey(piece, fileIndex) {
  if (!piece) {
    return "";
  }

  return `${piece.color}:${piece.type}:${getKnightFacingClass(piece, fileIndex)}`;
}

function ensureBoardSquares() {
  if (boardSquares.size) {
    return;
  }

  const fragment = document.createDocumentFragment();

  for (let rank = 8; rank >= 1; rank -= 1) {
    for (let fileIndex = 0; fileIndex < FILES.length; fileIndex += 1) {
      const file = FILES[fileIndex];
      const squareName = `${file}${rank}`;
      const squareButton = document.createElement("button");

      squareButton.type = "button";
      squareButton.className = `square ${squareColor(fileIndex, rank)}`;
      squareButton.dataset.square = squareName;
      squareButton.dataset.pieceKey = "";
      squareButton.setAttribute("role", "gridcell");

      if (rank === 1) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord file";
        fileLabel.textContent = file;
        squareButton.append(fileLabel);
      }

      if (fileIndex === 0) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord rank";
        rankLabel.textContent = String(rank);
        squareButton.append(rankLabel);
      }

      boardSquares.set(squareName, squareButton);
      fragment.append(squareButton);
    }
  }

  boardElement.replaceChildren(fragment);
}

function renderBoard() {
  ensureBoardSquares();

  const displayGame = getDisplayedGame();
  const lastMove = getLastMove(displayGame);
  const checkSquare = findKingSquare(displayGame, displayGame.turn());
  const atLatest = !isViewingHistory();
  const isCheck = displayGame.isCheck();

  for (let rank = 8; rank >= 1; rank -= 1) {
    for (let fileIndex = 0; fileIndex < FILES.length; fileIndex += 1) {
      const file = FILES[fileIndex];
      const squareName = `${file}${rank}`;
      const piece = displayGame.get(squareName);
      const squareButton = boardSquares.get(squareName);
      const pieceKey = getPieceKey(piece, fileIndex);
      let pieceElement = squareButton.querySelector(".piece");

      squareButton.setAttribute("aria-label", describeSquare(squareName, piece));
      squareButton.className = `square ${squareColor(fileIndex, rank)}`;
      squareButton.classList.toggle(
        "selectable",
        atLatest && piece && piece.color === "w" && displayGame.turn() === "w" && !state.aiThinking,
      );
      squareButton.classList.toggle("selected", state.selectedSquare === squareName);
      squareButton.classList.toggle("legal", state.legalTargets.includes(squareName));
      /* 💡 提示只在「還站在最新局面」時畫得出來——回看歷史時盤上是舊局面,
         把當前局面算出來的建議畫上去等於指錯格子。 */
      const activeHint = getActiveHint();
      const isHintTo = Boolean(atLatest && activeHint && activeHint.to === squareName);
      squareButton.classList.toggle("hint-to", isHintTo);
      let hintBadge = squareButton.querySelector(".hint-badge");
      if (isHintTo && !hintBadge) {
        hintBadge = document.createElement("span");
        hintBadge.className = "hint-badge";
        hintBadge.textContent = "💡";
        hintBadge.setAttribute("aria-hidden", "true");
        squareButton.append(hintBadge);
      } else if (!isHintTo && hintBadge) {
        hintBadge.remove();
      }
      squareButton.classList.toggle(
        "last-move",
        Boolean(lastMove && (lastMove.from === squareName || lastMove.to === squareName)),
      );
      squareButton.classList.toggle("check", isCheck && checkSquare === squareName);

      if (!piece) {
        if (pieceElement) {
          pieceElement.remove();
        }

        squareButton.dataset.pieceKey = "";
        continue;
      }

      if (!pieceElement || squareButton.dataset.pieceKey !== pieceKey) {
        if (pieceElement) {
          pieceElement.remove();
        }

        pieceElement = createPieceElement(piece, fileIndex, rank);
        squareButton.prepend(pieceElement);
        squareButton.dataset.pieceKey = pieceKey;
      }

      pieceElement.classList.toggle("glimmer", lastMove?.to === squareName);
    }
  }
}

function buildStatusMessage(game, historyLength, displayPly) {
  if (isViewingHistory()) {
    return `目前正在回看第 ${displayPly} 手，共 ${historyLength} 手。可按「從這裡續玩」從這個局面繼續。`;
  }

  if (game.isCheckmate()) {
    return game.turn() === "w" ? "將軍！黑方獲勝。" : "將軍！白方獲勝。";
  }

  if (game.isStalemate()) {
    return "和局：僵局。";
  }

  if (game.isThreefoldRepetition()) {
    return "和局：三次重複局面。";
  }

  if (game.isInsufficientMaterial()) {
    return "和局：子力不足。";
  }

  if (game.isDraw()) {
    return "和局。";
  }

  if (state.aiThinking) {
    return `AI（${DIFFICULTY_PRESETS[state.difficulty].label}）正在思考中...`;
  }

  if (game.isCheck()) {
    return game.turn() === "w" ? "白方被將軍，請立即應對。" : "黑方被將軍，AI 正在尋找解法。";
  }

  return game.turn() === "w" ? "輪到白方，請選擇棋子後再點目的地。" : "輪到黑方，AI 即將落子。";
}

/* 📱 內建瀏覽器偵測(守門 #30):教會連結走 LINE 發,LINE 的 WebView 裝不了 APP——
   開場就講「換瀏覽器」那一條,別讓人按一顆沒反應的鈕。只提醒不擋,遊戲照玩。 */
const IN_APP_BROWSER = (() => {
  const ua = navigator.userAgent || "";
  if (/\bLine\//i.test(ua) || /\bLIFF\b/i.test(ua)) return { n: "LINE", m: "右上角「⋯」→「用其他瀏覽器開啟」" };
  if (/FBAN|FBAV|FB_IAB|FB4A/i.test(ua)) return { n: "Facebook", m: "右上角「⋯」→「在外部瀏覽器中開啟」" };
  if (/Instagram/i.test(ua)) return { n: "Instagram", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  if (/MicroMessenger/i.test(ua)) return { n: "微信", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  return null;
})();

function updateInstallState() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (IN_APP_BROWSER) {
    installButtonElement.hidden = true;
    installHintElement.textContent = `你正用 ${IN_APP_BROWSER.n} 內建瀏覽器開啟——要安裝 APP 請先點${IN_APP_BROWSER.m}。遊戲本身可以直接玩!`;
    return;
  }

  if (isStandalone) {
    installButtonElement.hidden = true;
    installHintElement.textContent = "已可當作 App 使用，之後可直接從主畫面開啟。";
    return;
  }

  if (state.deferredInstallPrompt) {
    installButtonElement.hidden = false;
    installButtonElement.textContent = "安裝 APP";
    installHintElement.textContent = "點擊「安裝 APP」即可加入主畫面。";
    return;
  }

  installButtonElement.hidden = false;
  installButtonElement.textContent = "安裝說明";

  if (isIos) {
    installHintElement.textContent = "iPhone / iPad 請用 Safari 開啟後，點分享，再選「加入主畫面」。";
    return;
  }

  if (!window.isSecureContext && !/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    installHintElement.textContent = "要安裝成 APP，需要用 HTTPS 網址開啟這個網站。";
    return;
  }

  installHintElement.textContent = "若瀏覽器尚未跳出安裝視窗，可先重新整理或用 HTTPS 網址開啟。";
}

function renderStatus() {
  const displayGame = getDisplayedGame();
  const history = getHistory();
  const displayPly = getDisplayPly();
  const lastMove = getLastMove(displayGame);
  const boardModeLabel = state.boardMode === "3d" ? "3D" : "2D";

  turnValueElement.textContent = displayGame.turn() === "w" ? "白方" : "黑方";
  modeValueElement.textContent = isViewingHistory() ? `回看 ${displayPly}/${history.length} · ${boardModeLabel}` : `即時 · ${boardModeLabel}`;
  moveCountValueElement.textContent = String(displayPly);
  lastMoveValueElement.textContent = lastMove?.san ?? "尚未開始";
  statusTextElement.textContent = state.messageOverride || buildStatusMessage(displayGame, history.length, displayPly);

  // 📅 每日殘局的常駐狀態行(題名/目標步數/已走幾步)——放獨立元素,不跟訊息搶位子
  const dailyLine = document.querySelector("#dailyLine");
  if (dailyLine) {
    dailyLine.hidden = !state.daily;
    if (state.daily) {
      const prog = dailyProgress();
      dailyLine.textContent = `📅 ${state.daily.key} 第 ${state.daily.n + 1}/${prog ? prog.total : 1} 題`
        + `(今天已解 ${prog ? prog.done : 0} 題)「${state.daily.puzzle.name}」`
        + `・目標 ${state.daily.puzzle.mateIn} 步・已走 ${whiteMoveCount()} 步`;
    }
  }

  updateInstallState();
}

function renderHistory() {
  const history = getHistory();
  const activePly = getDisplayPly();
  const fragment = document.createDocumentFragment();

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "slot-meta";
    empty.textContent = "尚未有步數。";
    historyListElement.replaceChildren(empty);
    return;
  }

  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement("div");
    const number = document.createElement("span");
    const whiteMoveButton = document.createElement("button");
    const blackMoveButton = document.createElement("button");

    row.className = "history-row";
    number.className = "history-number";
    number.textContent = `${Math.floor(index / 2) + 1}.`;

    whiteMoveButton.type = "button";
    whiteMoveButton.className = "move-button";
    whiteMoveButton.dataset.ply = String(index + 1);
    whiteMoveButton.textContent = history[index].san;

    if (activePly === index + 1) {
      whiteMoveButton.classList.add("active");
    }

    blackMoveButton.type = "button";
    blackMoveButton.className = "move-button";

    if (history[index + 1]) {
      blackMoveButton.dataset.ply = String(index + 2);
      blackMoveButton.textContent = history[index + 1].san;

      if (activePly === index + 2) {
        blackMoveButton.classList.add("active");
      }
    } else {
      blackMoveButton.disabled = true;
      blackMoveButton.textContent = " ";
    }

    row.append(number, whiteMoveButton, blackMoveButton);
    fragment.append(row);
  }

  historyListElement.replaceChildren(fragment);
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch (error) {
    return "未記錄時間";
  }
}

function createSavePayload({ useVisiblePly = true } = {}) {
  const history = getHistory();
  const visiblePly = useVisiblePly ? getDisplayPly() : history.length;
  const visibleMoves = history.slice(0, visiblePly).map((move) => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion ?? null,
  }));

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    difficulty: state.difficulty,
    boardMode: state.boardMode,
    cameraRotation: normalizeRotation(state.cameraRotation),
    cameraTilt: clamp(state.cameraTilt, 20, 76),
    moveCount: visibleMoves.length,
    moves: visibleMoves,
  };
}

function saveAuto() {
  /* 📅 每日殘局不進自動存檔:存檔格式是「從標準開局重播棋譜」,
     殘局是自訂 FEN 起手 ⇒ 重播會重建出完全不同的局面(靜默壞檔)。 */
  if (state.daily) return;
  try {
    localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify(createSavePayload({ useVisiblePly: false })));
  } catch (error) {
    console.error("Failed to save auto state", error);
  }
}

function loadSlot(slotId) {
  try {
    const raw = localStorage.getItem(`${SLOT_PREFIX}${slotId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("Failed to parse slot", error);
    return null;
  }
}

function renderSaveSlots() {
  const fragment = document.createDocumentFragment();

  for (const slotId of SAVE_SLOT_IDS) {
    const slotData = loadSlot(slotId);
    const slotElement = document.createElement("article");
    const header = document.createElement("div");
    const titleWrap = document.createElement("div");
    const title = document.createElement("h3");
    const time = document.createElement("time");
    const meta = document.createElement("p");
    const actions = document.createElement("div");
    const saveButton = document.createElement("button");
    const loadButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    slotElement.className = "save-slot";
    header.className = "save-slot-header";
    title.textContent = `存檔 ${slotId}`;

    if (slotData) {
      time.textContent = formatDate(slotData.savedAt);
      meta.className = "slot-meta";
      meta.textContent = `${slotData.moveCount} 手 | AI ${DIFFICULTY_PRESETS[slotData.difficulty]?.label ?? "標準"}`;
    } else {
      time.textContent = "尚未存檔";
      meta.className = "slot-meta";
      meta.textContent = "可存下目前局面，稍後再繼續。";
    }

    actions.className = "slot-actions";

    saveButton.type = "button";
    saveButton.dataset.action = "save";
    saveButton.dataset.slot = String(slotId);
    saveButton.textContent = "存檔";

    loadButton.type = "button";
    loadButton.dataset.action = "load";
    loadButton.dataset.slot = String(slotId);
    loadButton.textContent = "讀取";
    loadButton.disabled = !slotData;

    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.slot = String(slotId);
    deleteButton.className = "delete-button";
    deleteButton.textContent = "清除";
    deleteButton.disabled = !slotData;

    titleWrap.append(title, time);
    header.append(titleWrap);
    actions.append(saveButton, loadButton, deleteButton);
    slotElement.append(header, meta, actions);
    fragment.append(slotElement);
  }

  saveSlotsElement.replaceChildren(fragment);
}

function renderControls() {
  const historyLength = getHistory().length;
  const displayPly = getDisplayPly();
  const viewingHistory = isViewingHistory();

  difficultySelectElement.value = state.difficulty;
  syncViewControls();
  undoButtonElement.disabled = historyLength === 0;
  prevMoveButtonElement.disabled = historyLength === 0 || displayPly === 0;
  nextMoveButtonElement.disabled = historyLength === 0 || displayPly === historyLength;
  latestMoveButtonElement.disabled = historyLength === 0 || !viewingHistory;
  continueFromHereButtonElement.disabled = !viewingHistory;
  jumpStartButtonElement.disabled = historyLength === 0;
}

function render() {
  // 📡 完賽 beacon:對局分出結果(將殺 / 和局)= 一次 -done。用 game 物件身分去重:同一局 render 再多次只發一次;新局(new Chess())自然重置。
  if (state.game.isGameOver() && state.psDoneFor !== state.game) {
    state.psDoneFor = state.game;
    try { if (window.psDone) window.psDone(); } catch (e) { /* 統計是配菜 */ }
  }
  renderBoard();
  applyBoardView();
  renderStatus();
  renderHistory();
  renderControls();
}

function handleSquareClick(squareName) {
  if (state.suppressSquareClick) {
    state.suppressSquareClick = false;
    return;
  }

  if (state.aiThinking) {
    setMessage("AI 思考中，請稍候。");
    render();
    return;
  }

  if (isViewingHistory()) {
    setMessage("目前在回看步數，先按「回到最新」或「從這裡續玩」。");
    render();
    return;
  }

  if (state.game.turn() !== "w" || state.game.isGameOver()) {
    render();
    return;
  }

  const clickedPiece = state.game.get(squareName);

  if (state.selectedSquare === squareName) {
    clearSelection();
    render();
    return;
  }

  if (state.selectedSquare && state.legalTargets.includes(squareName)) {
    const move = state.game.move({
      from: state.selectedSquare,
      to: squareName,
      promotion: "q",
    });

    clearSelection();

    if (!move) {
      setMessage("這步不合法，請重新選擇。");
      render();
      return;
    }

    state.displayPly = null;
    saveAuto();
    render();
    evaluateDaily();     // 📅 白方這一步若將死=記今天的成績
    maybeRunAiMove();
    return;
  }

  if (clickedPiece?.color === "w") {
    const moves = state.game.moves({ square: squareName, verbose: true });
    state.selectedSquare = squareName;
    state.legalTargets = moves.map((move) => move.to);
    render();
    return;
  }

  clearSelection();
  render();
}

function maybeRunAiMove() {
  if (state.aiThinking || state.game.turn() !== "b" || state.game.isGameOver() || isViewingHistory()) {
    render();
    return;
  }

  cancelAiThink();
  state.aiThinking = true;
  render();

  state.aiTimerId = window.setTimeout(() => {
    const preset = DIFFICULTY_PRESETS[state.difficulty];
    const bestMove = getBestMove(state.game, preset);

    if (bestMove) {
      state.game.move({
        from: bestMove.from,
        to: bestMove.to,
        promotion: bestMove.promotion ?? "q",
      });
    }

    state.aiTimerId = 0;
    state.aiThinking = false;
    state.displayPly = null;
    saveAuto();
    render();
  }, DIFFICULTY_PRESETS[state.difficulty].thinkTime);
}

function undoRound() {
  cancelAiThink();
  clearSelection();
  state.displayPly = null;
  state.dailySaved = false;   // 📅 悔棋後重新將死可再記(取當日最少,不會灌水)

  const steps = state.game.turn() === "w" ? 2 : 1;

  for (let index = 0; index < steps; index += 1) {
    if (!state.game.history().length) {
      break;
    }

    state.game.undo();
  }

  saveAuto();
  render();
}

function goToPly(ply) {
  clearSelection();

  const historyLength = getHistory().length;
  const bounded = Math.max(0, Math.min(ply, historyLength));
  state.displayPly = bounded === historyLength ? null : bounded;

  render();
}

function continueFromViewedPosition() {
  if (!isViewingHistory()) {
    return;
  }

  cancelAiThink();
  state.game = getDisplayedGame();
  state.displayPly = null;
  clearSelection();
  saveAuto();
  render();
  maybeRunAiMove();
}

function restoreFromPayload(payload) {
  if (!payload?.moves || !Array.isArray(payload.moves)) {
    return;
  }

  cancelAiThink();
  state.game = buildGameFromMoves(payload.moves);
  state.difficulty = DIFFICULTY_PRESETS[payload.difficulty] ? payload.difficulty : "medium";
  state.displayPly = null;
  state.boardMode = payload.boardMode === "2d" ? "2d" : DEFAULT_BOARD_MODE;
  state.cameraRotation = Number.isFinite(payload.cameraRotation) ? normalizeRotation(payload.cameraRotation) : DEFAULT_CAMERA_ROTATION;
  state.cameraTilt = Number.isFinite(payload.cameraTilt) ? clamp(payload.cameraTilt, 20, 76) : DEFAULT_CAMERA_TILT;
  clearSelection();
}

function loadAuto() {
  try {
    const raw = localStorage.getItem(AUTO_SAVE_KEY);

    if (!raw) {
      return false;
    }

    restoreFromPayload(JSON.parse(raw));
    return true;
  } catch (error) {
    console.error("Failed to load auto save", error);
    return false;
  }
}

function saveSlot(slotId) {
  if (state.daily) {   // 📅 理由同 saveAuto:棋譜重播式存檔吃不下自訂 FEN 起手
    setMessage("每日殘局不用存檔——明天自動換新題,今天的最佳步數已另外記著!");
    return;
  }
  try {
    localStorage.setItem(`${SLOT_PREFIX}${slotId}`, JSON.stringify(createSavePayload()));
    setMessage(`已存到存檔 ${slotId}。`);
  } catch (error) {
    console.error("Failed to save slot", error);
    setMessage("存檔失敗，請稍後再試。");
  }

  renderSaveSlots();
  render();
}

function loadSlotIntoGame(slotId) {
  const payload = loadSlot(slotId);

  if (!payload) {
    setMessage("這個存檔目前是空的。");
    render();
    return;
  }

  restoreFromPayload(payload);
  saveAuto();
  setMessage(`已讀取存檔 ${slotId}。`);
  render();
  maybeRunAiMove();
}

function deleteSlot(slotId) {
  localStorage.removeItem(`${SLOT_PREFIX}${slotId}`);
  setMessage(`已清除存檔 ${slotId}。`);
  renderSaveSlots();
  render();
}

async function handleInstallClick() {
  if (!state.deferredInstallPrompt) {
    updateInstallState();
    return;
  }

  state.deferredInstallPrompt.prompt();
  const choice = await state.deferredInstallPrompt.userChoice;

  if (choice.outcome === "accepted") {
    installHintElement.textContent = "安裝程序已開始，完成後就能像 APP 一樣使用。";
  } else {
    installHintElement.textContent = "你可以稍後再按一次安裝。";
  }

  state.deferredInstallPrompt = null;
  render();
}

function startNewGame() {
  cancelAiThink();
  state.game = new Chess();
  state.daily = null;        // 離開每日模式,回一般對局
  state.dailySaved = false;
  state.displayPly = null;
  clearSelection();
  saveAuto();
  render();
}

/* ══ 📅 每日殘局(N 步殺)══
   每天一題、全世界同一題;題目的 mateIn 不是宣稱,是 test/daily.mjs 的窮舉證明。
   黑方=站上原本的 AI(任何難度都行:必殺樹涵蓋**所有**防守,照解法走一定 ≤N 步殺)。 */
/* ══ 戰績:{ "YYYY-MM-DD": { solved: { 題目id: 那題最少步數 } } } ══
   一天一組多題 ⇒ **每題分開記**(才知道今天解了幾題、哪題還沒解)。
   ⚠ 舊格式(單題版是 `日期: 步數`)讀進來沒有 solved ⇒ 視為未解、可重解;
     不炸、不誤報(這是刻意的寬鬆遷移:舊資料只有「今天」那一天,隔天自然消失)。 */
const DAILY_STORE_KEY = "3d-chess-co:daily:v1";
function loadDailyBook() {
  try { const s = JSON.parse(localStorage.getItem(DAILY_STORE_KEY) || "{}"); return s && typeof s === "object" ? s : {}; }
  catch { return {}; }
}
function dayRecord(book, key) {
  const d = book[key];
  return (d && typeof d === "object" && d.solved) ? d : { solved: {} };
}
function saveDailyResult(key, puzzleId, moves) {
  const all = loadDailyBook();
  const day = dayRecord(all, key);
  const prev = day.solved[puzzleId] | 0;
  const isNewBest = !prev || moves < prev;
  if (isNewBest) day.solved[puzzleId] = moves;
  all[key] = day;
  const days = Object.keys(all).sort();
  while (days.length > 60) delete all[days.shift()];   // 只留 60 天
  try { localStorage.setItem(DAILY_STORE_KEY, JSON.stringify(all)); } catch { /* 私密模式照玩 */ }
  return { best: day.solved[puzzleId], isNewBest, solvedCount: Object.keys(day.solved).length };
}
function whiteMoveCount() {
  return Math.ceil(state.game.history().length / 2);   // 悔棋/續玩都自動算對(從棋譜推,不另計數)
}
/** 今天這一組的進度 */
function dailyProgress() {
  if (!state.daily) return null;
  const solved = dayRecord(loadDailyBook(), state.daily.key).solved;
  const done = state.daily.set.puzzles.filter((p) => solved[p.id]).length;
  return { done, total: state.daily.set.puzzles.length, solved };
}
/** 還沒解、且不是現在這一題的下一題索引(-1=沒有了) */
function nextUnsolvedIndex() {
  const prog = dailyProgress();
  if (!prog) return -1;
  for (let i = 0; i < state.daily.set.puzzles.length; i += 1) {
    if (!prog.solved[state.daily.set.puzzles[i].id] && i !== state.daily.n) return i;
  }
  return -1;
}
/** 開今天那一組的第 n 題(不給=今天還沒解的第一題) */
function startDailyGame(n) {
  cancelAiThink();
  const key = dailyPuzzleKey();
  const set = puzzlesForDate(key);
  const solved = dayRecord(loadDailyBook(), key).solved;
  const idx = Number.isInteger(n)
    ? Math.max(0, Math.min(n, set.puzzles.length - 1))
    : Math.max(0, set.puzzles.findIndex((p) => !solved[p.id]));   // -1(全解完)→ 0,可重玩
  const puzzle = set.puzzles[idx];
  state.daily = { key, set, n: idx, puzzle };
  state.dailySaved = false;
  state.game = new Chess(puzzle.fen);
  state.displayPly = null;
  clearSelection();
  const prog = dailyProgress();
  const best = prog.solved[puzzle.id] | 0;
  setMessage(`📅 ${key} 第 ${idx + 1}/${set.puzzles.length} 題(今天已解 ${prog.done} 題)`
    + `「${puzzle.name}」目標 ${puzzle.mateIn} 步——${puzzle.hint}`
    + (best ? `(這題你的最佳:${best} 步)` : ""), 8000);
  render();
}
/** 白方將死黑王的那一刻:記成績+講話(只在每日模式) */
function evaluateDaily() {
  if (!state.daily || state.dailySaved) return;
  if (state.game.isCheckmate() && state.game.turn() === "b") {
    state.dailySaved = true;
    const moves = whiteMoveCount();
    const { puzzle, set, key, n } = state.daily;
    const r = saveDailyResult(key, puzzle.id, moves);
    const total = set.puzzles.length;
    setMessage(`📅 第 ${n + 1} 題將死!${moves} 步`
      + (moves <= puzzle.mateIn ? "(滿分!)" : `(目標 ${puzzle.mateIn} 步)`)
      + (r.isNewBest ? " 新紀錄!" : "")
      + `・今天已解 ${r.solvedCount}/${total} 題`
      + (r.solvedCount >= total ? " —— 今天全解完了,明天有新的一組!" : "(按「📅 每日殘局」接下一題)"), 15000);
    render();
  }
}

function rotateBoardBy(delta) {
  updateBoardView({
    cameraRotation: state.cameraRotation + delta,
    persist: true,
  });
  renderStatus();
}

function resetBoardView() {
  updateBoardView({
    boardMode: state.boardMode,
    cameraRotation: DEFAULT_CAMERA_ROTATION,
    cameraTilt: DEFAULT_CAMERA_TILT,
    persist: true,
  });
  renderStatus();
}

function handleBoardPointerDown(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  state.dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startRotation: state.cameraRotation,
    startTilt: state.cameraTilt,
    moved: false,
  };

  state.suppressSquareClick = false;

  try {
    boardSceneElement.setPointerCapture?.(event.pointerId);
  } catch (error) {
    console.error("Failed to capture pointer", error);
  }

  applyBoardView();
}

function handleBoardPointerMove(event) {
  if (!state.dragState || state.dragState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - state.dragState.startX;
  const deltaY = event.clientY - state.dragState.startY;

  if (Math.abs(deltaX) + Math.abs(deltaY) > 6) {
    state.dragState.moved = true;
    state.suppressSquareClick = true;
  }

  updateBoardView({
    cameraRotation: state.dragState.startRotation + deltaX * 0.65,
    cameraTilt: state.boardMode === "3d"
      ? state.dragState.startTilt - deltaY * 0.18
      : state.cameraTilt,
  });
}

function finishBoardDrag(event) {
  if (!state.dragState || state.dragState.pointerId !== event.pointerId) {
    return;
  }

  const moved = state.dragState.moved;

  try {
    boardSceneElement.releasePointerCapture?.(event.pointerId);
  } catch (error) {
    console.error("Failed to release pointer capture", error);
  }

  state.dragState = null;
  applyBoardView();

  if (moved) {
    saveAuto();
    renderStatus();
    window.setTimeout(() => {
      state.suppressSquareClick = false;
    }, 0);
    return;
  }

  if (event.type === "pointercancel") {
    state.suppressSquareClick = false;
    return;
  }

  const squareElement = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-square]");

  if (squareElement) {
    handleSquareClick(squareElement.dataset.square);
  }
}

function registerEvents() {
  boardElement.addEventListener("click", (event) => {
    if (event.detail !== 0) {
      return;
    }

    const target = event.target.closest("[data-square]");

    if (!target) {
      return;
    }

    handleSquareClick(target.dataset.square);
  });

  historyListElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ply]");

    if (!button) {
      return;
    }

    goToPly(Number(button.dataset.ply));
  });

  saveSlotsElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");

    if (!button) {
      return;
    }

    const slotId = Number(button.dataset.slot);
    const action = button.dataset.action;

    if (action === "save") {
      saveSlot(slotId);
      return;
    }

    if (action === "load") {
      loadSlotIntoGame(slotId);
      return;
    }

    if (action === "delete") {
      deleteSlot(slotId);
    }
  });

  installButtonElement.addEventListener("click", handleInstallClick);
  newGameButtonElement.addEventListener("click", startNewGame);
  /* ★ 包一層:直接掛 startDailyGame 會把 click event 當成 n 參數傳進去
     (Number.isInteger(event) 是 false 所以剛好沒壞——但那是巧合,不留這種接線)。 */
  document.querySelector("#dailyButton")?.addEventListener("click", () => startDailyGame());
  undoButtonElement.addEventListener("click", undoRound);
  hintButtonElement.addEventListener("click", showHint);
  prevMoveButtonElement.addEventListener("click", () => goToPly(getDisplayPly() - 1));
  nextMoveButtonElement.addEventListener("click", () => goToPly(getDisplayPly() + 1));
  latestMoveButtonElement.addEventListener("click", () => goToPly(getHistory().length));
  continueFromHereButtonElement.addEventListener("click", continueFromViewedPosition);
  jumpStartButtonElement.addEventListener("click", () => goToPly(0));

  difficultySelectElement.addEventListener("change", () => {
    state.difficulty = difficultySelectElement.value;
    cancelAiThink();
    saveAuto();
    render();
    maybeRunAiMove();
  });

  displayModeSelectElement.addEventListener("change", () => {
    updateBoardView({
      boardMode: displayModeSelectElement.value,
      persist: true,
    });
    renderStatus();
  });

  rotateLeftButtonElement.addEventListener("click", () => rotateBoardBy(-45));
  rotateResetButtonElement.addEventListener("click", resetBoardView);
  rotateRightButtonElement.addEventListener("click", () => rotateBoardBy(45));

  rotationRangeElement.addEventListener("input", () => {
    updateBoardView({
      cameraRotation: Number(rotationRangeElement.value),
    });
    renderStatus();
  });

  rotationRangeElement.addEventListener("change", () => {
    updateBoardView({
      cameraRotation: Number(rotationRangeElement.value),
      persist: true,
    });
    renderStatus();
  });

  tiltRangeElement.addEventListener("input", () => {
    updateBoardView({
      cameraTilt: Number(tiltRangeElement.value),
    });
    renderStatus();
  });

  tiltRangeElement.addEventListener("change", () => {
    updateBoardView({
      cameraTilt: Number(tiltRangeElement.value),
      persist: true,
    });
    renderStatus();
  });

  boardSceneElement.addEventListener("pointerdown", handleBoardPointerDown);
  boardSceneElement.addEventListener("pointermove", handleBoardPointerMove);
  boardSceneElement.addEventListener("pointerup", finishBoardDrag);
  boardSceneElement.addEventListener("pointercancel", finishBoardDrag);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    render();
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    render();
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.error("Failed to register service worker", error);
    });
  });
}

function boot() {
  loadAuto();
  registerEvents();
  registerServiceWorker();
  renderSaveSlots();
  render();
  maybeRunAiMove();
}

boot();

// 測試掛勾(驗收腳本用;艦隊慣例)——真人操作不經過它
window.__chess = { state, startDailyGame, whiteMoveCount, handleSquareClick };
