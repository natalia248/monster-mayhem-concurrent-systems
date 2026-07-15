'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

server.listen(PORT, () => {
  console.log(`Monster Mayhem server listening on http://localhost:${PORT}`);
});
