'use strict';

const crypto = require('crypto');

const BOARD_SIZE = 10;
const MONSTERS_TO_ELIMINATE = 10;
// Which edges are used for a given player count, chosen so players face
// each other across the board rather than bunching into adjacent corners.
const EDGE_ASSIGNMENTS = {
  2: ['top', 'bottom'],
  3: ['top', 'right', 'bottom'],
  4: ['top', 'right', 'bottom', 'left']
};

// vampire beats werewolf, werewolf beats ghost, ghost beats vampire
const BEATS = {
  vampire: 'werewolf',
  werewolf: 'ghost',
  ghost: 'vampire'
};

const VALID_TYPES = new Set(['vampire', 'werewolf', 'ghost']);

function edgeCells(edge) {
  const cells = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (edge === 'top') cells.push({ row: 0, col: i });
    else if (edge === 'bottom') cells.push({ row: BOARD_SIZE - 1, col: i });
    else if (edge === 'left') cells.push({ row: i, col: 0 });
    else if (edge === 'right') cells.push({ row: i, col: BOARD_SIZE - 1 });
  }
  return cells;
}

/**
 * Game encapsulates the full rules engine for one match of Monster Mayhem:
 * board state, placement, movement, combat resolution, simultaneous
 * turns/rounds, elimination and win detection. It has no knowledge of
 * sockets - GameManager/index.js is responsible for wiring this up to the
 * network layer and for serializing concurrent access via Mutex.
 */
class Game {
  constructor(id, playerCount) {
    this.id = id;
    this.playerCount = playerCount;
    this.status = 'waiting'; // waiting -> active -> finished
    this.round = 1;
    this.players = []; // { id, username, edge, eliminated, monstersLost, placedThisRound, turnEnded, wins }
    this.monsters = new Map(); // id -> monster
    this.winnerId = null;
    this.log = [];
  }

  addPlayer(username) {
    if (this.players.length >= this.playerCount) {
      throw new Error('Game is full');
    }
    const edge = EDGE_ASSIGNMENTS[this.playerCount][this.players.length];
    const player = {
      id: crypto.randomUUID(),
      username,
      edge,
      eliminated: false,
      disconnected: false,
      monstersLost: 0,
      placedThisRound: false,
      turnEnded: false
    };
    this.players.push(player);
    if (this.players.length === this.playerCount) {
      this.status = 'active';
      this._pushLog(`Game started - ${this.playerCount} players, round 1.`);
    }
    return player;
  }

  getPlayer(playerId) {
    return this.players.find((p) => p.id === playerId);
  }

  activePlayers() {
    return this.players.filter((p) => !p.eliminated);
  }

  _pushLog(message) {
    this.log.push({ message, ts: Date.now() });
    if (this.log.length > 200) this.log.shift();
  }

  _monsterAt(row, col) {
    for (const m of this.monsters.values()) {
      if (m.row === row && m.col === col) return m;
    }
    return null;
  }

  _assertActive() {
    if (this.status !== 'active') {
      throw new Error('Game is not active');
    }
  }

  _assertPlayerCanAct(player) {
    if (!player) throw new Error('Unknown player');
    if (player.eliminated) throw new Error('Player has been eliminated');
    if (player.turnEnded) throw new Error('Player has already ended their turn this round');
  }

  place(playerId, type, row, col) {
    this._assertActive();
    const player = this.getPlayer(playerId);
    this._assertPlayerCanAct(player);
    if (!VALID_TYPES.has(type)) throw new Error('Invalid monster type');
    if (player.placedThisRound) throw new Error('Already placed a monster this round');

    const onEdge = edgeCells(player.edge).some((c) => c.row === row && c.col === col);
    if (!onEdge) throw new Error('Placement must be on your own edge');
    if (this._monsterAt(row, col)) throw new Error('Square is occupied');

    const monster = {
      id: crypto.randomUUID(),
      ownerId: player.id,
      type,
      row,
      col,
      justPlaced: true,
      movedThisRound: false
    };
    this.monsters.set(monster.id, monster);
    player.placedThisRound = true;
    this._pushLog(`${player.username} placed a ${type} at (${row}, ${col}).`);

    this._autoEndTurnIfNoActions(player);
    return monster;
  }

  _pathClear(fromRow, fromCol, toRow, toCol, playerId) {
    const dr = Math.sign(toRow - fromRow);
    const dc = Math.sign(toCol - fromCol);
    let r = fromRow + dr;
    let c = fromCol + dc;
    while (r !== toRow || c !== toCol) {
      const occupant = this._monsterAt(r, c);
      if (occupant && occupant.ownerId !== playerId) return false;
      r += dr;
      c += dc;
    }
    return true;
  }

  _isLegalMoveShape(fromRow, fromCol, toRow, toCol) {
    const dr = toRow - fromRow;
    const dc = toCol - fromCol;
    if (dr === 0 && dc === 0) return false;
    if (dr === 0 || dc === 0) return true; // any distance, straight line
    if (Math.abs(dr) === Math.abs(dc) && Math.abs(dr) <= 2) return true; // diagonal, max 2
    return false;
  }

  move(playerId, monsterId, toRow, toCol) {
    this._assertActive();
    const player = this.getPlayer(playerId);
    this._assertPlayerCanAct(player);

    if (toRow < 0 || toRow >= BOARD_SIZE || toCol < 0 || toCol >= BOARD_SIZE) {
      throw new Error('Destination is off the board');
    }

    const monster = this.monsters.get(monsterId);
    if (!monster || monster.ownerId !== playerId) throw new Error('Not your monster');
    if (monster.justPlaced) throw new Error('A monster cannot move the round it was placed');
    if (monster.movedThisRound) throw new Error('That monster has already moved this round');

    if (!this._isLegalMoveShape(monster.row, monster.col, toRow, toCol)) {
      throw new Error('Illegal move shape - straight line any distance, or diagonal up to 2 squares');
    }
    if (!this._pathClear(monster.row, monster.col, toRow, toCol, playerId)) {
      throw new Error('Path is blocked by an opposing monster');
    }

    const defender = this._monsterAt(toRow, toCol);
    let outcome = 'moved';
    let removedIds = [];

    if (defender) {
      if (defender.ownerId === playerId) {
        throw new Error('You cannot land on your own monster');
      }
      const result = this._resolveCombat(monster, defender);
      outcome = result.outcome;
      removedIds = result.removedIds;
    } else {
      monster.row = toRow;
      monster.col = toCol;
    }

    monster.movedThisRound = true;
    this._pushLog(`${player.username} moved a ${monster.type}${defender ? ` (combat: ${outcome})` : ''}.`);

    const eliminatedNow = this._checkEliminations();
    const winner = this._checkWinCondition();

    this._autoEndTurnIfNoActions(player);

    return { outcome, removedIds, eliminatedNow, winner };
  }

  _resolveCombat(mover, defender) {
    const removedIds = [];
    if (mover.type === defender.type) {
      removedIds.push(mover.id, defender.id);
      this.monsters.delete(mover.id);
      this.monsters.delete(defender.id);
      this.getPlayer(mover.ownerId).monstersLost += 1;
      this.getPlayer(defender.ownerId).monstersLost += 1;
      return { outcome: 'mutual-destruction', removedIds };
    }

    if (BEATS[mover.type] === defender.type) {
      // mover wins, occupies the square
      removedIds.push(defender.id);
      this.monsters.delete(defender.id);
      this.getPlayer(defender.ownerId).monstersLost += 1;
      mover.row = defender.row;
      mover.col = defender.col;
      return { outcome: 'attacker-wins', removedIds };
    }

    // defender wins, mover is destroyed and does not move
    removedIds.push(mover.id);
    this.monsters.delete(mover.id);
    this.getPlayer(mover.ownerId).monstersLost += 1;
    return { outcome: 'defender-wins', removedIds };
  }

  _checkEliminations() {
    const eliminatedNow = [];
    for (const player of this.players) {
      if (!player.eliminated && player.monstersLost >= MONSTERS_TO_ELIMINATE) {
        player.eliminated = true;
        player.turnEnded = true;
        eliminatedNow.push(player.id);
        for (const [mid, m] of this.monsters) {
          if (m.ownerId === player.id) this.monsters.delete(mid);
        }
        this._pushLog(`${player.username} has been eliminated.`);
      }
    }
    return eliminatedNow;
  }

  _checkWinCondition() {
    if (this.status !== 'active') return this.winnerId;
    const remaining = this.activePlayers();
    if (remaining.length <= 1) {
      this.status = 'finished';
      this.winnerId = remaining.length === 1 ? remaining[0].id : null;
      this._pushLog(
        this.winnerId
          ? `${this.getPlayer(this.winnerId).username} wins the game!`
          : 'The game ended in a mutual elimination draw.'
      );
    }
    return this.winnerId;
  }

  endTurn(playerId) {
    this._assertActive();
    const player = this.getPlayer(playerId);
    this._assertPlayerCanAct(player);
    player.turnEnded = true;
    this._pushLog(`${player.username} ended their turn.`);
    return this._maybeAdvanceRound();
  }

  _hasAvailableActions(player) {
    if (!player.placedThisRound) return true;
    for (const m of this.monsters.values()) {
      if (m.ownerId === player.id && !m.justPlaced && !m.movedThisRound) return true;
    }
    return false;
  }

  _autoEndTurnIfNoActions(player) {
    if (!player.eliminated && !player.turnEnded && !this._hasAvailableActions(player)) {
      player.turnEnded = true;
      this._pushLog(`${player.username} has no further actions - turn auto-ended.`);
      this._maybeAdvanceRound();
    }
  }

  _maybeAdvanceRound() {
    if (this.status !== 'active') return false;
    const active = this.activePlayers();
    const allDone = active.every((p) => p.turnEnded);
    if (!allDone) return false;

    this.round += 1;
    for (const player of active) {
      player.turnEnded = false;
      player.placedThisRound = false;
    }
    for (const m of this.monsters.values()) {
      m.justPlaced = false;
      m.movedThisRound = false;
    }
    this._pushLog(`Round ${this.round} begins.`);
    return true;
  }

  serialize() {
    return {
      id: this.id,
      status: this.status,
      playerCount: this.playerCount,
      round: this.round,
      winnerId: this.winnerId,
      players: this.players.map((p) => ({
        id: p.id,
        username: p.username,
        edge: p.edge,
        eliminated: p.eliminated,
        disconnected: !!p.disconnected,
        monstersLost: p.monstersLost,
        placedThisRound: p.placedThisRound,
        turnEnded: p.turnEnded
      })),
      monsters: Array.from(this.monsters.values()),
      log: this.log.slice(-30)
    };
  }
}

Game.BOARD_SIZE = BOARD_SIZE;
Game.edgeCells = edgeCells;

module.exports = Game;
