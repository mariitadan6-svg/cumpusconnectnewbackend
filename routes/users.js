const express = require('express');
const { users, likes, matches } = require('../data/store');
const { auth } = require('../middleware/auth');

const router = express.Router();

function stripUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

// Get my profile
router.get('/me', auth, (req, res) => {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(stripUser(u));
});

// Update my profile
router.put('/me', auth, (req, res) => {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const editable = ['name', 'age', 'gender', 'interestedIn', 'lookingFor',
    'county', 'subcounty', 'bio', 'interests', 'photo'];
  editable.forEach(f => {
    if (req.body[f] !== undefined) u[f] = req.body[f];
  });
  users.set(req.userId, u);
  res.json(stripUser(u));
});

// Discover / filter users
router.get('/discover', auth, (req, res) => {
  const { lookingFor, county, subcounty, minAge, maxAge } = req.query;
  const me = users.get(req.userId);
  if (!me) return res.status(404).json({ error: 'Not found' });

  let list = Array.from(users.values()).filter(u => u.id !== me.id);

  if (lookingFor && lookingFor !== 'all') {
    list = list.filter(u => u.lookingFor === lookingFor);
  }
  if (county) list = list.filter(u => u.county === county);
  if (subcounty) list = list.filter(u => u.subcounty === subcounty);
  if (minAge) list = list.filter(u => u.age >= Number(minAge));
  if (maxAge) list = list.filter(u => u.age <= Number(maxAge));

  // Score by shared interests
  const myInterests = new Set(me.interests || []);
  list = list.map(u => {
    const shared = (u.interests || []).filter(i => myInterests.has(i)).length;
    return { ...stripUser(u), sharedInterests: shared };
  });
  list.sort((a, b) => b.sharedInterests - a.sharedInterests);

  res.json(list);
});

// Like a user (creates match if mutual)
router.post('/like/:id', auth, (req, res) => {
  const target = req.params.id;
  if (!users.has(target)) return res.status(404).json({ error: 'User not found' });
  if (target === req.userId) return res.status(400).json({ error: 'Cannot like yourself' });

  if (!likes.has(req.userId)) likes.set(req.userId, new Set());
  likes.get(req.userId).add(target);

  const theirLikes = likes.get(target);
  let matched = false;
  if (theirLikes && theirLikes.has(req.userId)) {
    matched = true;
    matches.push({
      id: `${req.userId}_${target}`,
      userA: req.userId,
      userB: target,
      ts: Date.now()
    });
  }
  res.json({ liked: true, matched });
});

// Get my matches
router.get('/matches', auth, (req, res) => {
  const mine = matches.filter(m => m.userA === req.userId || m.userB === req.userId);
  const results = mine.map(m => {
    const other = m.userA === req.userId ? m.userB : m.userA;
    return { matchId: m.id, user: stripUser(users.get(other)), ts: m.ts };
  });
  res.json(results);
});

module.exports = router;
