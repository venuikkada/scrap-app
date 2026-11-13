import {
  api, html, render, state, busy, $, $$, toast,
  money, qty, perUnit, phone, dateLabel, addressLine, badge,
} from '../ui.js';
import { t } from '../i18n.js';
import { statusSteps, itemsTable, amountsBox, stars } from './customer.js';

export const tabs = [
  ['/', 'ptab.pickups'],
  ['/earnings', 'ptab.earnings'],
];

export const routes = [
  [/^\/$/, pickups],
  [/^\/pickups\/(\d+)$/, pickupDetail],
  [/^\/earnings$/, earnings],
];

let day = null; // date being viewed; null = today

const mapUrl = (a) =>
  'https://www.google.com/maps/search/?api=1&query=' +
  encodeURIComponent([a.houseNo, a.street, a.locality, a.landmark, state.app.city, a.pin].filter(Boolean).join(', '));

const mapBtn = (a) =>
  html`<a class="btn alt sm" href="${mapUrl(a)}" target="_blank" rel="noopener">${t('pick.map')}</a>`;
const callBtn = (c) =>
  c.mobile ? html`<a class="btn alt sm" href="tel:+91${c.mobile}">${t('pick.call')}</a>` : '';

// ---------- Pickups for the day, in route order ----------
async function pickups() {
  let r;
  try {
    r = await api('GET', '/partner/pickups' + (day ? '?date=' + day : ''));
  } catch (e) {
    if (!day) throw e;
    day = null; // the saved date is no longer valid (for example after midnight)
    return pickups();
  }
  const open = r.pickups.filter((p) => ['assigned', 'on_the_way'].includes(p.status)).length;
  let n = 0;
  let lastSlot = '';
  render(html`
    <h1>${t('pick.title')}</h1>
    <div class="choices cols3">
      ${r.dates.map(
        (d) => html`<label class="choice"><input type="radio" name="day" value="${d}" ${d === r.date ? html`checked` : ''}>
          <span class="small">${dateLabel(d, r.today)}</span></label>`
      )}
    </div>
    <p class="muted small" style="margin-top:10px">${t('pick.count', { n: String(r.pickups.length), open: String(open) })}</p>
    ${r.pickups.length === 0 ? html`<div class="card muted">${t('pick.none')}</div>` : ''}
    ${r.pickups.map((p) => {
      n += 1;
      const head = p.slot !== lastSlot ? html`<h2>${t('slot.' + p.slot)}</h2>` : '';
      lastSlot = p.slot;
      return html`${head}
        <div class="card">
          <div class="row"><b>${String(n)}. ${p.customer.name}</b>${badge(p.status)}</div>
          <div>${addressLine(p.address)}</div>
          <div class="small muted">${t('home.approx', { amount: money(p.est.value) })} · #${p.id}</div>
          <div class="btn-row" style="margin-top:10px">
            ${mapBtn(p.address)} ${callBtn(p.customer)}
            <a class="btn sm" href="#/pickups/${p.id}">${t('pick.open')}</a>
          </div>
        </div>`;
    })}
    <button class="btn alt" id="refresh" style="margin-top:6px">${t('common.refresh')}</button>`);
  $$('input[name=day]').forEach((el) => {
    el.onchange = () => {
      day = el.value === r.today ? null : el.value;
      pickups();
    };
  });
  $('#refresh').onclick = () => pickups();
}

// ---------- One pickup ----------
async function pickupDetail(id, editWeights = false) {
  const { pickup: p, today } = await api('GET', '/partner/pickups/' + id);
  const s = p.status;
  const isToday = p.pickupDate === today;
  const showWeights = s === 'on_the_way' && (!p.proposed || editWeights);

  render(html`
    <div class="row"><h1>${t('common.bookingNo', { id: String(p.id) })}</h1>${badge(s)}</div>

    <div class="card">
      <div class="kv"><span>${t('abook.customer')}</span><b>${p.customer.name}</b></div>
      ${p.customer.mobile
        ? html`<div class="kv"><span>${t('abook.mobile')}</span><a href="tel:+91${p.customer.mobile}">${phone(p.customer.mobile)}</a></div>`
        : html`<div class="small muted">${t('pick.phoneLater')}</div>`}
      <div class="kv"><span>${t('book.date')}</span><b>${dateLabel(p.pickupDate, today)}</b></div>
      <div class="kv"><span>${t('book.slot')}</span><b>${t('slot.' + p.slot)}</b></div>
      <div class="small muted" style="margin-top:6px">${t('book.pickupFrom')}</div>
      <div><b>${p.address.name}</b>, ${addressLine(p.address)}</div>
      <div class="btn-row" style="margin-top:10px">${mapBtn(p.address)} ${callBtn(p.customer)}</div>
    </div>

    ${s === 'assigned'
      ? isToday
        ? html`<button class="btn" id="otw" style="margin-bottom:12px">${t('pick.start')}</button>`
        : html`<div class="notice">${t('pick.notToday')}</div>`
      : ''}

    ${showWeights
      ? html`<form class="card" id="weigh" novalidate>
          <h2 style="margin-top:0">${t('abook.measuredTitle')}</h2>
          <p class="small muted">${t('abook.measuredHint')}</p>
          ${p.items.map(
            (i) => html`<div class="item">
              <div class="grow"><b>${t('cat.' + i.key)}</b>
                <div class="small muted">${t('abook.estimated', { q: qty(i.estQty, i.unit) })} · ${perUnit(i.buyPaise, i.unit)}</div></div>
              <input type="number" inputmode="decimal" min="0" step="${i.unit === 'piece' ? '1' : '0.1'}"
                style="width:96px" data-item="${i.id}" value="${i.measuredQty ?? ''}" placeholder="0"
                aria-label="${t('cat.' + i.key)}">
              <span class="small muted" style="width:26px">${t(i.unit === 'piece' ? 'unit.pc' : 'unit.kg')}</span>
            </div>`
          )}
          <button class="btn" style="margin-top:10px">${t('pick.calculate')}</button>
        </form>`
      : ''}

    ${s === 'on_the_way' && p.proposed && !editWeights
      ? html`<form class="card" id="confirm" novalidate>
          <div class="small muted">${t('pick.payAmount')}</div>
          <div class="big">${money(p.proposed.customer)}</div>
          <label for="code">${t('pick.codeLabel')}</label>
          <input id="code" type="text" inputmode="numeric" maxlength="4" autocomplete="off" class="code-input">
          <p class="hint">${t('pick.codeHint')}</p>
          <button class="btn" style="margin-top:10px">${t('pick.confirmCode')}</button>
          <button type="button" class="btn alt" id="reweigh" style="margin-top:10px">${t('pick.changeWeights')}</button>
        </form>`
      : ''}

    ${s === 'picked_up'
      ? html`<div class="card">
          <div class="small muted">${t('abook.payCustomer')}</div>
          <div class="big">${money(p.final.customer)}</div>
          <label>${t('pick.howPaid')}</label>
          <div class="choices" style="grid-template-columns:1fr 1fr">
            <label class="choice"><input type="radio" name="mode" value="cash" checked><span>${t('pay.cash')}</span></label>
            <label class="choice"><input type="radio" name="mode" value="upi"><span>${t('pay.upi')}</span></label>
          </div>
          <button class="btn" id="pay" style="margin-top:10px">${t('abook.markPaid')}</button>
        </div>`
      : ''}

    ${s === 'paid'
      ? html`<div class="notice ok"><b>${t('pick.done')}</b><br>${t('pick.yourEarning', { amount: money(p.final.payout) })}</div>`
      : ''}

    <div class="card">${statusSteps(s)}</div>
    <div class="card">${itemsTable(p)}</div>
    <div class="card">${amountsBox(p)}
      <div class="kv"><span>${t(p.final ? 'pick.earning' : 'pick.earningApprox')}</span>
        <b>${money((p.final || p.proposed || p.est).payout)}</b></div>
    </div>
    ${p.rating ? html`<div class="card"><div class="small muted">${t('rate.customerGave')}</div>${stars(p.rating.stars)}
      ${p.rating.comment ? html`<div>${p.rating.comment}</div>` : ''}</div>` : ''}
    <a class="btn alt" href="#/">${t('common.back')}</a>`);

  const post = (path, body = {}) => api('POST', `/partner/pickups/${id}/${path}`, body);
  const act = (sel, event, fn, msg = 'common.saved') => {
    const el = $(sel);
    if (!el) return;
    el[event] = (ev) => {
      ev.preventDefault();
      busy(el.tagName === 'FORM' ? $('button', el) : el, async () => {
        await fn();
        toast(t(msg));
        pickupDetail(id);
      });
    };
  };
  act('#otw', 'onclick', () => post('on-the-way'));
  act('#weigh', 'onsubmit', () =>
    post('weigh', { items: $$('[data-item]').map((i) => ({ id: Number(i.dataset.item), qty: i.value || '0' })) }),
    'pick.codeSent'
  );
  act('#confirm', 'onsubmit', () => post('confirm', { code: $('#code').value.trim() }), 'pick.confirmed');
  act('#pay', 'onclick', () => post('pay', { mode: $('input[name=mode]:checked').value }));
  const re = $('#reweigh');
  if (re) re.onclick = () => pickupDetail(id, true);
}

// ---------- Earnings ----------
async function earnings() {
  const r = await api('GET', '/partner/earnings');
  const d = r.days[0];
  render(html`
    <h1>${t('earn.title')}</h1>
    <p class="muted">${dateLabel(r.today, r.today)}</p>
    <div class="grid2">
      <div class="stat"><div class="big">${money(d.payout)}</div><div class="muted small">${t('earn.today')}</div></div>
      <div class="stat"><div class="big">${String(d.pickups)}</div><div class="muted small">${t('earn.pickups')}</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="small muted">${t('earn.paidToCustomers')}</div>
      <div class="kv"><span>${t('pay.cash')}</span><b>${money(d.cash)}</b></div>
      <div class="kv"><span>${t('pay.upi')}</span><b>${money(d.upi)}</b></div>
      ${d.unpaid > 0 ? html`<div class="kv neg"><span>${t('earn.unpaid')}</span><b>${money(d.unpaid)}</b></div>` : ''}
    </div>
    <div class="card">
      <div class="small muted">${t('earn.rating')}</div>
      ${r.rating.count > 0
        ? html`<div class="big">${r.rating.avg.toFixed(1)} ★</div><div class="small muted">${t('earn.ratingCount', { n: String(r.rating.count) })}</div>`
        : html`<div class="muted">${t('earn.noRating')}</div>`}
    </div>
    <h2>${t('earn.last7')}</h2>
    <div class="card"><table>
      <tr><th>${t('rates.when')}</th><th class="num">${t('earn.pickups')}</th><th class="num">${t('earn.earned')}</th></tr>
      ${r.days.map(
        (x) => html`<tr><td>${dateLabel(x.date, r.today)}</td><td class="num">${String(x.pickups)}</td><td class="num">${money(x.payout)}</td></tr>`
      )}
      <tr><td><b>${t('earn.total')}</b></td>
        <td class="num"><b>${String(r.days.reduce((a, x) => a + x.pickups, 0))}</b></td>
        <td class="num"><b>${money(r.days.reduce((a, x) => a + x.payout, 0))}</b></td></tr>
    </table></div>`);
}
