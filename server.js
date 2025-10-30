/**
 * server.js
 *
 * Full ready-to-commit server file.
 *
 * - Environment-driven allowed origins (FRONTEND_ORIGINS / FRONTEND_URL / VERCEL_URL)
 * - app.set('trust proxy', true)
 * - CORS configured and friendly CORS error responses
 * - Logging middleware for incoming requests
 * - Auth helpers (JWT)
 * - All API routes (login, register, register-admin, start, chest, bubble, mineDeath, end, leaderboard, sessions, users, admins, feedback, game-config, reset-password, health, etc.)
 * - Robust MongoDB connection startup: mongoose.connect called with serverSelectionTimeoutMS and Express starts only after DB connects
 *
 * NOTE: set these environment variables in Render (or your host):
 * - MONGODB_URI
 * - JWT_SECRET
 * - FRONTEND_URL (or FRONTEND_ORIGINS comma-separated)
 *
 * Commit and deploy this to your backend repo, then verify:
 * - Render logs show "Connected to MongoDB" and "Backend listening on port ..."
 * - Your frontend's vercel.json rewrites /api/* to the Render URL OR you set FRONTEND_URL in Render if calling backend cross-origin.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const User = require('./models/User');
const GameSession = require('./models/GameSessions');
const Feedback = require('./models/Feedback');

const jwt = require('jsonwebtoken');

const app = express();

// Helper: get most recent GMT+8 midnight (as a UTC Date object)
function getCreditResetDate() {
  const now = new Date();
  const offsetMs = 8 * 3600 * 1000; // GMT+8
  const nowGmt8 = new Date(now.getTime() + offsetMs);
  const y = nowGmt8.getUTCFullYear();
  const m = nowGmt8.getUTCMonth();
  const d = nowGmt8.getUTCDate();
  const midnightGmt8UtcMs = Date.UTC(y, m, d, 0, 0, 0) - offsetMs;
  return new Date(midnightGmt8UtcMs);
}

const DIFFICULTY_CREDIT_COST = { easy: 100, normal: 150, hard: 250 };

// trust proxies (Vercel/Render)
app.set('trust proxy', true);

// Build allowedOrigins from environment
const envOrigins = [];
if (process.env.FRONTEND_ORIGINS) {
  process.env.FRONTEND_ORIGINS.split(',').forEach(s => {
    const t = s && s.trim();
    if (t) envOrigins.push(t);
  });
}
if (process.env.FRONTEND_URL) envOrigins.push(process.env.FRONTEND_URL.trim());
if (process.env.VERCEL_URL) {
  const v = process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`;
  envOrigins.push(v);
}

const defaultAllowed = [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://localhost:3001',
  'http://192.168.0.105:8080',
  'http://192.168.0.114:8080',
  'https://manateetreasurehunt.vercel.app'
];

const allowedOrigins = Array.from(new Set([...(envOrigins || []), ...defaultAllowed]));

const normalizeOrigin = (origin) => {
  if (!origin) return origin;
  try {
    const u = new URL(origin);
    let hostname = u.hostname;
    if (hostname === '::1') hostname = 'localhost';
    return `${u.protocol}//${hostname}${u.port ? ':' + u.port : ''}`;
  } catch (err) {
    if (!origin.includes('://') && !origin.startsWith('http')) {
      return `https://${origin}`;
    }
    return origin;
  }
};

app.use((req, res, next) => {
  if (req.headers.origin) console.debug('CORS request from (raw):', req.headers.origin);
  next();
});

app.use(cors({
  origin: function(origin, callback) {
    // allow server-to-server (no origin) and allowed frontends
    if (!origin) return callback(null, true);
    const normalized = normalizeOrigin(origin);
    const normalizedAllowed = allowedOrigins.map(o => normalizeOrigin(o));
    if (normalizedAllowed.includes(normalized)) return callback(null, true);
    console.log('Blocked origin:', origin, 'normalized as:', normalized);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Dry-Run',
    'X-Requested-With'
  ],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
}));
app.options('*', cors());

app.use(function (err, req, res, next) {
  if (!err) return next();
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS error: Not allowed by CORS', origin: req.headers.origin });
  }
  console.error('Express error:', err);
  next(err);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using default JWT secret. Set process.env.JWT_SECRET in production.');
}

// simple logging middleware
app.use((req, res, next) => {
  console.debug(`[INCOMING] ${req.method} ${req.originalUrl} from ${req.headers.origin || req.ip}`);
  next();
});

// auth helpers
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalid" });
  }
}
function adminOnly(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Admin access required" });
  next();
}

app.get('/dashboard', authMiddleware, adminOnly, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// basic helpers
async function maybeResetCredits(user) {
  const resetDate = getCreditResetDate();
  if (!user.lastCreditReset || user.lastCreditReset < resetDate) {
    user.credits = 1000;
    user.lastCreditReset = resetDate;
    await user.save();
  }
}

// in-memory bootstrap limiter
const bootstrapAttempts = new Map();
function checkBootstrapRateLimit(ip, maxAttempts = 10, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const rec = bootstrapAttempts.get(ip);
  if (!rec) {
    bootstrapAttempts.set(ip, { count: 1, firstTs: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (now - rec.firstTs > windowMs) {
    bootstrapAttempts.set(ip, { count: 1, firstTs: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (rec.count >= maxAttempts) return { allowed: false, remaining: 0 };
  rec.count++;
  bootstrapAttempts.set(ip, rec);
  return { allowed: true, remaining: maxAttempts - rec.count };
}

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: process.env.NODE_ENV || 'development' });
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ ok: false, error: 'User not found' });

    await maybeResetCredits(user);

    const passwordOk = typeof user.comparePassword === 'function'
      ? await user.comparePassword(password)
      : (user.password === password);

    if (!passwordOk) return res.status(401).json({ ok: false, error: 'Wrong password' });

    const payload = { email: user.email, isAdmin: user.isAdmin, id: user._id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    return res.json({
      ok: true,
      token,
      email: user.email,
      isAdmin: user.isAdmin,
      id: user._id,
      credits: user.credits
    });
  } catch (err) {
    console.error('/api/login error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required" });
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ ok: false, error: "Email already registered" });
    const user = new User({
      email,
      password,
      isAdmin: false,
      credits: 1000,
      lastCreditReset: getCreditResetDate()
    });
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/register error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Register-admin (bootstrap)
app.post('/api/register-admin',
  async (req, res, next) => {
    try {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount === 0) {
        const ip = (req.ip || req.connection.remoteAddress || 'unknown').toString();
        const rate = checkBootstrapRateLimit(ip, 10, 60 * 60 * 1000);
        if (!rate.allowed) return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });

        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required to create the first admin" });

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ ok: false, error: "Email already registered" });

        const user = new User({
          email,
          password,
          isAdmin: true,
          credits: 1000,
          lastCreditReset: getCreditResetDate()
        });
        await user.save();
        bootstrapAttempts.clear();
        console.log('First admin created (bootstrap):', user.email);
        return res.json({ ok: true, firstAdmin: true, id: user._id, email: user.email });
      }
      return next();
    } catch (err) {
      console.error('Error in /api/register-admin bootstrap handler:', err);
      return res.status(500).json({ ok: false, error: 'Server error while checking admin count' });
    }
  },
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ ok: false, error: "Email and password required" });
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ ok: false, error: "Email already registered" });
      const user = new User({
        email,
        password,
        isAdmin: true,
        credits: 1000,
        lastCreditReset: getCreditResetDate()
      });
      await user.save();
      res.json({ ok: true, id: user._id, email: user.email });
    } catch (err) {
      console.error('/api/register-admin error:', err);
      res.status(500).json({ ok: false, error: 'Failed to create admin' });
    }
  }
);

// /api/start (dry-run and real)
app.post('/api/start', async (req, res) => {
  const isDryRun = req.headers['x-dry-run'] === '1' || req.query.dryRun === '1';
  let { email, difficulty } = req.body || {};
  difficulty = difficulty || 'normal';

  try {
    let user = null;
    if (email) {
      user = await User.findOne({ email });
      if (!user) return res.status(400).json({ ok: false, error: 'User not found' });
      await maybeResetCredits(user);
    }

    const cost = DIFFICULTY_CREDIT_COST[difficulty] || 10;
    if (user && user.credits < cost) {
      const nextReset = getCreditResetDate();
      nextReset.setDate(nextReset.getDate() + 1);
      return res.status(403).json({
        ok: false,
        error: `Not enough credits. Credits will refill at ${nextReset.toLocaleString('en-US', { timeZone: 'Asia/Singapore' })}`,
        credits: user.credits,
        refillTime: nextReset
      });
    }

    if (isDryRun) {
      return res.json({ ok: true, dryRun: true, credits: user ? user.credits : 0, cost });
    }

    if (user) {
      const recent = await GameSession.findOne({
        user: user._id,
        startTime: { $gte: new Date(Date.now() - 5000) } // 5s
      }).sort({ startTime: -1 }).lean();
      if (recent) {
        const freshUser = await User.findById(user._id).lean();
        return res.json({ ok: true, sessionId: recent._id, credits: freshUser ? freshUser.credits : user.credits });
      }
    }

    let totalChests = 20;
    try {
      const configs = require('./gameConfig');
      if (configs[difficulty] && typeof configs[difficulty].totalTreasures === 'number') {
        totalChests = configs[difficulty].totalTreasures;
      }
    } catch (e) { /* ignore */ }

    // Try transaction if possible
    let mongoSession;
    try { mongoSession = await mongoose.startSession(); } catch (e) { mongoSession = null; }

    if (mongoSession) {
      let createdSession = null;
      try {
        mongoSession.startTransaction();

        const gs = new GameSession({
          user: user ? user._id : undefined,
          startTime: new Date(),
          endTime: null,
          elapsedSeconds: 0,
          chestsCollected: 0,
          chestLog: [],
          bubblesCollected: 0,
          bubbleLog: [],
          mineDeaths: 0,
          deviceType: req.headers['user-agent'] ? (req.headers['user-agent'].includes('Mobile') ? 'mobile' : 'desktop') : 'unknown',
          difficulty,
          totalChests,
          cost
        });

        createdSession = await gs.save({ session: mongoSession });

        if (user) {
          const userDoc = await User.findById(user._id).session(mongoSession);
          if (!userDoc) throw new Error('User disappeared during transaction');
          userDoc.credits = Math.max(0, (userDoc.credits || 0) - cost);
          await userDoc.save({ session: mongoSession });
        }

        await mongoSession.commitTransaction();
        mongoSession.endSession();

        const updatedUser = user ? await User.findById(user._id).lean() : null;
        return res.json({ ok: true, sessionId: createdSession._id, credits: updatedUser ? updatedUser.credits : 0 });
      } catch (txErr) {
        try { await mongoSession.abortTransaction(); } catch (e) {}
        try { mongoSession.endSession(); } catch (e) {}
        console.error('/api/start transaction error:', txErr);
        return res.status(500).json({ ok: false, error: 'Failed to start session (transient). Please try again.' });
      }
    } else {
      // fallback
      let createdSession = null;
      try {
        const gs = new GameSession({
          user: user ? user._1 : undefined,
          startTime: new Date(),
          endTime: null,
          elapsedSeconds: 0,
          chestsCollected: 0,
          chestLog: [],
          bubblesCollected: 0,
          bubbleLog: [],
          mineDeaths: 0,
          deviceType: req.headers['user-agent'] ? (req.headers['user-agent'].includes('Mobile') ? 'mobile' : 'desktop') : 'unknown',
          difficulty,
          totalChests,
          cost
        });
        createdSession = await gs.save();

        if (user) {
          const userDoc = await User.findById(user._id);
          if (!userDoc) throw new Error('User disappeared during credit update');
          userDoc.credits = Math.max(0, (userDoc.credits || 0) - cost);
          await userDoc.save();
        }

        const updatedUser = user ? await User.findById(user._id).lean() : null;
        return res.json({ ok: true, sessionId: createdSession._id, credits: updatedUser ? updatedUser.credits : 0 });
      } catch (err) {
        console.error('/api/start fallback error:', err);
        if (createdSession) {
          try { await GameSession.deleteOne({ _id: createdSession._id }); } catch (delErr) { console.error('Failed to delete session after credit-update error:', delErr); }
        }
        return res.status(500).json({ ok: false, error: 'Failed to start session. Please try again.' });
      }
    }

  } catch (err) {
    console.error('/api/start error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// Chest/bubble/mineDeath/end handlers
app.post('/api/chest', async (req, res) => {
  try {
    const { sessionId, type } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'No session ID provided' });
    const session = await GameSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (type !== 'fake') session.chestsCollected += 1;
    session.chestLog.push({ time: Math.floor((Date.now() - session.startTime.getTime()) / 1000), ...req.body });
    await session.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/chest error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/bubble', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'No session ID provided' });
    const session = await GameSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.bubblesCollected += 1;
    session.bubbleLog.push({ time: Math.floor((Date.now() - session.startTime.getTime()) / 1000), ...req.body });
    await session.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/bubble error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/mineDeath', async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'No session ID provided' });
    const session = await GameSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    session.mineDeaths += 1;
    await session.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/mineDeath error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/end', async (req, res) => {
  try {
    const { sessionId, endedEarly = false, score, seaweedsCollected, grace = false } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'No sessionId provided' });

    const session = await GameSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const now = new Date();
    const startTime = session.startTime || now;
    const elapsedSeconds = Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000);

    const GRACE_SECONDS = 5;
    if (grace || elapsedSeconds < GRACE_SECONDS) {
      if (session.user && typeof session.cost === 'number' && session.cost > 0) {
        try {
          const userDoc = await User.findById(session.user);
          if (userDoc) {
            userDoc.credits = (userDoc.credits || 0) + session.cost;
            await userDoc.save();
            try { await GameSession.deleteOne({ _id: sessionId }); } catch (delErr) { console.warn('/api/end delete short session error', delErr); }
            const updatedUser = await User.findById(session.user).lean();
            return res.json({ ok: true, refunded: true, message: 'Session ended within grace window and was not recorded.', credits: updatedUser ? updatedUser.credits : (userDoc.credits || 0) });
          }
        } catch (refundErr) {
          console.error('/api/end refund error', refundErr);
          try { await GameSession.deleteOne({ _id: sessionId }); } catch (delErr) { console.warn('/api/end delete after refund error', delErr); }
          return res.json({ ok: true, refunded: false, message: 'Session removed but refund failed.' });
        }
      } else {
        try { await GameSession.deleteOne({ _id: sessionId }); } catch (delErr) { console.warn('/api/end delete (no user/cost) error', delErr); }
        return res.json({ ok: true, refunded: false, message: 'Session ended quickly and was removed (no refund).' });
      }
    }

    session.endTime = now;
    session.elapsedSeconds = elapsedSeconds;
    session.endedEarly = !!endedEarly;
    if (typeof score !== 'undefined') session.score = score;
    if (typeof seaweedsCollected !== 'undefined') session.seaweedsCollected = seaweedsCollected;
    session.isWin = (!session.endedEarly && session.chestsCollected >= session.totalChests);
    await session.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('/api/end error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin and listing routes
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    let query = {};
    if (req.query.email) query.email = { $regex: req.query.email, $options: 'i' };
    const users = await User.find({ ...query, isAdmin: false });

    const userIds = users.map(u => u._id);
    const stats = await GameSession.aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", playCount: { $sum: 1 }, totalDeaths: { $sum: "$mineDeaths" }, totalTimePlayed: { $sum: "$elapsedSeconds" } } }
    ]);
    const userStats = {};
    stats.forEach(stat => { userStats[stat._id.toString()] = stat; });

    const result = users.map(u => {
      const stat = userStats[u._id.toString()] || { playCount: 0, totalDeaths: 0, totalTimePlayed: 0 };
      return { ...u.toObject(), playCount: stat.playCount, totalDeaths: stat.totalDeaths, totalTimePlayed: stat.totalTimePlayed };
    });
    res.json(result);
  } catch (err) {
    console.error('/api/users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/admins', authMiddleware, adminOnly, async (req, res) => {
  try {
    const admins = await User.find({ isAdmin: true });
    res.json(admins);
  } catch (err) {
    console.error('/api/admins', err);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

app.delete('/api/admins/:id', authMiddleware, adminOnly, async (req, res) => {
  const adminId = req.params.id;
  if (req.user.id === adminId) return res.status(400).json({ ok: false, error: "You cannot delete your own admin account." });
  try { await User.deleteOne({ _id: adminId, isAdmin: true }); res.json({ ok: true }); }
  catch (err) { console.error('/api/admins delete', err); res.status(500).json({ error: 'Failed to delete admin account' }); }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const userId = req.params.id;
  try {
    await User.deleteOne({ _id: userId });
    await GameSession.deleteMany({ user: userId });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/users/:id delete', err);
    res.status(500).json({ error: 'Failed to delete user and related sessions' });
  }
});

app.get('/api/sessions', authMiddleware, adminOnly, async (req, res) => {
  try {
    const sessions = await GameSession.find().populate('user', 'email playCount totalDeaths totalTimePlayed').sort({ startTime: -1 });
    res.json(sessions);
  } catch (err) {
    console.error('/api/sessions', err);
    res.status(500).json({ error: 'Failed to fetch game sessions' });
  }
});

app.delete('/api/sessions/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const sessionId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) return res.status(400).json({ error: 'Invalid session ID format' });
    const result = await GameSession.deleteOne({ _id: sessionId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/sessions/:id delete', err);
    res.status(500).json({ error: 'Failed to delete session', details: err.message });
  }
});

app.delete('/api/sessions', authMiddleware, adminOnly, async (req, res) => {
  try {
    await GameSession.deleteMany({});
    await User.updateMany({ isAdmin: false }, { $set: { playCount: 0, totalDeaths: 0, totalTimePlayed: 0 } });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/sessions delete all', err);
    res.status(500).json({ error: 'Failed to delete all game sessions' });
  }
});

// Game config endpoints
app.get('/api/game-config', async (req, res) => {
  try {
    const difficulty = req.query.difficulty || 'normal';
    const configs = require('./gameConfig');
    if (!configs[difficulty]) {
      return res.json({ mazePattern: [], totalTreasures: 0, totalSeaweeds: 0, totalBubbles: 0, totalMines: 0, gameTimeSeconds: 0, totalFakeChests: 0 });
    }
    res.json(configs[difficulty]);
  } catch (err) {
    console.error('/api/game-config', err);
    res.status(500).json({ error: 'Failed to load game config', details: err.message });
  }
});

app.put('/api/game-config', authMiddleware, adminOnly, async (req, res) => {
  try {
    const difficulty = req.query.difficulty || 'normal';
    const cfg = req.body;
    let configs;
    try { configs = require('./gameConfig'); } catch (e) { configs = { easy: {}, normal: {}, hard: {} }; }
    configs[difficulty] = cfg;
    const js = `module.exports = ${JSON.stringify(configs, null, 2)};\n`;
    fs.writeFile(gameConfigPath, js, err => {
      if (err) return res.status(500).json({ error: 'Failed to save config' });
      delete require.cache[require.resolve('./gameConfig')];
      res.json({ ok: true });
    });
  } catch (err) {
    console.error('/api/game-config PUT', err);
    res.status(500).json({ error: 'Failed to save game config' });
  }
});

// Leaderboard (requires auth)
app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try {
    const difficulties = ['easy', 'normal', 'hard'];
    let leaderboard = {};
    for (const diff of difficulties) {
      const sessions = await GameSession.aggregate([
        { $match: { isWin: true, endedEarly: { $ne: true }, difficulty: diff, user: { $ne: null } } },
        { $sort: { elapsedSeconds: 1, seaweedsCollected: -1, score: -1 } },
        { $group: { _id: "$user", sessionId: { $first: "$_id" }, user: { $first: "$user" }, elapsedSeconds: { $first: "$elapsedSeconds" }, seaweedsCollected: { $first: "$seaweedsCollected" }, score: { $first: "$score" } } },
        { $sort: { elapsedSeconds: 1, seaweedsCollected: -1, score: -1 } }
      ]);
      const populated = await GameSession.populate(sessions, { path: "user", select: "email" });
      leaderboard[diff] = populated;
    }
    res.json(leaderboard);
  } catch (err) {
    console.error('/api/leaderboard', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Feedback endpoints
app.post('/api/feedback', authMiddleware, async (req, res) => {
  try {
    const { rating, text } = req.body || {};
    if (!rating || !text) return res.status(400).json({ ok: false, error: 'Rating and text required.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(400).json({ ok: false, error: 'User not found.' });
    const fb = new Feedback({ user: user._id, email: user.email, rating, text });
    await fb.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/feedback', err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

app.get('/api/feedbacks', authMiddleware, adminOnly, async (req, res) => {
  try {
    const feedbacks = await Feedback.find({}).sort({ date: -1 });
    res.json(feedbacks);
  } catch (err) {
    console.error('/api/feedbacks', err);
    res.status(500).json({ error: 'Failed to fetch feedbacks' });
  }
});

app.post('/api/feedbacks/:id/reply', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { reply } = req.body || {};
    await Feedback.findByIdAndUpdate(req.params.id, { adminReply: reply, adminReplyDate: new Date() });
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/feedbacks reply', err);
    res.status(500).json({ error: 'Failed to reply to feedback' });
  }
});

app.delete('/api/feedbacks/:id', authMiddleware, adminOnly, async (req, res) => {
  try { await Feedback.findByIdAndDelete(req.params.id); res.json({ ok: true }); }
  catch (err) { console.error('/api/feedbacks delete', err); res.status(500).json({ ok: false, error: 'Failed to delete feedback.' }); }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    if (!email || !newPassword) return res.status(400).json({ ok: false, error: "Email and new password required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: "No user with that email" });
    user.password = newPassword;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error('/api/reset-password', err);
    res.status(500).json({ ok: false, error: 'Failed to reset password' });
  }
});

// My sessions
app.get('/api/my-sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await GameSession.find({ user: req.user.id }).populate('user', 'email').sort({ startTime: -1 }).lean();
    res.json(sessions);
  } catch (err) {
    console.error('/api/my-sessions', err);
    res.status(500).json({ error: 'Failed to load user sessions' });
  }
});

// Register-allowed
app.get('/api/register-allowed', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ isAdmin: true });
    res.json({ allowed: adminCount === 0 });
  } catch (err) {
    console.error('/api/register-allowed', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Root
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Treasure Hunt API' });
});

// ---------------------------
// MongoDB connection & start
// ---------------------------
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000, // fail fast
  socketTimeoutMS: 45000
};

async function startApp() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is not set. Please set it in environment variables.');
    process.exit(1);
  }

  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(mongoUri, mongooseOptions);
    console.log('Connected to MongoDB');

    mongoose.connection.on('error', (err) => {
      console.error('Mongoose connection error:', err);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('Mongoose disconnected');
    });

    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      console.log(`Backend listening on port ${PORT}`);
      if (process.env.RENDER_EXTERNAL_HOSTNAME) console.log(`Render external hostname: ${process.env.RENDER_EXTERNAL_HOSTNAME}`);
      if (process.env.FRONTEND_URL) console.log(`Configured FRONTEND_URL: ${process.env.FRONTEND_URL}`);
      else if (process.env.FRONTEND_ORIGINS) console.log(`Configured FRONTEND_ORIGINS: ${process.env.FRONTEND_ORIGINS}`);
      else console.log('Allowed origins (computed):', allowedOrigins);
    });

  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

startApp();