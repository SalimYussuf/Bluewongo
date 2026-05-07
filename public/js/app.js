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
      isChaosMode: false,
    },
    targetingMode: false, // true when player needs to select a target
    chaosTargetingMode: false, // true during chaos mass-shootout
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
  const toggleChaosMode = $('toggle-chaos-mode');

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
  const targetingBanner = $('targeting-banner');
  const targetingText = $('targeting-text');

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
    'Ace': { symbol: 'A', icon: '♠️' },
    'King': { symbol: 'K', icon: '👑' },
    'Queen': { symbol: 'Q', icon: '⚜️' },
    'Joker': { symbol: 'J', icon: '🃏' },
    'Chaos': { symbol: 'C', icon: '🌪️' },
    'Master': { symbol: 'M', icon: '🏆' }
  };

  // ===== AUDIO =====
  function playSound(type) {
    if (!state.soundEnabled) return;

    let fileName = type;

    // Only liar_caught supports randomized versions (1, 2, or 3)
    if (type === 'liar_caught') {
      const rand = Math.floor(Math.random() * 3) + 1;
      fileName = `${type}${rand}`;
    }

    const audio = new Audio(`sounds/${fileName}.mp3`);
    audio.play().catch(e => {
      // Fallback: If randomized version fails, try the base name
      if (fileName !== type) {
        const fallback = new Audio(`sounds/${type}.mp3`);
        fallback.play().catch(err => console.warn(`Sound playback failed: sounds/${type}.mp3`));
      } else {
        console.warn(`Sound playback failed: sounds/${type}.mp3`);
      }
    });
  }

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
    const settings = { isDevilCardMode: toggleDevilMode.checked };
    if (toggleDevilMode.checked && toggleChaosMode.checked) {
      settings.isChaosMode = false;
      toggleChaosMode.checked = false;
    }
    socket.emit('update_settings', { roomCode: state.roomCode, settings });
  });

  toggleChaosMode.addEventListener('change', () => {
    if (!state.isHost) return;
    const settings = { isChaosMode: toggleChaosMode.checked };
    if (toggleChaosMode.checked && toggleDevilMode.checked) {
      settings.isDevilCardMode = false;
      toggleDevilMode.checked = false;
    }
    socket.emit('update_settings', { roomCode: state.roomCode, settings });
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
    toggleChaosMode.disabled = !state.isHost;
  }

  function updatePlayerList(players, hostId) {
    state.isHost = (hostId === state.playerId);
    playerList.innerHTML = '';

    // Group players by team slot
    const teams = {};
    players.forEach(p => {
      if (!teams[p.teamIndex]) teams[p.teamIndex] = [];
      teams[p.teamIndex].push(p);
    });

    Object.keys(teams).sort().forEach((tIdx) => {
      const teamPlayers = teams[tIdx];
      
      const teamWrapper = document.createElement('div');
      teamWrapper.className = 'team-lobby-slot glass';
      
      const label = (tIdx === 'null' || tIdx === 'undefined') ? 'Assigning...' : `Slot ${parseInt(tIdx) + 1}`;
      teamWrapper.innerHTML = `<div class="team-slot-header">${label}</div>`;

      teamPlayers.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'player-item';

        const avatar = document.createElement('div');
        avatar.className = 'player-avatar';
        const colorIndex = (tIdx === 'null' || tIdx === 'undefined') ? 0 : parseInt(tIdx);
        avatar.style.background = avatarColors[colorIndex % avatarColors.length];
        avatar.textContent = p.name.charAt(0).toUpperCase();

        const nameText = document.createElement('span');
        nameText.className = 'player-name';
        nameText.textContent = p.name;

        item.appendChild(avatar);
        item.appendChild(nameText);

        if (p.id === state.playerId) {
          const badge = document.createElement('span');
          badge.className = 'player-badge badge-you';
          badge.textContent = 'You';
          item.appendChild(badge);
        }
        if (p.id === hostId) {
          const badge = document.createElement('span');
          badge.className = 'player-badge badge-host';
          badge.textContent = '👑 Host';
          item.appendChild(badge);
        }
        if (p.isReady) {
          const badge = document.createElement('span');
          badge.className = 'player-badge badge-ready';
          badge.textContent = '✓ Ready';
          item.appendChild(badge);
        }

        teamWrapper.appendChild(item);
      });
      playerList.appendChild(teamWrapper);
    });

    // Show start button for host
    btnStart.style.display = state.isHost ? 'block' : 'none';
    const teamCount = Object.keys(teams).filter(k => k !== 'null' && k !== 'undefined').length;
    btnStart.disabled = teamCount < 2;
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
    } else {
      const limit = state.settings.isChaosMode ? 1 : 3;
      if (state.selectedCardIds.length < limit) {
        state.selectedCardIds.push(cardId);
      } else {
        showToast(`Max ${limit} cards!`, 'warning');
        return;
      }
    }

    renderHand();
    updateControls();
  }

  // ===== GAME — OPPONENTS & PLAYER LIVES =====
  function renderOpponents(players, currentTurnTeamIndex = null) {
    const seats = [$('seat-left'), $('seat-top'), $('seat-right')];
    seats.forEach(s => s.innerHTML = '');

    const me = players.find(p => p.id === state.playerId);
    const myTeamIndex = me ? me.teamIndex : -1;

    // Group other teams
    const teams = {};
    players.forEach(p => {
      if (p.teamIndex === myTeamIndex) return; // Skip my team
      if (!teams[p.teamIndex]) teams[p.teamIndex] = [];
      teams[p.teamIndex].push(p);
    });

    const opponentTeamIndices = Object.keys(teams).sort();

    let assignedSeats = [];
    if (opponentTeamIndices.length === 1) assignedSeats = [seats[1]]; // top
    else if (opponentTeamIndices.length === 2) assignedSeats = [seats[0], seats[2]]; // left, right
    else if (opponentTeamIndices.length >= 3) assignedSeats = [seats[0], seats[1], seats[2]]; // left, top, right

    opponentTeamIndices.forEach((tIdx, i) => {
      const seat = assignedSeats[i];
      if (!seat) return;

      const teamPlayers = teams[tIdx];
      const p = teamPlayers[0]; // Representative for status (eliminated/shots)
      
      const names = teamPlayers.map(tp => tp.name).join(' & ');
      const isEliminated = teamPlayers.every(tp => tp.isEliminated);
      const isDisconnected = teamPlayers.every(tp => !tp.isConnected);

      const card = document.createElement('div');
      card.className = 'opponent-card';
      if (isEliminated) card.classList.add('eliminated');
      if (isDisconnected) card.classList.add('disconnected');
      if (parseInt(tIdx) === currentTurnTeamIndex) card.classList.add('active-turn');
      
      // If any teammate is targetable, the whole slot is targetable
      const isTargetable = (state.targetingMode || state.chaosTargetingMode) && !isEliminated;
      if (isTargetable) card.classList.add('targetable');
      
      card.id = `opponent-team-${tIdx}`;

      // Mini card backs (from the shared team hand)
      let cardsHtml = '';
      const handSize = p.handSize;
      const count = Math.min(handSize, 10);
      for (let c = 0; c < count; c++) {
        cardsHtml += '<div class="mini-card-back"></div>';
      }

      card.innerHTML = `
        <div class="opponent-name">${names}${isDisconnected ? ' ⚡' : ''}${isEliminated ? ' 💀' : ''}</div>
        <div class="opponent-cards-row">${cardsHtml}</div>
        <div style="font-size:.75rem;color:var(--text-dim);margin:4px 0">${handSize} cards</div>
        <div class="opponent-shots" style="font-size: .8rem; font-weight: bold; color: var(--gold);">Shots: ${p.shotsTaken} / 6</div>
      `;

      card.addEventListener('click', () => {
        if (isTargetable) {
          // In team mode, targeting an opponent team hits a specific member (the first non-eliminated one)
          const target = teamPlayers.find(tp => !tp.isEliminated);
          if (target) {
            socket.emit('select_target', { roomCode: state.roomCode, targetId: target.id });
            state.targetingMode = false;
            state.chaosTargetingMode = false;
            targetingBanner.classList.add('hidden');
            renderOpponents(state.players, null);
            showToast(`Targeting team: ${names}`, 'info');
          }
        }
      });

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
      const isMyTeam = r.memberIds && r.memberIds.includes(state.playerId);
      name.textContent = r.names + (isMyTeam ? ' (Your Team)' : '');

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
    if (toggleChaosMode) toggleChaosMode.checked = state.settings.isChaosMode;
    showRoomLobby(data.roomCode, data.players, data.hostId);
    showToast('Room created!', 'success');
  });

  socket.on('room_joined', (data) => {
    state.playerId = data.playerId;
    state.roomCode = data.roomCode;
    state.settings = data.settings || state.settings;
    if (toggleDevilMode) toggleDevilMode.checked = state.settings.isDevilCardMode;
    if (toggleChaosMode) toggleChaosMode.checked = state.settings.isChaosMode;
    showRoomLobby(data.roomCode, data.players, data.hostId);
    showToast('Joined room!', 'success');
  });

  socket.on('settings_updated', (data) => {
    state.settings = data.settings;
    if (toggleDevilMode) toggleDevilMode.checked = state.settings.isDevilCardMode;
    if (toggleChaosMode) toggleChaosMode.checked = state.settings.isChaosMode;

    let modeMsg = [];
    if (state.settings.isDevilCardMode) modeMsg.push('Devil Mode: ON');
    if (state.settings.isChaosMode) modeMsg.push('Chaos Mode: ON');
    if (modeMsg.length === 0) modeMsg.push('Special Modes: OFF');
    showToast(modeMsg.join(' | '), 'info');
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

    // Failsafe hide overlays
    revealOverlay.classList.add('hidden');
    revolverOverlay.classList.add('hidden');

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
    const me = state.players.find(p => p.id === state.playerId);
    state.isMyTurn = (me && me.teamIndex === data.teamIndex);
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
      statusMessage.textContent = `${data.teamNames}'s turn...`;
    }

    if (data.currentRank) {
      currentRankBadge.style.display = 'inline-flex';
      currentRankText.textContent = data.currentRank + 's';
    }

    renderOpponents(state.players, data.teamIndex);
    updatePile(data.pileSize);
    renderHand();
    updateControls();
    startTimer(data.timeLimit);
  });

  socket.on('cards_played', (data) => {
    const teamPlayers = state.players.filter(p => p.teamIndex === data.teamIndex);
    const isMyTeam = teamPlayers.some(p => p.id === state.playerId);
    const teamNames = teamPlayers.map(p => p.name).join(' & ');
    const who = isMyTeam ? 'Your Team' : teamNames;

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
    renderOpponents(data.players, data.currentTeamIndex);
    const me = data.players.find(p => p.id === state.playerId);
    renderPlayerLives(me);
  });

  // -- Challenge --
  socket.on('liar_called', (data) => {
    clearTimer();
    const isChallengerMe = data.challengerId === state.playerId;
    const isChallengedMe = data.challengedId === state.playerId;

    const challengerTeamPlayers = state.players.filter(p => p.teamIndex === data.challengerTeamIndex);
    const challengedTeamPlayers = state.players.filter(p => p.teamIndex === data.challengedTeamIndex);

    const challengerNames = challengerTeamPlayers.map(p => p.name).join(' & ');
    const challengedNames = challengedTeamPlayers.map(p => p.name).join(' & ');

    const who = isChallengerMe ? 'You' : challengerNames;
    const whom = isChallengedMe ? 'your team' : challengedNames;

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
          card.rank === 'Queen' ? 'var(--accent-queen)' :
            card.rank === 'Chaos' ? 'var(--crimson)' :
              card.rank === 'Master' ? 'var(--gold)' : 'var(--accent-joker)';
      el.style.borderColor = color;
      el.style.color = color;
      el.innerHTML = `<span>${info.icon}</span><span style="font-size:.8rem">${card.rank}</span>`;
      revealCards.appendChild(el);
    });

    const challengedTeamPlayers = state.players.filter(p => p.teamIndex === data.challengedTeamIndex);
    const challengedTeamNames = challengedTeamPlayers.map(p => p.name).join(' & ');

    if (data.wasLying) {
      revealResult.className = 'reveal-result liar';
      revealResult.textContent = `🤥 ${challengedTeamNames} were LYING!`;
    } else {
      revealResult.className = 'reveal-result truth';
      revealResult.textContent = `✅ ${challengedTeamNames} told the truth!`;

      if (data.hasDevilCard) {
        revealResult.innerHTML += `<br><span style="color:var(--crimson); font-weight:900; font-size:1.2rem; animation: pulse-liar 1s infinite;">😈 DEVIL CARD TRIGGERED! 😈</span>`;
        playSound('devil_laugh');
      }
    }
  });

  socket.on('challenge_result', (data) => {
    const isLoserMe = data.loserId === state.playerId;
    const loserTeamPlayers = state.players.filter(p => p.teamIndex === data.teamIndex);
    const loserTeamNames = loserTeamPlayers.map(p => p.name).join(' & ');

    const loserText = isLoserMe ? 'Your team picks' : `${loserTeamNames} pick`;
    showToast(`${loserText} up the pile!`, 'info');
  });

  socket.on('targeting_started', (data) => {
    // Hide reveal overlay so players can see the board
    revealOverlay.classList.add('hidden');

    if (data.shooterId === state.playerId) {
      if (data.isChaosMass) {
        state.chaosTargetingMode = true;
      } else {
        state.targetingMode = true;
      }
      targetingBanner.classList.remove('hidden');
      statusMessage.className = 'status-message status-your-turn';
      statusMessage.textContent = '🔥 Your turn to SHOOT! Select a target!';
      renderOpponents(state.players, null); // Add targetable class
      showToast('Select a player to shoot!', 'warning');
    } else {
      statusMessage.className = 'status-message status-waiting';
      statusMessage.textContent = `Waiting for ${data.shooterName} to pick a target...`;
      showToast(`${data.shooterName} is choosing a target!`, 'warning');
    }
  });

  // Old Devil Card screen removed to unify with reveal screen
  socket.on('devil_card_triggered', (data) => {
    // We now handle this via unified reveal and standard roulette sequence
    console.log('Devil Card Triggered', data);
  });

  // -- Revolver --
  socket.on('revolver_result', (data) => {
    revealOverlay.classList.add('hidden');
    revolverOverlay.classList.remove('hidden');

    const revolverEmoji = document.querySelector('.revolver-emoji');
    revolverEmoji.textContent = '🔫';
    revolverEmoji.className = 'revolver-emoji spinning';

    const teamPlayers = state.players.filter(p => p.teamIndex === data.teamIndex);
    const teamNames = teamPlayers.length > 0 ? teamPlayers.map(p => p.name).join(' & ') : data.playerName;
    
    revolverPlayer.textContent = `${teamNames} are taking the shot...`;
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
    revealOverlay.classList.add('hidden');
    revolverOverlay.classList.add('hidden');
    const who = data.winnerId === state.playerId ? 'You' : data.winnerName;
    showToast(`${who} won the round!`, 'success');
    statusMessage.textContent = data.reason;
  });

  socket.on('game_over', (data) => {
    clearTimer();
    state.gameActive = false;
    playSound('game_over');
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

  socket.on('sound_event', (data) => {
    playSound(data.type);
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
