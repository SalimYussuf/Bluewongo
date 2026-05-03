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

    // Russian Roulette revolver
    // bulletPosition is the chamber (0-indexed) where the bullet sits
    // currentChamber advances after each pull
    this.bulletPosition = Math.floor(Math.random() * REVOLVER_CHAMBERS);
    this.currentChamber = 0;
  }

  /**
   * How many safe chambers remain before the bullet.
   * E.g. if bullet is at 3 and current chamber is 1, there are 2 safe pulls left.
   */
  get bulletsRemaining() {
    if (this.isEliminated) return 0;
    if (this.currentChamber <= this.bulletPosition) {
      return this.bulletPosition - this.currentChamber;
    }
    // Already passed the bullet (shouldn't happen since pulling it eliminates)
    return REVOLVER_CHAMBERS - this.currentChamber + this.bulletPosition;
  }

  /**
   * Pull the trigger. Returns true if the bullet fires (player eliminated).
   */
  pullTrigger() {
    const fired = this.currentChamber === this.bulletPosition;
    this.currentChamber = (this.currentChamber + 1) % REVOLVER_CHAMBERS;
    if (fired) {
      this.isEliminated = true;
    }
    return fired;
  }

  /**
   * Reset revolver for a new game.
   */
  resetRevolver() {
    this.bulletPosition = Math.floor(Math.random() * REVOLVER_CHAMBERS);
    this.currentChamber = 0;
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

  /**
   * Return sanitized data safe to send to this player (includes their own cards).
   * Includes chambersRemaining so the player can see how many safe pulls they have.
   */
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
      currentChamber: this.currentChamber,
      chambersRemaining: REVOLVER_CHAMBERS - this.currentChamber - 1, // safe pulls left (not counting bullet)
      bulletPosition: undefined, // Never reveal bullet position
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
      currentChamber: this.currentChamber,
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
