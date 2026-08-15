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
    if (!name || !county || !subcounty || !lookingFor) {
      return res.status(400).json({ error: 'Missing required profile fields' });
    }

    const normEmail = email.toLowerCase().trim();
    if (emails.has(normEmail)) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashed = await bcrypt.hash(password, 10);
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
      subcounty,
      bio: bio || '',
      interests: Array.isArray(interests) ? interests : [],
      photo: '',
      photos: [],
      lastSeen: Date.now(),
      createdAt: Date.now()
    };
    users.set(userId, user);
    emails.set(normEmail, userId);

    // Broadcast to everyone that a new member joined
    notify('all', 'join', `🎉 ${name} just joined CampusConnect — say hi!`, userId);

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
