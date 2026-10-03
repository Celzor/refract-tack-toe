export const WINNING_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
].map(Object.freeze));

export function startingMark(round) {
  return round % 2 === 1 ? 'X' : 'O';
}

export function createGame({ xId = 1, oId = 2 } = {}) {
  return {
    board: Array(9).fill(null),
    turn: 'X',
    winner: null,
    winningLine: [],
    round: 1,
    scores: { X: 0, O: 0, draw: 0 },
    players: { X: xId, O: oId },
    revision: 0,
  };
}

export function boardResult(board) {
  for (const line of WINNING_LINES) {
    if (board[line[0]] && line.every((index) => board[index] === board[line[0]])) {
      return { winner: board[line[0]], winningLine: [...line] };
    }
  }
  return { winner: board.every(Boolean) ? 'draw' : null, winningLine: [] };
}

export function playMove(state, playerId, index) {
  if (state.winner || !Number.isInteger(index) || index < 0 || index > 8 ||
      state.board[index] !== null || playerId === null ||
      state.players[state.turn] !== playerId) return state;

  const board = [...state.board];
  board[index] = state.turn;
  const result = boardResult(board);
  const scores = { ...state.scores };
  if (result.winner) scores[result.winner] += 1;
  return {
    ...state,
    board,
    ...result,
    turn: state.turn === 'X' ? 'O' : 'X',
    scores,
    revision: state.revision + 1,
  };
}

export function nextRound(state) {
  const round = state.round + 1;
  return {
    ...state,
    board: Array(9).fill(null),
    turn: startingMark(round),
    winner: null,
    winningLine: [],
    round,
    revision: state.revision + 1,
  };
}

// Prefer the centre and corners when several perfect-play moves are equivalent.
const MOVE_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];

export function chooseComputerMove(state) {
  if (state.winner || state.board.every(Boolean)) return null;
  const computer = state.turn;
  const board = [...state.board];

  function score(turn, depth, alpha, beta) {
    const { winner } = boardResult(board);
    if (winner === 'draw') return 0;
    if (winner) return winner === computer ? 10 - depth : depth - 10;
    const maximizing = turn === computer;
    let best = maximizing ? -Infinity : Infinity;
    for (const index of MOVE_ORDER) {
      if (board[index] !== null) continue;
      board[index] = turn;
      const value = score(turn === 'X' ? 'O' : 'X', depth + 1, alpha, beta);
      board[index] = null;
      best = maximizing ? Math.max(best, value) : Math.min(best, value);
      if (maximizing) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let bestMove = null;
  let bestScore = -Infinity;
  for (const index of MOVE_ORDER) {
    if (board[index] !== null) continue;
    board[index] = computer;
    const value = score(computer === 'X' ? 'O' : 'X', 1, -Infinity, Infinity);
    board[index] = null;
    if (value > bestScore) {
      bestScore = value;
      bestMove = index;
    }
  }
  return bestMove;
}

// Treat network state as untrusted, including internally inconsistent boards.
export function isValidGame(state, memberIds) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.board) ||
      state.board.length !== 9 || !state.board.every((cell) => cell === null || cell === 'X' || cell === 'O') ||
      !Number.isSafeInteger(state.round) || state.round < 1 ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !state.players || !state.scores || !Array.isArray(state.winningLine)) return false;

  for (const mark of ['X', 'O']) {
    const id = state.players[mark];
    if (id !== null && (!Number.isSafeInteger(id) || id < 0 || (memberIds && !memberIds.includes(id)))) return false;
  }
  if (state.players.X !== null && state.players.X === state.players.O) return false;
  if (memberIds && [state.players.X, state.players.O].filter((id) => id !== null).length !== Math.min(2, memberIds.length)) return false;
  for (const mark of ['X', 'O', 'draw']) {
    if (!Number.isSafeInteger(state.scores[mark]) || state.scores[mark] < 0) return false;
  }
  const completedRounds = state.round - (state.winner === null ? 1 : 0);
  if (state.scores.X + state.scores.O + state.scores.draw > completedRounds) return false;

  const starter = startingMark(state.round);
  const other = starter === 'X' ? 'O' : 'X';
  const firstCount = state.board.filter((cell) => cell === starter).length;
  const secondCount = state.board.filter((cell) => cell === other).length;
  if (firstCount !== secondCount && firstCount !== secondCount + 1) return false;
  if (state.turn !== (firstCount === secondCount ? starter : other)) return false;
  if (state.revision < state.round - 1 + firstCount + secondCount) return false;
  const result = boardResult(state.board);
  if (state.winner !== result.winner || JSON.stringify(state.winningLine) !== JSON.stringify(result.winningLine)) return false;
  if (state.winner && state.scores[state.winner] < 1) return false;
  if (state.winner && state.winner !== 'draw') {
    if (state.winner === state.turn) return false;
    if (WINNING_LINES.some((line) => line.every((index) => state.board[index] === state.turn))) return false;
  }
  return true;
}
