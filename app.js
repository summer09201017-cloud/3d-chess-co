import { Chess } from "./vendor/chess.js";
import { DIFFICULTY_PRESETS, getBestMove } from "./ai.js";

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

function describeSquare(squareName, piece) {
  if (!piece) {
    return `${squareName} 空格`;
  }

  const color = piece.color === "w" ? "白" : "黑";
  const pieceName = {
    p: "兵",
    n: "馬",
    b: "象",
    r: "車",
    q: "后",
    k: "王",
  }[piece.type];

  return `${squareName}，${color}${pieceName}`;
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

function updateInstallState() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

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
  state.displayPly = null;
  clearSelection();
  saveAuto();
  render();
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
  undoButtonElement.addEventListener("click", undoRound);
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
