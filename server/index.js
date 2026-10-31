import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attachGame } from './game.js';

const app = express();
const server = createServer(app);
const io = new Server(server, { path: '/api/socket.io', addTrailingSlash: false, pingInterval: 25000, pingTimeout: 20000, cors: { origin: true } });
attachGame(io);

const root = path.dirname(fileURLToPath(import.meta.url));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.resolve(root, '../dist')));
app.get('*path', (_req, res) => res.sendFile(path.resolve(root, '../dist/index.html')));

const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => console.log(`Four in a Row listening on ${port}`));
