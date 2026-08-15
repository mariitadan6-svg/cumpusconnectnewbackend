const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { posts, users } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();

function serialize(p, meId) {
  const a = users.get(p.userId);
  return {
    id: p.id,
    text: p.text,
    mediaType: p.mediaType,
    mediaData: p.mediaData,
    ts: p.ts,
    author: a
      ? { id: a.id, name: a.name, photo: a.photo || '', county: a.county }
      : { id: '', name: 'Unknown', photo: '', county: '' },
    likeCount: p.likes ? p.likes.size : 0,
    likedByMe: meId && p.likes ? p.likes.has(meId) : false,
    comments: (p.comments || []).map(c => {
      const cu = users.get(c.userId);
      return {
        id: c.id, text: c.text, ts: c.ts, userId: c.userId,
        name: cu ? cu.name : 'Unknown',
        photo: cu ? (cu.photo || '') : ''
      };
    })
  };
}

// Create a post (text and/or photo/video as data URL)
router.post('/', auth, (req, res) => {
  const { text, mediaType, mediaData } = req.body;
  if ((!text || !text.trim()) && !mediaData) {
    return res.status(400).json({ error: 'Post needs text or media' });
  }
  if (mediaData && !['image', 'video'].includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }
  if (mediaData && typeof mediaData === 'string' && mediaData.length > 18 * 1024 * 1024) {
    return res.status(400).json({ error: 'Media too large (max ~12MB)' });
  }
  const post = {
    id: uuidv4(),
    userId: req.userId,
    text: (text || '').trim(),
    mediaType: mediaData ? mediaType : null,
    mediaData: mediaData || '',
    ts: Date.now(),
    likes: new Set(),
    comments: []
  };
  posts.push(post);
  res.json(serialize(post, req.userId));
});

// Community feed (newest first)
router.get('/feed', auth, (req, res) => {
  res.json(posts.slice().sort((a, b) => b.ts - a.ts).slice(0, 100).map(p => serialize(p, req.userId)));
});

// My posts
router.get('/mine', auth, (req, res) => {
  res.json(posts.filter(p => p.userId === req.userId).sort((a, b) => b.ts - a.ts).map(p => serialize(p, req.userId)));
});

// Like / unlike a post
router.post('/:id/like', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  let liked;
  if (p.likes.has(req.userId)) { p.likes.delete(req.userId); liked = false; }
  else {
    p.likes.add(req.userId); liked = true;
    if (p.userId !== req.userId) {
      const me = users.get(req.userId);
      notify(p.userId, 'post_like', `❤️ ${me ? me.name : 'Someone'} liked your post`, req.userId);
    }
  }
  res.json({ liked, likeCount: p.likes.size });
});

// Comment on a post
router.post('/:id/comment', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text required' });
  p.comments.push({ id: uuidv4(), userId: req.userId, text: text.trim(), ts: Date.now() });
  if (p.userId !== req.userId) {
    const me = users.get(req.userId);
    notify(p.userId, 'post_comment', `💬 ${me ? me.name : 'Someone'} commented on your post`, req.userId);
  }
  res.json(serialize(p, req.userId));
});

// Delete my own post
router.delete('/:id', auth, (req, res) => {
  const i = posts.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Post not found' });
  if (posts[i].userId !== req.userId) return res.status(403).json({ error: 'Not your post' });
  posts.splice(i, 1);
  res.json({ ok: true });
});

module.exports = router;
