const express = require('express');
const router = express.Router();

// Rule-based chatbot that responds to anything
const responses = [
  { keywords: ['hi', 'hello', 'hey', 'sasa', 'niaje', 'mambo'], reply: "👋 Hey there! Welcome to CampusConnect. I'm Cupid, your AI assistant. How can I help you today?" },
  { keywords: ['hookup'], reply: "💥 Looking for a hookup? On CampusConnect you can set your goal to 'Hookup' while creating your profile. Just make sure everyone involved is 18+ and consenting. Use the Hookup filter on the discover page." },
  { keywords: ['dating', 'date', 'boyfriend', 'girlfriend', 'relationship'], reply: "💖 Looking for love? Set your profile goal to 'Dating' and filter matches by 'Dating'. We'll suggest people with shared interests near you in Kenya." },
  { keywords: ['friend', 'friendship', 'buddy'], reply: "🤝 Want to make friends? Choose 'Friendship' as your goal. You'll be shown other users looking for platonic connections." },
  { keywords: ['county', 'location', 'kenya', 'nairobi', 'mombasa'], reply: "🇰🇪 We cover all 47 counties in Kenya with their subcounties — from Nairobi to Turkana. Set your county & subcounty in your profile so we can suggest people near you." },
  { keywords: ['password', 'forgot', 'reset'], reply: "🔐 You set your password when creating your profile. Keep it safe! Use at least 6 characters. Password reset via email is coming soon." },
  { keywords: ['age', '18', 'young'], reply: "🔞 CampusConnect is strictly 18+. You must confirm your age when signing up. Underage accounts are not permitted." },
  { keywords: ['match', 'like', 'swipe'], reply: "❤️ Tap the heart to like someone. If they like you back — it's a MATCH! You can then start chatting instantly." },
  { keywords: ['message', 'chat', 'talk'], reply: "💬 You can chat with anyone you've matched with from the Matches tab. Be respectful and kind." },
  { keywords: ['safe', 'safety', 'report', 'block'], reply: "🛡️ Your safety matters. Meet in public places, tell a friend, and never share financial info. Report suspicious profiles from the profile menu." },
  { keywords: ['delete', 'remove', 'account'], reply: "You can delete your account any time from Settings. Your data will be permanently removed." },
  { keywords: ['premium', 'paid', 'subscribe', 'money'], reply: "💎 CampusConnect is currently free! Premium features (unlimited likes, boosts, incognito) are coming soon." },
  { keywords: ['bug', 'error', 'problem', 'issue', 'broken'], reply: "😔 Sorry you're having trouble. Try refreshing the page or logging out and back in. Contact support@campusconnect.co.ke if the problem persists." },
  { keywords: ['thank', 'thanks', 'asante'], reply: "🙏 You're welcome! Anything else I can help with?" },
  { keywords: ['bye', 'goodbye', 'later'], reply: "👋 Bye! Happy matching on CampusConnect! ❤️" },
  { keywords: ['who are you', 'your name', 'what are you'], reply: "🤖 I'm Cupid, the CampusConnect AI assistant. I can answer any question about the platform, dating tips, safety, or how features work." },
  { keywords: ['tip', 'advice', 'help me'], reply: "💡 Tip: Great profiles have a clear photo, a fun bio (2-3 sentences), and honest interests. Be yourself and be safe!" },
  { keywords: ['photo', 'picture', 'image'], reply: "📸 Upload a clear, recent photo of yourself. Profiles with photos get 10x more matches!" },
  { keywords: ['interest', 'hobby'], reply: "🎯 Add your interests when creating your profile — sports, music, tech, faith, travel, etc. We suggest people with shared interests." }
];

router.post('/', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const lower = message.toLowerCase();

  for (const r of responses) {
    if (r.keywords.some(k => lower.includes(k))) {
      return res.json({ reply: r.reply });
    }
  }

  const fallback = [
    "🤔 That's an interesting question! Could you tell me more? You can also ask me about matching, filters, safety, or profile setup.",
    "💭 I'm not sure I fully caught that. Try asking about: hookups, dating, friendships, filters, matches, or safety tips.",
    "✨ I can help with anything about CampusConnect — how to match, filter people, chat, or stay safe. What would you like to know?",
    "😊 Great question! I'm still learning. Ask me about profile setup, finding matches, or Kenyan counties available on the platform."
  ];
  res.json({ reply: fallback[Math.floor(Math.random() * fallback.length)] });
});

module.exports = router;
