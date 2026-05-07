// === GAME CONFIGURATION ===
const RANKS = ['Ace', 'King', 'Queen'];
const JOKER = 'Joker';
const CHAOS = 'Chaos';
const MASTER = 'Master';

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const MAX_CARDS_PER_PLAY = 3;
const TURN_TIMEOUT_MS = 90000; // 90 seconds
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
  TARGETING: 'targeting',
  CHAOS_TARGETING: 'chaos_targeting',
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

// Game settings
const DEFAULT_SETTINGS = {
  isDevilCardMode: false,
  isChaosMode: false,
};

module.exports = {
  RANKS,
  JOKER,
  CHAOS,
  MASTER,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MAX_CARDS_PER_PLAY,
  TURN_TIMEOUT_MS,
  RECONNECT_TIMEOUT_MS,
  ROOM_CODE_LENGTH,
  REVOLVER_CHAMBERS,
  BULLETS,
  GAME_STATE,
  ROOM_STATE,
  DEFAULT_SETTINGS,
};
