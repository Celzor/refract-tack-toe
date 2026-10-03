import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, playMove } from '../src/game.js';
import { createSession, GAME_PROTOCOL } from '../src/session.js';

const person = (id) => ({ id, name: `Player ${id}`, avatarUrl: null });
const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

function network(initialIds = [1, 2], { persistence = true } = {}) {
  const clients = new Map();
  const queue = [];
  const sent = [];
  const stores = new Map();
  let memberIds = [...initialIds];
  let sessionId = 'test-session';

  function add(id) {
    if (!stores.has(id)) stores.set(id, memoryStorage());
    const client = { view: null };
    client.session = createSession({
      storage: persistence ? stores.get(id) : null,
      send(data, to) {
        const message = { from: id, data: structuredClone(data), to };
        queue.push(message);
        sent.push(message);
      },
      onChange(view) { client.view = view; },
    });
    clients.set(id, client);
    return client;
  }

  function init(id) {
    clients.get(id).session.init({ sessionId, self: person(id), participants: memberIds.map(person) });
  }

  function flush() {
    let count = 0;
    while (queue.length) {
      assert.ok(count++ < 1000, 'message exchange must settle');
      const { from, data, to } = queue.shift();
      for (const [id, client] of clients) {
        if (id !== from && (!to || to.includes(id)) && memberIds.includes(id)) client.session.receive(from, structuredClone(data));
      }
    }
  }

  for (const id of initialIds) add(id);
  for (const id of initialIds) init(id);
  flush();

  return {
    clients, sent, queue, flush, init,
    view: (id) => clients.get(id).view,
    move(id, index) { clients.get(id).session.move(index); flush(); },
    rematch(id) { clients.get(id).session.rematch(); flush(); },
    join(id) {
      memberIds.push(id);
      for (const client of clients.values()) client.session.setParticipants(memberIds.map(person));
      add(id);
      init(id);
      flush();
    },
    leave(id) {
      clients.get(id).session.destroy();
      clients.delete(id);
      memberIds = memberIds.filter((member) => member !== id);
      for (const client of clients.values()) client.session.setParticipants(memberIds.map(person));
      flush();
    },
    reload(id) {
      clients.get(id).session.destroy();
      add(id);
      init(id);
      flush();
    },
    newSession() {
      sessionId = 'new-session';
      for (const id of memberIds) init(id);
      flush();
    },
    packet(kind, extra = {}) {
      const state = clients.get(memberIds[0]).view.state;
      return { protocol: GAME_PROTOCOL, sessionId, hostId: memberIds[0], kind, round: state.round, revision: state.revision, ...extra };
    },
    assertConverged() {
      const host = clients.get(memberIds[0]).view;
      for (const client of clients.values()) {
        assert.equal(client.view.connected, true);
        assert.deepEqual(client.view.state, host.state);
        assert.equal(client.view.hostId, memberIds[0]);
      }
    },
  };
}

test('host applies its own move without echoed messages, guests propose moves, spectators watch', () => {
  const net = network([1, 2, 3]);
  assert.deepEqual(net.view(1).state.players, { X: 1, O: 2 });
  net.move(1, 4);
  net.move(2, 0);
  net.move(3, 1);
  assert.deepEqual(net.view(1).state.board, ['O', null, null, null, 'X', null, null, null, null]);
  assert.match(net.view(3).notice, /watching/);
  net.assertConverged();
});

test('host rejects wrong-turn, spectator, stale, invalid-index and spoofed proposals', () => {
  const net = network([1, 2, 3]);
  const host = net.clients.get(1).session;
  for (const [from, packet] of [
    [2, net.packet('move', { index: 0 })],
    [3, net.packet('move', { index: 0, playerId: 1 })],
    [99, net.packet('move', { index: 0 })],
    [1, net.packet('move', { index: 9 })],
    [1, net.packet('move', { index: '0' })],
    [1, net.packet('move', { index: 0, revision: -1 })],
    [1, net.packet('move', { index: 0, round: 2 })],
    [1, net.packet('move', { index: 0, sessionId: 'old' })],
    [1, net.packet('move', { index: 0, protocol: 'other-app/1' })],
    [1, net.packet('move', { index: 0, hostId: 2 })],
  ]) host.receive(from, packet);
  net.flush();
  assert.equal(net.view(1).state.revision, 0);
  const proposal = net.packet('move', { index: 0 });
  host.receive(1, proposal);
  host.receive(1, proposal);
  net.flush();
  assert.equal(net.view(1).state.revision, 1);
  net.assertConverged();
});

test('late spectators and reloaded guests request the current snapshot', () => {
  const net = network();
  net.move(1, 0);
  net.move(2, 4);
  net.join(3);
  net.reload(2);
  assert.equal(net.view(2).state.revision, 2);
  assert.deepEqual(net.view(3).state.board, net.view(1).state.board);
  net.assertConverged();
});

test('host reload restores the saved round and remains playable', () => {
  const net = network();
  net.move(1, 0);
  net.move(2, 4);
  net.reload(1);
  assert.equal(net.view(1).state.revision, 2);
  net.move(1, 1);
  net.assertConverged();
  assert.equal(net.view(2).state.board[1], 'X');
});

test('a host reload with storage disabled resynchronizes a fresh game instead of deadlocking', () => {
  const net = network([1, 2], { persistence: false });
  net.move(1, 0);
  net.move(2, 4);
  net.reload(1);
  assert.equal(net.view(1).state.revision, 0);
  net.assertConverged();
  net.move(1, 2);
  net.move(2, 4);
  net.assertConverged();
});

test('duplicate initialization preserves a live game', () => {
  const net = network();
  net.move(1, 0);
  net.init(1);
  net.init(2);
  net.flush();
  assert.equal(net.view(1).state.revision, 1);
  assert.equal(net.view(2).state.board[0], 'X');
  net.assertConverged();
});

test('malformed, wrong-host, wrong-roster and stale snapshots do not alter the game', () => {
  const net = network([1, 2, 3]);
  const old = structuredClone(net.view(1).state);
  net.move(1, 4);
  const current = structuredClone(net.view(2).state);
  const guest = net.clients.get(2).session;
  const valid = net.packet('state', { members: [1, 2, 3], state: current });
  for (const packet of [null, {}, { ...valid, state: {} }, { ...valid, members: [1, 2] },
    { ...valid, state: { ...current, board: Array(9).fill('X') } },
    { ...valid, state: { ...current, scores: { X: -1, O: 0, draw: 0 } } },
    { ...valid, state: { ...current, players: { X: 999, O: 2 } } },
    { ...valid, sessionId: 'wrong-session' }, { ...valid, state: old },
  ]) guest.receive(1, packet);
  guest.receive(3, { ...valid, state: playMove(current, 2, 0) });
  assert.deepEqual(net.view(2).state, current);
  net.flush();
  net.assertConverged();
});

test('a completed round can be rematched once by either seated player', () => {
  const net = network([1, 2, 3]);
  net.rematch(1);
  assert.equal(net.view(1).state.round, 1);
  for (const [id, index] of [[1, 0], [2, 3], [1, 1], [2, 4], [1, 2]]) net.move(id, index);
  assert.equal(net.view(1).state.winner, 'X');
  net.rematch(3);
  assert.equal(net.view(1).state.round, 1);
  const stale = net.packet('rematch');
  net.rematch(2);
  net.clients.get(1).session.receive(2, stale);
  net.flush();
  assert.equal(net.view(1).state.round, 2);
  assert.equal(net.view(1).state.turn, 'O');
  assert.deepEqual(net.view(1).state.scores, { X: 1, O: 0, draw: 0 });
  net.move(2, 4);
  net.assertConverged();
});

test('leaving players are replaced by the earliest spectator; unfinished rounds reset', () => {
  const net = network([1, 2, 3, 4]);
  net.move(1, 0);
  net.leave(2);
  assert.deepEqual(net.view(1).state.players, { X: 1, O: 3 });
  assert.deepEqual(net.view(1).state.board, Array(9).fill(null));
  assert.equal(net.view(1).state.round, 2);
  net.move(3, 4);
  net.assertConverged();
});

test('host departure elects the first remaining member, preserves scores, and rejects old-host messages', () => {
  const net = network([1, 2, 3]);
  for (const [id, index] of [[1, 0], [2, 3], [1, 1], [2, 4], [1, 2]]) net.move(id, index);
  const oldState = structuredClone(net.view(1).state);
  const oldPacket = net.packet('state', { state: oldState, members: [1, 2, 3] });
  net.leave(1);
  assert.equal(net.view(2).isHost, true);
  assert.deepEqual(net.view(2).state.players, { X: 3, O: 2 });
  assert.equal(net.view(2).state.round, 2);
  assert.deepEqual(net.view(2).state.scores, { X: 1, O: 0, draw: 0 });
  net.clients.get(3).session.receive(1, oldPacket);
  net.move(2, 4);
  net.move(3, 0);
  net.assertConverged();
});

test('host recovery converges even when the new host missed the previous last move', () => {
  const net = network([1, 2, 3]);
  net.clients.get(1).session.move(0);
  const last = net.queue.pop();
  net.clients.get(3).session.receive(last.from, last.data);
  assert.equal(net.view(2).state.revision, 0);
  assert.equal(net.view(3).state.revision, 1);
  net.leave(1);
  net.assertConverged();
  assert.equal(net.view(3).state.round, 2);
});

test('a new activity session starts fresh and ignores old-session traffic', () => {
  const net = network();
  net.move(1, 0);
  const old = net.packet('move', { index: 4 });
  net.newSession();
  net.clients.get(1).session.receive(2, old);
  assert.deepEqual(net.view(1).state, createGame());
  net.assertConverged();
});

test('single-player activities wait for another participant and fill the vacant seat', () => {
  const net = network([1]);
  net.move(1, 0);
  assert.equal(net.view(1).state.revision, 0);
  assert.match(net.view(1).notice, /Waiting for another player/);
  net.join(2);
  net.move(1, 0);
  net.assertConverged();
  net.leave(2);
  assert.equal(net.view(1).state.players.O, null);
  net.join(3);
  net.assertConverged();
});

test('roster events before init are buffered, and destroy prevents further work', () => {
  let view;
  const sent = [];
  const session = createSession({ storage: null, send: (packet) => sent.push(packet), onChange: (next) => { view = next; } });
  session.setParticipants([person(1), person(2), person(3)]);
  session.init({ sessionId: 'a', self: person(1), participants: [person(1), person(2)] });
  assert.equal(view.participants.length, 3);
  const before = sent.length;
  session.destroy();
  session.move(0);
  session.sync();
  session.init({ sessionId: 'b', self: person(1), participants: [person(1), person(2)] });
  assert.equal(sent.length, before);
});

test('unavailable or corrupt browser storage never prevents a live game', () => {
  for (const storage of [
    { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    { getItem() { return '{not json'; }, setItem() {} },
    { getItem() { return JSON.stringify({ state: {}, members: [1, 2], hostId: 1 }); }, setItem() {} },
  ]) {
    let view;
    const session = createSession({ storage, send() {}, onChange: (next) => { view = next; } });
    session.init({ sessionId: 'a', self: person(1), participants: [person(1), person(2)] });
    session.move(0);
    assert.equal(view.state.board[0], 'X');
  }
});
