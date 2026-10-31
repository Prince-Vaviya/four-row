import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { attachGame } from '../server/game.js';

const app = express();
const server = createServer(app);
const io = new Server(server, { path: '/api/socket.io', transports: ['websocket'], pingInterval: 25000, pingTimeout: 20000, cors: { origin: true } });
attachGame(io);
io.engine.on('connection_error', (error) => {
  console.error('[socket.io] connection error', error.code, error.message);
});
server.on('error', (error) => {
  console.error('[socket.io] HTTP server error', error.code, error.message);
});

export default server;
