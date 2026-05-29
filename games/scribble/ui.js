const socket = window.app.socket;
const state = window.app.state;

const screen = document.getElementById('scribble-screen');

screen.innerHTML = `
<div class="game-layout" id="scribble-layout" style="display: flex; gap: 20px; padding: 20px; min-height: 100vh; max-width: 1600px; margin: 0 auto; align-items: flex-start;">   
<!-- Left Column: Scores & Tools -->
    <div style="flex: 1; display: flex; flex-direction: column; gap: 20px; min-width: 200px; max-width: 250px;">
      <div class="glass" style="padding: 15px; border-radius: 12px;">
        <h3>Scores</h3>
        <ul id="scribble-scores" style="list-style: none; padding: 0; margin-top: 10px;"></ul>
      </div>
      
      <div class="glass" id="scribble-tools" style="padding: 15px; border-radius: 12px; display: none;">
        <h3>Tools</h3>
        <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
          <button class="color-btn" style="background: white;" data-color="#ffffff"></button>
          <button class="color-btn" style="background: #ef4444;" data-color="#ef4444"></button>
          <button class="color-btn" style="background: #3b82f6;" data-color="#3b82f6"></button>
          <button class="color-btn" style="background: #22c55e;" data-color="#22c55e"></button>
          <button class="color-btn" style="background: #eab308;" data-color="#eab308"></button>
          <button class="color-btn" style="background: #a855f7;" data-color="#a855f7"></button>
          <button class="color-btn" style="background: #000000; border: 1px solid #333;" data-color="#000000"></button>
        </div>
        <div style="margin-top: 15px;">
          <label>Brush Size: <span id="brush-size-label">5</span></label>
          <input type="range" id="scribble-brush-size" min="2" max="30" value="5" style="width: 100%;">
        </div>
        <button class="btn btn-outline btn-block" id="scribble-clear-btn" style="margin-top: 15px;">Clear Canvas</button>
      </div>
    </div>

    <!-- Center Column: Canvas -->
<div class="scribble-center" style="flex: 4; display: flex; flex-direction: column; gap: 10px; min-width: 0;">
<div class="glass" style="display: flex; justify-content: space-between; padding: 15px; border-radius: 12px; align-items: center;">
        <div id="scribble-round-info" style="font-weight: bold;">Round 1/3</div>
        <div id="scribble-word-display" style="font-size: 1.5rem; letter-spacing: 3px; font-weight: bold; text-align: center; flex: 1;">WAITING...</div>
        <div id="scribble-timer" style="font-size: 1.5rem; font-weight: bold; color: var(--emerald);">60</div>
      </div>
      
<div class="glass scribble-canvas-wrap" style="position: relative; overflow: hidden; background: white; border-radius: 12px; cursor: url('data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'><circle cx=\'12\' cy=\'12\' r=\'10\' fill=\'none\' stroke=\'black\' stroke-width=\'2\'/><circle cx=\'12\' cy=\'12\' r=\'1\' fill=\'red\'/></svg>') 12 12, crosshair;">        
<canvas id="scribble-canvas" style="position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none;"></canvas>
<div id="scribble-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.8); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10;">
          <h2 id="scribble-overlay-title" style="margin-bottom: 10px;">Waiting to start...</h2>
          <p id="scribble-overlay-desc"></p>
        </div>
      </div>
    </div>

    <!-- Right Column: Chat -->
    <div class="glass" style="flex: 1; display: flex; flex-direction: column; min-width: 250px; max-width: 350px; border-radius: 12px;">
      <div style="padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <h3>Guesses</h3>
      </div>
      <div id="scribble-chat-messages" style="flex: 1; padding: 15px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;"></div>
      <div style="padding: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div class="input-row wrap-mobile">
          <input type="text" id="scribble-chat-input" placeholder="Type guess here..." autocomplete="off">
          <button class="btn btn-emerald btn-sm btn-no-shrink" id="scribble-chat-send">Send</button>
        </div>
      </div>
    </div>
  </div>

<style>
  .scribble-canvas-wrap {
    width: 100%;
    aspect-ratio: 16 / 9;
    min-height: 260px;
    max-height: 75vh;
    flex-shrink: 0;
  }

  #scribble-canvas {
    display: block;
    touch-action: none;
  }

  .color-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .color-btn:hover {
    transform: scale(1.1);
  }

  .color-btn.active {
    border-color: var(--emerald);
    transform: scale(1.1);
  }

  .scribble-msg {
    font-size: 0.9rem;
    word-break: break-word;
  }

  .scribble-msg .name {
    font-weight: bold;
    margin-right: 5px;
  }

  .scribble-msg.correct {
    color: var(--emerald);
    font-weight: bold;
  }

  .scribble-msg.close {
    color: var(--gold);
    font-style: italic;
  }

  @media (max-width: 900px) {
    .game-layout {
      flex-direction: column !important;
      padding: 10px !important;
      gap: 12px !important;
    }

    .game-layout > div {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
    }

    #scribble-chat-messages {
      max-height: 180px;
    }

    #scribble-word-display {
      font-size: 1rem !important;
      letter-spacing: 1px !important;
    }

    #scribble-timer {
      font-size: 1.1rem !important;
    }
  }
</style>
`;

// DOM Refs
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
let lastX = 0;
let lastY = 0;

// Resize canvas properly
function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  // Need to redraw strokes if we resize, but skipping for simplicity
}
window.addEventListener('resize', resizeCanvas);
// Call once shortly after mount to ensure layout is done
setTimeout(resizeCanvas, 100);

// Set up tools
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawColor = btn.dataset.color;
  });
});
document.querySelector('.color-btn[data-color="#000000"]').classList.add('active');

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

// Drawing Logic
function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  let clientX = e.clientX;
  let clientY = e.clientY;
  
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
  const pos = getMousePos(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  if (!isDrawing || currentDrawerId !== state.playerId) return;
  e.preventDefault(); // Prevent scrolling on touch
  
  const pos = getMousePos(e);
  
  // Normalize coordinates (0 to 1) for broadcasting
  const stroke = {
    x0: lastX / canvas.width,
    y0: lastY / canvas.height,
    x1: pos.x / canvas.width,
    y1: pos.y / canvas.height,
    color: drawColor,
    size: drawSize
  };
  
  drawStrokeLocal(stroke);
  socket.emit('draw_stroke', { roomCode: state.roomCode, stroke: stroke });
  
  lastX = pos.x;
  lastY = pos.y;
}

function stopDrawing() {
  isDrawing = false;
}

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

canvas.addEventListener('touchstart', startDrawing, {passive: false});
canvas.addEventListener('touchmove', draw, {passive: false});
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

// Chat Logic
function sendGuess() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (currentDrawerId === state.playerId) {
    addChatMessage("System", "You cannot guess while drawing!", "close");
    chatInput.value = '';
    return;
  }
  
  socket.emit('submit_guess', { roomCode: state.roomCode, guess: text });
  chatInput.value = '';
}

chatSend.addEventListener('click', sendGuess);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendGuess();
});

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
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.padding = '5px 0';
    li.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
    li.innerHTML = `<span>${s.name} ${s.id === currentDrawerId ? '✏️' : ''}</span> <span>${s.score}</span>`;
    scoresList.appendChild(li);
  });
}

// Socket Events
socket.on('scribble_turn_start', (data) => {
  resizeCanvas();
  clearCanvasLocal();
  currentDrawerId = data.drawerId;
  roundInfo.textContent = `Round ${data.round}/${data.maxRounds}`;
  timerDisplay.textContent = data.timeLimit;
  updateScores(data.scores);
  
  overlay.style.display = 'none';
  chatInput.disabled = (currentDrawerId === state.playerId);
  
  if (currentDrawerId === state.playerId) {
    toolsPanel.style.display = 'block';
    wordDisplay.textContent = "WAITING FOR WORD...";
  } else {
    toolsPanel.style.display = 'none';
    wordDisplay.textContent = Array(data.wordLength).fill('_').join(' ');
  }
  
  addChatMessage("System", `${data.drawerName} is drawing!`, "close");
});

socket.on('scribble_your_turn', (data) => {
  wordDisplay.textContent = `Draw: ${data.word}`;
});

socket.on('scribble_timer_sync', (data) => {
  timerDisplay.textContent = data.timeLeft;
  if (data.timeLeft <= 10) {
    timerDisplay.style.color = 'var(--crimson)';
  } else {
    timerDisplay.style.color = 'var(--emerald)';
  }
});

socket.on('scribble_turn_over', (data) => {
  overlay.style.display = 'flex';
  
  if (data.allGuessed) {
    overlayTitle.textContent = "Everyone guessed it!";
  } else {
    overlayTitle.textContent = "Time's up!";
  }
  
  overlayDesc.innerHTML = `The word was: <span style="color: var(--gold); font-weight: bold; font-size: 1.5rem;">${data.word}</span>`;
  updateScores(data.scores);
});

socket.on('scribble_draw_stroke', (data) => {
  drawStrokeLocal(data.stroke);
});

socket.on('scribble_clear_canvas', () => {
  clearCanvasLocal();
});

socket.on('scribble_chat_message', (data) => {
  addChatMessage(data.playerName, data.message);
});

socket.on('scribble_close_guess', (data) => {
  addChatMessage("System", `'${data.guess}' is very close!`, "close");
});

socket.on('scribble_correct_guess', (data) => {
  addChatMessage(data.playerName, "guessed the word!", "correct");
  
  if (data.playerId === state.playerId) {
    chatInput.disabled = true; // Disable input after correct guess
  }
});

// Since the server emits game_over with rankings, we just reuse the existing Results screen.
