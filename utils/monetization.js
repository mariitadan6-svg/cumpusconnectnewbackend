// ============================================================
// CampusConnect — Monetization helpers
// Subscription plans, credits pricing, and per-user gating rules.
// Kept in ONE file so plans / prices can be tuned in one place.
// ============================================================

// Subscription plans (KES). Verified users get the Instagram-style blue badge
// and unlock unrestricted DM starts, unlimited photos/videos, and no free-reply cap.
const PLANS = {
  daily:   { id: 'daily',   label: 'Daily',   price: 15, durationMs: 24 * 60 * 60 * 1000 },
  weekly:  { id: 'weekly',  label: 'Weekly',  price: 25, durationMs: 7  * 24 * 60 * 60 * 1000 },
  monthly: { id: 'monthly', label: 'Monthly', price: 50, durationMs: 30 * 24 * 60 * 60 * 1000 }
};

// Credit bundles — 1 KES = 15 credits (1 credit = 1 message beyond the free
// allowance). Bundles at 4, 8, 12, 16, 20 KES.
const CREDIT_RATE = 15; // credits per 1 KES
const CREDIT_BUNDLES = [4, 8, 12, 16, 20].map(kes => ({
  id: 'c' + kes,
  amount: kes,
  credits: kes * CREDIT_RATE,
  label: `${kes} KES · ${kes * CREDIT_RATE} credits`
}));

// Free-tier limits (per Instagram-style restrictions)
const FREE_LIMITS = {
  dmStarts: 3,          // legacy counter, kept for backwards compatibility
  freeMessagesTotal: 5, // verified members get 5 free messages per subscription period...
  freeRepliesPerChat: 2,// ...of which at most 2 free messages per chat thread; then 1 credit per message
  maxPhotos: 2,         // profile gallery cap for unpaid users (0..maxPhotos)
  maxPostMedia: 2       // unpaid users may post at most 2 media posts total
};

// Is this user's subscription still active?
function isSubscribed(user) {
  if (!user) return false;
  return !!(user.subscription && user.subscription.active && user.subscription.expiresAt > Date.now());
}
function isVerified(user) { return isSubscribed(user); } // verified badge follows the subscription

// Public shape returned to the client
function billingSummary(user) {
  const active = isSubscribed(user);
  return {
    subscribed: active,
    verified: active,
    plan: active ? user.subscription.plan : null,
    expiresAt: active ? user.subscription.expiresAt : null,
    credits: user.credits || 0,
    limits: FREE_LIMITS,
    creditRate: CREDIT_RATE,
    plans: Object.values(PLANS),
    bundles: CREDIT_BUNDLES
  };
}

// Apply a successful subscription payment to a user
function applySubscription(user, planId) {
  const plan = PLANS[planId];
  if (!plan) return;
  const now = Date.now();
  // If they already have an active plan, extend from the current expiry
  const base = (user.subscription && user.subscription.active && user.subscription.expiresAt > now)
    ? user.subscription.expiresAt
    : now;
  user.subscription = {
    active: true,
    plan: plan.id,
    activatedAt: now,
    expiresAt: base + plan.durationMs
  };
  // Each new subscription period refreshes the free-message allowance, so a
  // daily renewal gives the member 5 fresh free messages again.
  user.freeMessagesUsed = 0;
  user.verified = true;
}

// Apply a successful credit bundle payment
function applyCredits(user, credits) {
  user.credits = Number(user.credits || 0) + Number(credits || 0);
}

// ---- Feature gates (server-side authoritative) ----
// Returns { ok:true } or { ok:false, code, reason } — code is a machine tag
// the frontend uses to decide whether to open Subscribe or Buy Credits.
function checkPostMedia(user, hasMedia, currentMediaPostCount) {
  if (!hasMedia) return { ok: true };
  if (isSubscribed(user)) return { ok: true };
  if (currentMediaPostCount >= FREE_LIMITS.maxPostMedia) {
    return { ok: false, code: 'need_subscription', reason: `Free members can only post up to ${FREE_LIMITS.maxPostMedia} pictures/videos. Subscribe to post unlimited.` };
  }
  return { ok: true };
}

function checkPhotoGallery(user, incomingCount) {
  if (isSubscribed(user)) return { ok: true };
  if (incomingCount > FREE_LIMITS.maxPhotos) {
    return { ok: false, code: 'need_subscription', reason: `Free members can only keep ${FREE_LIMITS.maxPhotos} gallery photos. Subscribe to add unlimited.` };
  }
  return { ok: true };
}

// Chat gating — messaging is a verified (subscribed) feature.
// Free members can only VIEW profiles; sending any message requires an active
// subscription. Verified members get FREE_LIMITS.freeMessagesTotal free messages
// per subscription period, capped at FREE_LIMITS.freeRepliesPerChat free messages
// per chat thread — beyond that each message costs 1 credit.
// threadFreeUsed = number of free messages already used in this chat thread.
function checkChatSend(user, threadFreeUsed) {
  if (!isSubscribed(user)) {
    return { ok: false, code: 'need_subscription', reason: 'Messaging is a verified feature. Subscribe to start chatting with members.' };
  }
  const totalFreeUsed = user.freeMessagesUsed || 0;
  if (totalFreeUsed < FREE_LIMITS.freeMessagesTotal && (threadFreeUsed || 0) < FREE_LIMITS.freeRepliesPerChat) {
    return { ok: true, chargeCredit: false, consumeFree: true };
  }
  if ((user.credits || 0) > 0) {
    return { ok: true, chargeCredit: true };
  }
  return { ok: false, code: 'need_credits', reason: `Your ${FREE_LIMITS.freeMessagesTotal} free messages are used up. Buy credits to keep chatting (1 credit = 1 message).` };
}

module.exports = {
  PLANS, CREDIT_BUNDLES, CREDIT_RATE, FREE_LIMITS,
  isSubscribed, isVerified, billingSummary,
  applySubscription, applyCredits,
  checkPostMedia, checkPhotoGallery, checkChatSend
};
