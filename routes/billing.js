// ============================================================
// CampusConnect — Billing (subscriptions + credits + KCB STK Push)
// ============================================================
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { users, payments, kcbRefIndex } = require('../data/store');
const { auth } = require('../middleware/auth');
const {
  PLANS, CREDIT_BUNDLES, HOOKUP_PRICE, billingSummary,
  applySubscription, applyCredits, applyHookupUnlock, isSubscribed
} = require('../utils/monetization');
const kcb = require('../utils/kcb');

const router = express.Router();

// GET my billing state (plan info, credits, price list, limits)
router.get('/me', auth, (req, res) => {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json(billingSummary(u));
});

// GET public catalog (plans + bundles) — no auth so the Subscribe modal
// can render pricing on the landing page as well.
router.get('/catalog', (req, res) => {
  res.json({
    plans:   Object.values(PLANS),
    bundles: CREDIT_BUNDLES,
    hookupPrice: HOOKUP_PRICE
  });
});

// ---- Helper: create a Payment record and fire an STK Push ----
async function startPayment(req, res, { kind, plan, amount, credits, description }) {
  const u = users.get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const phone = (req.body && req.body.phone) || '';
  const norm = kcb.normalizePhone(phone);
  if (!kcb.isValidPhone(norm)) {
    return res.status(400).json({ error: 'Enter a valid Kenyan phone number (e.g. 07XXXXXXXX)' });
  }

  const paymentId = 'CC' + Date.now().toString(36).toUpperCase() + uuidv4().slice(0, 6).toUpperCase();
  const payment = {
    id: paymentId,
    userId: u.id,
    kind, plan, amount, credits,
    phone: norm,
    status: 'pending', // pending | successful | cancelled | timeout | failed
    checkoutId: null,
    merchantId: paymentId,
    kcbRef: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null
  };
  payments.set(paymentId, payment);

  try {
    const r = await kcb.stkPush({ phone: norm, amount, paymentId, description });
    payment.checkoutId = r.checkoutRequestID || null;
    payment.merchantId = r.merchantRequestID || paymentId;
    payment.updatedAt  = Date.now();
    if (payment.checkoutId) kcbRefIndex.set(payment.checkoutId, paymentId);
    if (payment.merchantId) kcbRefIndex.set(payment.merchantId, paymentId);
    // Also index by the invoice/account reference we sent to KCB — that is
    // what comes back in BillRefNumber on the real C2B success callback.
    try {
      const invoice = kcb.buildInvoiceNumber(paymentId);
      if (invoice) kcbRefIndex.set(invoice, paymentId);
    } catch(_) {}
    return res.json({
      ok: true,
      paymentId,
      status: 'pending',
      message: r.customerMessage || 'STK Push sent — check your phone to authorize the payment.'
    });
  } catch (e) {
    payment.status = 'failed';
    payment.error  = e.message || 'KCB error';
    payment.updatedAt = Date.now();
    console.error('KCB STK error:', e.message, e.details || '');
    return res.status(502).json({
      error: e.message || 'Payment could not be started. Please try again.',
      paymentId, code: e.code || 'kcb_error'
    });
  }
}

// POST /api/billing/subscribe  { plan:'weekly'|'monthly', phone }
router.post('/subscribe', auth, async (req, res) => {
  const planId = req.body && req.body.plan;
  const plan = PLANS[planId];
  if (!plan) return res.status(400).json({ error: 'Unknown plan' });
  return startPayment(req, res, {
    kind: 'subscription',
    plan: plan.id,
    amount: plan.price,
    credits: 0,
    description: `CampusConnect ${plan.label} Verification`
  });
});

// POST /api/billing/credits { bundle:'c4'|'c8'|..., phone }
router.post('/credits', auth, async (req, res) => {
  const bundleId = req.body && req.body.bundle;
  const bundle = CREDIT_BUNDLES.find(b => b.id === bundleId);
  if (!bundle) return res.status(400).json({ error: 'Unknown credit bundle' });
  return startPayment(req, res, {
    kind: 'credits',
    plan: null,
    amount: bundle.amount,
    credits: bundle.credits,
    description: `CampusConnect ${bundle.credits} credits`
  });
});

// POST /api/billing/hookup-unlock  { phone }
// One-time KES 100 payment that permanently unlocks the dedicated Hookup page.
router.post('/hookup-unlock', auth, async (req, res) => {
  return startPayment(req, res, {
    kind: 'hookup',
    plan: null,
    amount: HOOKUP_PRICE,
    credits: 0,
    description: 'CampusConnect Hookup Access'
  });
});

// GET /api/billing/payment/:id  — the frontend polls this to know if the
// user completed / cancelled the STK Push on their phone.
router.get('/payment/:id', auth, (req, res) => {
  const p = payments.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  if (p.userId !== req.userId) return res.status(403).json({ error: 'Not your payment' });

  // Auto-timeout: if pending for > 180s, mark as timeout so the panel closes
  // cleanly. 180s matches the real Buni STK Push expiry — anything shorter
  // races a legitimately-approved-but-slow callback and silently "times out"
  // a payment the user actually authorized.
  if (p.status === 'pending' && (Date.now() - p.createdAt) > 180000) {
    p.status = 'timeout';
    p.updatedAt = Date.now();
  }

  const u = users.get(p.userId);
  res.json({
    id: p.id, status: p.status, kind: p.kind, plan: p.plan,
    amount: p.amount, credits: p.credits, kcbRef: p.kcbRef,
    error: p.error, updatedAt: p.updatedAt,
    billing: u ? billingSummary(u) : null
  });
});

// POST /api/billing/payment/:id/cancel — user tapped Cancel on the STK panel
// (or the KCB callback never arrived after they cancelled on the phone).
// Marks the payment cancelled locally so the panel can exit cleanly. Safe:
// only affects payments that are still 'pending' — a successful callback
// that races us wins because it flips status first.
router.post('/payment/:id/cancel', auth, (req, res) => {
  const p = payments.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Payment not found' });
  if (p.userId !== req.userId) return res.status(403).json({ error: 'Not your payment' });
  if (p.status === 'pending') {
    p.status = 'cancelled';
    p.error  = 'Cancelled by user';
    p.updatedAt = Date.now();
  }
  res.json({ ok: true, id: p.id, status: p.status });
});

// ---- KCB callback endpoint ----
// KCB Buni will POST here after the user approves / cancels the STK prompt.
// Mounted TWICE by server.js: at /api/billing/callback AND at /callback so
// the KCB_CALLBACK_URL can be either.
async function kcbCallback(req, res) {
  // Log the raw callback body so any future shape change from KCB is
  // debuggable from the Render logs without needing to reproduce a live push.
  try { console.log('KCB callback RAW:', JSON.stringify(req.body || {})); } catch(_) {}
  const parsed = kcb.parseCallback(req.body || {});
  console.log('KCB callback PARSED:', JSON.stringify({
    status: parsed.status, code: parsed.code, ref: parsed.ref,
    embeddedPaymentId: parsed.embeddedPaymentId, accountRef: parsed.accountRef,
    kcbRef: parsed.kcbRef, desc: parsed.desc
  }));

  let paymentId = null;
  // 1) Preferred: paymentId embedded in BillRefNumber / InvoiceNumber /
  //    AccountReference — the shape KCB Buni actually uses on a real C2B
  //    success receipt (e.g. BillRefNumber "8112320#CCXXXX").
  if (parsed.embeddedPaymentId && payments.has(parsed.embeddedPaymentId)) paymentId = parsed.embeddedPaymentId;
  // 2) Daraja-style STK result: match by MerchantRequestID / CheckoutRequestID
  //    via the kcbRefIndex map we filled when the push was initiated.
  if (!paymentId && parsed.merchantRequestID && kcbRefIndex.has(parsed.merchantRequestID)) paymentId = kcbRefIndex.get(parsed.merchantRequestID);
  if (!paymentId && parsed.checkoutRequestID && kcbRefIndex.has(parsed.checkoutRequestID)) paymentId = kcbRefIndex.get(parsed.checkoutRequestID);
  // 3) Fallback — treat merchantRequestID as our paymentId (some tenants echo it back verbatim)
  if (!paymentId && parsed.merchantRequestID && payments.has(parsed.merchantRequestID)) paymentId = parsed.merchantRequestID;
  // 4) Last-resort fallback for successful C2B receipts that arrive with an
  //    unusual/missing account reference: if the amount and phone match a
  //    still-pending payment created in the last 5 minutes, match by that.
  //    This ONLY runs on parsed.status === 'successful' so it can never
  //    accidentally cancel a good payment.
  if (!paymentId && parsed.status === 'successful') {
    const now = Date.now();
    const amt = Number((req.body && (req.body.TransAmount || req.body.transAmount)) || 0);
    const rawPhone = String((req.body && (req.body.MSISDN || req.body.msisdn || req.body.phoneNumber)) || '');
    const phoneNorm = kcb.normalizePhone(rawPhone);
    let best = null;
    payments.forEach(pp => {
      if (pp.status !== 'pending') return;
      if ((now - pp.createdAt) > 5 * 60 * 1000) return;
      if (amt && Number(pp.amount) !== amt) return;
      if (phoneNorm && pp.phone && pp.phone !== phoneNorm) return;
      if (!best || pp.createdAt > best.createdAt) best = pp;
    });
    if (best) paymentId = best.id;
  }

  const p = paymentId ? payments.get(paymentId) : null;
  if (p && p.status === 'pending') {
    p.status    = parsed.status;
    p.kcbRef    = parsed.kcbRef || p.kcbRef;
    p.updatedAt = Date.now();
    p.error     = parsed.status === 'successful' ? null : (parsed.desc || null);
    if (parsed.status === 'successful') {
      const u = users.get(p.userId);
      if (u) {
        if (p.kind === 'subscription') applySubscription(u, p.plan);
        if (p.kind === 'credits')      applyCredits(u, p.credits);
        if (p.kind === 'hookup')       applyHookupUnlock(u);
        users.set(u.id, u);
      }
    }
  }

  // KCB expects a 200 acknowledgement
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
router.post('/callback', express.json({ limit: '2mb' }), kcbCallback);

module.exports = router;
module.exports.kcbCallback = kcbCallback;
