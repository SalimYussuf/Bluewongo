const { DECK_COMPOSITION } = require('./constants');

/**
 * Creates a fresh 20-card deck.
 * Each card has a unique id and a rank.
 */
function createDeck() {
  const deck = [];
  let id = 0;
  for (const [rank, count] of Object.entries(DECK_COMPOSITION)) {
    for (let i = 0; i < count; i++) {
      deck.push({ id: id++, rank });
    }
  }
  return deck;
}

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deal exactly 5 cards to each player.
 * Unused cards are set aside.
 * Returns { hands: Card[][], remainder: Card[] }
 */
function deal(deck, numPlayers) {
  const CARDS_PER_PLAYER = 5;
  const hands = [];
  let idx = 0;

  for (let p = 0; p < numPlayers; p++) {
    hands.push(deck.slice(idx, idx + CARDS_PER_PLAYER));
    idx += CARDS_PER_PLAYER;
  }

  const remainder = deck.slice(idx);
  return { hands, remainder };
}

module.exports = { createDeck, shuffle, deal };
