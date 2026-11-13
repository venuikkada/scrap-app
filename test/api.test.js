import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.js';
import { bookableDates } from '../public/js/rules.js';

let base;
let app;

before(async () => {
  app = createServer({ dbPath: ':memory:', otpMode: 'test', testOtp: '123456' });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.server.close());

// A tiny client that remembers its login cookie.
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  call.login = async (mobile) => {
    await call('POST', '/auth/request-otp', { mobile });
    return call('POST', '/auth/verify-otp', { mobile, otp: '123456' });
  };
  return call;
}

const makeAdmin = (mobile) =>
  app.db
    .prepare("INSERT INTO users (mobile, name, role, status, created_at) VALUES (?, 'Owner', 'admin', 'approved', ?)")
    .run(mobile, new Date().toISOString());

// The first date/slot that can still be booked right now.
function freeSlot() {
  for (const d of bookableDates()) {
    const s = d.slots.find((x) => x.available);
    if (s) return { date: d.date, slot: s.id };
  }
}

const ADDRESS = { name: 'Lakshmi', houseNo: 'Flat 201', street: 'Road 3', locality: 'Madhapur', pin: '500081', landmark: '' };

test('login: wrong OTP is rejected, right OTP logs in', async () => {
  const c = client();
  await c('POST', '/auth/request-otp', { mobile: '9000000001' });
  const wrong = await c('POST', '/auth/verify-otp', { mobile: '9000000001', otp: '000000' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, 'otp_wrong');
  const ok = await c('POST', '/auth/verify-otp', { mobile: '9000000001', otp: '123456' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, null);
  assert.equal((await c('POST', '/auth/request-otp', { mobile: '12345' })).data.error, 'invalid_mobile');
});

test('roles: nobody can pick admin; partner starts pending and is locked out', async () => {
  const c = client();
  await c.login('9000000002');
  assert.equal((await c('POST', '/me/role', { role: 'admin', name: 'X' })).status, 400);
  const r = await c('POST', '/me/role', { role: 'partner', name: 'Raju' });
  assert.equal(r.data.user.status, 'pending');
  assert.equal((await c('GET', '/catalog')).status, 403);
  assert.equal((await c('GET', '/admin/dashboard')).status, 403);
  assert.equal((await client()('GET', '/bookings')).status, 401);
});

test('full flow: book -> assign -> on the way -> picked up -> paid', async () => {
  makeAdmin('9000000010');
  const admin = client();
  await admin.login('9000000010');
  const partner = client();
  await partner.login('9000000011');
  await partner('POST', '/me/role', { role: 'partner', name: 'Raju' });
  const cust = client();
  await cust.login('9000000012');
  await cust('POST', '/me/role', { role: 'customer', name: 'Lakshmi' });

  // catalog never shows the resale price to customers
  const cat = (await cust('GET', '/catalog')).data;
  assert.equal(cat.categories.length, 10);
  assert.ok(cat.categories.every((c) => !('resalePaise' in c)));
  const paper = cat.categories.find((c) => c.key === 'newspaper');
  const ewaste = cat.categories.find((c) => c.key === 'ewaste');
  assert.equal(paper.buyPaise, 1200);
  assert.equal(ewaste.unit, 'piece');

  // PIN outside the service area cannot be booked
  const far = (await cust('POST', '/addresses', { ...ADDRESS, pin: '110001' })).data;
  assert.equal(far.serviceable, false);
  const when = freeSlot();
  const items = [{ categoryId: paper.id, qty: 10 }];
  const no = await cust('POST', '/bookings', { addressId: far.id, ...when, items });
  assert.equal(no.data.error, 'pin_not_serviced');

  const addr = (await cust('POST', '/addresses', ADDRESS)).data;
  assert.equal(addr.serviceable, true);

  // bad inputs
  const post = (b) => cust('POST', '/bookings', { addressId: addr.id, ...when, items, ...b });
  assert.equal((await post({ items: [] })).data.error, 'no_items');
  assert.equal((await post({ items: [{ categoryId: ewaste.id, qty: 1.5 }] })).data.error, 'invalid_qty');
  assert.equal((await post({ date: '2020-01-01' })).data.error, 'invalid_slot');
  assert.equal((await post({ date: bookableDates().at(-1).date.replace(/\d\d$/, '99') })).data.error, 'invalid_slot');

  // 10 kg newspaper = Rs 120 -> below Rs 200, so Rs 50 fee
  const made = await post({});
  assert.equal(made.status, 200);
  const id = made.data.id;
  let b = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(b.status, 'requested');
  assert.deepEqual(b.est, { value: 12000, fee: 5000, customer: 7000 });
  assert.equal(b.items[0].resalePaise, undefined);

  // another customer cannot open it
  const other = client();
  await other.login('9000000013');
  await other('POST', '/me/role', { role: 'customer', name: 'Other' });
  assert.equal((await other('GET', '/bookings/' + id)).status, 404);
  assert.equal((await other('POST', `/bookings/${id}/cancel`, {})).status, 404);
  assert.equal((await cust('GET', '/admin/bookings')).status, 403);

  // rate change after booking must not change the booking
  assert.equal((await admin('PUT', '/admin/rates/' + paper.id, { buy: 15, resale: 18 })).data.changed, true);
  const rates = (await admin('GET', '/admin/rates')).data;
  assert.equal(rates.rates.find((r) => r.key === 'newspaper').buyPaise, 1500);
  assert.equal(rates.history.filter((h) => h.key === 'newspaper').length, 2);
  assert.equal((await cust('GET', '/catalog')).data.categories.find((c) => c.key === 'newspaper').buyPaise, 1500);

  // cannot assign a partner who is still pending
  const partners = (await admin('GET', '/admin/users?role=partner')).data.users;
  const raju = partners.find((p) => p.mobile === '9000000011');
  const a = (path, body = {}) => admin('POST', `/admin/bookings/${id}/${path}`, body);
  assert.equal((await a('assign', { partnerId: raju.id })).data.error, 'partner_not_approved');
  await admin('POST', `/admin/users/${raju.id}/status`, { status: 'approved' });

  // steps cannot be skipped
  assert.equal((await a('pay', { mode: 'cash' })).data.error, 'wrong_status');
  assert.equal((await a('on-the-way')).data.error, 'wrong_status');

  assert.equal((await a('assign', { partnerId: raju.id })).status, 200);
  assert.equal((await a('on-the-way')).status, 200);
  b = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(b.status, 'on_the_way');
  assert.equal(b.partnerName, 'Raju');
  assert.equal((await cust('POST', `/bookings/${id}/cancel`, {})).data.error, 'cannot_cancel');

  // measured 18 kg at the OLD rate Rs 12 = Rs 216 -> now free pickup
  assert.equal((await a('pickup', { items: [{ id: b.items[0].id, qty: -3 }] })).data.error, 'invalid_qty');
  assert.equal((await a('pickup', { items: [{ id: b.items[0].id, qty: 18 }] })).status, 200);
  const full = (await admin('GET', '/admin/bookings/' + id)).data.booking;
  assert.equal(full.status, 'picked_up');
  assert.equal(full.items[0].buyPaise, 1200);
  // resale 18 x 15 = 270; earning 270 - 216 = 54; split 27 / 27
  assert.deepEqual(full.final, { value: 21600, fee: 0, customer: 21600, payout: 2700, margin: 2700 });

  assert.equal((await a('pay', { mode: 'cheque' })).status, 400);
  assert.equal((await a('pay', { mode: 'upi' })).status, 200);
  b = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(b.status, 'paid');
  assert.equal(b.paymentMode, 'upi');
  assert.equal(b.final.customer, 21600);
  assert.equal(b.final.margin, undefined);

  const dash = (await admin('GET', '/admin/dashboard')).data;
  assert.equal(dash.completedToday, 1);
  assert.equal(dash.pickupValueToday, 21600);
  assert.equal(dash.activePartners, 1);

  // settings: new fee applies to new bookings only
  const set = await admin('PUT', '/admin/settings', {
    pickupFee: 30, freeThreshold: 500, partnerSharePct: 40, servicePins: ['500081', '500001'],
  });
  assert.equal(set.data.settings.pickupFeePaise, 3000);
  assert.equal((await admin('PUT', '/admin/settings', { pickupFee: 30, freeThreshold: 500, partnerSharePct: 40, servicePins: ['12'] })).status, 400);
  const second = await post({ items: [{ categoryId: paper.id, qty: 10 }] });
  const b2 = (await cust('GET', '/bookings/' + second.data.id)).data.booking;
  assert.deepEqual(b2.est, { value: 15000, fee: 3000, customer: 12000 });
  assert.equal((await cust('POST', `/bookings/${b2.id}/cancel`, {})).status, 200);

  // blocking a customer logs them out
  const custRow = (await admin('GET', '/admin/users?role=customer')).data.users.find((u) => u.mobile === '9000000012');
  assert.equal(custRow.completed, 1);
  await admin('POST', `/admin/users/${custRow.id}/status`, { status: 'blocked' });
  assert.equal((await cust('GET', '/bookings')).status, 401);
  assert.equal((await cust.login('9000000012')).data.error, 'blocked');
});

test('phase 2: partner pickup with customer code, payment, earnings, rating, privacy', async () => {
  makeAdmin('9000000020');
  const admin = client();
  await admin.login('9000000020');
  const mk = async (mobile, role, name) => {
    const c = client();
    await c.login(mobile);
    await c('POST', '/me/role', { role, name });
    return c;
  };
  const raju = await mk('9000000021', 'partner', 'Raju');
  const other = await mk('9000000022', 'partner', 'Other Partner');
  const cust = await mk('9000000023', 'customer', 'Sita');
  for (const u of (await admin('GET', '/admin/users?role=partner')).data.users)
    if (u.status === 'pending') await admin('POST', `/admin/users/${u.id}/status`, { status: 'approved' });
  const rajuId = app.db.prepare("SELECT id FROM users WHERE mobile = '9000000021'").get().id;

  const cat = (await cust('GET', '/catalog')).data;
  const iron = cat.categories.find((c) => c.key === 'iron');
  const addr = (await cust('POST', '/addresses', ADDRESS)).data;
  const today = bookableDates()[0].date;
  const tomorrow = bookableDates()[1].date;
  const book = async (date) =>
    (await cust('POST', '/bookings', { addressId: addr.id, date, slot: 'evening', items: [{ categoryId: iron.id, qty: 10 }] })).data.id;

  // booking for tomorrow: partner sees the address but NOT the phone number
  const later = await book(tomorrow);
  await admin('POST', `/admin/bookings/${later}/assign`, { partnerId: rajuId });
  let list = (await raju('GET', '/partner/pickups?date=' + tomorrow)).data;
  assert.equal(list.pickups.length, 1);
  assert.equal(list.pickups[0].customer.name, 'Sita');
  assert.equal(list.pickups[0].customer.mobile, null);
  assert.equal(list.pickups[0].est.margin, undefined);
  assert.equal(list.pickups[0].items, undefined);
  assert.equal((await raju('POST', `/partner/pickups/${later}/on-the-way`, {})).data.error, 'not_today');
  // another partner and a customer cannot see it
  assert.equal((await other('GET', '/partner/pickups/' + later)).status, 404);
  assert.equal((await other('GET', '/partner/pickups?date=' + tomorrow)).data.pickups.length, 0);
  assert.equal((await cust('GET', '/partner/pickups')).status, 403);

  // a booking for today (put straight into the database: today's slots may already be over)
  const id = await book(tomorrow);
  app.db.prepare('UPDATE bookings SET pickup_date = ? WHERE id = ?').run(today, id);
  await admin('POST', `/admin/bookings/${id}/assign`, { partnerId: rajuId });
  list = (await raju('GET', '/partner/pickups')).data;
  assert.equal(list.pickups[0].customer.mobile, '9000000023');

  const p = (path, body = {}) => raju('POST', `/partner/pickups/${id}/${path}`, body);
  assert.equal((await p('weigh', { items: [] })).data.error, 'wrong_status');
  assert.equal((await p('on-the-way')).status, 200);
  assert.equal((await p('confirm', { code: '0000' })).data.error, 'wrong_status');

  const itemId = (await raju('GET', '/partner/pickups/' + id)).data.pickup.items[0].id;
  // The earlier test left the settings at: fee Rs 30, free from Rs 500, partner share 40%.
  // 9 kg iron x Rs 28 = Rs 252, minus Rs 30 fee = Rs 222
  assert.equal((await p('weigh', { items: [{ id: itemId, qty: 9 }] })).status, 200);
  let seen = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(seen.status, 'on_the_way');
  assert.equal(seen.final, null);
  assert.equal(seen.proposed.customer, 22200);
  assert.match(seen.confirmCode, /^\d{4}$/);
  // the code is never sent to the partner or the admin
  assert.equal((await raju('GET', '/partner/pickups/' + id)).data.pickup.confirmCode, undefined);
  assert.equal((await admin('GET', '/admin/bookings/' + id)).data.booking.confirmCode, undefined);

  const wrong = seen.confirmCode === '1111' ? '2222' : '1111';
  assert.equal((await p('confirm', { code: wrong })).data.error, 'code_wrong');
  assert.equal((await p('pay', { mode: 'cash' })).data.error, 'wrong_status');
  // re-weighing gives a new amount; 5 wrong tries lock the code
  assert.equal((await p('weigh', { items: [{ id: itemId, qty: 9.5 }] })).status, 200);
  for (let i = 0; i < 5; i++) await p('confirm', { code: 'xxxx' });
  seen = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal((await p('confirm', { code: seen.confirmCode })).data.error, 'code_locked');
  assert.equal((await p('weigh', { items: [{ id: itemId, qty: 9.5 }] })).status, 200);
  seen = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(seen.proposed.customer, 23600);
  assert.equal((await cust('POST', `/bookings/${id}/rating`, { stars: 5 })).data.error, 'wrong_status');
  assert.equal((await p('confirm', { code: seen.confirmCode })).status, 200);
  assert.equal((await p('pay', { mode: 'cash' })).status, 200);

  seen = (await cust('GET', '/bookings/' + id)).data.booking;
  assert.equal(seen.status, 'paid');
  assert.equal(seen.final.customer, 23600);
  assert.equal(seen.confirmCode, undefined);

  // rating: once, 1-5 stars
  assert.equal((await cust('POST', `/bookings/${id}/rating`, { stars: 9 })).data.error, 'invalid_rating');
  assert.equal((await cust('POST', `/bookings/${id}/rating`, { stars: 4, comment: 'On time' })).status, 200);
  assert.equal((await cust('POST', `/bookings/${id}/rating`, { stars: 1 })).data.error, 'already_rated');

  // earnings: resale 9.5 x 33 = 313.50; earning 313.50 - 266 + 30 fee = 77.50; partner 40% = 31
  const e = (await raju('GET', '/partner/earnings')).data;
  assert.equal(e.days.length, 7);
  assert.deepEqual(e.days[0], { date: today, pickups: 1, payout: 3100, cash: 23600, upi: 0, unpaid: 0 });
  assert.deepEqual(e.rating, { avg: 4, count: 1 });
  assert.equal((await other('GET', '/partner/earnings')).data.days[0].pickups, 0);
  const row = (await admin('GET', '/admin/users?role=partner')).data.users.find((u) => u.id === rajuId);
  assert.equal(row.rating, 4);

  // re-assigning takes the booking away from the first partner
  const otherId = app.db.prepare("SELECT id FROM users WHERE mobile = '9000000022'").get().id;
  await admin('POST', `/admin/bookings/${later}/assign`, { partnerId: otherId });
  assert.equal((await raju('GET', '/partner/pickups/' + later)).status, 404);
});

test('requests without JSON content type are refused (CSRF guard)', async () => {
  const res = await fetch(base + '/api/auth/logout', { method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('static files: app shell, manifest, no path escape', async () => {
  const home = await fetch(base + '/');
  assert.match(await home.text(), /<title>Scrap Pickup<\/title>/);
  const m = await (await fetch(base + '/manifest.webmanifest')).json();
  assert.equal(m.display, 'standalone');
  assert.equal((await fetch(base + '/icons/icon-512.png')).status, 200);
  const esc = await fetch(base + '/..%2f..%2fpackage.json');
  assert.notEqual(esc.status, 200);
});
