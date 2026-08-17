// ============================================================
// CampusConnect — KCB Buni (Mobile Money / STK Push) integration
// - Fetches OAuth2 token (client_credentials) with in-memory caching
// - Initiates STK Push against the KCB Buni endpoint
// - Exposes helpers used by /api/billing/*
// ============================================================
const https = require('https');
const { URL } = require('url');

const CFG = {
  env:           process.env.KCB_ENV            || 'production',
  baseUrl:       process.env.KCB_BASE_URL       || 'https://api.buni.kcbgroup.com',
  tokenEndpoint: process.env.KCB_TOKEN_ENDPOINT || 'https://api.buni.kcbgroup.com/token',
  consumerKey:   process.env.KCB_CONSUMER_KEY   || '',
  consumerSecret:process.env.KCB_CONSUMER_SECRET|| '',
  callbackUrl:   process.env.KCB_CALLBACK_URL   || '',
  shortcode:     process.env.KCB_SHORTCODE      || '',
  till:          process.env.KCB_TILL           || '',
  stkEndpoint:   process.env.KCB_STK_ENDPOINT   || 'https://api.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush'
};

let CACHED_TOKEN = null;
let CACHED_TOKEN_EXP = 0;

function httpRequest(urlStr, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + (u.search || ''),
      headers: opts.headers || {},
      timeout: 25000
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = raw;
        try { data = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('KCB request timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Normalize a phone number to the 2547XXXXXXXX / 2541XXXXXXXX format
function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D+/g, '');
  if (!p) return '';
  if (p.startsWith('0'))  p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (p.startsWith('254')) return p;
  return p;
}
function isValidPhone(p) { return /^254(7|1)\d{8}$/.test(p); }

async function getToken() {
  const now = Date.now();
  if (CACHED_TOKEN && CACHED_TOKEN_EXP - 30000 > now) return CACHED_TOKEN;
  const basic = Buffer.from(`${CFG.consumerKey}:${CFG.consumerSecret}`).toString('base64');

  // KCB Buni token endpoint historically accepts either GET (with query string)
  // or POST (with x-www-form-urlencoded body). Some environments return HTTP 405
  // for one method — try POST first, then fall back to GET so the integration
  // works across all Buni deployments.
  const attempts = [
    {
      url: CFG.tokenEndpoint,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + basic,
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    },
    {
      url: CFG.tokenEndpoint + '?grant_type=client_credentials',
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + basic, 'Accept': 'application/json' },
      body: null
    }
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      const { status, data, raw } = await httpRequest(a.url, { method: a.method, headers: a.headers }, a.body);
      if (status >= 200 && status < 300 && data && data.access_token) {
        CACHED_TOKEN = data.access_token;
        CACHED_TOKEN_EXP = now + ((Number(data.expires_in) || 3600) * 1000);
        return CACHED_TOKEN;
      }
      lastErr = { status, raw };
      // If it's not a method-not-allowed problem, no point trying the other verb
      if (status !== 405 && status !== 404) break;
    } catch (e) {
      lastErr = { message: e.message };
    }
  }
  const err = new Error('KCB token request failed');
  err.details = lastErr;
  throw err;
}

// invoiceNumber format per KCB email: <Till/Account>#<reference> or <Till>-<reference>
function buildInvoiceNumber(paymentId) {
  const till = CFG.till || CFG.shortcode || '';
  return `${till}#${paymentId}`;
}

/**
 * Initiate an STK Push (Buni). Returns { ok, checkoutRequestID, merchantRequestID, raw }.
 * The user's device will receive a payment prompt; the KCB backend will POST
 * the final result to KCB_CALLBACK_URL.
 */
async function stkPush({ phone, amount, paymentId, description }) {
  const norm = normalizePhone(phone);
  if (!isValidPhone(norm)) {
    const e = new Error('Invalid phone number. Use format 07XXXXXXXX or 2547XXXXXXXX.');
    e.code = 'bad_phone';
    throw e;
  }
  const kes = Math.round(Number(amount));
  if (!kes || kes < 1) {
    const e = new Error('Invalid amount');
    e.code = 'bad_amount';
    throw e;
  }
  const token = await getToken();
  const invoice = buildInvoiceNumber(paymentId);
  const payload = {
    phoneNumber: norm,
    amount: kes,
    invoiceNumber: invoice,
    shortCode: CFG.shortcode,
    till: CFG.till,
    callBackURL: CFG.callbackUrl,
    accountReference: paymentId,
    transactionDesc: (description || 'CampusConnect').slice(0, 60),
    // Common extra fields many Buni sandboxes/prod builds expect
    merchantRequestID: paymentId,
    referenceNumber: paymentId
  };
  const body = JSON.stringify(payload);
  const { status, data, raw } = await httpRequest(CFG.stkEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + token
    }
  }, body);

  if (status < 200 || status >= 300) {
    // KCB nests the reason under header.statusDescription
    let reason = (data && (data.errorMessage || data.message || data.error)) || '';
    if (!reason && data && data.header && data.header.statusDescription) reason = data.header.statusDescription;
    if (!reason) reason = 'KCB STK push failed';
    const err = new Error(reason);
    err.details = { status, raw };
    err.code = 'kcb_error';
    throw err;
  }

  return {
    ok: true,
    checkoutRequestID: (data && (data.CheckoutRequestID || data.checkoutRequestID || data.CheckoutRequestId)) || null,
    merchantRequestID: (data && (data.MerchantRequestID || data.merchantRequestID || data.MerchantRequestId)) || paymentId,
    customerMessage:   (data && (data.CustomerMessage || data.customerMessage || data.ResponseDescription)) || 'Check your phone to authorize the payment',
    raw: data
  };
}

// Parse a KCB callback payload and normalize the result.
// KCB Buni typically posts a body with either { Body: { stkCallback: { ResultCode, ResultDesc, CheckoutRequestID, MerchantRequestID, CallbackMetadata:{Item:[...]}}}}
// or a flatter { resultCode, resultDesc, merchantRequestID, checkoutRequestID, ... }.
function parseCallback(body) {
  if (!body || typeof body !== 'object') return { status: 'failed', reason: 'Empty callback', ref: null };
  const cb = (body.Body && body.Body.stkCallback) || body.stkCallback || body;
  const code = Number(
    cb.ResultCode ?? cb.resultCode ?? cb.result_code ??
    cb.ResponseCode ?? cb.responseCode ?? 1
  );
  const desc = String(cb.ResultDesc || cb.resultDesc || cb.ResponseDescription || cb.message || '');
  const merchantRequestID = cb.MerchantRequestID || cb.merchantRequestID || cb.merchantRequestId || null;
  const checkoutRequestID = cb.CheckoutRequestID || cb.checkoutRequestID || cb.checkoutRequestId || null;
  // Try to pull the KCB receipt / transaction id
  let kcbRef = cb.transactionId || cb.TransactionID || cb.mpesaReceiptNumber || cb.MpesaReceiptNumber || null;
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || cb.callbackMetadata?.Item || [];
  if (Array.isArray(items)) {
    items.forEach(it => {
      const n = (it.Name || it.name || '').toString();
      if (/receipt|transactionid|mpesareceipt/i.test(n)) kcbRef = it.Value || it.value || kcbRef;
    });
  }
  let status = 'failed';
  if (code === 0) status = 'successful';
  else if (/cancel/i.test(desc)) status = 'cancelled';
  else if (/timeout|expired/i.test(desc)) status = 'timeout';
  return { status, code, desc, merchantRequestID, checkoutRequestID, kcbRef, ref: merchantRequestID || checkoutRequestID };
}

function config() { return { ...CFG, consumerSecret: CFG.consumerSecret ? '***' : '' }; }

module.exports = { stkPush, parseCallback, getToken, normalizePhone, isValidPhone, config, CFG };
