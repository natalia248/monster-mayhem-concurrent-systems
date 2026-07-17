'use strict';

const fs = require('fs');
const path = require('path');
const Mutex = require('./Mutex');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

/**
 * Persists global + per-player stats to disk. All reads happen from the
 * in-memory cache; every write is funneled through a single Mutex so that
 * concurrent game-end events (from different, unrelated games finishing at
 * the same moment) can't interleave their file writes and corrupt the JSON.
 */
class StatsStore {
  constructor() {
    this._mutex = new Mutex();
    this._data = this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(STATS_FILE)) {
        const raw = fs.readFileSync(STATS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          gamesPlayed: parsed.gamesPlayed || 0,
          players: parsed.players || {}
        };
      }
    } catch (err) {
      console.error('Failed to load stats.json, starting fresh:', err.message);
    }
    return { gamesPlayed: 0, players: {} };
  }

  _persist() {
    return this._mutex.runExclusive(async () => {
      const tmp = STATS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this._data, null, 2));
      fs.renameSync(tmp, STATS_FILE);
    });
  }

  getGlobalStats() {
    return { gamesPlayed: this._data.gamesPlayed };
  }

  getPlayerStats(username) {
    const p = this._data.players[username];
    return p ? { ...p } : { wins: 0, losses: 0 };
  }

  recordGameFinished(usernames, winnerUsername) {
    this._data.gamesPlayed += 1;
    for (const username of usernames) {
      if (!this._data.players[username]) {
        this._data.players[username] = { wins: 0, losses: 0 };
      }
      if (username === winnerUsername) {
        this._data.players[username].wins += 1;
      } else {
        this._data.players[username].losses += 1;
      }
    }
    return this._persist();
  }
}

module.exports = new StatsStore();
