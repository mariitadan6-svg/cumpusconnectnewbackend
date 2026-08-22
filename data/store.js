// In-memory data store WITH disk persistence.
// No native modules (avoids better-sqlite3 gyp/make build errors on Render).
// Everything is mirrored to a JSON file on disk (debounced) and loaded back on
// boot, so a free-tier restart/sleep NEVER loses users, payments or messages.
const fs = require('fs');
const path = require('path');

const users = new Map();       // userId -> user object
const emails = new Map();      // email -> userId
const messages = [];           // {id, from, to, text, ts, read}
const likes = new Map();       // userId -> Set of liked userIds
const matches = [];            // {id, userA, userB, ts}
const posts = [];              // {id, userId, text, mediaType, mediaData, ts, likes:Set, dislikes:Set, comments:[]}
const notifications = [];      // {id, to, type, text, fromId, fromName, ts, readBy:Set}
const profileViews = [];       // {id, viewerId, viewedId, ts}
const stories = [];            // {id, userId, mediaType, mediaData, caption, ts, viewers:Set}

// ===== Monetization stores (subscription/credits/KCB payments) =====
const payments = new Map();    // paymentId -> {...}
const kcbRefIndex = new Map(); // kcb checkoutRequestID/merchantRequestID -> paymentId
const chatReplies = new Map(); // `${userId}:${otherId}` -> number of free replies used
const hookupChatUnlocks = new Map(); // `${userId}:${targetHookupUserId}` -> { ts } — one-time per-member chat unlock

// ---------------------------------------------------------------------------
// PERSISTENCE (Render free tier has an ephemeral disk, but it survives sleep
// cycles within the same deploy — enough to stop the data-loss on wake).
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
let saveTimer = null;

function serialize() {
  const likesObj = {};
  for (const [k, s] of likes.entries()) likesObj[k] = Array.from(s);
  return {
    savedAt: Date.now(),
    users: Array.from(users.values()),
    emails: Array.from(emails.entries()),
    messages,
    likes: likesObj,
    matches,
    posts: posts.map(p => ({ ...p, likes: Array.from(p.likes || []), dislikes: Array.from(p.dislikes || []) })),
    notifications: notifications.map(n => ({ ...n, readBy: Array.from(n.readBy || []) })),
    profileViews,
    stories: stories.map(s => ({ ...s, viewers: Array.from(s.viewers || []) })),
    payments: Array.from(payments.values()),
    kcbRefIndex: Array.from(kcbRefIndex.entries()),
    chatReplies: Array.from(chatReplies.entries()),
    hookupChatUnlocks: Array.from(hookupChatUnlocks.entries())
  };
}

// ASYNC save: serializing + writing the whole store SYNCHRONOUSLY blocked
// Node's event loop on every successful write (this fired after every single
// POST/PUT/PATCH/DELETE) and is what made the whole API crawl under load.
// The async version keeps responses instant no matter how many users write
// at the same time. The file replace stays atomic-ish (tmp + rename).
function saveNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    const data = JSON.stringify(serialize());
    fs.writeFile(tmp, data, (err) => {
      if (err) { console.error('Store save failed:', err.message); return; }
      fs.rename(tmp, DATA_FILE, (err2) => { if (err2) console.error('Store save failed:', err2.message); });
    });
  } catch (e) {
    console.error('Store save failed:', e.message);
  }
}

// Synchronous flush used ONLY on process shutdown, where async writes may
// never complete.
function flushSync() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serialize()));
    fs.renameSync(tmp, DATA_FILE); // atomic-ish replace
  } catch (e) {
    console.error('Store save failed:', e.message);
  }
}

// Debounced save — coalesces bursts of writes into one disk hit.
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 5000);
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return false;
    const s = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(s.users)) for (const u of s.users) if (u && u.id) users.set(u.id, u);
    if (Array.isArray(s.emails)) for (const [e, id] of s.emails) emails.set(e, id);
    if (Array.isArray(s.messages)) messages.push(...s.messages);
    if (s.likes && typeof s.likes === 'object') for (const [k, arr] of Object.entries(s.likes)) likes.set(k, new Set(arr));
    if (Array.isArray(s.matches)) matches.push(...s.matches);
    if (Array.isArray(s.posts)) for (const p of s.posts) posts.push({ ...p, likes: new Set(p.likes || []), dislikes: new Set(p.dislikes || []), comments: p.comments || [] });
    if (Array.isArray(s.notifications)) for (const n of s.notifications) notifications.push({ ...n, readBy: new Set(n.readBy || []) });
    if (Array.isArray(s.profileViews)) profileViews.push(...s.profileViews);
    if (Array.isArray(s.stories)) for (const st of s.stories) stories.push({ ...st, viewers: new Set(st.viewers || []) });
    if (Array.isArray(s.payments)) for (const p of s.payments) if (p && p.id) payments.set(p.id, p);
    if (Array.isArray(s.kcbRefIndex)) for (const [k, v] of s.kcbRefIndex) kcbRefIndex.set(k, v);
    if (Array.isArray(s.chatReplies)) for (const [k, v] of s.chatReplies) chatReplies.set(k, v);
    if (Array.isArray(s.hookupChatUnlocks)) for (const [k, v] of s.hookupChatUnlocks) hookupChatUnlocks.set(k, v);
    console.log(`Store loaded from disk: ${users.size} users, ${payments.size} payments, ${messages.length} messages`);
    return true;
  } catch (e) {
    console.error('Store load failed:', e.message);
    return false;
  }
}

// Flush on shutdown so nothing is dropped (sync: async may not finish here).
process.on('SIGTERM', flushSync);
process.on('SIGINT', flushSync);

module.exports = {
  users, emails, messages, likes, matches, posts, notifications, profileViews, stories,
  payments, kcbRefIndex, chatReplies, hookupChatUnlocks,
  persist, saveNow, loadFromDisk
};
