const Player = require('./Player');
const { MAX_PLAYERS, MIN_PLAYERS, ROOM_STATE, ROOM_CODE_LENGTH } = require('./constants');

class Room {
  constructor(code, hostPlayer) {
    this.code = code;
    this.players = new Map();
    this.hostId = hostPlayer.id;
    this.state = ROOM_STATE.WAITING;
    this.createdAt = Date.now();
    this.settings = {
      isDevilCardMode: false,
    };

    hostPlayer.isHost = true;
    this.players.set(hostPlayer.id, hostPlayer);
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    return this.settings;
  }

  addPlayer(player) {
    if (this.players.size >= MAX_PLAYERS) {
      return { success: false, error: 'Room is full' };
    }
    if (this.state !== ROOM_STATE.WAITING) {
      return { success: false, error: 'Game already in progress' };
    }
    this.players.set(player.id, player);
    return { success: true };
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;

    this.players.delete(playerId);

    // Transfer host if the host left
    if (playerId === this.hostId && this.players.size > 0) {
      const newHost = this.players.values().next().value;
      newHost.isHost = true;
      this.hostId = newHost.id;
      return { removed: true, newHostId: newHost.id };
    }

    return { removed: true, newHostId: null };
  }

  getPlayer(playerId) {
    return this.players.get(playerId);
  }

  getActivePlayers() {
    return [...this.players.values()].filter(p => !p.isEliminated);
  }

  getConnectedPlayers() {
    return [...this.players.values()].filter(p => p.isConnected);
  }

  canStart() {
    return (
      this.state === ROOM_STATE.WAITING &&
      this.players.size >= MIN_PLAYERS
    );
  }

  isEmpty() {
    return this.players.size === 0;
  }

  getPlayerList() {
    return [...this.players.values()].map(p => p.toLobby());
  }

  /**
   * Generate a unique 6-character alphanumeric room code.
   */
  static generateCode(existingRooms) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars (0/O, 1/I)
    let code;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (existingRooms.has(code));
    return code;
  }
}

module.exports = Room;
