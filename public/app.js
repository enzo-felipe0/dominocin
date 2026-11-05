// Cliente do jogo: WebSocket + renderização do estado vindo do servidor.

const $ = (sel) => document.querySelector(sel);

const ui = {
  lobby: $('#lobby'),
  tableScreen: $('#table-screen'),
  name: $('#name'),
  code: $('#code'),
  joinBox: $('#join-box'),
  lobbyError: $('#lobby-error'),
  roomCode: $('#room-code'),
  turnInfo: $('#turn-info'),
  players: $('#players'),
  board: $('#board'),
  boardTrack: $('#board-track'),
  boardEmpty: $('#board-empty'),
  ends: $('#ends'),
  stock: $('#stock'),
  log: $('#log'),
  chat: $('#chat'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  hand: $('#hand'),
  actions: $('#actions'),
  scoreboard: $('#scoreboard'),
  side: $('#side'),
  table: document.querySelector('.table'),
  stockPanel: $('#stock-panel'),
  stockGrid: $('#stock-grid'),
  stockPanelCount: $('#stock-panel-count'),
  overlay: $('#overlay'),
  overlayTitle: $('#overlay-title'),
  overlayText: $('#overlay-text'),
  btnRestart: $('#btn-restart'),
  btnSound: $('#btn-sound'),
  btnPanels: $('#btn-panels'),
  panelsMenu: $('#panels-menu'),
  btnOnlyBoard: $('#btn-only-board'),
  btnAllPanels: $('#btn-all-panels'),
  btnFlip: $('#btn-flip'),
  btnHide: $('#btn-hide'),
  handHint: $('#hand-hint'),
  toast: $('#toast'),
};

// Preferências locais persistidas no navegador deste jogador.
function loadPref(key, def) {
  try { const v = localStorage.getItem('domino.' + key); return v === null ? def : v === '1'; }
  catch { return def; }
}
function savePref(key, val) {
  try { localStorage.setItem('domino.' + key, val ? '1' : '0'); } catch { /* ignore */ }
}

const state = {
  ws: null,
  room: null,
  game: null,
  selected: null,   // peça selecionada da mão
  joined: false,
  overlayShown: false,
  prevLen: null,    // acompanha o crescimento da mesa para saber onde rolar
  prevFirst: null,
  prevHand: null,   // para destacar a peça recém-comprada
  drawing: false,
  handHidden: false,     // mão colapsada (não mostra as peças)
  handFlipped: loadPref('flip', false), // mostra o verso das peças
  soundOn: loadPref('sound', true),
  order: [],             // ordem manual das peças na mão (chaves "a-b")
  top: {},               // chave "a-b" -> número exibido em cima (agrupamento)
  manualOrder: false,    // o jogador arrastou peças: não reagrupa sozinho
  gameStartedAt: null,   // detecta partida nova para reagrupar a mão
  spectator: false,
  lastEventSeq: 0,       // último evento sonoro já tratado
  wasMyTurn: false,      // para o som de "sua vez"
};

// ---------- Sons (WebAudio, sem arquivos) ----------
let audioCtx = null;
function audio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// Toca uma sequência de tons curtos.
function beep(notes) {
  if (!state.soundOn) return;
  const ctx = audio();
  if (!ctx) return;
  let t = ctx.currentTime;
  for (const [freq, dur, vol = 0.12] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
  }
}
const sfx = {
  yourTurn: () => beep([[660, 0.12], [880, 0.16]]),
  play: () => beep([[440, 0.07, 0.08]]),
  draw: () => beep([[300, 0.08, 0.08], [260, 0.08, 0.08]]),
  pass: () => beep([[200, 0.14, 0.08]]),
  geral: () => beep([[520, 0.1], [660, 0.1], [784, 0.18]]),
  win: () => beep([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.22]]),
  lose: () => beep([[392, 0.14], [330, 0.14], [262, 0.24]]),
  chat: () => beep([[988, 0.06, 0.07], [1319, 0.1, 0.07]]),
};
// Destrava o áudio no primeiro toque/clique (política dos navegadores).
function unlockAudio() { audio(); window.removeEventListener('pointerdown', unlockAudio); }
window.addEventListener('pointerdown', unlockAudio);

// ---------- Conexão ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  state.ws = ws;

  ws.addEventListener('open', () => {
    ui.lobbyError.textContent = '';
    if (state.pendingJoin) {
      ws.send(JSON.stringify(state.pendingJoin));
      state.pendingJoin = null;
    }
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });

  ws.addEventListener('close', () => {
    if (state.joined) {
      toast('Conexão perdida. Recarregue a página para voltar.');
      state.joined = false;
    }
  });

  ws.addEventListener('error', () => {
    ui.lobbyError.textContent = 'Não foi possível conectar ao servidor.';
  });
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      state.joined = true;
      state.myId = msg.playerId;
      state.spectator = Boolean(msg.spectator);
      showTable();
      if (state.spectator) toast('Você entrou como espectador. Entra na mesa na próxima partida, se houver lugar.');
      break;
    case 'state':
      state.room = msg.room;
      state.game = msg.game;
      state.spectator = Boolean(msg.spectator);
      state.drawing = false;   // resposta chegou: libera a próxima compra
      render();
      processEvents();
      break;
    case 'chat':
      addChat(msg.from, msg.text);
      if (msg.fromId !== state.myId) sfx.chat();
      break;
    case 'error':
      state.drawing = false;
      toast(msg.message);
      ui.lobbyError.textContent = msg.message;
      break;
    case 'left':
      location.reload();
      break;
  }
}

// Reage a eventos do servidor: toca sons e mostra avisos (geral, vitória…).
function processEvents() {
  const g = state.game;
  if (!g) { state.wasMyTurn = false; return; }

  // Som de "sua vez" na transição para a sua vez.
  const myTurn = g.status === 'playing' && g.turn === g.you;
  if (myTurn && !state.wasMyTurn) sfx.yourTurn();
  state.wasMyTurn = myTurn;

  const ev = g.lastEvent;
  if (!ev || ev.seq <= state.lastEventSeq) return;
  state.lastEventSeq = ev.seq;

  switch (ev.type) {
    case 'play': sfx.play(); break;
    case 'draw':
      sfx.draw();
      if (ev.all && ev.seat !== g.you) {
        const who = g.players[ev.seat]?.id ?? 'Jogador';
        toast(`${who} comprou o monte inteiro.`);
      }
      break;
    case 'pass': sfx.pass(); break;
    case 'geral': {
      sfx.geral();
      const who = ev.seat === g.you ? 'Você' : (g.players[ev.seat]?.id ?? 'Jogador');
      toast(`🔒 Geral! ${who} trancou a mesa e joga de novo.`);
      break;
    }
    case 'win': {
      if (ev.seat === null) { sfx.pass(); toast('Jogo fechado: empate em pontos.'); }
      else if (ev.seat === g.you) sfx.win();
      else sfx.lose();
      break;
    }
  }
}

// ---------- Lobby ----------
function join(name, code) {
  const payload = { type: 'join', name, room: code || '' };
  if (state.ws && state.ws.readyState === WebSocket.OPEN) send(payload);
  else state.pendingJoin = payload;
}

$('#btn-create').addEventListener('click', () => {
  const name = ui.name.value.trim();
  if (!name) { ui.lobbyError.textContent = 'Digite seu nome.'; return; }
  join(name, '');
});

$('#btn-join').addEventListener('click', () => {
  ui.joinBox.classList.toggle('hidden');
  ui.code.focus();
});

$('#btn-join-confirm').addEventListener('click', () => {
  const name = ui.name.value.trim();
  const code = ui.code.value.trim().toUpperCase();
  if (!name) { ui.lobbyError.textContent = 'Digite seu nome.'; return; }
  if (!code) { ui.lobbyError.textContent = 'Digite o código da sala.'; return; }
  join(name, code);
});

ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join-confirm').click(); });
ui.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-create').click(); });

function showTable() {
  ui.lobby.classList.remove('active');
  ui.tableScreen.classList.add('active');
  if (!ui.name.value.trim()) ui.name.value = state.name || '';
}

$('#btn-leave').addEventListener('click', () => {
  send({ type: 'leave' });
  setTimeout(() => location.reload(), 120);
});

// ---------- Render ----------
function render() {
  if (!state.room) return;
  // Nova partida em andamento: libera o overlay de fim para a próxima vez.
  if (state.game && state.game.status === 'playing') state.overlayShown = false;
  ui.roomCode.textContent = state.room.code;
  renderPlayers();
  renderBoard();
  renderHand();
  renderStatus();
  renderStockPanel();
  renderLog();
  renderScoreboard();
}

function renderScoreboard() {
  const scores = (state.room && state.room.scores) || [];
  if (scores.length === 0) { ui.scoreboard.innerHTML = '<li style="color:var(--ink-dim)">Sem partidas ainda.</li>'; return; }
  const max = Math.max(0, ...scores.map((s) => s.wins));
  ui.scoreboard.innerHTML = scores
    .slice()
    .sort((a, b) => b.wins - a.wins)
    .map((s) => {
      const leader = max > 0 && s.wins === max;
      return `<li class="${leader ? 'leader' : ''}"><b>${escapeHtml(s.name)}${leader ? ' 👑' : ''}</b><span class="wins">${s.wins}</span></li>`;
    })
    .join('');
}

// Monte visível no canto inferior direito: o jogador escolhe qual peça puxar.
function renderStockPanel() {
  const g = state.game;
  const needsDraw = g
    && g.status === 'playing'
    && g.turn === g.you
    && g.canPlay === false
    && g.stockCount > 0
    && !g.mustDrawAll; // quando nada encaixa, usa o botão "Comprar todas"

  ui.stockPanel.classList.toggle('hidden', !needsDraw);
  if (!needsDraw) {
    ui.stockGrid.innerHTML = '';
    return;
  }

  ui.stockPanelCount.textContent = g.stockCount;
  if (ui.stockGrid.childElementCount === g.stockCount) return;

  ui.stockGrid.innerHTML = '';
  for (let i = 0; i < g.stockCount; i++) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'stock-back';
    back.title = 'Comprar esta peça';
    back.setAttribute('aria-label', `Comprar a peça ${i + 1} do monte`);
    back.addEventListener('click', () => drawFromStock(i, back));
    ui.stockGrid.appendChild(back);
  }
}

function drawFromStock(index, button) {
  if (state.drawing) return;
  state.drawing = true;
  button.disabled = true;
  send({ type: 'draw', index });
  // Libera de novo quando o servidor responder; o timeout é só uma rede de
  // segurança caso a resposta se perca.
  setTimeout(() => { state.drawing = false; }, 1500);
}

function initials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

function renderPlayers() {
  const g = state.game;
  ui.players.innerHTML = '';
  state.room.players.forEach((p, i) => {
    const isTurn = g && g.status === 'playing' && g.turn === i;
    const handCount = g ? g.players[i]?.handCount : 0;
    const passed = g ? g.players[i]?.passed : false;
    const isHost = state.room.hostId === p.id;
    const el = document.createElement('div');
    el.className = 'player' + (isTurn ? ' active' : '');
    el.innerHTML = `
      <div class="avatar">${initials(p.name)}</div>
      <div class="who">
        <b>${escapeHtml(p.name)}${p.id === state.myId ? ' (você)' : ''}</b>
        <span>${g ? `${handCount} peça${handCount === 1 ? '' : 's'}` : 'na sala'}${isHost ? ' · anfitrião' : ''}</span>
      </div>
      ${passed ? '<span class="pass">passou</span>' : ''}
    `;
    ui.players.appendChild(el);
  });
  const specs = state.room.spectators || [];
  if (specs.length) {
    const el = document.createElement('div');
    el.className = 'spectators';
    el.innerHTML = `👀 Assistindo: ${specs.map((s) => escapeHtml(s.name) + (s.id === state.myId ? ' (você)' : '')).join(', ')}`;
    ui.players.appendChild(el);
  }
}

function pipPositions(n) {
  const map = {
    0: [],
    1: ['p1'],
    2: ['p2', 'p3'],
    3: ['p2', 'p1', 'p3'],
    4: ['p2', 'p4', 'p5', 'p3'],
    5: ['p2', 'p4', 'p1', 'p5', 'p3'],
    6: ['p2', 'p4', 'p6', 'p7', 'p5', 'p3'],
  };
  return map[n] || [];
}

function tileEl(a, b, { horizontal = false, extraClass = '' } = {}) {
  const el = document.createElement('div');
  el.className = `tile${horizontal ? ' horizontal' : ''} ${extraClass}`.trim();
  const half = (n) => {
    const h = document.createElement('div');
    h.className = 'half';
    for (const cls of pipPositions(n)) {
      const d = document.createElement('div');
      d.className = `pip ${cls}`;
      h.appendChild(d);
    }
    return h;
  };
  el.appendChild(half(a));
  el.appendChild(half(b));
  return el;
}

function renderBoard() {
  const g = state.game;
  const track = ui.boardTrack;
  track.classList.remove('snake');
  track.style.removeProperty('--bw');
  track.innerHTML = '';
  if (!g || g.board.length === 0) {
    const p = document.createElement('div');
    p.className = 'board-empty';
    p.textContent = (state.room && state.room.status === 'lobby')
      ? 'Aguardando o anfitrião iniciar a partida…'
      : 'Mesa vazia — jogue qualquer peça';
    track.appendChild(p);
    renderEnds();
    return;
  }
  layoutSnake(g.board);
  renderEnds();
}

// Quebra a lista de peças em fileiras que cabem na largura W, dado o tamanho
// de unidade u (peça deitada = 2u de largura, carroça em pé = 1u).
function packRows(widthUnits, u, gap, W) {
  const rows = [];
  let count = 0;
  let width = 0;
  for (const wu of widthUnits) {
    const tw = wu * u;
    const needed = count === 0 ? tw : width + gap + tw;
    if (count > 0 && needed > W) {
      rows.push(count);
      count = 1; width = tw;
    } else {
      count++; width = needed;
    }
  }
  if (count > 0) rows.push(count);
  return rows;
}

// Monta a "cobra" dobrada: escolhe o maior tamanho de peça que faz a corrente
// inteira caber na caixa da mesa (largura e altura), sem rolagem. Fileiras
// alternam o sentido para a corrente dobrar como numa mesa real.
function layoutSnake(slots) {
  const track = ui.boardTrack;
  const box = ui.board;
  const GAP = 2;
  const pad = 24; // padding da .board (12px de cada lado)
  const W = Math.max(60, box.clientWidth - pad);
  const H = Math.max(60, box.clientHeight - pad);

  // Caixa ainda sem dimensões (tela trocando): tenta de novo no próximo frame.
  if (box.clientHeight < 40) {
    requestAnimationFrame(() => { if (state.game && state.game.board.length) renderBoard(); });
  }

  const widthUnits = slots.map((s) => (s.left === s.right ? 1 : 2));

  let chosen = null;
  for (let u = 56; u >= 11; u--) {
    if (2 * u > W) continue; // a peça mais larga precisa caber na linha
    const rows = packRows(widthUnits, u, GAP, W);
    const totalH = rows.length * (2 * u) + Math.max(0, rows.length - 1) * GAP;
    if (totalH <= H) { chosen = { u, rows }; break; }
  }
  if (!chosen) {
    const u = 11;
    chosen = { u, rows: packRows(widthUnits, u, GAP, W) };
  }

  track.style.setProperty('--bw', chosen.u + 'px');
  track.classList.add('snake');
  track.innerHTML = '';

  const rows = chosen.rows;
  let idx = 0;
  rows.forEach((count, r) => {
    const row = document.createElement('div');
    row.className = 'board-row';
    // Alinhamento: fileiras do meio encostam nas duas pontas (dobra alinhada);
    // a última fica compacta junto da ponta por onde desce da fileira de cima.
    if (rows.length === 1) row.classList.add('align-left');
    else if (r === rows.length - 1) row.classList.add(r % 2 ? 'align-right' : 'align-left');
    else row.classList.add('spread');

    // Peças desta fileira, na ordem do encadeamento.
    const slice = slots.slice(idx, idx + count);
    idx += count;
    const even = r % 2 === 0;
    // Fileira par: esquerda→direita, peça como está [left|right].
    // Fileira ímpar: a corrente volta direita→esquerda, então invertemos a ordem
    // E espelhamos cada peça ([right|left]) para o número de encaixe ficar virado
    // para o lado certo — o 4 encosta no 4 de verdade.
    const visual = even ? slice : slice.slice().reverse();
    for (const s of visual) {
      const horizontal = s.left !== s.right;
      const [a, b] = even ? [s.left, s.right] : [s.right, s.left];
      row.appendChild(tileEl(a, b, { horizontal }));
    }
    track.appendChild(row);
  });
}

function renderEnds() {
  const g = state.game;
  ui.ends.innerHTML = '';
  if (!g || !g.ends) return;
  const legal = state.selected ? legalSides(g, state.selected) : [];
  for (const side of ['left', 'right']) {
    const b = document.createElement('button');
    b.className = 'end-btn' + (legal.includes(side) ? ' legal' : '');
    b.textContent = `${side === 'left' ? 'Esquerda' : 'Direita'} · ${g.ends[side]}`;
    b.disabled = !legal.includes(side);
    b.addEventListener('click', () => playSelected(side));
    ui.ends.appendChild(b);
  }
}

function legalSides(g, tile) {
  if (!g.ends) return ['left', 'right'];
  const sides = new Set();
  const [a, b] = tile;
  if (a === g.ends.left || b === g.ends.left) sides.add('left');
  if (a === g.ends.right || b === g.ends.right) sides.add('right');
  return [...sides];
}

// Agrupa a mão pelo número mais repetido: com 4 peças de quina, as quatro
// ficam juntas à esquerda, todas com o 5 em cima. Repete com o que sobrar.
function groupHand(hand) {
  let rest = hand.slice();
  const order = [];
  const top = {};
  while (rest.length) {
    const count = Array(7).fill(0);
    for (const [a, b] of rest) { count[a]++; if (b !== a) count[b]++; }
    // Mais frequente; empate -> número maior.
    let n = 0;
    for (let i = 1; i <= 6; i++) if (count[i] >= count[n]) n = i;
    const group = rest.filter((t) => t[0] === n || t[1] === n);
    rest = rest.filter((t) => t[0] !== n && t[1] !== n);
    const other = (t) => (t[0] === n ? t[1] : t[0]);
    // Carroça primeiro, depois do maior para o menor.
    group.sort((x, y) => (other(y) === n) - (other(x) === n) || other(y) - other(x));
    for (const t of group) {
      const key = `${t[0]}-${t[1]}`;
      order.push(key);
      top[key] = n;
    }
  }
  return { order, top };
}

// Devolve a mão na ordem manual escolhida pelo jogador; peças novas vão ao fim.
// Sem arrasto manual, a mão fica sempre agrupada (inclusive após comprar).
function orderedHand(myHand) {
  if (!state.manualOrder) {
    const { order, top } = groupHand(myHand);
    state.order = order;
    state.top = top;
  }
  const byKey = new Map(myHand.map((t) => [`${t[0]}-${t[1]}`, t]));
  const result = [];
  for (const key of state.order) {
    if (byKey.has(key)) { result.push(byKey.get(key)); byKey.delete(key); }
  }
  for (const t of byKey.values()) result.push(t); // peças recém-compradas
  state.order = result.map((t) => `${t[0]}-${t[1]}`);
  return result;
}

function renderHand() {
  const g = state.game;
  ui.hand.innerHTML = '';
  ui.hand.classList.toggle('hidden-hand', state.handHidden);
  const myHand = g && g.players[g.you] ? g.players[g.you].hand : null;
  if (state.spectator) {
    ui.hand.innerHTML = '<span style="color:var(--ink-dim);font-size:14px">👀 Você está assistindo. Entra na mesa na próxima partida, se houver lugar.</span>';
    return;
  }
  if (!myHand) {
    ui.hand.innerHTML = '<span style="color:var(--ink-dim);font-size:14px">Sua mão aparece aqui quando a partida começar.</span>';
    return;
  }
  if (state.handHidden) {
    ui.hand.innerHTML = `<span style="color:var(--ink-dim);font-size:14px">Mão oculta (${myHand.length} peças). Toque em "Mostrar” para mostrar.</span>`;
    return;
  }

  const myTurn = g.status === 'playing' && g.turn === g.you;
  const keys = myHand.map((t) => `${t[0]}-${t[1]}`);
  let drawnKey = null;
  if (state.prevHand && keys.length === state.prevHand.length + 1) {
    drawnKey = keys.find((k) => !state.prevHand.includes(k)) || null;
  }
  state.prevHand = keys;
  if (drawnKey) toast(`Você comprou [${drawnKey.replace('-', '|')}]`);

  if (ui.handHint) {
    ui.handHint.textContent = state.handFlipped
      ? 'Peças viradas — clique em “Virar” para jogar'
      : 'Arraste para reordenar';
  }

  // Partida nova: volta ao agrupamento automático.
  if (g.startedAt !== state.gameStartedAt) {
    state.gameStartedAt = g.startedAt;
    state.manualOrder = false;
  }
  const tiles = orderedHand(myHand);
  for (const t of tiles) {
    const key = `${t[0]}-${t[1]}`;
    const playable = myTurn && !state.handFlipped && legalSides(g, t).length > 0;
    // Exibe com o número do grupo em cima (só visual; a peça enviada é a mesma).
    const [ta, tb] = state.top[key] === t[1] ? [t[1], t[0]] : [t[0], t[1]];
    const el = tileEl(ta, tb, {
      extraClass: (state.handFlipped ? 'back' : (playable ? '' : 'illegal'))
        + (state.selected && state.selected[0] === t[0] && state.selected[1] === t[1] ? ' selected' : '')
        + (!state.handFlipped && key === drawnKey ? ' just-drawn' : ''),
    });
    el.dataset.key = key;
    if (playable) el.addEventListener('click', () => { if (!state._dragged) selectTile(t); });
    enableDragReorder(el, key);
    ui.hand.appendChild(el);
  }
  fitHand();
}

// Ajusta o tamanho das peças da mão para caberem numa única fileira (como nos
// apps de dominó): encolhe até um mínimo e, se ainda faltar espaço, sobrepõe.
function fitHand() {
  const n = ui.hand.querySelectorAll('.tile').length;
  if (!n) return;
  const avail = ui.hand.clientWidth;
  if (!avail) return;
  const max = window.innerWidth <= 560 ? 40 : 46;
  const min = 24;
  const gap = n > 1 ? Math.min(8, Math.max(3, Math.floor(avail / n / 10))) : 0;
  let w = Math.floor((avail - gap * (n - 1)) / n);
  let overlap = 0;
  if (w < min) {
    w = min;
    overlap = Math.ceil((n * w - avail) / (n - 1));
  }
  w = Math.min(max, w);
  ui.hand.style.setProperty('--hw', w + 'px');
  ui.hand.style.setProperty('--hgap', (overlap ? -overlap : gap) + 'px');
}

// Reordenação por arrasto (pointer) — funciona no desktop e no toque.
function enableDragReorder(el, key) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    state._dragged = false;

    const onMove = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 6 && Math.abs(ev.clientY - startY) < 6) return;
        dragging = true;
        state._dragged = true;
        el.classList.add('dragging');
        try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      // Encontra a peça sob o cursor e marca como alvo de soltura.
      const over = [...ui.hand.children].find((c) => {
        if (c === el) return false;
        const r = c.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right;
      });
      ui.hand.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
      if (over) over.classList.add('drop-target');
    };

    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (dragging) {
        const over = [...ui.hand.children].find((c) => {
          if (c === el) return false;
          const r = c.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX <= r.right;
        });
        if (over && over.dataset.key) { state.manualOrder = true; reorderHand(key, over.dataset.key); }
        el.classList.remove('dragging');
        ui.hand.querySelectorAll('.drop-target').forEach((c) => c.classList.remove('drop-target'));
        renderHand();
      }
      // Pequeno atraso para o clique não disparar logo após um arrasto.
      setTimeout(() => { state._dragged = false; }, 0);
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

function reorderHand(fromKey, toKey) {
  const order = state.order.slice();
  const from = order.indexOf(fromKey);
  const to = order.indexOf(toKey);
  if (from === -1 || to === -1 || from === to) return;
  order.splice(from, 1);
  order.splice(to, 0, fromKey);
  state.order = order;
}

function selectTile(tile) {
  const g = state.game;
  if (!g || g.status !== 'playing' || g.turn !== g.you) return;
  const sides = legalSides(g, tile);
  if (sides.length === 0) return;
  if (sides.length === 1 || !g.ends) {
    play(tile, sides[0]);
    return;
  }
  const same = state.selected && state.selected[0] === tile[0] && state.selected[1] === tile[1];
  state.selected = same ? null : tile;
  renderHand();
  renderEnds();
}

function playSelected(side) {
  if (!state.selected) return;
  play(state.selected, side);
}

function play(tile, side) {
  state.selected = null;
  send({ type: 'play', tile, side });
}

function renderStatus() {
  const g = state.game;
  ui.stock.textContent = g ? `${g.stockCount} peça${g.stockCount === 1 ? '' : 's'}` : '—';
  ui.actions.innerHTML = '';

  if (!g) {
    ui.turnInfo.textContent = state.spectator ? '👀 Assistindo · mesa cheia' : 'Sala aberta';
    const isHost = state.room.hostId === state.myId;
    if (isHost) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = state.room.players.length >= 2 ? 'Iniciar partida' : 'Aguardando jogadores…';
      btn.disabled = state.room.players.length < 2;
      btn.addEventListener('click', () => send({ type: 'start' }));
      ui.actions.appendChild(btn);
    } else {
      ui.actions.innerHTML = '<span style="color:var(--ink-dim);font-size:13px;align-self:center">Aguardando o anfitrião iniciar…</span>';
    }
    return;
  }

  const me = g.players[g.you];
  if (g.status === 'finished') {
    ui.turnInfo.innerHTML = '<strong>Partida encerrada</strong>';
    // Alternativa ao overlay (caso tenha sido fechado): reiniciar pelo rodapé.
    const result = document.createElement('button');
    result.className = 'ghost small';
    result.textContent = 'Ver resultado';
    result.addEventListener('click', () => { state.overlayShown = false; showOverlay(g); });
    if (state.room.hostId === state.myId) {
      const btn = document.createElement('button');
      btn.className = 'primary';
      btn.textContent = 'Nova partida';
      btn.addEventListener('click', restartGame);
      ui.actions.appendChild(btn);
    } else {
      ui.actions.innerHTML = '<span style="color:var(--ink-dim);font-size:13px;align-self:center">Aguardando o anfitrião iniciar nova partida…</span>';
    }
    ui.actions.appendChild(result);
    showOverlay(g);
    return;
  }

  if (state.spectator) {
    const name = g.players[g.turn]?.id ?? '...';
    ui.turnInfo.innerHTML = `👀 Assistindo · vez de <strong>${escapeHtml(name)}</strong>`;
    return;
  }

  if (g.turn === g.you) {
    ui.turnInfo.innerHTML = '<strong>Sua vez</strong>';
    if (!g.canPlay) {
      if (g.stockCount > 0) {
        if (g.mustDrawAll) {
          // Nada no monte encaixa: compra tudo de uma vez para agilizar.
          const b = document.createElement('button');
          b.className = 'primary';
          b.textContent = `Comprar todas (${g.stockCount})`;
          b.addEventListener('click', () => send({ type: 'drawAll' }));
          ui.actions.appendChild(b);
        } else {
          ui.actions.innerHTML = '<span class="hint-inline">Compre uma peça no monte →</span>';
        }
      } else {
        const b = document.createElement('button');
        b.className = 'primary';
        b.textContent = 'Passar a vez';
        b.addEventListener('click', () => send({ type: 'pass' }));
        ui.actions.appendChild(b);
      }
    } else {
      ui.actions.innerHTML = '<span style="color:var(--accent);font-size:13px;align-self:center">Escolha uma peça</span>';
    }
  } else {
    const name = g.players[g.turn]?.id ?? '...';
    ui.turnInfo.innerHTML = `Vez de <strong>${escapeHtml(name)}</strong>`;
  }

  if (state.selected) {
    const cancel = document.createElement('button');
    cancel.className = 'ghost small';
    cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => { state.selected = null; renderHand(); renderEnds(); });
    ui.actions.appendChild(cancel);
  }
}

function renderLog() {
  const g = state.game;
  const items = g ? g.log : [];
  ui.log.innerHTML = items.map((l) => `<li>${escapeHtml(l.msg)}</li>`).join('');
  ui.log.scrollTop = ui.log.scrollHeight;
}

function showOverlay(g) {
  if (state.overlayShown) return;
  state.overlayShown = true;
  let title = 'Fim de partida';
  let text = '';
  if (g.winner === null) {
    text = g.finishReason === 'abandoned'
      ? 'A partida foi encerrada porque um jogador saiu da mesa.'
      : 'Jogo fechado com empate em pontos.';
  } else {
    const winner = g.players[g.winner];
    const youWon = g.winner === g.you;
    title = youWon ? 'Você venceu!' : `${winner.id} venceu`;
    if (g.finishReason === 'domino') {
      text = youWon ? 'Você bateu: ficou sem peças.' : `${winner.id} bateu e ficou sem peças.`;
    } else if (g.finishReason === 'blocked') {
      text = `Jogo fechado. ${winner.id} tinha a menor soma de pontos na mão.`;
    } else if (g.finishReason === 'abandoned') {
      text = 'A partida foi encerrada porque um jogador saiu da mesa.';
    }
  }
  const sums = g.players.map((p) => `${p.id}: ${p.handSum ?? 0} pts`).join(' · ');
  const scores = (state.room && state.room.scores) || [];
  const placar = scores.length
    ? '🏆 ' + scores.slice().sort((a, b) => b.wins - a.wins).map((s) => `${s.name}: ${s.wins}`).join(' · ')
    : '';
  ui.overlayTitle.textContent = title;
  ui.overlayText.innerHTML = `${escapeHtml(text)}<br><small style="opacity:.8">${escapeHtml(sums)}</small>${placar ? `<br><small>${escapeHtml(placar)}</small>` : ''}`;
  ui.overlay.classList.remove('hidden');
  const isHost = state.room.hostId === state.myId;
  ui.btnRestart.classList.toggle('hidden', !isHost);
}

function restartGame() {
  ui.overlay.classList.add('hidden');
  state.overlayShown = false;
  send({ type: 'start' });
}
$('#btn-restart').addEventListener('click', restartGame);

$('#btn-close-overlay').addEventListener('click', () => {
  ui.overlay.classList.add('hidden');
});

// ---------- Chat ----------
ui.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.chatInput.value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  ui.chatInput.value = '';
});

function addChat(from, text) {
  const li = document.createElement('li');
  li.innerHTML = `<b>${escapeHtml(from)}</b>: ${escapeHtml(text)}`;
  ui.chat.appendChild(li);
  ui.chat.scrollTop = ui.chat.scrollHeight;
}

// ---------- Controles de interface ----------
// Som
function refreshSoundBtn() {
  ui.btnSound.textContent = state.soundOn ? '🔊' : '🔇';
  ui.btnSound.classList.toggle('muted', !state.soundOn);
  ui.btnSound.setAttribute('aria-pressed', String(state.soundOn));
}
ui.btnSound.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  savePref('sound', state.soundOn);
  refreshSoundBtn();
  if (state.soundOn) { audio(); sfx.play(); }
});
refreshSoundBtn();

// Visibilidade individual dos painéis (persistida por navegador). Permite deixar
// só o tabuleiro + chat, por exemplo.
const SIDE_PANELS = ['panel-stock', 'panel-score', 'panel-log', 'panel-chat'];

function isPanelHidden(id) {
  try { return localStorage.getItem('domino.hide.' + id) === '1'; } catch { return false; }
}
function setPanelHidden(id, hidden) {
  try { localStorage.setItem('domino.hide.' + id, hidden ? '1' : '0'); } catch { /* ignore */ }
}

function applyPanels() {
  let anyVisible = false;
  for (const id of SIDE_PANELS) {
    const panel = document.getElementById(id);
    if (!panel) continue;
    const hidden = isPanelHidden(id);
    panel.classList.toggle('panel-hidden', hidden);
    if (!hidden) anyVisible = true;
    // Sincroniza o checkbox do menu (marcado = visível).
    const cb = ui.panelsMenu.querySelector(`input[data-panel="${id}"]`);
    if (cb) cb.checked = !hidden;
  }
  // Nenhum painel visível: some com a coluna e a mesa ocupa tudo.
  ui.table.classList.toggle('no-side', !anyVisible);
  requestAnimationFrame(relayoutBoard);
}

function hidePanel(id) { setPanelHidden(id, true); applyPanels(); }

ui.panelsMenu.querySelectorAll('input[data-panel]').forEach((cb) => {
  cb.addEventListener('change', () => { setPanelHidden(cb.dataset.panel, !cb.checked); applyPanels(); });
});
document.querySelectorAll('.panel-close').forEach((btn) => {
  btn.addEventListener('click', () => hidePanel(btn.dataset.target));
});

// Atalho: só o tabuleiro + chat.
ui.btnOnlyBoard.addEventListener('click', () => {
  setPanelHidden('panel-stock', true);
  setPanelHidden('panel-score', true);
  setPanelHidden('panel-log', true);
  setPanelHidden('panel-chat', false);
  applyPanels();
  closePanelsMenu();
});
// Mostrar todos de novo.
ui.btnAllPanels.addEventListener('click', () => {
  for (const id of SIDE_PANELS) setPanelHidden(id, false);
  applyPanels();
  closePanelsMenu();
});

// Abre/fecha o menu de painéis.
function closePanelsMenu() {
  ui.panelsMenu.classList.add('hidden');
  ui.btnPanels.setAttribute('aria-expanded', 'false');
}
ui.btnPanels.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = ui.panelsMenu.classList.contains('hidden');
  ui.panelsMenu.classList.toggle('hidden', !willOpen);
  ui.btnPanels.setAttribute('aria-expanded', String(willOpen));
});
// Clique fora fecha o menu.
document.addEventListener('click', (e) => {
  if (!ui.panelsMenu.classList.contains('hidden') && !e.target.closest('.menu-wrap')) closePanelsMenu();
});

applyPanels();

// Virar as peças (verso)
function refreshFlipBtn() {
  ui.btnFlip.classList.toggle('active', state.handFlipped);
  ui.btnFlip.setAttribute('aria-pressed', String(state.handFlipped));
}
ui.btnFlip.addEventListener('click', () => {
  state.handFlipped = !state.handFlipped;
  savePref('flip', state.handFlipped);
  refreshFlipBtn();
  renderHand();
});
refreshFlipBtn();

// Ocultar/mostrar a mão
function refreshHideBtn() {
  ui.btnHide.classList.toggle('active', state.handHidden);
  ui.btnHide.textContent = state.handHidden ? '👁 Mostrar' : '👁 Ocultar';
  ui.btnHide.setAttribute('aria-pressed', String(state.handHidden));
}
ui.btnHide.addEventListener('click', () => {
  state.handHidden = !state.handHidden;
  refreshHideBtn();
  renderHand();
  requestAnimationFrame(relayoutBoard); // o rodapé mudou de altura
});
refreshHideBtn();

// Minimizar painéis (histórico, chat)
document.querySelectorAll('.panel-min').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.dataset.target);
    if (panel) panel.classList.toggle('minimized');
    requestAnimationFrame(relayoutBoard);
  });
});

// ---------- Util ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
}

// Recalcula a dobra da mesa quando a janela muda de tamanho (inclui entrar/sair
// de tela dividida e girar o celular).
let resizeTimer = null;
function relayoutBoard() {
  fitHand();
  if (state.game && state.game.board && state.game.board.length) renderBoard();
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayoutBoard, 80);
});

// Mantém a conexão viva em redes com proxy que derrubam ociosidade.
setInterval(() => send({ type: 'ping' }), 25000);

connect();
