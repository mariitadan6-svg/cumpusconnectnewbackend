const express = require('express');
const router = express.Router();

// Rule-based chatbot (Cupid) that responds to ANY input.
// Order matters: both greetings and intent keyword matches are checked,
// then a contextual fallback is chosen so there is ALWAYS a helpful reply.
const responses = [
  { keywords: ['hi', 'hello', 'hey', 'sasa', 'niaje', 'mambo', 'habari'], reply: "👋 Hey there! Welcome to CampusConnect. I'm Cupid, your AI assistant. How can I help you today?" },
  { keywords: ['hookup'], reply: "💥 Looking for a hookup? On CampusConnect you can set your goal to 'Hookup' while creating your profile. Just make sure everyone involved is 18+ and consenting. Use the Hookup filter on the discover page." },
  { keywords: ['dating', 'date', 'boyfriend', 'girlfriend', 'relationship', 'love'], reply: "💖 Looking for love? Set your profile goal to 'Dating' and filter matches by 'Dating'. We'll suggest people with shared interests near you in Kenya." },
  { keywords: ['friend', 'friendship', 'buddy', 'study buddy'], reply: "🤝 Want to make friends? Choose 'Friendship' as your goal. You'll be shown other users looking for platonic connections." },
  { keywords: ['university', 'universities', 'campus', 'college', 'school', 'institution'], reply: "🎓 CampusConnect covers all universities in Kenya — from the University of Nairobi and JKUAT to Strathmore, USIU-A, Mount Kenya University and many more. Set your university and its location in your profile so we can suggest people on your campus!" },
  { keywords: ['county', 'location', 'kenya', 'nairobi', 'mombasa', 'eldoret', 'kisumu'], reply: "🇰🇪 We cover all universities across Kenya with their campus locations. Set your university & location in your profile so we can suggest people near you." },
  { keywords: ['password', 'forgot', 'reset'], reply: "🔐 You can change your password anytime from Settings → Security. Use at least 6 characters. If you're locked out, contact support@campusconnect.co.ke." },
  { keywords: ['age', '18', 'young', 'old'], reply: "🔞 CampusConnect is strictly 18+. You must confirm your age when signing up. Underage accounts are not permitted." },
  { keywords: ['match', 'like', 'swipe', 'crush'], reply: "❤️ Tap the heart to like someone. If they like you back — it's a MATCH! We also auto-suggest people close to you who share your interests on the Dashboard." },
  { keywords: ['message', 'chat', 'talk', 'text', 'dm'], reply: "💬 You can chat with anyone you've matched with from the Matches tab. Messages sync across devices, and you'll see who's online in real time." },
  { keywords: ['notification', 'notify', 'alert', 'bell'], reply: "🔔 You get notifications for matches, messages, likes, comments and profile views — right on the bell icon at the top. You can click a notification to jump to it." },
  { keywords: ['profile view', 'viewed', 'visitor', 'who saw', 'who visited', 'stalk'], reply: "👀 On the Dashboard you can see exactly who viewed your profile — just like TikTok's profile views. Check the 'Profile Views' card." },
  { keywords: ['online', 'active', 'presence', 'who is online'], reply: "🟢 The green dot shows who is online right now. You can also see a full 'Who's Online' list on the Dashboard." },
  { keywords: ['delete', 'remove', 'account'], reply: "You can delete your account any time from Settings → Security → Delete Account. Your data will be permanently removed." },
  { keywords: ['settings', 'preferences', 'privacy', 'notifications setting'], reply: "⚙️ Head to the Settings area for privacy, notification preferences, password change and account controls — just like Instagram." },
  { keywords: ['premium', 'paid', 'subscribe', 'money'], reply: "💎 CampusConnect is currently free! Premium features (unlimited likes, boosts, incognito) are coming soon." },
  { keywords: ['bug', 'error', 'problem', 'issue', 'broken', 'crash'], reply: "😔 Sorry you're having trouble. Try refreshing the page or logging out and back in. Contact support@campusconnect.co.ke if the problem persists." },
  { keywords: ['thank', 'thanks', 'asante'], reply: "🙏 You're welcome! Anything else I can help with?" },
  { keywords: ['bye', 'goodbye', 'later', 'kwaheri'], reply: "👋 Bye! Happy matching on CampusConnect! ❤️" },
  { keywords: ['who are you', 'your name', 'what are you', 'siri'], reply: "🤖 I'm Cupid, the CampusConnect AI assistant. I can answer any question about the platform, dating tips, safety, or how features work." },
  { keywords: ['tip', 'advice', 'help me', 'suggest'], reply: "💡 Tip: Great profiles have a clear photo, a fun bio (2-3 sentences), and honest interests. Be yourself and be safe!" },
  { keywords: ['photo', 'picture', 'image', 'avatar'], reply: "📸 Upload a clear, recent photo of yourself. Profiles with photos get 10x more matches! You can add up to 6 gallery photos." },
  { keywords: ['interest', 'hobby', 'match me with'], reply: "🎯 Add your interests when creating your profile — sports, music, tech, faith, travel, etc. We auto-suggest people with shared interests." },
  { keywords: ['safe', 'safety', 'report', 'block', 'scam'], reply: "🛡️ Your safety matters. Meet in public places, tell a friend, and never share financial info. Report suspicious profiles from the profile menu." },
  { keywords: ['comment', 'post', 'feed', 'share', 'status'], reply: "📝 Post photos, videos and text on the Feed. Everyone can see, like, dislike and comment in real time. You can edit or delete your own posts." },
  { keywords: ['dislike', 'thumbs down', 'unlike'], reply: "👎 On every post there's a like AND a dislike button. Tap once to dislike, tap again to undo." },
  { keywords: ['how', 'work', 'use', 'start', 'begin'], reply: "🚀 Getting started: 1) Create your profile (university + location), 2) Pick your vibe (Dating/Friendship/Hookup), 3) Discover & like people, 4) Match & chat. That's it!" }
];

// Contextual fallbacks chosen when no keyword matches, keyed by a broad topic guess
function fallbackReply(message) {
  const lower = message.toLowerCase();
  if (/^\W*[?]/i.test('') || lower.includes('?')) {
    return "Great question! I can help with matching, filters, your profile, chat, notifications, safety and more. Could you rephrase so I can give you the exact answer?";
  }
  if (lower.length < 3) {
    return "🤔 Could you tell me a bit more? I'm here to help with anything about CampusConnect.";
  }
  const pool = [
    "That's a good one! I'm here to help with matching, filtering, chatting, notifications, safety and profile tips. What would you like to know?",
    "I want to make sure I help correctly — you can ask me about how to match, filter people, who viewed your profile, online status, or the chatbot itself.",
    "I can help with anything about CampusConnect — dating, friendships, hookups, your university, safety, or settings. Ask away!",
    "I'm always learning! Meanwhile I can definitely help with: matching, chat, notifications, profile views, auto-suggestions, and staying safe.",
    "Let's figure it out together — ask me about discovering people, editing your profile, posting, or managing your settings."
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

router.post('/', (req, res) => {
  const { message } = req.body;
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message required' });
  const lower = message.trim().toLowerCase();

  for (const r of responses) {
    if (r.keywords.some(k => lower.includes(k))) {
      return res.json({ reply: r.reply });
    }
  }

  res.json({ reply: fallbackReply(message) });
});

module.exports = router;
