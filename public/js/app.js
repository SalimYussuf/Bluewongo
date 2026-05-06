// ===== UWONGO'S BAR — CLIENT APP =====
(function () {
  'use strict';

  const socket = io();

  // ===== STATE =====
  const state = {
    playerId: null,
    playerName: '',
    roomCode: null,
    isHost: false,
    hand: [],
    selectedCardIds: [],
    currentRank: null,
    declaredRank: null,
    isMyTurn: false,
    canCallLiar: false,
    isFirstPlay: false,
    turnTimerInterval: null,
    turnTimeLeft: 0,
    players: [],
    gameActive: false,
    soundEnabled: true,
    settings: {
      isDevilCardMode: false,
    },
  };

  // ===== DOM REFS =====
  const $ = (id) => document.getElementById(id);
  const screens = {
    lobby: $('lobby-screen'),
    game: $('game-screen'),
    results: $('results-screen'),
  };

  // Lobby
  const nameInput = $('player-name-input');
  const codeInput = $('room-code-input');
  const btnCreate = $('btn-create-room');
  const btnJoin = $('btn-join-room');
  const joinPanel = $('lobby-join-panel');
  const roomPanel = $('lobby-room-panel');
  const displayCode = $('display-room-code');
  const playerList = $('player-list');
  const btnReady = $('btn-ready');
  const btnStart = $('btn-start-game');
  const btnLeave = $('btn-leave-room');
  const roomSettingsPanel = $('room-settings-panel');
  const toggleDevilMode = $('toggle-devil-mode');

  // Game
  const handContainer = $('hand-container');
  const playerLives = $('player-lives');
  const pileStack = $('pile-stack');
  const pileCount = $('pile-count');
  const statusMessage = $('status-message');
  const lastPlayInfo = $('last-play-info');
  const currentRankBadge = $('current-rank-badge');
  const currentRankText = $('current-rank-text');
  const declarationPanel = $('declaration-panel');
  const rankButtons = $('rank-buttons');
  const btnPlayCards = $('btn-play-cards');
  const btnCallLiar = $('btn-call-liar');
  const turnTimer = $('turn-timer');
  const timerCircle = $('timer-circle');
  const timerText = $('timer-text');
  const gameRound = $('game-round');
  const gameRoomCode = $('game-room-code');
  const gameLog = $('game-log');
  const btnMute = $('btn-mute');
  const devilBanner = $('devil-banner');

  // Overlays
  const revealOverlay = $('reveal-overlay');
  const revealTitle = $('reveal-title');
  const revealCards = $('reveal-cards');
  const revealResult = $('reveal-result');
  const revolverOverlay = $('revolver-overlay');
  const revolverPlayer = $('revolver-player');
  const revolverResult = $('revolver-result');
  const disconnectOverlay = $('disconnect-overlay');
  const disconnectMessage = $('disconnect-message');
  const disconnectTimer = $('disconnect-timer');
  const btnReconnect = $('btn-reconnect');

  // Results
  const rankingsList = $('rankings-list');
  const btnPlayAgain = $('btn-play-again');
  const btnBackLobby = $('btn-back-lobby');

  // ===== CARD SYMBOLS =====
  const rankSymbols = {
    Ace: { symbol: 'A', icon: '♠' },
    King: { symbol: 'K', icon: '♚' },
    Queen: { symbol: 'Q', icon: '♛' },
    Joker: { symbol: '★', icon: '🃏' },
  };

  const avatarColors = ['#818cf8', '#f59e0b', '#ec4899', '#10b981', '#a855f7', '#06b6d4'];

  // ===== SCREEN MANAGEMENT =====
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // ===== TOAST =====
  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    $('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ===== AUDIO ENGINE =====
  const sounds = {
    card_placed: new Audio('sounds/card_placed.mp3'),
    liar_called: new Audio('sounds/liar_called.mp3'),
    liar_caught: new Audio('sounds/liar_caught.mp3'),
    truth_told: new Audio('sounds/truth_told.mp3'),
    your_turn: new Audio('sounds/your_turn.mp3'),
    roulette_spin: new Audio('sounds/roulette_spin.mp3'),
    roulette_fire: new Audio('sounds/roulette_fire.mp3'),
    game_win: new Audio('sounds/game_win.mp3'),
    player_joined: new Audio('sounds/player_joined.mp3'),
    player_eliminated: new Audio('sounds/player_eliminated.mp3'),
    devil_laugh: new Audio('sounds/devil_laugh.mp3')
  };

  // Preload and adjust volumes if needed
  Object.values(sounds).forEach(audio => {
    audio.preload = 'auto';
    audio.volume = 0.7; // default volume
  });

  function playSound(type) {
    if (!state.soundEnabled) return;
    const sound = sounds[type];
    if (sound) {
      sound.currentTime = 0; // reset to start
      sound.play().catch(err => {
        // Ignore playback errors (e.g. user hasn't interacted with page yet, or file missing)
        console.warn(`Could not play sound: ${type}`, err);
      });
    }
  }

  btnMute.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    btnMute.textContent = state.soundEnabled ? '🔊' : '🔇';
    btnMute.classList.toggle('muted', !state.soundEnabled);
  });

  // ===== LOBBY =====
  btnCreate.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { showToast('Enter your name!', 'error'); return; }
    state.playerName = name;
    socket.emit('create_room', { playerName: name });
  });

  btnJoin.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) { showToast('Enter your name!', 'error'); return; }
    if (!code) { showToast('Enter a room code!', 'error'); return; }
    state.playerName = name;
    socket.emit('join_room', { roomCode: code, playerName: name });
  });

  // Enter key support
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnCreate.click(); });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnJoin.click(); });

  btnReady.addEventListener('click', () => {
    socket.emit('player_ready', { roomCode: state.roomCode });
  });

  btnStart.addEventListener('click', () => {
    socket.emit('start_game', { roomCode: state.roomCode });
  });

  btnLeave.addEventListener('click', () => {
    socket.emit('leave_room', { roomCode: state.roomCode });
    resetToJoin();
  });

  displayCode.addEventListener('click', () => {
    navigator.clipboard.writeText(state.roomCode).then(() => {
      showToast('Room code copied!', 'success');
    });
  });

  toggleDevilMode.addEventListener('change', () => {
    if (!state.isHost) return;
    socket.emit('update_settings', {
      roomCode: state.roomCode,
      settings: { isDevilCardMode: toggleDevilMode.checked }
    });
  });

  function showRoomLobby(roomCode, players, hostId) {
    state.roomCode = roomCode;
    state.isHost = (hostId === state.playerId);
    joinPanel.style.display = 'none';
    roomPanel.style.display = 'block';
    displayCode.textContent = roomCode;
    updatePlayerList(players, hostId);

    // Show settings panel if host
    roomSettingsPanel.style.display = 'block';
    toggleDevilMode.disabled = !state.isHost;
  }

  function updatePlayerList(players, hostId) {
    state.isHost = (hostId === state.playerId);
    playerList.innerHTML = '';

    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'player-item';

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = avatarColors[i % avatarColors.length];
      avatar.textContent = p.name.charAt(0).toUpperCase();

      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = p.name;

      li.appendChild(avatar);
      li.appendChild(name);

      if (p.id === state.playerId) {
        const badge = document.createElement('span');
        badge.className = 'player-badge badge-you';
        badge.textContent = 'You';
        li.appendChild(badge);
      }
      if (p.id === hostId) {
        const badge = document.createElement('span');
        badge.className = 'player-badge badge-host';
        badge.textContent = '👑 Host';
        li.appendChild(badge);
      }
      if (p.isReady) {
        const badge = document.createElement('span');
        badge.className = 'player-badge badge-ready';
        badge.textContent = '✓ Ready';
        li.appendChild(badge);
      }

      playerList.appendChild(li);
    });

    // Show start button for host
    btnStart.style.display = state.isHost ? 'block' : 'none';
    btnStart.disabled = players.length < 2;
  }

  function resetToJoin() {
    state.roomCode = null;
    state.isHost = false;
    joinPanel.style.display = 'block';
    roomPanel.style.display = 'none';
    showScreen('lobby');
  }

  // ===== GAME — HAND =====
  function renderHand() {
    handContainer.innerHTML = '';
    // Sort hand by rank
    const order = { Ace: 0, King: 1, Queen: 2, Joker: 3 };
    const sorted = [...state.hand].sort((a, b) => (order[a.rank] ?? 9) - (order[b.rank] ?? 9));

    sorted.forEach(card => {
      const el = document.createElement('div');
      el.className = 'card' + (state.selectedCardIds.includes(card.id) ? ' selected' : '');
      if (!state.isMyTurn) el.classList.add('disabled');
      el.dataset.rank = card.rank;
      el.dataset.cardId = card.id;

      const info = rankSymbols[card.rank] || { symbol: '?', icon: '' };

      el.innerHTML = `
        <span class="card-corner top">${info.symbol}</span>
        <span class="card-rank">${info.icon}</span>
        <span class="card-label">${card.rank}</span>
        <span class="card-corner bottom">${info.symbol}</span>
      `;

      if (card.isDevil) {
        el.classList.add('devil-card');
        el.title = "DEVIL CARD — If challenged while telling the truth, all opponents shoot!";
        const devilIcon = document.createElement('span');
        devilIcon.className = 'devil-icon';
        devilIcon.textContent = '😈';
        el.appendChild(devilIcon);
      }

      el.addEventListener('click', () => toggleCard(card.id));
      handContainer.appendChild(el);
    });
  }

  function toggleCard(cardId) {
    if (!state.isMyTurn) return;

    const idx = state.selectedCardIds.indexOf(cardId);
    if (idx > -1) {
      state.selectedCardIds.splice(idx, 1);
    } else if (state.selectedCardIds.length < 3) {
      state.selectedCardIds.push(cardId);
    } else {
      showToast('Max 3 cards!', 'warning');
      return;
    }

    renderHand();
    updateControls();
  }

  // ===== GAME — OPPONENTS & PLAYER LIVES =====
  function renderOpponents(players, currentTurnId = null) {
    const seats = [$('seat-left'), $('seat-top'), $('seat-right')];
    seats.forEach(s => s.innerHTML = '');

    const opponents = players.filter(p => p.id !== state.playerId);

    let assignedSeats = [];
    if (opponents.length === 1) assignedSeats = [seats[1]]; // top
    else if (opponents.length === 2) assignedSeats = [seats[0], seats[2]]; // left, right
    else if (opponents.length >= 3) assignedSeats = [seats[0], seats[1], seats[2]]; // left, top, right

    opponents.forEach((p, i) => {
      const seat = assignedSeats[i];
      if (!seat) return;

      const card = document.createElement('div');
      card.className = 'opponent-card';
      if (p.isEliminated) card.classList.add('eliminated');
      if (!p.isConnected) card.classList.add('disconnected');
      if (p.id === currentTurnId) card.classList.add('active-turn');
      card.id = `opponent-${p.id}`;

      // Mini card backs
      let cardsHtml = '';
      const count = Math.min(p.handSize, 10);
      for (let c = 0; c < count; c++) {
        cardsHtml += '<div class="mini-card-back"></div>';
      }

      card.innerHTML = `
        <div class="opponent-name">${p.name}${!p.isConnected ? ' ⚡' : ''}${p.isEliminated ? ' 💀' : ''}</div>
        <div class="opponent-cards-row">${cardsHtml}</div>
        <div style="font-size:.75rem;color:var(--text-dim);margin:4px 0">${p.handSize} cards</div>
        <div class="opponent-shots" style="font-size: .8rem; font-weight: bold; color: var(--gold);">Shots: ${p.shotsTaken} / 6</div>
      `;

      seat.appendChild(card);
    });
  }

  function renderPlayerLives(playerInfo) {
    const shotsText = $('player-shots-text');
    if (!playerInfo) return;
    shotsText.textContent = `${playerInfo.shotsTaken} / ${playerInfo.maxShots || 6}`;
    const livesTitle = $('player-lives-panel')?.querySelector('.lives-title');
    if (livesTitle) livesTitle.textContent = "Shots Taken";
  }

  function highlightActivePlayer(playerId) {
    document.querySelectorAll('.opponent-card').forEach(c => c.classList.remove('active-turn'));
    const el = document.getElementById(`opponent-${playerId}`);
    if (el) el.classList.add('active-turn');
  }

  // ===== GAME — PILE =====
  function updatePile(size) {
    pileStack.innerHTML = '';
    const displayed = Math.min(size, 5);
    for (let i = 0; i < displayed; i++) {
      const card = document.createElement('div');
      card.className = 'pile-card-back';
      card.style.top = `${-i * 3}px`;
      card.style.left = `${(Math.random() - 0.5) * 6}px`;
      card.style.transform = `rotate(${(Math.random() - 0.5) * 8}deg)`;
      pileStack.appendChild(card);
    }
    if (size > 0) {
      const countEl = document.createElement('div');
      countEl.className = 'pile-count';
      countEl.textContent = size;
      pileStack.appendChild(countEl);
    }
    pileCount.textContent = size;
  }

  // ===== GAME — CONTROLS =====
  function updateControls() {
    const hasSelected = state.selectedCardIds.length > 0;

    // Rank is always auto-assigned by the server (Issue 4)
    // No rank picker needed — always use state.currentRank
    declarationPanel.classList.add('hidden');
    state.declaredRank = state.currentRank;
    btnPlayCards.disabled = !(state.isMyTurn && hasSelected && state.currentRank);

    btnCallLiar.disabled = !state.canCallLiar || !state.isMyTurn;
    btnPlayCards.style.display = state.isMyTurn ? 'inline-flex' : 'none';
  }

  function buildRankButtons(lockedRank) {
    rankButtons.innerHTML = '';
    const ranks = ['Ace', 'King', 'Queen'];

    ranks.forEach(rank => {
      const btn = document.createElement('button');
      btn.className = 'rank-btn';
      if (state.declaredRank === rank) btn.classList.add('active');
      if (lockedRank && lockedRank !== rank) btn.disabled = true;
      btn.textContent = rank;
      btn.addEventListener('click', () => {
        state.declaredRank = rank;
        buildRankButtons(lockedRank);
        updateControls();
      });
      rankButtons.appendChild(btn);
    });
  }

  btnPlayCards.addEventListener('click', () => {
    if (!state.isMyTurn || state.selectedCardIds.length === 0) return;

    const rank = state.declaredRank || state.currentRank;
    if (!rank) {
      showToast('Select a rank to declare!', 'warning');
      return;
    }

    socket.emit('play_cards', {
      roomCode: state.roomCode,
      cardIds: state.selectedCardIds,
      declaredRank: rank,
      declaredCount: state.selectedCardIds.length,
    });

    state.selectedCardIds = [];
    state.declaredRank = null;
  });

  btnCallLiar.addEventListener('click', () => {
    if (!state.canCallLiar || !state.isMyTurn) return;
    socket.emit('call_liar', { roomCode: state.roomCode });
    btnCallLiar.disabled = true;
  });

  // ===== TIMER =====
  function startTimer(duration) {
    clearTimer();
    state.turnTimeLeft = Math.ceil(duration / 1000);
    turnTimer.style.display = 'block';
    const total = state.turnTimeLeft;
    const circumference = 150.8;

    updateTimerDisplay();

    state.turnTimerInterval = setInterval(() => {
      state.turnTimeLeft--;
      if (state.turnTimeLeft <= 0) {
        clearTimer();
        return;
      }
      updateTimerDisplay();
    }, 1000);

    function updateTimerDisplay() {
      const pct = state.turnTimeLeft / total;
      timerCircle.style.strokeDashoffset = circumference * (1 - pct);
      timerText.textContent = state.turnTimeLeft;

      timerCircle.classList.remove('warning', 'danger');
      timerText.classList.remove('danger');
      if (state.turnTimeLeft <= 5) {
        timerCircle.classList.add('danger');
        timerText.classList.add('danger');
      } else if (state.turnTimeLeft <= 10) {
        timerCircle.classList.add('warning');
      }
    }
  }

  function clearTimer() {
    if (state.turnTimerInterval) clearInterval(state.turnTimerInterval);
    state.turnTimerInterval = null;
    turnTimer.style.display = 'none';
  }

  // ===== EMOJI =====
  document.querySelectorAll('.emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      socket.emit('send_emoji', { roomCode: state.roomCode, emoji: btn.dataset.emoji });
    });
  });

  function showFloatingEmoji(emoji, playerName) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.top = `${20 + Math.random() * 30}%`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // ===== RESULTS =====
  btnPlayAgain.addEventListener('click', () => {
    socket.emit('play_again', { roomCode: state.roomCode });
  });

  btnBackLobby.addEventListener('click', () => {
    socket.emit('leave_room', { roomCode: state.roomCode });
    resetToJoin();
  });

  function showResults(rankings) {
    rankingsList.innerHTML = '';
    const posColors = ['gold', 'silver', 'bronze'];

    rankings.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'ranking-item glass';

      const pos = document.createElement('div');
      pos.className = `ranking-position ${posColors[i] || ''}`;
      pos.textContent = `#${r.position}`;

      const name = document.createElement('div');
      name.className = 'ranking-name';
      name.textContent = r.name + (r.id === state.playerId ? ' (You)' : '');

      const status = document.createElement('div');
      status.className = 'ranking-status';
      status.textContent = r.eliminated ? '💀 Eliminated' : (r.position === 1 ? '🏆 Winner!' : `${r.cardsLeft} cards left`);

      li.appendChild(pos);
      li.appendChild(name);
      li.appendChild(status);
      rankingsList.appendChild(li);
    });

    showScreen('results');
  }

  // ===== GAME LOG =====
  function addLogEntry(message, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type || ''}`;
    entry.textContent = message;
    gameLog.appendChild(entry);
    gameLog.scrollTop = gameLog.scrollHeight;
  }

  // ===== SOCKET EVENTS =====

  // -- Lobby --
  socket.on('room_created', (data) => {
    state.playerId = data.playerId;
    state.roomCode = data.roomCode;
    state.settings = data.settings || state.settings;
    if (toggleDevilMode) toggleDevilMode.checked = state.settings.isDevilCardMode;
    showRoomLobby(data.roomCode, data.players, data.hostId);
    showToast('Room created!', 'success');
  });

  socket.on('room_joined', (data) => {
    state.playerId = data.playerId;
    state.roomCode = data.roomCode;
    state.settings = data.settings || state.settings;
    if (toggleDevilMode) toggleDevilMode.checked = state.settings.isDevilCardMode;
    showRoomLobby(data.roomCode, data.players, data.hostId);
    showToast('Joined room!', 'success');
  });

  socket.on('settings_updated', (data) => {
    state.settings = data.settings;
    if (toggleDevilMode) toggleDevilMode.checked = state.settings.isDevilCardMode;
    showToast(`Devil Mode: ${state.settings.isDevilCardMode ? 'ON' : 'OFF'}`, 'info');
  });

  socket.on('player_list_update', (data) => {
    updatePlayerList(data.players, data.hostId);
  });

  socket.on('host_changed', (data) => {
    state.isHost = (data.newHostId === state.playerId);
    showToast('Host changed!', 'info');
  });

  // -- Game Start --
  socket.on('game_started', (data) => {
    state.gameActive = true;
    showScreen('game');
    gameRoomCode.textContent = state.roomCode;
    gameLog.innerHTML = '';
    revealOverlay.classList.add('hidden');
    revolverOverlay.classList.add('hidden');

    if (state.settings.isDevilCardMode) {
      devilBanner.classList.remove('hidden');
    } else {
      devilBanner.classList.add('hidden');
    }
  });

  socket.on('cards_dealt', (data) => {
    state.hand = data.hand;
    state.players = data.players;
    state.selectedCardIds = [];
    state.declaredRank = null;
    state.currentRank = data.currentRank || null;
    gameRound.textContent = data.roundNumber;

    renderHand();
    renderOpponents(data.players, data.firstPlayerId);
    const me = data.players.find(p => p.id === state.playerId);
    renderPlayerLives(me);
    updatePile(0);
    lastPlayInfo.textContent = '';

    // Show the auto-assigned rank immediately
    if (state.currentRank) {
      currentRankBadge.style.display = 'inline-flex';
      currentRankText.textContent = state.currentRank + 's';
    }
  });

  // -- Turns --
  socket.on('turn_start', (data) => {
    state.isMyTurn = (data.playerId === state.playerId);
    state.canCallLiar = data.canCallLiar && state.isMyTurn;
    state.currentRank = data.currentRank;
    state.isFirstPlay = data.isFirstPlay;
    state.selectedCardIds = [];
    state.declaredRank = null;

    if (state.isMyTurn) {
      statusMessage.className = 'status-message status-your-turn';
      statusMessage.textContent = state.canCallLiar ? 'Your turn — Play or call LIAR!' : 'Your turn — Play cards!';
    } else {
      statusMessage.className = 'status-message status-waiting';
      statusMessage.textContent = `${data.playerName}'s turn...`;
    }

    if (data.currentRank) {
      currentRankBadge.style.display = 'inline-flex';
      currentRankText.textContent = data.currentRank + 's';
    }

    highlightActivePlayer(data.playerId);
    updatePile(data.pileSize);
    renderHand();
    updateControls();
    startTimer(data.timeLimit);
  });

  socket.on('cards_played', (data) => {
    const who = data.playerId === state.playerId ? 'You' : data.playerName;
    lastPlayInfo.textContent = `${who} played ${data.declaredCount} ${data.declaredRank}${data.declaredCount > 1 ? 's' : ''}`;
    updatePile(data.pileSize);
  });

  socket.on('hand_update', (data) => {
    state.hand = data.hand;
    state.selectedCardIds = [];
    renderHand();
  });

  socket.on('players_update', (data) => {
    state.players = data.players;
    renderOpponents(data.players, data.currentTurnId);
    const me = data.players.find(p => p.id === state.playerId);
    renderPlayerLives(me);
  });

  // -- Challenge --
  socket.on('liar_called', (data) => {
    clearTimer();
    const who = data.challengerId === state.playerId ? 'You' : data.challengerName;
    const whom = data.challengedId === state.playerId ? 'you' : data.challengedName;
    showToast(`${who} called LIAR on ${whom}!`, 'warning');
    statusMessage.className = 'status-message';
    statusMessage.textContent = '🔍 Revealing cards...';
    btnPlayCards.disabled = true;
    btnCallLiar.disabled = true;
  });

  socket.on('cards_revealed', (data) => {
    // Show reveal overlay
    revealOverlay.classList.remove('hidden');
    revealTitle.textContent = `Declared: ${data.declaredRank}s`;

    revealCards.innerHTML = '';
    data.cards.forEach(card => {
      const el = document.createElement('div');
      el.className = 'reveal-card';
      const info = rankSymbols[card.rank] || { symbol: '?', icon: '' };
      const color = card.rank === 'Ace' ? 'var(--accent-ace)' :
        card.rank === 'King' ? 'var(--accent-king)' :
          card.rank === 'Queen' ? 'var(--accent-queen)' : 'var(--accent-joker)';
      el.style.borderColor = color;
      el.style.color = color;
      el.innerHTML = `<span>${info.icon}</span><span style="font-size:.8rem">${card.rank}</span>`;
      revealCards.appendChild(el);
    });

    if (data.wasLying) {
      revealResult.className = 'reveal-result liar';
      revealResult.textContent = `🤥 ${data.challengedName} was LYING!`;
    } else {
      revealResult.className = 'reveal-result truth';
      revealResult.textContent = `✅ ${data.challengedName} told the truth!`;
    }
  });

  socket.on('challenge_result', (data) => {
    const loserText = data.loserId === state.playerId ? 'You pick' : `${data.loserName} picks`;
    showToast(`${loserText} up the pile!`, 'info');
  });

  socket.on('devil_card_triggered', (data) => {
    // Show dramatic full-screen reveal
    const overlay = document.createElement('div');
    overlay.className = 'devil-reveal-screen';

    const devilCard = data.cards.find(c => c.isDevil) || data.cards[0];
    const info = rankSymbols[devilCard.rank] || { symbol: '?', icon: '😈' };

    overlay.innerHTML = `
      <div class="devil-reveal-title">DEVIL CARD!</div>
      <div class="devil-reveal-card-container">
        <div class="devil-reveal-card">
          <span>${info.icon}</span>
        </div>
      </div>
      <div class="devil-reveal-subtitle">
        ${data.placerName} told the truth!<br>
        <span style="color:var(--gold);font-weight:900">EVERYONE ELSE TAKES A SHOT!</span>
      </div>
      <div class="devil-shootout-row" id="devil-shootout-row"></div>
    `;

    document.body.appendChild(overlay);
    playSound('devil_laugh');

    // After a delay, show the shots
    setTimeout(() => {
      const row = $('devil-shootout-row');
      data.victims.forEach(v => {
        const victimEl = document.createElement('div');
        victimEl.className = 'devil-victim';
        victimEl.innerHTML = `
          <div class="victim-name">${v.name}</div>
          <div class="victim-gun">🔫</div>
        `;
        row.appendChild(victimEl);

        // Animate shot
        setTimeout(() => {
          if (v.fired) {
            victimEl.querySelector('.victim-gun').textContent = '💥';
            victimEl.classList.add('hit');
            playSound('roulette_fire');
          } else {
            victimEl.querySelector('.victim-gun').textContent = '😮‍💨';
            playSound('roulette_spin'); // Or a click sound
          }
        }, 1000 + Math.random() * 500);
      });
    }, 2000);

    setTimeout(() => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 1s ease';
      setTimeout(() => overlay.remove(), 1000);
    }, 6000);
  });

  // -- Revolver --
  socket.on('revolver_result', (data) => {
    revealOverlay.classList.add('hidden');
    revolverOverlay.classList.remove('hidden');

    const revolverEmoji = document.querySelector('.revolver-emoji');
    revolverEmoji.textContent = '🔫';
    revolverEmoji.className = 'revolver-emoji spinning';

    revolverPlayer.textContent = `${data.playerName} pulls the trigger...`;
    revolverResult.textContent = '';

    setTimeout(() => {
      if (data.fired) {
        revolverEmoji.textContent = data.isEliminated ? '💀' : '💥';
        revolverEmoji.className = 'revolver-emoji ' + (data.isEliminated ? 'eliminated' : 'fired');
        revolverResult.className = 'revolver-result eliminated';
        revolverResult.textContent = data.isEliminated ? 'BANG! Eliminated!' : 'BANG! haha ded';
        if (data.isEliminated) playSound('player_eliminated');
      } else {
        revolverEmoji.textContent = '😮‍💨';
        revolverEmoji.className = 'revolver-emoji safe';
        revolverResult.className = 'revolver-result survived';
        revolverResult.textContent = 'Click... Survived!';
      }
    }, 1500);

    setTimeout(() => {
      revolverOverlay.classList.add('hidden');
    }, 4500);
  });

  socket.on('player_eliminated', (data) => {
    const who = data.playerId === state.playerId ? 'You were' : `${data.playerName} was`;
    showToast(`${who} eliminated!`, 'error');
  });

  // -- Round/Game Over --
  socket.on('round_over', (data) => {
    clearTimer();
    const who = data.winnerId === state.playerId ? 'You' : data.winnerName;
    showToast(`${who} won the round!`, 'success');
    statusMessage.textContent = data.reason;
  });

  socket.on('game_over', (data) => {
    clearTimer();
    state.gameActive = false;
    setTimeout(() => showResults(data.rankings), 1500);
  });

  // -- Misc --
  socket.on('turn_timeout', (data) => {
    const who = data.playerId === state.playerId ? 'You' : data.playerName;
    showToast(`⏰ ${who} ran out of time!`, 'warning');
  });

  socket.on('game_log', (data) => {
    addLogEntry(data.message, data.type);
  });

  socket.on('player_disconnected', (data) => {
    showToast(`${data.playerName} disconnected!`, 'warning');
  });

  socket.on('player_reconnect_failed', (data) => {
    showToast(`${data.playerName} failed to reconnect.`, 'error');
  });

  socket.on('player_reconnected', (data) => {
    showToast(`${data.playerName} reconnected!`, 'success');
  });

  socket.on('sound_event', (data) => {
    playSound(data.type);
  });

  // Local disconnect
  let disconnectInterval = null;
  socket.on('disconnect', () => {
    if (state.gameActive) {
      disconnectOverlay.classList.remove('hidden');
      btnReconnect.style.display = 'inline-flex';
      let timeLeft = 60; // Should match RECONNECT_TIMEOUT_MS
      disconnectTimer.textContent = timeLeft + 's';

      if (disconnectInterval) clearInterval(disconnectInterval);
      disconnectInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
          clearInterval(disconnectInterval);
          disconnectMessage.textContent = 'Reconnection time expired. You were eliminated.';
          btnReconnect.style.display = 'none';
        } else {
          disconnectTimer.textContent = timeLeft + 's';
        }
      }, 1000);
    }
  });

  btnReconnect.addEventListener('click', () => {
    socket.connect();
    // Reconnection attempt will be sent on the 'connect' event
  });

  socket.on('connect', () => {
    if (state.gameActive && !disconnectOverlay.classList.contains('hidden')) {
      socket.emit('reconnect_attempt', { roomCode: state.roomCode, playerName: state.playerName });
    }
  });

  socket.on('emoji_received', (data) => {
    showFloatingEmoji(data.emoji, data.playerName);
  });

  socket.on('back_to_lobby', (data) => {
    state.gameActive = false;
    showScreen('lobby');
    joinPanel.style.display = 'none';
    roomPanel.style.display = 'block';
    displayCode.textContent = state.roomCode;
    updatePlayerList(data.players, data.hostId);
    showToast('Back to lobby!', 'info');
  });

  socket.on('error', (data) => {
    showToast(data.message, 'error');
  });

  socket.on('reconnect_success', (data) => {
    state.playerId = data.playerId;
    state.roomCode = data.roomCode;
    state.hand = data.hand;
    state.players = data.players;
    state.gameActive = true;

    showScreen('game');
    gameRoomCode.textContent = state.roomCode;
    renderHand();
    renderOpponents(data.players, data.gameState.currentPlayerId);
    const me = data.players.find(p => p.id === state.playerId);
    renderPlayerLives(me);

    // Hide disconnect overlay
    disconnectOverlay.classList.add('hidden');
    if (disconnectInterval) clearInterval(disconnectInterval);

    showToast('Reconnected!', 'success');
  });

})();
