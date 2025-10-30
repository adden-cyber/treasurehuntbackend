const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const User = require('./models/User');
require('dotenv').config();
const GameSession = require('./models/GameSessions');
const Feedback = require('./models/Feedback');

// Helper: get latest GMT+8 midnight
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
  const resetDate = getCreditResetDate();
  if (!user.lastCreditReset || user.lastCreditReset < resetDate) {
    user.credits = 1000; // increased starting credits
    user.lastCreditReset = resetDate;
    await user.save();
  }
}

const gameConfigPath = path.join(__dirname, 'gameConfig.js');
const app = express();
const allowedOrigins = [
  'http://127.0.0.1:8080',
  'http://localhost:8080',
  'http://192.168.0.105:8080',
  'http://localhost:3001',
  'http://192.168.0.114:8080',
  'https://manateetreasurehunt.vercel.app'
];

// Use centralized JWT secret var
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using default JWT secret. Set process.env.JWT_SECRET in production for security.');
}

// --- Improved CORS Setup (replace your existing CORS block with this) ---
const normalizeOrigin = (origin) => {
  if (!origin) return origin;
  // Convert IPv6 localhost format to hostname so matching works:
  // e.g. "http://[::1]:3001" -> "http://localhost:3001"
  try {
    const u = new URL(origin);
    let hostname = u.hostname;
    if (hostname === '::1') hostname = 'localhost';
    // keep port if present
    return `${u.protocol}//${hostname}${u.port ? ':' + u.port : ''}`;
  } catch (err) {
    return origin; // fallback
  }
};

app.use((req, res, next) => {
  // Quick debug so you can see what the server actually receives
  if (req.headers.origin) console.log('CORS request from (raw):', req.headers.origin);
  next();
});

app.use(cors({
  origin: function(origin, callback) {
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
    'X-Dry-Run',        // <-- add this
    'X-Requested-With'  // optional common header
  ],
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
}));
// Handle preflights (explicitly ensure same cors config used)
app.options('*', cors());

// Move the error handler AFTER your normal middleware registrations and before routes' final error handling,
// but a simple handler to convert our "Not allowed by CORS" error to a 403 JSON response:
app.use(function (err, req, res, next) {
  if (!err) return next();
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS error: Not allowed by CORS', origin: req.headers.origin });
  }
  // for other errors, pass through (or log)
  console.error('Express error:', err);
  next(err);
});
// --- End improved CORS ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const jwt = require('jsonwebtoken'); // If you want JWT, or use sessions/cookies

function authMiddleware(req, res, next) {
  // Get token from Authorization header (Bearer ...)
  const token = req.headers.authorization?.split(' ')[1];
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
// This only protects the "no-admins yet" path and is intentionally lightweight.
// For production consider using a robust rate limiter (redis-backed, express-rate-limit, etc.).
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
    const payload = { email: user.email, isAdmin: user.isAdmin, id: user._id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    // Respond with token and user info (including credits)
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

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email and password required" });
  }
  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ ok: false, error: "Email already registered" });
  }
  // Create new user as regular user
  const user = new User({
    email,
    password,
    isAdmin: false,
    credits: 1000,
    lastCreditReset: getCreditResetDate()
  });
  await user.save();
  res.json({ ok: true });
});

// Create admin (bootstrap first admin without auth, otherwise require admin auth)
app.post('/api/register-admin',
  // first handler: allow creating the very first admin without authentication
  async (req, res, next) => {
    try {
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

        const { email, password } = req.body || {};
        if (!email || !password) {
          return res.status(400).json({ ok: false, error: "Email and password required to create the first admin" });
        }

        // Prevent creation if an account already exists with the email
        const existing = await User.findOne({ email });
        if (existing) {
          return res.status(400).json({ ok: false, error: "Email already registered" });
        }

        // Create first admin. We rely on User model hooks to hash the password if implemented.
        const user = new User({
          email,
          password,
          isAdmin: true,
          credits: 1000,
          lastCreditReset: getCreditResetDate()
        });

        await user.save();

        // Clear bootstrap attempts map (no further unauthenticated bootstrap allowed)
        bootstrapAttempts.clear();

        console.log('First admin created (bootstrap):', user.email);
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
  session.chestLog.push({
    time: Math.floor((Date.now() - session.startTime.getTime()) / 1000),
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

// Replace the existing /api/end handler with this updated handler
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

    // If client indicated grace OR the elapsed is less than the grace window (5s),
    // we treat this as "player ended too quickly" -> refund and DO NOT record session.
    const GRACE_SECONDS = 5;
    if (grace || elapsedSeconds < GRACE_SECONDS) {
      // Refund the user's credits if this session was linked to a user and cost exists
      if (session.user && typeof session.cost === 'number' && session.cost > 0) {
        try {
          const userDoc = await User.findById(session.user);
          if (userDoc) {
            userDoc.credits = (userDoc.credits || 0) + session.cost;
            await userDoc.save();
            console.log(`/api/end: refunded ${session.cost} credits to user ${userDoc.email} for session ${sessionId}`);

            // Delete the short session and return updated credits
            try {
              await GameSession.deleteOne({ _id: sessionId });
            } catch (delErr) {
              console.warn('/api/end: failed to delete short session', delErr);
            }

            // Return credits so client can update UI immediately
            const updatedUser = await User.findById(session.user).lean();
            return res.json({
              ok: true,
              refunded: true,
              message: 'Session ended within grace window and was not recorded.',
              credits: updatedUser ? updatedUser.credits : (userDoc.credits || 0)
            });
          }
        } catch (refundErr) {
          console.error('/api/end refund error', refundErr);
          // If refund failed, attempt to delete the session anyway (best effort)
          try {
            await GameSession.deleteOne({ _id: sessionId });
          } catch (delErr) {
            console.warn('/api/end: failed to delete short session after refund error', delErr);
          }
          // Fall through to return a generic success with refunded:false to avoid blocking client
          return res.json({ ok: true, refunded: false, message: 'Session removed but refund failed.' });
        }
      } else {
        // No user or no cost; still remove the session and report back
        try {
          await GameSession.deleteOne({ _id: sessionId });
        } catch (delErr) {
          console.warn('/api/end: failed to delete short session (no user/cost)', delErr);
        }
        return res.json({ ok: true, refunded: false, message: 'Session ended quickly and was removed (no refund).' });
      }
    }

    // Normal end-of-game handling (record stats)
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

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB Atlas'))
.catch(err => console.error('Could not connect to MongoDB Atlas', err));

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

app.listen(3001, () => console.log('Backend listening on http://192.168.0.114:3001'));