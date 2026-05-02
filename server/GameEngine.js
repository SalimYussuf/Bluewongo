const { createDeck, shuffle, deal } = require('./Deck');
const {
  GAME_STATE,
  ROOM_STATE,
  RANKS,
  JOKER,
  MAX_CARDS_PER_PLAY,
  TURN_TIMEOUT_MS,
  REVOLVER_CHAMBERS,
} = require('./constants');

class GameEngine {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.state = GAME_STATE.LOBBY;
    this.pile = [];
    this.currentRank = null; // The rank that must be declared this round
    this.turnOrder = []; // Array of player IDs in turn order
    this.currentTurnIndex = 0;
    this.lastPlay = null; // { playerId, cardIds, declaredRank, declaredCount, actualCards }
    this.roundNumber = 0;
    this.turnTimer = null;
    this.gameLog = [];

    // Track who played what into the pile for full reveal on challenge
    this.pileHistory = []; // Array of { playerId, cards[] }
  }

  // ========== GAME LIFECYCLE ==========

  startGame() {
    if (!this.room.canStart()) {
      return { success: false, error: 'Not enough players to start' };
    }

    this.room.state = ROOM_STATE.IN_GAME;
    this.state = GAME_STATE.DEALING;

    // Reset all players
    for (const player of this.room.players.values()) {
      player.resetRevolver();
      player.hand = [];
    }

    // Set up turn order
    this.turnOrder = [...this.room.players.keys()];
    this.shuffleArray(this.turnOrder);
    this.currentTurnIndex = 0;

    this.roundNumber = 0;
    this.gameLog = [];

    this.addLog('Game started!', 'system');

    // Emit game started
    this.io.to(this.room.code).emit('game_started', {
      turnOrder: this.turnOrder.map(id => {
        const p = this.room.getPlayer(id);
        return { id: p.id, name: p.name };
      }),
    });

    // Start first round
    this.startRound();

    return { success: true };
  }

  startRound() {
    this.roundNumber++;
    this.state = GAME_STATE.DEALING;
    this.pile = [];
    this.pileHistory = [];
    this.lastPlay = null;

    // Filter out eliminated players from turn order
    this.turnOrder = this.turnOrder.filter(id => {
      const p = this.room.getPlayer(id);
      return p && !p.isEliminated;
    });

    if (this.turnOrder.length <= 1) {
      this.endGame();
      return;
    }

    // Issue 4 fix: Auto-determine the rank for this round
    this.currentRank = RANKS[Math.floor(Math.random() * RANKS.length)];

    // Create and deal cards (Issue 3: always 5 cards each)
    const deck = shuffle(createDeck());
    const activePlayers = this.turnOrder.length;
    const { hands, remainder } = deal(deck, activePlayers);

    // Assign hands
    this.turnOrder.forEach((playerId, index) => {
      const player = this.room.getPlayer(playerId);
      player.hand = hands[index];
    });

    this.addLog(`Round ${this.roundNumber} — Cards dealt! Declare: ${this.currentRank}s`, 'system');

    // Send each player their own hand + opponent info
    for (const playerId of this.turnOrder) {
      const player = this.room.getPlayer(playerId);
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('cards_dealt', {
          hand: player.hand,
          players: this.getPlayersInfo(playerId),
          roundNumber: this.roundNumber,
          firstPlayerId: this.turnOrder[this.currentTurnIndex],
          currentRank: this.currentRank,
        });
      }
    }

    // Also send to eliminated players (spectators)
    for (const [pid, player] of this.room.players) {
      if (player.isEliminated) {
        const socket = this.io.sockets.sockets.get(player.socketId);
        if (socket) {
          socket.emit('cards_dealt', {
            hand: [],
            players: this.getPlayersInfo(pid),
            roundNumber: this.roundNumber,
            firstPlayerId: this.turnOrder[this.currentTurnIndex],
            currentRank: this.currentRank,
          });
        }
      }
    }

    // Delay then start first turn
    setTimeout(() => {
      this.state = GAME_STATE.PLAYING;
      this.startTurn();
    }, 1500);
  }

  startTurn() {
    if (this.state !== GAME_STATE.PLAYING) return;

    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    const currentPlayer = this.room.getPlayer(currentPlayerId);

    if (!currentPlayer || currentPlayer.isEliminated) {
      this.advanceTurn();
      return;
    }

    // Check if all players have emptied their hands (draw round)
    const playersWithCards = this.turnOrder.filter(id => {
      const p = this.room.getPlayer(id);
      return p && p.hand.length > 0;
    });
    if (playersWithCards.length === 0) {
      this.addLog('All players emptied their hands — Draw round!', 'system');
      this.io.to(this.room.code).emit('round_over', {
        winnerId: null,
        winnerName: null,
        reason: 'All players emptied their hands — Draw round!',
      });
      setTimeout(() => {
        this.currentTurnIndex = 0;
        this.startRound();
      }, 3000);
      return;
    }

    // If current player has no cards, skip them
    if (currentPlayer.hand.length === 0) {
      this.advanceTurn();
      this.startTurn();
      return;
    }

    // Rank is always auto-set at round start (Issue 4)
    const canCallLiar = this.lastPlay !== null;

    this.io.to(this.room.code).emit('turn_start', {
      playerId: currentPlayerId,
      playerName: currentPlayer.name,
      timeLimit: TURN_TIMEOUT_MS,
      canCallLiar,
      currentRank: this.currentRank,
      isFirstPlay: false,
      pileSize: this.pile.length,
    });

    // Start turn timer
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => {
      this.handleTimeout(currentPlayerId);
    }, TURN_TIMEOUT_MS);
  }

  // ========== PLAYER ACTIONS ==========

  playCards(playerId, cardIds, declaredRank, declaredCount) {
    if (this.state !== GAME_STATE.PLAYING) {
      return { success: false, error: 'Not in playing state' };
    }

    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    if (playerId !== currentPlayerId) {
      return { success: false, error: 'Not your turn' };
    }

    const player = this.room.getPlayer(playerId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    // Validate card count
    if (cardIds.length < 1 || cardIds.length > MAX_CARDS_PER_PLAY) {
      return { success: false, error: 'Must play 1-3 cards' };
    }

    if (cardIds.length > player.hand.length) {
      return { success: false, error: 'Not enough cards in hand' };
    }

    // Validate declared count matches actual cards played
    if (declaredCount !== cardIds.length) {
      return { success: false, error: 'Declared count must match cards played' };
    }

    // Validate all card IDs exist in player's hand
    const actualCards = [];
    for (const cardId of cardIds) {
      const card = player.hand.find(c => c.id === cardId);
      if (!card) {
        return { success: false, error: 'Card not in your hand' };
      }
      actualCards.push(card);
    }

    // Validate declared rank — must match the auto-assigned round rank
    if (declaredRank !== this.currentRank) {
      return { success: false, error: `Must declare ${this.currentRank}` };
    }

    this.clearTurnTimer();

    // Remove cards from hand and add to pile
    player.removeCards(cardIds);
    this.pile.push(...actualCards);
    this.pileHistory.push({ playerId, cards: actualCards });

    // Record last play
    this.lastPlay = {
      playerId,
      cardIds,
      declaredRank,
      declaredCount,
      actualCards,
    };

    this.addLog(
      `${player.name} played ${declaredCount} ${declaredRank}${declaredCount > 1 ? 's' : ''}`,
      'play'
    );

    // Notify all players
    this.io.to(this.room.code).emit('cards_played', {
      playerId,
      playerName: player.name,
      numCards: cardIds.length,
      declaredRank,
      declaredCount,
      pileSize: this.pile.length,
    });

    // Send updated hand to the player
    const socket = this.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('hand_update', { hand: player.hand });
    }

    // Update opponent info for everyone
    this.broadcastPlayerInfo();

    // Issue 2 fix: Do NOT end round when hand is empty.
    // The round only ends on a liar call or when all players have no cards.
    // Just advance turn — startTurn() will skip players with empty hands.
    this.advanceTurn();
    this.startTurn();

    return { success: true };
  }

  callLiar(challengerId) {
    if (this.state !== GAME_STATE.PLAYING) {
      return { success: false, error: 'Not in playing state' };
    }

    if (!this.lastPlay) {
      return { success: false, error: 'No previous play to challenge' };
    }

    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    if (challengerId !== currentPlayerId) {
      return { success: false, error: 'Not your turn to call liar' };
    }

    this.clearTurnTimer();
    this.state = GAME_STATE.CHALLENGE_REVEAL;

    const challenger = this.room.getPlayer(challengerId);
    const challenged = this.room.getPlayer(this.lastPlay.playerId);

    this.addLog(
      `${challenger.name} called LIAR on ${challenged.name}!`,
      'challenge'
    );

    // Emit liar called event (for animation)
    this.io.to(this.room.code).emit('liar_called', {
      challengerId,
      challengerName: challenger.name,
      challengedId: this.lastPlay.playerId,
      challengedName: challenged.name,
    });

    // Reveal after a delay (for animation)
    setTimeout(() => {
      this.resolveChallenge(challengerId);
    }, 2000);

    return { success: true };
  }

  resolveChallenge(challengerId) {
    const { playerId: challengedId, declaredRank, actualCards } = this.lastPlay;
    const challenger = this.room.getPlayer(challengerId);
    const challenged = this.room.getPlayer(challengedId);

    // Check if all played cards match the declared rank
    // Jokers are WILD — they count as any rank
    const wasLying = !actualCards.every(
      card => card.rank === declaredRank || card.rank === JOKER
    );

    // Emit reveal
    this.io.to(this.room.code).emit('cards_revealed', {
      cards: actualCards,
      declaredRank,
      wasLying,
      challengerId,
      challengerName: challenger.name,
      challengedId,
      challengedName: challenged.name,
    });

    // Determine loser
    const loserId = wasLying ? challengedId : challengerId;
    const loser = this.room.getPlayer(loserId);
    const reason = wasLying
      ? `${challenged.name} was caught lying!`
      : `${challenger.name} was wrong — ${challenged.name} told the truth!`;

    this.addLog(reason, 'result');

    // Loser picks up the entire pile
    loser.addCards([...this.pile]);
    this.pile = [];

    this.io.to(this.room.code).emit('challenge_result', {
      loserId,
      loserName: loser.name,
      wasLying,
      reason,
      pileSize: this.pile.length,
    });

    // Send updated hand to the loser
    const loserSocket = this.io.sockets.sockets.get(loser.socketId);
    if (loserSocket) {
      loserSocket.emit('hand_update', { hand: loser.hand });
    }

    // Russian Roulette for the loser after a delay
    setTimeout(() => {
      this.handleRevolver(loserId, challengerId, challengedId);
    }, 2500);
  }

  handleRevolver(loserId, challengerId, challengedId) {
    this.state = GAME_STATE.REVOLVER;
    const loser = this.room.getPlayer(loserId);

    const fired = loser.pullTrigger();

    this.io.to(this.room.code).emit('revolver_result', {
      playerId: loserId,
      playerName: loser.name,
      fired,
      currentChamber: loser.currentChamber,
    });

    if (fired) {
      this.addLog(`💀 ${loser.name} was eliminated!`, 'elimination');
      this.io.to(this.room.code).emit('player_eliminated', {
        playerId: loserId,
        playerName: loser.name,
      });
    } else {
      this.addLog(`${loser.name} survived the shot!`, 'survive');
    }

    // Check if game should end
    const activePlayers = this.room.getActivePlayers();
    if (activePlayers.length <= 1) {
      setTimeout(() => this.endGame(), 2000);
      return;
    }

    // Start new round after delay — loser goes first (if alive), otherwise next alive
    setTimeout(() => {
      if (!loser.isEliminated) {
        this.currentTurnIndex = this.turnOrder.indexOf(loserId);
        if (this.currentTurnIndex === -1) this.currentTurnIndex = 0;
      } else {
        // Find next alive player after the eliminated one
        this.turnOrder = this.turnOrder.filter(id => {
          const p = this.room.getPlayer(id);
          return p && !p.isEliminated;
        });
        this.currentTurnIndex = 0;
      }
      this.startRound();
    }, 3000);
  }

  // handleRoundWin removed — Issue 2: round only ends on liar call or all-empty draw

  endGame() {
    this.state = GAME_STATE.GAME_OVER;
    this.room.state = ROOM_STATE.FINISHED;
    this.clearTurnTimer();

    // Build rankings
    const allPlayers = [...this.room.players.values()];
    const rankings = [];

    // Active (surviving) players first, sorted by hand size (fewer = better)
    const alive = allPlayers.filter(p => !p.isEliminated).sort((a, b) => a.hand.length - b.hand.length);
    const eliminated = allPlayers.filter(p => p.isEliminated);

    let position = 1;
    for (const p of alive) {
      rankings.push({ id: p.id, name: p.name, position: position++, eliminated: false, cardsLeft: p.hand.length });
    }
    // Eliminated players in reverse elimination order (last eliminated = better rank)
    for (const p of eliminated.reverse()) {
      rankings.push({ id: p.id, name: p.name, position: position++, eliminated: true, cardsLeft: p.hand.length });
    }

    this.addLog('Game Over!', 'system');

    this.io.to(this.room.code).emit('game_over', { rankings });
  }

  // ========== TIMEOUT ==========

  handleTimeout(playerId) {
    const player = this.room.getPlayer(playerId);
    if (!player || this.state !== GAME_STATE.PLAYING) return;

    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    if (playerId !== currentPlayerId) return;

    // Auto-play: play 1 random card, declare the round's rank
    if (player.hand.length > 0) {
      const randomCard = player.hand[0];
      const rank = this.currentRank;

      this.addLog(`⏰ ${player.name} ran out of time — auto-played 1 ${rank}`, 'timeout');

      this.io.to(this.room.code).emit('turn_timeout', {
        playerId,
        playerName: player.name,
      });

      this.playCards(playerId, [randomCard.id], rank, 1);
    }
  }

  // ========== DISCONNECTION ==========

  handleDisconnect(playerId) {
    const player = this.room.getPlayer(playerId);
    if (!player) return;

    player.isConnected = false;
    player.isEliminated = true;
    player.disconnectedAt = Date.now();

    this.addLog(`${player.name} disconnected and was removed from the game.`, 'elimination');

    this.io.to(this.room.code).emit('player_disconnected', {
      playerId,
      playerName: player.name,
    });

    this.io.to(this.room.code).emit('player_eliminated', {
      playerId,
      playerName: player.name,
    });

    // Remove from turn order immediately
    const wasCurrentTurn = this.turnOrder[this.currentTurnIndex] === playerId;
    this.turnOrder = this.turnOrder.filter(id => id !== playerId);

    // Adjust currentTurnIndex if needed
    if (this.turnOrder.length === 0) {
      this.endGame();
      return;
    }
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
    }

    // Check if only 1 player left → auto-win
    const activePlayers = this.room.getActivePlayers();
    if (activePlayers.length <= 1) {
      this.clearTurnTimer();
      this.endGame();
      return;
    }

    this.broadcastPlayerInfo();

    // If it was the disconnected player's turn, immediately advance
    if (wasCurrentTurn && this.state === GAME_STATE.PLAYING) {
      this.clearTurnTimer();
      this.startTurn();
    }
  }

  handleReconnect(playerId, newSocketId) {
    const player = this.room.getPlayer(playerId);
    if (!player) return false;

    player.socketId = newSocketId;
    player.isConnected = true;
    player.disconnectedAt = null;

    // Re-register in the room map with new socket ID if needed
    if (playerId !== newSocketId) {
      this.room.players.delete(playerId);
      player.id = newSocketId;
      this.room.players.set(newSocketId, player);

      // Update turn order
      const idx = this.turnOrder.indexOf(playerId);
      if (idx !== -1) {
        this.turnOrder[idx] = newSocketId;
      }
    }

    this.io.to(this.room.code).emit('player_reconnected', {
      playerId: newSocketId,
      playerName: player.name,
    });

    return true;
  }

  // ========== HELPERS ==========

  advanceTurn() {
    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
      attempts++;
      const player = this.room.getPlayer(this.turnOrder[this.currentTurnIndex]);
      if (player && !player.isEliminated) break;
    } while (attempts < this.turnOrder.length);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  getPlayersInfo(forPlayerId) {
    const info = [];
    for (const [id, player] of this.room.players) {
      if (id === forPlayerId) {
        info.push(player.toSelf());
      } else {
        info.push(player.toOther());
      }
    }
    return info;
  }

  broadcastPlayerInfo() {
    for (const [pid, player] of this.room.players) {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('players_update', {
          players: this.getPlayersInfo(pid),
        });
      }
    }
  }

  addLog(message, type) {
    const entry = { message, type, timestamp: Date.now() };
    this.gameLog.push(entry);
    this.io.to(this.room.code).emit('game_log', entry);
  }

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  getState() {
    return {
      state: this.state,
      currentRank: this.currentRank,
      pileSize: this.pile.length,
      roundNumber: this.roundNumber,
      currentPlayerId: this.turnOrder[this.currentTurnIndex],
      turnOrder: this.turnOrder,
    };
  }
}

module.exports = GameEngine;
