// In-memory data store (production-safe for demo/starter deployment)
// No native modules (avoids better-sqlite3 gyp/make build errors on Render)
const users = new Map();       // userId -> user object
const emails = new Map();      // email -> userId
const messages = [];           // {id, from, to, text, ts}
const likes = new Map();       // userId -> Set of liked userIds
const matches = [];            // {id, userA, userB, ts}

module.exports = { users, emails, messages, likes, matches };
