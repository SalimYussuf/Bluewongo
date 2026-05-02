// === GAME CONFIGURATION ===
const RANKS = ['Ace', 'King', 'Queen'];
const JOKER = 'Joker';

const DECK_COMPOSITION = {
  Ace: 6,
  King: 6,
  Queen: 6,
  Joker: 2,
};

const TOTAL_CARDS = 20;
const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const MAX_CARDS_PER_PLAY = 3;
const STARTING_LIVES = 3; // Not used with Russian Roulette, kept for reference
const TURN_TIMEOUT_MS = 20000; // 20 seconds
const RECONNECT_TIMEOUT_MS = 60000; // 60 seconds
const ROOM_CODE_LENGTH = 6;

// Russian Roulette
const REVOLVER_CHAMBERS = 6;
const BULLETS = 1;

// Game states
const GAME_STATE = {
  LOBBY: 'lobby',
  DEALING: 'dealing',
  PLAYING: 'playing',
  CHALLENGE_REVEAL: 'challenge_reveal',
  REVOLVER: 'revolver',
  ROUND_OVER: 'round_over',
  GAME_OVER: 'game_over',
};

// Room states
const ROOM_STATE = {
  WAITING: 'waiting',
  IN_GAME: 'in_game',
  FINISHED: 'finished',
};

module.exports = {
  RANKS,
  JOKER,
  DECK_COMPOSITION,
  TOTAL_CARDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_CARDS_PER_PLAY,
  STARTING_LIVES,
  TURN_TIMEOUT_MS,
  RECONNECT_TIMEOUT_MS,
  ROOM_CODE_LENGTH,
  REVOLVER_CHAMBERS,
  BULLETS,
  GAME_STATE,
  ROOM_STATE,
};
