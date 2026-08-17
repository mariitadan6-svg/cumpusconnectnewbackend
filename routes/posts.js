const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { posts, users } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { checkPostMedia, isSubscribed } = require('../utils/monetization');

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
      ? { id: a.id, name: a.name, photo: a.photo || '', county: a.county, verified: isSubscribed(a) }
      : { id: '', name: 'Unknown', photo: '', county: '', verified: false },
    likeCount: p.likes ? p.likes.size : 0,
    dislikeCount: p.dislikes ? p.dislikes.size : 0,
    likedByMe: meId && p.likes ? p.likes.has(meId) : false,
    dislikedByMe: meId && p.dislikes ? p.dislikes.has(meId) : false,
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
  if (mediaData && typeof mediaData === 'string' && mediaData.length > 24 * 1024 * 1024) {
    return res.status(400).json({ error: 'Media too large (max ~18MB)' });
  }

  // Gate: unpaid members may post at most FREE_LIMITS.maxPostMedia media posts total.
  const me = users.get(req.userId);
  if (mediaData) {
    const currentMediaCount = posts.filter(p => p.userId === req.userId && p.mediaData).length;
    const gate = checkPostMedia(me, true, currentMediaCount);
    if (!gate.ok) return res.status(402).json({ error: gate.reason, code: gate.code });
  }

  const post = {
    id: uuidv4(),
    userId: req.userId,
    text: (text || '').trim(),
    mediaType: mediaData ? mediaType : null,
    mediaData: mediaData || '',
    ts: Date.now(),
    likes: new Set(),
    dislikes: new Set(),
    comments: []
  };
  posts.push(post);
  if (mediaData && me) { me.mediaPostsUsed = (me.mediaPostsUsed || 0) + 1; users.set(req.userId, me); }
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

// Edit my own post (text update; keeps media & engagement)
router.put('/:id', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  if (p.userId !== req.userId) return res.status(403).json({ error: 'Not your post' });
  const { text } = req.body;
  if (text === undefined || !text.trim()) return res.status(400).json({ error: 'Text required' });
  p.text = text.trim();
  res.json(serialize(p, req.userId));
});

// Like / unlike a post
router.post('/:id/like', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  let liked;
  if (p.likes.has(req.userId)) { p.likes.delete(req.userId); liked = false; }
  else {
    p.likes.add(req.userId); liked = true;
    // liking removes a dislike if present
    if (p.dislikes) p.dislikes.delete(req.userId);
    if (p.userId !== req.userId) {
      const me = users.get(req.userId);
      notify(p.userId, 'post_like', `❤️ ${me ? me.name : 'Someone'} liked your post`, req.userId);
    }
  }
  res.json({ liked, likeCount: p.likes.size, dislikeCount: p.dislikes ? p.dislikes.size : 0 });
});

// Dislike / undo-dislike a post (thumbs-down, independent counter)
router.post('/:id/dislike', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  let disliked;
  if (p.dislikes.has(req.userId)) { p.dislikes.delete(req.userId); disliked = false; }
  else {
    p.dislikes.add(req.userId); disliked = true;
    // disliking removes a like if present
    if (p.likes) p.likes.delete(req.userId);
  }
  res.json({ disliked, likeCount: p.likes.size, dislikeCount: p.dislikes.size });
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

// Delete a comment (author of comment OR post owner may delete)
router.delete('/:id/comment/:commentId', auth, (req, res) => {
  const p = posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const c = (p.comments || []).find(c => c.id === req.params.commentId);
  if (!c) return res.status(404).json({ error: 'Comment not found' });
  if (c.userId !== req.userId && p.userId !== req.userId) {
    return res.status(403).json({ error: 'Not allowed to delete this comment' });
  }
  p.comments = p.comments.filter(x => x.id !== req.params.commentId);
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
