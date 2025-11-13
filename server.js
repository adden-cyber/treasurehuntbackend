/**
 * server.js
 *
 * Ready-to-commit patch: environment-driven allowed origins, trust proxy,
 * health endpoint, and process.env.PORT listen.
 *
 * - Reads FRONTEND_ORIGINS / FRONTEND_URL / VERCEL_URL from env to build allowedOrigins.
 * - Keeps sensible local defaults for development.
 * - Uses app.set('trust proxy', true) for reverse proxies.
 * - Adds /api/health.
 * - Uses process.env.PORT for listen and prints helpful startup info.
 *
 * Add these env vars in Render (or your host):
 * - MONGODB_URI
 * - JWT_SECRET
 * - FRONTEND_URL (e.g. https://your-frontend.vercel.app) or FRONTEND_ORIGINS (comma-separated)
 *
 * The rest of your original routes are preserved.
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const User = require('./models/User');
require('dotenv').config();
const GameSession = require('./models/GameSessions');
const Feedback = require('./models/Feedback');
const jwt = require('jsonwebtoken'); // JWT lib
const cookieParser = require('cookie-parser');

// Helper: get most recent GMT+8 midnight (as a UTC Date object)
function getCreditResetDate() {
  // now in ms
  const now = new Date();
  const offsetMs = 8 * 3600 * 1000; // GMT+8
  // represent "now" in GMT+8 by shifting ms
  const nowGmt8 = new Date(now.getTime() + offsetMs);
  const y = nowGmt8.getUTCFullYear();
  const m = nowGmt8.getUTCMonth();
  const d = nowGmt8.getUTCDate();
  // midnight for that GMT+8 date in UTC ms is Date.UTC(y,m,d,0,0,0) - offsetMs
  const midnightGmt8UtcMs = Date.UTC(y, m, d, 0, 0, 0) - offsetMs;
  return new Date(midnightGmt8UtcMs);
}

const DIFFICULTY_CREDIT_COST = { easy: 100, normal: 150, hard: 250 };

// Helper: reset credits if needed
async function maybeResetCredits(user) {
  try {
    const resetDate = getCreditResetDate();
    const lastReset = user && user.lastCreditReset ? new Date(user.lastCreditReset) : null;
    if (!lastReset || lastReset.getTime() < resetDate.getTime()) {
      user.credits = 1000; // increased starting credits
      user.lastCreditReset = resetDate;
      await user.save();
    }
  } catch (e) {
    console.warn('[maybeResetCredits] failed for user', user && user.email, e);
  }
}

const gameConfigPath = path.join(__dirname, 'gameConfig.js');
const app = express();

// Trust reverse proxies (Vercel, Render). This ensures req.ip and secure cookies behave correctly.
app.set('trust proxy', true);

app.use(cookieParser());

// Build allowedOrigins from environment (FRONTEND_ORIGINS CSV or FRONTEND_URL or VERCEL_URL) with sensible defaults.
const envOrigins = [];
if (process.env.FRONTEND_ORIGINS) {
  process.env.FRONTEND_ORIGINS.split(',').forEach(s => {
    const t = s && s.trim();
    if (t) envOrigins.push(t);
  });
}
if (process.env.FRONTEND_URL) envOrigins.push(process.env.FRONTEND_URL.trim());
if (process.env.VERCEL_URL) {
  // Vercel sets VERCEL_URL without protocol (e.g. project.vercel.app) — prefer https
  const v = process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`;
  envOrigins.push(v);
}

// default allowed origins (useful for local dev)
const defaultAllowed = [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://localhost:3001',
  'http://192.168.0.105:8080',
  'http://192.168.0.114:8080',
  'https://manateetreasurehunt.vercel.app' // keep as helpful default, safe to include
];

// Final allowed origins list (env first, then defaults)
const allowedOrigins = Array.from(new Set([...(envOrigins || []), ...defaultAllowed]));

// Helper to normalize origin for matching
const normalizeOrigin = (origin) => {
  if (!origin) return origin;
  try {
    const u = new URL(origin);
    let hostname = u.hostname;
    if (hostname === '::1') hostname = 'localhost';
    return `${u.protocol}//${hostname}${u.port ? ':' + u.port : ''}`;
  } catch (err) {
    // origin might be "project.vercel.app" — try to normalize simple host (no protocol)
    if (!origin.includes('://') && !origin.startsWith('http')) {
      return `https://${origin}`;
    }
    return origin;
  }
};

app.use((req, res, next) => {
  // Quick debug so you can see what the server actually receives
  if (req.headers.origin) console.log('CORS request from (raw):', req.headers.origin);
  next();
});

app.use(cors({
  origin: function(origin, callback) {
    // Allow server-to-server requests that have no origin header (e.g., Vercel server-side proxy, curl)
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
    'X-Dry-Run',        // <-- allow the dry-run header
    'X-Requested-With'
  ],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
}));
// Handle preflights (explicitly ensure same cors config used)
app.options('*', cors());



app.use(express.json({ limit: '128kb' }));
app.use(express.static(path.join(__dirname, 'public')));


// Use centralized JWT secret var
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using default JWT secret. Set process.env.JWT_SECRET in production for security.');
}

// --- auth helpers ---
function authMiddleware(req, res, next) {
  // Try Authorization header first
  const authHeader = req.headers.authorization || '';
  let token = authHeader.split(' ')[1];

  // Fallback: token provided in cookie (useful for browser navigation)
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

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
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

app.get('/dashboard', authMiddleware, adminOnly, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Simple in-memory rate limiter for bootstrap admin creation to reduce abuse.
const bootstrapAttempts = new Map(); // key: ip, value: { count, firstTs }

function checkBootstrapRateLimit(ip, maxAttempts = 10, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const rec = bootstrapAttempts.get(ip);
  if (!rec) {
    bootstrapAttempts.set(ip, { count: 1, firstTs: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (now - rec.firstTs > windowMs) {
    // reset window
    bootstrapAttempts.set(ip, { count: 1, firstTs: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (rec.count >= maxAttempts) {
    return { allowed: false, remaining: 0 };
  }
  rec.count++;
  bootstrapAttempts.set(ip, rec);
  return { allowed: true, remaining: maxAttempts - rec.count };
}

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: process.env.NODE_ENV || 'development' });
});

// Replace the /api/login handler in server.js with this corrected version:
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ ok: false, error: 'User not found' });
    }

    // Ensure daily credits reset is applied for this user
    await maybeResetCredits(user);

    // Verify password (assumes User model has comparePassword implemented using bcrypt)
    const passwordOk = typeof user.comparePassword === 'function'
      ? await user.comparePassword(password)
      : (user.password === password); // fallback (not recommended if passwords are hashed)

    if (!passwordOk) {
      return res.status(401).json({ ok: false, error: 'Wrong password' });
    }

    // Generate JWT token
        // Generate JWT token
        const payload = { email: user.email, isAdmin: user.isAdmin, id: user._id };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
    
        // Set token as a secure httpOnly cookie so browser can automatically send it
        // For local/dev, secure: false (since local is usually http). In production use secure: true.
        res.cookie('token', token, {
          httpOnly: true,
          secure: (process.env.NODE_ENV === 'production'), // true in prod (required for SameSite=None)
          sameSite: (process.env.NODE_ENV === 'production') ? 'none' : 'lax', // allow cross-site cookies in production
          maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });
    
        // Respond with token and user info (and still return the token in JSON if API clients need it)
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

// Example /api/register (replace/ensure your current one does similar checks)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ ok: false, error: "Email already registered" });
    }

    // create as non-admin explicitly
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
    res.status(500).json({ ok: false, error: 'Failed to register' });
  }
});

// Create admin (bootstrap first admin without auth, otherwise require admin auth)
// Replace your existing /api/register-admin route with the following:

app.post('/api/register-admin',

  // first handler: allow creating the very first admin without authentication
  async (req, res, next) => {
    try {

      //NOTE: removed debug logging of request body to avoid leaking sensitive data

      // Sanity: require email/password
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: "Email and password required" });
      }

      // Count existing admins
      const adminCount = await User.countDocuments({ isAdmin: true });

      // If there are no admins, allow unauthenticated creation of the first admin
      if (adminCount === 0) {
        // Rate-limit bootstrap attempts by IP to reduce abuse
        const ip = (req.ip || req.connection.remoteAddress || 'unknown').toString();
        const rate = checkBootstrapRateLimit(ip, 10, 60 * 60 * 1000); // 10 attempts / hour
        if (!rate.allowed) {
          console.warn(`Bootstrap admin rate limit exceeded for IP ${ip}`);
          return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
        }

        // Prevent creation if an account already exists with the email
        const existing = await User.findOne({ email });
        if (existing) {
          return res.status(400).json({ ok: false, error: "Email already registered" });
        }

        // Create first admin. Set isAdmin: true explicitly.
        const user = new User({
          email,
          password,    // plaintext here; pre('save') will hash it
          isAdmin: true,
          credits: 1000,
          lastCreditReset: getCreditResetDate()
        });

        await user.save();

        // Clear bootstrap attempts map (no further unauthenticated bootstrap allowed)
        bootstrapAttempts.clear();

        console.log('First admin created (bootstrap):', user.email, 'isAdmin:', user.isAdmin);
        // Return success and indicate it's the first admin bootstrap
        return res.json({ ok: true, firstAdmin: true, id: user._id, email: user.email });
      }

      // otherwise, there are admins already -> fall through to require auth/admin
      return next();
    } catch (err) {
      console.error('Error in /api/register-admin bootstrap handler:', err);
      return res.status(500).json({ ok: false, error: 'Server error while checking admin count' });
    }
  },

  // if there are already admins, require an authenticated admin to create more admins
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: "Email and password required" });
      }

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ ok: false, error: "Email already registered" });
      }

      // Create new admin
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

// Gameplay APIs can stay protected (if you want)
// transactional + fallback /api/start handler (replace existing /api/start with this)
app.post('/api/start', async (req, res) => {
  const isDryRun = req.headers['x-dry-run'] === '1' || req.query.dryRun === '1';
  let { email, difficulty } = req.body || {};
  difficulty = difficulty || 'normal';

  try {
    let user = null;
    if (email) {
      user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ ok: false, error: 'User not found' });
      }
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

    // Optional de-duplication: if the user has a very recent session (created in last 5s), return it instead
    if (user) {
      const recent = await GameSession.findOne({
        user: user._id,
        startTime: { $gte: new Date(Date.now() - 5000) } // 5s window
      }).sort({ startTime: -1 }).lean();
      if (recent) {
        // fetch latest user credits to be safe
        const freshUser = await User.findById(user._id).lean();
        return res.json({ ok: true, sessionId: recent._id, credits: freshUser ? freshUser.credits : user.credits });
      }
    }

    // Determine totalChests from config (best-effort)
    let totalChests = 20;
    try {
      const configs = require('./gameConfig');
      if (configs[difficulty] && typeof configs[difficulty].totalTreasures === 'number') {
        totalChests = configs[difficulty].totalTreasures;
      }
    } catch (e) { /* ignore and use default */ }

    // Try to use a transaction if Mongo supports it (replica set)
    let mongoSession;
    try {
      mongoSession = await mongoose.startSession();
    } catch (err) {
      mongoSession = null;
    }

    if (mongoSession) {
      // Transactional path
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
          cost // <-- ADD THIS
        });

        createdSession = await gs.save({ session: mongoSession });

        if (user) {
          // Re-fetch within transaction to avoid races
          const userDoc = await User.findById(user._id).session(mongoSession);
          if (!userDoc) throw new Error('User disappeared during transaction');

          userDoc.credits = Math.max(0, (userDoc.credits || 0) - cost);
          await userDoc.save({ session: mongoSession });
        }

        await mongoSession.commitTransaction();
        mongoSession.endSession();

        // Fetch authoritative credits after commit
        const updatedUser = user ? await User.findById(user._id).lean() : null;
        return res.json({ ok: true, sessionId: createdSession._id, credits: updatedUser ? updatedUser.credits : 0 });
      } catch (txErr) {
        try { await mongoSession.abortTransaction(); } catch (e) { /* ignore */ }
        try { mongoSession.endSession(); } catch (e) { /* ignore */ }
        console.error('/api/start transaction error:', txErr);
        return res.status(500).json({ ok: false, error: 'Failed to start session (transient). Please try again.' });
      }
    } else {
      // Fallback (no transactions available): create session then attempt to deduct credits.
      // If deduction fails, delete the session (compensating rollback).
      let createdSession = null;
      try {
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
          cost // <-- ADD THIS
        });
        createdSession = await gs.save();

        if (user) {
          // Update user credits (optimistic)
          const userDoc = await User.findById(user._id);
          if (!userDoc) throw new Error('User disappeared during credit update');
          userDoc.credits = Math.max(0, (userDoc.credits || 0) - cost);
          await userDoc.save();
        }

        const updatedUser = user ? await User.findById(user._id).lean() : null;
        return res.json({ ok: true, sessionId: createdSession._id, credits: updatedUser ? updatedUser.credits : 0 });
      } catch (err) {
        console.error('/api/start fallback error:', err);
        // Compensate: if session was created, attempt to remove it
        if (createdSession) {
          try { await GameSession.deleteOne({ _id: createdSession._id }); } catch (delErr) {
            console.error('Failed to delete session after credit-update error:', delErr);
          }
        }
        return res.status(500).json({ ok: false, error: 'Failed to start session. Please try again.' });
      }
    }
  } catch (err) {
    console.error('/api/start error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  let query = {};
  if (req.query.email) query.email = { $regex: req.query.email, $options: 'i' };
  const users = await User.find({ ...query, isAdmin: false });

  // For each user, aggregate their sessions for stats
  const userStats = {};
  // Gather all user ids
  const userIds = users.map(u => u._id);

  // Get stats from sessions in a single aggregation for all users
  const stats = await GameSession.aggregate([
    { $match: { user: { $in: userIds } } },
    { $group: {
      _id: "$user",
      playCount: { $sum: 1 },
      totalDeaths: { $sum: "$mineDeaths" },
      totalTimePlayed: { $sum: "$elapsedSeconds" }
    }}
  ]);

  // Map stats by user id
  stats.forEach(stat => {
    userStats[stat._id.toString()] = stat;
  });

  // Attach stats to users
  const result = users.map(u => {
    const stat = userStats[u._id.toString()] || { playCount: 0, totalDeaths: 0, totalTimePlayed: 0 };
    return {
      ...u.toObject(),
      playCount: stat.playCount,
      totalDeaths: stat.totalDeaths,
      totalTimePlayed: stat.totalTimePlayed
    };
  });
  res.json(result);
});

// Add this in your server.js
app.get('/api/admins', authMiddleware, adminOnly, async (req, res) => {
  const admins = await User.find({ isAdmin: true });
  res.json(admins);
});

// Delete an admin account (except yourself)
app.delete('/api/admins/:id', authMiddleware, adminOnly, async (req, res) => {
  const adminId = req.params.id;
  if (req.user.id === adminId) {
    return res.status(400).json({ ok: false, error: "You cannot delete your own admin account." });
  }
  try {
    await User.deleteOne({ _id: adminId, isAdmin: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete admin account' });
  }
});

app.delete('/api/users/:id',authMiddleware, adminOnly, async (req, res) => {
  const userId = req.params.id;
  try {
    await User.deleteOne({ _id: userId });
    await GameSession.deleteMany({ user: userId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user and related sessions' });
  }
});

app.get('/api/sessions',authMiddleware, adminOnly, async (req, res) => {
  try {
    const sessions = await GameSession.find()
      .populate('user', 'email playCount totalDeaths totalTimePlayed')
      .sort({ startTime: -1 });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch game sessions' });
  }
});

app.delete('/api/sessions/:id', authMiddleware, adminOnly, async (req, res) => {
  const sessionId = req.params.id;
  console.log('Delete request for session:', sessionId);
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID format' });
  }
  try {
    const result = await GameSession.deleteOne({ _id: sessionId });
    console.log('Delete result:', result);
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete session error:', error); // Add this for more details in logs
    res.status(500).json({ error: 'Failed to delete session', details: error.message });
  }
});

app.delete('/api/sessions', authMiddleware, adminOnly, async (req, res) => {
  try {
    await GameSession.deleteMany({});
    // Reset all user stats
    await User.updateMany(
      { isAdmin: false },
      { $set: { playCount: 0, totalDeaths: 0, totalTimePlayed: 0 } }
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete all game sessions' });
  }
});

app.get('/api/game-config', async(req, res) => {
  try {
    const difficulty = req.query.difficulty || 'normal';
    const configs = require('./gameConfig');
    if (!configs[difficulty]) {
      return res.json({
        mazePattern: [],
        totalTreasures: 0,
        totalSeaweeds: 0,
        totalBubbles: 0,
        totalMines: 0,
        gameTimeSeconds: 0,
        totalFakeChests: 0
      });
    }
    res.json(configs[difficulty]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load game config', details: err.message });
  }
});

app.put('/api/game-config',authMiddleware, adminOnly, async (req, res) => {
  const difficulty = req.query.difficulty || 'normal';
  const cfg = req.body;

  let configs;
  try {
    configs = require('./gameConfig');
  } catch (err) {
    configs = { easy: {}, normal: {}, hard: {} };
  }
  configs[difficulty] = cfg;

  const js = `module.exports = ${JSON.stringify(configs, null, 2)};\n`;
  fs.writeFile(gameConfigPath, js, err => {
    if (err) return res.status(500).json({ error: 'Failed to save config' });
    delete require.cache[require.resolve('./gameConfig')];
    res.json({ ok: true });
  });
});

// Chest, bubble, mine death, end APIs (for gameplay, if needed)
app.post('/api/chest', async (req, res) => {
  const { sessionId, type } = req.body;
  if (!sessionId) return res.status(400).json({error: 'No session ID provided'});

  const session = await GameSession.findById(sessionId);
  if (!session) return res.status(404).json({error: 'Session not found'});

  if (type !== 'fake') {
    session.chestsCollected += 1;
  }
  const startMs = session.startTime ? session.startTime.getTime() : Date.now();
session.chestLog.push({
  time: Math.floor((Date.now() - startMs) / 1000),
  ...req.body
});
  await session.save();
  res.json({ok: true});
});

app.post('/api/bubble', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({error: 'No session ID provided'});
  
  const session = await GameSession.findById(sessionId);
  if (!session) return res.status(404).json({error: 'Session not found'});
  
  session.bubblesCollected += 1;
  session.bubbleLog.push({
    time: Math.floor((Date.now() - session.startTime.getTime()) / 1000),
    ...req.body
  });
  await session.save();
  res.json({ok: true});
});

app.post('/api/mineDeath', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({error: 'No session ID provided'});
  
  const session = await GameSession.findById(sessionId);
  if (!session) return res.status(404).json({error: 'Session not found'});
  
  session.mineDeaths += 1;
  await session.save();
  res.json({ok: true});
});

app.post('/api/end', async (req, res) => {
  try {
    const { sessionId, endedEarly = false, score, seaweedsCollected, grace = false } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'No sessionId provided' });

    const session = await GameSession.findById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Determine elapsed using authoritative server time
    const now = new Date();
    const startTime = session.startTime || now;
    const elapsedSeconds = Math.floor((now.getTime() - new Date(startTime).getTime()) / 1000);

    // If session already processed normally (has endTime) and not within grace,
    // return success (idempotent).
    if (session.endTime && !(grace || elapsedSeconds < 5)) {
      return res.json({ ok: true, message: 'Session already recorded' });
    }

    // GRACE WINDOW handling (atomic & idempotent)
    const GRACE_SECONDS = 5;
    if (grace || elapsedSeconds < GRACE_SECONDS) {
      // If already refunded / processed, return idempotent result
      if (session.refunded) {
        return res.json({ ok: true, refunded: true, message: 'Session already refunded' });
      }

      // Attempt to run refund inside a transaction (if available)
      let mongoSession = null;
      try {
        mongoSession = await mongoose.startSession();
        mongoSession.startTransaction();

        // Re-read the session within the transaction to guard against races
        const sess = await GameSession.findOne({ _id: sessionId }).session(mongoSession);
        if (!sess) {
          await mongoSession.commitTransaction();
          mongoSession.endSession();
          return res.status(404).json({ ok: false, error: 'Session not found during transaction' });
        }

        // If it's already refunded by a concurrent request, do nothing
        if (sess.refunded) {
          await mongoSession.commitTransaction();
          mongoSession.endSession();
          return res.json({ ok: true, refunded: true, message: 'Session already refunded' });
        }

        // Perform refund if user & cost exist
        if (sess.user && typeof sess.cost === 'number' && sess.cost > 0) {
          // increment user credits
          const updatedUser = await User.findByIdAndUpdate(
            sess.user,
            { $inc: { credits: sess.cost } },
            { new: true, session: mongoSession }
          );

          // mark session refunded (so further calls are no-ops)
          await GameSession.updateOne(
            { _id: sessionId },
            { $set: { refunded: true, refundedAt: new Date() } },
            { session: mongoSession }
          );

          // optionally delete the session (or keep it with refunded flag)
          await GameSession.deleteOne({ _id: sessionId }).session(mongoSession);

          await mongoSession.commitTransaction();
          mongoSession.endSession();

          return res.json({
            ok: true,
            refunded: true,
            message: 'Session ended within grace; credits refunded.',
            credits: updatedUser ? updatedUser.credits : undefined
          });
        } else {
          // No user/cost: mark refunded (so we don't try again) and remove session
          await GameSession.updateOne(
            { _id: sessionId },
            { $set: { refunded: true, refundedAt: new Date() } },
            { session: mongoSession }
          );
          await GameSession.deleteOne({ _id: sessionId }).session(mongoSession);

          await mongoSession.commitTransaction();
          mongoSession.endSession();

          return res.json({ ok: true, refunded: false, message: 'Short session removed (no user/cost)' });
        }
      } catch (txErr) {
        if (mongoSession) {
          try { await mongoSession.abortTransaction(); mongoSession.endSession(); } catch (e) { /* ignore */ }
        }
        console.warn('/api/end refund transaction failed, falling back to atomic update', txErr);

        // Fallback non-transactional path: try an atomic findOneAndUpdate to claim refund
        const claimed = await GameSession.findOneAndUpdate(
          { _id: sessionId, $or: [{ refunded: { $exists: false } }, { refunded: false }] },
          { $set: { refunded: true, refundedAt: new Date() } },
          { new: true }
        );

        if (!claimed) {
          // someone else claimed/processed it
          return res.json({ ok: true, refunded: true, message: 'Session already refunded (fallback)' });
        }

        // Proceed to increment user credits if applicable
        try {
          if (claimed.user && typeof claimed.cost === 'number' && claimed.cost > 0) {
            const updatedUser = await User.findByIdAndUpdate(
              claimed.user,
              { $inc: { credits: claimed.cost } },
              { new: true }
            );
            // remove session document (best-effort)
            try { await GameSession.deleteOne({ _id: sessionId }); } catch (delErr) { /* ignore */ }

            return res.json({
              ok: true,
              refunded: true,
              message: 'Session ended within grace; credits refunded (fallback).',
              credits: updatedUser ? updatedUser.credits : undefined
            });
          } else {
            // no user/cost
            try { await GameSession.deleteOne({ _id: sessionId }); } catch (delErr) { /* ignore */ }
            return res.json({ ok: true, refunded: false, message: 'Short session removed (no user/cost) (fallback).' });
          }
        } catch (incErr) {
          // If the credit increment failed after we claimed the refund flag, log and enqueue for manual reconciliation/repair.
          console.error('/api/end fallback: failed to increment credits after claiming refund flag', incErr);
          return res.status(500).json({ ok: false, error: 'Refund failed during fallback. Manual reconciliation required.' });
        }
      }
    }

    // ---- not grace: normal end-of-game handling ----
    session.endTime = now;
    session.elapsedSeconds = elapsedSeconds;
    session.endedEarly = !!endedEarly;

    if (typeof score !== 'undefined') session.score = score;
    if (typeof seaweedsCollected !== 'undefined') session.seaweedsCollected = seaweedsCollected;

    if (!session.endedEarly && session.chestsCollected >= session.totalChests) {
      session.isWin = true;
    } else {
      session.isWin = false;
    }

    await session.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error('/api/end error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Treasure Hunt API' });
});

const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  // If you set MONGODB_DBNAME in your environment (e.g. Vercel),
  // Mongoose will prefer this DB name instead of defaulting to "test".
  dbName: process.env.MONGODB_DBNAME || undefined
};

// Helper to mask the URI for safe logging (do NOT reveal credentials)
function maskedUri(uri) {
  try {
    const u = new URL(uri);
    const user = u.username ? (u.username[0] + '***') : '';
    const host = u.hostname || '(unknown-host)';
    const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
    return `${u.protocol}//${user}@${host}${path}`;
  } catch (e) {
    return '[invalid-uri]';
  }
}

console.log('Connecting to MongoDB (masked):', maskedUri(process.env.MONGODB_URI));
console.log('MONGODB_DBNAME override:', process.env.MONGODB_DBNAME || '(none)');

// Connect to MongoDB and log authoritative connection info on success
mongoose.connect(process.env.MONGODB_URI, mongooseOptions)
  .then(() => {
    const c = mongoose.connection;
    console.log('Connected to MongoDB Atlas');
    console.log('Active DB name:', c.name || '(unknown)');
    console.log('Host:', c.host || '(unknown)');
    console.log('Port:', c.port || '(unknown)');
    console.log('Mongoose readyState:', c.readyState);
  })
  .catch(err => {
    console.error('Could not connect to MongoDB Atlas', err);
  });

// Optional lightweight endpoint to query connection info (safe to restrict/remove after debugging)
app.get('/api/_debug/db-info', (req, res) => {
  try {
    const c = mongoose.connection;
    return res.json({
      ok: true,
      host: c.host || null,
      port: c.port || null,
      dbName: c.name || null,
      readyState: c.readyState
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});

// Place this with your other app.get routes, before app.listen
app.get('/api/register-allowed', async (req, res) => {
  const adminCount = await User.countDocuments({ isAdmin: true });
  res.json({ allowed: adminCount === 0 });
});

app.post('/api/reset-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ ok: false, error: "Email and new password required" });
  }
  const user = await User.findOne({ email });
  if (!user) {
    return res.status(404).json({ ok: false, error: "No user with that email" });
  }
  user.password = newPassword; // Will be hashed by pre-save hook
  await user.save();
  res.json({ ok: true });
});

app.get('/api/my-sessions', authMiddleware, async (req, res) => {
  try {
    const sessions = await GameSession.find({ user: req.user.id })
      .populate('user', 'email')
      .sort({ startTime: -1 })
      .lean();
    res.json(sessions);
  } catch (err) {
    console.error('/api/my-sessions error', err);
    res.status(500).json({ error: 'Failed to load user sessions' });
  }
});

app.get('/api/leaderboard',authMiddleware, async (req, res) => {
  const difficulties = ['easy', 'normal', 'hard'];
  let leaderboard = {};

  for (const diff of difficulties) {
    // Find best winning session for each user in this difficulty
    const sessions = await GameSession.aggregate([
      { $match: { isWin: true, endedEarly: { $ne: true }, difficulty: diff, user: { $ne: null } } },
      // Sort so that the "best" session is first for each user
      { $sort: { elapsedSeconds: 1, seaweedsCollected: -1, score: -1 } },
      {
        $group: {
          _id: "$user",
          sessionId: { $first: "$_id" },
          user: { $first: "$user" },
          elapsedSeconds: { $first: "$elapsedSeconds" },
          seaweedsCollected: { $first: "$seaweedsCollected" },
          score: { $first: "$score" },
        }
      },
      { $sort: { elapsedSeconds: 1, seaweedsCollected: -1, score: -1 } }
    ]);
    // Populate user info
    const populated = await GameSession.populate(sessions, { path: "user", select: "email" });
    leaderboard[diff] = populated;
  }

  res.json(leaderboard);
});

// User submits feedback
app.post('/api/feedback', authMiddleware, async (req, res) => {
  const { rating, text } = req.body;
  if (!rating || !text) return res.status(400).json({ ok: false, error: 'Rating and text required.' });

  const user = await User.findById(req.user.id);
  if (!user) return res.status(400).json({ ok: false, error: 'User not found.' });

  const fb = new Feedback({
    user: user._id,
    email: user.email,
    rating,
    text
  });
  await fb.save();
  res.json({ ok: true });
});

// Admin: get all feedbacks
app.get('/api/feedbacks', authMiddleware, adminOnly, async (req, res) => {
  const feedbacks = await Feedback.find({}).sort({ date: -1 });
  res.json(feedbacks);
});

// Admin: reply to feedback
app.post('/api/feedbacks/:id/reply', authMiddleware, adminOnly, async (req, res) => {
  const { reply } = req.body;
  await Feedback.findByIdAndUpdate(req.params.id, { adminReply: reply, adminReplyDate: new Date() });
  res.json({ ok: true });
});

// Admin: delete a feedback
app.delete('/api/feedbacks/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await Feedback.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Failed to delete feedback.' });
  }
});

// Move the error handler AFTER your normal middleware registrations and before routes' final error handling,
app.use(function (err, req, res, next) {
  // If headers already sent, delegate to default handler
  if (res.headersSent) return next(err);

  // Known CORS error created by our origin check
  if (err && err.message === 'Not allowed by CORS') {
    console.warn('CORS blocked origin:', req.headers.origin);
    return res.status(403).json({ error: 'CORS error: Not allowed by CORS', origin: req.headers.origin });
  }

  // Known validation or app errors may expose a .status property
  const status = (err && err.status && Number(err.status)) || 500;
  const payload = {
    ok: false,
    error: (err && err.message) || 'Internal server error'
  };

  // Add stack trace only in development to help debugging
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err && err.stack;
    console.error('Unhandled error:', err);
  } else {
    // In production, log minimal error server-side
    console.error('Unhandled server error:', (err && err.message) || err);
  }

  res.status(status).json(payload);
});

// Start server using process.env.PORT for Render compatibility
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.log(`Render external hostname: ${process.env.RENDER_EXTERNAL_HOSTNAME}`);
  }
  if (process.env.FRONTEND_URL) {
    console.log(`Configured FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  } else if (process.env.FRONTEND_ORIGINS) {
    console.log(`Configured FRONTEND_ORIGINS: ${process.env.FRONTEND_ORIGINS}`);
  } else {
    console.log('Allowed origins (computed):', allowedOrigins);
  }
});