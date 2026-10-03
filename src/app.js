import { createGame, playMove, nextRound, chooseComputerMove } from './game.js';
import { createSession } from './session.js';
import { connectActivity } from './bridge.js';

const $ = (id) => document.getElementById(id);
const cells = [...document.querySelectorAll('[data-cell]')];
const embedded = window.parent !== window || new URLSearchParams(location.search).get('embedded') === '1';
let mode = 'computer';
let localState = createGame();
let liveView = null;
let bridge = null;
let computerTimer = null;
let handshakeTimer = null;
let retryTimer = null;
let lastBoard = Array(9).fill(null);
let lastStatus = '';

document.body.classList.toggle('embedded', embedded);
$('local-modes').hidden = embedded;
$('refract-info').hidden = !embedded;
$('call-banner').hidden = embedded;
// Reloading a connected activity must not silently switch it into local play.
if (embedded) {
  $('connection').dataset.state = 'waiting';
  $('connection-label').textContent = 'Connecting to Refract';
}

function nameFor(mark, state) {
  if (!embedded) return mode === 'computer' ? (mark === 'X' ? 'You' : 'Computer') : `Player ${mark}`;
  const id = state.players[mark];
  return liveView?.participants.find((person) => person.id === id)?.name ?? 'Open seat';
}

function myMark(state) {
  if (!embedded) return mode === 'computer' ? 'X' : state.turn;
  return ['X', 'O'].find((mark) => state.players[mark] === liveView?.self?.id) ?? null;
}

function render() {
  const state = embedded ? liveView?.state ?? createGame({ xId: null, oId: null }) : localState;
  const ready = !embedded || !!liveView?.connected;
  const bothSeated = state.players.X !== null && state.players.O !== null;
  const mark = myMark(state);
  const canPlay = ready && bothSeated && !state.winner && mark === state.turn;
  const turnName = nameFor(state.turn, state);
  const selfId = liveView?.self?.id;

  for (const player of ['X', 'O']) {
    const name = nameFor(player, state);
    $(`name-${player.toLowerCase()}`).textContent = name;
    const active = ready && bothSeated && !state.winner && state.turn === player;
    $(`player-${player.toLowerCase()}`).classList.toggle('active', active);
    let detail = active ? 'Making the next move' : 'Ready for the next turn';
    if (embedded) {
      detail = state.players[player] === null ? 'Invite someone from your call' : `${state.players[player] === selfId ? 'You · ' : ''}Playing ${player}`;
    } else if (mode === 'computer' && player === 'O') detail = active ? 'Thinking…' : 'A worthy opponent';
    if (state.winner && state.winner !== 'draw' && state.winner === player) detail = 'Winner of this round';
    $(`detail-${player.toLowerCase()}`).textContent = detail;
  }

  let status, detail, tag, statusMark;
  if (!ready) {
    status = liveView ? 'Syncing your game' : 'Waiting for Refract';
    detail = 'Your shared board will appear here.';
    tag = 'CONNECTING'; statusMark = null;
  } else if (!bothSeated) {
    status = 'A seat for a friend';
    detail = 'Ask someone in the call to join this activity.';
    tag = 'WAITING'; statusMark = null;
  } else if (state.winner === 'draw') {
    status = 'Great minds think alike.';
    detail = 'It’s a draw. There’s always the next round.';
    tag = 'WELL PLAYED'; statusMark = null;
  } else if (state.winner) {
    const winnerName = nameFor(state.winner, state);
    const won = embedded ? state.players[state.winner] === selfId : mode === 'computer' && state.winner === 'X';
    status = won ? 'You take this round!' : `${winnerName} wins!`;
    detail = 'Three in a row. Nicely done.';
    tag = 'WELL PLAYED'; statusMark = state.winner;
  } else {
    status = canPlay && (embedded || mode === 'computer') ? 'Your move' : `${turnName}’s move`;
    detail = canPlay ? 'Pick a square and make it yours.' : mark ? 'Good things come to those who wait.' : 'You’ve got the best seat to watch.';
    tag = mark === null ? 'SPECTATING' : 'LET’S PLAY'; statusMark = state.turn;
  }
  if (status !== lastStatus) { $('status').textContent = status; lastStatus = status; }
  $('status-detail').textContent = detail;
  $('turn-tag').textContent = tag;
  $('status-symbol').textContent = statusMark === 'X' ? '×' : statusMark === 'O' ? '○' : '✳';
  $('status-symbol').className = `status-symbol ${statusMark === 'O' ? 'mark-o' : 'mark-x'}`;
  $('round').textContent = `ROUND ${String(state.round).padStart(2, '0')}`;

  cells.forEach((cell, index) => {
    const value = state.board[index];
    cell.dataset.mark = value ?? '';
    cell.disabled = !canPlay || value !== null;
    cell.setAttribute('aria-label', `Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}, ${value ?? 'empty'}${state.winningLine.includes(index) ? ', winning square' : ''}`);
    cell.classList.toggle('winning', state.winningLine.includes(index));
    if (value && value !== lastBoard[index]) {
      cell.classList.remove('just-played');
      void cell.offsetWidth;
      cell.classList.add('just-played');
    }
  });
  lastBoard = [...state.board];
  $('score-x').textContent = state.scores.X;
  $('score-o').textContent = state.scores.O;
  $('score-draw').textContent = state.scores.draw;
  $('next-round').disabled = !ready || !bothSeated || !state.winner || (embedded && !mark);
  $('round-note').textContent = state.winner ? (mark === null ? 'The players can start the next round.' : 'Another round? Keep the good times going.') : state.board.some(Boolean) ? `${state.board.filter(Boolean).length} of 9 squares played` : 'A fresh board. Endless possibilities.';

  if (embedded) {
    const people = liveView?.participants ?? [];
    const spectators = people.filter((person) => !Object.values(state.players).includes(person.id));
    $('player-count').textContent = `${people.length} IN ACTIVITY`;
    $('spectators').hidden = spectators.length === 0;
    $('spectators').textContent = `Watching · ${spectators.map((person) => person.name).join(', ')}`;
    $('seat-description').textContent = !ready ? 'Connecting to your call…' : mark ? `You’re playing ${mark}. Make it count.` : 'You’re watching this round.';
    $('connection-label').textContent = ready ? 'Connected to Refract' : liveView ? 'Syncing with Refract' : 'Waiting for Refract';
    $('connection').dataset.state = ready ? 'connected' : 'waiting';
    if (liveView) {
      $('notice').textContent = liveView.notice ?? '';
      $('notice').hidden = !liveView.notice;
    }
  }
}

function scheduleComputer() {
  clearTimeout(computerTimer);
  if (embedded || mode !== 'computer' || localState.winner || localState.turn !== 'O') return;
  computerTimer = setTimeout(() => {
    const index = chooseComputerMove(localState);
    if (index !== null) localState = playMove(localState, localState.players.O, index);
    render();
  }, 420);
}

const session = createSession({
  send: (data, to) => bridge?.broadcast(data, to),
  onChange(view) { liveView = view; render(); },
});

cells.forEach((cell, index) => {
  cell.addEventListener('click', () => {
    if (embedded) session.move(index);
    else {
      if (mode === 'computer' && localState.turn !== 'X') return;
      localState = playMove(localState, localState.players[localState.turn], index);
      render();
      scheduleComputer();
    }
  });
  cell.addEventListener('keydown', (event) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    for (let step = 1; step < 9; step += 1) {
      const next = cells[(index + direction * step + 27) % 9];
      if (!next.disabled) { next.focus(); break; }
    }
  });
});

$('next-round').addEventListener('click', () => {
  if (embedded) session.rematch();
  else { localState = nextRound(localState); render(); scheduleComputer(); }
});

for (const choice of ['computer', 'local']) {
  $(`mode-${choice}`).addEventListener('click', () => {
    if (mode === choice) return;
    clearTimeout(computerTimer);
    mode = choice;
    localState = createGame();
    $('mode-computer').setAttribute('aria-pressed', String(mode === 'computer'));
    $('mode-local').setAttribute('aria-pressed', String(mode === 'local'));
    $('mode-hint').textContent = mode === 'computer' ? 'A worthy opponent. Can you force a draw?' : 'One screen, two players. Take turns together.';
    render();
  });
}

$('sync').addEventListener('click', () => {
  bridge?.ready();
  session.sync();
});
$('leave').addEventListener('click', () => bridge?.close());

if (embedded) {
  bridge = connectActivity({
    onInit(message) {
      clearTimeout(handshakeTimer);
      document.documentElement.dataset.theme = message.theme;
      session.init(message);
    },
    onParticipants: (people) => session.setParticipants(people),
    onMessage: (from, data) => session.receive(from, data),
  });
  handshakeTimer = setTimeout(() => {
    if (!liveView) {
      $('notice').textContent = 'No Refract connection yet. Open this activity from a call, or use Resync game to try again.';
      $('notice').hidden = false;
    }
  }, 8000);
  // Refract does not replay messages. Occasional snapshots also recover a
  // dropped move or a guest whose first request arrived before the host loaded.
  retryTimer = setInterval(() => { if (!liveView) bridge.ready(); else session.sync(); }, 5000);
}

window.addEventListener('pagehide', () => {
  clearTimeout(computerTimer);
  clearTimeout(handshakeTimer);
  clearInterval(retryTimer);
  session.destroy();
  bridge?.destroy();
});
// A back/forward-cache restore needs fresh listeners and a fresh handshake.
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
render();
