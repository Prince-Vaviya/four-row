import crypto from 'node:crypto';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';

const ROWS = 6;
const COLS = 7;
const ROOM_TTL_SECONDS = 86_400;
const RESUME_MS = 90_000;
const memoryRooms = new Map();
const cleanName = (value) => String(value || '').trim().replace(/[<>]/g, '').slice(0, 18) || 'Player';
const makeCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const emptyBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
const newRoom = (code, name, token) => ({ code, board: emptyBoard(), turn: 0, status: 'waiting', winner: null, winningCells: [], lastMove: null,
  players: [{ id: crypto.randomUUID(), name, token, connected: true, disconnectedAt: null }] });
const publicRoom = (room) => ({ code: room.code, board: room.board,
  players: room.players.map(({ id, name, connected }) => ({ id, name, connected })), turn: room.turn,
  status: room.status, winner: room.winner, winningCells: room.winningCells, lastMove: room.lastMove });
const resetRoom = (room) => { room.board = emptyBoard(); room.turn = 0; room.status = room.players.length === 2 ? 'playing' : 'waiting'; room.winner = null; room.winningCells = []; room.lastMove = null; };

function findWin(board, row, col, piece) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[row, col]];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign; let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === piece) { cells.push([r, c]); r += dr * sign; c += dc * sign; }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

const redisCompareAndSet = `
  local current = redis.call('GET', KEYS[1])
  if current == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
    return 1
  end
  return 0
`;

export function attachGame(io) {
  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  let redis = null;
  let ready = Promise.resolve();
  if (redisUrl) {
    const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: 2, retryStrategy: (count) => Math.min(count * 250, 2000) });
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    redis = pubClient;
    ready = Promise.all([pubClient.ping(), subClient.ping()]);
  } else if (process.env.NODE_ENV === 'production') {
    ready = Promise.reject(new Error('REDIS_URL is required for multi-instance game rooms.'));
  }
  ready.catch((error) => {
    const safeMessage = String(error?.message || 'unknown error').replace(/rediss?:\/\/\S+/gi, '[redis-url]');
    console.error('[game] Redis initialization failed', error?.code || error?.name || 'Error', safeMessage);
  });

  const keyFor = (code) => `fourrow:room:${code}`;
  const getRoom = async (code) => {
    if (!redis) return memoryRooms.get(code) || null;
    const raw = await redis.get(keyFor(code));
    return raw ? JSON.parse(raw) : null;
  };
  const createPersistedRoom = async (name, token) => {
    for (let i = 0; i < 10; i += 1) {
      const code = makeCode(); const room = newRoom(code, name, token);
      if (!redis) { if (memoryRooms.has(code)) continue; memoryRooms.set(code, room); return room; }
      const created = await redis.set(keyFor(code), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS, 'NX');
      if (created === 'OK') return room;
    }
    throw new Error('Could not reserve a room code. Please try again.');
  };
  const updateRoom = async (code, update) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const raw = redis ? await redis.get(keyFor(code)) : null;
      const room = redis ? (raw ? JSON.parse(raw) : null) : (memoryRooms.get(code) || null);
      if (!room) return { error: 'That room code was not found. Check it and try again.' };
      const result = update(room);
      if (result?.error) return { error: result.error, room };
      if (!redis) { memoryRooms.set(code, room); return { room, value: result?.value }; }
      const written = await redis.eval(redisCompareAndSet, 1, keyFor(code), raw, JSON.stringify(room), String(ROOM_TTL_SECONDS));
      if (Number(written) === 1) return { room, value: result?.value };
    }
    return { error: 'The room changed at the same time. Please try your move again.' };
  };
  const emitRoom = (room) => io.to(room.code).emit('room:state', publicRoom(room));
  const emitAck = (ack, value) => { if (typeof ack === 'function') ack(value); };

  io.use((_socket, next) => ready.then(() => next()).catch((error) => next(new Error(error.message || 'Realtime service is not ready.'))));
  io.on('connection', (socket) => {
    socket.on('room:create', async ({ name, token } = {}, ack) => {
      try {
        const room = await createPersistedRoom(cleanName(name), String(token || crypto.randomUUID()));
        const player = room.players[0]; socket.data.code = room.code; socket.data.playerId = player.id; socket.data.token = player.token;
        await socket.join(room.code); emitAck(ack, { ok: true, code: room.code, playerId: player.id }); emitRoom(room);
      } catch (error) { emitAck(ack, { ok: false, error: error.message || 'Could not create a room.' }); }
    });

    socket.on('room:join', async ({ code, name, token } = {}, ack) => {
      const roomCode = String(code || '').trim().toUpperCase();
      const playerToken = String(token || crypto.randomUUID());
      const result = await updateRoom(roomCode, (room) => {
        let player = room.players.find((p) => p.token === playerToken);
        if (!player) {
          const expiredIndex = room.players.findIndex((p) => !p.connected && p.disconnectedAt && Date.now() - p.disconnectedAt > RESUME_MS);
          if (expiredIndex >= 0) {
            room.players.splice(expiredIndex, 1); resetRoom(room);
          }
          if (room.players.length >= 2) return { error: 'This room is full. Ask for a fresh invite.' };
          player = { id: crypto.randomUUID(), name: cleanName(name), token: playerToken, connected: true, disconnectedAt: null };
          room.players.push(player);
        } else {
          player.name = cleanName(name); player.connected = true; player.disconnectedAt = null;
        }
        if (room.players.length === 2 && room.status === 'waiting') room.status = 'playing';
        return { value: player.id };
      });
      if (result.error) return emitAck(ack, { ok: false, error: result.error });
      const playerId = result.value;
      socket.data.code = roomCode; socket.data.playerId = playerId; socket.data.token = playerToken;
      await socket.join(roomCode); emitAck(ack, { ok: true, code: roomCode, playerId }); emitRoom(result.room);
    });

    socket.on('move', async ({ code, playerId, column } = {}, ack) => {
      const roomCode = String(code || '').toUpperCase();
      if (socket.data.code !== roomCode || socket.data.playerId !== playerId) return emitAck(ack, { ok: false, error: 'You are no longer in this room. Rejoin to continue.' });
      const result = await updateRoom(roomCode, (room) => {
        const playerIndex = room.players.findIndex((p) => p.id === playerId && p.token === socket.data.token);
        if (playerIndex < 0) return { error: 'You are no longer in this room. Rejoin to continue.' };
        if (room.status !== 'playing') return { error: 'The game is not accepting moves right now.' };
        if (playerIndex !== room.turn) return { error: 'It is the other player’s turn.' };
        if (!Number.isInteger(column) || column < 0 || column >= COLS || room.board[0][column] !== 0) return { error: 'That column is full. Choose another.' };
        let row = ROWS - 1;
        while (room.board[row][column] !== 0) row -= 1;
        const piece = playerIndex + 1; room.board[row][column] = piece; room.lastMove = { row, column };
        const winningCells = findWin(room.board, row, column, piece);
        if (winningCells) { room.status = 'won'; room.winner = playerId; room.winningCells = winningCells; }
        else if (room.board[0].every(Boolean)) room.status = 'draw';
        else room.turn = 1 - room.turn;
        return {};
      });
      if (result.error) return emitAck(ack, { ok: false, error: result.error });
      emitAck(ack, { ok: true }); emitRoom(result.room);
    });

    socket.on('game:rematch', async ({ code, playerId } = {}, ack) => {
      const roomCode = String(code || '').toUpperCase();
      if (socket.data.code !== roomCode || socket.data.playerId !== playerId) return emitAck(ack, { ok: false, error: 'Rejoin the room to start a rematch.' });
      const result = await updateRoom(roomCode, (room) => {
        if (!room.players.some((p) => p.id === playerId && p.token === socket.data.token)) return { error: 'Rejoin the room to start a rematch.' };
        if (room.status !== 'won' && room.status !== 'draw') return { error: 'Finish this game before starting a rematch.' };
        resetRoom(room); return {};
      });
      if (result.error) return emitAck(ack, { ok: false, error: result.error });
      emitAck(ack, { ok: true }); emitRoom(result.room);
    });

    socket.on('room:leave', async ({ code, playerId } = {}) => {
      const roomCode = String(code || '').toUpperCase();
      if (socket.data.code !== roomCode || socket.data.playerId !== playerId) return;
      const result = await updateRoom(roomCode, (room) => {
        const index = room.players.findIndex((p) => p.id === playerId && p.token === socket.data.token);
        if (index < 0) return { error: 'Player is no longer in this room.' };
        room.players.splice(index, 1); resetRoom(room); return {};
      });
      socket.leave(roomCode); socket.data.code = null; socket.data.playerId = null;
      if (result.room) emitRoom(result.room);
    });

    socket.on('disconnect', () => {
      const { code, playerId, token } = socket.data;
      if (!code || !playerId || !token) return;
      void updateRoom(code, (room) => {
        const player = room.players.find((p) => p.id === playerId && p.token === token);
        if (player) { player.connected = false; player.disconnectedAt = Date.now(); }
        return {};
      }).then((result) => { if (result.room) emitRoom(result.room); }).catch((error) => console.error('Disconnect update failed:', error));
    });
  });
}
