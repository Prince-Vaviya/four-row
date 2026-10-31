import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { attachGame } from '../server/game.js';

const server = createServer();
const io = new Server(server, { path: '/api/socket.io', transports: ['websocket'], pingInterval: 25000, pingTimeout: 20000, cors: { origin: true } });
attachGame(io);

export default server;
