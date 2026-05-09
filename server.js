const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Room = require('./server/Room');
const Player = require('./server/Player');
const GameEngine = require('./server/GameEngine');
const { RECONNECT_TIMEOUT_MS } = require('./server/constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 8 * 1024, // 8 KB — reject oversized messages
  cors: {
    origin: (origin, callback) => {
      // Allow no-origin (same-origin requests), localhost dev, and the production domain
      const allowed = [
        undefined, // same-origin / server-side
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ];
      // Also allow any Render deploy URL or custom domain — add yours here
      const PRODUCTION_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://uwongo-bar.onrender.com';
      if (PRODUCTION_ORIGIN) allowed.push(PRODUCTION_ORIGIN);

      if (allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`Blocked connection from origin: ${origin}`);
        callback(new Error('Origin not allowed'));
      }
    },
  },
});

app.use(express.static('public'));

// ========== HELPERS ==========

/** Strip HTML tags, trim, truncate — prevent XSS at the source */
function sanitizeName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.replace(/<[^>]*>/g, '').trim().substring(0, 20);
  return clean.length > 0 ? clean : null;
}

/** Sanitize chat message text */
function sanitizeMessage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const clean = raw.replace(/<[^>]*>/g, '').trim().substring(0, 100);
  return clean.length > 0 ? clean : null;
}

// ========== RATE LIMITER ==========
const rateLimits = new Map(); // socketId -> { eventName -> [timestamps] }

/**
 * Returns true if the event should be BLOCKED for this socket.
 * Allows `maxCount` events per `windowMs` milliseconds.
 */
function isRateLimited(socketId, eventName, maxCount = 3, windowMs = 5000) {
  if (!rateLimits.has(socketId)) rateLimits.set(socketId, {});
  const bucket = rateLimits.get(socketId);
  const now = Date.now();

  if (!bucket[eventName]) bucket[eventName] = [];
  // Prune old timestamps
  bucket[eventName] = bucket[eventName].filter(ts => ts > now - windowMs);

  if (bucket[eventName].length >= maxCount) {
    return true; // blocked
  }
  bucket[eventName].push(now);
  return false;
}

/** Rate-limited events and their limits */
const RATE_LIMITED_EVENTS = {
  create_room:  { max: 2, window: 5000 },
  join_room:    { max: 3, window: 5000 },
  play_cards:   { max: 3, window: 5000 },
  call_liar:    { max: 2, window: 5000 },
  send_emoji:   { max: 3, window: 5000 },
  lobby_chat:   { max: 3, window: 5000 },
  kick_player:  { max: 2, window: 5000 },
};

// ========== STATE ==========
const rooms = new Map(); // roomCode -> Room
const games = new Map(); // roomCode -> GameEngine
const playerRooms = new Map(); // socketId -> roomCode
const disconnectedPlayers = new Map(); // oldSocketId -> { roomCode, playerId, timeout }

// ========== SOCKET HANDLERS ==========
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Per-socket rate-limit check helper
  function rateCheck(eventName) {
    const cfg = RATE_LIMITED_EVENTS[eventName];
    if (!cfg) return false;
    if (isRateLimited(socket.id, eventName, cfg.max, cfg.window)) {
      socket.emit('error', { message: 'Too many requests — slow down!' });
      return true; // blocked
    }
    return false;
  }

  // Clean up rate-limit data when socket disconnects
  socket.on('disconnect', () => {
    rateLimits.delete(socket.id);
  });

  // ---------- CREATE ROOM ----------
  socket.on('create_room', ({ playerName }) => {
    if (rateCheck('create_room')) return;
    const name = sanitizeName(playerName);
    if (!name) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }

    const player = new Player(socket.id, name);
    const code = Room.generateCode(rooms);
    const room = new Room(code, player);

    rooms.set(code, room);
    playerRooms.set(socket.id, code);

    socket.join(code);

    socket.emit('room_created', {
      roomCode: code,
      players: room.getPlayerList(),
      hostId: room.hostId,
      playerId: socket.id,
      settings: room.settings,
    });

    console.log(`Room ${code} created by ${name}`);
  });

  // ---------- JOIN ROOM ----------
  socket.on('join_room', ({ roomCode, playerName }) => {
    if (rateCheck('join_room')) return;
    const name = sanitizeName(playerName);
    if (!name) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }

    const code = roomCode?.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Duplicate name check (case-insensitive)
    const nameLower = name.toLowerCase();
    const hasDuplicate = [...room.players.values()].some(
      p => p.name.toLowerCase() === nameLower && p.isConnected
    );
    if (hasDuplicate) {
      socket.emit('error', { message: 'A player with that name is already in the room' });
      return;
    }

    // Check if this player is currently disconnected
    let foundDisconnected = null;
    for (const [oldId, data] of disconnectedPlayers) {
      if (data.roomCode === code && data.playerName === name) {
        foundDisconnected = { oldId, data };
        break;
      }
    }

    if (foundDisconnected) {
      const { oldId, data } = foundDisconnected;
      clearTimeout(data.timeout);
      disconnectedPlayers.delete(oldId);

      const engine = games.get(code);
      if (engine) {
        const success = engine.handleReconnect(oldId, socket.id);
        if (success) {
          playerRooms.set(socket.id, code);
          socket.join(code);

          const player = room.getPlayer(socket.id);
          socket.emit('reconnect_success', {
            roomCode: code,
            playerId: socket.id,
            hand: player.hand,
            players: engine.getPlayersInfo(socket.id),
            gameState: engine.getState(),
          });
          return;
        }
      } else {
         // Reconnecting to lobby
         const player = room.getPlayer(oldId);
         if (player) {
           room.players.delete(oldId);
           player.id = socket.id;
           player.socketId = socket.id;
           player.isConnected = true;
           room.players.set(socket.id, player);
           if (room.hostId === oldId) room.hostId = socket.id;
           
           playerRooms.set(socket.id, code);
           socket.join(code);
           
           socket.emit('room_joined', {
             roomCode: code,
             players: room.getPlayerList(),
             hostId: room.hostId,
             playerId: socket.id,
             settings: room.settings,
           });
           
           socket.to(code).emit('player_list_update', {
             players: room.getPlayerList(),
             hostId: room.hostId,
           });
           return;
         }
      }
    }

    // Normal join flow
    const player = new Player(socket.id, name);
    const result = room.addPlayer(player);

    if (!result.success) {
      socket.emit('error', { message: result.error });
      return;
    }

    playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit('room_joined', {
      roomCode: code,
      players: room.getPlayerList(),
      hostId: room.hostId,
      playerId: socket.id,
      settings: room.settings,
    });

    // Notify others
    socket.to(code).emit('player_list_update', {
      players: room.getPlayerList(),
      hostId: room.hostId,
    });

    console.log(`${name} joined room ${code}`);
  });

  // ---------- PLAYER READY ----------
  socket.on('player_ready', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.getPlayer(socket.id);
    if (!player) return;

    player.isReady = !player.isReady;

    io.to(roomCode).emit('player_list_update', {
      players: room.getPlayerList(),
      hostId: room.hostId,
    });
  });

  // ---------- UPDATE SETTINGS ----------
  socket.on('update_settings', ({ roomCode, settings }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can change settings' });
      return;
    }

    const updatedSettings = room.updateSettings(settings);
    io.to(roomCode).emit('settings_updated', { settings: updatedSettings });
  });

  // ---------- START GAME ----------
  socket.on('start_game', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Only host can start
    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can start the game' });
      return;
    }

    if (!room.canStart()) {
      socket.emit('error', { message: 'Need at least 2 players to start' });
      return;
    }

    const engine = new GameEngine(room, io);
    games.set(roomCode, engine);

    const result = engine.startGame();
    if (!result.success) {
      socket.emit('error', { message: result.error });
      games.delete(roomCode);
    }
  });

  // ---------- PLAY CARDS ----------
  socket.on('play_cards', ({ roomCode, cardIds, declaredRank, declaredCount }) => {
    if (rateCheck('play_cards')) return;
    const engine = games.get(roomCode);
    if (!engine) return;

    const result = engine.playCards(socket.id, cardIds, declaredRank, declaredCount);
    if (!result.success) {
      socket.emit('error', { message: 'Invalid action' });
    }
  });

  // ---------- CALL LIAR ----------
  socket.on('call_liar', ({ roomCode }) => {
    if (rateCheck('call_liar')) return;
    const engine = games.get(roomCode);
    if (!engine) return;

    const result = engine.callLiar(socket.id);
    if (!result.success) {
      socket.emit('error', { message: 'Invalid action' });
    }
  });

  // ---------- SELECT TARGET ----------
  socket.on('select_target', ({ roomCode, targetId }) => {
    const engine = games.get(roomCode);
    if (!engine) return;

    const result = engine.selectTarget(socket.id, targetId);
    if (!result.success) {
      socket.emit('error', { message: 'Invalid action' });
    }
  });

  // ---------- LEAVE ROOM ----------
  socket.on('leave_room', ({ roomCode }) => {
    handlePlayerLeave(socket, roomCode);
  });

  // ---------- PLAY AGAIN ----------
  socket.on('play_again', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Reset room state
    room.state = 'waiting';
    for (const player of room.players.values()) {
      player.isReady = false;
      player.hand = [];
      player.resetRevolver();
    }

    games.delete(roomCode);

    io.to(roomCode).emit('back_to_lobby', {
      players: room.getPlayerList(),
      hostId: room.hostId,
    });
  });

  // ---------- EMOJI ----------
  socket.on('send_emoji', ({ roomCode, emoji }) => {
    if (rateCheck('send_emoji')) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.getPlayer(socket.id);
    if (!player) return;

    socket.to(roomCode).emit('emoji_received', {
      playerId: socket.id,
      playerName: player.name,
      emoji,
    });
  });

  // ---------- LOBBY CHAT ----------
  socket.on('lobby_chat', ({ roomCode, message }) => {
    if (rateCheck('lobby_chat')) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const player = room.getPlayer(socket.id);
    if (!player) return;
    const text = sanitizeMessage(message);
    if (!text) return;

    io.to(roomCode).emit('lobby_chat_message', {
      playerName: player.name,
      message: text,
      teamIndex: player.teamIndex,
    });
  });

  // ---------- KICK PLAYER ----------
  socket.on('kick_player', ({ roomCode, targetId }) => {
    if (rateCheck('kick_player')) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    if (socket.id !== room.hostId) {
      socket.emit('error', { message: 'Only the host can kick players' });
      return;
    }
    if (room.state !== 'waiting') {
      socket.emit('error', { message: 'Cannot kick during a game' });
      return;
    }
    if (targetId === socket.id) return; // Can't kick yourself

    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked', { message: 'You were kicked from the room' });
      targetSocket.leave(roomCode);
    }

    room.removePlayer(targetId);
    playerRooms.delete(targetId);

    io.to(roomCode).emit('player_list_update', {
      players: room.getPlayerList(),
      hostId: room.hostId,
    });
  });

  // ---------- DISCONNECT ----------
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const roomCode = playerRooms.get(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (!room) return;

    const engine = games.get(roomCode);

    if (engine && engine.state !== 'lobby' && engine.state !== 'game_over') {
      // Mid-game disconnect — give reconnection window
      const player = room.getPlayer(socket.id);
      if (player) {
        engine.handleDisconnect(socket.id);

        // Set reconnection timeout
        const timeout = setTimeout(() => {
          // Player didn't reconnect in time — eliminate them
          engine.handleReconnectTimeout(socket.id);
          disconnectedPlayers.delete(socket.id);
        }, RECONNECT_TIMEOUT_MS);

        disconnectedPlayers.set(socket.id, {
          roomCode,
          playerId: socket.id,
          playerName: player.name,
          timeout,
        });
      }
    } else {
      // In lobby — just remove
      handlePlayerLeave(socket, roomCode);
    }
  });

  // ---------- RECONNECT ----------
  socket.on('reconnect_attempt', ({ roomCode, playerName }) => {
    // Find disconnected player by name and room
    let found = null;
    for (const [oldId, data] of disconnectedPlayers) {
      if (data.roomCode === roomCode && data.playerName === playerName) {
        found = { oldId, data };
        break;
      }
    }

    if (!found) {
      socket.emit('error', { message: 'No disconnected session found' });
      return;
    }

    const { oldId, data } = found;
    clearTimeout(data.timeout);
    disconnectedPlayers.delete(oldId);

    const engine = games.get(roomCode);
    if (!engine) return;

    const success = engine.handleReconnect(oldId, socket.id);
    if (success) {
      playerRooms.delete(oldId);
      playerRooms.set(socket.id, roomCode);
      socket.join(roomCode);

      const room = rooms.get(roomCode);
      const player = room.getPlayer(socket.id);

      socket.emit('reconnect_success', {
        roomCode,
        playerId: socket.id,
        hand: player.hand,
        players: engine.getPlayersInfo(socket.id),
        gameState: engine.getState(),
      });
    }
  });
});

// ========== HELPERS ==========
function handlePlayerLeave(socket, roomCode, forceRemove = false) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const result = room.removePlayer(socket.id);
  if (!result || !result.removed) return;

  playerRooms.delete(socket.id);
  socket.leave(roomCode);

  if (room.isEmpty()) {
    rooms.delete(roomCode);
    games.delete(roomCode);
    console.log(`Room ${roomCode} deleted (empty)`);
    return;
  }

  // Notify remaining players
  if (result.newHostId) {
    io.to(roomCode).emit('host_changed', { newHostId: result.newHostId });
  }

  io.to(roomCode).emit('player_list_update', {
    players: room.getPlayerList(),
    hostId: room.hostId,
  });

  // Check if game should end (only 1 player left)
  const engine = games.get(roomCode);
  if (engine) {
    const activePlayers = room.getActivePlayers();
    if (activePlayers.length <= 1 && engine.state !== 'game_over') {
      engine.endGame();
    }
  }
}

// ========== CLEANUP ==========
setInterval(() => {
  // Clean up stale empty rooms older than 1 hour
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isEmpty() || (room.getConnectedPlayers().length === 0 && now - room.createdAt > 3600000)) {
      rooms.delete(code);
      games.delete(code);
      console.log(`Cleaned up stale room ${code}`);
    }
  }
}, 300000); // Every 5 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Uwongo's Bar server running on http://localhost:${PORT}`));