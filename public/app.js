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
  stockPanel: $('#stock-panel'),
  stockGrid: $('#stock-grid'),
  stockPanelCount: $('#stock-panel-count'),
  overlay: $('#overlay'),
  overlayTitle: $('#overlay-title'),
  overlayText: $('#overlay-text'),
  btnRestart: $('#btn-restart'),
  toast: $('#toast'),
};

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
};

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
      showTable();
      break;
    case 'state':
      state.room = msg.room;
      state.game = msg.game;
      state.drawing = false;   // resposta chegou: libera a próxima compra
      render();
      break;
    case 'chat':
      addChat(msg.from, msg.text);
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
  ui.roomCode.textContent = state.room.code;
  renderPlayers();
  renderBoard();
  renderHand();
  renderStatus();
  renderStockPanel();
  renderLog();
}

// Monte visível no canto inferior direito: o jogador escolhe qual peça puxar.
function renderStockPanel() {
  const g = state.game;
  const needsDraw = g
    && g.status === 'playing'
    && g.turn === g.you
    && g.canPlay === false
    && g.stockCount > 0;

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
  track.innerHTML = '';
  if (!g || g.board.length === 0) {
    const p = document.createElement('div');
    p.className = 'board-empty';
    p.id = 'board-empty';
    p.textContent = state.room.status === 'lobby'
      ? 'Aguardando o anfitrião iniciar a partida…'
      : 'Mesa vazia — jogue qualquer peça';
    track.appendChild(p);
  } else {
    for (const slot of g.board) {
      const horizontal = slot.left !== slot.right;
      track.appendChild(tileEl(slot.left, slot.right, { horizontal }));
    }
  }
  renderEnds();
  scrollBoardToLatest(g);
}

// Mantém a corrente numa linha só: rola na horizontal até a ponta onde a peça
// acabou de ser jogada, para a mesa não "quebrar" em várias linhas.
function scrollBoardToLatest(g) {
  const board = ui.board;
  const keyOf = (slot) => `${slot.tile[0]}-${slot.tile[1]}`;

  if (!g || g.board.length === 0) {
    state.prevLen = 0;
    state.prevFirst = null;
    board.scrollLeft = 0;
    return;
  }

  const first = keyOf(g.board[0]);
  const isFirstRender = state.prevLen === null;
  const grew = !isFirstRender && g.board.length > state.prevLen;
  const grewLeft = grew && first !== state.prevFirst;

  state.prevLen = g.board.length;
  state.prevFirst = first;

  // Só mexe na rolagem quando a mesa cresce (ou no primeiro desenho), para não
  // puxar a visão de quem está olhando outra parte da mesa.
  if (!isFirstRender && !grew) return;

  const target = grewLeft ? 0 : board.scrollWidth;
  requestAnimationFrame(() => {
    board.scrollTo({ left: target, behavior: grew ? 'smooth' : 'auto' });
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

function renderHand() {
  const g = state.game;
  ui.hand.innerHTML = '';
  const myHand = g && g.players[g.you] ? g.players[g.you].hand : null;
  if (!myHand) {
    ui.hand.innerHTML = '<span style="color:var(--ink-dim);font-size:14px">Sua mão aparece aqui quando a partida começar.</span>';
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

  for (const t of myHand) {
    const playable = myTurn && legalSides(g, t).length > 0;
    const key = `${t[0]}-${t[1]}`;
    const el = tileEl(t[0], t[1], {
      extraClass: (playable ? '' : 'illegal')
        + (state.selected && state.selected[0] === t[0] && state.selected[1] === t[1] ? ' selected' : '')
        + (key === drawnKey ? ' just-drawn' : ''),
    });
    if (playable) {
      el.addEventListener('click', () => selectTile(t));
    }
    ui.hand.appendChild(el);
  }
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
    ui.turnInfo.textContent = 'Sala aberta';
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
    showOverlay(g);
    return;
  }

  if (g.turn === g.you) {
    ui.turnInfo.innerHTML = '<strong>Sua vez</strong>';
    if (!g.canPlay) {
      if (g.stockCount > 0) {
        ui.actions.innerHTML = '<span class="hint-inline">Compre uma peça no monte →</span>';
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
  const sums = g.players.map((p) => `${p.id}: ${p.handSum ?? 0}`).join(' · ');
  ui.overlayTitle.textContent = title;
  ui.overlayText.textContent = `${text} (${sums})`;
  ui.overlay.classList.remove('hidden');
  const isHost = state.room.hostId === state.myId;
  ui.btnRestart.classList.toggle('hidden', !isHost);
}

$('#btn-restart').addEventListener('click', () => {
  ui.overlay.classList.add('hidden');
  state.overlayShown = false;
  send({ type: 'start' });
});

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

// Mantém a conexão viva em redes com proxy que derrubam ociosidade.
setInterval(() => send({ type: 'ping' }), 25000);

connect();
