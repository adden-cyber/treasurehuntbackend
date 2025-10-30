let selectedDifficulty = "normal"; // Default difficulty
const DIFFICULTY_CREDIT_COST = { easy: 100, normal: 150, hard: 250 };
let userCredits = null;
let startRequestInFlight = false;

const MANATEE_DEBRIS_PARTS = [
  { sx: 60,  sy: 60,  sw: 36, sh: 36 },
  { sx: 160, sy: 60,  sw: 36, sh: 36 },
  { sx: 260, sy: 60,  sw: 36, sh: 36 },
  { sx: 90,  sy: 150, sw: 36, sh: 36 },
  { sx: 180, sy: 160, sw: 36, sh: 36 },
  { sx: 270, sy: 150, sw: 36, sh: 36 },
  { sx: 70,  sy: 240, sw: 36, sh: 36 },
  { sx: 170, sy: 250, sw: 36, sh: 36 },
  { sx: 270, sy: 240, sw: 36, sh: 36 }
];

let GAME_CONFIG = {};

/* Helper: update credits UI and local state */
// --- Credits helpers and Start-button UI helpers (paste this BEFORE setCredits) ---
let creditsCountdownInterval = null;

// Compute next midnight in GMT+8 expressed as a UTC Date
function getNextGmt8MidnightUtc() {
  const now = new Date();
  const offsetMs = 8 * 3600 * 1000; // +8 hours in milliseconds
  const nowGmt8 = new Date(now.getTime() + offsetMs);
  const y = nowGmt8.getUTCFullYear();
  const m = nowGmt8.getUTCMonth();
  const d = nowGmt8.getUTCDate();
  const nextMidnightGmt8UtcMs = Date.UTC(y, m, d + 1, 0, 0, 0) - offsetMs;
  return new Date(nextMidnightGmt8UtcMs);
}

function formatTimeRemainingTo(nextUtcDate) {
  const now = new Date();
  let diffMs = nextUtcDate.getTime() - now.getTime();
  if (diffMs <= 0) return "00:00:00";
  const totalSeconds = Math.floor(diffMs / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s} (GMT+8)`;
}

// Update Start button disabled state and (optionally) its label.
// If you call updateStartButtonUI() before startButton exists, it will try the cached var when available.
function updateStartButtonUI(customLabel) {
  const sb = startButton || document.getElementById('start-button');
  if (!sb) return;
  const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 10;
  sb.disabled = !userToken || (typeof userCredits === 'number' ? (userCredits < cost) : false);
  if (typeof customLabel === 'string') {
    sb.textContent = customLabel;
  } else {
    sb.textContent = 'Start Game';
  }
}

// show initial difficulty cost for the active difficulty
(function initDifficultyCostDisplay(){
  const costDisplay = document.getElementById('difficulty-cost-display');
  const activeBtn = document.querySelector('#difficulty-selector .difficulty-btn.active') ||
                    document.querySelector('#difficulty-selector .difficulty-btn');
  const val = activeBtn ? activeBtn.getAttribute('data-value') : selectedDifficulty;
  if (costDisplay) {
    costDisplay.textContent = `Cost to start (${val.charAt(0).toUpperCase()+val.slice(1)}): ${DIFFICULTY_CREDIT_COST[val] || 0} credits`;
    costDisplay.style.display = '';
  }
})();

// Call this to restore Start button to idle state (used after game end)
function ensureStartButtonIdle() {
  updateStartButtonUI('Start');
}
// --- end helpers ---
function setCredits(value) {
  const n = (value === undefined || value === null) ? NaN : Number(value);
  const ok = !Number.isNaN(n);
  userCredits = ok ? n : null;
  const el = document.getElementById('credits-value');
  if (el) el.textContent = ok ? String(n) : '--';

  // Update Start button disabled state (but don't change label here)
  const sb = startButton || document.getElementById('start-button');
  if (sb) {
    const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 10;
    sb.disabled = !userToken || (ok ? n < cost : false);
  }

  // Credits message element (inserted into HTML; see index.html snippet below)
  const msgEl = document.getElementById('credits-msg');

  // Clear any existing interval if credits are > 0
  if (creditsCountdownInterval) {
    clearInterval(creditsCountdownInterval);
    creditsCountdownInterval = null;
  }

  if (ok && n <= 0) {
    // Show used-up message and start countdown to next GMT+8 midnight
    if (msgEl) {
      const nextUtc = getNextGmt8MidnightUtc();
      // initial set
      msgEl.textContent = `All points have been used up, come back by tomorrow! (${formatTimeRemainingTo(nextUtc)})`;
      msgEl.style.color = '#b00';
      // update every second
      creditsCountdownInterval = setInterval(() => {
        const remainingText = formatTimeRemainingTo(nextUtc);
        msgEl.textContent = `All points have been used up, come back by tomorrow! (${remainingText})`;
      }, 1000);
    }
  } else {
    if (msgEl) {
      msgEl.textContent = '';
    }
  }
}

const ASSETS = {
  images: {
    mermaid: null,
    manatee: null,
    seaweed: null,
    bubble: null,
    coral: null,
    mine: null,
    treasures: {
      small: null,
      medium: null,
      large: null,
      fake: null
    },
    manateeVariants: []
  },
  sounds: {
    collect: () => {},
    trap: () => {},
    complete: () => {},
    explosion: () => {}
  }
};

const imageManifest = [
  { key: 'mermaid', path: 'images/mermaid.png', assign: img => ASSETS.images.mermaid = img },
  { key: 'wall', path: 'images/wall.png', assign: img => ASSETS.images.wall = img },
  { key: 'manatee', path: 'images/manatee.png', assign: img => { ASSETS.images.manatee = img; ASSETS.images.manateeVariants[0] = img; } },
  { key: 'seaweed', path: 'images/seaweed.png', assign: img => ASSETS.images.seaweed = img },
  { key: 'bubble', path: 'images/bubble.png', assign: img => ASSETS.images.bubble = img },
  { key: 'coral', path: 'images/coral.png', assign: img => ASSETS.images.coral = img },
  { key: 'shell', path: 'images/shell.png', assign: img => ASSETS.images.shell = img },
  { key: 'mine', path: 'images/mine.png', assign: img => ASSETS.images.mine = img },
  { key: 'small', path: 'images/treasure_small.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.small = img; } },
  { key: 'medium', path: 'images/treasure_medium.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.medium = img; } },
  { key: 'large', path: 'images/treasure_large.png', assign: img => { img.width=60; img.height=60; img.value=10; ASSETS.images.treasures.large = img; } },
  { key: 'fake', path: 'images/treasure_fake.png', assign: img => { img.width=60; img.height=60; img.penalty=5; ASSETS.images.treasures.fake = img; } }
];

/* 1) Prefer same-origin by default; only use override if explicitly provided */
const BACKEND_URL = "http://192.168.0.105:3001/api";

/* 2) Small helper: fetch with timeout (prevents hanging on mobile) */
async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Add this helper (place right after fetchWithTimeout or before wireFeedbackUI)
async function sendFeedbackToServer(payload) {
  const url = `${BACKEND_URL}/feedback`;
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }, 7000);
    return res;
  } catch (err) {
    console.warn('[feedback] sendFeedbackToServer failed', err);
    throw err;
  }
}

/* 3) Provide a safe default config if backend is unreachable */
function buildOpenPattern(rows = 14, cols = 28) {
  const pattern = Array.from({ length: rows }, () => '0'.repeat(cols));
  // Place a start 'X' roughly near top-left and one mermaid 'M' somewhere
  const rX = Math.max(1, Math.floor(rows * 0.2));
  const cX = Math.max(1, Math.floor(cols * 0.2));
  const rM = Math.min(rows - 2, Math.floor(rows * 0.7));
  const cM = Math.min(cols - 2, Math.floor(cols * 0.7));
  const pX = pattern[rX].split(''); pX[cX] = 'X'; pattern[rX] = pX.join('');
  const pM = pattern[rM].split(''); pM[cM] = 'M'; pattern[rM] = pM.join('');
  return pattern;
}

const DEFAULT_GAME_CONFIG = {
  mazePattern: buildOpenPattern(14, 28),
  totalTreasures: 16,
  totalSeaweeds: 50,
  totalBubbles: 6,
  totalMines: 6,
  totalFakeChests: 4,
  gameTimeSeconds: 90,
};

function applyConfigToGlobals(cfg) {
  customPattern = cfg.mazePattern;
  TOTAL_TREASURES = cfg.totalTreasures;
  SEAWEED_COUNT = cfg.totalSeaweeds;
  BUBBLE_COUNT = cfg.totalBubbles;
  NUM_MINES = cfg.totalMines;
  GAME_TIME_SECONDS = cfg.gameTimeSeconds;
}

let sessionId = null;
let userToken = localStorage.getItem('token') || null;
let userEmail = localStorage.getItem('email') || null;
let customPattern = [], TOTAL_TREASURES = 0, SEAWEED_COUNT = 0, BUBBLE_COUNT = 0, NUM_MINES = 0, GAME_TIME_SECONDS = 0;
/* 5) Make start logging non-blocking: never block init on network */
// Safe, idempotent logStartGame — will NOT call /start again if sessionId already exists.
function logStartGame() {
  // If session already created by /start flow, do not call /start again.
  if (sessionId) return Promise.resolve();

  try {
    return fetchWithTimeout(`${BACKEND_URL}/start`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${userToken}`,
    "Content-Type": "application/json",
    "X-Dry-Run": "1"
  },
  body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail })
}, 5000)
      .then(r => {
        if (!r.ok) return Promise.reject(new Error(`start ${r.status}`));
        return r.json();
      })
      .then(data => {
        // Only set sessionId if server returned it
        if (data && data.sessionId) sessionId = data.sessionId;
      })
      .catch(err => {
        console.warn('[game] logStartGame failed (non-blocking):', err);
      });
  } catch (e) {
    console.warn('[game] logStartGame threw (non-blocking):', e);
    return Promise.resolve();
  }
}

function logChest(chest) {
  fetch(`${BACKEND_URL}/chest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, x: chest.x, y: chest.y, value: chest.value, type: chest.type })
  });
}

function logBubble(bubble) {
  fetch(`${BACKEND_URL}/bubble`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, x: bubble.x, y: bubble.y, value: bubble.value })
  });
}

function logMineDeath() {
  fetch(`${BACKEND_URL}/mineDeath`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId })
  });
}

function logEndGame(endedEarly = false) {
  fetch(`${BACKEND_URL}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      endedEarly,
      score: score, // your game's score variable
      seaweedsCollected: collectibleSeaweeds.filter(s => s.collected).length // or your own logic
    })
  });
}

function getGameReport() {
  return fetch(`${BACKEND_URL}/report`).then(res => res.json());
}

// DOM references
let startScreen, gameScreen, completionPopup, quitResultPopup;
let startButton, completionPlayAgainButton, completionReturnToStartButton;
let quitPlayAgainButton, quitReturnToStartButton;
let endGameButton;
let scoreValue, treasuresCollected, totalTreasures, finalScore, quitFinalScore, quitTreasuresCollected;
let timerValue, timeRemaining;
let completionTitle, completionMessage, quitTitle, quitMessage;
let canvas, ctx;
let confettiCameraX = 0, confettiCameraY = 0, confettiViewportWidth = 0, confettiViewportHeight = 0;
let celebrationTimer = 0;
let celebrationActive = false
function stopAnimationLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
let isGameOver = false;
let rafId = null;

// Map and viewport constants
let GAME_WIDTH = 4800, GAME_HEIGHT = 3600;
const MANATEE_SPEED = 5;
const CHEST_SIZE = 60;
const AMBIENT_BUBBLE_COUNT = 120;
const AMBIENT_SEAWEED_COUNT = 700;
const AMBIENT_CORAL_COUNT = 80;
const WALL_THICKNESS = 34;
const PRE_GAME_TIMER = 3;
let manateeJumping = false;
let manateeJumpFrame = 0;
let manateeJumpCount = 0;
const MANATEE_JUMPS_TOTAL = 3; // Set how many jumps you want
const MANATEE_JUMP_DURATION = 40; // frames (about 0.66s at 60fps)
const MANATEE_JUMP_HEIGHT = 110;  // pixels
let fakeTreasureSlowTimer = 0; // in frames (60fps)
// Mermaid constants and state
const MERMAID_SPEED = MANATEE_SPEED;
const MERMAID_SIZE = 70;
const MERMAID_COLOR = "#db71bc";
const MERMAID_EXCLAMATION_TIME = 60; // 1s at 60fps
const MERMAID_CHASE_TIME = 480; // 8s at 60fps

// Screenshake effect variables
let screenshakeTimer = 0;
let screenshakeMagnitude = 0;
let screenshakeX = 0;
let screenshakeY = 0;



// Helper: get a random open cell from the map
// Helper: get a random open cell from the map
function getRandomOpenPosition() {
  const openCells = getValidTreasurePositions(walls);
  return openCells[Math.floor(Math.random() * openCells.length)];
}

let mermaidStuckCounter = 0;

function updateMermaids() {
  for (const mermaid of mermaids) {
    if (explosionActive) continue;
    let moved = false;
    if (mermaid.state === "roaming") {
      let dx = mermaid.roamTarget.x - mermaid.x;
      let dy = mermaid.roamTarget.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = 2.3;
      if (dist < 40) {
        mermaid.roamTarget = getRandomOpenPosition();
      } else {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
            moved = true;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
            moved = true;
          }
        }
      }
      if (!moved) {
        mermaid.stuckCounter++;
        if (mermaid.stuckCounter > 20) {
          mermaid.roamTarget = getRandomOpenPosition();
          mermaid.stuckCounter = 0;
        }
      } else {
        mermaid.stuckCounter = 0;
      }
      if (isColliding(mermaid, manatee)) {
        mermaid.state = "exclamation";
        mermaid.stateTimer = MERMAID_EXCLAMATION_TIME;
        mermaid.lastChaseTarget = { x: mermaid.x, y: mermaid.y };
      }
    } else if (mermaid.state === "exclamation") {
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "chase";
        mermaid.stateTimer = MERMAID_CHASE_TIME;
      }
    } else if (mermaid.state === "chase") {
      let dx = manatee.x - mermaid.x;
      let dy = manatee.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = MERMAID_SPEED;
      if (dist > 0.1) {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
          }
        }
      }
      if (isColliding(mermaid, manatee)) {
        startExplosion(); // Mermaid triggers explosion/game over
      }
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "exhausted";
        mermaid.stateTimer = 240;
        mermaid.roamTarget = getRandomOpenPosition();
      }
    } else if (mermaid.state === "exhausted") {
      let dx = mermaid.roamTarget.x - mermaid.x;
      let dy = mermaid.roamTarget.y - mermaid.y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      let step = 1.2;
      if (dist > step) {
        if (Math.abs(dx) > 1) {
          let tryX = mermaid.x + step * dx/dist;
          let tryRectX = { ...mermaid, x: tryX };
          if (!walls.some(wall => isColliding(tryRectX, wall))) {
            mermaid.x = tryX;
          }
        }
        if (Math.abs(dy) > 1) {
          let tryY = mermaid.y + step * dy/dist;
          let tryRectY = { ...mermaid, y: tryY };
          if (!walls.some(wall => isColliding(tryRectY, wall))) {
            mermaid.y = tryY;
          }
        }
      }
      mermaid.stateTimer--;
      if (mermaid.stateTimer <= 0) {
        mermaid.state = "roaming";
        mermaid.roamTarget = getRandomOpenPosition();
      }
    }
    mermaid.x = Math.max(0, Math.min(GAME_WIDTH-mermaid.width, mermaid.x));
    mermaid.y = Math.max(0, Math.min(GAME_HEIGHT-mermaid.height, mermaid.y));
  }
}


// State
let gameActive = false, score = 0, collectedTreasures = 0, gameTimer = GAME_TIME_SECONDS, gameStartTime = 0;
let treasures = [], walls = [], bubbles = [], seaweeds = [], corals = [];
let mines = [];
let explosionActive = false;
let debrisPieces = [];
let explosionTimer = 0;
let preGameCountdown = PRE_GAME_TIMER;
let preGameState = "count";
let timeInterval = null;
let preGameInterval = null;
let activeSeaweedBoost = false;
let seaweedBoostTimer = 0;
const SEAWEED_BOOST_AMOUNT = 1.5; // 50% increase
const SEAWEED_BOOST_DURATION = 8 * 60; // 8 seconds at 60fps
const keysPressed = {};
let mermaids = []; // Array of all mermaids
let collectibleSeaweeds = [];
let floatingRewards = []; // Each item: {x, y, value, alpha, vy}
let collectibleBubbles = []; // Each: {x, y, width, height, value, collected}
let confettiActive = false;
let confettiParticles = [];

function generateCollectibleSeaweeds() {
  let positions = getValidTreasurePositions(walls);
  let used = new Set();
  let arr = [];
  let count = Math.min(SEAWEED_COUNT, positions.length);
  while (arr.length < count) {
    let idx = Math.floor(Math.random() * positions.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const pos = positions[idx];
    let overlap = treasures.some(t => Math.abs(t.x - pos.x) < 60 && Math.abs(t.y - pos.y) < 60);
    if (overlap) continue;
    arr.push({
      x: pos.x,
      y: pos.y,
      width: 60,
      height: 120,
      collected: false,
      boost: true
    });
  }
  return arr;
}

function generateCollectibleBubbles() {
  let positions = getValidTreasurePositions(walls);
  let arr = [];
  let used = new Set();
  let count = Math.min(BUBBLE_COUNT, positions.length); // 5 bubbles per game, adjust as you like
  const values = [5, 10, 15];

  // Prevent placement on top of any chest (real or fake)
  while (arr.length < count) {
    let idx = Math.floor(Math.random() * positions.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const pos = positions[idx];

    // Check overlap with all treasures (real and fake)
    let overlapsAnyChest = treasures.some(t =>
      Math.abs(t.x - pos.x) < CHEST_SIZE && Math.abs(t.y - pos.y) < CHEST_SIZE
    );
     let overlapsSeaweed = collectibleSeaweeds && collectibleSeaweeds.some(s =>
      Math.abs(s.x - pos.x) < 60 && Math.abs(s.y - pos.y) < 60
    );

    if (overlapsAnyChest || overlapsSeaweed) continue;

    arr.push({
      x: pos.x,
      y: pos.y,
      width: 52, // bubble size
      height: 52,
      value: values[Math.floor(Math.random() * values.length)],
      collected: false,
    });
  }
  return arr;
}

let cameraX = 0, cameraY = 0;

const manatee = { x: CHEST_SIZE, y: CHEST_SIZE, width: 80, height: 60, speedX: 0, speedY: 0, moving: false, direction: 1 };
let manateeLastX = CHEST_SIZE, manateeLastY = CHEST_SIZE;

let playAgainAfterDeath = false;

// MOBILE/JOYSTICK SUPPORT
let isMobile = false;
let joystickActive = false, joystickX = 0, joystickY = 0;

// Fullscreen sizing: always use window.innerWidth/innerHeight for the canvas
let VIEWPORT_WIDTH = window.innerWidth;
let VIEWPORT_HEIGHT = window.innerHeight;

/* Update your updateViewportSize() to avoid 100vh issues on mobile */
function updateViewportSize() {
  // CSS-visible viewport in CSS pixels (matches window)
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;

  // World/backing size — make the world wider on mobile (zoom-out)
  if (isMobile) {
    VIEWPORT_WIDTH = Math.min(cssWidth * 2.5, GAME_WIDTH);
    VIEWPORT_HEIGHT = Math.min(cssHeight * 2.5, GAME_HEIGHT);
  } else {
    VIEWPORT_WIDTH = cssWidth;
    VIEWPORT_HEIGHT = cssHeight;
  }

  if (!canvas) return;

  // Device pixel ratio for crisp rendering on high-DPI displays
  const dpr = window.devicePixelRatio || 1;

  // Backing store should be world pixels scaled by DPR
  canvas.width = Math.round(VIEWPORT_WIDTH * dpr);
  canvas.height = Math.round(VIEWPORT_HEIGHT * dpr);

  // Ensure the visible size of the canvas matches the CSS viewport
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.style.background = "#234";
  canvas.style.setProperty("z-index", "0", "important");

  // Reset the 2D context transform so 1 canvas unit = 1 CSS pixel (scaled by DPR)
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function isColliding(rect1, rect2) {
  return (
    rect1.x < rect2.x + rect2.width &&
    rect1.x + rect1.width > rect2.x &&
    rect1.y < rect2.y + rect2.height &&
    rect1.y + rect1.height > rect2.y
  );
}


// --- Mermaid Drawing ---
function drawMermaids() {
  for (const mermaid of mermaids) {
    const img = ASSETS.images.mermaid;
    if (img && img.complete) {
      ctx.save();
      ctx.drawImage(
        img,
        mermaid.x - cameraX,
        mermaid.y - cameraY,
        mermaid.width,
        mermaid.height
      );
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(
        mermaid.x + mermaid.width/2 - cameraX,
        mermaid.y + mermaid.height/2 - cameraY,
        mermaid.width/2, mermaid.height/2,
        0, 0, Math.PI * 2
      );
      ctx.fillStyle = MERMAID_COLOR;
      ctx.fill();
      ctx.restore();
    }
  }
}



/* Fix drawMinimap(): change const -> let for MM_X/MM_Y to allow reassignment on mobile */
function drawMinimap() {
  const MM_WIDTH = 240;
  const MM_HEIGHT = 180;
  const MM_MARGIN = 20;
  let MM_X = MM_MARGIN;
  let MM_Y = VIEWPORT_HEIGHT - MM_HEIGHT - MM_MARGIN;

  if (isMobile) {
    MM_X = MM_MARGIN; // left edge
    MM_Y = VIEWPORT_HEIGHT / 2 - MM_HEIGHT / 2; // vertical center
  }

  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#222";
  ctx.fillRect(MM_X, MM_Y, MM_WIDTH, MM_HEIGHT);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(MM_X, MM_Y, MM_WIDTH, MM_HEIGHT);

  const scaleX = MM_WIDTH / GAME_WIDTH;
  const scaleY = MM_HEIGHT / GAME_HEIGHT;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#2b3e2f";
  for (const w of walls) {
    ctx.fillRect(
      MM_X + w.x * scaleX,
      MM_Y + w.y * scaleY,
      Math.max(1, w.width * scaleX),
      Math.max(1, w.height * scaleY)
    );
  }
  ctx.restore();

  // Real treasures only
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (const t of treasures) {
    if (!t.collected && t.type !== "fake") {
      ctx.fillStyle = "#ffd700";
      ctx.fillRect(
        MM_X + t.x * scaleX,
        MM_Y + t.y * scaleY,
        Math.max(2, CHEST_SIZE * scaleX),
        Math.max(2, CHEST_SIZE * scaleY)
      );
    }
  }
  ctx.restore();

  // Mines
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (const mine of mines) {
    ctx.fillStyle = "#ff3131";
    ctx.beginPath();
    ctx.arc(
      MM_X + (mine.x + mine.width / 2) * scaleX,
      MM_Y + (mine.y + mine.height / 2) * scaleY,
      Math.max(3, mine.width * scaleX / 2),
      0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();

  // Collectible seaweed
  ctx.save();
  ctx.globalAlpha = 0.9;
  for (const s of collectibleSeaweeds) {
    if (!s.collected) {
      ctx.fillStyle = "#00ff88";
      ctx.fillRect(
        MM_X + s.x * scaleX,
        MM_Y + s.y * scaleY,
        Math.max(3, s.width * scaleX / 3),
        Math.max(6, s.height * scaleY / 8)
      );
    }
  }
  ctx.restore();

  // Camera viewport box
  ctx.strokeStyle = "#76e3ff";
  ctx.lineWidth = 3;
  ctx.strokeRect(
    MM_X + cameraX * scaleX,
    MM_Y + cameraY * scaleY,
    VIEWPORT_WIDTH * scaleX,
    VIEWPORT_HEIGHT * scaleY
  );

  // Player dot
  ctx.beginPath();
  ctx.arc(
    MM_X + (manatee.x + manatee.width / 2) * scaleX,
    MM_Y + (manatee.y + manatee.height / 2) * scaleY,
    8, 0, Math.PI * 2
  );
  ctx.fillStyle = "#ffe5b4";
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function generateMazeWalls() {
  const walls = [];
  const rows = customPattern.length;
  const cols = customPattern[0].length;
  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r][c] === "1") {
        const wall = {
          x: c * cellW,
          y: r * cellH,
          width: cellW,
          height: cellH,
          decorations: []
        };
        // --- Add coral/shell decorations as before ---
        if (Math.random() < 0.35) {
          const shellSize = 32 + Math.random() * 16;
          wall.decorations.push({
            type: "shell",
            x: Math.random() * (cellW - shellSize),
            y: Math.random() * (cellH - shellSize),
            size: shellSize
          });
        }
        if (Math.random() < 0.28) {
          const coralSize = 42 + Math.random() * 32;
          wall.decorations.push({
            type: "coral",
            x: Math.random() * (cellW - coralSize),
            y: Math.random() * (cellH - coralSize),
            size: coralSize
          });
        }
        walls.push(wall);
      }
    }
  }
  return walls;
}

function generateBubbles() {
  const bubbles = [];
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    bubbles.push({
      x: Math.random() * (GAME_WIDTH - 30) + 15,
      y: Math.random() * (GAME_HEIGHT - 200) + 100,
      radius: Math.random() * 12 + 8,
      speed: Math.random() * 0.7 + 0.3
    });
  }
  return bubbles;
}

function generateSeaweeds() {
  const seaweeds = [];
  const count = SEAWEED_COUNT;
  for (let i = 0; i < count; i++) {
    const seaweedWidth = 60 + Math.random() * 70;
    const seaweedHeight = 160 + Math.random() * 140;
    // Place anywhere on the map, not just at the bottom!
    let x = Math.random() * (GAME_WIDTH - seaweedWidth);
    let y = Math.random() * (GAME_HEIGHT - seaweedHeight);
    seaweeds.push({
      x,
      y,
      width: seaweedWidth,
      height: seaweedHeight
    });
  }
  return seaweeds;
}

function generateCorals() {
  const corals = [];
  const count = AMBIENT_CORAL_COUNT;
  for (let i = 0; i < count; i++) {
    const coralWidth = 120 + Math.random() * 180;
    const coralHeight = 100 + Math.random() * 230;
    let x = (i * GAME_WIDTH / count) + Math.random() * 50;
    corals.push({
      x,
      y: GAME_HEIGHT - coralHeight + Math.random() * 30,
      width: coralWidth,
      height: coralHeight
    });
  }
  return corals;
}

// --- Mines Initialization ---
function generateMines() {
  const mines = [];
  let tries = 0;
  let maxTries = 300;
  let placed = 0;
  let validPositions = getValidTreasurePositions(walls);
  const MINE_MARGIN = 16;
  const MIN_MINE_DISTANCE = 220;

  while (placed < NUM_MINES && tries < maxTries) {
    tries++;
    let idx = Math.floor(Math.random() * validPositions.length);
    const pos = validPositions[idx];
    let cellW = GAME_WIDTH / 28;
    let cellH = GAME_HEIGHT / 14;
    let mineW = 80, mineH = 80;
    let maxOffsetX = Math.max(0, cellW - mineW - 2*MINE_MARGIN);
    let maxOffsetY = Math.max(0, cellH - mineH - 2*MINE_MARGIN);
    let x = pos.x + MINE_MARGIN + Math.random() * maxOffsetX;
    let y = pos.y + MINE_MARGIN + Math.random() * maxOffsetY;

    if (x < 200 && y < 200) continue;
    let overlap = mines.some(m => Math.abs(m.x - x) < 100 && Math.abs(m.y - y) < 100);
    if (overlap) continue;

    let tooClose = mines.some(m => {
      let dx = m.x - x;
      let dy = m.y - y;
      let dist = Math.sqrt(dx*dx + dy*dy);
      return dist < MIN_MINE_DISTANCE;
    });
    if (tooClose) continue;

     let row = Math.floor(y / cellH);
    let col = Math.floor(x / cellW);
    let wallNeighbors = 0;
    if (row > 0 && customPattern[row - 1][col] === "1") wallNeighbors++;
    if (row < customPattern.length - 1 && customPattern[row + 1][col] === "1") wallNeighbors++;
    if (col > 0 && customPattern[row][col - 1] === "1") wallNeighbors++;
    if (col < customPattern[0].length - 1 && customPattern[row][col + 1] === "1") wallNeighbors++;
    if (wallNeighbors >= 3) continue;

    let mineRect = { x, y, width: mineW, height: mineH };
    let collidesWithWall = walls.some(w => isColliding(mineRect, w));
    if (collidesWithWall) continue;

    // --- RANDOMLY CHOOSE HORIZONTAL OR VERTICAL ---
    let isHorizontal = Math.random() < 0.5;
    let range = 300 + Math.random() * 400; // example range
    let speed = 3 + Math.random() * 2;
    let direction = Math.random() > 0.5 ? 1 : -1;

    let mineData = {
      x, y, width: mineW, height: mineH,
      speed,
      direction,
      range
    };

    if (isHorizontal) {
  mineData.baseX = x;
  mineData.baseY = undefined;
} else {
  mineData.baseY = y;
  mineData.baseX = undefined;
}

    mines.push(mineData);
    placed++;
  }

  return mines;
}

// --- Mines Movement (call in your game loop) ---
function updateMines() {
  for (let i = mines.length - 1; i >= 0; i--) {
    const mine = mines[i];
    let prevX = mine.x, prevY = mine.y;

    if (typeof mine.baseX === "number") {
      mine.x += mine.speed * mine.direction;
      let mineRect = { x: mine.x, y: mine.y, width: mine.width, height: mine.height };
      if (walls.some(w => isColliding(mineRect, w))) {
        mine.x = prevX;
        mine.direction *= -1;
      }
    } else if (typeof mine.baseY === "number") {
      mine.y += mine.speed * mine.direction;
      let mineRect = { x: mine.x, y: mine.y, width: mine.width, height: mine.height };
      if (walls.some(w => isColliding(mineRect, w))) {
        mine.y = prevY;
        mine.direction *= -1;
      }
    }
    // Clamp the mine's position inside the map
    mine.x = Math.max(0, Math.min(GAME_WIDTH - mine.width, mine.x));
    mine.y = Math.max(0, Math.min(GAME_HEIGHT - mine.height, mine.y));

    if (!explosionActive && isColliding(manatee, mine)) {
      startExplosion(i);
    }
  }
}

function getValidTreasurePositions(walls) {
  const rows = customPattern.length;
  const cols = customPattern[0].length;
  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;
  const validPositions = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r][c] === "0") { // Only open cells
        validPositions.push({
          x: c * cellW + cellW/2 - CHEST_SIZE/2,
          y: r * cellH + cellH/2 - CHEST_SIZE/2
        });
      }
    }
  }
  return validPositions;
}

function startExplosion(mineIndex) {
  if (explosionActive) return;
  explosionActive = true;
  logMineDeath();
  debrisPieces = [];
  explosionTimer = 0;
  if (typeof mineIndex === "number") {
    mines.splice(mineIndex,1);
  }
  screenshakeTimer = 30;   // duration in frames (e.g., 18 = 0.3 sec at 60fps)
  screenshakeMagnitude = 60; // shake intensity in pixels
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * 2) * (i / 9) + Math.random() * 0.3 - 0.15;
    const speed = 6 + Math.random() * 4;
    debrisPieces.push({
      partIdx: i,
      x: manatee.x + manatee.width/2,
      y: manatee.y + manatee.height/2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.12
    });
  }
}

function drawExplosionAndDebris() {
  const manateeImg = ASSETS.images.manatee;
  for (const d of debrisPieces) {
    ctx.save();
    ctx.translate(d.x - cameraX, d.y - cameraY);
    ctx.rotate(d.rot);
    const part = MANATEE_DEBRIS_PARTS[d.partIdx];
    let drewImage = false;
    if (manateeImg) {
      ctx.drawImage(
        manateeImg,
        part.sx, part.sy, part.sw, part.sh,
        -part.sw/2, -part.sh/2, part.sw, part.sh
      );
      drewImage = true;
    }
    if (!drewImage) {
      ctx.fillStyle = "#bbb";
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(part.sw, part.sh)/2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - explosionTimer/60);
  ctx.beginPath();
  ctx.arc(manatee.x + manatee.width/2 - cameraX, manatee.y + manatee.height/2 - cameraY, 120 + explosionTimer*2, 0, Math.PI*2);
  ctx.fillStyle = "rgba(255,200,60,0.3)";
  ctx.fill();
  ctx.restore();
}

function startConfetti() {
  confettiActive = true;
  confettiParticles = [];
  console.log("Confetti started!");
  // Capture the camera and viewport at the instant of winning
  confettiCameraX = cameraX;
  confettiCameraY = cameraY;
  confettiViewportWidth = VIEWPORT_WIDTH;
  confettiViewportHeight = VIEWPORT_HEIGHT;
  for (let side = -1; side <= 1; side += 2) { // -1 for left, 1 for right
      // Spawn confetti across the full top edge
for (let i = 0; i < 80; i++) { // Increase for more particles
  confettiParticles.push({
    x: confettiCameraX + Math.random() * confettiViewportWidth,
    y: confettiCameraY - 20 + Math.random() * 30, // just above the top
    vx: (Math.random() - 0.5) * 3, // small random left/right
    vy: Math.random() * 3 + 2,
    size: Math.random() * 8 + 7,
    color: randomConfettiColor(),
    angle: Math.random() * Math.PI * 2,
    angularSpeed: (Math.random() - 0.5) * 0.2,
    life: Math.random() * 26 + 54
  });
}
    }
  }

function updateConfetti() {
  if (!confettiActive) return;
  for (const c of confettiParticles) {
    c.x += c.vx;
    c.y += c.vy;
    c.vy += 0.12; // gravity
    c.angle += c.angularSpeed;
    c.life--;
  }
  // Use captured confetti camera/viewport!
  confettiParticles = confettiParticles.filter(c =>
    c.life > 0 &&
    c.y < confettiCameraY + confettiViewportHeight + 40 &&
    c.x > confettiCameraX - 40 &&
    c.x < confettiCameraX + confettiViewportWidth + 40
  );
  if (confettiParticles.length === 0) confettiActive = false;
}
 

function drawConfetti() {
    if (!confettiActive) return;
    for (const c of confettiParticles) {
      ctx.save();
      ctx.translate(c.x - confettiCameraX, c.y - confettiCameraY);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, c.life / 30));
      ctx.fillRect(-c.size / 2, -c.size / 6, c.size, c.size / 3);
      ctx.restore();
    }
  }

function randomConfettiColor() {
  const colors = ['#FFD700', '#FF69B4', '#00E6FF', '#44FF44', '#FF6347', '#FFB347', '#00FFEA', '#B366FF'];
  return colors[Math.floor(Math.random() * colors.length)];
}

function showJoystick(show) {
  var joystickContainer = document.getElementById('joystick-container');
  if (joystickContainer) {
    joystickContainer.style.display = show ? 'block' : 'none';
  }
}

// image preloader used by the init code — ensure this exists before DOMContentLoaded
// Robust preloadImages with max-wait fallback and logging
function preloadImages(manifest, onComplete) {
  const items = Array.isArray(manifest) ? manifest : [];
  const total = items.length;
  if (total === 0) {
    if (typeof onComplete === 'function') onComplete();
    return;
  }

  let loaded = 0;
  let finished = false;

  // Safety timeout: proceed even if not all images load (prevents stuck loading bar)
  const MAX_WAIT_MS = 8000; // adjust as needed
  const timeoutId = setTimeout(() => {
    if (!finished) {
      finished = true;
      console.warn(`[preloadImages] timeout after ${MAX_WAIT_MS}ms — continuing with ${loaded}/${total} loaded`);
      if (typeof onComplete === 'function') onComplete();
    }
  }, MAX_WAIT_MS);

  items.forEach(({ path, assign }, idx) => {
    const img = new Image();
    img.onload = function() {
      try {
        if (typeof assign === 'function') assign(img);
      } catch (e) {
        console.warn('[preloadImages] assign callback failed for', path, e);
      }
      loaded++;
      if (!finished && loaded >= total) {
        finished = true;
        clearTimeout(timeoutId);
        if (typeof onComplete === 'function') onComplete();
      }
    };
    img.onerror = function(ev) {
      console.warn('[preloadImages] failed to load image:', path, ev);
      // still count it as loaded (we won't block startup)
      loaded++;
      if (!finished && loaded >= total) {
        finished = true;
        clearTimeout(timeoutId);
        if (typeof onComplete === 'function') onComplete();
      }
    };
    // start loading (trigger CORS errors in console if blocked)
    img.src = path;
  });
}

document.addEventListener('DOMContentLoaded',async () => {
  
async function loadStartLeaderboard() {
  try {
    if (!userToken) {
      console.warn("loadStartLeaderboard: no userToken; skipping fetch");
      return;
    }
    const url = `${BACKEND_URL.replace('/api','')}/api/leaderboard`;
    const res = await fetch(url, {
  credentials: 'include',
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${userToken}`
  }
});
    if (!res.ok) {
      // Surface some diagnostics to console to make it easier to spot issues.
      const text = await res.text().catch(() => "<no body>");
      console.error("loadStartLeaderboard: failed", res.status, res.statusText, text);
      // Optionally show a friendly message in the UI
      const container = document.getElementById('start-leaderboard-container');
      if (container) {
        container.innerHTML = `<div style="color:#b00;">Leaderboard unavailable (${res.status}).</div>`;
      }
      return;
    }
    const leaderboard = await res.json();
    console.log("loadStartLeaderboard: received data", leaderboard);
    renderStartLeaderboard(leaderboard);
  } catch (err) {
    console.error("loadStartLeaderboard: error", err);
    const container = document.getElementById('start-leaderboard-container');
    if (container) {
      container.innerHTML = `<div style="color:#b00;">Failed to load leaderboard.</div>`;
    }
  }
}

async function loadUserSessions() {
  if (!userToken) {
    renderUserSessions([]); // show logged-out message / clear
    return;
  }
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/my-sessions`, {
      headers: { "Authorization": `Bearer ${userToken}`, "Accept": "application/json" }
    }, 7000);
    if (!res.ok) {
      console.warn('loadUserSessions failed', res.status);
      renderUserSessions([]);
      return;
    }
    const sessions = await res.json();
    renderUserSessions(sessions);
  } catch (err) {
    console.warn('loadUserSessions error', err);
    renderUserSessions([]);
  }
}
if (document.getElementById('user-sessions-container')) {
    document.getElementById('user-sessions-container').style.display = userToken ? '' : 'none';
  }

 // --- Welcome text and difficulty-cost hover/click UI ---
// Show logged in email in start screen welcome area
function showWelcomeEmail() {
    const welcomeEl = document.getElementById('welcome-user');
    const emailSpan = document.getElementById('welcome-email');
    if (userEmail && welcomeEl && emailSpan) {
      emailSpan.textContent = userEmail;
      welcomeEl.style.display = '';
    } else if (welcomeEl) {
      welcomeEl.style.display = 'none';
    }
  }


// Wire difficulty buttons to show cost on hover and click
(function wireDifficultyCostUI() {
  const costDisplay = document.getElementById('difficulty-cost-display');
  const diffBtns = document.querySelectorAll('#difficulty-selector .difficulty-btn');

  if (!diffBtns || diffBtns.length === 0) return;

  diffBtns.forEach(btn => {
    const value = btn.getAttribute('data-value');
    const cost = DIFFICULTY_CREDIT_COST[value] || 0;
    // set native title tooltip for accessibility and hover
    btn.title = `Cost: ${cost} credits`;

    // Hover: show cost
    btn.addEventListener('mouseenter', () => {
      if (costDisplay) {
        costDisplay.textContent = `Cost to start (${value.charAt(0).toUpperCase()+value.slice(1)}): ${cost} credits`;
        costDisplay.style.display = '';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (costDisplay) {
        const active = document.querySelector('#difficulty-selector .difficulty-btn.active');
        if (!active) {
          costDisplay.style.display = 'none';
        } else {
          const activeVal = active.getAttribute('data-value');
          const activeCost = DIFFICULTY_CREDIT_COST[activeVal] || 0;
          costDisplay.textContent = `Cost to start (${activeVal.charAt(0).toUpperCase()+activeVal.slice(1)}): ${activeCost} credits`;
          costDisplay.style.display = '';
        }
      }
    });

    // Click: update cost display and Start button state
    btn.addEventListener('click', () => {
      const activeVal = btn.getAttribute('data-value');
      const activeCost = DIFFICULTY_CREDIT_COST[activeVal] || 0;
      if (costDisplay) {
        costDisplay.textContent = `Cost to start (${activeVal.charAt(0).toUpperCase()+activeVal.slice(1)}): ${activeCost} credits`;
        costDisplay.style.display = '';
      }
      // Refresh Start button enable/disable
      setCredits(userCredits);
      updateStartButtonUI();
    });
  });
})();

function formatSessionShort(sess) {
  const dt = sess.startTime ? new Date(sess.startTime) : null;
  const when = dt ? `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'Unknown';
  const duration = sess.elapsedSeconds ? `${sess.elapsedSeconds}s` : (sess.endTime ? '0s' : 'In progress');
  const status = sess.isWin ? 'WIN' : (sess.endedEarly ? 'ENDED' : 'LOSS');
  const difficulty = sess.difficulty ? sess.difficulty.charAt(0).toUpperCase() + sess.difficulty.slice(1) : 'Normal';
  return { when, duration, status, difficulty, chests: (sess.chestsCollected||0) + '/' + (sess.totalChests||0), device: sess.deviceType || 'unknown' };
}

function renderUserSessions(sessions) {
  const panel = document.getElementById('user-sessions-container');
  const container = document.getElementById('user-sessions-list');
  const mobileList = document.getElementById('mobile-history-list');

  // Ensure panel visibility only when logged in
  if (panel) panel.style.display = userToken ? '' : 'none';

  if (!container) return;

  // If not logged in or no sessions, show empty state (mobile & desktop)
  if (!userToken || !sessions || sessions.length === 0) {
    container.innerHTML = `<div style="color:#666;">No sessions yet.</div>`;
    if (mobileList) mobileList.innerHTML = `<div style="color:#666; padding:8px;">No sessions yet.</div>`;
    return;
  }

  // Render sessions (latest first)
  container.innerHTML = '';
  sessions.forEach(s => {
    const meta = formatSessionShort(s);
    const div = document.createElement('div');
    div.className = 'session-item';
    div.innerHTML = `
      <div style="font-weight:700;color:#024a7a;">${meta.when} <small style="font-weight:700;color:#066;">${meta.difficulty}</small></div>
      <div style="margin-top:6px;color:#444;">${meta.chests} • ${meta.duration} • ${meta.device} • <strong style="color:${s.isWin ? '#118844' : '#b85'}">${meta.status}</strong></div>
    `;
    container.appendChild(div);
  });

  // Mobile list
  if (mobileList) {
    mobileList.innerHTML = '';
    sessions.forEach(s => {
      const meta = formatSessionShort(s);
      const el = document.createElement('div');
      el.className = 'session-item';
      el.style.marginBottom = '10px';
      el.innerHTML = `
        <div style="font-weight:700;">${meta.when} — <small style="color:#0078d7;">${meta.difficulty}</small></div>
        <div class="meta">${meta.chests} • ${meta.duration} • ${meta.device} • <strong style="color:${s.isWin ? '#118844' : '#b85'}">${meta.status}</strong></div>
      `;
      mobileList.appendChild(el);
    });
  }
}

// Wire mobile history button / close
(function wireMobileHistoryUI(){
  const mobileBtn = document.getElementById('mobile-history-btn');
  const mobileModal = document.getElementById('mobile-history-modal');
  const mobileClose = document.getElementById('close-mobile-history');

  if (mobileBtn && mobileModal) {
    mobileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      loadUserSessions(); // refresh before showing
      mobileModal.classList.remove('hidden');
      mobileModal.style.display = 'flex';
    });
  }
  if (mobileClose && mobileModal) {
    mobileClose.addEventListener('click', (e) => {
      e.preventDefault();
      mobileModal.classList.add('hidden');
      mobileModal.style.display = 'none';
    });
    mobileModal.addEventListener('click', (ev) => {
      if (ev.target === mobileModal) {
        mobileModal.classList.add('hidden');
        mobileModal.style.display = 'none';
      }
    });
  }
})();

function renderStartLeaderboard(leaderboard) {
  const container = document.getElementById('start-leaderboard-container');
  if (!container) return;
  container.innerHTML = '';

 



  // Show only leaderboard for currently selected difficulty:
  const diff = selectedDifficulty || 'normal';
  const entries = leaderboard[diff];
  container.innerHTML += `<h2 style="color:#0078d7;">${diff.charAt(0).toUpperCase() + diff.slice(1)} Difficulty Leaderboard</h2>`;
  if (!entries || entries.length === 0) {
    container.innerHTML += `<div style="color:#444;">No winners yet for ${diff}!</div>`;
    return;
  }
  function getCrownSVG(rank) {
    if (rank === 0) {
      // Gold
      return `<svg width="28" height="28" viewBox="0 0 32 32" style="vertical-align:middle"><circle cx="16" cy="16" r="16" fill="#FFD700"/><text x="16" y="22" text-anchor="middle" font-size="18" font-family="Arial" dy=".3em">👑</text></svg>`;
    } else if (rank === 1) {
      // Silver
      return `<svg width="28" height="28" viewBox="0 0 32 32" style="vertical-align:middle"><circle cx="16" cy="16" r="16" fill="#C0C0C0"/><text x="16" y="22" text-anchor="middle" font-size="18" font-family="Arial" dy=".3em">👑</text></svg>`;
    } else if (rank === 2) {
      // Bronze
      return `<svg width="28" height="28" viewBox="0 0 32 32" style="vertical-align:middle"><circle cx="16" cy="16" r="16" fill="#cd7f32"/><text x="16" y="22" text-anchor="middle" font-size="18" font-family="Arial" dy=".3em">👑</text></svg>`;
    } else {
      // Numbered circle
      return `<span style="font-size:1.2em;border-radius:50%;background:#eee;padding:3px 10px;color:#222;vertical-align:middle;">${rank+1}</span>`;
    }
  }
  entries.forEach((entry, i) => {
    let icon = getCrownSVG(i);
    container.innerHTML += `
      <div class="leaderboard-entry">
        ${icon}
        <div style="flex:1;padding-left:12px;">
          <b>${entry.user.email}</b> <br>
          Time: <span style="font-weight:bold;">${entry.elapsedSeconds} sec</span>
          &nbsp;|&nbsp; Seaweeds: <span style="font-weight:bold;">${entry.seaweedsCollected}</span>
          &nbsp;|&nbsp; Score: <span style="font-weight:bold;">${entry.score}</span>
        </div>
      </div>
    `;
  });
  window.lastLeaderboard = leaderboard;
}



// And when changing difficulty:
 const difficultySelector = document.getElementById('difficulty-selector');
  if (difficultySelector) {
    difficultySelector.addEventListener('click', (e) => {
      if (e.target.classList.contains('difficulty-btn')) {
        for (const btn of difficultySelector.querySelectorAll('.difficulty-btn')) {
          btn.classList.remove('active');
        }
        e.target.classList.add('active');
        selectedDifficulty = e.target.getAttribute('data-value');
        // recompute enable/disable of start using current credits
        setCredits(userCredits);
        loadStartLeaderboard();
      }
    });
  }
  preloadImages(imageManifest, function() {
    startScreen = document.getElementById('start-screen');
    gameScreen = document.getElementById('game-screen');
    if (gameScreen) {
  // Make #game-screen a stacking context for absolute children
  gameScreen.style.position = 'relative';
}
    completionPopup = document.getElementById('completion-popup');
    quitResultPopup = document.getElementById('quit-result-popup');
    startButton = document.getElementById('start-button');
if (startButton) {
  startButton.type = 'button';
 // REPLACE existing direct start wiring:
// startButton.addEventListener('click', (e) => { e.preventDefault(); handleStartButtonClick(); });

// with this safe wrapper and helper (paste this where the original line was)
// REPLACE the wrapper you added with this corrected version
(function installSafeStartWrapper() {
  if (window.__safeStartWrapperInstalled) return;
  window.__safeStartWrapperInstalled = true;

  let localInFlight = false;
  const FALLBACK_WAIT_MS = 12000; // wait for gameActive to appear

  function hideTransientControls() {
    try {
      showJoystick(false);
      setHUDVisible(false);
      const hudToggle = document.getElementById('toggle-hud-button');
      if (hudToggle) hudToggle.style.display = 'none';
    } catch (err) { console.warn('hideTransientControls error', err); }
  }

  async function safeStartHandler(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    if (localInFlight) return;
    localInFlight = true;
    // IMPORTANT: do NOT set startRequestInFlight here - handleStartButtonClick owns that flag

    const btn = startButton || document.getElementById('start-button');
    const originalLabel = btn ? btn.textContent : 'Start';
    try {
      if (btn) {
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        btn.textContent = 'Starting...';
      }

      hideTransientControls();

      // call existing start logic (it will set startRequestInFlight)
      let startPromise;
      try {
        startPromise = Promise.resolve().then(() => handleStartButtonClick && handleStartButtonClick());
      } catch (callErr) {
        startPromise = Promise.reject(callErr);
      }

      const waitForGameActive = new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          if (window.gameActive) return resolve(true);
          if (Date.now() - start > FALLBACK_WAIT_MS) return resolve(false);
          setTimeout(check, 150);
        };
        check();
      });

      await Promise.allSettled([startPromise, waitForGameActive]);

      if (window.gameActive) {
        // success — leave things to game logic
        return;
      } else {
        // start didn't transition to a running game in time -> restore
        if (btn) {
          btn.disabled = false;
          btn.style.pointerEvents = '';
          btn.textContent = originalLabel;
        }
        hideTransientControls();
      }

    } catch (err) {
      console.error('[safeStartHandler] error', err);
      if (btn) {
        btn.disabled = false;
        btn.style.pointerEvents = '';
        btn.textContent = originalLabel;
      }
    } finally {
      localInFlight = false;
      // do NOT modify startRequestInFlight here
    }
  }

  if (startButton) {
    startButton.addEventListener('click', (ev) => { safeStartHandler(ev).catch(console.error); });
  } else {
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t) return;
      if (t.id === 'start-button' || (t.closest && t.closest('#start-button'))) {
        safeStartHandler(ev).catch(console.error);
      }
    });
  }
})();
  // Ensure label + enabled state reflect current login/credits on load
  updateStartButtonUI();
}
    completionPlayAgainButton = document.getElementById('completion-play-again-button');
    completionReturnToStartButton = document.getElementById('completion-return-to-start-button');
    quitPlayAgainButton = document.getElementById('quit-play-again-button');
    quitReturnToStartButton = document.getElementById('quit-return-to-start-button');

    if (completionPlayAgainButton) {
      completionPlayAgainButton.addEventListener('click', () => {
  playAgainAfterDeath = true;
  loadStartLeaderboard();
  handleStartButtonClick();
});
    }
    if (quitPlayAgainButton) {
quitPlayAgainButton.addEventListener('click', () => {
  playAgainAfterDeath = true;
  loadStartLeaderboard();
  handleStartButtonClick();
});
    }
    if (completionReturnToStartButton) {
   completionReturnToStartButton.addEventListener('click', () => {
  showScreen(startScreen);
  loadStartLeaderboard();
  loadUserSessions();
  showWelcomeEmail();
});
    }
    if (quitReturnToStartButton) {
quitReturnToStartButton.addEventListener('click', () => {
  showScreen(startScreen);
  loadStartLeaderboard();
  loadUserSessions();
  showWelcomeEmail();
});
    }

    endGameButton = document.getElementById('end-game-button');
    scoreValue = document.getElementById('score-value');
    treasuresCollected = document.getElementById('treasures-collected');
    totalTreasures = document.getElementById('total-treasures');
    finalScore = document.getElementById('final-score');
    quitFinalScore = document.getElementById('quit-final-score');
    quitTreasuresCollected = document.getElementById('quit-treasures-collected');
    timerValue = document.getElementById('timer-value');
    timeRemaining = document.getElementById('time-remaining');
    completionTitle = document.getElementById('completion-title');
    completionMessage = document.getElementById('completion-message');
    quitTitle = document.getElementById('quit-title');
    quitMessage = document.getElementById('quit-message');
    let gameInfo = document.querySelector('#game-screen .game-info');
     let toggleHudBtn = document.querySelector('#game-screen #toggle-hud-button');
     let hudVisible = true;;
    {
  const hudToggle = document.getElementById('toggle-hud-button');
  if (hudToggle) {
    // ensure it's a button (safe) and visible above canvas
    hudToggle.type = hudToggle.type || 'button';
    hudToggle.style.setProperty('z-index', '1600', 'important');

    // attach a single handler that toggles the HUD
    hudToggle.addEventListener('click', () => {
      setHUDVisible(!hudVisible);
    });
  }
}
    showScreen(document.getElementById('auth-screen'));

    // Feedback UI wiring
    // Improvised wireFeedbackUI — paste this inside your DOMContentLoaded init (replace any existing wireFeedbackUI)
(function wireFeedbackUI() {
  const sendBtn = document.getElementById('send-feedback-btn');
  const feedbackScreen = document.getElementById('feedback-screen');
  const feedbackStars = document.getElementById('feedback-stars');
  const feedbackText = document.getElementById('feedback-text');
  const submitBtn = document.getElementById('feedback-submit-btn');
  const thankyou = document.getElementById('feedback-thankyou');
  const returnBtn = document.getElementById('feedback-return-btn');

  if (!sendBtn || !feedbackScreen) return;

  // Scoped rating state (avoid global selectedRating)
  let rating = 0;

  function renderStars() {
    if (!feedbackStars) return;
    feedbackStars.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'feedback-star';
      s.textContent = i <= rating ? '★' : '☆';
      s.style.fontSize = '24px';
      s.style.cursor = 'pointer';
      s.style.border = 'none';
      s.style.background = 'transparent';
      s.style.color = i <= rating ? '#ffcc00' : '#ccc';
      s.style.marginRight = '4px';
      // capture i
      s.addEventListener('click', () => { rating = i; renderStars(); });
      feedbackStars.appendChild(s);
    }
  }
  renderStars();

  // Show feedback modal
  sendBtn.addEventListener('click', (e) => {
    e.preventDefault();
    rating = 0;
    renderStars();
    if (feedbackText) feedbackText.value = '';
    if (thankyou) thankyou.classList.add('hidden');
    if (submitBtn) {
      submitBtn.style.display = '';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }
    showScreen(feedbackScreen);
  });

  // Prevent double submits
  let sendInFlight = false;

  async function submitFeedback() {
    if (sendInFlight) return;
    const text = (feedbackText && feedbackText.value || '').trim();

    // Require at least rating OR text (adjust as you prefer)
    if (!rating && !text) {
      alert('Please give a rating and/or write some feedback.');
      return;
    }

    const payload = {
      rating: rating || 0,
      text,
      email: userEmail || null,
      difficulty: selectedDifficulty || 'normal'
    };

    sendInFlight = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }

    try {
      // Use the centralized helper — non-blocking behavior is handled below
      await sendFeedbackToServer(payload);

      // Success UI
      if (thankyou) thankyou.classList.remove('hidden');
      if (submitBtn) submitBtn.style.display = 'none';
    } catch (err) {
      console.warn('[feedback] submit failed (non-blocking):', err);
      // Best-effort: persist to localStorage for retry later
      try {
        const pending = JSON.parse(localStorage.getItem('pendingFeedback') || '[]');
        pending.push({ payload, createdAt: Date.now() });
        localStorage.setItem('pendingFeedback', JSON.stringify(pending));
      } catch (e) {
        // ignore storage errors
      }
      // Still show thank-you so user isn't blocked
      if (thankyou) thankyou.classList.remove('hidden');
      if (submitBtn) submitBtn.style.display = 'none';
    } finally {
      sendInFlight = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    }
  }

  if (submitBtn) submitBtn.addEventListener('click', (e) => { e.preventDefault(); submitFeedback(); });

  if (thankyou) thankyou.addEventListener('click', () => { showScreen(startScreen); });

  if (returnBtn) {
    returnBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showScreen(startScreen);
    });
  }
})();


    // Auth form elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegister = document.getElementById('show-register');
const showLogin = document.getElementById('show-login');
const registerSuccessPopup = document.getElementById('register-success-popup');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');

// Show register form
showRegister.onclick = () => {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  registerError.textContent = '';
  document.getElementById('register-email').value = '';
  document.getElementById('register-password').value = '';
  document.getElementById('register-confirm').value = '';
};

// Back to login screen
showLogin.onclick = () => {
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  registerError.textContent = '';
};

// Register logic
registerBtn.onclick = async () => {
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const confirm = document.getElementById('register-confirm').value;
  if (!email || !password || !confirm) {
    registerError.textContent = "All fields are required!";
    return;
  }
  if (password !== confirm) {
    registerError.textContent = "Passwords do not match!";
    return;
  }
  try {
    const res = await fetch(`${BACKEND_URL.replace('/api','')}/api/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.ok) {
      registerForm.classList.add('hidden');
      registerSuccessPopup.classList.remove('hidden');
    } else {
      registerError.textContent = data.error || "Registration error";
    }
  } catch (e) {
    registerError.textContent = 'Registration error';
  }
};

// Hide registration success popup and show login
registerSuccessPopup.onclick = () => {
  registerSuccessPopup.classList.add('hidden');
  loginForm.classList.remove('hidden');
};

     function setHUDVisible(visible) {
  // Find all HUD elements inside the game screen and force their visible/hidden state
  const hudEls = document.querySelectorAll('#game-screen .game-info');
  hudEls.forEach(el => {
    // Ensure z-index works by making it positioned
    if (!el.style.position || el.style.position === 'static') {
      el.style.position = 'relative';
    }
    el.style.setProperty('z-index', '1500', 'important');

    // Use setProperty with "important" to reliably override stylesheet rules
    if (visible) {
      el.style.setProperty('display', 'flex', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      el.style.setProperty('opacity', '1', 'important');
    } else {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
    }
  });

  // Keep internal flag in sync
  hudVisible = !!visible;

  // Ensure any toggle button(s) update label and remain reachable above the canvas
  document.querySelectorAll('#game-screen #toggle-hud-button').forEach(btn => {
    btn.textContent = hudVisible ? 'Hide HUD' : 'Show HUD';
    // Keep the toggle accessible and above the HUD/canvas
    btn.style.setProperty('z-index', '1600', 'important');
    // Make sure the toggle itself is visible (don't hide the toggle when HUD is hidden)
    btn.style.setProperty('display', 'block', 'important');
    btn.style.removeProperty('visibility');
    btn.style.removeProperty('opacity');
  });
} 
    console.log(document.getElementById('reset-password-popup'));
    const showReset = document.getElementById('show-reset');
const resetPasswordPopup = document.getElementById('reset-password-popup');
const resetSuccessPopup = document.getElementById('reset-success-popup');
const resetPasswordBtn = document.getElementById('reset-password-btn');
const resetError = document.getElementById('reset-error');
 console.log(resetPasswordPopup);


showReset.onclick = () => {
  document.getElementById('auth-screen').classList.remove('hidden'); // <-- Ensure parent is shown!
  loginForm.classList.add('hidden');
  resetPasswordPopup.classList.remove('hidden');
  resetError.textContent = '';
  document.getElementById('reset-email').value = '';
  document.getElementById('reset-new-password').value = '';
  document.getElementById('reset-confirm-password').value = '';
};

resetPasswordBtn.onclick = async () => {
  
  const email = document.getElementById('reset-email').value;
  const newPassword = document.getElementById('reset-new-password').value;
  const confirmPassword = document.getElementById('reset-confirm-password').value;
  if (!email || !newPassword || !confirmPassword) {
    resetError.textContent = "All fields are required!";
    return;
  }
  if (newPassword !== confirmPassword) {
    resetError.textContent = "Passwords do not match!";
    return;
  }
  try {
    const res = await fetch(`${BACKEND_URL.replace('/api','')}/api/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword })
    });
    const data = await res.json();
    if (data.ok) {
      resetPasswordPopup.classList.add('hidden');
      resetSuccessPopup.classList.remove('hidden');
    } else {
      resetError.textContent = data.error || "Password reset error";
    }
  } catch (e) {
    resetError.textContent = 'Password reset error';
  }
};

resetSuccessPopup.onclick = () => {
  resetSuccessPopup.classList.add('hidden');
  loginForm.classList.remove('hidden');
};

const resetReturnBtn = document.getElementById('reset-return-btn');
if (resetReturnBtn) {
  resetReturnBtn.onclick = () => {
    resetPasswordPopup.classList.add('hidden');
    loginForm.classList.remove('hidden');
    // Optionally clear fields and errors
    document.getElementById('reset-email').value = '';
    document.getElementById('reset-new-password').value = '';
    document.getElementById('reset-confirm-password').value = '';
    resetError.textContent = '';
  };
}

function showScreen(target) {
  // Hide all known screens
  const selectors = ['#auth-screen', '#start-screen', '#game-screen', '#completion-popup', '#quit-result-popup', '#feedback-screen'].join(', ');
  const screens = Array.from(document.querySelectorAll(selectors));

  screens.forEach(el => el.classList.add('hidden'));

  if (target) {
    const id = target.id;
    const targets = Array.from(document.querySelectorAll(`#${CSS.escape(id)}`));
    targets.forEach(el => el.classList.remove('hidden'));
  }

  // Always force-hide or show the game-screen regardless of stylesheet conflicts
  const gs = document.getElementById('game-screen');
  if (gs) {
    if (target && target.id === 'game-screen') {
      // Allow it to show: remove any inline override that could hide it
      gs.style.removeProperty('display');
    } else {
      // Make absolutely sure the canvas isn't covering other screens
      gs.style.setProperty('display', 'none', 'important');
    }
  }

  // HUD should only be visible in-game
  if (!target || target.id !== 'game-screen') {
    setHUDVisible(false);
    const hudBtn = document.getElementById('toggle-hud-button');
if (hudBtn) hudBtn.style.display = "none";
  }
  if (!target || target.id !== 'game-screen') {
    showJoystick(false);
  }
  // (Optional: if you want to show joystick when returning to game screen, check gameActive)
   if (target && target.id === 'game-screen' && gameActive && isMobile) {
    showJoystick(true);
  }
}
  document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    try {
      const res = await fetch(`${BACKEND_URL.replace('/api','')}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (data.ok) {
        // Persist token and user info
        userToken = data.token;
        userEmail = data.email;
        try {
          localStorage.setItem('token', data.token);
          localStorage.setItem('email', data.email || '');
          // save admin id and isAdmin flag if provided (dashboard uses adminId)
          if (typeof data.id !== 'undefined') localStorage.setItem('adminId', String(data.id));
          if (typeof data.isAdmin !== 'undefined') localStorage.setItem('isAdmin', data.isAdmin ? '1' : '0');
        } catch (e) {
          console.warn('Failed to set localStorage during login:', e);
        }

        if (typeof data.credits !== "undefined") setCredits(data.credits);

  // Show start screen and leaderboards
  showScreen(startScreen);
  loadStartLeaderboard();

  // Load current user's sessions (if any) into left panel / mobile list
  await loadUserSessions();
  showWelcomeEmail()

  // Try to load a per-difficulty game config (best-effort). Fallback to DEFAULT_GAME_CONFIG.
  try {
          const cfgRes = await fetchWithTimeout(`${BACKEND_URL}/game-config?difficulty=${encodeURIComponent(selectedDifficulty)}`, { headers: { "Accept": "application/json" } }, 7000);
          if (cfgRes && cfgRes.ok) {
            GAME_CONFIG = await cfgRes.json();
          } else {
            GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
          }
        } catch (err) {
          console.warn('fetch game config failed, using defaults', err);
          GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
        }

  // Apply the loaded (or default) config to globals
  customPattern = GAME_CONFIG.mazePattern;
  TOTAL_TREASURES = GAME_CONFIG.totalTreasures;
  SEAWEED_COUNT = GAME_CONFIG.totalSeaweeds;
  BUBBLE_COUNT = GAME_CONFIG.totalBubbles;
  NUM_MINES = GAME_CONFIG.totalMines;
  GAME_TIME_SECONDS = GAME_CONFIG.gameTimeSeconds;

  // (no duplicate showScreen here)
} else {
  document.getElementById('auth-error').textContent = data.error;
}
    } catch (e) {
      document.getElementById('auth-error').textContent = 'Login error';
    }
  };
  const feedbackReturnBtn = document.getElementById('feedback-return-btn');
if (feedbackReturnBtn) {
  feedbackReturnBtn.type = 'button'; // safe for forms
  feedbackReturnBtn.onclick = (e) => {
    e.preventDefault(); // in case it's inside a form
    // Reset feedback UI
    document.getElementById('feedback-thankyou')?.classList.add('hidden');
    const submitBtn = document.getElementById('feedback-submit-btn');
    if (submitBtn) submitBtn.style.display = '';
    // Go back to start screen using the variable, not re-querying
    showScreen(startScreen);
  };
}
const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      // Clear in-memory
      userToken = null;
      userEmail = null;
      sessionId = null;
      // Clear persisted auth
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('email');
        localStorage.removeItem('adminId');
        localStorage.removeItem('isAdmin');
      } catch (e) {
        console.warn('Failed to clear localStorage on logout', e);
      }
      setCredits(null);
      renderUserSessions([]);
      showWelcomeEmail(); // ensure the welcome line is hidden
      showScreen(document.getElementById('auth-screen'));
    };
  }
    

        canvas = document.getElementById('game-canvas');

    // Detect mobile/touch first so viewport sizing uses the correct branch
    function detectMobile() {
      // Consider device "mobile" / touch-capable if the platform supports touch.
      return ('ontouchstart' in window) || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
             /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent);
    }
    isMobile = detectMobile();

    // Now update canvas/viewport sizing using the determined isMobile
    updateViewportSize();

    // Finally get the drawing context
    ctx = canvas.getContext('2d');

    

   // Robust joystick init / handlers. Drop this in where you currently create the joystick listeners.
// joystick initialization — minimal fix: declare baseRect/updateBaseRect in outer scope
const joystickContainer = document.getElementById('joystick-container');
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

// Make baseRect and updater available to all handlers (avoid block-scope issue)
let baseRect = null;
function updateBaseRect() {
  if (joystickBase) baseRect = joystickBase.getBoundingClientRect();
}

if (( 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ) &&
    joystickContainer && joystickBase && joystickStick) {

  joystickContainer.style.pointerEvents = 'auto';
  updateBaseRect(); // set initial rect
  const maxDist = 40;

  // keep rect current
  window.addEventListener('resize', updateBaseRect);

  joystickStick.addEventListener('touchstart', function(e) {
    e.preventDefault();
    joystickActive = true;
    updateBaseRect();
  }, { passive: false });

  window.addEventListener('touchend', function(e) {
    joystickActive = false;
    joystickX = 0; joystickY = 0;
    if (baseRect && joystickStick) {
      joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2) + 'px';
      joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2) + 'px';
    }
  }, { passive: true });

  window.addEventListener('touchmove', function(e) {
    if (!joystickActive || !baseRect) return;
    e.preventDefault();
    const touch = e.touches[0];
    const centerX = baseRect.left + baseRect.width / 2;
    const centerY = baseRect.top + baseRect.height / 2;
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    let dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > maxDist) {
      dx = dx * maxDist / dist;
      dy = dy * maxDist / dist;
    }
    joystickX = dx / maxDist;
    joystickY = dy / maxDist;
    joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2 + dx) + 'px';
    joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2 + dy) + 'px';
  }, { passive: false });

  // treat touching the base as equivalent to touching the stick
  joystickBase.addEventListener('touchstart', function(e) {
    e.preventDefault();
    joystickActive = true;
    updateBaseRect();
  }, { passive: false });

  // handle canceled touches
  window.addEventListener('touchcancel', function(e) {
    joystickActive = false;
    joystickX = 0; joystickY = 0;
    if (baseRect && joystickStick) {
      joystickStick.style.left = (baseRect.width/2 - joystickStick.offsetWidth/2) + 'px';
      joystickStick.style.top = (baseRect.height/2 - joystickStick.offsetHeight/2) + 'px';
    }
  }, { passive: true });
}


   
   
    

  /* 6) Guard the Start Game button flow */
// === REPLACE the existing handleStartButtonClick() with this version ===

/**
 * Wait helper: poll until window.gameActive becomes true (or timeout).
 * Returns true if gameActive became true, false on timeout.
 */
function waitForGameActive(timeoutMs = 12000) {
  return new Promise(resolve => {
    const start = Date.now();
    (function check() {
      if (window.gameActive) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, 120);
    })();
  });
}

async function handleStartButtonClick() {
  const cost = DIFFICULTY_CREDIT_COST[selectedDifficulty] || 10;
  if (typeof userCredits === 'number' && userCredits < cost) {
    alert(`Not enough credits (${userCredits}) for ${selectedDifficulty}. You need ${cost} credits.`);
    return;
  }

  if (startRequestInFlight) return;
  startRequestInFlight = true;

  const startBtn = startButton || document.getElementById('start-button');
  const backupLabel = startBtn ? startBtn.textContent : 'Start Game';
  let transitionedToGame = false;

  try {
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = 'Checking...';
    }

    // 1) Dry-run: check server-side if we can start, without deducting credits or creating a session
    const dryRes = await fetchWithTimeout(`${BACKEND_URL}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dry-Run': '1',
        'Authorization': userToken ? `Bearer ${userToken}` : undefined
      },
      body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail })
    }, 5000);

    if (!dryRes.ok) {
      let json = {};
      try { json = await dryRes.json(); } catch (e) {}
      console.warn('[start] dry-run failed', dryRes.status, json);
      alert(json.error || `Cannot start (${dryRes.status})`);
      return;
    }

    // Update credits shown (dry-run response includes credits)
    try {
      const dryData = await dryRes.json();
      if (typeof dryData.credits !== 'undefined') setCredits(dryData.credits);
    } catch (e) { /* ignore */ }

    // 2) Attempt to fetch game-config (best-effort)
    if (startBtn) startBtn.textContent = 'Preparing...';
    try {
      const cfgRes = await fetchWithTimeout(
        `${BACKEND_URL}/game-config?difficulty=${encodeURIComponent(selectedDifficulty)}`,
        { credentials: 'include' },
        7000
      );
      if (cfgRes && cfgRes.ok) {
        GAME_CONFIG = await cfgRes.json();
        applyConfigToGlobals(GAME_CONFIG);
      } else {
        if (!GAME_CONFIG?.mazePattern) {
          GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
          applyConfigToGlobals(GAME_CONFIG);
        }
      }
    } catch (cfgErr) {
      if (!GAME_CONFIG?.mazePattern) {
        GAME_CONFIG = { ...DEFAULT_GAME_CONFIG };
        applyConfigToGlobals(GAME_CONFIG);
      }
    }

    // 3) Start the local game pre-countdown / init path before performing the destructive /start.
    // This prevents a server-side credit deduction if the client fails to initialize.
    if (startBtn) startBtn.textContent = 'Starting...';

    // Start the pre-game countdown / local initialization
    startPreGameCountdown();

    // Wait for the local game to be active (initGame succeeded)
    const ok = await waitForGameActive(12000);
    if (!ok) {
      // local init failed or timed out — restore start UI so user can retry (and credits were not deducted)
      console.warn('[start] local init did not complete in time; aborting server-side start');
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.textContent = backupLabel;
      }
      return;
    }

    // 4) Now perform the destructive /start (create server session & deduct credits).
    // We do this after local init succeeded to avoid charging when client init fails.
    const res = await fetchWithTimeout(`${BACKEND_URL}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': userToken ? `Bearer ${userToken}` : undefined },
      body: JSON.stringify({ difficulty: selectedDifficulty, email: userEmail })
    }, 7000);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // If server fails here, we already started locally — you may choose to end the session client-side or retry.
      console.error('[start] server /start failed after local init:', res.status, body);
      alert(body.error || `Failed to start game on server (status ${res.status}).`);
      // Optionally, end the local game to avoid a mismatch between client/server
      // endGame(true); // comment/uncomment depending on desired behavior
      return;
    }

    const data = await res.json();
    if (typeof data.credits !== 'undefined') setCredits(data.credits);
    if (data.sessionId) sessionId = data.sessionId;

    transitionedToGame = true;

  } catch (err) {
    console.error('handleStartButtonClick error', err);
    alert('Network/server error. Please try again.');
  } finally {
    if (!transitionedToGame && startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = backupLabel;
    }
    startRequestInFlight = false;
  }
}



    if (endGameButton) {
      endGameButton.addEventListener('click', () => {
        logEndGame(true);
        showGameEndedResult();
      });
    }
    function showGameEndedResult() {
  if (isGameOver) return;
  isGameOver = true;

  gameActive = false;
  clearInterval(timeInterval);
  stopAnimationLoop();
  setHUDVisible(false);

  showScreen(quitResultPopup);
  if (quitTitle) quitTitle.textContent = "Game Ended!";
  if (quitMessage) quitMessage.textContent = "Your progress before ending:";
  if (quitFinalScore) quitFinalScore.textContent = score;
  if (quitTreasuresCollected) quitTreasuresCollected.textContent = collectedTreasures;
}
 ensureStartButtonIdle();

    // Replace your existing startPreGameCountdown() with this instrumented version
function startPreGameCountdown() {
  try {
    console.log('[startPreGameCountdown] start requested');
    setHUDVisible(false); // Hide HUD during countdown
    const hudBtn = document.getElementById('toggle-hud-button');
    if (hudBtn) hudBtn.style.display = "none";

    stopAnimationLoop();
    isGameOver = false;
    explosionActive = false;
    confettiActive = false;
    celebrationActive = false;

    // Ensure gameScreen is resolved
    if (!gameScreen) gameScreen = document.getElementById('game-screen');
    if (!gameScreen) {
      console.error('[startPreGameCountdown] Missing #game-screen');
      updateStartButtonUI('Start Game');
      const btn = startButton || document.getElementById('start-button');
      if (btn) btn.disabled = false;
      return;
    }

    showScreen(gameScreen);

    // Verify canvas/context
    if (!canvas) canvas = document.getElementById('game-canvas');
    if (!ctx && canvas) {
      try {
        ctx = canvas.getContext('2d');
      } catch (e) {
        console.error('[startPreGameCountdown] getContext failed', e);
      }
    }
    if (!canvas || !ctx) {
      console.error('[startPreGameCountdown] missing canvas or context', { canvas, ctx });
      updateStartButtonUI('Start Game');
      const btn = startButton || document.getElementById('start-button');
      if (btn) btn.disabled = false;
      return;
    }

    setHUDVisible(false); // Hide HUD during countdown
    preGameCountdown = PRE_GAME_TIMER;
    preGameState = "count";

    // Guard render() to avoid aborting the countdown due to draw errors
    try { render(); } catch (e) {
      console.warn('[startPreGameCountdown] initial render() failed (continuing):', e);
    }

    // Clear any previous interval
    if (preGameInterval) {
      clearInterval(preGameInterval);
      preGameInterval = null;
    }

    // Instrumentation flags
    window.__lastStartAttempt = { ts: Date.now(), started: true };
    window.__gameInitCompleted = false;
    window.__lastPreGameError = null;

    preGameInterval = setInterval(() => {
      try {
        // Helpful debug trace
        console.log("[start] tick:", preGameCountdown, "state:", preGameState, "gameActive:", gameActive);

        if (preGameCountdown > 1) {
          preGameCountdown--;
        } else if (preGameCountdown === 1) {
          preGameCountdown = 0;
          preGameState = "start";
          console.log('[start] preGameState -> start');
        } else if (preGameState === "start") {
          // stop interval then start the actual game init
          clearInterval(preGameInterval);
          preGameInterval = null;
          preGameState = "running";
          console.log('[start] invoking initGame() now');

          try {
            // Mark the exact time we attempt initGame
            window.__lastStartAttempt.initCallTs = Date.now();

            // initGame may schedule async tasks; catch synchronous exceptions
            initGame(true);
            // set the flag here — if initGame fails synchronously this won't run
            window.__gameInitCompleted = true;
            window.gameActive = gameActive = true;
            console.log('[start] initGame() returned; window.gameActive set true');

            // leave the rest to game logic (render loop etc.)
            return;
          } catch (initErr) {
            console.error('[start] initGame threw synchronously:', initErr);
            window.__lastPreGameError = String(initErr && (initErr.stack || initErr.message || initErr));
            updateStartButtonUI('Start Game');
            const btn = startButton || document.getElementById('start-button');
            if (btn) btn.disabled = false;
            return;
          }
        }

        // Attempt to render during countdown; if render throws repeatedly we'll catch below
        try { render(); } catch (e) {
          console.warn('[start] render() during countdown threw:', e);
          // Let the outer catch handle clearing interval and restoring UI
          throw e;
        }
      } catch (tickErr) {
        // Detailed diagnostics for you to copy/paste
        console.error('[startPreGameCountdown] tick error — aborting countdown, restoring start button:', tickErr);
        window.__lastPreGameError = String(tickErr && (tickErr.stack || tickErr.message || tickErr));
        if (preGameInterval) {
          clearInterval(preGameInterval);
          preGameInterval = null;
        }
        // Restore Start button so user can retry
        updateStartButtonUI('Start Game');
        const btn = startButton || document.getElementById('start-button');
        if (btn) btn.disabled = false;
      }
    }, 1000);
  } catch (err) {
    console.error('[startPreGameCountdown] unexpected failure', err);
    updateStartButtonUI('Start Game');
    const btn = startButton || document.getElementById('start-button');
    if (btn) btn.disabled = false;
  }
}

    // Place this function at the top level of your file (outside initGame):
function placeSpreadOutTreasures(validPositions, numTreasures, existingIndices = new Set(), minDistance = 180) {
  let treasures = [];
  let usedIndices = new Set(existingIndices);

  // Shuffle validPositions for random start
  let indices = Array.from(Array(validPositions.length).keys());
  for (let i = indices.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  let attempts = 0;
  while (treasures.length < numTreasures && attempts < 2000) {
    attempts++;
    for (let idx of indices) {
      if (usedIndices.has(idx)) continue;
      const pos = validPositions[idx];
      // Enforce minimum distance from all placed treasures
      let tooClose = treasures.some(t => {
        let dx = t.x - pos.x;
        let dy = t.y - pos.y;
        let dist = Math.sqrt(dx*dx + dy*dy);
        return dist < minDistance;
      });
      if (tooClose) continue;
      treasures.push({
        x: pos.x,
        y: pos.y,
        width: CHEST_SIZE,
        height: CHEST_SIZE,
        type: "small",
        collected: false,
        value: [5, 10, 15][Math.floor(Math.random() * 3)],
        penalty: 0
      });
      usedIndices.add(idx);
      if (treasures.length >= numTreasures) break;
    }
  }
  return {treasures, usedIndices};
}

function placeMermaidsFromPattern() {
  let arr = [];
  const rows = customPattern.length;
  const cols = customPattern[0].length;
  const cellW = GAME_WIDTH / cols;
  const cellH = GAME_HEIGHT / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (customPattern[r][c] === "M") {
        arr.push({
          x: c * cellW + cellW/2 - MERMAID_SIZE/2,
          y: r * cellH + cellH/2 - MERMAID_SIZE/2,
          width: MERMAID_SIZE,
          height: MERMAID_SIZE,
          state: "roaming",
          stateTimer: 0,
          roamTarget: getRandomOpenPosition(),
          lastChaseTarget: null,
          stuckCounter: 0
        });
      }
    }
  }
  return arr;
}

// Cleaned up initGame function:
function initGame(relocateManatee = true) {
  // Start non-blocking; proceed regardless of result
  Promise.resolve(logStartGame()).finally(() => {
    // If somehow config is missing, guarantee defaults
    if (!customPattern || !Array.isArray(customPattern) || !customPattern.length) {
      console.warn('[game] No maze pattern at init, applying defaults.');
      applyConfigToGlobals(GAME_CONFIG?.mazePattern ? GAME_CONFIG : DEFAULT_GAME_CONFIG);
    }
    activeSeaweedBoost = false;
    seaweedBoostTimer = 0;
    isGameOver = false;
    score = 0;
    collectedTreasures = 0;
    gameActive = true;
    explosionActive = false;
    debrisPieces = [];
    explosionTimer = 0;
    gameTimer = GAME_TIME_SECONDS;
    gameStartTime = Date.now();
    if (isMobile) showJoystick(true);

    walls = generateMazeWalls();
    bubbles = generateBubbles();
    seaweeds = generateSeaweeds();
    corals = generateCorals();
    mines = generateMines();

    let validPositions = getValidTreasurePositions(walls);

    mermaids = placeMermaidsFromPattern();

    // Manatee start position
    if (relocateManatee) {
      let spawnFound = false;
      for (let r = 0; r < customPattern.length; r++) {
        const row = customPattern[r];
        const c = row.indexOf('X');
        if (c !== -1) {
          const rows = customPattern.length;
          const cols = customPattern[0].length;
          const cellW = GAME_WIDTH / cols;
          const cellH = GAME_HEIGHT / rows;
          manatee.x = c * cellW + cellW/2 - manatee.width/2;
          manatee.y = r * cellH + cellH/2 - manatee.height/2;
          manateeLastX = manatee.x;
          manateeLastY = manatee.y;
          spawnFound = true;
          break;
        }
      }
      if (!spawnFound) {
        const spawnPos = validPositions[Math.floor(Math.random() * validPositions.length)];
        manatee.x = spawnPos.x;
        manatee.y = spawnPos.y;
        manateeLastX = manatee.x;
        manateeLastY = manatee.y;
      }
    }

    // --- Place spread-out treasures ---
    let res = placeSpreadOutTreasures(validPositions, TOTAL_TREASURES);
    treasures = res.treasures;

    // Place spread-out fake chests
    let numFakes = GAME_CONFIG.totalFakeChests ?? 0;
    let fakeTreasures = [];
    if (numFakes > 0) {
      let fakeResult = placeSpreadOutTreasures(validPositions, numFakes, res.usedIndices, 140);
      fakeTreasures = fakeResult.treasures.map(t => ({
        ...t,
        type: "fake",
        value: 0,
        penalty: 5
      }));
    }
    treasures = treasures.concat(fakeTreasures);

    if (totalTreasures) totalTreasures.textContent = TOTAL_TREASURES;
    updateScoreDisplay();
    updateTimerDisplay();
    if (timeInterval) clearInterval(timeInterval);
    timeInterval = setInterval(updateTimerDisplay, 200);

    collectibleSeaweeds = generateCollectibleSeaweeds();
    collectibleBubbles = generateCollectibleBubbles();
    stopAnimationLoop();
    rafId = requestAnimationFrame(gameLoop);
  });
}

   
    
    function updateScoreDisplay() {
      if (scoreValue) scoreValue.textContent = score;
      if (treasuresCollected) treasuresCollected.textContent = collectedTreasures;
      if (totalTreasures) totalTreasures.textContent = TOTAL_TREASURES;
    }

    function updateTimerDisplay() {
  if (!gameActive || celebrationActive || isGameOver) return;

  const elapsed = Math.floor((Date.now() - gameStartTime) / 1000);
  const remaining = Math.max(0, gameTimer - elapsed);
  if (timerValue) timerValue.textContent = remaining;
  if (timeRemaining) timeRemaining.textContent = remaining + "s";
  if (remaining <= 0) {
    endGame(true);
  }
}

    function endGame(timeUp = false) {
  if (isGameOver) return;
  isGameOver = true;

  logEndGame();
  confettiActive = false;
  celebrationActive = false;
  explosionActive = false;
  gameActive = false;
  showJoystick(false); // <-- Add this to hide joystick when game ends

  clearInterval(timeInterval);
  setHUDVisible (false);
   ensureStartButtonIdle();

  // Show results
  showScreen(completionPopup);
  const won = collectedTreasures >= TOTAL_TREASURES;
  if (completionTitle) {
    completionTitle.textContent = won ? "Congratulations!" : (timeUp ? "Time's up!" : "Game Over!");
  }
  if (completionMessage) {
    completionMessage.textContent = won
      ? "You found all the treasures!"
      : "Your final score and progress:";
  }
  if (finalScore) finalScore.textContent = score;
  if (timeRemaining && timerValue) timeRemaining.textContent = timerValue.textContent;
}
    

    function gameLoop(timestamp) {

   if (manateeJumping) {
  manateeJumpFrame++;
  let jumpProgress = manateeJumpFrame / MANATEE_JUMP_DURATION;
  manatee.jumpOffsetY = -MANATEE_JUMP_HEIGHT * 4 * jumpProgress * (1 - jumpProgress);
  if (manateeJumpFrame >= MANATEE_JUMP_DURATION) {
    manateeJumpCount++;
    if (manateeJumpCount < MANATEE_JUMPS_TOTAL) {
      manateeJumpFrame = 0; // next jump
    } else {
      manateeJumping = false; // done jumping
      manatee.jumpOffsetY = 0;
      // Do NOT start confetti here -- it's already running!
    }
  }
} else {
  manatee.jumpOffsetY = 0;
}
  if (celebrationActive) {
    updateConfetti();
    celebrationTimer--;
    render();
    if (celebrationTimer <= 0) {
      celebrationActive = false;
      endGame(false); // Not a time-out; we just finished the celebration
    } else {
       rafId = requestAnimationFrame(gameLoop);
    }
    return;
  }
   

   
      

  // Update bubbles
  for (const b of bubbles) {
    b.y -= b.speed;
    if (b.y + b.radius < 0) {
      b.y = GAME_HEIGHT + b.radius;
      b.x = Math.random() * (GAME_WIDTH - 30) + 15;
      b.radius = Math.random() * 12 + 8;
      b.speed = Math.random() * 0.7 + 0.3;
    }
  }

  




  // Seaweed boost timer
  if (activeSeaweedBoost) {
    seaweedBoostTimer--;
    if (seaweedBoostTimer <= 0) {
      activeSeaweedBoost = false;
      seaweedBoostTimer = 0;
    }
  }

  // Calculate speed multiplier for boost
 let speedMultiplier = activeSeaweedBoost ? SEAWEED_BOOST_AMOUNT : 1;
if (fakeTreasureSlowTimer > 0) {
  speedMultiplier *= 0.5; // cut speed in half
  fakeTreasureSlowTimer--;
}
  // MOVEMENT LOGIC (JOYSTICK OR KEYBOARD) -- uses boost!
  let moveX = 0, moveY = 0;
  if (isMobile && joystickActive) {
    moveX += MANATEE_SPEED * joystickX * speedMultiplier;
    moveY += MANATEE_SPEED * joystickY * speedMultiplier;
    if (moveX < 0) manatee.direction = -1;
    if (moveX > 0) manatee.direction = 1;
  } else {
    if (keysPressed['ArrowLeft'] || keysPressed['a']) {
      moveX -= MANATEE_SPEED * speedMultiplier;
      manatee.direction = -1;
    }
    if (keysPressed['ArrowRight'] || keysPressed['d']) {
      moveX += MANATEE_SPEED * speedMultiplier;
      manatee.direction = 1;
    }
    if (keysPressed['ArrowUp'] || keysPressed['w']) {
      moveY -= MANATEE_SPEED * speedMultiplier;
    }
    if (keysPressed['ArrowDown'] || keysPressed['s']) {
      moveY += MANATEE_SPEED * speedMultiplier;
    }
  }

  // Update floating rewards
for (let i = floatingRewards.length - 1; i >= 0; i--) {
  let reward = floatingRewards[i];
  reward.y += reward.vy; // Move up
  reward.alpha -= 0.012; // Fade out (adjust for duration)
  if (reward.alpha <= 0) floatingRewards.splice(i, 1);
}
//console.log("After update, floatingRewards:", floatingRewards);

  // Mermaid AI update
  updateMermaids();

  updateConfetti();
 
  updateMines();
  // Handle movement and collisions unless there's an explosion
  if (!explosionActive) {
    // X movement and collision
    if (moveX !== 0) {
      const tempRectX = { ...manatee, x: manatee.x + moveX };
      let collidedX = false;
      for (const wall of walls) {
        if (isColliding(tempRectX, wall)) {
          collidedX = true;
          break;
        }
      }
      if (!collidedX) manatee.x += moveX;
    }
    // Y movement and collision
    if (moveY !== 0) {
      const tempRectY = { ...manatee, y: manatee.y + moveY };
      let collidedY = false;
      for (const wall of walls) {
        if (isColliding(tempRectY, wall)) {
          collidedY = true;
          break;
        }
      }
      if (!collidedY) manatee.y += moveY;
    }
    manateeLastX = manatee.x;
    manateeLastY = manatee.y;

    // Treasure collection
   for (const t of treasures) {
  if (!t.collected && isColliding(manatee, t)) {
    t.collected = true;
    logChest(t);
    if (t.type === "fake") {
      fakeTreasureSlowTimer = 180; // 3 seconds at 60fps
      floatingRewards.push({
        x: t.x + CHEST_SIZE/2,
        y: t.y,
        value: "Slowed!",
        alpha: 1,
        vy: -1.3
      });
    } else {
      score += t.value;
      collectedTreasures += 1;
      updateScoreDisplay();
      floatingRewards.push({
        x: t.x + CHEST_SIZE/2,
        y: t.y,
        value: t.value,
        alpha: 1,
        vy: -1.3
      });
      if (collectedTreasures >= TOTAL_TREASURES) {
  manateeJumping = true;             // <-- Start jumping!
  manateeJumpFrame = 0;
  manateeJumpCount = 0;
  celebrationActive = true;
  celebrationTimer = 120;
  startConfetti();
}
    }
    break;
  }
}

    // Collectible seaweed pickup
    for (const s of collectibleSeaweeds) {
      if (!s.collected && isColliding(manatee, s)) {
        s.collected = true;
        activeSeaweedBoost = true;
        seaweedBoostTimer = SEAWEED_BOOST_DURATION;
        ASSETS.sounds.collect();
      }
    }
  } else {
    // Explosion/debris animation
    explosionTimer++;
    for (const d of debrisPieces) {
      d.x += d.vx;
      d.y += d.vy;
      d.rot += d.rotSpeed;
    }
    if (explosionTimer > 180) {
      endGame(false);
      return;
    }
  }
  // Collectible bubbles pickup (timer bonus)
for (const b of collectibleBubbles) {
  if (!b.collected && isColliding(manatee, b)) {
    b.collected = true;
    gameTimer += b.value; // Or whatever effect you want
    logBubble(b); // If you want to log the bubble collection
    floatingRewards.push({
      x: b.x + b.width/2,
      y: b.y,
      value: `+${b.value}s`,
      alpha: 1,
      vy: -1.3
    });
    // You can play a sound or animation here
  }
}
  // Update screenshake effect
if (screenshakeTimer > 0) {
  screenshakeTimer--;
  // Random offset within a circle
  let angle = Math.random() * Math.PI * 2;
  let mag = Math.random() * screenshakeMagnitude;
  screenshakeX = Math.cos(angle) * mag;
  screenshakeY = Math.sin(angle) * mag;
  // Reduce magnitude over time for smoothness
  screenshakeMagnitude *= 0.92;
} else {
  screenshakeX = 0;
  screenshakeY = 0;
}

   render();
  rafId = requestAnimationFrame(gameLoop);
}
    


    // Event listeners
    document.addEventListener('keydown', (e) => {
      keysPressed[e.key] = true;
    });
    document.addEventListener('keyup', (e) => {
      keysPressed[e.key] = false;
    });

    

    window.addEventListener('resize', () => {
  isMobile = detectMobile();
  updateViewportSize();
  render();
});
window.addEventListener('orientationchange', () => {
  isMobile = detectMobile();
  updateViewportSize();
  render();
});

    document.addEventListener('keydown', () => {
    });

// Replace the invalid declaration near the top of the file:
  
 


  // ----------- FIXED render() function -----------
  // Paste this over the render() defined inside DOMContentLoaded.
  function render() {
    // Follow world camera first
    cameraX = Math.max(0, Math.min(GAME_WIDTH - VIEWPORT_WIDTH, manatee.x + manatee.width/2 - VIEWPORT_WIDTH/2));
    cameraY = Math.max(0, Math.min(GAME_HEIGHT - VIEWPORT_HEIGHT, manatee.y + manatee.height/2 - VIEWPORT_HEIGHT/2));

    // Apply screenshake offsets
    cameraX += screenshakeX;
    cameraY += screenshakeY;

    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, VIEWPORT_HEIGHT);
    gradient.addColorStop(0, '#1a75ff');
    gradient.addColorStop(1, '#003366');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);

    // Mermaid
    drawMermaids();

    // Corals
   for (const c of corals) {
      const img = ASSETS.images.coral;
      if (img) {
        ctx.save();
        ctx.globalAlpha = 0.98;
        ctx.drawImage(img, c.x - cameraX, c.y - cameraY, c.width, c.height);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = "#cc4e5b";
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(c.x + c.width/2 - cameraX, c.y + c.height/2 - cameraY, c.width/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Background seaweeds (new) — drawn before walls
    for (const s of seaweeds) {
      const img = ASSETS.images.seaweed;
      ctx.save();
      // Slight transparency so it blends with the background
      ctx.globalAlpha = 0.33;
      if (img) {
        ctx.drawImage(img, s.x - cameraX, s.y - cameraY, s.width, s.height);
      } else {
        ctx.fillStyle = "#0b8f65";
        ctx.fillRect(s.x - cameraX, s.y - cameraY, s.width, s.height);
      }
      ctx.restore();
    }

    // Collectible seaweed with glow
    for (const s of collectibleSeaweeds) {
      if (!s.collected) {
        const img = ASSETS.images.seaweed;
        ctx.save();
        ctx.shadowColor = "#00ff88";
        ctx.shadowBlur = 35;
        if (img) {
          ctx.globalAlpha = 1;
          ctx.drawImage(img, s.x - cameraX, s.y - cameraY, s.width, s.height);
        } else {
          ctx.fillStyle = "#0e5";
          ctx.globalAlpha = 0.85;
          ctx.fillRect(s.x - cameraX, s.y - cameraY, s.width, s.height);
        }
        ctx.restore();
      }
    }

    // Walls
  // Inside your render() function:
for (const w of walls) {
  // Draw the wall background
  ctx.save();
  if (ASSETS.images.wall) {
    ctx.globalAlpha = 0.96;
    ctx.drawImage(ASSETS.images.wall, w.x - cameraX, w.y - cameraY, w.width, w.height);
  } else {
    ctx.fillStyle = '#2b3e2f';
    ctx.fillRect(w.x - cameraX, w.y - cameraY, w.width, w.height);
  }
  // Optionally, draw a gradient overlay here if you like
  ctx.restore();

  // Draw persistent decorations (shells and corals)
  if (w.decorations && Array.isArray(w.decorations)) {
    for (const deco of w.decorations) {
      if (deco.type === "shell" && ASSETS.images.shell) {
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.drawImage(
          ASSETS.images.shell,
          w.x - cameraX + deco.x,
          w.y - cameraY + deco.y,
          deco.size,
          deco.size
        );
        ctx.restore();
      }
      if (deco.type === "coral" && ASSETS.images.coral) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(
          ASSETS.images.coral,
          w.x - cameraX + deco.x,
          w.y - cameraY + deco.y,
          deco.size,
          deco.size
        );
        ctx.restore();
      }
    }
  }
}
  

    // Ambient bubbles
    for (const b of bubbles) {
      const img = ASSETS.images.bubble;
      if (img) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.drawImage(img, b.x - b.radius - cameraX, b.y - b.radius - cameraY, b.radius * 2, b.radius * 2);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x - cameraX, b.y - cameraY, b.radius, 0, 2 * Math.PI);
        ctx.fillStyle = "rgba(200,220,255,0.5)";
        ctx.fill();
        ctx.restore();
      }
    }

    // Treasures
   for (const t of treasures) {
  if (!t.collected) {
    const img = ASSETS.images.treasures[t.type];
    if (img) {
      ctx.save();
      if (t.type === "fake") {
        ctx.globalAlpha = 0.85; // slightly faded/darker
      }
      ctx.drawImage(img, t.x - cameraX, t.y - cameraY, CHEST_SIZE, CHEST_SIZE);
      ctx.globalAlpha = 1;
      ctx.restore();
    } else {
      ctx.save();
      ctx.fillStyle = t.type === "fake" ? "#bfa404" : "gold"; // use a darker color
      ctx.fillRect(t.x - cameraX, t.y - cameraY, CHEST_SIZE, CHEST_SIZE);
      ctx.restore();
    }
  }
}

    // Collectible bubbles (timer bonus)
    for (const b of collectibleBubbles) {
      if (!b.collected) {
        const img = ASSETS.images.bubble;
        ctx.save();
        ctx.globalAlpha = 0.9;
        if (img) {
          ctx.drawImage(img, b.x - cameraX, b.y - cameraY, b.width, b.height);
        } else {
          ctx.beginPath();
          ctx.arc(b.x + b.width/2 - cameraX, b.y + b.height/2 - cameraY, b.width/2, 0, Math.PI*2);
          ctx.fillStyle = "#aef";
          ctx.fill();
        }
        ctx.font = "bold 20px Arial";
        ctx.fillStyle = "#234";
        ctx.textAlign = "center";
        ctx.fillText(`+${b.value}s`, b.x + b.width/2 - cameraX, b.y + b.height/2 + 8 - cameraY);
        ctx.restore();
      }
    }

    // Mines
    for (const mine of mines) {
      const img = ASSETS.images.mine;
      ctx.save();
      if (img) {
        ctx.globalAlpha = 1;
        ctx.drawImage(img, mine.x - cameraX, mine.y - cameraY, mine.width, mine.height);
      } else {
        ctx.fillStyle = "darkred";
        ctx.beginPath();
        ctx.arc(mine.x + mine.width/2 - cameraX, mine.y + mine.height/2 - cameraY, mine.width/2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Manatee or explosion
    // Inside render(), where you draw the manatee
if (explosionActive) {
  drawExplosionAndDebris();
} else {
  const manateeImage = ASSETS.images.manatee;
  ctx.save();
  ctx.translate(
    manatee.x + manatee.width / 2 - cameraX,
    manatee.y + manatee.height / 2 - cameraY + (manatee.jumpOffsetY || 0)
  );
  if (manatee.direction === -1) ctx.scale(-1, 1);
   if (activeSeaweedBoost) {
    ctx.shadowColor = "#00ff88";
    ctx.shadowBlur = 25;
  } else {
    ctx.shadowBlur = 0;
  }
  if (manateeImage instanceof Image && manateeImage.complete) {
    ctx.drawImage(manateeImage, -manatee.width / 2, -manatee.height / 2, manatee.width, manatee.height);
  } else {
    ctx.fillStyle = "gray";
    ctx.fillRect(-manatee.width / 2, -manatee.height / 2, manatee.width, manatee.height);
  }
  ctx.restore();
}
    // Floating reward texts
    for (const reward of floatingRewards) {
      ctx.save();
      ctx.globalAlpha = reward.alpha;
      ctx.font = "bold 32px Arial";
      ctx.fillStyle = "#ffd700";
      ctx.strokeStyle = "#8B7500";
      ctx.lineWidth = 2;
      ctx.textAlign = "center";
      ctx.strokeText(`${reward.value}`, reward.x - cameraX, reward.y - cameraY - 20);
      ctx.fillText(`${reward.value}`, reward.x - cameraX, reward.y - cameraY - 20);
      ctx.restore();
    }

    // Minimap
    drawMinimap();

    // Pre-game countdown overlay (dim the scene)
    if (!gameActive && (preGameCountdown > 0 || preGameState === "start")) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      ctx.globalAlpha = 1;
      ctx.font = "bold 120px Arial";
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      if (preGameState === "start") {
        ctx.fillText("Start!", VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
      } else {
        ctx.fillText(preGameCountdown, VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
      }
      ctx.restore();
    }

    // IMPORTANT: draw confetti LAST so it's always on top of the scene and overlays
    // Uses captured confettiCameraX/Y for stable screen-space confetti
    drawConfetti();
  }

  // ----------- END FIXED render() function -----------
  })})
