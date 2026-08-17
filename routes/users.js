const express = require('express');
const bcrypt = require('bcryptjs');
const { users, likes, matches, messages, posts, profileViews, emails, notifications } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { isSubscribed, checkPhotoGallery, billingSummary } = require('../utils/monetization');

const router = express.Router();

// Online = lastSeen within the last 2 minutes
const ONLINE_MS = 120000;

function stripUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  // Public-safe verified flag (derived from active subscription)
  safe.verified = isSubscribed(u);
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
    dislikeCount: p.dislikes ? p.dislikes.size : 0,
    likedByMe: meId && p.likes ? p.likes.has(meId) : false,
    dislikedByMe: meId && p.dislikes ? p.dislikes.has(meId) : false,
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

  // Gate: unpaid members can only keep up to FREE_LIMITS.maxPhotos gallery photos
  if (Array.isArray(req.body.photos)) {
    const g = checkPhotoGallery(u, req.body.photos.length);
    if (!g.ok) return res.status(402).json({ error: g.reason, code: g.code });
  }

  const editable = ['name', 'age', 'gender', 'interestedIn', 'lookingFor',
    'county', 'subcounty', 'bio', 'interests', 'photo', 'photos', 'settings'];
  editable.forEach(f => {
    if (req.body[f] !== undefined) u[f] = req.body[f];
  });
  users.set(req.userId, u);
  res.json(stripUser(u));
});

// Change password (Settings)
router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const ok = await bcrypt.compare(currentPassword, u.password);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  u.password = await bcrypt.hash(newPassword, 10);
  users.set(req.userId, u);
  res.json({ ok: true });
});

// Delete my account (Settings)
router.delete('/me', auth, (req, res) => {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const id = req.userId;
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
  for (let i = posts.length - 1; i >= 0; i--) {
    if (posts[i].userId === id) posts.splice(i, 1);
  }
  res.json({ ok: true });
});

// Discover / filter users (sorted by shared interests + proximity)
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
    return { ...stripUser(u), sharedInterests: shared, online: (Date.now() - (u.lastSeen || 0)) < ONLINE_MS };
  });
  list.sort((a, b) => b.sharedInterests - a.sharedInterests);

  res.json(list);
});

// Auto-match suggestions: people who are "close" (same university/location)
// and share interests, ranked by a combined compatibility score.
router.get('/suggestions', auth, (req, res) => {
  const me = users.get(req.userId);
  if (!me) return res.status(404).json({ error: 'Not found' });
  const myInterests = new Set(me.interests || []);

  const scored = Array.from(users.values())
    .filter(u => u.id !== me.id)
    .map(u => {
      const shared = (u.interests || []).filter(i => myInterests.has(i)).length;
      let score = shared * 10;                 // interests weigh most
      if (u.county === me.county) score += 30; // same university
      if (u.subcounty === me.subcounty) score += 15; // same location
      if (u.lookingFor === me.lookingFor) score += 5;
      const sharedPct = myInterests.size ? Math.round((shared / myInterests.size) * 100) : 0;
      return {
        ...stripUser(u),
        sharedInterests: shared,
        matchScore: score,
        matchPercent: Math.min(99, sharedPct + (u.county === me.county ? 30 : 0) + (u.subcounty === me.subcounty ? 15 : 0)),
        online: (Date.now() - (u.lastSeen || 0)) < ONLINE_MS
      };
    })
    .filter(x => x.matchScore >= 15) // only meaningfully compatible people
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 20);

  res.json(scored);
});

// View another user's public profile + their posts (and record the profile visit)
router.get('/profile/:id', auth, (req, res) => {
  const u = users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });

  // Record this profile visit (TikTok-style "who viewed me") — skip self-views
  if (req.params.id !== req.userId) {
    profileViews.push({ id: require('uuid').v4(), viewerId: req.userId, viewedId: req.params.id, ts: Date.now() });
    if (profileViews.length > 5000) profileViews.splice(0, profileViews.length - 5000);
    notify(req.params.id, 'profile_view', `👀 ${users.get(req.userId) ? users.get(req.userId).name : 'Someone'} viewed your profile`, req.userId);
  }

  const theirPosts = posts
    .filter(p => p.userId === u.id)
    .sort((a, b) => b.ts - a.ts)
    .map(p => serializePost(p, req.userId));
  res.json({
    user: { ...stripUser(u), online: (Date.now() - (u.lastSeen || 0)) < ONLINE_MS },
    posts: theirPosts
  });
});

// Who viewed my profile (most recent first, with dedupe by viewer)
router.get('/profile-views', auth, (req, res) => {
  const me = req.userId;
  const seen = new Map(); // viewerId -> latest ts
  for (const v of profileViews) {
    if (v.viewedId !== me || v.viewerId === me) continue;
    const cur = seen.get(v.viewerId);
    if (!cur || v.ts > cur.ts) seen.set(v.viewerId, v.ts);
  }
  const list = Array.from(seen.entries())
    .map(([viewerId, ts]) => {
      const u = users.get(viewerId);
      return u
        ? { ...stripUser(u), viewedAt: ts, online: (Date.now() - (u.lastSeen || 0)) < ONLINE_MS }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.viewedAt - a.viewedAt);
  res.json(list);
});

// Recently joined members (for the dashboard)
router.get('/recent', auth, (req, res) => {
  res.json(
    Array.from(users.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8)
      .map(u => ({ ...stripUser(u), online: (Date.now() - (u.lastSeen || 0)) < ONLINE_MS }))
  );
});

// Who is online right now
router.get('/online', auth, (req, res) => {
  res.json(
    Array.from(users.values())
      .filter(u => u.id !== req.userId && (Date.now() - (u.lastSeen || 0)) < ONLINE_MS)
      .map(u => stripUser(u))
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
  let profileViewCount = 0;
  const seen = new Set();
  profileViews.forEach(v => { if (v.viewedId === me && v.viewerId !== me && !seen.has(v.viewerId)) { seen.add(v.viewerId); profileViewCount++; } });
  res.json({ matches: myMatches, likesReceived, unreadMessages, myPosts, profileViews: profileViewCount });
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
  } else {
    notify(target, 'like', `❤️ ${users.get(req.userId) ? users.get(req.userId).name : 'Someone'} liked you`, req.userId);
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
