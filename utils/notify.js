// Notification helper — creates a notification for one user or broadcast ('all')
const { v4: uuidv4 } = require('uuid');
const { notifications, users } = require('../data/store');

function notify(to, type, text, fromId) {
  const from = fromId ? users.get(fromId) : null;
  notifications.push({
    id: uuidv4(),
    to,                    // 'all' (broadcast) or a specific userId
    type,                  // 'join' | 'message' | 'match' | 'post_like' | 'post_comment'
    text,
    fromId: fromId || null,
    fromName: from ? from.name : '',
    ts: Date.now(),
    readBy: new Set()
  });
  // cap the store so memory stays bounded
  if (notifications.length > 2000) notifications.splice(0, notifications.length - 2000);
}

module.exports = { notify };
