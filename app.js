import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js";

const STOCKFISH_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js";
const ELO_OPTIONS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
const BOT_MOVE_TIMEOUT = 6500;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_IMAGES = {
  wp: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_plt45.svg",
  wn: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_nlt45.svg",
  wb: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_blt45.svg",
  wr: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_rlt45.svg",
  wq: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_qlt45.svg",
  wk: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_klt45.svg",
  bp: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_pdt45.svg",
  bn: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_ndt45.svg",
  bb: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_bdt45.svg",
  br: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_rdt45.svg",
  bq: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_qdt45.svg",
  bk: "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_kdt45.svg",
};

const boardEl = document.querySelector("#board");
const modeSelect = document.querySelector("#modeSelect");
const playerColorSelect = document.querySelector("#playerColor");
const stockfishEloSelect = document.querySelector("#stockfishElo");
const whiteBotEloSelect = document.querySelector("#whiteBotElo");
const blackBotEloSelect = document.querySelector("#blackBotElo");
const speedRange = document.querySelector("#speedRange");
const speedValue = document.querySelector("#speedValue");
const humanControls = document.querySelector("#humanControls");
const botControls = document.querySelector("#botControls");
const newGameBtn = document.querySelector("#newGameBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const copyFenBtn = document.querySelector("#copyFenBtn");
const moveList = document.querySelector("#moveList");
const statusTitle = document.querySelector("#statusTitle");
const statusText = document.querySelector("#statusText");
const engineDot = document.querySelector("#engineDot");
const turnPill = document.querySelector("#turnPill");
const rankLabels = document.querySelector(".rank-labels");
const fileLabels = document.querySelector(".file-labels");
const evalFill = document.querySelector("#evalFill");
const evalBarLabel = document.querySelector("#evalBarLabel");
const evalBadge = document.querySelector("#evalBadge");
const evalText = document.querySelector("#evalText");

let game = new Chess();
let selectedSquare = null;
let legalTargets = [];
let lastMove = null;
let paused = false;
let thinking = false;
let moveTimer = 0;
let currentRequest = 0;
let evalRequest = 0;
let evalTimer = 0;
let evaluationRunning = false;
let pendingEvaluationFinal = false;
let engineWhite = null;
let engineBlack = null;
let engineEval = null;
let audioContext = null;

function fillElo(select, value) {
  select.replaceChildren(
    ...ELO_OPTIONS.map((elo) => {
      const option = document.createElement("option");
      option.value = String(elo);
      option.textContent = String(elo);
      option.selected = elo === value;
      return option;
    }),
  );
}

fillElo(stockfishEloSelect, 1600);
fillElo(whiteBotEloSelect, 1400);
fillElo(blackBotEloSelect, 1800);

class StockfishEngine {
  constructor(label) {
    this.label = label;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.lastScore = null;
    this.boot();
  }

  boot() {
    const workerCode = `importScripts(${JSON.stringify(STOCKFISH_URL)});`;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);

    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker.addEventListener("message", (event) => this.handleLine(String(event.data)));
    this.worker.addEventListener("error", () => {
      setEngineStatus("error", "Engine fout", "Stockfish kon niet geladen worden via de gratis CDN.");
    });
    this.send("uci");
  }

  send(command) {
    if (this.worker) {
      this.worker.postMessage(command);
    }
  }

  handleLine(line) {
    if (line === "uciok") {
      this.ready = true;
      if (this.label !== "Analyse") {
        setEngineStatus("ready", "Stockfish klaar", "Kies een modus en start een partij.");
      }
      if (this.label === "Analyse") {
        scheduleEvaluation(false);
      }
      this.send("isready");
      return;
    }

    if (this.pending?.type === "eval" && line.startsWith("info ")) {
      const score = parseEngineScore(line);
      if (score) {
        this.lastScore = score;
        this.pending.score = score;
      }
    }

    if (!this.pending || !line.startsWith("bestmove")) {
      return;
    }

    if (this.pending.type === "bestmove") {
      const move = line.split(" ")[1];
      const resolve = this.pending.resolve;
      this.pending = null;
      resolve(move);
      return;
    }

    if (this.pending.type === "eval") {
      const pending = this.pending;
      this.pending = null;
      pending.resolve(toWhiteEvaluation(pending.score || this.lastScore, pending.turn));
    }
  }

  bestMove(fen, elo) {
    return new Promise((resolve, reject) => {
      if (!this.ready) {
        reject(new Error("Stockfish is nog niet klaar."));
        return;
      }

      const limitedElo = Math.min(2850, Math.max(1350, elo));
      const skillLevel = Math.round(((elo - 800) / 2200) * 20);
      this.pending = { type: "bestmove", resolve, reject };
      this.send("ucinewgame");
      this.send("setoption name UCI_LimitStrength value true");
      this.send(`setoption name UCI_Elo value ${limitedElo}`);
      this.send(`setoption name Skill Level value ${Math.min(20, Math.max(0, skillLevel))}`);
      this.send(`position fen ${fen}`);
      this.send("go movetime 450");
    });
  }

  evaluate(fen, turn) {
    return new Promise((resolve, reject) => {
      if (!this.ready) {
        reject(new Error("Stockfish analyse is nog niet klaar."));
        return;
      }

      this.pending = { type: "eval", resolve, reject, turn, score: null };
      this.send("ucinewgame");
      this.send("setoption name UCI_LimitStrength value false");
      this.send(`position fen ${fen}`);
      this.send("go depth 12");
    });
  }

  stop() {
    this.send("stop");
  }

  cancel() {
    this.pending = null;
    this.stop();
  }
}

function setEngineStatus(kind, title, text) {
  engineDot.classList.toggle("ready", kind === "ready");
  engineDot.classList.toggle("error", kind === "error");
  statusTitle.textContent = title;
  statusText.textContent = text;
}

function ensureEngines() {
  if (!engineBlack) {
    engineBlack = new StockfishEngine("Zwart");
  }
  if (!engineWhite) {
    engineWhite = new StockfishEngine("Wit");
  }
  if (!engineEval) {
    engineEval = new StockfishEngine("Analyse");
  }
}

function parseEngineScore(line) {
  const match = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!match) {
    return null;
  }
  return {
    type: match[1],
    value: Number(match[2]),
  };
}

function toWhiteEvaluation(score, turn) {
  if (!score) {
    return { type: "cp", value: 0 };
  }
  const multiplier = turn === "w" ? 1 : -1;
  return {
    type: score.type,
    value: score.value * multiplier,
  };
}

function squareName(row, col) {
  return `${FILES[col]}${8 - row}`;
}

function boardRows() {
  const playerColor = playerColorSelect.value;
  const rows = [...Array(8).keys()];
  const cols = [...Array(8).keys()];
  return playerColor === "b" && modeSelect.value === "human"
    ? { rows: rows.reverse(), cols: cols.reverse() }
    : { rows, cols };
}

function drawLabels(rows, cols) {
  rankLabels.replaceChildren(...rows.map((row) => {
    const label = document.createElement("span");
    label.textContent = String(8 - row);
    return label;
  }));

  fileLabels.replaceChildren(...cols.map((col) => {
    const label = document.createElement("span");
    label.textContent = FILES[col];
    return label;
  }));
}

function drawBoard() {
  const { rows, cols } = boardRows();
  boardEl.replaceChildren();
  drawLabels(rows, cols);

  rows.forEach((row) => {
    cols.forEach((col) => {
      const name = squareName(row, col);
      const piece = game.get(name);
      const square = document.createElement("button");
      square.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
      square.dataset.square = name;
      square.setAttribute("type", "button");
      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", name);

      if (selectedSquare === name) {
        square.classList.add("selected");
      }
      if (legalTargets.includes(name)) {
        square.classList.add("legal");
      }
      if (lastMove && (lastMove.from === name || lastMove.to === name)) {
        square.classList.add("last-move");
      }
      if (piece) {
        const pieceEl = document.createElement("img");
        pieceEl.className = `piece ${piece.color === "w" ? "white" : "black"}`;
        pieceEl.src = PIECE_IMAGES[`${piece.color}${piece.type}`];
        pieceEl.alt = "";
        pieceEl.draggable = false;
        square.append(pieceEl);
      }

      boardEl.append(square);
    });
  });

  updateGameText();
  drawMoves();
}

function updateGameText() {
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Zwart" : "Wit";
    turnPill.textContent = `${winner} wint`;
    statusTitle.textContent = "Schaakmat";
    statusText.textContent = `${winner} heeft de partij gewonnen.`;
    return;
  }

  if (game.isDraw()) {
    turnPill.textContent = "Remise";
    statusTitle.textContent = "Partij klaar";
    statusText.textContent = "De partij is remise.";
    return;
  }

  const side = game.turn() === "w" ? "Wit" : "Zwart";
  turnPill.textContent = `${side} aan zet${game.isCheck() ? " - schaak" : ""}`;

  if (thinking) {
    return;
  }

  if (paused) {
    statusTitle.textContent = "Gepauzeerd";
    statusText.textContent = "De partij staat stil tot je verder speelt.";
    return;
  }

  if (modeSelect.value === "human") {
    const humanTurn = game.turn() === playerColorSelect.value;
    statusTitle.textContent = humanTurn ? "Jouw zet" : "Stockfish aan zet";
    statusText.textContent = humanTurn
      ? "Klik een stuk en daarna een gemarkeerd veld."
      : `Stockfish speelt op Elo ${stockfishEloSelect.value}.`;
    return;
  }

  statusTitle.textContent = "Botpartij actief";
  statusText.textContent = `${side} speelt op Elo ${getTurnElo()}.`;
}

function drawMoves() {
  const history = game.history();
  moveList.replaceChildren();
  for (let index = 0; index < history.length; index += 2) {
    const item = document.createElement("li");
    item.textContent = history[index + 1] ? `${history[index]}  ${history[index + 1]}` : history[index];
    moveList.append(item);
  }
  moveList.scrollTop = moveList.scrollHeight;
}

function canHumanMove() {
  if (paused || modeSelect.value !== "human") {
    return false;
  }
  if (game.turn() !== playerColorSelect.value) {
    return false;
  }
  if (thinking) {
    currentRequest += 1;
    thinking = false;
    engineWhite?.cancel();
    engineBlack?.cancel();
  }
  return true;
}

function handleSquareClick(square) {
  if (!canHumanMove()) {
    return;
  }

  const piece = game.get(square);
  if (!selectedSquare) {
    selectSquare(square, piece);
    return;
  }

  if (square === selectedSquare) {
    clearSelection();
    drawBoard();
    return;
  }

  if (piece && piece.color === game.turn()) {
    selectSquare(square, piece);
    return;
  }

  const move = game.move({ from: selectedSquare, to: square, promotion: "q" });
  if (move) {
    lastMove = { from: move.from, to: move.to };
    playMoveSound();
    scheduleEvaluation(game.isGameOver());
    clearSelection();
    drawBoard();
    queueBotMove();
    return;
  }

  selectSquare(square, piece);
}

function selectSquare(square, piece) {
  if (!piece || piece.color !== game.turn()) {
    clearSelection();
    return;
  }
  selectedSquare = square;
  legalTargets = game.moves({ square, verbose: true }).map((move) => move.to);
  drawBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function isBotTurn() {
  if (game.isGameOver() || paused) {
    return false;
  }

  if (modeSelect.value === "bots") {
    return true;
  }

  return game.turn() !== playerColorSelect.value;
}

function getTurnElo() {
  if (modeSelect.value === "bots") {
    return Number(game.turn() === "w" ? whiteBotEloSelect.value : blackBotEloSelect.value);
  }
  return Number(stockfishEloSelect.value);
}

function getTurnEngine() {
  return game.turn() === "w" ? engineWhite : engineBlack;
}

function moveWithTimeout(engine, fen, elo) {
  return Promise.race([
    engine.bestMove(fen, elo),
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Stockfish duurde te lang.")), BOT_MOVE_TIMEOUT);
    }),
  ]);
}

function fallbackMove() {
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) {
    return null;
  }
  return moves[Math.floor(Math.random() * moves.length)];
}

function applyBotMove(moveInput) {
  if (!moveInput) {
    return null;
  }

  const move = game.move(moveInput, { sloppy: true });
  if (!move) {
    const fallback = fallbackMove();
    if (!fallback) {
      return null;
    }
    const fallbackMoveResult = game.move({ from: fallback.from, to: fallback.to, promotion: "q" });
    if (fallbackMoveResult) {
      lastMove = { from: fallbackMoveResult.from, to: fallbackMoveResult.to };
      playMoveSound();
      scheduleEvaluation(game.isGameOver());
    }
    return fallbackMoveResult;
  }
  lastMove = { from: move.from, to: move.to };
  playMoveSound();
  scheduleEvaluation(game.isGameOver());
  return move;
}

function queueBotMove() {
  window.clearTimeout(moveTimer);
  if (!isBotTurn()) {
    thinking = false;
    drawBoard();
    return;
  }

  const delay = Number(speedRange.value);
  moveTimer = window.setTimeout(playBotMove, delay);
}

async function playBotMove() {
  if (!isBotTurn() || thinking) {
    return;
  }

  thinking = true;
  drawBoard();
  const requestId = ++currentRequest;
  const side = game.turn() === "w" ? "Wit" : "Zwart";
  setEngineStatus("ready", `${side} denkt`, `Stockfish zoekt op Elo ${getTurnElo()}.`);

  try {
    const engine = getTurnEngine();
    const bestMove = await moveWithTimeout(engine, game.fen(), getTurnElo());
    if (requestId !== currentRequest || paused || game.isGameOver()) {
      thinking = false;
      return;
    }
    applyBotMove(bestMove);
  } catch (error) {
    getTurnEngine()?.cancel();
    if (!game.isGameOver() && requestId === currentRequest) {
      applyBotMove(fallbackMove());
      setEngineStatus("ready", "Fallback zet", `${error.message} Er is een geldige noodzet gespeeld.`);
    }
  } finally {
    thinking = false;
    clearSelection();
    drawBoard();
    queueBotMove();
  }
}

function startNewGame() {
  window.clearTimeout(moveTimer);
  currentRequest += 1;
  engineWhite?.stop();
  engineBlack?.stop();
  paused = false;
  thinking = false;
  game = new Chess();
  selectedSquare = null;
  legalTargets = [];
  lastMove = null;
  pauseBtn.textContent = "Pauze";
  setEvaluation({ type: "cp", value: 0 }, false);
  scheduleEvaluation(false);
  drawBoard();
  queueBotMove();
}

function syncModeControls() {
  const botMode = modeSelect.value === "bots";
  botControls.classList.toggle("hidden", !botMode);
  humanControls.classList.toggle("hidden", botMode);
  startNewGame();
}

function updateSpeedLabel() {
  speedValue.textContent = `${(Number(speedRange.value) / 1000).toFixed(1)} s`;
}

function formatEvaluation(evaluation) {
  if (evaluation.type === "mate") {
    const prefix = evaluation.value > 0 ? "+" : "-";
    return `${prefix}M${Math.abs(evaluation.value)}`;
  }

  const pawns = evaluation.value / 100;
  if (Math.abs(pawns) < 0.05) {
    return "0.0";
  }
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

function evaluationPercent(evaluation) {
  if (evaluation.type === "mate") {
    return evaluation.value > 0 ? 98 : 2;
  }

  const pawns = evaluation.value / 100;
  return Math.min(98, Math.max(2, 50 + Math.tanh(pawns / 4) * 48));
}

function describeEvaluation(evaluation, final) {
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "Zwart" : "Wit";
    return `Eindevaluatie: schaakmat, ${winner} wint.`;
  }

  if (game.isDraw()) {
    return "Eindevaluatie: remise.";
  }

  if (evaluation.type === "mate") {
    const side = evaluation.value > 0 ? "Wit" : "Zwart";
    const prefix = final ? "Eindevaluatie" : "Evaluatie";
    return `${prefix}: ${side} heeft mat in ${Math.abs(evaluation.value)}.`;
  }

  const pawns = evaluation.value / 100;
  const prefix = final ? "Eindevaluatie" : "Huidige stand";
  if (Math.abs(pawns) < 0.25) {
    return `${prefix}: ongeveer gelijk.`;
  }
  const side = pawns > 0 ? "Wit" : "Zwart";
  const strength = Math.abs(pawns) >= 2 ? "duidelijk beter" : "iets beter";
  return `${prefix}: ${side} staat ${strength}.`;
}

function setEvaluation(evaluation, final) {
  const label = formatEvaluation(evaluation);
  evalFill.style.height = `${evaluationPercent(evaluation)}%`;
  evalBarLabel.textContent = label;
  evalBadge.textContent = label;
  evalText.textContent = describeEvaluation(evaluation, final);
}

function scheduleEvaluation(final) {
  pendingEvaluationFinal = pendingEvaluationFinal || final;
  window.clearTimeout(evalTimer);
  evalTimer = window.setTimeout(() => evaluatePosition(final), 180);
}

async function evaluatePosition(final) {
  if (evaluationRunning) {
    pendingEvaluationFinal = pendingEvaluationFinal || final;
    return;
  }

  const requestId = ++evalRequest;

  if (game.isCheckmate()) {
    const winnerValue = game.turn() === "w" ? -1 : 1;
    setEvaluation({ type: "mate", value: winnerValue }, true);
    return;
  }

  if (game.isDraw()) {
    setEvaluation({ type: "cp", value: 0 }, true);
    return;
  }

  if (!engineEval?.ready) {
    evalText.textContent = "Stockfish analyse wordt geladen...";
    return;
  }

  const fen = game.fen();
  const turn = game.turn();
  evaluationRunning = true;
  pendingEvaluationFinal = false;

  try {
    const evaluation = await engineEval.evaluate(fen, turn);
    if (requestId === evalRequest && fen === game.fen()) {
      setEvaluation(evaluation, final);
    }
  } catch (error) {
    if (requestId === evalRequest) {
      evalText.textContent = error.message;
    }
  } finally {
    evaluationRunning = false;
    if (fen !== game.fen() || pendingEvaluationFinal) {
      scheduleEvaluation(pendingEvaluationFinal || game.isGameOver());
    }
  }
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function unlockAudio() {
  const context = getAudioContext();
  if (context?.state === "suspended") {
    context.resume().catch(() => {});
  }
}

function playMoveSound() {
  const context = getAudioContext();
  if (!context) {
    return;
  }

  context.resume().catch(() => {});

  const now = context.currentTime;
  const gain = context.createGain();
  const tap = context.createOscillator();
  const body = context.createOscillator();

  tap.type = "triangle";
  tap.frequency.setValueAtTime(520, now);
  tap.frequency.exponentialRampToValueAtTime(380, now + 0.08);

  body.type = "sine";
  body.frequency.setValueAtTime(180, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.055, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  tap.connect(gain);
  body.connect(gain);
  gain.connect(context.destination);
  tap.start(now);
  body.start(now);
  tap.stop(now + 0.12);
  body.stop(now + 0.09);
}

boardEl.addEventListener("click", (event) => {
  const square = event.target.closest(".square");
  if (!square || !boardEl.contains(square)) {
    return;
  }
  handleSquareClick(square.dataset.square);
});

document.addEventListener("pointerdown", unlockAudio, { once: true });

newGameBtn.addEventListener("click", startNewGame);
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Verder" : "Pauze";
  currentRequest += 1;
  engineWhite?.stop();
  engineBlack?.stop();
  queueBotMove();
  drawBoard();
});

copyFenBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(game.fen());
  copyFenBtn.textContent = "Gekopieerd";
  window.setTimeout(() => {
    copyFenBtn.textContent = "FEN";
  }, 1200);
});

modeSelect.addEventListener("change", syncModeControls);
playerColorSelect.addEventListener("change", startNewGame);
stockfishEloSelect.addEventListener("change", queueBotMove);
whiteBotEloSelect.addEventListener("change", queueBotMove);
blackBotEloSelect.addEventListener("change", queueBotMove);
speedRange.addEventListener("input", updateSpeedLabel);
speedRange.addEventListener("change", queueBotMove);

ensureEngines();
updateSpeedLabel();
drawBoard();
scheduleEvaluation(false);
queueBotMove();
