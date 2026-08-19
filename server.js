const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const metaRoutes = require('./routes/meta');
const chatbotRoutes = require('./routes/chatbot');
const adminRoutes = require('./routes/admin');
const postRoutes = require('./routes/posts');
const notificationRoutes = require('./routes/notifications');
const billingRoutes = require('./routes/billing');
const storyRoutes = require('./routes/stories');

const app = express();
const PORT = process.env.PORT || 5000;

// Helmet with relaxed CSP so inline scripts (admin panel, frontend) work
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression()); // gzip all JSON/static responses — much faster on mobile networks

// CORS lockdown: only your own frontends may call the API cross-origin.
// Set ALLOWED_ORIGINS in Render as a comma-separated list, e.g.
//   ALLOWED_ORIGINS=https://yourapp.netlify.app,https://your-admin.netlify.app
// Same-origin calls (the Netlify proxy) carry no Origin header and always pass.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
// Your Netlify sites (frontend + vault admin) are ALWAYS allowed, even if
// ALLOWED_ORIGINS is not configured on Render. This prevents the CORS 500 that
// disconnected the Netlify admin panel from the backend. Any extra origins you
// set in ALLOWED_ORIGINS are added on top. A blocked origin now returns a clean
// 403 JSON instead of an unhandled 500, so the frontend can show a real message.
['https://cumpusadmin.netlify.app'].forEach(o => {
  if (allowedOrigins.indexOf(o) === -1) allowedOrigins.push(o);
});
app.use(cors({
  origin: function (origin, cb) {
    // No Origin header => same-origin (Netlify proxy), curl, or server-to-server => allow.
    if (!origin) return cb(null, true);
    // If no allow-list is configured yet, stay permissive so nothing breaks.
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return cb(null, true);
    // Clean, non-crashing rejection (403) instead of an unhandled 500 error.
    return cb(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '25mb' })); // raised for photo/video uploads as data URLs

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000, // raised: the app polls regularly, so 500/15min caused 429 lockouts
  standardHeaders: true,
  legacyHeaders: false,
  // ALWAYS answer with JSON so clients never crash parsing the plain-text
  // "Too many requests" body ("Unexpected token 'T' ... is not valid JSON")
  handler: (req, res) => res.status(429).json({ error: 'Server is busy — please wait a few seconds and try again.' })
});
app.use('/api/', limiter);

// Auto-persist: after any successful write, save the in-memory store to disk
// (debounced) so a free-tier sleep/restart never loses users or payments.
const { persist } = require('./data/store');
app.use((req, res, next) => {
  res.on('finish', () => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) persist();
  });
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api', (req, res) => {
  res.json({
    name: 'CampusConnect API',
    version: '1.1.0',
    status: 'running'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/stories', storyRoutes);

// KCB Buni STK Push callback — also accepted at the bare /callback path so
// the KCB_CALLBACK_URL configured on the merchant portal can point either
// to /callback or /api/billing/callback and both will work.
app.post('/callback', express.json({ limit: '2mb' }), billingRoutes.kcbCallback);

// Serve the admin panel on a NON-OBVIOUS, configurable path so it is not
// discoverable by guessing "/admin". Set ADMIN_PATH on Render (e.g.
// "/manage-x7k2p9q4") — the default here is already non-guessable.
const ADMIN_PATH = process.env.ADMIN_PATH || '/manage-x7k2p9q4';
app.use(ADMIN_PATH, express.static(path.join(__dirname, 'public', 'admin'), { maxAge: '1h' }));
// API-only root response (frontend lives on Netlify) — do NOT advertise the
// admin path or route list here.
app.get('/', (req, res) => {
  res.json({
    name: 'CampusConnect API',
    version: '1.0.0',
    status: 'running'
  });
});

// Restore the persisted store FIRST (survives free-tier sleep/restart so users
// are never "logged out" by data loss), then seed demo users ONLY when there is
// genuinely no saved data (true first deploy).
const { loadFromDisk, users: _seedCheck } = require('./data/store');
loadFromDisk();
if (_seedCheck.size === 0) (async () => {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const { users, emails } = require('./data/store');
  const demo = [
    { name: 'Amina W.', age: 22, gender: 'female', lookingFor: 'dating', county: 'University of Nairobi', subcounty: 'Nairobi', bio: 'Coffee lover, dreamer, hiking on weekends.', interests: ['coffee', 'hiking', 'music'] },
    { name: 'Brian K.', age: 24, gender: 'male', lookingFor: 'friendship', county: 'Jomo Kenyatta University of Agriculture and Technology (JKUAT)', subcounty: 'Juja', bio: 'Software dev. Looking for study buddies.', interests: ['tech', 'coding', 'football'] },
    { name: 'Cynthia N.', age: 21, gender: 'female', lookingFor: 'hookup', county: 'Maseno University', subcounty: 'Maseno', bio: 'Confident and adventurous.', interests: ['dance', 'nightlife', 'travel'] },
    { name: 'Dennis O.', age: 26, gender: 'male', lookingFor: 'dating', county: 'Egerton University', subcounty: 'Njoro', bio: 'Photographer, foodie, dog dad.', interests: ['photography', 'food', 'dogs'] },
    { name: 'Esther M.', age: 23, gender: 'female', lookingFor: 'friendship', county: 'Kenyatta University', subcounty: 'Nairobi', bio: 'Book worm & tea addict.', interests: ['books', 'tea', 'movies'] },
    { name: 'Felix R.', age: 25, gender: 'male', lookingFor: 'hookup', county: 'Strathmore University', subcounty: 'Nairobi', bio: 'Gym rat, no strings.', interests: ['gym', 'nightlife', 'cars'] },
    { name: 'Grace A.', age: 20, gender: 'female', lookingFor: 'dating', county: 'Moi University', subcounty: 'Eldoret', bio: 'Med student. Faith, family, fun.', interests: ['medicine', 'faith', 'music'] },
    { name: 'Hussein A.', age: 27, gender: 'male', lookingFor: 'friendship', county: 'Technical University of Mombasa', subcounty: 'Mombasa', bio: 'Sailor, foodie, storyteller.', interests: ['sailing', 'food', 'travel'] }
  ];
  const seededIds = [];
  for (const d of demo) {
    const id = uuidv4();
    const email = `${d.name.toLowerCase().split(' ')[0]}@demo.cc`;
    users.set(id, {
      id, email, password: await bcrypt.hash('demo1234', 10),
      ...d, interestedIn: 'everyone', photo: '', photos: [], lastSeen: Date.now(), createdAt: Date.now(),
      subscription: { active: false, plan: null, activatedAt: 0, expiresAt: 0 },
      verified: false, credits: 0, dmStartsUsed: 0, mediaPostsUsed: 0
    });
    emails.set(email, id);
    seededIds.push(id);
  }
  console.log(`Seeded ${demo.length} demo users`);

  // Seed a few community posts so the feed isn't empty on first deploy
  const { posts } = require('./data/store');
  const seedPosts = [
    'Karibu CampusConnect! 🎉 Say hi to the community 👋',
    'Weekend vibes! Who is around Nairobi this Saturday? ☀️',
    'Just joined — looking forward to meeting amazing people here ❤️',
    'Anyone up for a coffee hangout in Westlands? ☕',
    'You can now post photos & videos on the feed! 📸🎬'
  ];
  seedPosts.forEach((text, i) => {
    posts.push({ id: uuidv4(), userId: seededIds[i % seededIds.length], text, mediaType: null, mediaData: '', ts: Date.now() - (i + 1) * 3600000, likes: new Set(), dislikes: new Set(), comments: [] });
  });
  console.log(`Seeded ${seedPosts.length} demo posts`);
})();

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 CampusConnect API listening on port ${PORT}`);
  console.log(`🔐 Admin panel served at: ${ADMIN_PATH}  (keep this path secret)`);
});
