'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const GameManager = require('./GameManager');
const stats = require('./statsStore');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const manager = new GameManager();

// socket.id -> { username, gameId, playerId }
const sessions = new Map();

function broadcastGlobalStats() {
  io.emit('stats:global', stats.getGlobalStats());
}

function broadcastGameState(gameId) {
  const game = manager.getGame(gameId);
  if (!game) return;
  io.to(gameId).emit('game:state', game.serialize());
}

async function finishGameIfNeeded(gameId) {
  const game = manager.getGame(gameId);
  if (!game || game.status !== 'finished') return;
  manager.markFinished(gameId);
  const usernames = game.players.map((p) => p.username);
  const winnerUsername = game.winnerId ? game.getPlayer(game.winnerId).username : null;
  await stats.recordGameFinished(usernames, winnerUsername);
  broadcastGlobalStats();
  for (const player of game.players) {
    const socketId = manager.socketIdFor(gameId, player.id);
    const socket = socketId && io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('stats:me', stats.getPlayerStats(player.username));
    }
  }
}

io.on('connection', (socket) => {
  socket.emit('stats:global', stats.getGlobalStats());

  socket.on('lobby:enter', ({ username }) => {
    if (!username || typeof username !== 'string' || !username.trim()) {
      socket.emit('error:message', 'Please enter a username.');
      return;
    }
    const clean = username.trim().slice(0, 20);
    sessions.set(socket.id, { username: clean, gameId: null, playerId: null });
    socket.emit('stats:me', stats.getPlayerStats(clean));
    socket.emit('stats:global', stats.getGlobalStats());
  });

  socket.on('lobby:quickplay', async ({ playerCount }) => {
    try {
      const session = sessions.get(socket.id);
      if (!session) throw new Error('Enter a username first');
      const count = Math.min(4, Math.max(2, parseInt(playerCount, 10) || 2));

      let game = manager.findOpenGame(count);
      if (!game) game = manager.createGame(count);

      const state = await manager.withGame(game.id, (g) => {
        const player = g.addPlayer(session.username);
        return { player, snapshot: g.serialize() };
      });

      session.gameId = game.id;
      session.playerId = state.player.id;
      manager.registerSocket(game.id, state.player.id, socket.id);
      socket.join(game.id);

      socket.emit('lobby:joined', {
        gameId: game.id,
        playerId: state.player.id,
        playerCount: count
      });
      broadcastGameState(game.id);
    } catch (err) {
      socket.emit('error:message', err.message);
    }
  });

  socket.on('game:place', async ({ type, row, col }) => {
    const session = sessions.get(socket.id);
    if (!session?.gameId) return;
    try {
      await manager.withGame(session.gameId, (g) => g.place(session.playerId, type, row, col));
      broadcastGameState(session.gameId);
      await finishGameIfNeeded(session.gameId);
    } catch (err) {
      socket.emit('error:message', err.message);
    }
  });

  socket.on('game:move', async ({ monsterId, toRow, toCol }) => {
    const session = sessions.get(socket.id);
    if (!session?.gameId) return;
    try {
      await manager.withGame(session.gameId, (g) => g.move(session.playerId, monsterId, toRow, toCol));
      broadcastGameState(session.gameId);
      await finishGameIfNeeded(session.gameId);
    } catch (err) {
      socket.emit('error:message', err.message);
    }
  });

  socket.on('game:endTurn', async () => {
    const session = sessions.get(socket.id);
    if (!session?.gameId) return;
    try {
      await manager.withGame(session.gameId, (g) => g.endTurn(session.playerId));
      broadcastGameState(session.gameId);
      await finishGameIfNeeded(session.gameId);
    } catch (err) {
      socket.emit('error:message', err.message);
    }
  });

  socket.on('disconnect', async () => {
    const session = sessions.get(socket.id);
    sessions.delete(socket.id);
    if (!session?.gameId) return;
    try {
      const game = manager.getGame(session.gameId);
      if (!game) return;
      await manager.withGame(session.gameId, (g) => {
        const player = g.getPlayer(session.playerId);
        if (player && g.status === 'active' && !player.eliminated) {
          player.disconnected = true;
          player.monstersLost = 10; // treat disconnect as forfeit
          g._checkEliminations();
          g._checkWinCondition();
        }
      });
      broadcastGameState(session.gameId);
      await finishGameIfNeeded(session.gameId);
    } catch (err) {
      // game may already be gone - nothing to do
    }
  });
});

setInterval(() => manager.sweepFinished(), 60 * 1000);

server.listen(PORT, () => {
  console.log(`Monster Mayhem server listening on http://localhost:${PORT}`);
});
