require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

// ==== CONFIG ====
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret';
const ADMIN_KEY = process.env.ADMIN_KEY || 'adminkey';
const MOD_ENDPOINT = process.env.MODERATION_ENDPOINT || 'https://nsfw-demo.onrender.com/api/moderate';

// ==== MIDDLEWARE ====
app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'frontend', 'static'))); // ✅ Fix: correct static dir

// ==== IN-MEMORY STORAGE ====
const users = {}; // id -> { id, passwordHash, displayName }
const sockets = {}; // socketId -> userId
let currentBroadcaster = null;
const warnings = {}; // userId -> count
const banned = {}; // userId -> true

// =========================
// ==== AUTH ENDPOINTS ====
// =========================

// SIGNUP
app.post('/api/signup', async (req, res) => {
  try {
    const { accessKey, password, name } = req.body;
    if (!accessKey || accessKey !== ADMIN_KEY)
      return res.status(403).json({ error: 'Invalid admin key' });
    if (!password || password.length < 4)
      return res.status(400).json({ error: 'Password too short' });

    const id = 'user-' + uuidv4().slice(0, 8);
    const hash = await bcrypt.hash(password, 10);
    users[id] = { id, passwordHash: hash, displayName: name || id, createdAt: Date.now() };
    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });

    console.log(`✅ New user created: ${id}`);
    res.json({ id, token });
  } catch (e) {
    console.error('Signup error:', e);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password) return res.status(400).json({ error: 'Missing credentials' });

    const user = users[id];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Wrong password' });

    const token = jwt.sign({ id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ id, token });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// LIST USERS (for feed)
app.get('/api/users', (req, res) => {
  const list = Object.values(users).map(u => ({
    id: u.id,
    displayName: u.displayName,
  }));
  res.json(list);
});

// =============================
// ==== MODERATION ENDPOINT ====
// =============================
app.post('/api/moderate-frame', async (req, res) => {
  try {
    const auth = req.headers.authorization?.split(' ')[1];
    if (!auth) return res.status(401).json({ error: 'no auth' });

    const { id } = jwt.verify(auth, JWT_SECRET);
    if (banned[id]) return res.json({ banned: true });

    const { frame } = req.body;
    if (!frame) return res.status(400).json({ error: 'missing frame' });

    const modResp = await fetch(MOD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: frame }),
    });

    if (!modResp.ok) {
      console.warn('Moderation API error:', modResp.status);
      return res.json({ ok: false, modelError: true });
    }

    const j = await modResp.json();
    const label = (j.label || j.result || j.classification || '').toString().toLowerCase();
    const risky =
      label.includes('nsfw') ||
      label.includes('sexy') ||
      label.includes('porn') ||
      j.nsfw === true ||
      j.is_nsfw === true;

    if (risky) {
      warnings[id] = (warnings[id] || 0) + 1;
      const count = warnings[id];
      const sockId = Object.keys(sockets).find(sid => sockets[sid] === id);
      if (sockId) io.to(sockId).emit('warning', { id, count });
      if (count >= 3) {
        banned[id] = true;
        if (currentBroadcaster === id) {
          currentBroadcaster = null;
          io.to('public').emit('stop-live', { id });
        }
      }
    }

    res.json({ ok: true, risky, label, raw: j });
  } catch (e) {
    console.error('Moderation error:', e);
    res.status(500).json({ error: 'moderation failed' });
  }
});

// ======================
// ==== SOCKET LOGIC ====
// ======================
io.on('connection', socket => {
  console.log('Socket connected:', socket.id);

  socket.on('auth', token => {
    try {
      const pl = jwt.verify(token, JWT_SECRET);
      sockets[socket.id] = pl.id;
      socket.join('public');
      socket.emit('auth-ok', { id: pl.id, displayName: users[pl.id]?.displayName });
      if (currentBroadcaster) socket.emit('live-started', { id: currentBroadcaster });
    } catch {
      socket.emit('auth-fail');
    }
  });

  socket.on('public-message', txt => {
    const from = sockets[socket.id] || 'anon';
    io.to('public').emit('public-message', { from, text: txt });
  });

  socket.on('go-live', ({ id }) => {
    if (banned[id]) {
      socket.emit('banned');
      return;
    }
    currentBroadcaster = id;
    io.to('public').emit('live-started', { id });
  });

  socket.on('stop-live', () => {
    currentBroadcaster = null;
    io.to('public').emit('live-stopped');
  });

  socket.on('public-signal', data => {
    socket.to('public').emit('public-signal', { from: sockets[socket.id] || 'anon', ...data });
  });

  socket.on('disconnect', () => {
    delete sockets[socket.id];
  });
});

// =====================
// ==== START SERVER ====
// =====================
server.listen(PORT, () => console.log(`🚀 TestLive backend running on port ${PORT}`));

      
