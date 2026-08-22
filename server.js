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
// Trust the first proxy hop (Netlify -> Render). Without this, Express only
// ever sees the Netlify edge IP, so the rate limiter below buckets ALL
// visitors together and a handful of active users exhaust the shared bucket
// -> every visitor gets 429 "Server is busy" at the same time.
app.set('trust proxy', 1);
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
  max: 10000, // generous per-IP bucket: the app polls regularly, and with 'trust proxy' set each real visitor now gets their OWN bucket, so ~1000 concurrent users never trip this — it now only stops genuine single-IP abuse
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
// are never "logged out" by data loss). Demo-account seeding has been REMOVED —
// the platform only ever shows real registered members now.
const { loadFromDisk, saveNow } = require('./data/store');
loadFromDisk();

// Boot self-restore: if this instance boots with an incomplete store (fresh
// ephemeral disk after a redeploy) but the Netlify Vault admin left its latest
// snapshot at .data/vault-export.json (download it from the panel and add it to
// the repo / persistent disk), hydrate EVERYTHING from it — users, emails,
// messages, matches, posts, notifications, profile views, payments, stories —
// so no data ever received is lost. Runs synchronously BEFORE demo seeding so
// real data is never polluted by demo users.
(() => {
  try {
    const fs = require('fs');
    const vaultFile = path.join(process.env.DATA_DIR || path.join(__dirname, '.data'), 'vault-export.json');
    if (!fs.existsSync(vaultFile)) return;
    const s = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
    if (!s || !Array.isArray(s.users)) return;
    const st = require('./data/store');
    const storiesStore = require('./routes/stories').stories || [];
    if (st.users.size >= s.users.length) return; // local store is already complete
    let restored = 0;
    for (const u of s.users) { if (u && u.id && !st.users.has(u.id)) { st.users.set(u.id, u); if (u.email) st.emails.set(u.email, u.id); restored++; } }
    if (Array.isArray(s.emails)) for (const [e, id] of s.emails) { if (e && id && st.users.has(id) && !st.emails.has(e)) st.emails.set(e, id); }
    const seenM = new Set(st.messages.map(m => m.id));
    if (Array.isArray(s.messages)) for (const m of s.messages) { if (m && m.id && !seenM.has(m.id)) { st.messages.push(m); restored++; } }
    st.messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const seenMa = new Set(st.matches.map(m => m.id));
    if (Array.isArray(s.matches)) for (const m of s.matches) { if (m && m.id && !seenMa.has(m.id)) { st.matches.push(m); restored++; } }
    const seenP = new Set(st.posts.map(p => p.id));
    if (Array.isArray(s.posts)) for (const p of s.posts) { if (p && p.id && !seenP.has(p.id)) { st.posts.push({ ...p, likes: new Set(p.likes || []), dislikes: new Set(p.dislikes || []), comments: p.comments || [] }); restored++; } }
    const seenN = new Set(st.notifications.map(n => n.id));
    if (Array.isArray(s.notifications)) for (const n of s.notifications) { if (n && n.id && !seenN.has(n.id)) { st.notifications.push({ ...n, readBy: new Set(n.readBy || []) }); restored++; } }
    const seenV = new Set(st.profileViews.map(v => v.id));
    if (Array.isArray(s.profileViews)) for (const v of s.profileViews) { if (v && v.id && !seenV.has(v.id)) { st.profileViews.push(v); restored++; } }
    for (const p of (s.payments || [])) { if (!p || !p.id) continue; const ex = st.payments.get(p.id); if (!ex || (p.updatedAt || 0) > (ex.updatedAt || 0)) { st.payments.set(p.id, p); restored++; } if (p.checkoutId) st.kcbRefIndex.set(p.checkoutId, p.id); if (p.merchantId) st.kcbRefIndex.set(p.merchantId, p.id); }
    if (Array.isArray(s.chatReplies)) for (const [k, v] of s.chatReplies) { if (!st.chatReplies.has(k)) st.chatReplies.set(k, v); }
    if (Array.isArray(s.hookupChatUnlocks) && st.hookupChatUnlocks) for (const [k, v] of s.hookupChatUnlocks) { if (!st.hookupChatUnlocks.has(k)) st.hookupChatUnlocks.set(k, v); }
    if (Array.isArray(s.stories)) { const seenS = new Set(storiesStore.map(x => x.id)); for (const x of s.stories) { if (x && x.id && !seenS.has(x.id)) storiesStore.push({ ...x, viewers: new Set(x.viewers || []) }); } }
    if (restored > 0) { console.log(`Vault boot-restore: hydrated ${restored} records from vault-export.json`); saveNow(); }
  } catch (e) { console.error('Vault boot-restore skipped:', e.message); }
})();

// (Demo accounts + demo posts seeding removed. No fake users are ever created.)

// Self keep-alive: ping our own /health every 5 minutes so the free-tier
// instance never idles to sleep (and data is never at risk of loss). The URL
// is the public backend address — set SELF_URL on Render (e.g.
// https://your-backend.onrender.com); without it this stays disabled.
const SELF_URL = (process.env.SELF_URL || '').replace(/\/+$/, '');
if (SELF_URL) {
  const ping = () => fetch(`${SELF_URL}/health`).catch(() => {});
  setInterval(ping, 5 * 60 * 1000);
  setTimeout(ping, 30000);
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 CampusConnect API listening on port ${PORT}`);
  console.log(`🔐 Admin panel served at: ${ADMIN_PATH}  (keep this path secret)`);
});
