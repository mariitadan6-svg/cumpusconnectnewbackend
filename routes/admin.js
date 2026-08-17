const express = require('express');
const jwt = require('jsonwebtoken');
const { users, emails, messages, likes, matches, posts, notifications, payments, kcbRefIndex } = require('../data/store');
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

// ===== Wallet — all payment transactions (successful / cancelled / failed / timeout / pending) =====
router.get('/payments', adminAuth, (req, res) => {
  const list = Array.from(payments.values()).map(p => {
    const u = users.get(p.userId);
    return { ...p, userName: u ? u.name : 'Unknown', userEmail: u ? u.email : '' };
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const totals = { successful: 0, cancelled: 0, failed: 0, timeout: 0, pending: 0, revenue: 0 };
  list.forEach(p => {
    if (totals[p.status] !== undefined) totals[p.status]++;
    if (p.status === 'successful') totals.revenue += Number(p.amount || 0);
  });
  res.json({ totals, payments: list });
});

// ===== Persistence: full data snapshot export / restore =====
// Used by the standalone Netlify admin panel: it pulls this snapshot every 4
// minutes and stores it permanently in the browser's localStorage. When the
// Render free-tier backend sleeps and loses its in-memory data, the Netlify
// panel POSTs the snapshot back to /restore so nothing is ever lost.
function buildSnapshot() {
  const likesObj = {};
  for (const [k, s] of likes.entries()) likesObj[k] = Array.from(s);
  return {
    exportedAt: Date.now(),
    users: Array.from(users.values()),
    messages: messages.map(m => ({ ...m })),
    matches: matches.map(m => ({ ...m })),
    payments: Array.from(payments.values()).map(p => ({ ...p })),
    posts: posts.map(p => ({ ...p, likes: Array.from(p.likes || []), dislikes: Array.from(p.dislikes || []) })),
    notifications: notifications.map(n => ({ ...n, readBy: Array.from(n.readBy || []) })),
    likes: likesObj
  };
}

router.get('/export', adminAuth, (req, res) => {
  res.json(buildSnapshot());
});

router.post('/restore', adminAuth, (req, res) => {
  const s = req.body || {};
  const stats = { users: 0, messages: 0, matches: 0, payments: 0, posts: 0, notifications: 0, likes: 0 };
  try {
    if (Array.isArray(s.users)) {
      for (const u of s.users) {
        if (!u || !u.id || users.has(u.id)) continue;
        users.set(u.id, u);
        if (u.email) emails.set(u.email, u.id);
        stats.users++;
      }
    }
    if (Array.isArray(s.messages)) {
      const seen = new Set(messages.map(m => m.id));
      for (const m of s.messages) {
        if (!m || !m.id || seen.has(m.id)) continue;
        messages.push(m); seen.add(m.id); stats.messages++;
      }
      messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }
    if (Array.isArray(s.matches)) {
      const seen = new Set(matches.map(m => m.id));
      for (const m of s.matches) {
        if (!m || !m.id || seen.has(m.id)) continue;
        matches.push(m); seen.add(m.id); stats.matches++;
      }
    }
    if (Array.isArray(s.payments)) {
      for (const p of s.payments) {
        if (!p || !p.id) continue;
        const existing = payments.get(p.id);
        if (!existing) { payments.set(p.id, p); stats.payments++; }
        else if ((p.updatedAt || 0) > (existing.updatedAt || 0)) payments.set(p.id, p);
        if (p.checkoutId) kcbRefIndex.set(p.checkoutId, p.id);
        if (p.merchantId) kcbRefIndex.set(p.merchantId, p.id);
      }
    }
    if (Array.isArray(s.posts)) {
      const seen = new Set(posts.map(p => p.id));
      for (const p of s.posts) {
        if (!p || !p.id || seen.has(p.id)) continue;
        posts.push({ ...p, likes: new Set(p.likes || []), dislikes: new Set(p.dislikes || []), comments: p.comments || [] });
        seen.add(p.id); stats.posts++;
      }
      posts.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }
    if (Array.isArray(s.notifications)) {
      const seen = new Set(notifications.map(n => n.id));
      for (const n of s.notifications) {
        if (!n || !n.id || seen.has(n.id)) continue;
        notifications.push({ ...n, readBy: new Set(n.readBy || []) });
        seen.add(n.id); stats.notifications++;
      }
    }
    if (s.likes && typeof s.likes === 'object') {
      for (const [uid, arr] of Object.entries(s.likes)) {
        if (!Array.isArray(arr)) continue;
        if (!likes.has(uid)) likes.set(uid, new Set());
        const set = likes.get(uid);
        for (const v of arr) if (!set.has(v)) { set.add(v); stats.likes++; }
      }
    }
  } catch (e) {
    console.error('Restore error:', e.message);
    return res.status(400).json({ error: 'Invalid snapshot', restored: stats });
  }
  console.log('Snapshot restored:', JSON.stringify(stats));
  res.json({ ok: true, restored: stats });
});

module.exports = router;
