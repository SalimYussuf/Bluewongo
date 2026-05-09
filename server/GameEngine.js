const { createDeck, shuffle, deal } = require('./Deck');
const {
  GAME_STATE,
  ROOM_STATE,
  RANKS,
  JOKER,
  CHAOS,
  MASTER,
  MAX_CARDS_PER_PLAY,
  TURN_TIMEOUT_MS,
  REVOLVER_CHAMBERS,
  RECONNECT_TIMEOUT_MS,
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

    // Reconnection tracking
    this.disconnectedTimers = new Map(); // playerId -> { timer, disconnectedAt }
    this.pausedForDisconnect = false; // Whether the game is paused waiting for reconnection
    this.pausedPlayerId = null; // Which disconnected player we're waiting for

    // Chaos Mode tracking
    this.shootersQueue = [];
    this.currentShooterId = null;

    // Devil Card tracking
    this.devilVictimsQueue = [];
    this.lastChallengerId = null;
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

    // Set up turn order (based on team indices 0-3)
    const teamIndices = new Set();
    this.room.players.forEach(p => {
      if (typeof p.teamIndex === 'number' && p.teamIndex >= 0 && p.teamIndex < 4) {
        teamIndices.add(p.teamIndex);
      }
    });

    this.turnOrder = Array.from(teamIndices);
    this.shuffleArray(this.turnOrder);
    this.currentTurnIndex = 0;

    this.roundNumber = 0;
    this.gameLog = [];

    this.addLog('Game started!', 'system');

    // Emit game started
    this.io.to(this.room.code).emit('game_started', {
      turnOrder: this.turnOrder, // Array of team indices [0, 2, 1, 3]
      players: [...this.room.players.values()].map(p => p.toOther())
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
    this.shootersQueue = [];
    this.devilVictimsQueue = [];

    // Filter out eliminated teams from turn order
    this.turnOrder = this.turnOrder.filter(teamIndex => {
      const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === teamIndex);
      return teamPlayers.some(p => !p.isEliminated);
    });

    if (this.turnOrder.length <= 1) {
      this.endGame();
      return;
    }

    // Ensure currentTurnIndex is within bounds after filtering
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
    }

    // Auto-determine the rank for this round
    this.currentRank = RANKS[Math.floor(Math.random() * RANKS.length)];

    // Create and deal cards (Dealt to number of active teams)
    const activeTeamsCount = this.turnOrder.length;
    const isChaos = this.room.settings.isChaosMode;
    const deck = shuffle(createDeck(activeTeamsCount, isChaos));
    const { hands, remainder } = deal(deck, activeTeamsCount, isChaos);

    // Assign hands to teams
    this.turnOrder.forEach((teamIndex, index) => {
      const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === teamIndex);
      const teamHand = hands[index];
      teamPlayers.forEach(p => {
        p.hand = [...teamHand]; // Teammates share the same cards
      });
    });

    // Handle Devil Card Mode
    if (this.room.settings.isDevilCardMode) {
      const allCards = [];
      this.turnOrder.forEach(tIdx => {
        const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === tIdx);
        if (teamPlayers.length > 0) {
          const first = teamPlayers[0];
          first.hand.forEach(card => {
            card.isDevil = false;
            allCards.push(card);
          });
        }
      });
      
      const rankCards = allCards.filter(c => c.rank === this.currentRank);
      if (rankCards.length > 0) {
        const devilCard = rankCards[Math.floor(Math.random() * rankCards.length)];
        devilCard.isDevil = true;
        this.addLog('A Devil Card has been dealt into someone\'s hand...', 'system');
      }
    }

    this.addLog(`Round ${this.roundNumber} — Cards dealt! Declare: ${this.currentRank}s`, 'system');

    // Track roundsSurvived for alive players
    for (const player of this.room.players.values()) {
      if (!player.isEliminated) {
        player.stats.roundsSurvived++;
      }
    }

    // Send to all players (active and eliminated/spectators)
    this.room.players.forEach((player, pid) => {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('cards_dealt', {
          hand: player.hand,
          players: this.getPlayersInfo(pid),
          roundNumber: this.roundNumber,
          firstTeamIndex: this.turnOrder[0],
          currentRank: this.currentRank,
          turnOrder: this.turnOrder,
        });
      }
    });

    // Emit round countdown then start turn
    this.io.to(this.room.code).emit('round_countdown');
    this.state = GAME_STATE.PLAYING;
    setTimeout(() => {
      this.startTurn();
    }, 4000);
  }

  startTurn() {
    if (this.state !== GAME_STATE.PLAYING) return;

    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === currentTeamIndex && !p.isEliminated);
    
    // Check if any player in team has cards
    const teamHasCards = teamPlayers.some(p => p.hand.length > 0);

    if (!teamHasCards && teamPlayers.length > 0) {
      // Check if ANY team has cards left (if not, it's a draw)
      const anyTeamHasCards = this.turnOrder.some(tIdx => {
        const pList = [...this.room.players.values()].filter(p => p.teamIndex === tIdx && !p.isEliminated);
        return pList.some(p => p.hand.length > 0);
      });

      if (!anyTeamHasCards) {
        this.addLog('All teams emptied their hands — Draw round!', 'system');
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

      this.advanceTurn();
      this.startTurn();
      return;
    }

    // Rank is always auto-set at round start (Issue 4)
    const canCallLiar = this.lastPlay !== null;

    this.io.to(this.room.code).emit('turn_start', {
      teamIndex: currentTeamIndex,
      teamNames: teamPlayers.map(p => p.name).join(' & '),
      timeLimit: TURN_TIMEOUT_MS,
      canCallLiar,
      currentRank: this.currentRank,
      isFirstPlay: false,
      pileSize: this.pile.length,
    });

    // Emit sound event for turn start (to all team members)
    teamPlayers.forEach(p => {
      this.io.to(p.socketId).emit('sound_event', { type: 'your_turn' });
    });

    // Start turn timer
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => {
      this.handleTimeout(currentTeamIndex);
    }, TURN_TIMEOUT_MS);
  }

  // ========== PLAYER ACTIONS ==========

  playCards(playerId, cardIds, declaredRank, declaredCount) {
    // Input type validation — reject malformed payloads
    if (!Array.isArray(cardIds) || typeof declaredRank !== 'string' || typeof declaredCount !== 'number') {
      return { success: false, error: 'Invalid action' };
    }
    // Sanitise card IDs — must all be integers
    if (!cardIds.every(id => Number.isInteger(id))) {
      return { success: false, error: 'Invalid action' };
    }

    if (this.state !== GAME_STATE.PLAYING) {
      return { success: false, error: 'Invalid action' };
    }

    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    const player = this.room.getPlayer(playerId);
    if (!player || player.teamIndex !== currentTeamIndex) {
      return { success: false, error: 'Invalid action' };
    }

    // Validate card count
    const maxPlay = this.room.settings.isChaosMode ? 1 : MAX_CARDS_PER_PLAY;
    if (cardIds.length < 1 || cardIds.length > maxPlay) {
      return { success: false, error: 'Invalid action' };
    }

    if (cardIds.length > player.hand.length) {
      return { success: false, error: 'Invalid action' };
    }

    // Validate declared count matches actual cards played
    if (declaredCount !== cardIds.length) {
      return { success: false, error: 'Invalid action' };
    }

    // Validate all card IDs exist in player's hand
    const actualCards = [];
    for (const cardId of cardIds) {
      const card = player.hand.find(c => c.id === cardId);
      if (!card) {
        return { success: false, error: 'Invalid action' };
      }
      actualCards.push(card);
    }

    // Validate declared rank — must match the auto-assigned round rank
    if (declaredRank !== this.currentRank) {
      return { success: false, error: 'Invalid action' };
    }

    this.clearTurnTimer();

    // Remove cards from all teammates' hands
    const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === player.teamIndex);
    teamPlayers.forEach(p => {
      p.removeCards(cardIds);
      // Notify teammates of their updated hand
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) s.emit('hand_update', { hand: p.hand });
    });

    this.pile.push(...actualCards);
    this.pileHistory.push({ playerId, cards: actualCards });

    // Record last play
    this.lastPlay = {
      playerId,
      teamIndex: player.teamIndex,
      cardIds,
      declaredRank,
      declaredCount,
      actualCards,
    };

    const teamNames = teamPlayers.map(p => p.name).join(' & ');

    this.addLog(
      `${teamNames} played ${declaredCount} ${declaredRank}${declaredCount > 1 ? 's' : ''}`,
      'play'
    );

    // Notify all players + emit sound event
    this.io.to(this.room.code).emit('cards_played', {
      playerId,
      playerName: player.name,
      teamIndex: player.teamIndex,
      numCards: cardIds.length,
      declaredRank,
      declaredCount,
      pileSize: this.pile.length,
    });
    this.io.to(this.room.code).emit('sound_event', { type: 'card_placed' });

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
      return { success: false, error: 'Invalid action' };
    }

    if (!this.lastPlay) {
      return { success: false, error: 'Invalid action' };
    }

    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    const challenger = this.room.getPlayer(challengerId);
    if (challenger.teamIndex !== currentTeamIndex) {
      return { success: false, error: 'Invalid action' };
    }

    this.clearTurnTimer();
    this.state = GAME_STATE.CHALLENGE_REVEAL;

    const challenged = this.room.getPlayer(this.lastPlay.playerId);
    const challengedTeamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === challenged.teamIndex);
    const challengedTeamNames = challengedTeamPlayers.map(p => p.name).join(' & ');

    this.addLog(
      `${challenger.name} called LIAR on ${challengedTeamNames}!`,
      'challenge'
    );

    // Emit liar called event (for animation) + sound
    this.io.to(this.room.code).emit('liar_called', {
      challengerId,
      challengerName: challenger.name,
      challengerTeamIndex: challenger.teamIndex,
      challengedId: this.lastPlay.playerId,
      challengedName: challenged.name,
      challengedTeamIndex: challenged.teamIndex,
      pileHistory: this.pileHistory.map(entry => ({
        playerName: this.room.getPlayer(entry.playerId)?.name || 'Unknown',
        cardCount: entry.cards.length,
      })),
    });
    this.io.to(this.room.code).emit('sound_event', { type: 'liar_called' });

    // Reveal after a delay (extended for pile timeline readability)
    setTimeout(() => {
      this.resolveChallenge(challengerId);
    }, 3500);

    return { success: true };
  }

  triggerDevilCard(challengerId) {
    // Mark the card as no longer devil so it doesn't trigger again if picked up
    this.lastPlay.actualCards.forEach(card => card.isDevil = false);

    const placerId = this.lastPlay.playerId;
    this.lastChallengerId = challengerId;

    this.devilVictimsQueue = [];
    // Each team that is NOT the placer's team gets shot once
    const teamIndices = new Set();
    for (const [pid, player] of this.room.players) {
      if (player.teamIndex !== this.lastPlay.teamIndex && !player.isEliminated) {
        teamIndices.add(player.teamIndex);
      }
    }
    
    // Add one player from each team to the queue
    for (const tIdx of teamIndices) {
      const p = [...this.room.players.values()].find(player => player.teamIndex === tIdx && !player.isEliminated);
      if (p) this.devilVictimsQueue.push(p.id);
    }

    this.processNextDevilShot();
  }

  processNextDevilShot() {
    if (this.devilVictimsQueue.length === 0) {
      // All devil shots done, start the next round
      this.broadcastPlayerInfo();

      const activePlayers = this.room.getActivePlayers();
      if (activePlayers.length <= 1) {
        this.endGame();
        return;
      }

      // Loser of challenge (challenger) goes first next round if alive
      const loserId = this.lastChallengerId;
      const loser = this.room.getPlayer(loserId);
      if (loser && !loser.isEliminated) {
        this.currentTurnIndex = this.turnOrder.indexOf(loser.teamIndex);
        if (this.currentTurnIndex === -1) this.currentTurnIndex = 0;
      } else {
        this.currentTurnIndex = 0;
      }
      this.startRound();
      return;
    }

    const nextVictimId = this.devilVictimsQueue.shift();
    this.handleRevolver(nextVictimId, null, null, true); // true = isDevilSequence
  }

  resolveChallenge(challengerId) {
    const { playerId: challengedId, declaredRank, actualCards } = this.lastPlay;
    const challenger = this.room.getPlayer(challengerId);
    const challenged = this.room.getPlayer(challengedId);

    // Check if all played cards match the declared rank
    // Jokers, Chaos, and Master are WILD — they count as any rank
    const wasLying = !actualCards.every(
      card => card.rank === declaredRank || card.rank === JOKER || card.rank === CHAOS || card.rank === MASTER
    );

    const hasDevilCard = actualCards.some(card => card.isDevil);
    const isDevilTrigger = hasDevilCard && !wasLying;

    // Emit reveal + sound
    this.io.to(this.room.code).emit('cards_revealed', {
      cards: actualCards,
      declaredRank,
      wasLying,
      challengerId,
      challengerName: challenger.name,
      challengedId,
      challengedName: challenged.name,
      hasDevilCard: isDevilTrigger
    });

    // Track stats
    challenger.stats.caughtLiar += wasLying ? 1 : 0;
    if (wasLying) {
      // Challenged player was lying
      challenged.stats.timesLied++;
    } else {
      // Challenged player was truthful
      challenged.stats.timesTruthful++;
    }

    if (wasLying) {
      this.io.to(this.room.code).emit('sound_event', { type: 'liar_caught' });
    } else {
      this.io.to(this.room.code).emit('sound_event', { type: 'truth_told' });
    }

    // Determine loser
    const loserId = wasLying ? challengedId : challengerId;
    const loser = this.room.getPlayer(loserId);
    const loserTeamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === loser.teamIndex);
    const loserTeamNames = loserTeamPlayers.map(p => p.name).join(' & ');

    const challengedTeamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === challenged.teamIndex);
    const challengedTeamNames = challengedTeamPlayers.map(p => p.name).join(' & ');

    const verb = challengedTeamPlayers.length > 1 ? 'were' : 'was';
    const reason = wasLying
      ? `${challengedTeamNames} ${verb} caught lying!`
      : `${challenger.name}'s team was wrong — ${challengedTeamNames} told the truth!`;

    this.addLog(reason, 'result');

    // Loser team picks up the entire pile
    loserTeamPlayers.forEach(p => {
      p.addCards([...this.pile]);
      // Notify teammates of their updated hand
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) s.emit('hand_update', { hand: p.hand });
    });

    this.io.to(this.room.code).emit('challenge_result', {
      loserId,
      loserName: loser.name,
      teamIndex: loser.teamIndex,
      wasLying,
      reason,
      pileSize: 0,
    });
    this.pile = [];

    // Determine what happens next based on Chaos Mode
    if (this.room.settings.isChaosMode) {
      const hasChaos = actualCards.some(c => c.rank === CHAOS);

      if (hasChaos) {
        this.addLog(`🌪️ CHAOS CARD REVEALED! Everyone gets to shoot!`, 'devil');
        this.io.to(this.room.code).emit('sound_event', { type: 'devil_laugh' });

        setTimeout(() => {
          this.beginChaosTargeting();
        }, 2500);
      } else {
        // Normal Chaos mode or Master Card: winner of the challenge picks a target
        if (isDevilTrigger) {
          // Trigger the Devil Card shots AFTER the cards are revealed
          setTimeout(() => {
            this.triggerDevilCard(challengerId);
          }, 3000);
        } else {
          const winnerId = wasLying ? challengerId : challengedId;
          setTimeout(() => {
            this.beginTargeting(winnerId, loserId);
          }, 2500);
        }
      }
    } else {
      if (isDevilTrigger) {
        // Trigger the Devil Card shots AFTER the cards are revealed
        setTimeout(() => {
          this.triggerDevilCard(challengerId);
        }, 3000);
      } else {
        // Normal Mode: Russian Roulette for the loser after a delay
        setTimeout(() => {
          this.handleRevolver(loserId, challengerId, challengedId);
        }, 3000);
      }
    }
  }

  // ========== CHAOS MODE TARGETING ==========

  beginTargeting(shooterId, previousLoserId) {
    this.state = GAME_STATE.TARGETING;
    this.currentShooterId = shooterId;

    const shooter = this.room.getPlayer(shooterId);
    this.addLog(`🎯 ${shooter.name} is choosing a target...`, 'system');

    // Filter alive players for valid targets
    const validTargets = this.room.getActivePlayers().map(p => p.id);

    this.io.to(this.room.code).emit('targeting_started', {
      shooterId,
      shooterName: shooter.name,
      validTargets
    });
  }

  beginChaosTargeting() {
    this.state = GAME_STATE.CHAOS_TARGETING;

    // Queue all alive players as shooters
    const alivePlayers = this.room.getActivePlayers();
    this.shootersQueue = alivePlayers.map(p => p.id);

    // Start with the first shooter
    this.processNextChaosShooter();
  }

  processNextChaosShooter() {
    if (this.shootersQueue.length === 0) {
      // Chaos targeting complete, start next round
      // Check if game should end
      const activePlayers = this.room.getActivePlayers();
      if (activePlayers.length <= 1) {
        setTimeout(() => this.endGame(), 2000);
        return;
      }

      setTimeout(() => {
        this.startRound();
      }, 3000);
      return;
    }

    const nextShooterId = this.shootersQueue.shift();
    const shooter = this.room.getPlayer(nextShooterId);

    // If they were eliminated during the chaos (by someone else), skip them
    if (!shooter || shooter.isEliminated) {
      this.processNextChaosShooter();
      return;
    }

    this.currentShooterId = nextShooterId;
    const validTargets = this.room.getActivePlayers().map(p => p.id);

    this.addLog(`🌪️ CHAOS: ${shooter.name} is choosing a target...`, 'system');
    this.io.to(this.room.code).emit('targeting_started', {
      shooterId: nextShooterId,
      shooterName: shooter.name,
      validTargets,
      isChaosMass: true
    });
  }

  selectTarget(shooterId, targetId) {
    if (this.state !== GAME_STATE.TARGETING && this.state !== GAME_STATE.CHAOS_TARGETING) {
      return { success: false, error: 'Invalid action' };
    }

    if (shooterId !== this.currentShooterId) {
      return { success: false, error: 'Invalid action' };
    }

    const target = this.room.getPlayer(targetId);
    if (!target || target.isEliminated) {
      return { success: false, error: 'Invalid action' };
    }

    // Resolve the shot on the target
    this.handleTargetedRevolver(shooterId, targetId);

    return { success: true };
  }

  handleTargetedRevolver(shooterId, targetId) {
    const target = this.room.getPlayer(targetId);
    const shooter = this.room.getPlayer(shooterId);

    // Emit roulette spin sound
    this.io.to(this.room.code).emit('sound_event', { type: 'roulette_spin' });

    const fired = target.pullTrigger();

    this.io.to(this.room.code).emit('revolver_result', {
      playerId: targetId,
      playerName: target.name,
      shooterId: shooterId,
      shooterName: shooter.name,
      fired,
      currentChamber: target.currentChamber,
      isEliminated: target.isEliminated
    });

    // Emit fire/click sound
    setTimeout(() => {
      let soundType = 'roulette_click';
      if (fired) {
        soundType = target.isEliminated ? 'player_eliminated' : 'roulette_fire';
      }
      this.io.to(this.room.code).emit('sound_event', { type: soundType });
    }, 1200);

    if (fired) {
      setTimeout(() => {
        this.addLog(`💥 BANG! ${shooter.name} shot ${target.name}!`, 'elimination');
        if (target.isEliminated) {
          this.addLog(`💀 ${target.name} has been eliminated!`, 'elimination');
        }
        this.io.to(this.room.code).emit('player_eliminated', {
          playerId: targetId,
          playerName: target.name,
          isEliminated: target.isEliminated,
          shotsTaken: target.shotsTaken
        });
      }, 1500);
    } else {
      setTimeout(() => {
        this.addLog(`😮‍💨 ${target.name} survived ${shooter.name}'s shot!`, 'survive');
      }, 1500);
    }

    // Determine what to do next
    setTimeout(() => {
      if (this.state === GAME_STATE.CHAOS_TARGETING) {
        this.processNextChaosShooter();
      } else {
        // Normal targeting complete
        const activePlayers = this.room.getActivePlayers();
        if (activePlayers.length <= 1) {
          this.endGame();
        } else {
          // In Chaos mode, start next round. Winner (shooter) usually goes first? Or next person.
          // Let's just make the shooter go first.
          this.currentTurnIndex = this.turnOrder.indexOf(shooter.teamIndex);
          if (this.currentTurnIndex === -1) this.currentTurnIndex = 0;
          this.startRound();
        }
      }
    }, 3000);
  }

  handleRevolver(loserId, challengerId, challengedId, isDevilSequence = false) {
    this.state = GAME_STATE.REVOLVER;
    const loser = this.room.getPlayer(loserId);

    // Emit roulette spin sound
    this.io.to(this.room.code).emit('sound_event', { type: 'roulette_spin' });

    const fired = loser.pullTrigger();

    // Sync team status (all teammates share the same lives/death)
    const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === loser.teamIndex);
    teamPlayers.forEach(p => {
      p.shotsTaken = loser.shotsTaken;
      p.isEliminated = loser.isEliminated;
    });

    this.io.to(this.room.code).emit('revolver_result', {
      playerId: loserId,
      playerName: loser.name,
      teamIndex: loser.teamIndex,
      fired,
      currentChamber: loser.currentChamber,
      isEliminated: loser.isEliminated
    });

    // Emit fire/click sound
    setTimeout(() => {
      let soundType = 'roulette_click';
      if (fired) {
        soundType = loser.isEliminated ? 'player_eliminated' : 'roulette_fire';
      }
      this.io.to(this.room.code).emit('sound_event', { type: soundType });
    }, 1200);

    if (fired) {
      const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === loser.teamIndex);
      const teamNames = teamPlayers.map(p => p.name).join(' & ');
      
      setTimeout(() => {
        this.addLog(`💥 BANG! ${teamNames} got shot!`, 'elimination');
        if (loser.isEliminated) {
          this.addLog(`💀 ${teamNames} ${teamPlayers.length > 1 ? 'have' : 'has'} been eliminated!`, 'elimination');
        }
        this.io.to(this.room.code).emit('player_eliminated', {
          playerId: loserId,
          playerName: loser.name,
          isEliminated: loser.isEliminated,
          shotsTaken: loser.shotsTaken
        });
      }, 1500);
    } else {
      setTimeout(() => {
        this.addLog(`${loser.name} survived the shot!`, 'survive');
      }, 1500);
    }

    // Check if game should end
    const activePlayers = this.room.getActivePlayers();
    if (activePlayers.length <= 1) {
      setTimeout(() => this.endGame(), 2000);
      return;
    }

    // Start new round after delay
    setTimeout(() => {
      if (isDevilSequence) {
        this.processNextDevilShot();
      } else {
        if (!loser.isEliminated) {
          this.currentTurnIndex = this.turnOrder.indexOf(loser.teamIndex);
          if (this.currentTurnIndex === -1) this.currentTurnIndex = 0;
        } else {
          this.currentTurnIndex = 0;
        }
        this.startRound();
      }
    }, 4500); // 4.5s matches the client's revolver overlay duration
  }

  // handleRoundWin removed — Issue 2: round only ends on liar call or all-empty draw

  endGame() {
    this.state = GAME_STATE.GAME_OVER;
    this.room.state = ROOM_STATE.FINISHED;
    this.clearTurnTimer();

    // Clear any remaining disconnect timers
    for (const [pid, data] of this.disconnectedTimers) {
      clearTimeout(data.timer);
    }
    this.disconnectedTimers.clear();

    // Build rankings (by team)
    const teamIndices = new Set();
    this.room.players.forEach(p => {
      if (p.teamIndex !== null) teamIndices.add(p.teamIndex);
    });

    const teamData = Array.from(teamIndices).map(tIdx => {
      const members = [...this.room.players.values()].filter(p => p.teamIndex === tIdx);
      const first = members[0];
      // Aggregate stats across team members
      const aggregatedStats = {
        roundsSurvived: 0,
        timesLied: 0,
        caughtLiar: 0,
        shotsTaken: 0,
        timesTruthful: 0,
      };
      members.forEach(m => {
        aggregatedStats.roundsSurvived = Math.max(aggregatedStats.roundsSurvived, m.stats.roundsSurvived);
        aggregatedStats.timesLied += m.stats.timesLied;
        aggregatedStats.caughtLiar += m.stats.caughtLiar;
        aggregatedStats.shotsTaken = m.shotsTaken;
        aggregatedStats.timesTruthful += m.stats.timesTruthful;
      });
      return {
        teamIndex: tIdx,
        names: members.map(p => p.name).join(' & '),
        isEliminated: first.isEliminated,
        cardsLeft: first.hand.length,
        memberIds: members.map(p => p.id),
        stats: aggregatedStats,
      };
    });

    const aliveTeams = teamData.filter(t => !t.isEliminated).sort((a, b) => a.cardsLeft - b.cardsLeft);
    const eliminatedTeams = teamData.filter(t => t.isEliminated);

    const rankings = [];
    let position = 1;
    for (const t of aliveTeams) {
      rankings.push({ ...t, position: position++ });
    }
    // Note: for eliminated teams, we don't have a strict "elimination order" stored easily
    // so we just add them.
    for (const t of eliminatedTeams) {
      rankings.push({ ...t, position: position++ });
    }

    this.addLog('Game Over!', 'system');

    this.io.to(this.room.code).emit('game_over', { rankings });
    this.io.to(this.room.code).emit('sound_event', { type: 'game_win' });
  }

  // ========== TIMEOUT ==========

  handleTimeout(teamIndex) {
    const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === teamIndex && !p.isEliminated);
    if (teamPlayers.length === 0 || this.state !== GAME_STATE.PLAYING) return;

    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    if (teamIndex !== currentTeamIndex) return;

    // Auto-play: play 1 random card from someone on the team
    const playerWithCards = teamPlayers.find(p => p.hand.length > 0);
    if (playerWithCards) {
      const randomCard = playerWithCards.hand[0];
      const rank = this.currentRank;

      const teamSuffix = teamPlayers.length > 1 ? "'s team" : "";
      this.addLog(`⏰ ${playerWithCards.name}${teamSuffix} ran out of time — auto-played 1 ${rank}`, 'timeout');

      this.io.to(this.room.code).emit('turn_timeout', {
        teamIndex,
        playerName: playerWithCards.name,
      });

      this.playCards(playerWithCards.id, [randomCard.id], rank, 1);
    }
  }

  // ========== DISCONNECTION ==========

  handleDisconnect(playerId) {
    const player = this.room.getPlayer(playerId);
    if (!player) return;

    player.isConnected = false;
    player.disconnectedAt = Date.now();

    this.addLog(`⚡ ${player.name} disconnected. Waiting for reconnection...`, 'system');

    // Notify remaining players with countdown info
    this.io.to(this.room.code).emit('player_disconnected', {
      playerId,
      playerName: player.name,
      reconnectTimeout: RECONNECT_TIMEOUT_MS,
      disconnectedAt: player.disconnectedAt,
    });

    // If any member of the current turn team disconnected, pause
    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    if (player.teamIndex === currentTeamIndex && this.state === GAME_STATE.PLAYING) {
      this.clearTurnTimer();
      this.pausedForDisconnect = true;
      this.pausedPlayerId = playerId; // We still track the specific player for resumption
    }

    this.broadcastPlayerInfo();
  }

  /**
   * Called when the reconnection timer expires.
   * NOW we eliminate the player and clean up.
   */
  handleReconnectTimeout(playerId) {
    const player = this.room.getPlayer(playerId);
    if (!player) return;

    // Now actually eliminate the disconnected player
    player.isEliminated = true;
    player.isConnected = false;

    const currentTeamIndex = this.turnOrder[this.currentTurnIndex];
    const wasCurrentTurn = (player.teamIndex === currentTeamIndex);

    this.addLog(`${player.name} failed to reconnect — eliminated!`, 'elimination');

    this.io.to(this.room.code).emit('player_reconnect_failed', {
      playerId,
      playerName: player.name,
    });

    this.io.to(this.room.code).emit('player_eliminated', {
      playerId,
      playerName: player.name,
    });
    this.io.to(this.room.code).emit('sound_event', { type: 'player_eliminated' });

    // Remove from turn order if entire team is eliminated
    const teamIndex = player.teamIndex;
    const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === teamIndex);
    const isTeamAlive = teamPlayers.some(p => !p.isEliminated);
    
    if (!isTeamAlive) {
      this.turnOrder = this.turnOrder.filter(tIdx => tIdx !== teamIndex);
    }

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

    // If the game was paused for this player, resume
    if (this.pausedForDisconnect && this.pausedPlayerId === playerId) {
      this.pausedForDisconnect = false;
      this.pausedPlayerId = null;
      if (this.state === GAME_STATE.PLAYING) {
        this.startTurn();
      }
    } else if (wasCurrentTurn && this.state === GAME_STATE.PLAYING) {
      this.clearTurnTimer();
      this.startTurn();
    }
  }

  handleReconnect(oldPlayerId, newSocketId) {
    const player = this.room.getPlayer(oldPlayerId);
    if (!player) return false;

    player.socketId = newSocketId;
    player.isConnected = true;
    player.disconnectedAt = null;

    // Re-register in the room map with new socket ID if needed
    if (oldPlayerId !== newSocketId) {
      this.room.players.delete(oldPlayerId);
      player.id = newSocketId;
      this.room.players.set(newSocketId, player);

      // Update host if needed
      if (this.room.hostId === oldPlayerId) {
        this.room.hostId = newSocketId;
      }
    }

    this.addLog(`${player.name} reconnected!`, 'system');

    this.io.to(this.room.code).emit('player_reconnected', {
      playerId: newSocketId,
      playerName: player.name,
    });
    this.io.to(this.room.code).emit('sound_event', { type: 'player_joined' });

    this.broadcastPlayerInfo();

    // If game was paused waiting for this player, resume their turn
    if (this.pausedForDisconnect && (this.pausedPlayerId === oldPlayerId || this.pausedPlayerId === newSocketId)) {
      this.pausedForDisconnect = false;
      this.pausedPlayerId = null;
      if (this.state === GAME_STATE.PLAYING) {
        // Give them a fresh turn timer
        this.startTurn();
      }
    }

    return true;
  }

  // ========== HELPERS ==========

  advanceTurn() {
    let attempts = 0;
    do {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
      attempts++;
      const teamIndex = this.turnOrder[this.currentTurnIndex];
      const teamPlayers = [...this.room.players.values()].filter(p => p.teamIndex === teamIndex);
      const isTeamAlive = teamPlayers.some(p => !p.isEliminated);
      if (isTeamAlive) break;
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
          currentTeamIndex: this.turnOrder[this.currentTurnIndex] !== undefined ? this.turnOrder[this.currentTurnIndex] : null,
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
      currentTeamIndex: this.turnOrder[this.currentTurnIndex],
      turnOrder: this.turnOrder,
      lastPlay: this.lastPlay ? {
        playerId: this.lastPlay.playerId,
        declaredRank: this.lastPlay.declaredRank,
        declaredCount: this.lastPlay.declaredCount,
      } : null,
    };
  }
}

module.exports = GameEngine;
