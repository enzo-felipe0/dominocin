// Servidor HTTP + WebSocket do jogo de dominó.
// Serve os arquivos de public/ e mantém as salas em memória.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocketServer } from './src/ws.js';
import {
  createGame, playTile, drawTile, passTurn, viewFor,
  MIN_PLAYERS, MAX_PLAYERS, legalPlacements,
} from './src/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const rooms = new Map(); // code -> room

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sanitizeName(raw) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  return name || 'Jogador';
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.game ? room.game.status : 'lobby',
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS,
  };
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.connected || !p.client) continue;
    p.client.send({ type: 'state', room: publicRoom(room), game: room.game ? viewFor(room.game, p.seat) : null });
  }
}

function sendTo(player, msg) {
  if (player.connected && player.client) player.client.send(msg);
}

function errorTo(player, message) {
  sendTo(player, { type: 'error', message });
}

function findPlayerByToken(room, token) {
  return room.players.find((p) => p.token === token);
}

function nextSeat(room) {
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    if (!room.players.some((p) => p.seat === seat)) return seat;
  }
  return -1;
}

function startGame(room) {
  if (room.players.length < MIN_PLAYERS) {
    throw new Error(`São necessários ao menos ${MIN_PLAYERS} jogadores.`);
  }
  if (room.players.length > MAX_PLAYERS) throw new Error('Mesa cheia.');
  // Ordena os jogadores por assento para que o índice da mão case com a ordem.
  room.players.sort((a, b) => a.seat - b.seat);
  room.players.forEach((p, i) => { p.seat = i; });
  room.game = createGame(room.players.map((p) => p.name));
  broadcast(room);
}

function handleMessage(player, raw) {
  const room = player.room;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return errorTo(player, 'Mensagem inválida.');
  }
  if (!msg || typeof msg.type !== 'string') return errorTo(player, 'Mensagem inválida.');

  switch (msg.type) {
    case 'ping':
      sendTo(player, { type: 'pong' });
      return;

    case 'start': {
      if (room.hostId !== player.id) return errorTo(player, 'Só o anfitrião pode iniciar a partida.');
      if (room.game && room.game.status === 'playing') return errorTo(player, 'A partida já está em andamento.');
      try {
        startGame(room);
      } catch (err) {
        errorTo(player, err.message);
      }
      return;
    }

    case 'play': {
      if (!room.game) return errorTo(player, 'A partida ainda não começou.');
      const tile = Array.isArray(msg.tile) ? [Number(msg.tile[0]), Number(msg.tile[1])] : null;
      if (!tile || tile.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) {
        return errorTo(player, 'Peça inválida.');
      }
      const side = msg.side === 'left' ? 'left' : 'right';
      try {
        // Se o cliente não escolheu o lado, deduz pela única jogada legal.
        const placements = legalPlacements(room.game, tile);
        const chosen = placements.length === 1 ? placements[0].side : side;
        playTile(room.game, player.seat, tile, chosen);
        broadcast(room);
      } catch (err) {
        errorTo(player, err.message);
      }
      return;
    }

    case 'draw': {
      if (!room.game) return errorTo(player, 'A partida ainda não começou.');
      const index = Number.isInteger(msg.index) ? msg.index : 0;
      try {
        drawTile(room.game, player.seat, index);
        broadcast(room);
      } catch (err) {
        errorTo(player, err.message);
      }
      return;
    }

    case 'pass': {
      if (!room.game) return errorTo(player, 'A partida ainda não começou.');
      try {
        passTurn(room.game, player.seat);
        broadcast(room);
      } catch (err) {
        errorTo(player, err.message);
      }
      return;
    }

    case 'chat': {
      const text = String(msg.text ?? '').slice(0, 200).trim();
      if (!text) return;
      const out = { type: 'chat', from: player.name, text, at: Date.now() };
      for (const p of room.players) if (p.connected) sendTo(p, out);
      return;
    }

    case 'leave':
      leaveRoom(player);
      sendTo(player, { type: 'left' });
      return;

    default:
      return errorTo(player, 'Ação desconhecida.');
  }
}

function leaveRoom(player) {
  const room = player.room;
  if (!room) return;
  const wasPlaying = room.game && room.game.status === 'playing';
  room.players = room.players.filter((p) => p !== player);
  player.room = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  // Abandono no meio da partida: encerra e volta para a sala de espera, para
  // não deixar mãos/índices inconsistentes.
  if (wasPlaying) {
    room.game = null;
    for (const p of room.players) {
      if (p.connected) sendTo(p, { type: 'chat', from: 'Sistema', text: `${player.name} saiu da mesa. A partida foi encerrada.`, at: Date.now() });
    }
  }
  if (room.hostId === player.id) {
    const nextHost = room.players.find((p) => p.connected) || room.players[0];
    room.hostId = nextHost.id;
  }
  // Reindexa assentos para manter os índices consistentes.
  room.players.sort((a, b) => a.seat - b.seat);
  room.players.forEach((p, i) => { p.seat = i; });
  broadcast(room);
}

function joinRoom(client, msg) {
  const name = sanitizeName(msg.name);
  const requested = String(msg.room ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  let room;

  if (requested) {
    room = rooms.get(requested);
    if (!room) {
      client.send({ type: 'error', message: `Sala ${requested} não encontrada.` });
      return;
    }
  } else {
    const code = makeRoomCode();
    room = { code, hostId: null, players: [], game: null, createdAt: Date.now() };
    rooms.set(code, room);
  }

  const seat = nextSeat(room);
  if (seat === -1) {
    client.send({ type: 'error', message: 'A mesa está cheia (4 jogadores).' });
    return;
  }
  if (room.game && room.game.status === 'playing') {
    client.send({ type: 'error', message: 'A partida já está em andamento nessa sala.' });
    return;
  }

  const chave = newKey();
  const player = {
    id: chave.slice(0, 8),
    token: chave,
    name,
    seat,
    connected: true,
    client,
    room,
  };
  room.players.push(player);
  if (!room.hostId) room.hostId = player.id;
  client.player = player;

  client.send({ type: 'joined', code: room.code, token: chave, playerId: player.id, name });
  broadcast(room);
}

function newKey() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
    return;
  }
  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([...rooms.values()].map(publicRoom)));
    return;
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

attachWebSocketServer(server, (client) => {
  client.onmessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'join') {
      if (client.player) return;
      joinRoom(client, msg);
      return;
    }
    if (!client.player) {
      client.send({ type: 'error', message: 'Entre em uma sala primeiro.' });
      return;
    }
    handleMessage(client.player, raw);
  };

  client.onclose = () => {
    const player = client.player;
    if (!player) return;
    player.connected = false;
    player.client = null;
    // Sem reconexão: remove o jogador da sala.
    leaveRoom(player);
  };
});

server.listen(PORT, HOST, () => {
  console.log(`Dominó rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Acesse pelo IP da máquina na rede local, ex.: http://192.168.0.10:${PORT}`);
});
