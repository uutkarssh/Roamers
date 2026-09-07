import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });
const rooms = new Map();
const PORT = process.env.PORT || 3000;

app.get('/health', (_req, res) => res.json({ ok: true, game: 'Roamers' }));
app.get('*', (_req, res) => res.sendFile('index.html', { root: process.cwd() }));

const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  while (rooms.has(code));
  return code;
};

function publicState(room, meId) {
  return {
    room: { code: room.code, hostId: room.hostId },
    me: room.players.get(meId),
    players: [...room.players.values()],
    chatLog: room.chatLog.slice(-100)
  };
}
function broadcast(room) { io.to(room.code).emit('room:state', publicState(room, null)); }
function endTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function phase(room, name, seconds) {
  room.phase = name;
  room.phaseEndsAt = Date.now() + seconds * 1000;
  io.to(room.code).emit('game:phaseChanged', { phase: name, endsAt: room.phaseEndsAt });
  endTimer(room);
  room.timer = setTimeout(() => advance(room), seconds * 1000);
}
function advance(room) {
  if (room.phase === 'role_reveal') return phase(room, 'hiding', room.hideDuration);
  if (room.phase === 'hiding') return phase(room, 'hunting', room.huntDuration);
  if (room.phase === 'hunting') return finish(room, 'roamer_win');
}
function finish(room, result) {
  endTimer(room);
  room.phase = 'results';
  io.to(room.code).emit('game:ended', {
    result,
    summary: result === 'hunter_win' ? 'The Hunter caught the roamers.' : 'The roamers survived the hunt.',
    eliminations: room.eliminations
  });
}
function startGame(room, settings = {}) {
  if (room.players.size < 3) return;
  room.hunterCountdown = Number(settings.hunterCountdown) || 5;
  room.hideDuration = Number(settings.hidePhaseDuration) || 20;
  room.huntDuration = Number(settings.huntPhaseDuration) || 90;
  const ids = [...room.players.keys()];
  const hunter = ids[Math.floor(Math.random() * ids.length)];
  room.hunterId = hunter;
  room.eliminations = [];
  for (const p of room.players.values()) { p.role = p.id === hunter ? 'HUNTER' : 'ROAMER'; p.status = 'alive'; }
  for (const p of room.players.values()) io.to(p.socketId).emit('game:roleAssigned', p.role);
  phase(room, 'role_reveal', room.hunterCountdown);
  broadcast(room);
}

io.on('connection', socket => {
  socket.on('room:create', ({ name, playerId }) => {
    const code = makeCode();
    const id = playerId || crypto.randomUUID();
    const player = { id, socketId: socket.id, name: String(name || 'Player').slice(0, 24), spriteIndex: 0, status: 'alive', role: 'ROAMER' };
    const room = { code, hostId: id, players: new Map([[id, player]]), chatLog: [], phase: 'lobby', timer: null, eliminations: [] };
    rooms.set(code, room); socket.join(code); socket.data.roomCode = code; socket.data.playerId = id;
    socket.emit('room:created', publicState(room, id));
  });
  socket.on('room:join', ({ code, name, playerId }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room || room.phase !== 'lobby') return socket.emit('room:error', { message: 'Room not found or already started.' });
    const id = playerId || crypto.randomUUID();
    const player = { id, socketId: socket.id, name: String(name || 'Player').slice(0, 24), spriteIndex: room.players.size % 12, status: 'alive', role: 'ROAMER' };
    room.players.set(id, player); socket.join(room.code); socket.data.roomCode = room.code; socket.data.playerId = id;
    socket.emit('room:joined', publicState(room, id)); broadcast(room);
  });
  socket.on('room:rejoin', ({ code, playerId }) => {
    const room = rooms.get(code), player = room?.players.get(playerId);
    if (!room || !player) return;
    player.socketId = socket.id; socket.join(code); socket.data.roomCode = code; socket.data.playerId = playerId;
    socket.emit('room:state', publicState(room, playerId));
    if (room.phase !== 'lobby') socket.emit('game:roleAssigned', player.role);
  });
  socket.on('game:start', settings => { const room = rooms.get(socket.data.roomCode); if (room && room.hostId === socket.data.playerId) startGame(room, settings); });
  socket.on('player:move', ({ dx = 0, dy = 0 }) => {
    const room = rooms.get(socket.data.roomCode), p = room?.players.get(socket.data.playerId); if (!p) return;
    p.x = Math.max(.03, Math.min(.97, (p.x ?? .5) + Number(dx) * .012));
    p.y = Math.max(.06, Math.min(.94, (p.y ?? .5) + Number(dy) * .012));
    io.to(room.code).emit('player:positionUpdate', [...room.players.values()].map(x => ({ id: x.id, x: x.x ?? .5, y: x.y ?? .5 })));
  });
  socket.on('player:eliminate', () => {
    const room = rooms.get(socket.data.roomCode), hunter = room?.players.get(socket.data.playerId); if (!room || room.phase !== 'hunting' || hunter?.role !== 'HUNTER') return;
    const target = [...room.players.values()].find(p => p.role === 'ROAMER' && p.status !== 'eliminated');
    if (!target) return;
    target.status = 'eliminated'; room.eliminations.push({ name: target.name, playerId: target.id, timeRemaining: Math.max(0, Math.ceil((room.phaseEndsAt - Date.now()) / 1000)) });
    io.to(room.code).emit('player:eliminated', target.id);
    if (![...room.players.values()].some(p => p.role === 'ROAMER' && p.status !== 'eliminated')) finish(room, 'hunter_win');
  });
  socket.on('chat:message', ({ text }) => {
    const room = rooms.get(socket.data.roomCode), p = room?.players.get(socket.data.playerId); if (!room || !p || !String(text || '').trim()) return;
    const message = { name: p.name, text: String(text).slice(0, 300), at: Date.now() }; room.chatLog.push(message); io.to(room.code).emit('chat:message', message);
  });
  socket.on('game:playAgain', () => { const room = rooms.get(socket.data.roomCode); if (room && room.hostId === socket.data.playerId) startGame(room, room); });
  socket.on('game:returnLobby', () => { const room = rooms.get(socket.data.roomCode); if (!room) return; endTimer(room); room.phase = 'lobby'; room.hunterId = null; for (const p of room.players.values()) { p.role = 'ROAMER'; p.status = 'alive'; } io.to(room.code).emit('game:phaseChanged', { phase: 'lobby', endsAt: 0 }); broadcast(room); });
  socket.on('disconnect', () => { const room = rooms.get(socket.data.roomCode); const p = room?.players.get(socket.data.playerId); if (p) p.socketId = null; });
});

httpServer.listen(PORT, () => console.log(`Roamers server listening on ${PORT}`));
