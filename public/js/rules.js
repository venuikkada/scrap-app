// Business rules shared by the server and the browser, so the live estimate
// the customer sees is calculated exactly the same way as the stored booking.

export const SLOTS = [
  { id: 'morning', start: 8, end: 11 },
  { id: 'afternoon', start: 12, end: 15 },
  { id: 'evening', start: 16, end: 19 },
];

export const MAX_DAYS_AHEAD = 7;
export const MAX_KG = 1000;
export const MAX_PIECES = 100;

const IST_OFFSET_MS = 330 * 60 * 1000; // India is UTC+5:30, no daylight saving

export function istNow(now = new Date()) {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Today plus the next 7 days. A slot for today can be booked only until it starts.
export function bookableDates(now = new Date()) {
  const { date: today, hour } = istNow(now);
  const out = [];
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    out.push({
      date: addDays(today, i),
      slots: SLOTS.map((s) => ({ id: s.id, available: i > 0 || hour < s.start })),
    });
  }
  return out;
}

// Cleans a quantity. Returns null if it is not acceptable.
export function normaliseQty(unit, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (unit === 'piece') return Number.isInteger(n) && n <= MAX_PIECES ? n : null;
  const kg = Math.round(n * 10) / 10; // 100 g steps
  return kg > 0 && kg <= MAX_KG ? kg : null;
}

// lines: [{ qty, buyPaise, resalePaise }]   (all money is in paise: Rs 1 = 100)
// terms: { feePaise, thresholdPaise, sharePct }
export function computeAmounts(lines, terms) {
  let value = 0;
  let resale = 0;
  for (const l of lines) {
    value += Math.round(l.qty * l.buyPaise);
    resale += Math.round(l.qty * (l.resalePaise || 0));
  }
  // Free pickup when the scrap value reaches the threshold.
  const feeDue = value >= terms.thresholdPaise ? 0 : terms.feePaise;
  // The customer never ends up owing money: the fee is capped at the scrap value.
  const fee = Math.min(feeDue, value);
  const customer = value - fee;
  // What the business earns before paying the partner.
  const gross = resale - value + fee;
  const payout = Math.max(0, Math.round((gross * (terms.sharePct || 0)) / 100));
  const margin = gross - payout;
  return { value, resale, fee, customer, payout, margin };
}
