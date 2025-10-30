// gameBackend.js

const gameSession = {
  startTime: null,
  endTime: null,
  elapsedSeconds: 0,
  chestsCollected: 0,
  chestLog: [],
  bubblesCollected: 0,
  bubbleLog: [],
  mineDeaths: 0,
};

function startGame() {
  gameSession.startTime = Date.now();
  gameSession.endTime = null;
  gameSession.elapsedSeconds = 0;
  gameSession.chestsCollected = 0;
  gameSession.chestLog = [];
  gameSession.bubblesCollected = 0;
  gameSession.bubbleLog = [];
  gameSession.mineDeaths = 0;
}

function recordChest({x, y, value, type}) {
  const now = Date.now();
  gameSession.chestsCollected += 1;
  gameSession.chestLog.push({
    time: Math.floor((now - gameSession.startTime) / 1000),
    x, y, value, type
  });
}

function recordBubble({x, y, value}) {
  const now = Date.now();
  gameSession.bubblesCollected += 1;
  gameSession.bubbleLog.push({
    time: Math.floor((now - gameSession.startTime) / 1000),
    x, y, value
  });
}

function recordMineDeath() {
  gameSession.mineDeaths += 1;
}

function endGame() {
  gameSession.endTime = Date.now();
  gameSession.elapsedSeconds = Math.floor((gameSession.endTime - gameSession.startTime) / 1000);
}

function getReport() {
  return {...gameSession};
}

module.exports = {
  startGame,
  recordChest,
  recordBubble,
  recordMineDeath,
  endGame,
  getReport,
};

