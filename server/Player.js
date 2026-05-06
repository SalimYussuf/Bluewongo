const { REVOLVER_CHAMBERS } = require('./constants');

class Player {
  constructor(socketId, name) {
    this.id = socketId;
    this.socketId = socketId;
    this.name = name;
    this.hand = [];
    this.isReady = false;
    this.isHost = false;
    this.isConnected = true;
    this.isEliminated = false;
    this.disconnectedAt = null;

    // Progressive Russian Roulette
    this.shotsTaken = 0; 
  }


  /**
   * Pull the trigger. Returns true if the bullet fires (player is eliminated).
   * Progressive chance: (shotsTaken + 1) / REVOLVER_CHAMBERS
   */
  pullTrigger() {
    const chance = (this.shotsTaken + 1) / REVOLVER_CHAMBERS;
    const fired = Math.random() < chance;
    
    if (fired) {
      this.isEliminated = true;
    } else {
      this.shotsTaken++;
    }
    return fired;
  }

  /**
   * Forcefully take a shot (Devil Card effect).
   */
  forceLoseBullet() {
    return this.pullTrigger();
  }

  resetRevolver() {
    this.shotsTaken = 0;
    this.isEliminated = false;
  }

  removeCards(cardIds) {
    this.hand = this.hand.filter(card => !cardIds.includes(card.id));
  }

  addCards(cards) {
    this.hand.push(...cards);
  }

  hasCards() {
    return this.hand.length > 0;
  }

  toSelf() {
    return {
      id: this.id,
      name: this.name,
      hand: this.hand,
      handSize: this.hand.length,
      isReady: this.isReady,
      isHost: this.isHost,
      isConnected: this.isConnected,
      isEliminated: this.isEliminated,
      shotsTaken: this.shotsTaken,
      maxShots: REVOLVER_CHAMBERS,
      disconnectedAt: this.disconnectedAt,
    };
  }

  /**
   * Return sanitized data safe to send to other players (hides cards).
   */
  toOther() {
    return {
      id: this.id,
      name: this.name,
      handSize: this.hand.length,
      isReady: this.isReady,
      isHost: this.isHost,
      isConnected: this.isConnected,
      isEliminated: this.isEliminated,
      shotsTaken: this.shotsTaken,
      disconnectedAt: this.disconnectedAt,
    };
  }

  /**
   * Return lobby data (no game state).
   */
  toLobby() {
    return {
      id: this.id,
      name: this.name,
      isReady: this.isReady,
      isHost: this.isHost,
      isConnected: this.isConnected,
    };
  }
}

module.exports = Player;
