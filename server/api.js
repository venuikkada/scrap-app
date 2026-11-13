import crypto from 'node:crypto';
import { getSettings, transaction } from './db.js';
import { sendConfirmCodeSms, sendOtpSms } from './sms.js';
import { SLOTS, addDays, bookableDates, computeAmounts, istNow, normaliseQty } from '../public/js/rules.js';

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const SESSION_DAYS = 30;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_MAX_SENDS = 5;
const OTP_MAX_ATTEMPTS = 5;
const MAX_OPEN_BOOKINGS = 5;
const MAX_ADDRESSES = 10;
const CONFIRM_MAX_ATTEMPTS = 5;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bad = (code) => new HttpError(400, code);

function text(v, max, required = true) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (s.length > max || (required && !s)) throw bad('invalid_input');
  return s;
}
function mobileOf(v) {
  const s = String(v ?? '').replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(s)) throw bad('invalid_mobile');
  return s;
}
function pinOf(v) {
  const s = String(v ?? '').trim();
  if (!/^[1-9]\d{5}$/.test(s)) throw bad('invalid_pin');
  return s;
}
function rupeesToPaise(v, max = 1000000) {
  const n = Number(v);
  if (v === '' || v == null || !Number.isFinite(n) || n < 0 || n > max) throw bad('invalid_amount');
  return Math.round(n * 100);
}
const idOf = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(404, 'not_found');
  return n;
};

export function createApi(db, cfg) {
  const routes = [];
  const add = (method, pattern, role, handler) => {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
    );
    routes.push({ method, re, keys, role, handler });
  };

  const now = () => new Date();
  const iso = () => now().toISOString();

  // ---------- helpers ----------
  const publicUser = (u) =>
    u && { id: u.id, mobile: u.mobile, name: u.name, role: u.role, status: u.status };

  const appInfo = () => ({
    name: cfg.appName,
    city: cfg.city,
    testOtp: cfg.otpMode === 'test' ? cfg.testOtp : null,
  });

  function currentRates() {
    return db
      .prepare(
        `SELECT c.id, c.key, c.unit, r.buy_paise, r.resale_paise, r.effective_at
         FROM categories c
         JOIN rates r ON r.id = (SELECT id FROM rates WHERE category_id = c.id ORDER BY id DESC LIMIT 1)
         WHERE c.active = 1 ORDER BY c.sort`
      )
      .all();
  }

  const termsOf = (b) => ({
    feePaise: b.fee_paise,
    thresholdPaise: b.threshold_paise,
    sharePct: b.partner_share_pct,
  });

  function loadBooking(id) {
    const b = db
      .prepare(
        `SELECT b.*, cu.name AS customer_name, cu.mobile AS customer_mobile, pa.name AS partner_name
         FROM bookings b
         JOIN users cu ON cu.id = b.customer_id
         LEFT JOIN users pa ON pa.id = b.partner_id
         WHERE b.id = ?`
      )
      .get(id);
    if (!b) throw new HttpError(404, 'not_found');
    b.items = db
      .prepare(
        `SELECT i.*, c.key FROM booking_items i JOIN categories c ON c.id = i.category_id
         WHERE i.booking_id = ? ORDER BY c.sort`
      )
      .all(id);
    return b;
  }

  // who = 'customer' | 'partner' | 'admin'. Each role only gets what it may see:
  // customers never see payout or margin, partners never see margin or resale price.
  function bookingView(b, who = 'customer') {
    const admin = who === 'admin';
    const done = ['picked_up', 'paid'].includes(b.status);
    // weighed = partner entered weights, waiting for the customer's confirmation code
    const weighed = b.status === 'on_the_way' && b.weighed_at != null && b.final_value != null;
    const amounts = (p) => {
      const a = { value: b[p + '_value'], fee: b[p + '_fee'], customer: b[p + '_customer'] };
      if (who !== 'customer') a.payout = b[p + '_payout'];
      if (admin) a.margin = b[p + '_margin'];
      return a;
    };
    const v = {
      id: b.id,
      status: b.status,
      pickupDate: b.pickup_date,
      slot: b.slot,
      address: JSON.parse(b.address_json),
      paymentMode: b.payment_mode,
      partnerName: b.partner_name || null,
      createdAt: b.created_at,
      feePaise: b.fee_paise,
      thresholdPaise: b.threshold_paise,
      est: amounts('est'),
      final: done ? amounts('final') : null,
      proposed: weighed ? amounts('final') : null,
      rating: b.rating ? { stars: b.rating, comment: b.rating_comment || '' } : null,
    };
    if (who === 'customer' && weighed) v.confirmCode = b.confirm_code;
    if (who === 'partner') {
      // Privacy: the partner gets the customer's phone number only on the pickup day.
      const today = istNow(now()).date;
      v.customer = { name: b.customer_name, mobile: b.pickup_date === today ? b.customer_mobile : null };
    }
    if (b.items) {
      v.items = b.items.map((i) => {
        const item = {
          id: i.id,
          key: i.key,
          unit: i.unit,
          estQty: i.est_qty,
          measuredQty: done || weighed ? i.measured_qty : null,
          buyPaise: i.buy_paise,
        };
        if (admin) item.resalePaise = i.resale_paise;
        return item;
      });
    }
    if (admin) {
      v.customer = { id: b.customer_id, name: b.customer_name, mobile: b.customer_mobile };
      v.partnerId = b.partner_id;
    }
    return v;
  }

  const addressView = (a, pins) => ({
    id: a.id,
    name: a.name,
    houseNo: a.house_no,
    street: a.street,
    locality: a.locality,
    pin: a.pin,
    landmark: a.landmark,
    serviceable: pins.includes(a.pin),
  });

  function addressInput(body) {
    return {
      name: text(body.name, 60),
      houseNo: text(body.houseNo, 60),
      street: text(body.street, 100),
      locality: text(body.locality, 60),
      pin: pinOf(body.pin),
      landmark: text(body.landmark, 100, false),
    };
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(now().getTime() + SESSION_DAYS * 86400000).toISOString();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      sha256(token),
      userId,
      expires
    );
    return token;
  }

  function sessionCookie(token, maxAgeSec) {
    return (
      `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}` +
      (cfg.cookieSecure ? '; Secure' : '')
    );
  }

  function userFromRequest(req) {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (!m) return null;
    const row = db
      .prepare(
        `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
      )
      .get(sha256(m[1]));
    if (!row || row.expires_at < iso() || row.status === 'blocked') return null;
    row.sessionHash = sha256(m[1]);
    return row;
  }

  // Simple per-IP limiter for the OTP endpoints (memory only; resets on restart).
  const ipHits = new Map();
  function limitIp(ip, max = 30, windowMs = 3600000) {
    const t = Date.now();
    const hits = (ipHits.get(ip) || []).filter((x) => t - x < windowMs);
    if (hits.length >= max) throw new HttpError(429, 'too_many_requests');
    hits.push(t);
    ipHits.set(ip, hits);
    if (ipHits.size > 5000) ipHits.clear();
  }

  // ---------- auth ----------
  add('GET', '/api/bootstrap', null, ({ user }) => ({ app: appInfo(), user: publicUser(user) }));

  add('POST', '/api/auth/request-otp', null, async ({ body, ip }) => {
    limitIp(ip);
    const mobile = mobileOf(body.mobile);
    const t = Date.now();
    const prev = db.prepare('SELECT * FROM otps WHERE mobile = ?').get(mobile);
    const inWindow = prev && t - prev.window_start < OTP_WINDOW_MS;
    if (inWindow && prev.sent_count >= OTP_MAX_SENDS) throw new HttpError(429, 'otp_too_many');
    const code =
      cfg.otpMode === 'test' ? cfg.testOtp : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (cfg.otpMode === 'sms') {
      try {
        await sendOtpSms(mobile, code);
      } catch {
        throw new HttpError(503, 'sms_failed');
      }
    }
    db.prepare(
      `INSERT OR REPLACE INTO otps (mobile, code_hash, expires_at, attempts, sent_count, window_start)
       VALUES (?, ?, ?, 0, ?, ?)`
    ).run(
      mobile,
      sha256(mobile + ':' + code),
      t + OTP_TTL_MS,
      inWindow ? prev.sent_count + 1 : 1,
      inWindow ? prev.window_start : t
    );
    return { ok: true };
  });

  add('POST', '/api/auth/verify-otp', null, ({ body, ip, res }) => {
    limitIp(ip, 60);
    const mobile = mobileOf(body.mobile);
    const code = String(body.otp ?? '').trim();
    const row = db.prepare('SELECT * FROM otps WHERE mobile = ?').get(mobile);
    if (!row || row.expires_at < Date.now()) throw bad('otp_expired');
    if (row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'otp_too_many');
    const given = Buffer.from(sha256(mobile + ':' + code));
    if (!crypto.timingSafeEqual(given, Buffer.from(row.code_hash))) {
      db.prepare('UPDATE otps SET attempts = attempts + 1 WHERE mobile = ?').run(mobile);
      throw bad('otp_wrong');
    }
    db.prepare('DELETE FROM otps WHERE mobile = ?').run(mobile);
    let user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
    if (!user) {
      db.prepare('INSERT INTO users (mobile, created_at) VALUES (?, ?)').run(mobile, iso());
      user = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
    }
    if (user.status === 'blocked') throw new HttpError(403, 'blocked');
    res.setHeader('Set-Cookie', sessionCookie(createSession(user.id), SESSION_DAYS * 86400));
    return { user: publicUser(user) };
  });

  add('POST', '/api/auth/logout', null, ({ user, res }) => {
    if (user) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.sessionHash);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  });

  // First login: choose Customer or Partner. Admins are created with the CLI script only.
  add('POST', '/api/me/role', 'any', ({ user, body }) => {
    if (user.role) throw bad('role_already_set');
    if (!['customer', 'partner'].includes(body.role)) throw bad('invalid_input');
    const name = text(body.name, 60);
    const status = body.role === 'partner' ? 'pending' : 'approved';
    db.prepare('UPDATE users SET role = ?, name = ?, status = ? WHERE id = ?').run(
      body.role,
      name,
      status,
      user.id
    );
    return { user: publicUser({ ...user, role: body.role, name, status }) };
  });

  // ---------- customer ----------
  add('GET', '/api/catalog', 'customer', () => {
    const s = getSettings(db);
    return {
      categories: currentRates().map((r) => ({
        id: r.id,
        key: r.key,
        unit: r.unit,
        buyPaise: r.buy_paise,
      })),
      feePaise: s.pickup_fee_paise,
      thresholdPaise: s.free_threshold_paise,
      servicePins: s.service_pins,
      dates: bookableDates(now()),
    };
  });

  add('GET', '/api/addresses', 'customer', ({ user }) => {
    const pins = getSettings(db).service_pins;
    return {
      addresses: db
        .prepare('SELECT * FROM addresses WHERE user_id = ? AND deleted = 0 ORDER BY id DESC')
        .all(user.id)
        .map((a) => addressView(a, pins)),
    };
  });

  add('POST', '/api/addresses', 'customer', ({ user, body }) => {
    const a = addressInput(body);
    const n = db
      .prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ? AND deleted = 0')
      .get(user.id).n;
    if (n >= MAX_ADDRESSES) throw bad('too_many_addresses');
    const id = db
      .prepare(
        `INSERT INTO addresses (user_id, name, house_no, street, locality, pin, landmark, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(user.id, a.name, a.houseNo, a.street, a.locality, a.pin, a.landmark, iso()).lastInsertRowid;
    return { id: Number(id), serviceable: getSettings(db).service_pins.includes(a.pin) };
  });

  const ownAddress = (user, id) => {
    const a = db
      .prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ? AND deleted = 0')
      .get(idOf(id), user.id);
    if (!a) throw new HttpError(404, 'not_found');
    return a;
  };

  add('PUT', '/api/addresses/:id', 'customer', ({ user, body, params }) => {
    const old = ownAddress(user, params.id);
    const a = addressInput(body);
    db.prepare(
      'UPDATE addresses SET name=?, house_no=?, street=?, locality=?, pin=?, landmark=? WHERE id=?'
    ).run(a.name, a.houseNo, a.street, a.locality, a.pin, a.landmark, old.id);
    return { id: old.id, serviceable: getSettings(db).service_pins.includes(a.pin) };
  });

  // Soft delete: old bookings keep their own copy of the address anyway.
  add('DELETE', '/api/addresses/:id', 'customer', ({ user, params }) => {
    const old = ownAddress(user, params.id);
    db.prepare('UPDATE addresses SET deleted = 1 WHERE id = ?').run(old.id);
    return { ok: true };
  });

  add('POST', '/api/bookings', 'customer', ({ user, body }) => {
    const s = getSettings(db);
    const addr = ownAddress(user, body.addressId);
    if (!s.service_pins.includes(addr.pin)) throw bad('pin_not_serviced');

    const day = bookableDates(now()).find((d) => d.date === body.date);
    const slot = day && day.slots.find((x) => x.id === body.slot);
    if (!slot) throw bad('invalid_slot');
    if (!slot.available) throw bad('slot_passed');

    if (!Array.isArray(body.items) || body.items.length === 0) throw bad('no_items');
    if (body.items.length > 30) throw bad('invalid_input');
    const rates = new Map(currentRates().map((r) => [r.id, r]));
    const seen = new Set();
    const lines = body.items.map((it) => {
      const rate = rates.get(Number(it && it.categoryId));
      if (!rate || seen.has(rate.id)) throw bad('invalid_input');
      seen.add(rate.id);
      const qty = normaliseQty(rate.unit, it.qty);
      if (qty == null) throw bad('invalid_qty');
      return { rate, qty, buyPaise: rate.buy_paise, resalePaise: rate.resale_paise };
    });

    const open = db
      .prepare(
        `SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ?
         AND status IN ('requested','assigned','on_the_way')`
      )
      .get(user.id).n;
    if (open >= MAX_OPEN_BOOKINGS) throw bad('too_many_open_bookings');

    const terms = {
      feePaise: s.pickup_fee_paise,
      thresholdPaise: s.free_threshold_paise,
      sharePct: s.partner_share_pct,
    };
    const est = computeAmounts(lines, terms);
    const snapshot = JSON.stringify({
      name: addr.name,
      houseNo: addr.house_no,
      street: addr.street,
      locality: addr.locality,
      pin: addr.pin,
      landmark: addr.landmark,
    });

    const id = transaction(db, () => {
      const bid = db
        .prepare(
          `INSERT INTO bookings (customer_id, address_id, address_json, pickup_date, slot,
             fee_paise, threshold_paise, partner_share_pct,
             est_value, est_fee, est_customer, est_payout, est_margin, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          user.id, addr.id, snapshot, body.date, body.slot,
          terms.feePaise, terms.thresholdPaise, terms.sharePct,
          est.value, est.fee, est.customer, est.payout, est.margin, iso()
        ).lastInsertRowid;
      const addItem = db.prepare(
        `INSERT INTO booking_items (booking_id, category_id, unit, est_qty, buy_paise, resale_paise)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const l of lines) addItem.run(bid, l.rate.id, l.rate.unit, l.qty, l.buyPaise, l.resalePaise);
      return Number(bid);
    });
    return { id };
  });

  add('GET', '/api/bookings', 'customer', ({ user }) => ({
    bookings: db
      .prepare(
        `SELECT b.*, pa.name AS partner_name FROM bookings b
         LEFT JOIN users pa ON pa.id = b.partner_id
         WHERE b.customer_id = ? ORDER BY b.id DESC LIMIT 100`
      )
      .all(user.id)
      .map((b) => bookingView(b)),
  }));

  const ownBooking = (user, id) => {
    const b = loadBooking(idOf(id));
    if (b.customer_id !== user.id) throw new HttpError(404, 'not_found');
    return b;
  };

  add('GET', '/api/bookings/:id', 'customer', ({ user, params }) => ({
    booking: bookingView(ownBooking(user, params.id)),
  }));

  add('POST', '/api/bookings/:id/cancel', 'customer', ({ user, params }) => {
    const b = ownBooking(user, params.id);
    if (!['requested', 'assigned'].includes(b.status)) throw bad('cannot_cancel');
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(
      iso(),
      b.id
    );
    return { ok: true };
  });

  // Stores measured quantities and the final amounts worked out from the rates saved on the booking.
  function saveMeasured(b, body, { status, code }) {
    const given = new Map(
      (Array.isArray(body.items) ? body.items : []).map((x) => [Number(x && x.id), x.qty])
    );
    const lines = b.items.map((i) => {
      const raw = given.get(i.id);
      // 0 is allowed here: the partner may not take an item after all.
      const qty = Number(raw) === 0 && raw !== '' && raw != null ? 0 : normaliseQty(i.unit, raw);
      if (qty == null) throw bad('invalid_qty');
      return { id: i.id, qty, buyPaise: i.buy_paise, resalePaise: i.resale_paise };
    });
    if (lines.every((l) => l.qty === 0)) throw bad('invalid_qty');
    const f = computeAmounts(lines, termsOf(b));
    const t = iso();
    transaction(db, () => {
      const upd = db.prepare('UPDATE booking_items SET measured_qty = ? WHERE id = ?');
      for (const l of lines) upd.run(l.qty, l.id);
      db.prepare(
        `UPDATE bookings SET status = ?, weighed_at = ?, picked_up_at = ?, confirm_code = ?,
           confirm_attempts = 0, final_value = ?, final_fee = ?, final_customer = ?,
           final_payout = ?, final_margin = ? WHERE id = ?`
      ).run(status, t, status === 'picked_up' ? t : null, code, f.value, f.fee, f.customer, f.payout, f.margin, b.id);
    });
    return f;
  }

  // ---------- customer: rating ----------
  add('POST', '/api/bookings/:id/rating', 'customer', ({ user, params, body }) => {
    const b = ownBooking(user, params.id);
    if (!['picked_up', 'paid'].includes(b.status)) throw bad('wrong_status');
    if (b.rating) throw bad('already_rated');
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw bad('invalid_rating');
    const comment = text(body.comment, 300, false);
    db.prepare('UPDATE bookings SET rating = ?, rating_comment = ?, rated_at = ? WHERE id = ?').run(
      stars, comment, iso(), b.id
    );
    return { ok: true };
  });

  // ---------- partner ----------
  const slotRank = Object.fromEntries(SLOTS.map((s, i) => [s.id, i]));

  add('GET', '/api/partner/pickups', 'partner', ({ user, query }) => {
    const dates = bookableDates(now()).map((d) => d.date);
    const date = query.get('date') || dates[0];
    if (!dates.includes(date)) throw bad('invalid_input');
    const rows = db
      .prepare(
        `SELECT b.*, cu.name AS customer_name, cu.mobile AS customer_mobile
         FROM bookings b JOIN users cu ON cu.id = b.customer_id
         WHERE b.partner_id = ? AND b.pickup_date = ? AND b.status != 'cancelled'`
      )
      .all(user.id, date)
      .map((b) => bookingView(b, 'partner'));
    // Simple route order: by time slot, then PIN code, then locality (nearby homes together).
    rows.sort(
      (a, b) =>
        slotRank[a.slot] - slotRank[b.slot] ||
        a.address.pin.localeCompare(b.address.pin) ||
        a.address.locality.localeCompare(b.address.locality) ||
        a.id - b.id
    );
    return { date, today: dates[0], dates: dates.slice(0, 3), pickups: rows };
  });

  // A partner can only open bookings currently assigned to them.
  const ownPickup = (user, id) => {
    const b = loadBooking(idOf(id));
    if (b.partner_id !== user.id || b.status === 'cancelled') throw new HttpError(404, 'not_found');
    return b;
  };
  const mustBeToday = (b) => {
    if (b.pickup_date !== istNow(now()).date) throw bad('not_today');
  };

  add('GET', '/api/partner/pickups/:id', 'partner', ({ user, params }) => ({
    pickup: bookingView(ownPickup(user, params.id), 'partner'),
    today: istNow(now()).date,
  }));

  add('POST', '/api/partner/pickups/:id/on-the-way', 'partner', ({ user, params }) => {
    const b = ownPickup(user, params.id);
    if (b.status !== 'assigned') throw bad('wrong_status');
    mustBeToday(b);
    db.prepare("UPDATE bookings SET status = 'on_the_way' WHERE id = ?").run(b.id);
    return { ok: true };
  });

  // Partner enters measured weights. The customer then sees the amount and a 4-digit code
  // in their app (and by SMS once a provider is connected) and tells the code to the partner.
  add('POST', '/api/partner/pickups/:id/weigh', 'partner', async ({ user, params, body }) => {
    const b = ownPickup(user, params.id);
    if (b.status !== 'on_the_way') throw bad('wrong_status');
    mustBeToday(b);
    const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
    const f = saveMeasured(b, body, { status: 'on_the_way', code });
    if (cfg.otpMode === 'sms') {
      try {
        await sendConfirmCodeSms(b.customer_mobile, code, f.customer / 100);
      } catch {
        /* the code is still visible in the customer's app */
      }
    }
    return { ok: true };
  });

  add('POST', '/api/partner/pickups/:id/confirm', 'partner', ({ user, params, body }) => {
    const b = ownPickup(user, params.id);
    if (b.status !== 'on_the_way' || !b.confirm_code) throw bad('wrong_status');
    if (b.confirm_attempts >= CONFIRM_MAX_ATTEMPTS) throw bad('code_locked');
    const given = sha256(String(body.code ?? '').trim());
    if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(sha256(b.confirm_code)))) {
      db.prepare('UPDATE bookings SET confirm_attempts = confirm_attempts + 1 WHERE id = ?').run(b.id);
      throw bad('code_wrong');
    }
    db.prepare(
      "UPDATE bookings SET status = 'picked_up', picked_up_at = ?, confirm_code = NULL WHERE id = ?"
    ).run(iso(), b.id);
    return { ok: true };
  });

  add('POST', '/api/partner/pickups/:id/pay', 'partner', ({ user, params, body }) => {
    const b = ownPickup(user, params.id);
    if (b.status !== 'picked_up') throw bad('wrong_status');
    if (!['cash', 'upi'].includes(body.mode)) throw bad('invalid_input');
    db.prepare("UPDATE bookings SET status = 'paid', payment_mode = ?, paid_at = ? WHERE id = ?").run(
      body.mode, iso(), b.id
    );
    return { ok: true };
  });

  // Earnings for today and the last 7 days (by the India date of the pickup).
  add('GET', '/api/partner/earnings', 'partner', ({ user }) => {
    const today = istNow(now()).date;
    const days = [];
    for (let i = 0; i < 7; i++)
      days.push({ date: addDays(today, -i), pickups: 0, payout: 0, cash: 0, upi: 0, unpaid: 0 });
    const byDate = new Map(days.map((d) => [d.date, d]));
    const from = new Date(days[6].date + 'T00:00:00+05:30').toISOString();
    const rows = db
      .prepare(
        `SELECT picked_up_at, status, payment_mode, final_customer, final_payout FROM bookings
         WHERE partner_id = ? AND status IN ('picked_up','paid') AND picked_up_at >= ?`
      )
      .all(user.id, from);
    for (const r of rows) {
      const d = byDate.get(istNow(new Date(r.picked_up_at)).date);
      if (!d) continue;
      d.pickups += 1;
      d.payout += r.final_payout;
      if (r.status === 'paid') d[r.payment_mode] += r.final_customer;
      else d.unpaid += r.final_customer;
    }
    const rating = db
      .prepare('SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM bookings WHERE partner_id = ?')
      .get(user.id);
    return { today, days, rating: { avg: rating.avg, count: rating.n } };
  });

  // ---------- admin ----------
  add('GET', '/api/admin/dashboard', 'admin', () => {
    const today = istNow(now()).date;
    const start = new Date(today + 'T00:00:00+05:30').toISOString();
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const done = one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(final_value), 0) AS v FROM bookings
       WHERE status IN ('picked_up','paid') AND picked_up_at >= ? AND picked_up_at < ?`,
      start,
      end
    );
    return {
      today,
      todaysBookings: one(
        "SELECT COUNT(*) AS n FROM bookings WHERE pickup_date = ? AND status != 'cancelled'",
        today
      ).n,
      completedToday: done.n,
      pickupValueToday: done.v,
      activePartners: one(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'partner' AND status = 'approved'"
      ).n,
      pendingPartners: one(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'partner' AND status = 'pending'"
      ).n,
      unassigned: one("SELECT COUNT(*) AS n FROM bookings WHERE status = 'requested'").n,
    };
  });

  add('GET', '/api/admin/rates', 'admin', () => ({
    rates: currentRates().map((r) => ({
      id: r.id,
      key: r.key,
      unit: r.unit,
      buyPaise: r.buy_paise,
      resalePaise: r.resale_paise,
      effectiveAt: r.effective_at,
    })),
    history: db
      .prepare(
        `SELECT r.id, c.key, c.unit, r.buy_paise AS buyPaise, r.resale_paise AS resalePaise,
                r.effective_at AS effectiveAt, u.name AS changedBy
         FROM rates r JOIN categories c ON c.id = r.category_id
         LEFT JOIN users u ON u.id = r.changed_by
         ORDER BY r.id DESC LIMIT 200`
      )
      .all(),
  }));

  add('PUT', '/api/admin/rates/:id', 'admin', ({ user, body, params }) => {
    const cur = currentRates().find((r) => r.id === idOf(params.id));
    if (!cur) throw new HttpError(404, 'not_found');
    const buy = rupeesToPaise(body.buy, 100000);
    const resale = rupeesToPaise(body.resale, 100000);
    if (buy === cur.buy_paise && resale === cur.resale_paise) return { changed: false };
    db.prepare(
      `INSERT INTO rates (category_id, buy_paise, resale_paise, effective_at, changed_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(cur.id, buy, resale, iso(), user.id);
    return { changed: true };
  });

  add('GET', '/api/admin/bookings', 'admin', ({ query }) => {
    const where = [];
    const args = [];
    const date = query.get('date');
    const status = query.get('status');
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('invalid_input');
      where.push('b.pickup_date = ?');
      args.push(date);
    }
    if (status) {
      where.push('b.status = ?');
      args.push(status);
    }
    const order = SLOTS.map((s, i) => `WHEN '${s.id}' THEN ${i}`).join(' ');
    const rows = db
      .prepare(
        `SELECT b.*, cu.name AS customer_name, cu.mobile AS customer_mobile, pa.name AS partner_name
         FROM bookings b JOIN users cu ON cu.id = b.customer_id
         LEFT JOIN users pa ON pa.id = b.partner_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY b.pickup_date DESC, CASE b.slot ${order} END, b.id DESC LIMIT 300`
      )
      .all(...args);
    return { bookings: rows.map((b) => bookingView(b, 'admin')) };
  });

  const approvedPartners = () =>
    db
      .prepare(
        "SELECT id, name, mobile FROM users WHERE role = 'partner' AND status = 'approved' ORDER BY name"
      )
      .all();

  add('GET', '/api/admin/bookings/:id', 'admin', ({ params }) => ({
    booking: bookingView(loadBooking(idOf(params.id)), 'admin'),
    partners: approvedPartners(),
  }));

  add('POST', '/api/admin/bookings/:id/assign', 'admin', ({ params, body }) => {
    const b = loadBooking(idOf(params.id));
    if (!['requested', 'assigned'].includes(b.status)) throw bad('wrong_status');
    const p = db
      .prepare("SELECT id FROM users WHERE id = ? AND role = 'partner' AND status = 'approved'")
      .get(Number(body.partnerId) || 0);
    if (!p) throw bad('partner_not_approved');
    db.prepare(
      "UPDATE bookings SET partner_id = ?, status = 'assigned', assigned_at = ? WHERE id = ?"
    ).run(p.id, iso(), b.id);
    return { ok: true };
  });

  add('POST', '/api/admin/bookings/:id/on-the-way', 'admin', ({ params }) => {
    const b = loadBooking(idOf(params.id));
    if (b.status !== 'assigned') throw bad('wrong_status');
    db.prepare("UPDATE bookings SET status = 'on_the_way' WHERE id = ?").run(b.id);
    return { ok: true };
  });

  // Record measured weights and work out the final amounts with the rates stored on the booking.
  add('POST', '/api/admin/bookings/:id/pickup', 'admin', ({ params, body }) => {
    const b = loadBooking(idOf(params.id));
    if (!['assigned', 'on_the_way'].includes(b.status)) throw bad('wrong_status');
    // Admin override (no customer code needed), e.g. when the partner's phone is not working.
    saveMeasured(b, body, { status: 'picked_up', code: null });
    return { ok: true };
  });

  add('POST', '/api/admin/bookings/:id/pay', 'admin', ({ params, body }) => {
    const b = loadBooking(idOf(params.id));
    if (b.status !== 'picked_up') throw bad('wrong_status');
    if (!['cash', 'upi'].includes(body.mode)) throw bad('invalid_input');
    db.prepare("UPDATE bookings SET status = 'paid', payment_mode = ?, paid_at = ? WHERE id = ?").run(
      body.mode,
      iso(),
      b.id
    );
    return { ok: true };
  });

  add('POST', '/api/admin/bookings/:id/cancel', 'admin', ({ params }) => {
    const b = loadBooking(idOf(params.id));
    if (!['requested', 'assigned', 'on_the_way'].includes(b.status)) throw bad('cannot_cancel');
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(
      iso(),
      b.id
    );
    return { ok: true };
  });

  add('GET', '/api/admin/users', 'admin', ({ query }) => {
    const role = query.get('role');
    if (!['partner', 'customer'].includes(role)) throw bad('invalid_input');
    const col = role === 'partner' ? 'partner_id' : 'customer_id';
    return {
      users: db
        .prepare(
          `SELECT u.id, u.name, u.mobile, u.status, u.created_at AS createdAt,
             (SELECT COUNT(*) FROM bookings b WHERE b.${col} = u.id AND b.status != 'cancelled') AS bookings,
             (SELECT COUNT(*) FROM bookings b WHERE b.${col} = u.id AND b.status IN ('picked_up','paid')) AS completed,
             (SELECT AVG(rating) FROM bookings b WHERE b.${col} = u.id) AS rating,
             (SELECT COUNT(rating) FROM bookings b WHERE b.${col} = u.id) AS ratings
           FROM users u WHERE u.role = ?
           ORDER BY CASE u.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, u.id DESC
           LIMIT 500`
        )
        .all(role),
    };
  });

  add('POST', '/api/admin/users/:id/status', 'admin', ({ params, body }) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(idOf(params.id));
    if (!u || !['partner', 'customer'].includes(u.role)) throw new HttpError(404, 'not_found');
    if (!['approved', 'blocked'].includes(body.status)) throw bad('invalid_input');
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, u.id);
    if (body.status === 'blocked') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    return { ok: true };
  });

  const settingsView = () => {
    const s = getSettings(db);
    return {
      pickupFeePaise: s.pickup_fee_paise,
      freeThresholdPaise: s.free_threshold_paise,
      servicePins: s.service_pins,
      partnerSharePct: s.partner_share_pct,
    };
  };
  add('GET', '/api/admin/settings', 'admin', () => ({ settings: settingsView() }));

  add('PUT', '/api/admin/settings', 'admin', ({ body }) => {
    const fee = rupeesToPaise(body.pickupFee, 10000);
    const threshold = rupeesToPaise(body.freeThreshold, 100000);
    const share = Number(body.partnerSharePct);
    if (body.partnerSharePct === '' || !Number.isFinite(share) || share < 0 || share > 100)
      throw bad('invalid_input');
    if (!Array.isArray(body.servicePins) || body.servicePins.length > 500) throw bad('invalid_pin');
    const pins = [...new Set(body.servicePins.map(pinOf))].sort();
    if (pins.length === 0) throw bad('invalid_pin');
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    transaction(db, () => {
      set.run('pickup_fee_paise', JSON.stringify(fee));
      set.run('free_threshold_paise', JSON.stringify(threshold));
      set.run('partner_share_pct', JSON.stringify(share));
      set.run('service_pins', JSON.stringify(pins));
    });
    return { settings: settingsView() };
  });

  // ---------- dispatcher ----------
  async function readBody(req) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || ''))
      throw new HttpError(415, 'invalid_input');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 100 * 1024) throw new HttpError(413, 'invalid_input');
      chunks.push(c);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw bad('invalid_input');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('invalid_input');
    return body;
  }

  return async function handle(req, res, url) {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    try {
      let match;
      const route = routes.find((r) => r.method === req.method && (match = r.re.exec(url.pathname)));
      if (!route) throw new HttpError(404, 'not_found');
      const user = userFromRequest(req);
      if (route.role) {
        if (!user) throw new HttpError(401, 'login_required');
        if (route.role !== 'any' && (user.role !== route.role || user.status !== 'approved'))
          throw new HttpError(403, 'forbidden');
      }
      const params = Object.fromEntries(route.keys.map((k, i) => [k, match[i + 1]]));
      // JSON-only bodies: a cross-site form cannot send these, which blocks CSRF.
      const body = req.method === 'GET' ? {} : await readBody(req);
      const fwd = cfg.trustProxy && req.headers['x-forwarded-for'];
      const ip = (fwd && String(fwd).split(',')[0].trim()) || req.socket.remoteAddress || '';
      send(200, await route.handler({ req, res, user, params, body, ip, query: url.searchParams }));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.code });
      console.error(e);
      send(500, { error: 'server_error' });
    }
  };
}
