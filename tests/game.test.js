import test from 'node:test';
import assert from 'node:assert/strict';
import { boardResult, chooseComputerMove, createGame, isValidGame, nextRound, playMove, WINNING_LINES } from '../src/game.js';

function moveSequence(indices, state = createGame()) {
  for (const index of indices) state = playMove(state, state.players[state.turn], index);
  return state;
}

test('moves are immutable and reject invalid indices, wrong players, and occupied cells', () => {
  const initial = createGame();
  for (const index of [-1, 9, 1.5, '0', undefined, NaN]) assert.equal(playMove(initial, 1, index), initial);
  assert.equal(playMove(initial, 2, 0), initial);
  assert.equal(playMove(initial, 999, 0), initial);
  assert.equal(playMove(createGame({ xId: null }), null, 0).revision, 0);
  const next = playMove(initial, 1, 0);
  assert.equal(initial.board[0], null);
  assert.equal(next.board[0], 'X');
  assert.equal(next.turn, 'O');
  assert.equal(next.revision, 1);
  assert.equal(playMove(next, 2, 0), next);
  assert.ok(isValidGame(next, [1, 2]));
});

test('every winning line is detected', () => {
  for (const line of WINNING_LINES) {
    const board = Array(9).fill(null);
    for (const index of line) board[index] = 'O';
    assert.deepEqual(boardResult(board), { winner: 'O', winningLine: [...line] });
  }
});

test('a win increments one score and terminal boards cannot receive moves', () => {
  const result = moveSequence([0, 3, 1, 4, 2]);
  assert.equal(result.winner, 'X');
  assert.deepEqual(result.winningLine, [0, 1, 2]);
  assert.deepEqual(result.scores, { X: 1, O: 0, draw: 0 });
  assert.equal(playMove(result, 2, 5), result);
  assert.ok(isValidGame(result, [1, 2]));
});

test('a full board draws and next rounds preserve scores while alternating first move', () => {
  const result = moveSequence([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(result.winner, 'draw');
  assert.deepEqual(result.scores, { X: 0, O: 0, draw: 1 });
  const second = nextRound(result);
  assert.equal(second.turn, 'O');
  assert.equal(second.round, 2);
  assert.deepEqual(second.board, Array(9).fill(null));
  assert.deepEqual(second.scores, result.scores);
  assert.ok(isValidGame(second, [1, 2]));
  assert.equal(nextRound(second).turn, 'X');
});

test('computer takes wins, blocks losses, and does not mutate the board', () => {
  const winning = moveSequence([0, 3, 1, 4]);
  const original = structuredClone(winning);
  assert.equal(chooseComputerMove(winning), 2);
  assert.deepEqual(winning, original);
  assert.equal(chooseComputerMove(moveSequence([0, 4, 1])), 2);
  assert.equal(chooseComputerMove(moveSequence([0, 3, 1, 4, 2])), null);
});

test('perfect computer play cannot lose against any legal human continuation, as either mark', () => {
  function explore(state, computerMark) {
    if (state.winner) {
      assert.ok(state.winner === 'draw' || state.winner === computerMark);
      return;
    }
    if (state.turn === computerMark) {
      const index = chooseComputerMove(state);
      assert.notEqual(index, null);
      explore(playMove(state, state.players[state.turn], index), computerMark);
    } else {
      for (let index = 0; index < 9; index += 1) {
        if (state.board[index] === null) explore(playMove(state, state.players[state.turn], index), computerMark);
      }
    }
  }
  explore(createGame(), 'X');
  explore(createGame(), 'O');
  explore(nextRound(createGame()), 'X');
  explore(nextRound(createGame()), 'O');
});

test('network state validation rejects malformed and impossible games', () => {
  const base = createGame();
  const corruptions = [
    null, {}, { ...base, board: [] }, { ...base, board: Array(9).fill('Z') },
    { ...base, round: 0 }, { ...base, revision: -1 }, { ...base, turn: 'O' },
    { ...base, players: { X: 1, O: 1 } }, { ...base, players: { X: 1, O: 99 } },
    { ...base, players: { X: 1, O: null } }, { ...base, scores: { X: -1, O: 0, draw: 0 } },
    { ...base, scores: { X: 1, O: 0, draw: 0 } }, { ...base, scores: { X: 2, O: 0, draw: 0 } }, { ...base, winner: 'X' },
    { ...base, winningLine: [0, 1, 2] },
    { ...base, board: ['O', null, null, null, null, null, null, null, null], revision: 1 },
  ];
  for (const state of corruptions) assert.equal(isValidGame(state, [1, 2]), false);
  const doubleWin = { ...base, board: ['X', 'X', 'X', 'O', 'O', 'O', null, null, null], winner: 'X', winningLine: [0, 1, 2], revision: 6, scores: { X: 1, O: 0, draw: 0 } };
  assert.equal(isValidGame(doubleWin, [1, 2]), false);
});
