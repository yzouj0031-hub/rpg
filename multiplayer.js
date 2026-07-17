(function () {
  'use strict';

  const ROOM_PREFIX = 'di13jie-room-';
  const PROTOCOL_VERSION = 1;
  const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const NET = {
    ctx: null,
    peer: null,
    conn: null,
    active: false,
    host: false,
    room: '',
    name: '',
    revision: 0,
    lastRevision: -1,
    startPending: false,
    pendingWorld: null,
    sendTimer: 0,
    worldTimer: 0,
    remote: {
      name: '队友', x: 2.5, y: 2.5, a: 0,
      tx: 2.5, ty: 2.5, ta: 0,
      mode: 'title', hidden: false, dead: false, seenAt: 0
    },
    three: null
  };

  const el = id => document.getElementById(id);
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const safeText = (value, fallback = '') => String(value || fallback).replace(/[<>\r\n]/g, '').trim();
  const connected = () => !!(NET.active && NET.conn && NET.conn.open);

  function randomRoomCode() {
    const bytes = new Uint8Array(6);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.random() * 256;
    return Array.from(bytes, value => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
  }

  function readName() {
    const input = el('onlineName');
    const name = safeText(input && input.value, NET.host ? '房主' : '同学').slice(0, 10) || '同学';
    if (input) input.value = name;
    try { localStorage.setItem('d13_online_name', name); } catch (error) {}
    NET.name = name;
    return name;
  }

  function setStatus(text, state = '') {
    const status = el('onlineStatus');
    if (status) {
      status.textContent = text;
      status.dataset.state = state;
    }
  }

  function setBadge(text, state = '') {
    const badge = el('netBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.dataset.state = state;
    badge.classList.toggle('on', !!text);
  }

  function setRoomUi() {
    const share = el('roomShare');
    const code = el('roomCode');
    if (share) share.classList.toggle('on', !!NET.room);
    if (code) code.textContent = NET.room || '------';
  }

  function setOnlineStart(label, enabled) {
    const button = el('onlineStartBtn');
    if (!button) return;
    button.textContent = label;
    button.disabled = !enabled;
    button.classList.add('on');
  }

  function showPanel(show = true) {
    const panel = el('onlinePanel');
    if (panel) panel.classList.toggle('on', show);
  }

  function showHint(text, danger = false) {
    const hint = el('hint');
    if (!hint) return;
    hint.textContent = text;
    hint.style.color = danger ? '#c53a2e' : '';
    hint.style.opacity = 1;
    clearTimeout(showHint.timer);
    showHint.timer = setTimeout(() => { hint.style.opacity = 0; }, 3200);
  }

  function send(message) {
    if (!connected()) return false;
    try {
      NET.conn.send(message);
      return true;
    } catch (error) {
      console.warn('[multiplayer] send failed', error);
      return false;
    }
  }

  function worldSnapshot() {
    const ctx = NET.ctx;
    if (!ctx) return null;
    return {
      has: { ...ctx.S.has },
      flags: { ...ctx.S.flags },
      doorHits: ctx.S.doorHits,
      minute: ctx.S.minute,
      ghost: {
        x: ctx.GHOST.x,
        y: ctx.GHOST.y,
        on: ctx.GHOST.on,
        mode: ctx.GHOST.mode,
        t: ctx.GHOST.t
      }
    };
  }

  function applyWorld(world, proposal = false) {
    const ctx = NET.ctx;
    if (!ctx || !world || typeof world !== 'object') return;
    const before = { ...ctx.S.has };

    if (world.has && typeof world.has === 'object') {
      for (const key of Object.keys(ctx.S.has)) {
        if (typeof world.has[key] === 'boolean') {
          ctx.S.has[key] = proposal ? (ctx.S.has[key] || world.has[key]) : world.has[key];
        }
      }
    }
    if (world.flags && typeof world.flags === 'object') {
      for (const key of Object.keys(ctx.S.flags)) {
        if (key === 'mirror') {
          const mirror = clamp(world.flags[key], 0, 2, ctx.S.flags[key]);
          ctx.S.flags[key] = proposal ? Math.max(ctx.S.flags[key], mirror) : mirror;
        } else if (typeof world.flags[key] === 'boolean') {
          if (proposal && !['doorSeq'].includes(key)) ctx.S.flags[key] = ctx.S.flags[key] || world.flags[key];
          else ctx.S.flags[key] = world.flags[key];
        }
      }
    }
    ctx.S.doorHits = proposal
      ? Math.max(ctx.S.doorHits, clamp(world.doorHits, 0, 20, ctx.S.doorHits))
      : clamp(world.doorHits, 0, 20, ctx.S.doorHits);
    ctx.S.minute = proposal
      ? Math.max(ctx.S.minute, clamp(world.minute, 0, 180, ctx.S.minute))
      : clamp(world.minute, 0, 180, ctx.S.minute);

    if (world.ghost && typeof world.ghost === 'object' && !ctx.HIDE.on) {
      ctx.GHOST.x = clamp(world.ghost.x, 0, 20, ctx.GHOST.x);
      ctx.GHOST.y = clamp(world.ghost.y, 0, 14, ctx.GHOST.y);
      ctx.GHOST.on = !!world.ghost.on;
      ctx.GHOST.mode = safeText(world.ghost.mode, 'none').slice(0, 12) || 'none';
      ctx.GHOST.t = clamp(world.ghost.t, 0, 30, 0);
    }

    ctx.refreshSharedUi();
    const labels = { note: '纸条', battery: '电池', charm: '平安符', photo: '旧照片', umbrella: '旧伞' };
    const found = Object.keys(before).find(key => !before[key] && ctx.S.has[key]);
    if (found && !NET.host) showHint(`队友找到了：${labels[found] || '关键线索'}`);
  }

  function sendWorld(reason = 'sync') {
    if (!NET.host || !connected()) return;
    send({ type: 'world', revision: NET.revision, reason, world: worldSnapshot() });
  }

  function worldChanged(reason = 'interaction') {
    if (!connected()) return;
    if (NET.host) {
      NET.revision += 1;
      sendWorld(reason);
    } else {
      send({ type: 'world-proposal', baseRevision: NET.lastRevision, reason, world: worldSnapshot() });
    }
  }

  function updateRemotePlayer(data) {
    if (!data || typeof data !== 'object') return;
    NET.remote.name = safeText(data.name, NET.remote.name).slice(0, 10) || '队友';
    NET.remote.tx = clamp(data.x, 0, 20, NET.remote.tx);
    NET.remote.ty = clamp(data.y, 0, 14, NET.remote.ty);
    NET.remote.ta = clamp(data.a, -Math.PI * 20, Math.PI * 20, NET.remote.ta);
    NET.remote.mode = safeText(data.mode, 'title').slice(0, 12);
    NET.remote.hidden = !!data.hidden;
    NET.remote.dead = NET.remote.mode === 'end';
    NET.remote.seenAt = performance.now();
    updateThreeName();
  }

  function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    switch (message.type) {
      case 'join':
        if (!NET.host) return;
        NET.remote.name = safeText(message.name, '同学').slice(0, 10) || '同学';
        send({
          type: 'welcome',
          version: PROTOCOL_VERSION,
          hostName: NET.name,
          revision: NET.revision,
          world: worldSnapshot()
        });
        setStatus(`${NET.remote.name} 已加入，可以开始了`, 'ok');
        setBadge(`联机 · ${NET.remote.name}`, 'ok');
        setOnlineStart('两 人 一 起 进 入 校 园', true);
        updateThreeName();
        break;
      case 'welcome':
        if (NET.host) return;
        NET.remote.name = safeText(message.hostName, '房主').slice(0, 10) || '房主';
        NET.lastRevision = clamp(message.revision, 0, Number.MAX_SAFE_INTEGER, 0);
        applyWorld(message.world);
        setStatus(`已连接房主 ${NET.remote.name}，等待开始`, 'ok');
        setBadge(`联机 · ${NET.remote.name}`, 'ok');
        setOnlineStart('等 待 房 主 开 始', false);
        updateThreeName();
        break;
      case 'start':
        if (NET.host) return;
        NET.pendingWorld = message.world || null;
        NET.startPending = true;
        if (NET.pendingWorld) applyWorld(NET.pendingWorld);
        setStatus('房主已经进入校园，点击加入', 'ok');
        setOnlineStart('进 入 联 机 游 戏', true);
        if (navigator.vibrate) navigator.vibrate([50, 50, 80]);
        break;
      case 'player':
        updateRemotePlayer(message.player);
        break;
      case 'world': {
        if (NET.host) return;
        const revision = clamp(message.revision, 0, Number.MAX_SAFE_INTEGER, NET.lastRevision);
        if (revision < NET.lastRevision) return;
        NET.lastRevision = revision;
        applyWorld(message.world);
        break;
      }
      case 'world-proposal':
        if (!NET.host) return;
        applyWorld(message.world, true);
        NET.revision += 1;
        sendWorld(safeText(message.reason, 'teammate'));
        break;
      case 'caught':
        if (NET.ctx && NET.ctx.S.mode === 'play') {
          NET.ctx.jumpscare(() => NET.ctx.endGame('caught'));
        }
        break;
      case 'full':
        setStatus('这个房间已经有两个人了', 'error');
        disconnect(false);
        break;
      case 'leave':
        connectionLost('队友已离开房间');
        break;
      default:
        break;
    }
  }

  function wireConnection(connection) {
    if (NET.conn && NET.conn.open && NET.conn !== connection) {
      connection.on('open', () => {
        connection.send({ type: 'full' });
        setTimeout(() => connection.close(), 150);
      });
      return;
    }
    NET.conn = connection;
    connection.on('open', () => {
      NET.active = true;
      if (NET.host) {
        setStatus('同学正在进入房间…', 'busy');
      } else {
        send({ type: 'join', version: PROTOCOL_VERSION, name: NET.name });
        setStatus('已找到房间，正在同步…', 'busy');
      }
    });
    connection.on('data', handleMessage);
    connection.on('close', () => { if (NET.conn === connection) connectionLost('连接已断开'); });
    connection.on('error', error => {
      console.warn('[multiplayer] data connection error', error);
      if (NET.conn === connection) connectionLost('队友连接失败');
    });
  }

  function describePeerError(error) {
    const type = error && error.type;
    if (type === 'peer-unavailable') return '找不到这个房间，请检查房间码';
    if (type === 'unavailable-id') return '房间码正被占用，请重新创建';
    if (type === 'network' || type === 'server-error' || type === 'socket-error') return '联机服务暂时不可用，请检查网络';
    if (type === 'browser-incompatible') return '当前设备不支持 P2P 联机';
    return '连接失败，请稍后重试';
  }

  function wirePeer(peer) {
    peer.on('connection', connection => wireConnection(connection));
    peer.on('error', error => {
      if (NET.peer !== peer) return;
      console.warn('[multiplayer] peer error', error);
      connectionLost(describePeerError(error));
    });
    peer.on('disconnected', () => {
      if (NET.peer === peer && NET.active) connectionLost('联机服务已断开');
    });
  }

  function createRoom() {
    if (typeof window.Peer !== 'function') {
      setStatus('联机组件没有加载，请检查网络后重试', 'error');
      return;
    }
    disconnect(false);
    NET.host = true;
    NET.active = true;
    NET.room = randomRoomCode();
    NET.revision = 0;
    NET.name = readName();
    setRoomUi();
    setStatus('正在创建房间…', 'busy');
    setBadge(`房间 ${NET.room}`, 'busy');
    setOnlineStart('等 待 同 学 加 入', false);

    const peer = new window.Peer(ROOM_PREFIX + NET.room.toLowerCase(), { debug: 1 });
    NET.peer = peer;
    wirePeer(peer);
    peer.on('open', () => {
      setStatus('房间已创建，把房间码发给同学', 'ok');
      setBadge(`房间 ${NET.room} · 等待队友`, 'busy');
    });
  }

  function joinRoom() {
    if (typeof window.Peer !== 'function') {
      setStatus('联机组件没有加载，请检查网络后重试', 'error');
      return;
    }
    const input = el('joinCode');
    const room = safeText(input && input.value).toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
    if (input) input.value = room;
    if (room.length !== 6) {
      setStatus('请输入 6 位房间码', 'error');
      return;
    }

    disconnect(false);
    NET.host = false;
    NET.active = true;
    NET.room = room;
    NET.name = readName();
    setRoomUi();
    setStatus('正在寻找房间…', 'busy');
    setBadge(`正在加入 ${room}`, 'busy');
    setOnlineStart('连 接 中…', false);

    const peer = new window.Peer(undefined, { debug: 1 });
    NET.peer = peer;
    wirePeer(peer);
    peer.on('open', () => {
      const connection = peer.connect(ROOM_PREFIX + room.toLowerCase(), { reliable: true });
      wireConnection(connection);
    });
  }

  function startOnlineGame() {
    if (!connected() || !NET.ctx) return;
    if (NET.host) {
      send({ type: 'start', revision: NET.revision, world: worldSnapshot() });
      showPanel(false);
      NET.ctx.beginGame(true);
    } else if (NET.startPending) {
      if (NET.pendingWorld) applyWorld(NET.pendingWorld);
      NET.startPending = false;
      showPanel(false);
      NET.ctx.beginGame(true);
    }
  }

  function connectionLost(message) {
    const wasPlaying = NET.ctx && NET.ctx.S.mode === 'play';
    const connection = NET.conn;
    const peer = NET.peer;
    NET.active = false;
    NET.conn = null;
    NET.peer = null;
    NET.host = false;
    NET.room = '';
    NET.remote.mode = 'offline';
    if (connection) {
      try { connection.close(); } catch (error) {}
    }
    if (peer) {
      try { peer.destroy(); } catch (error) {}
    }
    setRoomUi();
    setStatus(message, 'error');
    setBadge(wasPlaying ? '队友离线 · 单人继续' : '联机已断开', 'error');
    if (wasPlaying) showHint('队友断线了，已切换为单人继续', true);
    setOnlineStart('重 新 联 机', false);
  }

  function disconnect(showMessage = true) {
    const connection = NET.conn;
    const peer = NET.peer;
    NET.conn = null;
    NET.peer = null;
    NET.active = false;
    if (connection && connection.open) {
      try { connection.send({ type: 'leave' }); } catch (error) {}
    }
    if (connection) {
      try { connection.close(); } catch (error) {}
    }
    if (peer) {
      try { peer.destroy(); } catch (error) {}
    }
    NET.host = false;
    NET.room = '';
    NET.startPending = false;
    NET.pendingWorld = null;
    NET.remote.mode = 'offline';
    setRoomUi();
    setBadge('', '');
    const start = el('onlineStartBtn');
    if (start) start.classList.remove('on');
    if (showMessage) setStatus('已退出联机，可以重新创建或加入', '');
  }

  function copyRoomCode() {
    if (!NET.room) return;
    const done = () => setStatus(`房间码 ${NET.room} 已复制`, 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(NET.room).then(done).catch(() => {
        window.prompt('复制这个房间码：', NET.room);
      });
    } else {
      window.prompt('复制这个房间码：', NET.room);
    }
  }

  function playerPacket() {
    const ctx = NET.ctx;
    return {
      name: NET.name,
      x: ctx.P.x,
      y: ctx.P.y,
      a: ctx.P.a,
      mode: ctx.S.mode,
      hidden: ctx.HIDE.on
    };
  }

  function update(dt) {
    if (!NET.ctx) return;
    const smooth = Math.min(1, dt * 10);
    NET.remote.x += (NET.remote.tx - NET.remote.x) * smooth;
    NET.remote.y += (NET.remote.ty - NET.remote.y) * smooth;
    let angleDelta = NET.remote.ta - NET.remote.a;
    while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
    while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
    NET.remote.a += angleDelta * smooth;

    updateThree();
    if (!connected()) return;
    NET.sendTimer -= dt;
    if (NET.sendTimer <= 0) {
      NET.sendTimer = 0.1;
      send({ type: 'player', player: playerPacket() });
    }
    if (NET.host) {
      NET.worldTimer -= dt;
      if (NET.worldTimer <= 0) {
        NET.worldTimer = 0.25;
        sendWorld('tick');
      }
    }
  }

  function closestTarget(localPlayer) {
    const local = { x: localPlayer.x, y: localPlayer.y, remote: false };
    if (!connected() || NET.remote.mode !== 'play' || NET.remote.hidden || NET.remote.dead) return local;
    const ghost = NET.ctx && NET.ctx.GHOST;
    if (!ghost) return local;
    const localDistance = Math.hypot(local.x - ghost.x, local.y - ghost.y);
    const remoteDistance = Math.hypot(NET.remote.x - ghost.x, NET.remote.y - ghost.y);
    return remoteDistance + 0.12 < localDistance
      ? { x: NET.remote.x, y: NET.remote.y, remote: true }
      : local;
  }

  function catchRemote() {
    send({ type: 'caught' });
    NET.remote.dead = true;
    NET.remote.mode = 'end';
    showHint(`${NET.remote.name} 被她追上了`, true);
  }

  function makeNameTexture(THREE, name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 256, 64);
    context.font = '500 28px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(5,8,7,.72)';
    context.fillRect(36, 8, 184, 48);
    context.strokeStyle = 'rgba(143,179,160,.6)';
    context.strokeRect(36.5, 8.5, 183, 47);
    context.fillStyle = '#d9d4c7';
    context.fillText(safeText(name, '队友').slice(0, 10), 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function bindThree(scene, THREE) {
    if (!scene || !THREE || NET.three) return;
    const group = new THREE.Group();
    const coat = new THREE.MeshPhongMaterial({ color: 0x526e61, emissive: 0x101c17, shininess: 7 });
    const skin = new THREE.MeshPhongMaterial({ color: 0xb9ad9c, emissive: 0x181410, shininess: 4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.56, 10), coat);
    body.position.y = 0.33;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), skin);
    head.position.y = 0.72;
    const lamp = new THREE.PointLight(0xb8d6c7, 0.55, 2.8, 1.8);
    lamp.position.set(0, 0.58, -0.2);
    const labelMaterial = new THREE.SpriteMaterial({ map: makeNameTexture(THREE, NET.remote.name), transparent: true, depthWrite: false });
    const label = new THREE.Sprite(labelMaterial);
    label.position.y = 1.04;
    label.scale.set(0.82, 0.2, 1);
    group.add(body, head, lamp, label);
    group.visible = false;
    scene.add(group);
    NET.three = { THREE, group, label, name: NET.remote.name };
  }

  function updateThreeName() {
    const view = NET.three;
    if (!view || view.name === NET.remote.name) return;
    const old = view.label.material.map;
    view.label.material.map = makeNameTexture(view.THREE, NET.remote.name);
    view.label.material.needsUpdate = true;
    view.name = NET.remote.name;
    if (old) old.dispose();
  }

  function updateThree() {
    const view = NET.three;
    if (!view || !NET.ctx) return;
    view.group.visible = connected()
      && NET.ctx.S.mode === 'play'
      && NET.remote.mode === 'play'
      && !NET.remote.hidden
      && !NET.remote.dead;
    if (!view.group.visible) return;
    view.group.position.set(NET.remote.x, 0, NET.remote.y);
    view.group.rotation.y = -NET.remote.a - Math.PI / 2;
  }

  function remoteSprite() {
    if (!connected() || !NET.ctx || NET.ctx.S.mode !== 'play' || NET.remote.mode !== 'play' || NET.remote.hidden || NET.remote.dead) return null;
    return { player: true, x: NET.remote.x, y: NET.remote.y, a: NET.remote.a, name: NET.remote.name };
  }

  function drawCanvasPlayer(context, sx, base, size, object) {
    context.save();
    context.translate(sx, base);
    context.shadowColor = 'rgba(143,179,160,.55)';
    context.shadowBlur = Math.max(5, size * 0.08);
    context.fillStyle = '#526e61';
    context.beginPath();
    context.moveTo(-size * 0.17, 0);
    context.lineTo(-size * 0.12, -size * 0.56);
    context.quadraticCurveTo(0, -size * 0.68, size * 0.12, -size * 0.56);
    context.lineTo(size * 0.17, 0);
    context.closePath();
    context.fill();
    context.fillStyle = '#b9ad9c';
    context.beginPath();
    context.arc(0, -size * 0.72, size * 0.105, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 4;
    context.font = `500 ${Math.max(10, size * 0.12)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillStyle = '#d9d4c7';
    context.fillText(safeText(object.name, '队友'), 0, -size * 0.88);
    context.restore();
  }

  function init(context) {
    NET.ctx = context;
    try {
      const saved = safeText(localStorage.getItem('d13_online_name'));
      if (saved && el('onlineName')) el('onlineName').value = saved.slice(0, 10);
    } catch (error) {}

    el('onlineBtn').addEventListener('click', () => showPanel(true));
    el('onlineClose').addEventListener('click', () => showPanel(false));
    el('netBadge').addEventListener('click', () => showPanel(true));
    el('createRoomBtn').addEventListener('click', createRoom);
    el('joinRoomBtn').addEventListener('click', joinRoom);
    el('copyRoomBtn').addEventListener('click', copyRoomCode);
    el('onlineLeaveBtn').addEventListener('click', () => disconnect(true));
    el('onlineStartBtn').addEventListener('click', startOnlineGame);
    el('joinCode').addEventListener('input', event => {
      event.target.value = safeText(event.target.value).toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 6);
    });
    addEventListener('beforeunload', () => disconnect(false));
  }

  window.MULTI = {
    init,
    update,
    bindThree,
    remoteSprite,
    drawCanvasPlayer,
    worldChanged,
    isConnected: connected,
    hasSession: () => NET.active,
    isAuthority: () => !connected() || NET.host,
    closestTarget,
    catchRemote,
    remoteName: () => NET.remote.name,
    showPanel
  };
})();
