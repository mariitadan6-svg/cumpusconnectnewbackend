const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const metaRoutes = require('./routes/meta');
const chatbotRoutes = require('./routes/chatbot');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

// Helmet with relaxed CSP so inline scripts (admin panel, frontend) work
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use('/api/', limiter);

app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api', (req, res) => {
  res.json({
    name: 'CampusConnect API',
    version: '1.0.0',
    status: 'running',
    endpoints: ['/api/auth', '/api/users', '/api/messages', '/api/meta', '/api/chatbot', '/api/admin']
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/admin', adminRoutes);

// Serve admin panel at /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// Serve frontend static files from public/ (frontend integrated into backend)
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// Seed a few demo users so discovery isn't empty on first deploy
(async () => {
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const { users, emails } = require('./data/store');
  const demo = [
    { name: 'Amina W.', age: 22, gender: 'female', lookingFor: 'dating', county: 'Nairobi', subcounty: 'Westlands', bio: 'Coffee lover, dreamer, hiking on weekends.', interests: ['coffee', 'hiking', 'music'] },
    { name: 'Brian K.', age: 24, gender: 'male', lookingFor: 'friendship', county: 'Mombasa', subcounty: 'Nyali', bio: 'Software dev. Looking for study buddies.', interests: ['tech', 'coding', 'football'] },
    { name: 'Cynthia N.', age: 21, gender: 'female', lookingFor: 'hookup', county: 'Kisumu', subcounty: 'Kisumu Central', bio: 'Confident and adventurous.', interests: ['dance', 'nightlife', 'travel'] },
    { name: 'Dennis O.', age: 26, gender: 'male', lookingFor: 'dating', county: 'Nakuru', subcounty: 'Naivasha', bio: 'Photographer, foodie, dog dad.', interests: ['photography', 'food', 'dogs'] },
    { name: 'Esther M.', age: 23, gender: 'female', lookingFor: 'friendship', county: 'Kiambu', subcounty: 'Ruiru', bio: 'Book worm & tea addict.', interests: ['books', 'tea', 'movies'] },
    { name: 'Felix R.', age: 25, gender: 'male', lookingFor: 'hookup', county: 'Nairobi', subcounty: 'Kilimani', bio: 'Gym rat, no strings.', interests: ['gym', 'nightlife', 'cars'] },
    { name: 'Grace A.', age: 20, gender: 'female', lookingFor: 'dating', county: 'Uasin Gishu', subcounty: 'Ainabkoi', bio: 'Med student. Faith, family, fun.', interests: ['medicine', 'faith', 'music'] },
    { name: 'Hussein A.', age: 27, gender: 'male', lookingFor: 'friendship', county: 'Mombasa', subcounty: 'Mvita', bio: 'Sailor, foodie, storyteller.', interests: ['sailing', 'food', 'travel'] }
  ];
  for (const d of demo) {
    const id = uuidv4();
    const email = `${d.name.toLowerCase().split(' ')[0]}@demo.cc`;
    users.set(id, {
      id, email, password: await bcrypt.hash('demo1234', 10),
      ...d, interestedIn: 'everyone', photo: '', createdAt: Date.now()
    });
    emails.set(email, id);
  }
  console.log(`Seeded ${demo.length} demo users`);
})();

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 CampusConnect API listening on port ${PORT}`);
  console.log(`📱 Frontend: http://localhost:${PORT}/`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
});
