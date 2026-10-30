// Teste ponta a ponta: sobe o servidor de verdade e joga uma partida completa
// com 4 clientes WebSocket reais.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// O cliente WebSocket global só existe a partir do Node 22.
const SEM_WS = typeof WebSocket === 'undefined'
  ? 'Node 22+ é necessário para o cliente WebSocket usado neste teste'
  : false;
const ROOT = path.join(__dirname, '..');
const PORT = 3456;

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('servidor não subiu')), 8000);
    child.stdout.on('data', (buf) => {
      if (buf.toString().includes('Dominó rodando')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (b) => process.stderr.write(b));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`servidor saiu com ${code}`)); });
  });
}

class Client {
  constructor(name) {
    this.name = name;
    this.state = null;
    this.room = null;
    this.errors = [];
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'joined') { this.joined = msg; this.room = msg.code; }
      if (msg.type === 'state') { this.state = msg.game; this.roomState = msg.room; }
      if (msg.type === 'error') this.errors.push(msg.message);
      if (this.onMessage) this.onMessage(msg);
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await wait(20);
  }
  throw new Error(`timeout esperando: ${label}`);
}

function legalSides(game, tile) {
  if (!game.ends) return ['right'];
  const [a, b] = tile;
  const sides = [];
  if (a === game.ends.left || b === game.ends.left) sides.push('left');
  if (a === game.ends.right || b === game.ends.right) sides.push('right');
  return sides;
}

test('4 jogadores entram na mesma sala e terminam uma partida', { skip: SEM_WS }, async (t) => {
  const server = await startServer();
  t.after(() => server.kill('SIGKILL'));

  const clients = ['Ana', 'Bruno', 'Carla', 'Davi'].map((n) => new Client(n));
  await Promise.all(clients.map((c) => c.ready));

  // Anfitriã cria a sala.
  clients[0].send({ type: 'join', name: 'Ana', room: '' });
  await waitFor(() => clients[0].joined, 'sala criada');
  const code = clients[0].joined.code;
  assert.match(code, /^[A-Z0-9]{4}$/);

  // Os outros entram pelo código.
  for (let i = 1; i < clients.length; i++) {
    clients[i].send({ type: 'join', name: clients[i].name, room: code });
  }
  await waitFor(() => clients.every((c) => c.room === code), 'todos na sala');
  await waitFor(() => clients[0].roomState?.players.length === 4, '4 jogadores listados');
  assert.equal(clients[0].roomState.players.length, 4);

  // Só o anfitrião pode iniciar: um não-anfitrião tenta e recebe erro.
  clients[1].send({ type: 'start' });
  await waitFor(() => clients[1].errors.length > 0, 'erro para não-anfitrião');
  assert.match(clients[1].errors[0], /anfitrião/);

  // Anfitriã inicia.
  clients[0].send({ type: 'start' });
  await waitFor(() => clients.every((c) => c.state && c.state.status === 'playing'), 'partida iniciada');

  // Cada cliente vê a própria mão e nenhuma outra.
  for (const c of clients) {
    const mine = c.state.players[c.state.you];
    assert.equal(mine.hand.length, 7);
    for (const p of c.state.players) {
      if (p.seat !== c.state.you) assert.equal(p.hand, null, 'mão alheia deve vir nula');
    }
  }

  // Autoplay: cada um joga quando é a sua vez.
  let moves = 0;
  const tick = async () => {
    for (const c of clients) {
      const g = c.state;
      if (!g || g.status !== 'playing' || g.turn !== g.you) continue;
      const hand = g.players[g.you].hand;
      if (!g.canPlay) {
        if (g.stockCount > 0) { c.send({ type: 'draw', index: 0 }); moves++; }
        else { c.send({ type: 'pass' }); moves++; }
        await wait(15);
        continue;
      }
      const choice = hand
        .map((tile) => ({ tile, sides: legalSides(g, tile) }))
        .find((x) => x.sides.length > 0);
      assert.ok(choice, 'se canPlay é true, alguma peça precisa encaixar');
      c.send({ type: 'play', tile: choice.tile, side: choice.sides[0] });
      moves++;
      await wait(15);
    }
  };

  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (clients.every((c) => c.state?.status === 'finished')) break;
    await tick();
  }

  assert.ok(clients.every((c) => c.state?.status === 'finished'), 'a partida deve terminar');
  assert.ok(moves > 5, `deve haver várias jogadas (foram ${moves})`);

  // Todos os clientes concordam com o resultado e a mesa é consistente.
  const ref = clients[0].state;
  for (const c of clients) {
    assert.equal(c.state.winner, ref.winner);
    assert.equal(c.state.finishReason, ref.finishReason);
    assert.deepEqual(c.state.board, ref.board);
  }

  // A mesa é uma cadeia válida: cada peça encosta na anterior pelo mesmo número.
  for (let i = 1; i < ref.board.length; i++) {
    assert.equal(ref.board[i - 1].right, ref.board[i].left, `encaixe inválido na posição ${i}`);
  }

  // Ninguém ficou com peça a mais que o baralho permite e o monte zerou ou sobrou.
  const totalHands = ref.players.reduce((s, p) => s + p.handCount, 0);
  assert.ok(totalHands + ref.stockCount + ref.board.length === 28, 'as 28 peças devem estar contabilizadas');

  if (ref.finishReason === 'domino') {
    assert.equal(ref.players[ref.winner].handCount, 0);
  }

  for (const c of clients) c.close();
  await wait(100);
});

test('sala inexistente devolve erro', { skip: SEM_WS }, async (t) => {
  const server = await startServer();
  t.after(() => server.kill('SIGKILL'));

  const c = new Client('Zeca');
  await c.ready;
  c.send({ type: 'join', name: 'Zeca', room: 'XXXX' });
  await waitFor(() => c.errors.length > 0, 'erro de sala inexistente');
  assert.match(c.errors[0], /não encontrada/);
  c.close();
  await wait(50);
});

test('2 jogadores compram do monte quando não têm jogada', { skip: SEM_WS }, async (t) => {
  const server = await startServer();
  t.after(() => server.kill('SIGKILL'));

  const clients = [new Client('Um'), new Client('Dois')];
  await Promise.all(clients.map((c) => c.ready));
  clients[0].send({ type: 'join', name: 'Um', room: '' });
  await waitFor(() => clients[0].joined, 'sala criada');
  clients[1].send({ type: 'join', name: 'Dois', room: clients[0].joined.code });
  await waitFor(() => clients.every((c) => c.room), 'dois na sala');
  clients[0].send({ type: 'start' });
  await waitFor(() => clients.every((c) => c.state?.status === 'playing'), 'partida iniciada');

  // Com 2 jogadores sobram 14 peças no monte.
  assert.equal(clients[0].state.stockCount, 14);

  let minStock = 14;
  let draws = 0;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (clients.every((c) => c.state?.status === 'finished')) break;
    for (const c of clients) {
      const g = c.state;
      if (!g || g.status !== 'playing' || g.turn !== g.you) continue;
      minStock = Math.min(minStock, g.stockCount);
      if (!g.canPlay) {
        if (g.stockCount > 0) { c.send({ type: 'draw', index: g.stockCount - 1 }); draws++; }
        else { c.send({ type: 'pass' }); }
      } else {
        const hand = g.players[g.you].hand;
        const choice = hand.map((tile) => ({ tile, sides: legalSides(g, tile) })).find((x) => x.sides.length);
        c.send({ type: 'play', tile: choice.tile, side: choice.sides[0] });
      }
      await wait(15);
    }
  }

  assert.ok(draws > 0, 'alguém precisa ter comprado do monte nesta partida');
  assert.ok(minStock < 14, 'o monte precisa diminuir quando alguém compra');
  assert.ok(clients.every((c) => c.state?.status === 'finished'), 'a partida deve terminar');
  for (const c of clients) {
    assert.equal(c.errors.length, 0, `cliente não deve receber erro: ${c.errors.join(' / ')}`);
    assert.ok(c.state.players.every((p) => p.handCount >= 0));
  }
  const ref = clients[0].state;
  for (let i = 1; i < ref.board.length; i++) {
    assert.equal(ref.board[i - 1].right, ref.board[i].left);
  }
  for (const c of clients) c.close();
  await wait(50);
});
