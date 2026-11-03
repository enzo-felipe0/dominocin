// Regras do dominó (variante brasileira, 28 peças, 2 a 4 jogadores).
// Módulo puro: não conhece rede nem HTTP. Toda a validação de jogada vive aqui.

export const MAX_PIPS = 6;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
export const HAND_SIZE = 7;

/** Todas as 28 peças do jogo duplo-seis, como [a, b] com a <= b. */
export function fullDeck() {
  const deck = [];
  for (let a = 0; a <= MAX_PIPS; a++) {
    for (let b = a; b <= MAX_PIPS; b++) deck.push([a, b]);
  }
  return deck;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sameTile = (t, u) => t[0] === u[0] && t[1] === u[1];
export const tileKey = (t) => `${t[0]}-${t[1]}`;
export const isDouble = (t) => t[0] === t[1];
export const pipSum = (t) => t[0] + t[1];

/**
 * Cria o estado de uma partida.
 * @param {string[]} playerIds ids na ordem de assento (a ordem define quem começa)
 * @param {() => number} rng
 * @param {{starterSeat?: number, preferDoubleSix?: boolean}} [options]
 *   starterSeat: força quem começa (ex.: o vencedor da partida anterior).
 *   preferDoubleSix: na primeira partida, abre quem tem a carroça de seis.
 */
export function createGame(playerIds, rng = Math.random, options = {}) {
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new Error(`Número de jogadores inválido: ${playerIds.length}`);
  }
  const deck = shuffle(fullDeck(), rng);
  const hands = playerIds.map(() => []);
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const hand of hands) hand.push(deck.pop());
  }
  // Ordena a mão de cada jogador para exibição estável.
  for (const hand of hands) hand.sort((x, y) => pipSum(x) - pipSum(y) || x[0] - y[0]);

  const game = {
    players: playerIds.map((id, seat) => ({ id, seat, hand: hands[seat], passed: false })),
    board: [],          // [{ tile:[a,b], left:number, right:number }]
    stock: deck,        // peças ainda não compradas
    turn: 0,            // índice do jogador da vez
    status: 'playing',  // 'playing' | 'finished'
    winner: null,       // índice do vencedor (ou null em empate)
    finishReason: null, // 'domino' | 'blocked' | 'empty-stock'
    log: [],
    eventSeq: 0,        // contador para o cliente deduplicar efeitos (sons)
    lastEvent: null,    // { seq, type, seat?, ... } último evento para o cliente
    startedAt: Date.now(),
  };

  game.turn = chooseStarter(game, options);
  pushLog(game, `Partida iniciada com ${playerIds.length} jogadores.`);
  return game;
}

/** Decide quem abre a partida conforme as opções e as regras da casa. */
function chooseStarter(game, options) {
  // Vencedor da partida anterior começa a próxima.
  if (Number.isInteger(options.starterSeat)
    && options.starterSeat >= 0
    && options.starterSeat < game.players.length) {
    return options.starterSeat;
  }
  // Primeira partida: abre quem tem a carroça de seis [6|6].
  if (options.preferDoubleSix) {
    const seat = game.players.findIndex((p) => p.hand.some((t) => t[0] === 6 && t[1] === 6));
    if (seat >= 0) return seat;
  }
  // Sem referência: maior carroça; empate -> maior peça; senão assento 0.
  let starter = 0;
  let best = -1;
  game.players.forEach((p, i) => {
    for (const t of p.hand) {
      const score = isDouble(t) ? 100 + t[0] : pipSum(t);
      if (score > best) { best = score; starter = i; }
    }
  });
  return starter;
}

/** Marca um evento transitório para o cliente reagir (sons, avisos). */
function emitEvent(game, event) {
  game.eventSeq = (game.eventSeq || 0) + 1;
  game.lastEvent = { ...event, seq: game.eventSeq };
}

function pushLog(game, msg) {
  game.log.push({ at: Date.now(), msg });
  if (game.log.length > 200) game.log.shift();
}

export function currentPlayer(game) {
  return game.players[game.turn];
}

/** Extremidades abertas da mesa: { left, right } ou null se a mesa está vazia. */
export function boardEnds(game) {
  if (game.board.length === 0) return null;
  return { left: game.board[0].left, right: game.board[game.board.length - 1].right };
}

/**
 * Onde a peça pode ser jogada.
 * `flipped` indica que a peça precisa ser exibida invertida para encaixar.
 * @returns {{side:'left'|'right', flipped:boolean}[]} vazio = jogada ilegal
 */
export function legalPlacements(game, tile) {
  const ends = boardEnds(game);
  if (!ends) return [{ side: 'right', flipped: false }]; // primeira peça, qualquer uma
  const out = [];
  const [a, b] = tile;
  // Carroça: as duas pontas têm o mesmo número, então o lado não importa.
  if (a === b) {
    if (a === ends.left) out.push({ side: 'left', flipped: false });
    if (a === ends.right) out.push({ side: 'right', flipped: false });
    return out;
  }
  if (b === ends.left) out.push({ side: 'left', flipped: false });
  if (a === ends.left) out.push({ side: 'left', flipped: true });
  // Na ponta direita, o número que casa fica à esquerda da peça.
  if (a === ends.right) out.push({ side: 'right', flipped: false });
  if (b === ends.right) out.push({ side: 'right', flipped: true });
  return out;
}

export function canPlay(game, playerIndex, tile) {
  return legalPlacements(game, tile).length > 0;
}

export function handHasPlayable(game, playerIndex) {
  return game.players[playerIndex].hand.some((t) => canPlay(game, playerIndex, t));
}

/** Alguma peça do monte encaixa nas pontas atuais? (define se vale comprar tudo de uma vez) */
export function stockHasPlayable(game) {
  return game.stock.some((t) => legalPlacements(game, t).length > 0);
}

/**
 * Joga uma peça. Lança Error com mensagem em pt-BR quando a jogada é inválida.
 * @param {number} playerIndex
 * @param {[number,number]} tile
 * @param {'left'|'right'} side
 */
export function playTile(game, playerIndex, tile, side) {
  assertPlaying(game);
  if (playerIndex !== game.turn) throw new Error('Não é a sua vez.');
  const player = game.players[playerIndex];
  const idx = player.hand.findIndex((t) => sameTile(t, tile));
  if (idx === -1) throw new Error('Você não tem essa peça.');
  const placements = legalPlacements(game, tile);
  if (placements.length === 0) throw new Error('Essa peça não encaixa em nenhuma ponta.');

  let placement = placements.find((p) => p.side === side);
  if (!placement) {
    // Se a peça só encaixa de um lado, aceita mesmo que o cliente tenha mandado o outro.
    if (placements.length === 1) placement = placements[0];
    else throw new Error('Essa peça não encaixa nessa ponta.');
  }

  const [a, b] = tile;
  // Ordem de exibição da peça (esquerda -> direita) na mesa.
  const [x, y] = placement.flipped ? [b, a] : [a, b];
  player.hand.splice(idx, 1);
  // A mesa mudou: quem havia passado volta a ter o direito de jogar.
  for (const p of game.players) p.passed = false;

  if (game.board.length === 0) {
    game.board.push({ tile: [a, b], left: x, right: y });
  } else if (placement.side === 'left') {
    game.board.unshift({ tile: [a, b], left: x, right: y });
  } else {
    game.board.push({ tile: [a, b], left: x, right: y });
  }

  pushLog(game, `${player.id} jogou [${a}|${b}] na ponta ${placement.side === 'left' ? 'esquerda' : 'direita'}.`);
  emitEvent(game, { type: 'play', seat: playerIndex });

  if (player.hand.length === 0) {
    finish(game, playerIndex, 'domino');
    return;
  }
  advanceTurn(game);
  settleForcedPasses(game);

  // Geral: todos os outros foram obrigados a passar e a vez voltou para quem jogou.
  if (game.status === 'playing' && game.turn === playerIndex
    && game.players.every((p, i) => (i === playerIndex ? !p.passed : p.passed))
    && game.players.length > 1) {
    pushLog(game, `Geral! ${player.id} trancou a mesa e joga de novo.`);
    emitEvent(game, { type: 'geral', seat: playerIndex });
  }
}

/**
 * Passa automaticamente por todos os jogadores que não têm jogada com o monte
 * vazio — ninguém precisa clicar "passar" quando não há escolha. Se todos
 * ficarem sem jogada, fecha a partida por pontos.
 */
function settleForcedPasses(game) {
  let guard = 0;
  while (game.status === 'playing'
    && game.stock.length === 0
    && !handHasPlayable(game, game.turn)
    && guard++ <= game.players.length) {
    const p = game.players[game.turn];
    if (!p.passed) {
      p.passed = true;
      pushLog(game, `${p.id} passou automaticamente (sem jogada).`);
      emitEvent(game, { type: 'pass', seat: game.turn, auto: true });
    }
    if (game.players.every((pl) => pl.passed)) { finishBlocked(game); return; }
    advanceTurn(game);
  }
}

/**
 * O jogador da vez compra uma peça do monte.
 * @param {number} index posição da peça no monte (o jogador escolhe qual puxar)
 * @returns {[number,number]} a peça comprada
 */
export function drawTile(game, playerIndex, index = 0) {
  assertPlaying(game);
  if (playerIndex !== game.turn) throw new Error('Não é a sua vez.');
  if (game.stock.length === 0) throw new Error('O monte está vazio.');
  if (!Number.isInteger(index) || index < 0 || index >= game.stock.length) {
    throw new Error('Escolha uma peça válida do monte.');
  }
  const player = game.players[playerIndex];
  if (handHasPlayable(game, playerIndex)) {
    throw new Error('Você tem peça jogável: é obrigatório jogar.');
  }
  const [tile] = game.stock.splice(index, 1);
  player.hand.push(tile);
  player.hand.sort((x, y) => pipSum(x) - pipSum(y) || x[0] - y[0]);
  player.passed = false;
  pushLog(game, `${player.id} comprou uma peça do monte.`);
  emitEvent(game, { type: 'draw', seat: playerIndex });
  // Esvaziou o monte sem conseguir jogar? Resolve os passes obrigatórios.
  if (game.stock.length === 0) settleForcedPasses(game);
  return tile;
}

/**
 * Compra o monte inteiro de uma vez. Só é permitido quando nenhuma peça do
 * monte encaixa nas pontas — comprar uma a uma seria perder tempo, pois o
 * jogador acabaria pegando todas sem conseguir jogar.
 * @returns {number} quantas peças foram compradas
 */
export function drawAllStock(game, playerIndex) {
  assertPlaying(game);
  if (playerIndex !== game.turn) throw new Error('Não é a sua vez.');
  if (game.stock.length === 0) throw new Error('O monte está vazio.');
  if (handHasPlayable(game, playerIndex)) throw new Error('Você tem peça jogável: é obrigatório jogar.');
  if (stockHasPlayable(game)) throw new Error('Há peça comprável que encaixa: compre uma de cada vez.');
  const player = game.players[playerIndex];
  const count = game.stock.length;
  for (const tile of game.stock.splice(0)) player.hand.push(tile);
  player.hand.sort((x, y) => pipSum(x) - pipSum(y) || x[0] - y[0]);
  player.passed = false;
  pushLog(game, `${player.id} comprou todas as ${count} peças do monte.`);
  emitEvent(game, { type: 'draw', seat: playerIndex, all: true, count });
  // Monte vazio e ainda sem jogada: segue o passe automático.
  settleForcedPasses(game);
  return count;
}

/** O jogador da vez passa a vez (só permitido sem peça jogável e com monte vazio). */
export function passTurn(game, playerIndex) {
  assertPlaying(game);
  if (playerIndex !== game.turn) throw new Error('Não é a sua vez.');
  if (handHasPlayable(game, playerIndex)) throw new Error('Você tem peça jogável: é obrigatório jogar.');
  if (game.stock.length > 0) throw new Error('Ainda há peças no monte: é obrigatório comprar.');
  const player = game.players[playerIndex];
  player.passed = true;
  pushLog(game, `${player.id} passou a vez.`);
  emitEvent(game, { type: 'pass', seat: playerIndex });

  // Jogo fechado: todos passaram e ninguém tem jogada -> decide por pontos.
  if (game.players.every((p) => p.passed)) {
    finishBlocked(game);
    return;
  }
  advanceTurn(game);
  settleForcedPasses(game);
}

function advanceTurn(game) {
  game.turn = (game.turn + 1) % game.players.length;
  // Pula quem já passou (só acontece em jogo fechado).
  let guard = 0;
  while (game.players[game.turn].passed && guard++ < game.players.length) {
    game.turn = (game.turn + 1) % game.players.length;
  }
  // Se o próximo jogador não tem jogada e o monte está vazio, ele ainda precisa
  // passar explicitamente (o cliente mostra o botão "Passar").
}

function finishBlocked(game) {
  const sums = game.players.map((p) => p.hand.reduce((s, t) => s + pipSum(t), 0));
  const min = Math.min(...sums);
  const winners = sums.map((s, i) => (s === min ? i : -1)).filter((i) => i >= 0);
  if (winners.length === 1) {
    finish(game, winners[0], 'blocked');
  } else {
    game.status = 'finished';
    game.winner = null;
    game.finishReason = 'blocked';
    pushLog(game, `Jogo fechado com empate em ${min} pontos.`);
    emitEvent(game, { type: 'win', seat: null, reason: 'blocked' });
  }
}

function finish(game, winnerIndex, reason) {
  game.status = 'finished';
  game.winner = winnerIndex;
  game.finishReason = reason;
  const name = game.players[winnerIndex].id;
  pushLog(game, reason === 'domino' ? `${name} bateu (dominó)!` : `${name} venceu por pontos (jogo fechado).`);
  emitEvent(game, { type: 'win', seat: winnerIndex, reason });
}

function assertPlaying(game) {
  if (game.status !== 'playing') throw new Error('A partida já terminou.');
}

/** Pontos restantes na mão de cada jogador (para a tela final). */
export function handSums(game) {
  return game.players.map((p) => p.hand.reduce((s, t) => s + pipSum(t), 0));
}

/** Estado visível para um jogador: esconde as mãos dos outros. */
export function viewFor(game, playerIndex) {
  return {
    status: game.status,
    turn: game.turn,
    board: game.board,
    ends: boardEnds(game),
    stockCount: game.stock.length,
    winner: game.winner,
    finishReason: game.finishReason,
    players: game.players.map((p, i) => ({
      id: p.id,
      seat: p.seat,
      handCount: p.hand.length,
      passed: p.passed,
      hand: i === playerIndex ? p.hand : null,
      handSum: game.status === 'finished' ? p.hand.reduce((s, t) => s + pipSum(t), 0) : null,
    })),
    you: playerIndex,
    canPlay: game.status === 'playing' && game.turn === playerIndex
      ? handHasPlayable(game, playerIndex)
      : null,
    // Sinaliza que o jogador deve comprar o monte inteiro (nada ali encaixa).
    mustDrawAll: game.status === 'playing' && game.turn === playerIndex
      && game.stock.length > 0
      && !handHasPlayable(game, playerIndex)
      && !stockHasPlayable(game),
    lastEvent: game.lastEvent,
    log: game.log.slice(-30),
  };
}
