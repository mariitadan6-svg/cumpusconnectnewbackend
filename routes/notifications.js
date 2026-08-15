const express = require('express');
const { notifications } = require('../data/store');
const { auth } = require('../middleware/auth');

const router = express.Router();

function visibleFor(req) {
  return notifications
    .filter(n => (n.to === 'all' || n.to === req.userId) && n.fromId !== req.userId)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 60);
}

// My notifications
router.get('/', auth, (req, res) => {
  res.json(visibleFor(req).map(n => ({
    id: n.id, type: n.type, text: n.text, fromId: n.fromId, ts: n.ts,
    read: n.readBy.has(req.userId)
  })));
});

// Unread count (for the bell badge)
router.get('/unread-count', auth, (req, res) => {
  res.json({ count: visibleFor(req).filter(n => !n.readBy.has(req.userId)).length });
});

// Mark all as read
router.post('/read', auth, (req, res) => {
  visibleFor(req).forEach(n => n.readBy.add(req.userId));
  res.json({ ok: true });
});

module.exports = router;
