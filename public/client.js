'use strict';

const socket = io();

const BOARD_SIZE = 10;
const EDGE_COLORS = {
  top: '#ff6b6b',
  right: '#6bc1ff',
  bottom: '#ffd76b',
  left: '#b56bff'
};
const MONSTER_LETTER = { vampire: 'V', werewolf: 'W', ghost: 'G' };

let myPlayerId = null;
let myUsername = null;
let latestState = null;
let selectedMonsterId = null;

// --- element refs ---
const screens = {
  lobby: document.getElementById('lobbyScreen'),
  waiting: document.getElementById('waitingScreen'),
  game: document.getElementById('gameScreen'),
  end: document.getElementById('endScreen')
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function toast(message) {
  const el = document.getElementById('errorToast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

// --- lobby ---
document.getElementById('quickPlayBtn').addEventListener('click', () => {
  const username = document.getElementById('usernameInput').value.trim();
  const playerCount = document.getElementById('playerCountSelect').value;
  if (!username) {
    toast('Please enter a username.');
    return;
  }
  myUsername = username;
  socket.emit('lobby:enter', { username });
  socket.emit('lobby:quickplay', { playerCount });
  document.getElementById('waitingText').textContent = `Waiting for a ${playerCount}-player game to fill...`;
  showScreen('waiting');
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  selectedMonsterId = null;
  showScreen('lobby');
});

// --- socket events ---
socket.on('connect', () => {
  socket.emit('stats:global');
});

socket.on('stats:global', (s) => {
  document.getElementById('gamesPlayed').textContent = s.gamesPlayed;
});

socket.on('stats:me', (s) => {
  document.getElementById('myWins').textContent = s.wins;
  document.getElementById('myLosses').textContent = s.losses;
  document.getElementById('myWinsGame').textContent = s.wins;
  document.getElementById('myLossesGame').textContent = s.losses;
});

socket.on('lobby:joined', ({ playerId }) => {
  myPlayerId = playerId;
});

socket.on('error:message', (msg) => toast(msg));

socket.on('game:state', (state) => {
  latestState = state;
  if (state.status === 'waiting') {
    document.getElementById('waitingText').textContent =
      `Waiting for players (${state.players.length}/${state.playerCount})...`;
    showScreen('waiting');
    return;
  }
  if (state.status === 'active') {
    showScreen('game');
    renderGame(state);
    return;
  }
  if (state.status === 'finished') {
    renderGame(state);
    const winner = state.players.find((p) => p.id === state.winnerId);
    document.getElementById('endTitle').textContent = winner ? `${winner.username} wins!` : 'Game Over';
    document.getElementById('endMessage').textContent = winner
      ? (winner.id === myPlayerId ? 'Congratulations, you won!' : `${winner.username} won this match.`)
      : 'The game ended with no survivors.';
    showScreen('end');
  }
});

// --- board rendering ---
function buildBoardSkeleton() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.addEventListener('click', onCellClick);
      board.appendChild(cell);
    }
  }
}
buildBoardSkeleton();

function myPlayer(state) {
  return state.players.find((p) => p.id === myPlayerId);
}

function edgeCellsFor(edge) {
  const cells = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (edge === 'top') cells.push([0, i]);
    else if (edge === 'bottom') cells.push([BOARD_SIZE - 1, i]);
    else if (edge === 'left') cells.push([i, 0]);
    else if (edge === 'right') cells.push([i, BOARD_SIZE - 1]);
  }
  return cells;
}

function renderGame(state) {
  const me = myPlayer(state);

  // clear cells
  document.querySelectorAll('.cell').forEach((cell) => {
    cell.innerHTML = '';
    cell.classList.remove('edge-highlight', 'selectable', 'selected');
  });

  if (me && !me.eliminated) {
    edgeCellsFor(me.edge).forEach(([r, c]) => {
      const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.add('edge-highlight');
    });
  }

  state.monsters.forEach((m) => {
    const cell = document.querySelector(`.cell[data-row="${m.row}"][data-col="${m.col}"]`);
    if (!cell) return;
    const owner = state.players.find((p) => p.id === m.ownerId);
    const div = document.createElement('div');
    div.className = 'monster';
    div.style.background = EDGE_COLORS[owner?.edge] || '#fff';
    div.textContent = MONSTER_LETTER[m.type] || '?';
    div.title = `${owner?.username}'s ${m.type}`;
    if (m.id === selectedMonsterId) {
      cell.classList.add('selected');
    }
    cell.appendChild(div);
  });

  // round + players panel
  document.getElementById('roundNumber').textContent = state.round;
  const list = document.getElementById('playersList');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'player-row' + (p.eliminated ? ' eliminated' : '') + (p.id === myPlayerId ? ' you' : '');
    const status = p.eliminated
      ? 'eliminated'
      : p.turnEnded
      ? 'turn ended'
      : 'playing';
    row.innerHTML = `<span><span class="swatch" style="background:${EDGE_COLORS[p.edge]}"></span>${p.username}${p.id === myPlayerId ? ' (you)' : ''}</span><span>${status} &middot; ${p.monstersLost}/10 lost</span>`;
    list.appendChild(row);
  });

  const logPanel = document.getElementById('logPanel');
  logPanel.innerHTML = '';
  state.log.slice().reverse().forEach((entry) => {
    const div = document.createElement('div');
    div.textContent = entry.message;
    logPanel.appendChild(div);
  });

  const hint = document.getElementById('selectionHint');
  if (!me) {
    hint.textContent = '';
  } else if (me.eliminated) {
    hint.textContent = 'You have been eliminated - spectating.';
  } else if (selectedMonsterId) {
    hint.textContent = 'Monster selected - click a destination square, or click it again to deselect.';
  } else {
    hint.textContent = me.placedThisRound
      ? 'Click one of your monsters to move it.'
      : 'Click a highlighted edge square to place a monster, or click a monster to move it.';
  }
}

function onCellClick(e) {
  if (!latestState) return;
  const row = parseInt(e.currentTarget.dataset.row, 10);
  const col = parseInt(e.currentTarget.dataset.col, 10);
  const me = myPlayer(latestState);
  if (!me || me.eliminated || me.turnEnded) return;

  const occupant = latestState.monsters.find((m) => m.row === row && m.col === col);

  if (selectedMonsterId) {
    if (occupant && occupant.id === selectedMonsterId) {
      selectedMonsterId = null;
      renderGame(latestState);
      return;
    }
    socket.emit('game:move', { monsterId: selectedMonsterId, toRow: row, toCol: col });
    selectedMonsterId = null;
    return;
  }

  if (occupant) {
    if (occupant.ownerId === myPlayerId) {
      selectedMonsterId = occupant.id;
      renderGame(latestState);
    } else {
      toast("That's not your monster.");
    }
    return;
  }

  // empty cell, no selection -> attempt placement on own edge
  const type = document.querySelector('input[name="monsterType"]:checked').value;
  socket.emit('game:place', { type, row, col });
}

document.getElementById('endTurnBtn').addEventListener('click', () => {
  selectedMonsterId = null;
  socket.emit('game:endTurn');
});
