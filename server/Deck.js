/**
 * Creates a scaled deck based on the number of players.
 * Each card has a unique id and a rank.
 */
function createDeck(numPlayers = 4, isChaosMode = false) {
  let composition;
  if (isChaosMode) {
    if (numPlayers === 2) {
      composition = { King: 3, Queen: 3, Chaos: 1, Master: 1 };
    } else if (numPlayers === 3) {
      composition = { King: 4, Queen: 4, Chaos: 1, Master: 1 };
    } else {
      composition = { King: 5, Queen: 5, Chaos: 1, Master: 1 };
    }
  } else {
    if (numPlayers === 2) {
      composition = { Ace: 4, King: 4, Queen: 4, Joker: 1 };
    } else if (numPlayers === 3) {
      composition = { Ace: 5, King: 5, Queen: 5, Joker: 2 };
    } else {
      // Default 4 players
      composition = { Ace: 6, King: 6, Queen: 6, Joker: 2 };
    }
  }

  const deck = [];
  let id = 0;
  for (const [rank, count] of Object.entries(composition)) {
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
function deal(deck, numPlayers, isChaosMode = false) {
  const CARDS_PER_PLAYER = isChaosMode ? 3 : 5;
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
