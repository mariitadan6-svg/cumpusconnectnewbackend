const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { users, emails } = require('../data/store');
const { JWT_SECRET } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();

// Register - creates account with email + password during profile setup
router.post('/register', async (req, res) => {
  try {
    const {
      email, password, name, age, gender, interestedIn,
      lookingFor, county, subcounty, bio, interests, confirmAge18
    } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!confirmAge18) {
      return res.status(400).json({ error: 'You must confirm you are 18 years or older' });
    }
    if (age && Number(age) < 18) {
      return res.status(400).json({ error: 'You must be at least 18 years old' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!name || !county || !lookingFor) {
      return res.status(400).json({ error: 'Missing required profile fields' });
    }

    const normEmail = email.toLowerCase().trim();

    const hashed = await bcrypt.hash(password, 10);

    // Duplicate-email guard placed AFTER the async hashing and checked again
    // right before the insert, in the same synchronous block. Two simultaneous
    // requests can therefore never both pass — only one profile is ever created.
    if (emails.has(normEmail)) {
      return res.status(409).json({ error: 'This email is already registered — please log in instead.' });
    }

    const userId = uuidv4();
    const user = {
      id: userId,
      email: normEmail,
      password: hashed,
      name,
      age: Number(age) || 18,
      gender: gender || 'other',
      interestedIn: interestedIn || 'everyone',
      lookingFor, // 'hookup' | 'friendship' | 'dating'
      county,
      subcounty: subcounty || '',
      bio: bio || '',
      interests: Array.isArray(interests) ? interests : [],
      photo: typeof req.body.photo === 'string' ? req.body.photo : '', // profile picture captured at signup
      photos: [],
      // Extra fields collected at signup when the member picks the Hookup vibe.
      // Only stored when provided so Dating/Friendship signups stay untouched.
      hookupDetails: (lookingFor === 'hookup' && req.body.hookupDetails && typeof req.body.hookupDetails === 'object')
        ? {
            meetup:      String(req.body.hookupDetails.meetup || '').slice(0, 60),
            host:        String(req.body.hookupDetails.host || '').slice(0, 30),
            available:   String(req.body.hookupDetails.available || '').slice(0, 40),
            smoker:      String(req.body.hookupDetails.smoker || '').slice(0, 20),
            drinks:      String(req.body.hookupDetails.drinks || '').slice(0, 20),
            expectations:String(req.body.hookupDetails.expectations || '').slice(0, 500)
          }
        : null,
      // Monetization state (subscription + credits + DM starts counter)
      subscription: { active: false, plan: null, activatedAt: 0, expiresAt: 0 },
      hookupUnlocked: false, // one-time KES 100 unlock for the Hookup page
      verified: false,
      credits: 0,
      dmStartsUsed: 0,
      mediaPostsUsed: 0,
      settings: {
        notifyMatches: true,
        notifyMessages: true,
        notifyLikes: true,
        notifyComments: true,
        notifyProfileViews: true,
        showOnlineStatus: true,
        sounds: true
      },
      lastSeen: Date.now(),
      createdAt: Date.now()
    };
    users.set(userId, user);
    emails.set(normEmail, userId);

    // Broadcast to everyone that a new member joined
    notify('all', 'join', `🎉 ${name} just joined CampusConnect — say hi!`, userId);

    // Welcome inbox messages across genders: when a BOY joins, every GIRL gets
    // an inbox message from him; when a GIRL joins, she gets one from every BOY.
    // Stored as normal unread messages so they appear in the inbox (badge + thread).
    const { messages: joinMessages } = require('../data/store');
    const welcomeText = `Say hello 👋 — ${name} has just joined CampusConnect!`;
    for (const u of users.values()) {
      if (u.id === userId) continue;
      if (user.gender === 'male' && u.gender === 'female') {
        joinMessages.push({ id: uuidv4(), from: userId, to: u.id, text: welcomeText, image: '', ts: Date.now(), read: false });
        notify(u.id, 'message', `💬 ${name} sent you a message`, userId);
      } else if (user.gender === 'female' && u.gender === 'male') {
        joinMessages.push({ id: uuidv4(), from: u.id, to: userId, text: welcomeText, image: '', ts: Date.now(), read: false });
        notify(userId, 'message', `💬 ${u.name} sent you a message`, u.id);
      }
    }

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const normEmail = email.toLowerCase().trim();
    const userId = emails.get(normEmail);
    if (!userId) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = users.get(userId);
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check email
router.post('/check-email', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const inUse = emails.has(email.toLowerCase().trim());
  res.json({ inUse });
});

module.exports = router;
