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
