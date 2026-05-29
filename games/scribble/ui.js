const socket = window.app.socket;
const state = window.app.state;

const screen = document.getElementById('scribble-screen');

screen.innerHTML = `
<div class="game-layout" id="scribble-layout">
  <!-- LEFT: Scores (desktop only) -->
  <div class="left-column" id="scores-panel">
    <div class="glass panel">
      <h3>🏆 Scores</h3>
      <ul id="scribble-scores"></ul>
    </div>
  </div>

  <!-- CENTER: Info bar, Canvas, Tools -->
  <div class="center-column">
    <div class="glass info-bar">
      <div id="scribble-round-info">Round 1/3</div>
      <div id="scribble-word-display">WAITING...</div>
      <div id="scribble-timer">60</div>
    </div>
    <div class="canvas-container" id="canvas-container">
      <canvas id="scribble-canvas"></canvas>
      <div id="scribble-overlay" class="canvas-overlay">
        <h2 id="scribble-overlay-title">Waiting to start…</h2>
        <p id="scribble-overlay-desc">Get ready!</p>
      </div>
    </div>
    <!-- Tools move here, only visible for drawer -->
    <div class="glass tools-panel" id="scribble-tools" style="display:none;">
      <h3>🎨 Tools</h3>
      <div class="color-row">
        <button class="color-btn active" style="background:#000000" data-color="#000000"></button>
        <button class="color-btn" style="background:#ef4444" data-color="#ef4444"></button>
        <button class="color-btn" style="background:#3b82f6" data-color="#3b82f6"></button>
        <button class="color-btn" style="background:#22c55e" data-color="#22c55e"></button>
        <button class="color-btn" style="background:#eab308" data-color="#eab308"></button>
        <button class="color-btn" style="background:#a855f7" data-color="#a855f7"></button>
        <button class="color-btn" style="background:#ffffff; border:1px solid #ddd;" data-color="#ffffff"></button>
      </div>
      <div class="brush-control">
        <label>🖌️ Size: <span id="brush-size-label">5</span></label>
        <input type="range" id="scribble-brush-size" min="2" max="30" value="5">
      </div>
      <button class="btn btn-outline btn-block" id="scribble-clear-btn">Clear Canvas</button>
    </div>
  </div>

  <!-- RIGHT: Chat (guesses) -->
  <div class="right-column glass panel" id="chat-panel">
    <h3>💬 Guesses</h3>
    <div id="scribble-chat-messages"></div>
    <div class="chat-input-row">
      <input type="text" id="scribble-chat-input" placeholder="Type guess…" autocomplete="off">
      <button class="btn btn-emerald btn-sm" id="scribble-chat-send">Send</button>
    </div>
  </div>
</div>
`;

/* ========== CSS ========== */
const style = document.createElement('style');
style.textContent = `
  /* Full‑screen overlay */
  #scribble-screen {
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    background: #1a1a2e;
    color: #fff;
    font-family: 'Segoe UI', system-ui, sans-serif;
    z-index: 9999;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .game-layout {
    width: 100%;
    height: 100%;
    max-width: 1600px;
    margin: 0 auto;
    display: flex;
    gap: 16px;
    padding: 16px;
    box-sizing: border-box;
  }

  /* Columns */
  .left-column,
  .right-column {
    width: 280px;
    flex-shrink: 0;
  }

  .left-column {
    display: flex;
    flex-direction: column;
  }

  .right-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .center-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .glass {
    background: rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
    border-radius: 16px;
    border: 1px solid rgba(255,255,255,0.1);
  }

  .panel {
    padding: 18px;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  h3 {
    margin: 0 0 12px 0;
    font-size: 1.2rem;
    font-weight: 600;
  }

  /* Scores list */
  #scribble-scores {
    list-style: none;
    padding: 0;
    margin: 0;
    overflow-y: auto;
    flex: 1;
  }
  #scribble-scores li {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    font-size: 1rem;
  }

  /* Tools */
  .tools-panel {
    padding: 16px;
    display: none;   /* default hidden, shown by JS */
    flex-shrink: 0;
  }
  .color-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .color-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: 0.15s;
  }
  .color-btn.active {
    border-color: #facc15;
    transform: scale(1.15);
  }
  .brush-control {
    margin-bottom: 16px;
  }
  .brush-control input {
    width: 100%;
  }

  /* Info bar */
  .info-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    font-weight: bold;
    font-size: 1.1rem;
    flex-shrink: 0;
  }
  #scribble-word-display {
    font-size: 1.8rem;
    letter-spacing: 4px;
    flex: 1;
    text-align: center;
  }
  #scribble-timer {
    font-size: 1.6rem;
    color: #34d399;
  }

  /* Canvas */
  .canvas-container {
    flex: 1;
    position: relative;
    background: #fff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    aspect-ratio: 16 / 9;
    max-height: calc(100vh - 200px);
    width: 100%;
  }
  #scribble-canvas {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  .canvas-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10;
    text-align: center;
    padding: 20px;
  }

  /* Chat */
  #scribble-chat-messages {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 12px;
    font-size: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chat-input-row {
    display: flex;
    gap: 8px;
    margin-top: auto;
  }
  #scribble-chat-input {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: none;
    background: rgba(255,255,255,0.15);
    color: white;
    outline: none;
  }
  .btn {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  .btn-emerald { background: #34d399; color: #000; }
  .btn-outline { background: transparent; border: 1px solid rgba(255,255,255,0.3); color: white; }
  .btn-block { width: 100%; }

  .scribble-msg { word-break: break-word; }
  .scribble-msg .name { font-weight: bold; margin-right: 4px; }
  .scribble-msg.correct { color: #34d399; font-weight: bold; }
  .scribble-msg.close { color: #facc15; font-style: italic; }

  /* ========== MOBILE (max-width: 900px) ========== */
  @media (max-width: 900px) {
    #scribble-screen {
      overflow-y: auto;               /* allow scroll on mobile */
      display: block;
    }
    .game-layout {
      flex-direction: column;
      height: auto;
      padding: 10px;
      gap: 12px;
    }
    .left-column, .right-column {
      width: 100%;
      flex-shrink: 0;
    }
    .left-column {
      order: 3;   /* scores last */
    }
    .center-column {
      order: 1;   /* canvas first */
    }
    .right-column {
      order: 2;   /* guesses second */
      max-height: 300px;   /* limit chat height */
    }
    .canvas-container {
      aspect-ratio: 4/3;
      max-height: 55vh;
      flex: none;
      height: auto;
    }
    .info-bar {
      font-size: 1rem;
    }
    #scribble-word-display {
      font-size: 1.3rem;
      letter-spacing: 2px;
    }
    #scribble-timer {
      font-size: 1.2rem;
    }
    /* Tools will appear below canvas if visible */
    .tools-panel {
      margin-top: 12px;
    }
    .right-column .panel {
      height: auto;
    }
  }

  /* Large desktop */
  @media (min-width: 1400px) {
    .left-column, .right-column {
      width: 320px;
    }
    .info-bar {
      font-size: 1.2rem;
    }
    #scribble-word-display {
      font-size: 2.2rem;
    }
    #scribble-timer {
      font-size: 2rem;
    }
    .scribble-msg {
      font-size: 1rem;
    }
  }
`;
document.head.appendChild(style);

/* ========== DOM REFS (unchanged) ========== */
const canvas = document.getElementById('scribble-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('scribble-overlay');
const overlayTitle = document.getElementById('scribble-overlay-title');
const overlayDesc = document.getElementById('scribble-overlay-desc');
const wordDisplay = document.getElementById('scribble-word-display');
const timerDisplay = document.getElementById('scribble-timer');
const roundInfo = document.getElementById('scribble-round-info');
const scoresList = document.getElementById('scribble-scores');
const chatMessages = document.getElementById('scribble-chat-messages');
const chatInput = document.getElementById('scribble-chat-input');
const chatSend = document.getElementById('scribble-chat-send');
const toolsPanel = document.getElementById('scribble-tools');
const clearBtn = document.getElementById('scribble-clear-btn');
const brushSizeInput = document.getElementById('scribble-brush-size');
const brushSizeLabel = document.getElementById('brush-size-label');

let isDrawing = false;
let currentDrawerId = null;
let drawColor = '#000000';
let drawSize = 5;
let lastX = 0, lastY = 0;

/* ========== CANVAS (fixed resolution, no clear) ========== */
function initCanvasSize() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  if (canvas.width === 0 || canvas.height === 0) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
}
initCanvasSize();
setTimeout(initCanvasSize, 200);

/* ========== TOOLS ========== */
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawColor = btn.dataset.color;
  });
});

brushSizeInput.addEventListener('input', (e) => {
  drawSize = parseInt(e.target.value);
  brushSizeLabel.textContent = drawSize;
});

clearBtn.addEventListener('click', () => {
  if (currentDrawerId !== state.playerId) return;
  socket.emit('clear_canvas', { roomCode: state.roomCode });
  clearCanvasLocal();
});

function clearCanvasLocal() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ========== DRAWING ========== */
function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  let clientX = e.clientX, clientY = e.clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function startDrawing(e) {
  if (currentDrawerId !== state.playerId) return;
  isDrawing = true;
  const pos = getCanvasCoords(e);
  lastX = pos.x; lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || currentDrawerId !== state.playerId) return;
  e.preventDefault();
  const pos = getCanvasCoords(e);
  const stroke = {
    x0: lastX / canvas.width,
    y0: lastY / canvas.height,
    x1: pos.x / canvas.width,
    y1: pos.y / canvas.height,
    color: drawColor,
    size: drawSize
  };
  drawStrokeLocal(stroke);
  socket.emit('draw_stroke', { roomCode: state.roomCode, stroke });
  lastX = pos.x; lastY = pos.y;
}

function stopDrawing() { isDrawing = false; }

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDrawing(e); }, {passive: false});
canvas.addEventListener('touchmove', (e) => { draw(e); }, {passive: false});
canvas.addEventListener('touchend', stopDrawing);

function drawStrokeLocal(stroke) {
  ctx.beginPath();
  ctx.moveTo(stroke.x0 * canvas.width, stroke.y0 * canvas.height);
  ctx.lineTo(stroke.x1 * canvas.width, stroke.y1 * canvas.height);
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.closePath();
}

/* ========== CHAT ========== */
function sendGuess() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (currentDrawerId === state.playerId) {
    addChatMessage('System', 'You cannot guess while drawing!', 'close');
    chatInput.value = '';
    return;
  }
  socket.emit('submit_guess', { roomCode: state.roomCode, guess: text });
  chatInput.value = '';
}

chatSend.addEventListener('click', sendGuess);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendGuess(); });

function addChatMessage(name, msg, type = '') {
  const div = document.createElement('div');
  div.className = `scribble-msg ${type}`;
  div.innerHTML = `<span class="name">${name}:</span> <span>${msg}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateScores(scores) {
  scoresList.innerHTML = '';
  scores.sort((a, b) => b.score - a.score).forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${s.name} ${s.id === currentDrawerId ? '✏️' : ''}</span> <span>${s.score}</span>`;
    scoresList.appendChild(li);
  });
}

/* ========== SOCKET EVENTS ========== */
socket.on('scribble_turn_start', (data) => {
  initCanvasSize();
  clearCanvasLocal();
  currentDrawerId = data.drawerId;
  roundInfo.textContent = `Round ${data.round}/${data.maxRounds}`;
  timerDisplay.textContent = data.timeLimit;
  updateScores(data.scores);
  overlay.style.display = 'none';
  chatInput.disabled = (currentDrawerId === state.playerId);
  if (currentDrawerId === state.playerId) {
    toolsPanel.style.display = 'block';
    wordDisplay.textContent = 'WAITING FOR WORD…';
  } else {
    toolsPanel.style.display = 'none';
    wordDisplay.textContent = Array(data.wordLength).fill('_').join(' ');
  }
  addChatMessage('System', `${data.drawerName} is drawing!`, 'close');
});

socket.on('scribble_your_turn', (data) => {
  wordDisplay.textContent = `Draw: ${data.word}`;
});

socket.on('scribble_timer_sync', (data) => {
  timerDisplay.textContent = data.timeLeft;
  timerDisplay.style.color = data.timeLeft <= 10 ? '#ef4444' : '#34d399';
});

socket.on('scribble_turn_over', (data) => {
  overlay.style.display = 'flex';
  overlayTitle.textContent = data.allGuessed ? 'Everyone guessed it!' : "Time's up!";
  overlayDesc.innerHTML = `The word was: <span style="color:#facc15; font-size:1.8rem;">${data.word}</span>`;
  updateScores(data.scores);
});

socket.on('scribble_draw_stroke', (data) => drawStrokeLocal(data.stroke));
socket.on('scribble_clear_canvas', () => clearCanvasLocal());

socket.on('scribble_chat_message', (data) => {
  addChatMessage(data.playerName, data.message);
});

socket.on('scribble_close_guess', (data) => {
  addChatMessage('System', `'${data.guess}' is very close!`, 'close');
});

socket.on('scribble_correct_guess', (data) => {
  addChatMessage(data.playerName, 'guessed the word!', 'correct');
  if (data.playerId === state.playerId) chatInput.disabled = true;
});

socket.on('game_over', (data) => {
  if (window.app.showResults) window.app.showResults(data.rankings);
});
