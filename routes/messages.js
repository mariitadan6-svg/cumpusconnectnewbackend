const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { messages, users } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();

router.post('/send', auth, (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'to and text required' });
  if (!users.has(to)) return res.status(404).json({ error: 'Recipient not found' });
  const msg = { id: uuidv4(), from: req.userId, to, text, ts: Date.now(), read: false };
  messages.push(msg);
  const me = users.get(req.userId);
  // Notify the recipient so they know someone texted them
  notify(to, 'message', `💬 ${me ? me.name : 'Someone'} sent you a message`, req.userId);
  res.json(msg);
});

router.get('/with/:userId', auth, (req, res) => {
  const other = req.params.userId;
  const thread = messages
    .filter(m =>
      (m.from === req.userId && m.to === other) ||
      (m.from === other && m.to === req.userId)
    )
    .sort((a, b) => a.ts - b.ts);
  res.json(thread);
});

// Professional inbox: every conversation with last message, unread count, online state
router.get('/conversations', auth, (req, res) => {
  const me = req.userId;
  const partners = new Map(); // partnerId -> {lastMessage, unread}
  for (const m of messages) {
    if (m.from !== me && m.to !== me) continue;
    const other = m.from === me ? m.to : m.from;
    const cur = partners.get(other) || { lastMessage: null, unread: 0 };
    if (!cur.lastMessage || m.ts > cur.lastMessage.ts) cur.lastMessage = m;
    if (m.to === me && !m.read) cur.unread++;
    partners.set(other, cur);
  }
  const list = Array.from(partners.entries()).map(([pid, info]) => {
    const u = users.get(pid);
    if (!u) return null;
    const { password, ...safe } = u;
    return {
      user: safe,
      lastMessage: info.lastMessage,
      unread: info.unread,
      online: (Date.now() - (u.lastSeen || 0)) < 120000
    };
  }).filter(Boolean).sort((a, b) => ((b.lastMessage && b.lastMessage.ts) || 0) - ((a.lastMessage && a.lastMessage.ts) || 0));
  res.json(list);
});

// Mark a whole thread as read
router.post('/read/:userId', auth, (req, res) => {
  const other = req.params.userId;
  let n = 0;
  for (const m of messages) {
    if (m.from === other && m.to === req.userId && !m.read) { m.read = true; n++; }
  }
  res.json({ ok: true, marked: n });
});

// Total unread messages (for the Chat nav badge)
router.get('/unread-count', auth, (req, res) => {
  res.json({ count: messages.filter(m => m.to === req.userId && !m.read).length });
});

module.exports = router;
