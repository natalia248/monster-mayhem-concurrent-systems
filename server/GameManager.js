'use strict';

const crypto = require('crypto');
const Game = require('./Game');
const Mutex = require('./Mutex');

/**
 * Owns every game currently in memory (waiting or active) and provides
 * matchmaking. Each entry pairs a Game with its own Mutex, so actions on
 * different games are fully independent and run concurrently, while
 * actions on the same game are serialized (see Mutex.js for why).
 */
class GameManager {
  constructor() {
    this.entries = new Map(); // gameId -> { game, mutex, sockets: Map(playerId -> socketId) }
  }

  _entryFor(gameId) {
    const entry = this.entries.get(gameId);
    if (!entry) throw new Error('Game not found');
    return entry;
  }

  createGame(playerCount) {
    const id = crypto.randomUUID().slice(0, 8);
    const game = new Game(id, playerCount);
    this.entries.set(id, { game, mutex: new Mutex(), sockets: new Map() });
    return game;
  }

  findOpenGame(playerCount) {
    for (const entry of this.entries.values()) {
      if (entry.game.status === 'waiting' && entry.game.playerCount === playerCount) {
        return entry.game;
      }
    }
    return null;
  }

  getGame(gameId) {
    return this.entries.get(gameId)?.game || null;
  }

  registerSocket(gameId, playerId, socketId) {
    this._entryFor(gameId).sockets.set(playerId, socketId);
  }

  socketIdFor(gameId, playerId) {
    return this._entryFor(gameId).sockets.get(playerId);
  }

  /** Runs fn(game) with exclusive access to this game's state. */
  async withGame(gameId, fn) {
    const entry = this._entryFor(gameId);
    return entry.mutex.runExclusive(() => fn(entry.game));
  }

  removeGame(gameId) {
    this.entries.delete(gameId);
  }

  /** Periodically drop finished games that have had no socket activity. */
  sweepFinished(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.game.status === 'finished' && now - (entry.finishedAt || now) > maxAgeMs) {
        this.entries.delete(id);
      }
    }
  }

  markFinished(gameId) {
    const entry = this.entries.get(gameId);
    if (entry) entry.finishedAt = Date.now();
  }
}

module.exports = GameManager;
