import { createGame, isValidGame, nextRound, playMove } from './game.js';

export const GAME_PROTOCOL = 'refract-tac-toe/1';

const validId = (id) => Number.isSafeInteger(id) && id >= 0;
const clone = (value) => JSON.parse(JSON.stringify(value));
const syncToken = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function normalizePeople(people) {
  if (!Array.isArray(people)) return null;
  const seen = new Set();
  const result = [];
  for (const person of people) {
    if (!person || !validId(person.id) || seen.has(person.id)) return null;
    seen.add(person.id);
    result.push({
      id: person.id,
      name: typeof person.name === 'string' ? person.name : `Player ${person.id}`,
      avatarUrl: typeof person.avatarUrl === 'string' ? person.avatarUrl : null,
    });
  }
  return result;
}

function browserStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function createSession({ send, onChange, storage = browserStorage() }) {
  let state = createGame({ xId: null, oId: null });
  let self = null;
  let participants = [];
  let earlyParticipants = null;
  let sessionId = null;
  let hostId = null;
  let connected = false;
  let notice = '';
  let destroyed = false;
  let acceptedHostId = null;
  let pendingSync = null;

  const ids = () => participants.map((person) => person.id);
  const isHost = () => self !== null && self.id === hostId;
  const isMember = (id) => participants.some((person) => person.id === id);
  const seated = (id) => id !== null && (state.players.X === id || state.players.O === id);
  const storageKey = () => `${GAME_PROTOCOL}:${JSON.stringify([sessionId, self?.id])}`;

  function persist() {
    if (!storage || !connected || !isValidGame(state, ids())) return;
    try {
      storage.setItem(storageKey(), JSON.stringify({ state, hostId, members: ids() }));
    } catch { /* A disabled or full browser store must not prevent live play. */ }
  }

  function restore() {
    if (!storage) return;
    try {
      const raw = storage.getItem(storageKey());
      if (!raw || raw.length > 10000) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved.members) || !saved.members.every(validId) || saved.hostId !== saved.members[0] ||
          new Set(saved.members).size !== saved.members.length || !isValidGame(saved.state, saved.members)) return;
      state = saved.state;
      if (isHost()) {
        const players = assignSeats();
        if (saved.hostId !== hostId ||
            ((players.X !== state.players.X || players.O !== state.players.O) && state.winner === null && state.board.some(Boolean))) {
          state = { ...nextRound(state), players };
        } else if (players.X !== state.players.X || players.O !== state.players.O) {
          state = { ...state, players, revision: state.revision + 1 };
        }
      }
    } catch { /* Ignore invalid or unavailable saved state. */ }
  }

  function emit() {
    if (destroyed) return;
    persist();
    onChange({
      state: clone(state), self: self && { ...self },
      participants: participants.map((person) => ({ ...person })),
      hostId, isHost: isHost(), connected, notice,
    });
  }

  function transmit(kind, data = {}, to) {
    if (destroyed || !sessionId || !self || !isMember(self.id)) return;
    send({ protocol: GAME_PROTOCOL, sessionId, hostId, kind, ...data }, to);
  }

  function snapshot(to, replyTo) {
    transmit('state', { state: clone(state), members: ids(), ...(replyTo ? { replyTo } : {}) }, to);
  }

  function restingNotice() {
    if (!self || !isMember(self.id)) return 'You are no longer in this activity.';
    if (!connected) return 'Synchronizing the game…';
    if (state.players.X === null || state.players.O === null) return 'Waiting for another player to join.';
    return '';
  }

  function assignSeats() {
    const members = ids();
    const players = { ...state.players };
    for (const mark of ['X', 'O']) {
      if (!members.includes(players[mark])) players[mark] = null;
    }
    for (const mark of ['X', 'O']) {
      if (players[mark] === null) {
        players[mark] = members.find((id) => id !== players.X && id !== players.O) ?? null;
      }
    }
    return players;
  }

  function updateRoster(people) {
    const next = normalizePeople(people);
    if (!next || destroyed) return;
    if (!self) {
      earlyParticipants = next;
      return;
    }
    const oldHost = hostId;
    const oldMembers = ids();
    participants = next;
    hostId = participants[0]?.id ?? null;
    const changed = JSON.stringify(oldMembers) !== JSON.stringify(ids());
    const leadershipChanged = oldHost !== hostId;
    if (!isMember(self.id)) {
      connected = false;
      notice = restingNotice();
      emit();
      return;
    }

    if (isHost()) {
      const players = assignSeats();
      const seatsChanged = players.X !== state.players.X || players.O !== state.players.O;
      if (leadershipChanged && oldHost !== null) {
        state = { ...nextRound(state), players };
        notice = 'The host left. A new round is ready; scores have been kept.';
      } else if (seatsChanged) {
        // An unfinished round cannot transfer another player's in-progress moves.
        state = state.winner === null && state.board.some(Boolean)
          ? { ...nextRound(state), players }
          : { ...state, players, revision: state.revision + 1 };
        notice = 'Player seats updated.';
      } else {
        notice = '';
      }
      connected = true;
      acceptedHostId = hostId;
      notice = restingNotice() || notice;
      emit();
      if (changed) snapshot();
    } else {
      if (leadershipChanged || !isValidGame(state, ids())) {
        connected = false;
        acceptedHostId = null;
      }
      notice = restingNotice();
      emit();
      if (changed) sync();
    }
  }

  function init(message) {
    if (destroyed || !message || typeof message.sessionId !== 'string' || !message.sessionId ||
        !message.self || !validId(message.self.id)) return;
    const nextParticipants = normalizePeople(message.participants);
    if (!nextParticipants || !nextParticipants.some((person) => person.id === message.self.id)) return;
    if (sessionId === message.sessionId && self?.id === message.self.id) {
      self = normalizePeople([message.self])[0];
      updateRoster(message.participants);
      sync();
      return;
    }
    sessionId = message.sessionId;
    pendingSync = null;
    self = normalizePeople([message.self])[0];
    participants = nextParticipants;
    hostId = participants[0]?.id ?? null;
    state = createGame({ xId: participants[0]?.id ?? null, oId: participants[1]?.id ?? null });
    restore();
    acceptedHostId = isHost() ? hostId : null;
    connected = isHost();
    notice = restingNotice();
    emit();
    if (earlyParticipants) {
      const pending = earlyParticipants;
      earlyParticipants = null;
      updateRoster(pending);
    }
    sync();
  }

  function sync() {
    if (destroyed || !self || !isMember(self.id)) return;
    if (isHost()) snapshot();
    else {
      pendingSync = syncToken();
      transmit('sync', { requestId: pendingSync }, hostId === null ? undefined : [hostId]);
    }
  }

  function applyAction(from, data) {
    if (!seated(from) || state.players.X === null || state.players.O === null ||
        data.round !== state.round || data.revision !== state.revision) return false;
    if (data.kind === 'move') {
      const next = playMove(state, from, data.index);
      if (next === state) return false;
      state = next;
    } else if (data.kind === 'rematch' && state.winner !== null) {
      state = nextRound(state);
    } else return false;
    notice = '';
    emit();
    snapshot();
    return true;
  }

  function receive(from, data) {
    if (destroyed || !self || !isMember(self.id) || !isMember(from) || !data || typeof data !== 'object' ||
        data.protocol !== GAME_PROTOCOL || data.sessionId !== sessionId || data.hostId !== hostId) return;

    if (data.kind === 'sync') {
      if (isHost() && typeof data.requestId === 'string' && data.requestId.length <= 200) snapshot([from], data.requestId);
      return;
    }
    if (data.kind === 'state') {
      if (isHost() || from !== hostId || !Array.isArray(data.members) ||
          JSON.stringify(data.members) !== JSON.stringify(ids()) || !isValidGame(data.state, ids())) return;
      const requested = pendingSync !== null && data.replyTo === pendingSync;
      if (acceptedHostId === hostId && !requested && (data.state.revision < state.revision ||
          (data.state.revision === state.revision && JSON.stringify(data.state) !== JSON.stringify(state)))) {
        // A fresh request distinguishes a reloaded host from delayed old packets.
        sync();
        return;
      }
      state = clone(data.state);
      pendingSync = null;
      acceptedHostId = hostId;
      connected = true;
      notice = restingNotice();
      emit();
      return;
    }
    if (isHost() && (data.kind === 'move' || data.kind === 'rematch')) {
      if (!applyAction(from, data)) snapshot([from]);
    }
  }

  function action(kind, index) {
    if (destroyed || !self || !connected || !isMember(self.id)) return;
    if (!seated(self.id)) {
      notice = 'You are watching. A seat opens when a player leaves.';
      emit();
      return;
    }
    if (state.players.X === null || state.players.O === null) {
      notice = 'Waiting for another player to join.';
      emit();
      return;
    }
    if (kind === 'move' && playMove(state, self.id, index) === state) return;
    if (kind === 'rematch' && state.winner === null) return;
    const data = { kind, round: state.round, revision: state.revision, ...(kind === 'move' ? { index } : {}) };
    if (isHost()) applyAction(self.id, data);
    else transmit(kind, data, [hostId]);
  }

  return {
    init,
    setParticipants: updateRoster,
    receive,
    move: (index) => action('move', index),
    rematch: () => action('rematch'),
    sync,
    destroy() { destroyed = true; },
  };
}
