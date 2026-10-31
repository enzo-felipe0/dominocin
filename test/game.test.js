import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fullDeck, createGame, playTile, drawTile, drawAllStock, passTurn, legalPlacements,
  viewFor, handHasPlayable, pipSum, tileKey, HAND_SIZE,
} from '../src/game.js';

// RNG determinístico para os testes.
function seeded(seed = 1) {
  let x = seed || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

test('baralho tem as 28 peças do duplo-seis, sem repetição', () => {
  const deck = fullDeck();
  assert.equal(deck.length, 28);
  assert.equal(new Set(deck.map(tileKey)).size, 28);
  for (const [a, b] of deck) {
    assert.ok(a >= 0 && a <= 6 && b >= 0 && b <= 6);
    assert.ok(a <= b);
  }
  const doubles = deck.filter(([a, b]) => a === b);
  assert.equal(doubles.length, 7);
});

test('distribuição: 7 peças por jogador e o resto no monte', () => {
  for (const n of [2, 3, 4]) {
    const g = createGame(['a', 'b', 'c', 'd'].slice(0, n), seeded(7));
    assert.equal(g.players.length, n);
    for (const p of g.players) assert.equal(p.hand.length, HAND_SIZE);
    assert.equal(g.stock.length, 28 - n * HAND_SIZE);
    const all = [...g.players.flatMap((p) => p.hand), ...g.stock].map(tileKey);
    assert.equal(new Set(all).size, 28, 'nenhuma peça pode aparecer duas vezes');
  }
});

test('quem tem a maior carroça começa', () => {
  const g = createGame(['a', 'b'], seeded(3));
  const starter = g.players[g.turn];
  const hasDoubleSix = starter.hand.some(([a, b]) => a === 6 && b === 6);
  const anyDoubleSix = g.players.some((p) => p.hand.some(([a, b]) => a === 6 && b === 6));
  if (anyDoubleSix) assert.ok(hasDoubleSix, 'quem tem 6-6 deve começar');
});

test('primeira peça pode ser qualquer uma e define as pontas', () => {
  const g = createGame(['a', 'b'], seeded(11));
  const p = g.players[g.turn];
  const tile = p.hand[0];
  playTile(g, g.turn, tile, 'right');
  assert.deepEqual(g.board[0].left, Math.min(...tile));
  assert.deepEqual(g.board[0].right, Math.max(...tile));
  assert.equal(p.hand.length, HAND_SIZE - 1);
});

test('peça só encaixa se casar com uma das pontas', () => {
  const g = createGame(['a', 'b'], seeded(5));
  g.board = [{ tile: [3, 5], left: 3, right: 5 }];
  assert.deepEqual(legalPlacements(g, [5, 6]).map((p) => p.side), ['right']);
  assert.deepEqual(legalPlacements(g, [2, 3]).map((p) => p.side), ['left']);
  assert.equal(legalPlacements(g, [0, 1]).length, 0);
  assert.equal(legalPlacements(g, [5, 5]).length, 1, 'carroça casa com 5 numa ponta');
});

test('peça virada é encaixada com o número certo para dentro', () => {
  const g = createGame(['a', 'b'], seeded(9));
  g.board = [{ tile: [2, 4], left: 2, right: 4 }];
  // 4-6 jogada na direita deve virar 4|6 (4 encostando na mesa).
  const hand = g.players[g.turn].hand;
  hand.push([4, 6]);
  playTile(g, g.turn, [4, 6], 'right');
  const last = g.board[g.board.length - 1];
  assert.equal(last.left, 4);
  assert.equal(last.right, 6);
  // 1-2 jogada na esquerda deve virar 2|1 (2 encostando na mesa).
  g.turn = 0;
  g.players[0].hand.push([1, 2]);
  playTile(g, 0, [1, 2], 'left');
  assert.equal(g.board[0].left, 1);
  assert.equal(g.board[0].right, 2);
});

test('jogadas ilegais são recusadas com mensagem clara', () => {
  const g = createGame(['a', 'b'], seeded(13));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.players[g.turn].hand = [[5, 6]];
  assert.throws(() => playTile(g, g.turn, [5, 6], 'right'), /não encaixa/);
  // Fora da vez
  const other = (g.turn + 1) % 2;
  g.players[other].hand = [[0, 3]];
  assert.throws(() => playTile(g, other, [0, 3], 'right'), /sua vez/);
  // Peça que não está na mão
  assert.throws(() => playTile(g, g.turn, [0, 3], 'right'), /não tem essa peça/);
});

test('compra obrigatória quando não há jogada e monte não está vazio', () => {
  const g = createGame(['a', 'b'], seeded(17));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.players[g.turn].hand = [[5, 6]];
  g.stock = [[0, 1], [2, 2]];
  assert.equal(handHasPlayable(g, g.turn), false);
  const before = g.players[g.turn].hand.length;
  const drawn = drawTile(g, g.turn);
  assert.ok(drawn);
  assert.equal(g.players[g.turn].hand.length, before + 1);
  assert.equal(g.stock.length, 1);
  // Com peça jogável na mão, não pode comprar.
  g.players[g.turn].hand = [[0, 2]];
  assert.throws(() => drawTile(g, g.turn), /obrigatório jogar/);
});

test('não pode passar com peça jogável nem com monte cheio', () => {
  const g = createGame(['a', 'b'], seeded(19));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.players[g.turn].hand = [[0, 1]];
  g.stock = [[3, 3]];
  assert.throws(() => passTurn(g, g.turn), /obrigatório jogar/);

  g.players[g.turn].hand = [[5, 6]];
  assert.throws(() => passTurn(g, g.turn), /obrigatório comprar/);

  g.stock = [];
  const idx = g.turn;
  passTurn(g, idx);
  assert.equal(g.players[idx].passed, true);
});

test('compra a peça escolhida do monte, na posição clicada', () => {
  const g = createGame(['a', 'b'], seeded(41));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.turn = 0;
  g.players[0].hand = [[5, 6]];
  g.stock = [[0, 1], [2, 3], [4, 5]];

  const drawn = drawTile(g, 0, 1);
  assert.deepEqual(drawn, [2, 3], 'deve sair exatamente a peça da posição escolhida');
  assert.deepEqual(g.stock, [[0, 1], [4, 5]]);
  assert.ok(g.players[0].hand.some((t) => tileKey(t) === '2-3'));

  // Índice fora do monte não consome peça nenhuma.
  const antes = g.stock.length;
  assert.throws(() => drawTile(g, 0, 99), /peça válida/);
  assert.throws(() => drawTile(g, 0, -1), /peça válida/);
  assert.equal(g.stock.length, antes);
});

test('jogo fechado: vence quem tem a menor soma na mão', () => {
  const g = createGame(['a', 'b'], seeded(23));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.stock = [];
  g.turn = 0;
  g.players[0].hand = [[5, 6]]; // 11 pontos
  g.players[1].hand = [[1, 2]]; // 3 pontos
  passTurn(g, 0); // 'b' também não joga e é passado automaticamente -> fecha
  assert.equal(g.status, 'finished');
  assert.equal(g.winner, 1);
  assert.equal(g.finishReason, 'blocked');
});

test('bater (ficar sem peças) encerra a partida', () => {
  const g = createGame(['a', 'b'], seeded(29));
  g.board = [{ tile: [2, 2], left: 2, right: 2 }];
  g.turn = 0;
  g.players[0].hand = [[2, 5]];
  g.players[1].hand = [[1, 1], [3, 4]];
  playTile(g, 0, [2, 5], 'right');
  assert.equal(g.status, 'finished');
  assert.equal(g.winner, 0);
  assert.equal(g.finishReason, 'domino');
});

test('passar não trava a vez de quem ainda pode jogar', () => {
  const g = createGame(['a', 'b', 'c'], seeded(31));
  g.board = [{ tile: [1, 1], left: 1, right: 1 }];
  g.stock = [];
  g.turn = 0;
  g.players[0].hand = [[5, 6]]; // não joga
  g.players[1].hand = [[1, 4], [4, 4]]; // joga
  g.players[2].hand = [[6, 6]];
  passTurn(g, 0);
  assert.equal(g.turn, 1);
  playTile(g, 1, [1, 4], 'right');
  // Com monte vazio, quem não tem jogada é passado automaticamente até sobrar
  // quem pode jogar — aqui só 'b' encaixa [4,4], então a vez volta para ele (geral).
  assert.equal(g.turn, 1);
  assert.equal(g.lastEvent.type, 'geral');
  assert.deepEqual(g.players.map((p) => p.passed), [true, false, true]);
});

test('geral: jogada que obriga todos a passar devolve a vez a quem jogou', () => {
  const g = createGame(['a', 'b'], seeded(43));
  g.board = [{ tile: [3, 3], left: 3, right: 3 }];
  g.stock = [];
  g.turn = 0;
  g.players[0].hand = [[3, 5], [5, 5]]; // joga [3,5] e sobra [5,5]
  g.players[1].hand = [[0, 1]];         // nunca encaixa
  playTile(g, 0, [3, 5], 'right');      // pontas viram 3 e 5
  assert.equal(g.turn, 0, 'a vez volta para quem trancou');
  assert.equal(g.lastEvent.type, 'geral');
});

test('comprar o monte inteiro só quando nada ali encaixa', () => {
  const g = createGame(['a', 'b'], seeded(47));
  g.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g.turn = 0;
  g.players[0].hand = [[5, 6]];
  g.players[1].hand = [[1, 2]];
  // Monte com peças que não encaixam no 0: comprar tudo de uma vez.
  g.stock = [[3, 4], [5, 5], [2, 6]];
  const n = drawAllStock(g, 0);
  assert.equal(n, 3);
  assert.equal(g.stock.length, 0);
  assert.equal(g.players[0].hand.length, 4);

  // Se houver peça comprável que encaixa, não deixa comprar tudo.
  const g2 = createGame(['a', 'b'], seeded(51));
  g2.board = [{ tile: [0, 0], left: 0, right: 0 }];
  g2.turn = 0;
  g2.players[0].hand = [[5, 6]];
  g2.stock = [[0, 4]]; // encaixa no 0
  assert.throws(() => drawAllStock(g2, 0), /uma de cada vez/);
});

test('o estado enviado esconde a mão dos outros jogadores', () => {
  const g = createGame(['a', 'b'], seeded(37));
  const view = viewFor(g, 0);
  assert.equal(view.players[0].hand.length, HAND_SIZE);
  assert.equal(view.players[1].hand, null);
  assert.equal(view.players[1].handCount, HAND_SIZE);
  assert.equal(view.stockCount, g.stock.length);
  assert.equal(view.you, 0);
});

test('soma de pontos da mão', () => {
  assert.equal(pipSum([6, 6]), 12);
  assert.equal(pipSum([0, 1]), 1);
});
