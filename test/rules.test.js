import test from 'node:test';
import assert from 'node:assert/strict';
import { bookableDates, computeAmounts, normaliseQty } from '../public/js/rules.js';

const terms = { feePaise: 5000, thresholdPaise: 20000, sharePct: 50 };

test('pickup is free when value reaches the threshold', () => {
  // 20 kg newspaper at Rs 12 = Rs 240
  const r = computeAmounts([{ qty: 20, buyPaise: 1200, resalePaise: 1500 }], terms);
  assert.equal(r.value, 24000);
  assert.equal(r.fee, 0);
  assert.equal(r.customer, 24000);
  // earning = 300 - 240 = Rs 60, split 50/50
  assert.equal(r.payout, 3000);
  assert.equal(r.margin, 3000);
});

test('exactly at the threshold is free', () => {
  const r = computeAmounts([{ qty: 20, buyPaise: 1000, resalePaise: 1300 }], terms);
  assert.equal(r.value, 20000);
  assert.equal(r.fee, 0);
});

test('pickup fee applies below the threshold', () => {
  // 10 kg at Rs 12 = Rs 120, fee Rs 50 -> customer gets Rs 70
  const r = computeAmounts([{ qty: 10, buyPaise: 1200, resalePaise: 1500 }], terms);
  assert.equal(r.fee, 5000);
  assert.equal(r.customer, 7000);
  // earning = 150 - 120 + 50 = Rs 80
  assert.equal(r.payout + r.margin, 8000);
});

test('customer amount never goes below zero', () => {
  const r = computeAmounts([{ qty: 2, buyPaise: 1200, resalePaise: 1500 }], terms);
  assert.equal(r.value, 2400);
  assert.equal(r.fee, 2400);
  assert.equal(r.customer, 0);
});

test('quantities: kg in 100 g steps, pieces whole numbers', () => {
  assert.equal(normaliseQty('kg', '2.54'), 2.5);
  assert.equal(normaliseQty('kg', 0), null);
  assert.equal(normaliseQty('kg', -1), null);
  assert.equal(normaliseQty('kg', 'abc'), null);
  assert.equal(normaliseQty('kg', 5000), null);
  assert.equal(normaliseQty('piece', 2), 2);
  assert.equal(normaliseQty('piece', 1.5), null);
});

test('dates: today + 7 days, past slots of today are closed (IST)', () => {
  // 07:30 UTC = 13:00 IST
  const d = bookableDates(new Date('2026-11-13T07:30:00Z'));
  assert.equal(d.length, 8);
  assert.equal(d[0].date, '2026-11-13');
  assert.equal(d[7].date, '2026-11-20');
  assert.deepEqual(d[0].slots.map((s) => s.available), [false, false, true]);
  assert.ok(d[1].slots.every((s) => s.available));
  // 20:00 UTC = 01:30 IST next day
  assert.equal(bookableDates(new Date('2026-11-13T20:00:00Z'))[0].date, '2026-11-14');
});
