const express = require('express');
const { users, likes, matches, messages, posts } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();

function stripUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}
function serializePost(p, meId) {
  const a = users.get(p.userId);
  return {
    id: p.id, text: p.text, mediaType: p.mediaType, mediaData: p.mediaData, ts: p.ts,
    author: a
      ? { id: a.id, name: a.name, photo: a.photo || '', county: a.county }
      : { id: '', name: 'Unknown', photo: '', county: '' },
    likeCount: p.likes ? p.likes.size : 0,
    likedByMe: meId && p.likes ? p.likes.has(meId) : false,
    comments: (p.comments || []).map(c => {
      const cu = users.get(c.userId);
      return { id: c.id, text: c.text, ts: c.ts, userId: c.userId, name: cu ? cu.name : 'Unknown', photo: cu ? (cu.photo || '') : '' };
    })
  };
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
    'county', 'subcounty', 'bio', 'interests', 'photo', 'photos'];
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
    return { ...stripUser(u), sharedInterests: shared, online: (Date.now() - (u.lastSeen || 0)) < 120000 };
  });
  list.sort((a, b) => b.sharedInterests - a.sharedInterests);

  res.json(list);
});

// View another user's public profile + their posts
router.get('/profile/:id', auth, (req, res) => {
  const u = users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const theirPosts = posts
    .filter(p => p.userId === u.id)
    .sort((a, b) => b.ts - a.ts)
    .map(p => serializePost(p, req.userId));
  res.json({
    user: { ...stripUser(u), online: (Date.now() - (u.lastSeen || 0)) < 120000 },
    posts: theirPosts
  });
});

// Recently joined members (for the dashboard)
router.get('/recent', auth, (req, res) => {
  res.json(
    Array.from(users.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8)
      .map(u => ({ ...stripUser(u), online: (Date.now() - (u.lastSeen || 0)) < 120000 }))
  );
});

// Heartbeat — keeps the user "online"
router.post('/heartbeat', auth, (req, res) => {
  const u = users.get(req.userId);
  if (u) { u.lastSeen = Date.now(); users.set(req.userId, u); }
  res.json({ ok: true });
});

// Dashboard stats for the logged-in user
router.get('/stats', auth, (req, res) => {
  const me = req.userId;
  const myMatches = matches.filter(m => m.userA === me || m.userB === me).length;
  let likesReceived = 0;
  for (const [uid, set] of likes.entries()) {
    if (uid !== me && set.has(me)) likesReceived++;
  }
  const unreadMessages = messages.filter(m => m.to === me && !m.read).length;
  const myPosts = posts.filter(p => p.userId === me).length;
  res.json({ matches: myMatches, likesReceived, unreadMessages, myPosts });
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
    // Notify BOTH users about the new match
    const meName = users.get(req.userId) ? users.get(req.userId).name : 'Someone';
    const themName = users.get(target) ? users.get(target).name : 'Someone';
    notify(req.userId, 'match', `💞 It's a match! You and ${themName} liked each other`, target);
    notify(target, 'match', `💞 It's a match! You and ${meName} liked each other`, req.userId);
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
