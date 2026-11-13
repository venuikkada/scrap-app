import { t, has } from './i18n.js';

// ---- safe HTML templates: every ${value} is escaped unless it is html`` itself ----
class Raw {
  constructor(s) { this.s = s; }
}
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ESC[c]);
const val = (v) =>
  v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v == null || v === false ? '' : esc(v);
export const html = (strings, ...vals) =>
  new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? val(vals[i]) : ''), ''));

export const $app = document.getElementById('app');
export function render(tpl) {
  $app.innerHTML = tpl.s;
  window.scrollTo(0, 0);
}
export const $ = (sel, root = $app) => root.querySelector(sel);
export const $$ = (sel, root = $app) => [...root.querySelectorAll(sel)];

// ---- API ----
export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('session-lost'));
    throw new ApiError(data.error || 'server_error', res.status);
  }
  return data;
}
export const errText = (e) => (e && has('err.' + e.code) ? t('err.' + e.code) : t('err.server_error'));

let toastTimer;
export function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}
export const toastErr = (e) => toast(errText(e), true);

// Runs an async action from a button; disables it meanwhile to stop double taps.
export async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); } catch (e) { toastErr(e); } finally { btn.disabled = false; }
}

// ---- formatting ----
export const money = (paise) =>
  (paise < 0 ? '-' : '') + '₹' +
  (Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const rupees = (paise) => String(paise / 100);
export const qty = (n, unit) => t(unit === 'piece' ? 'unit.pcs' : 'unit.kgs', { n: String(n) });
export const perUnit = (paise, unit) => money(paise) + t(unit === 'piece' ? 'unit.perPiece' : 'unit.perKg');
export const phone = (m) => '+91 ' + m.slice(0, 5) + ' ' + m.slice(5);

export function dateLabel(dateStr, today) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return dateStr === today ? `${t('date.today')}, ${label}` : label;
}
export const dateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const addressLine = (a) =>
  [a.houseNo, a.street, a.locality, a.landmark && t('addr.near', { landmark: a.landmark }), a.pin].filter(Boolean).join(', ');

export const badge = (status) => html`<span class="badge ${status}">${t('status.' + status)}</span>`;
export const go = (hash) => { location.hash = hash; };

// ---- shared session state ----
export const state = { app: null, user: null };

// ---- icons ----
const svg = (d) => new Raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
export const ICON = {
  home: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  plus: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
  pin: svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>'),
  truck: svg('<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7z"/><circle cx="7.500" cy="17.500" r="1.800"/><circle cx="17.500" cy="17.500" r="1.800"/>'),
  wallet: svg('<path d="M4 7h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h12"/><path d="M16 13h2"/>'),
  logo: new Raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v4h-4"/><path d="M9 9h6M9 12h6M10.5 9c2.6 0 2.6 3 0 3l3.2 4"/></svg>`),
};
const CAT_EMOJI = {
  newspaper: '📰', cardboard: '📦', books: '📚', plastic_bottles: '🧴', plastic_mixed: '🛍️',
  iron: '🔩', copper: '🔌', aluminium: '🥫', appliances: '📺', ewaste: '💻',
};
export const catEmoji = (key) => CAT_EMOJI[key] || '♻️';
export const catIcon = (key) => html`<span class="ico c-${key}" aria-hidden="true">${catEmoji(key)}</span>`;
// Decorative art for the dark hero blocks: a lime coin, rings and a spark.
export const HERO_ART = new Raw(`<svg class="hero-art" viewBox="0 0 190 190" fill="none" aria-hidden="true">
  <circle cx="118" cy="72" r="86" stroke="#1c3527" stroke-width="22"/>
  <circle cx="118" cy="72" r="52" stroke="#2a4a37" stroke-width="2" stroke-dasharray="3 7"/>
  <circle cx="126" cy="66" r="34" fill="#c9f24a"/>
  <path d="M114 54h24M114 63h24M119 54c13 0 13 9 0 9l13 16" stroke="#0f2218" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M152 118l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#ffd35c"/>
  <circle cx="84" cy="24" r="5" fill="#ff6a48"/></svg>`);
