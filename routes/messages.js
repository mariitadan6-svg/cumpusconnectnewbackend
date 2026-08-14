const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { messages, users } = require('../data/store');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/send', auth, (req, res) => {
  const { to, text } = req.body;
  if (!to || !text) return res.status(400).json({ error: 'to and text required' });
  if (!users.has(to)) return res.status(404).json({ error: 'Recipient not found' });
  const msg = { id: uuidv4(), from: req.userId, to, text, ts: Date.now() };
  messages.push(msg);
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

module.exports = router;
