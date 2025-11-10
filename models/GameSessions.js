const mongoose = require('mongoose');

const ChestLogSchema = new mongoose.Schema({
  time: Number,
  x: Number,
  y: Number,
  value: Number,
  type: String
}, {_id: false});

const BubbleLogSchema = new mongoose.Schema({
  time: Number,
  x: Number,
  y: Number,
  value: Number
}, {_id: false});

const GameSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  startTime: Date,
  endTime: Date,
  elapsedSeconds: Number,
  chestsCollected: Number,
  chestLog: [ChestLogSchema],
  bubblesCollected: Number,
  bubbleLog: [BubbleLogSchema],
  difficulty: { type: String, default: 'normal' },
  totalChests: { type: Number, default: 20 },
  mineDeaths: Number,
  score: { type: Number, default: 0 },              // <-- already present
  seaweedsCollected: { type: Number, default: 0 },  // <-- already present
  isWin: {
    type: Boolean,
    default: false
  },
  deviceType: {
    type: String,
    enum: ['mobile', 'desktop', 'unknown'],
    default: 'unknown'
  },
  endedEarly: {
    type: Boolean,
    default: false
  },

  // Add cost so /api/start can store how many credits were deducted
  // and /api/end can refund the correct amount for short (grace) sessions.
  cost: { type: Number, default: 0 },

  // NEW: idempotency / refund guard so refunds can't be applied twice
  refunded: { type: Boolean, default: false },
  refundedAt: { type: Date, default: null }
}, {timestamps: true});

// Optional index to speed up "claim refund" queries and checks
GameSessionSchema.index({ refunded: 1 });

module.exports = mongoose.model('GameSession', GameSessionSchema);