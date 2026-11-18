'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const publicDir = path.join(__dirname, 'public');
app.disable('x-powered-by');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const peers = new Map();
let nextId = 1;
let worldSeed = makeSeed();
let sharedBody = null;
const sharedAlmondPicked = new Set();
const sharedTorchPicked = new Set();
const sharedWorld = { blackout: null, chair: null, party: null, monster: null };
const sharedBalloonPopped = new Map();
// Player corpses remain in the current world after their owners respawn.
const sharedCorpses = new Map();
const MAX_SHARED_CORPSES = 5000;
const BLACKOUT_MAX_MS = 10000;

function broadcastWorldEnd(kind, from) {
  const ended = { t: 'w', kind, active: 0, from };
  for (const peer of peers.values()) send(peer.ws, ended);
}

// A dropped/stalled browser must never leave a shared blackout active forever.
function sweepWorldEvents() {
  const now = Date.now();
  const blackout = sharedWorld.blackout;
  if (blackout && (now >= blackout.expiresAt || now - (blackout.updatedAt || blackout.at || now) > 3500)) {
    sharedWorld.blackout = null;
    broadcastWorldEnd('blackout', blackout.from);
  }
  if (sharedBody && sharedBody.active && now - (sharedBody.seen || now) > 3500) {
    const ended = { t: 'b', active: 0, from: sharedBody.from };
    sharedBody = null;
    for (const peer of peers.values()) send(peer.ws, ended);
  }
  const party = sharedWorld.party;
  if (party && party.active && now - (party.updatedAt || party.at || now) > 3500) {
    sharedWorld.party = null;
    broadcastWorldEnd('party', party.from);
  }
  const monster = sharedWorld.monster;
  if (monster && monster.active && now - (monster.updatedAt || monster.at || now) > 3500) {
    sharedWorld.monster = null;
    broadcastWorldEnd('monster', monster.from);
  }
  const chair = sharedWorld.chair;
  if (chair && chair.bo && now - (chair.updatedAt || chair.at || now) > 2500) {
    chair.bo = 0; chair.tg = 1; chair.red = 0;
    if (chair.phase === 'dark') chair.phase = 'return';
    chair.remaining = 0; chair.at = now; chair.updatedAt = now;
    for (const peer of peers.values()) send(peer.ws, chair);
  }
}

const worldSweepTimer = setInterval(sweepWorldEvents, 500);
if (typeof worldSweepTimer.unref === 'function') worldSweepTimer.unref();

function makeSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function playerSnapshot(exceptId) {
  const players = [];
  for (const [id, peer] of peers) {
    if (id === exceptId || !peer.state || peer.state.d) continue;
    players.push({ t: 's', id, ...peer.state });
  }
  return players;
}

function nearestLivePlayer(fromX, fromZ, exceptId) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const [id, peer] of peers) {
    if (id === exceptId || !peer.state || peer.state.d) continue;
    const dx = peer.state.x - fromX;
    const dz = peer.state.z - fromZ;
    const distance = dx * dx + dz * dz;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = { id, ...peer.state };
    }
  }
  return nearest;
}

wss.on('connection', (ws) => {
  sweepWorldEvents();
  const id = nextId++;
  const peer = { ws, state: null, corpseSeq: 0, lastNormalSoundAt: 0, lastMonsterSoundAt: { body: 0, balloon: 0 } };
  peers.set(id, peer);

  // Send the shared maze seed and the live players already in the session.
  send(ws, { t: 'i', id, seed: worldSeed, serverNow: Date.now(), players: playerSnapshot(id), corpses: Array.from(sharedCorpses.values()), body: sharedBody && sharedBody.active ? sharedBody : null, almondPicked: Array.from(sharedAlmondPicked), world: { blackout: sharedWorld.blackout, chair: sharedWorld.chair, party: sharedWorld.party, monster: sharedWorld.monster }, balloonPopped: Array.from(sharedBalloonPopped.values()), torchPicked: Array.from(sharedTorchPicked) });

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (_error) {
      return;
    }
    if (!data || typeof data !== 'object') return;
    sweepWorldEvents();

    if (data.t === 's') {
      const state = {
        x: cleanNumber(data.x),
        z: cleanNumber(data.z),
        y: cleanNumber(data.y),
        m: data.m ? 1 : 0,
        s: data.s ? 1 : 0,
        d: data.d ? 1 : 0,
      };
      const previous = peer.state;
      peer.state = state;
      const update = { t: 's', id, ...state };
      for (const [otherId, other] of peers) {
        if (otherId !== id) send(other.ws, update);
      }
      // A death creates a separate, permanent corpse object. The live player
      // avatar can stand up again on respawn without replacing this body.
      if (state.d && (!previous || !previous.d)) {
        const corpse = {
          t: 'c', key: `${id}:${++peer.corpseSeq}`, owner: id,
          x: state.x, z: state.z, yaw: state.y, at: Date.now()
        };
        sharedCorpses.set(corpse.key, corpse);
        while (sharedCorpses.size > MAX_SHARED_CORPSES) {
          sharedCorpses.delete(sharedCorpses.keys().next().value);
        }
        for (const recipient of peers.values()) send(recipient.ws, corpse);
      }
      return;
    }

    // A single client owns each Skin Stealer encounter. The server relays its
    // authoritative snapshots to everyone else and supplies the latest state
    // to players who join mid-encounter.
    if (data.t === 'b') {
      const active = data.active ? 1 : 0;
      if (active) {
        if (sharedBody && sharedBody.active && sharedBody.from !== id) {
          send(ws, { t: 'bx', denied: 1 });
          return;
        }
        const allowedStates = new Set(['pending', 'disguise', 'lurk', 'chase']);
        sharedBody = {
          t: 'b', active: 1, from: id,
          state: allowedStates.has(data.state) ? data.state : 'pending',
          x: cleanNumber(data.x), z: cleanNumber(data.z), yaw: cleanNumber(data.yaw),
          spd: Math.max(0, Math.min(12, cleanNumber(data.spd))),
          rx: cleanNumber(data.rx), rz: cleanNumber(data.rz),
          hidden: data.hidden ? 1 : 0, seen: Date.now()
        };
        for (const [otherId, other] of peers) {
          if (otherId !== id) send(other.ws, sharedBody);
        }
      } else if (sharedBody && sharedBody.active && sharedBody.from === id) {
        const ended = { t: 'b', active: 0, from: id };
        sharedBody = null;
        for (const [otherId, other] of peers) {
          if (otherId !== id) send(other.ws, ended);
        }
      }
      return;
    }

    // Almond Water bottles are shared world pickups: once one player takes a
    // bottle, every connected player (and late joiners) sees it as collected.
    if (data.t === 'a' && typeof data.key === 'string') {
      const key = data.key.slice(0, 128);
      if (!key || sharedAlmondPicked.has(key)) return;
      sharedAlmondPicked.add(key);
      const update = { t: 'a', key };
      for (const other of peers.values()) send(other.ws, update);
      return;
    }

    // Torch pickups are world objects shared by every player. Once one player
    // collects a fallen-hazmat torch, it disappears for everyone and late joiners.
    if (data.t === 'tp' && typeof data.key === 'string') {
      const key = data.key.slice(0, 128);
      if (!key || sharedTorchPicked.has(key)) return;
      sharedTorchPicked.add(key);
      const update = { t: 'tp', key };
      for (const [otherId, other] of peers) {
        if (otherId !== id) send(other.ws, update);
      }
      return;
    }

    // Shared environmental events. The initiating client owns the simulation
    // and sends compact snapshots; every other client renders the same event.
    if (data.t === 'w' && typeof data.kind === 'string') {
      const kind = data.kind;
      if (kind === 'balloon-pop') {
        if (typeof data.key !== 'string') return;
        const key = data.key.slice(0, 128);
        if (!key || sharedBalloonPopped.has(key)) return;
        const popped = {
          key,
          x: cleanNumber(data.x),
          y: cleanNumber(data.y, 2),
          z: cleanNumber(data.z)
        };
        sharedBalloonPopped.set(key, popped);
        const update = { t: 'w', kind, ...popped };
        for (const other of peers.values()) send(other.ws, update);
        return;
      }

      if (!['blackout', 'chair', 'party', 'monster'].includes(kind)) return;
      const active = data.active ? 1 : 0;
      const current = sharedWorld[kind];
      const firstMonsterClaim = kind === 'monster' && !(current && current.active && current.from === id);
      if (active) {
        if (current && current.active && current.from !== id) {
          send(ws, { t: 'wd', kind, denied: 1 });
          return;
        }
        // Normal blackouts and the chair's red/dark sequence cannot overlap.
        if (kind === 'blackout' && sharedWorld.chair && sharedWorld.chair.active && sharedWorld.chair.phase !== 'idle') {
          send(ws, { t: 'wd', kind, denied: 1 });
          return;
        }
        if (kind === 'chair' && sharedWorld.blackout && sharedWorld.blackout.active) {
          send(ws, { t: 'wd', kind, denied: 1 });
          return;
        }
        const now = Date.now();
        const startedAt = kind === 'blackout'
          ? (current && current.active && current.from === id && current.startedAt ? current.startedAt : now)
          : now;
        if (kind === 'blackout' && now >= startedAt + BLACKOUT_MAX_MS) {
          sharedWorld.blackout = null;
          broadcastWorldEnd('blackout', id);
          send(ws, { t: 'wd', kind, denied: 1 });
          return;
        }
        const base = { t: 'w', kind, active: 1, from: id, at: now, updatedAt: now,
          ...(kind === 'blackout' ? { startedAt, expiresAt: startedAt + BLACKOUT_MAX_MS } : {}) };
        let snapshot;
        if (kind === 'blackout') {
          const phases = new Set(['dark', 'flicker', 'prelight']);
          snapshot = {
            ...base,
            phase: phases.has(data.phase) ? data.phase : 'dark',
            remaining: Math.max(0, Math.min(20, cleanNumber(data.remaining))),
            bo: data.bo ? 1 : 0,
            tg: Math.max(0, Math.min(1, cleanNumber(data.tg, 0.085))),
            red: Math.max(0, Math.min(1, cleanNumber(data.red)))
          };
        } else if (kind === 'chair') {
          const phases = new Set(['red', 'dark', 'return', 'idle']);
          snapshot = {
            ...base,
            phase: phases.has(data.phase) ? data.phase : 'red',
            remaining: Math.max(0, Math.min(10, cleanNumber(data.remaining))),
            x: cleanNumber(data.x), z: cleanNumber(data.z), yaw: cleanNumber(data.yaw),
            rx: cleanNumber(data.rx), rz: cleanNumber(data.rz),
            cx: cleanNumber(data.cx), cz: cleanNumber(data.cz),
            visible: data.visible ? 1 : 0,
            spd: Math.max(0, Math.min(20, cleanNumber(data.spd))),
            bo: data.bo ? 1 : 0,
            tg: Math.max(0, Math.min(1, cleanNumber(data.tg, 1))),
            red: Math.max(0, Math.min(1, cleanNumber(data.red, 1)))
          };
        } else if (kind === 'party') {
          const states = new Set(['pending', 'lurk', 'chase']);
          snapshot = {
            ...base,
            state: states.has(data.state) ? data.state : 'pending',
            x: cleanNumber(data.x), z: cleanNumber(data.z), yaw: cleanNumber(data.yaw),
            rx: cleanNumber(data.rx), rz: cleanNumber(data.rz),
            spd: Math.max(0, Math.min(12, cleanNumber(data.spd))),
            visible: data.visible ? 1 : 0
          };
        } else {
          const states = new Set(['wander', 'chase', 'search', 'lost', 'dormant']);
          snapshot = {
            ...base,
            state: states.has(data.state) ? data.state : 'chase',
            x: cleanNumber(data.x), z: cleanNumber(data.z), yaw: cleanNumber(data.yaw),
            y: cleanNumber(data.y), rx: cleanNumber(data.rx), rz: cleanNumber(data.rz),
            spd: Math.max(0, Math.min(20, cleanNumber(data.spd))),
            visible: data.visible ? 1 : 0
          };
        }
        sharedWorld[kind] = snapshot;
        for (const [otherId, other] of peers) {
          if (otherId !== id) send(other.ws, snapshot);
        }
        if (firstMonsterClaim) send(ws, { t: 'wg', kind: 'monster', granted: 1, from: id });
      } else if (current && current.active && current.from === id) {
        sharedWorld[kind] = null;
        const ended = { t: 'w', kind, active: 0, from: id };
        for (const [otherId, other] of peers) {
          if (otherId !== id) send(other.ws, ended);
        }
        if (kind === 'monster') send(ws, { t: 'wg', kind: 'monster', granted: 0, from: id });
      }
      return;
    }

    // Relay time-stamped normal-monster audio snippets to every connected
    // player, including the sender. A short future start time lets all clients
    // schedule the same sample offset together despite network jitter.
    if (data.t === 'ms') {
      const now = Date.now();
      if (now - peer.lastNormalSoundAt < 450) return;
      peer.lastNormalSoundAt = now;
      const duration = Math.max(0.55, Math.min(2.2, cleanNumber(data.duration, 1.5)));
      const packet = {
        t: 'ms', from: id,
        x: cleanNumber(data.x), z: cleanNumber(data.z),
        offset: Math.max(0, Math.min(54.6, cleanNumber(data.offset))),
        duration, at: now + 450
      };
      for (const recipient of peers.values()) send(recipient.ws, packet);
      return;
    }

    // Relay body/balloon monster sound snippets to every connected player.
    // The future timestamp compensates for network jitter so all clients start together.
    if (data.t === 'xs') {
      const kind = data.kind;
      if (kind !== 'body' && kind !== 'balloon') return;
      const now = Date.now();
      if (now - (peer.lastMonsterSoundAt[kind] || 0) < 450) return;
      peer.lastMonsterSoundAt[kind] = now;
      const packet = {
        t: 'xs', kind, from: id,
        x: cleanNumber(data.x), z: cleanNumber(data.z),
        offset: Math.max(0, Math.min(68, cleanNumber(data.offset))),
        duration: Math.max(0.55, Math.min(1.5, cleanNumber(data.duration, 1.1))),
        at: now + 450
      };
      for (const recipient of peers.values()) send(recipient.ws, packet);
      return;
    }

    // Relay gameplay events (for example, a player stepping on a corpse).
    if (data.t === 'e' && typeof data.event === 'string') {
      const event = {
        t: 'e', event: data.event.slice(0, 32), from: id,
        x: cleanNumber(data.x), z: cleanNumber(data.z), at: Date.now()
      };
      for (const [otherId, other] of peers) {
        if (otherId !== id) send(other.ws, event);
      }
      return;
    }

    if (data.t === 'r') {
      // Use the player's current/death location as the reference point and
      // select whichever other living player is nearest to it.
      const fromX = cleanNumber(data.x, 33);
      const fromZ = cleanNumber(data.z, 33);
      const target = nearestLivePlayer(fromX, fromZ, id);
      if (target) {
        send(ws, { t: 'p', near: true, id: target.id, x: target.x, z: target.z, y: target.y });
      } else {
        // First player in a session: retain the game's normal solo spawn.
        send(ws, { t: 'p', near: false, x: fromX, z: fromZ, y: cleanNumber(data.y) });
      }
    }
  });

  ws.on('close', () => {
    peers.delete(id);
    const update = { t: 'l', id };
    for (const other of peers.values()) send(other.ws, update);
    if (sharedBody && sharedBody.from === id) {
      sharedBody = null;
      const ended = { t: 'b', active: 0, from: id };
      for (const other of peers.values()) send(other.ws, ended);
    }
    for (const kind of ['blackout', 'chair', 'party', 'monster']) {
      if (sharedWorld[kind] && sharedWorld[kind].from === id) {
        sharedWorld[kind] = null;
        const ended = { t: 'w', kind, active: 0, from: id };
        for (const other of peers.values()) send(other.ws, ended);
      }
    }
    if (peers.size === 0) {
      worldSeed = makeSeed();
      sharedAlmondPicked.clear();
      sharedTorchPicked.clear();
      sharedBalloonPopped.clear();
      sharedWorld.blackout = sharedWorld.chair = sharedWorld.party = sharedWorld.monster = null;
      sharedCorpses.clear();
    }
  });

  ws.on('error', () => {
    // The close handler removes the peer and notifies the remaining players.
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Backrooms multiplayer server listening on 0.0.0.0:${port}`);
});
