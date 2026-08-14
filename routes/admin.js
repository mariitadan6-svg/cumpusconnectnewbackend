const express = require('express');
const jwt = require('jsonwebtoken');
const { users, emails, messages, likes, matches } = require('../data/store');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '11connect72';

function adminAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) return res.status(403).json({ error: 'Not an admin token' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin password' });
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Verify token
router.get('/verify', adminAuth, (req, res) => res.json({ ok: true }));

// Dashboard stats
router.get('/stats', adminAuth, (req, res) => {
  const allUsers = Array.from(users.values());
  const byVibe = { dating: 0, friendship: 0, hookup: 0 };
  const byGender = { female: 0, male: 0, nonbinary: 0, other: 0 };
  const byCounty = {};
  allUsers.forEach(u => {
    if (byVibe[u.lookingFor] !== undefined) byVibe[u.lookingFor]++;
    if (byGender[u.gender] !== undefined) byGender[u.gender]++;
    byCounty[u.county] = (byCounty[u.county] || 0) + 1;
  });
  const topCounties = Object.entries(byCounty)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([county, count]) => ({ county, count }));

  res.json({
    totals: {
      users: allUsers.length,
      matches: matches.length,
      messages: messages.length,
      likes: Array.from(likes.values()).reduce((sum, s) => sum + s.size, 0)
    },
    byVibe,
    byGender,
    topCounties,
    recentUsers: allUsers
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 5)
      .map(u => ({ id: u.id, name: u.name, email: u.email, county: u.county, lookingFor: u.lookingFor, createdAt: u.createdAt }))
  });
});

// List users
router.get('/users', adminAuth, (req, res) => {
  const list = Array.from(users.values()).map(u => {
    const { password, ...safe } = u;
    return safe;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(list);
});

// Delete a user
router.delete('/users/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  const u = users.get(id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  emails.delete(u.email);
  users.delete(id);
  likes.delete(id);
  for (const [k, s] of likes.entries()) s.delete(id);
  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i].userA === id || matches[i].userB === id) matches.splice(i, 1);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === id || messages[i].to === id) messages.splice(i, 1);
  }
  res.json({ ok: true });
});

// List messages (recent)
router.get('/messages', adminAuth, (req, res) => {
  const recent = messages.slice(-100).reverse().map(m => {
    const from = users.get(m.from);
    const to = users.get(m.to);
    return {
      id: m.id, ts: m.ts, text: m.text,
      fromName: from ? from.name : 'Unknown',
      toName: to ? to.name : 'Unknown'
    };
  });
  res.json(recent);
});

// List matches
router.get('/matches', adminAuth, (req, res) => {
  const list = matches.slice().reverse().map(m => {
    const a = users.get(m.userA);
    const b = users.get(m.userB);
    return {
      id: m.id, ts: m.ts,
      a: a ? { id: a.id, name: a.name } : null,
      b: b ? { id: b.id, name: b.name } : null
    };
  });
  res.json(list);
});

module.exports = router;
