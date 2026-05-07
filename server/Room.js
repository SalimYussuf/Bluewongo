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
    hostPlayer.teamIndex = 0; // Host starts in slot 0
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

    // Assign to a team slot (0-3)
    const counts = [0, 0, 0, 0];
    this.players.forEach(p => {
      if (typeof p.teamIndex === 'number' && p.teamIndex >= 0 && p.teamIndex < 4) {
        counts[p.teamIndex]++;
      }
    });

    // Find first slot with 0 players, then first with 1 player
    let slot = counts.indexOf(0);
    if (slot === -1) slot = counts.indexOf(1);
    
    // Fallback just in case something went wrong with counts
    if (slot === -1) slot = 0; 
    
    player.teamIndex = slot;

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
    if (this.state !== ROOM_STATE.WAITING) return false;
    const teamIndices = new Set();
    this.players.forEach(p => {
      if (typeof p.teamIndex === 'number' && p.teamIndex >= 0 && p.teamIndex < 4) {
        teamIndices.add(p.teamIndex);
      }
    });
    return teamIndices.size >= 2;
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
