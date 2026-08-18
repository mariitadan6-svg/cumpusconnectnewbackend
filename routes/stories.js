const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { users } = require('../data/store');
const { auth } = require('../middleware/auth');

const router = express.Router();

// In-memory stories (Instagram-style, auto-expire after 24 hours).
// Kept intentionally simple and isolated so it doesn't touch the persisted store.
const stories = []; // { id, userId, mediaType:'image'|'video', mediaData, ts, viewers:Set }

function prune() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (let i = stories.length - 1; i >= 0; i--) {
    if (stories[i].ts < cutoff) stories.splice(i, 1);
  }
}

function serialize(s, meId) {
  const u = users.get(s.userId);
  return {
    id: s.id,
    userId: s.userId,
    mediaType: s.mediaType,
    mediaData: s.mediaData,
    ts: s.ts,
    expiresAt: s.ts + 24 * 60 * 60 * 1000,
    viewed: meId ? s.viewers.has(meId) : false,
    mine: meId === s.userId,
    author: u ? { id: u.id, name: u.name, photo: u.photo || '' } : { id: '', name: 'Unknown', photo: '' }
  };
}

// Feed of active stories, grouped by author (most recent activity first).
router.get('/', auth, (req, res) => {
  prune();
  const grouped = {};
  stories.slice().sort((a, b) => a.ts - b.ts).forEach(s => {
    if (!grouped[s.userId]) grouped[s.userId] = { userId: s.userId, author: null, items: [], lastTs: 0, allViewed: true };
    grouped[s.userId].items.push(serialize(s, req.userId));
    grouped[s.userId].lastTs = Math.max(grouped[s.userId].lastTs, s.ts);
    if (!s.viewers.has(req.userId)) grouped[s.userId].allViewed = false;
  });
  Object.values(grouped).forEach(g => {
    const u = users.get(g.userId);
    g.author = u ? { id: u.id, name: u.name, photo: u.photo || '' } : { id: g.userId, name: 'Unknown', photo: '' };
  });
  // Put my stories first, then unviewed, then viewed — all sorted by most recent
  const list = Object.values(grouped).sort((a, b) => {
    if (a.userId === req.userId && b.userId !== req.userId) return -1;
    if (b.userId === req.userId && a.userId !== req.userId) return 1;
    if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    return b.lastTs - a.lastTs;
  });
  res.json(list);
});

// Create a new story
router.post('/', auth, (req, res) => {
  const { mediaType, mediaData } = req.body || {};
  if (!mediaData || !['image', 'video'].includes(mediaType)) {
    return res.status(400).json({ error: 'Story needs an image or video' });
  }
  if (typeof mediaData === 'string' && mediaData.length > 24 * 1024 * 1024) {
    return res.status(400).json({ error: 'Story media too large (max ~18MB)' });
  }
  const s = {
    id: uuidv4(),
    userId: req.userId,
    mediaType,
    mediaData,
    ts: Date.now(),
    viewers: new Set()
  };
  stories.push(s);
  prune();
  res.json(serialize(s, req.userId));
});

// Mark a story as viewed
router.post('/:id/view', auth, (req, res) => {
  const s = stories.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Story not found' });
  s.viewers.add(req.userId);
  res.json({ ok: true });
});

// Delete my own story
router.delete('/:id', auth, (req, res) => {
  const i = stories.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Story not found' });
  if (stories[i].userId !== req.userId) return res.status(403).json({ error: 'Not your story' });
  stories.splice(i, 1);
  res.json({ ok: true });
});

module.exports = router;
