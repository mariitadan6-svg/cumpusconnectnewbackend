const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { messages, users, chatReplies } = require('../data/store');
const { auth } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { checkChatSend, isSubscribed, FREE_LIMITS } = require('../utils/monetization');
// (isSubscribed used to expose verified badge on conversation partners)

const router = express.Router();

// Server-side authoritative check: never allow digits (any script) in a chat
// message. Prevents members from sharing phone numbers / contacts, even if
// they tamper with the client.
const NUMERIC_BLOCK_REGEX = /[0-9\u0660-\u0669\u06F0-\u06F9\u07C0-\u07C9\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F\u0E50-\u0E59\u0ED0-\u0ED9\u0F20-\u0F29\u1040-\u1049\u1090-\u1099\u17E0-\u17E9\u1810-\u1819\u2460-\u2468\u24EA\u2776-\u277E]/;
const NUMERIC_WORDS = new Set(['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','hundred','thousand']);
function containsBlockedNumbers(text){
  if (!text) return false;
  if (NUMERIC_BLOCK_REGEX.test(text)) return true;
  const words = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let run = 0;
  for (const w of words){
    if (NUMERIC_WORDS.has(w) || w === 'oh'){ run++; if (run >= 3) return true; }
    else run = 0;
  }
  return false;
}

router.post('/send', auth, (req, res) => {
  const { to, text, image } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to required' });
  const cleanText = (text || '').toString().trim();
  const hasImage = typeof image === 'string' && image.startsWith('data:image/');
  if (!cleanText && !hasImage) return res.status(400).json({ error: 'text or image required' });
  if (!users.has(to)) return res.status(404).json({ error: 'Recipient not found' });

  // Numbers / contacts in chat text are allowed ONLY for verified (subscribed)
  // members. Fetch the sender up-front so this check and the gating below
  // share the same user object.
  const me = users.get(req.userId);
  if (!me) return res.status(401).json({ error: 'Session expired — please log in again.' });
  if (cleanText && !isSubscribed(me) && containsBlockedNumbers(cleanText)){
    return res.status(400).json({ error: 'Sharing numbers in messages is a verified feature. Subscribe to include numbers.' });
  }
  // Cap payload size to keep the JSON store healthy (~8MB per image after
  // client compression is already applied).
  if (hasImage && image.length > 8 * 1024 * 1024){
    return res.status(400).json({ error: 'Image is too large' });
  }

  // ============= Subscription / credits gating =============
  const threadKey = `${req.userId}:${to}`;
  const threadFreeUsed = chatReplies.get(threadKey) || 0;
  const gate = checkChatSend(me, threadFreeUsed);
  if (!gate.ok) {
    return res.status(402).json({ error: gate.reason, code: gate.code });
  }
  // Deduct one credit if this message is past the free allowance
  if (gate.chargeCredit) {
    if ((me.credits || 0) <= 0) return res.status(402).json({ error: 'Not enough credits. Buy credits to continue.', code: 'need_credits' });
    me.credits = (me.credits || 0) - 1;
  }
  // Consume one free message from the current subscription period and track
  // the per-thread free counter (max FREE_LIMITS.freeRepliesPerChat per chat).
  if (gate.consumeFree) {
    me.freeMessagesUsed = (me.freeMessagesUsed || 0) + 1;
    chatReplies.set(threadKey, threadFreeUsed + 1);
  }
  users.set(req.userId, me);
  // =========================================================

  const msg = {
    id: uuidv4(),
    from: req.userId,
    to,
    text: cleanText,
    image: hasImage ? image : '',
    ts: Date.now(),
    read: false
  };
  messages.push(msg);
  // Notify the recipient so they know someone texted them
  const preview = hasImage && !cleanText ? '📷 sent you a photo' : 'sent you a message';
  notify(to, 'message', `💬 ${me ? me.name : 'Someone'} ${preview}`, req.userId);
  res.json({ ...msg, credits: me.credits, chargedCredit: !!gate.chargeCredit });
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
    safe.verified = isSubscribed(u);
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
