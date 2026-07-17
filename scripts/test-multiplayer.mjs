import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../multiplayer.js', import.meta.url), 'utf8');

class ClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    if (force) this.values.add(value); else this.values.delete(value);
    return force;
  }
  contains(value) { return this.values.has(value); }
}

function makeElement() {
  return {
    value: '', textContent: '', disabled: false, dataset: {}, style: {},
    classList: new ClassList(), listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    click() { if (this.listeners.click) this.listeners.click({ target: this }); }
  };
}

class Connection {
  constructor() { this.open = false; this.listeners = {}; this.other = null; }
  on(type, listener) { this.listeners[type] = listener; }
  emit(type, data) { if (this.listeners[type]) this.listeners[type](data); }
  send(data) { if (this.open && this.other && this.other.open) this.other.emit('data', structuredClone(data)); }
  close() {
    if (!this.open) return;
    this.open = false;
    const other = this.other;
    if (other) other.open = false;
    queueMicrotask(() => {
      this.emit('close');
      if (other) other.emit('close');
    });
  }
}

function makePeerHub() {
  const peers = new Map();
  let nextId = 1;
  return class PeerStub {
    constructor(id) {
      this.id = typeof id === 'string' ? id : `guest-${nextId++}`;
      this.listeners = {};
      peers.set(this.id, this);
      queueMicrotask(() => this.emit('open', this.id));
    }
    on(type, listener) { this.listeners[type] = listener; }
    emit(type, data) { if (this.listeners[type]) this.listeners[type](data); }
    connect(id) {
      const local = new Connection();
      const remote = new Connection();
      local.other = remote;
      remote.other = local;
      queueMicrotask(() => {
        const target = peers.get(id);
        if (!target) {
          this.emit('error', { type: 'peer-unavailable' });
          return;
        }
        target.emit('connection', remote);
        local.open = true;
        remote.open = true;
        local.emit('open');
        remote.emit('open');
      });
      return local;
    }
    destroy() { peers.delete(this.id); }
  };
}

const PeerStub = makePeerHub();
const ids = [
  'onlineName', 'onlineStatus', 'netBadge', 'roomShare', 'roomCode', 'onlineStartBtn',
  'onlinePanel', 'hint', 'onlineBtn', 'onlineClose', 'createRoomBtn', 'joinCode',
  'joinRoomBtn', 'copyRoomBtn', 'onlineLeaveBtn'
];

function makeClient(label) {
  const elements = Object.fromEntries(ids.map(id => [id, makeElement()]));
  elements.onlineName.value = label;
  const store = new Map();
  const globalListeners = {};
  const window = {
    Peer: PeerStub,
    crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = i + 3; } },
    prompt() {},
    addEventListener(type, listener) { globalListeners[type] = listener; }
  };
  window.window = window;
  const sandbox = {
    window,
    document: {
      getElementById(id) { return elements[id] || (elements[id] = makeElement()); },
      createElement() { return { getContext() { return null; } }; }
    },
    localStorage: {
      getItem(key) { return store.get(key) || null; },
      setItem(key, value) { store.set(key, value); }
    },
    navigator: {}, performance, console, Math, Number, String, Object, Array, Uint8Array,
    structuredClone, setTimeout, clearTimeout,
    addEventListener: window.addEventListener.bind(window)
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'multiplayer.js' });

  const game = {
    S: {
      fear: 0, minute: 41,
      has: { note: false, battery: false, keycard: false, fuse: false, archive: false, cassette: false, ribbon: false, charm: false, photo: false, umbrella: false },
      flags: { readWall: false, mirror: 0, guardLog: false, powerOn: false, pianoSolved: false, memorialRead: false, lockerOpen: false, chase: false, doorSeq: false, codeKnown: false, deskEvent: false },
      doorHits: 0, mode: 'title'
    },
    MW: 32, MH: 22,
    P: { x: 2.5, y: 2.5, a: 0 },
    GHOST: { x: 0, y: 0, on: false, mode: 'none', t: 0 },
    HIDE: { on: false },
    refreshCount: 0,
    beginGame() { this.S.mode = 'play'; },
    refreshSharedUi() { this.refreshCount += 1; },
    jumpscare(done) { if (done) done(); },
    endGame() { this.S.mode = 'end'; }
  };
  window.MULTI.init(game);
  return { elements, game, multi: window.MULTI };
}

const flush = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

const host = makeClient('小雨');
const guest = makeClient('阿川');

host.elements.createRoomBtn.click();
await flush();
const roomCode = host.elements.roomCode.textContent;
assert.match(roomCode, /^[2-9A-HJ-NP-Z]{6}$/);

guest.elements.joinCode.value = roomCode;
guest.elements.joinRoomBtn.click();
await flush();

assert.equal(host.multi.isConnected(), true);
assert.equal(guest.multi.isConnected(), true);
assert.equal(host.multi.isAuthority(), true);
assert.equal(guest.multi.isAuthority(), false);
assert.equal(host.elements.onlineStartBtn.disabled, false);
assert.equal(host.multi.remoteName(), '阿川');
assert.equal(guest.multi.remoteName(), '小雨');

host.elements.onlineStartBtn.click();
await flush();
assert.equal(host.game.S.mode, 'play');
assert.equal(guest.elements.onlineStartBtn.disabled, false);
guest.elements.onlineStartBtn.click();
assert.equal(guest.game.S.mode, 'play');

guest.game.S.has.note = true;
guest.game.S.minute = 42;
guest.multi.worldChanged('note');
await flush();
assert.equal(host.game.S.has.note, true);
assert.equal(host.game.S.minute, 42);

guest.game.P.x = 26.25;
guest.game.P.y = 13.1;
guest.multi.update(0.2);
host.multi.update(0.2);
const teammate = host.multi.remoteSprite();
assert.ok(teammate);
assert.ok(Math.abs(teammate.x - 26.25) < 0.01);
assert.ok(Math.abs(teammate.y - 13.1) < 0.01);

host.game.GHOST.on = true;
host.game.GHOST.mode = 'chase';
host.game.GHOST.x = 26.2;
host.game.GHOST.y = 13.1;
assert.equal(host.multi.closestTarget(host.game.P).remote, true);

console.log('双人联机握手、开局、世界状态与位置同步测试通过。');
