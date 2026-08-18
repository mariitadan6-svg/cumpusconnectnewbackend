const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// JWT secret: NEVER ship a guessable fallback. If JWT_SECRET is not provided
// via environment, generate a strong ephemeral secret at boot. NOTE: with an
// ephemeral secret, all existing tokens are invalidated on restart — that is
// the safe behaviour (a restart must not silently reuse a public/weak key).
// For production, ALWAYS set JWT_SECRET as an environment variable.
// ---------------------------------------------------------------------------
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[security] JWT_SECRET not set or too short — using a random ephemeral secret. Set JWT_SECRET in your environment for persistent sessions.');
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { auth, JWT_SECRET };
