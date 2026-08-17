// In-memory data store (production-safe for demo/starter deployment)
// No native modules (avoids better-sqlite3 gyp/make build errors on Render)
const users = new Map();       // userId -> user object
const emails = new Map();      // email -> userId
const messages = [];           // {id, from, to, text, ts, read}
const likes = new Map();       // userId -> Set of liked userIds
const matches = [];            // {id, userA, userB, ts}
const posts = [];              // {id, userId, text, mediaType('image'|'video'|null), mediaData(dataURL), ts, likes:Set, dislikes:Set, comments:[{id,userId,text,ts}]}
const notifications = [];      // {id, to('all'|userId), type, text, fromId, fromName, ts, readBy:Set}
const profileViews = [];       // {id, viewerId, viewedId, ts} — who visited whose profile (TikTok-style)

// ===== Monetization stores (added for subscription/credits/KCB payments) =====
const payments = new Map();    // paymentId -> {id, userId, kind, plan, amount, credits, phone, status, checkoutId, merchantId, kcbRef, createdAt, updatedAt, error}
const kcbRefIndex = new Map(); // kcb checkoutRequestID/merchantRequestID -> paymentId (for callback lookup)
const chatReplies = new Map(); // `${userId}:${otherId}` -> number of free replies used in that chat thread

module.exports = {
  users, emails, messages, likes, matches, posts, notifications, profileViews,
  payments, kcbRefIndex, chatReplies
};
