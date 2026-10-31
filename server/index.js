import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const app = express();
const server = createServer(app);
const io = new Server(server, { pingInterval: 25000, pingTimeout: 20000, cors: { origin: true } });
const rooms = new Map();
const ROWS = 6;
const COLS = 7;
const RESUME_MS = 90_000;

const cleanName = (value) => String(value || '').trim().replace(/[<>]/g, '').slice(0, 18) || 'Player';
const makeCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const publicRoom = (room) => ({
  code: room.code,
  board: room.board,
  players: room.players.map(({ id, name, connected }) => ({ id, name, connected })),
  turn: room.turn,
  status: room.status,
  winner: room.winner,
  winningCells: room.winningCells,
  lastMove: room.lastMove,
});
const emitRoom = (room) => io.to(room.code).emit('room:state', publicRoom(room));
const findWin = (board, row, col, piece) => {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[row, col]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === piece) {
        cells.push([r, c]); r += dr * sign; c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
};
const resetRoom = (room) => {
  room.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  room.turn = 0; room.status = 'waiting'; room.winner = null; room.winningCells = []; room.lastMove = null;
};
const createRoom = (name, token, socket) => {
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const room = { code, board: Array.from({ length: ROWS }, () => Array(COLS).fill(0)), turn: 0, status: 'waiting', winner: null, winningCells: [], lastMove: null,
    players: [{ id: crypto.randomUUID(), name, token, connected: true, socketId: socket.id, timer: null }] };
  rooms.set(code, room);
  return room;
};

io.on('connection', (socket) => {
  socket.on('room:create', ({ name, token } = {}, ack = () => {}) => {
    const room = createRoom(cleanName(name), String(token || crypto.randomUUID()), socket);
    socket.join(room.code);
    ack({ ok: true, code: room.code, playerId: room.players[0].id });
    emitRoom(room);
  });

  socket.on('room:join', ({ code, name, token } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').trim().toUpperCase());
    if (!room) return ack({ ok: false, error: 'That room code was not found. Check it and try again.' });
    const playerToken = String(token || crypto.randomUUID());
    let player = room.players.find((p) => p.token === playerToken);
    if (!player && room.players.length >= 2) return ack({ ok: false, error: 'This room is full. Ask for a fresh invite.' });
    if (!player) {
      player = { id: crypto.randomUUID(), name: cleanName(name), token: playerToken, connected: true, socketId: socket.id, timer: null };
      room.players.push(player);
    } else {
      clearTimeout(player.timer); player.name = cleanName(name); player.connected = true; player.socketId = socket.id;
    }
    socket.join(room.code);
    if (room.players.length === 2 && room.status === 'waiting') room.status = 'playing';
    ack({ ok: true, code: room.code, playerId: player.id });
    emitRoom(room);
  });

  socket.on('move', ({ code, playerId, column } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const playerIndex = room?.players.findIndex((p) => p.id === playerId && p.socketId === socket.id);
    if (!room || playerIndex < 0) return ack({ ok: false, error: 'You are no longer in this room. Rejoin to continue.' });
    if (room.status !== 'playing') return ack({ ok: false, error: 'The game is not accepting moves right now.' });
    if (playerIndex !== room.turn) return ack({ ok: false, error: 'It is the other player’s turn.' });
    if (!Number.isInteger(column) || column < 0 || column >= COLS || room.board[0][column] !== 0) return ack({ ok: false, error: 'That column is full. Choose another.' });
    let row = ROWS - 1;
    while (room.board[row][column] !== 0) row -= 1;
    const piece = playerIndex + 1;
    room.board[row][column] = piece;
    room.lastMove = { row, column };
    const winningCells = findWin(room.board, row, column, piece);
    if (winningCells) { room.status = 'won'; room.winner = playerId; room.winningCells = winningCells; }
    else if (room.board[0].every(Boolean)) room.status = 'draw';
    else room.turn = 1 - room.turn;
    ack({ ok: true }); emitRoom(room);
  });

  socket.on('game:rematch', ({ code, playerId } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || !room.players.some((p) => p.id === playerId && p.socketId === socket.id)) return ack({ ok: false, error: 'Rejoin the room to start a rematch.' });
    if (room.status !== 'won' && room.status !== 'draw') return ack({ ok: false, error: 'Finish this game before starting a rematch.' });
    resetRoom(room); room.status = room.players.length === 2 ? 'playing' : 'waiting';
    ack({ ok: true }); emitRoom(room);
  });

  socket.on('room:leave', ({ code, playerId } = {}) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room?.players.find((p) => p.id === playerId && p.socketId === socket.id);
    if (!player) return;
    clearTimeout(player.timer); room.players = room.players.filter((p) => p !== player); socket.leave(room.code);
    if (!room.players.length) rooms.delete(room.code);
    else { resetRoom(room); emitRoom(room); }
  });

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) continue;
      player.connected = false; emitRoom(room);
      player.timer = setTimeout(() => {
        if (player.connected) return;
        room.players = room.players.filter((p) => p !== player);
        resetRoom(room);
        if (!room.players.length) rooms.delete(room.code); else emitRoom(room);
      }, RESUME_MS);
    }
  });
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(root, '../dist')));
app.get('*path', (_req, res) => res.sendFile(path.resolve(root, '../dist/index.html')));

const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => console.log(`Four in a Row listening on ${port}`));
