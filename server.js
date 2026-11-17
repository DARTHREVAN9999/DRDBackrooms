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
  const id = nextId++;
  const peer = { ws, state: null };
  peers.set(id, peer);

  // Send the shared maze seed and the live players already in the session.
  send(ws, { t: 'i', id, seed: worldSeed, players: playerSnapshot(id) });

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (_error) {
      return;
    }
    if (!data || typeof data !== 'object') return;

    if (data.t === 's') {
      const state = {
        x: cleanNumber(data.x),
        z: cleanNumber(data.z),
        y: cleanNumber(data.y),
        m: data.m ? 1 : 0,
        s: data.s ? 1 : 0,
        d: data.d ? 1 : 0,
      };
      peer.state = state;
      const update = { t: 's', id, ...state };
      for (const [otherId, other] of peers) {
        if (otherId !== id) send(other.ws, update);
      }
      return;
    }

    // Relay gameplay events (for example, a player stepping on a corpse)
    // to every connected client. Keep payloads small and validate coordinates.
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
    if (peers.size === 0) worldSeed = makeSeed();
  });

  ws.on('error', () => {
    // The close handler removes the peer and notifies the remaining players.
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Backrooms multiplayer server listening on 0.0.0.0:${port}`);
});
