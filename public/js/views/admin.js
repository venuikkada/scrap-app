import {
  api, html, render, busy, $, $$, toast, go,
  money, rupees, qty, perUnit, phone, dateLabel, dateTime, addressLine, badge,
} from '../ui.js';
import { t } from '../i18n.js';
import { istNow } from '../rules.js';
import { STATUS_FLOW, statusSteps, itemsTable, amountsBox, stars } from './customer.js';

export const tabs = [
  ['/', 'admin.tab.dashboard'],
  ['/bookings', 'admin.tab.bookings'],
  ['/rates', 'admin.tab.rates'],
  ['/partners', 'admin.tab.partners'],
  ['/customers', 'admin.tab.customers'],
  ['/settings', 'admin.tab.settings'],
];

export const routes = [
  [/^\/$/, dashboard],
  [/^\/bookings$/, bookings],
  [/^\/bookings\/(\d+)$/, bookingDetail],
  [/^\/rates$/, rates],
  [/^\/partners$/, () => users('partner')],
  [/^\/customers$/, () => users('customer')],
  [/^\/settings$/, settings],
];

// Filters are remembered while the app is open.
const filter = { date: istNow().date, status: '' };

// ---------- Dashboard ----------
async function dashboard() {
  const d = await api('GET', '/admin/dashboard');
  const stat = (label, value, emoji, tint = '') => html`<div class="stat"><span class="ico ${tint}" aria-hidden="true">${emoji}</span>
    <div class="big">${value}</div><div class="muted small">${label}</div></div>`;
  render(html`
    <h1>${t('dash.title')}</h1>
    <p class="muted">${dateLabel(d.today, d.today)}</p>
    <div class="grid2">
      ${stat(t('dash.todaysBookings'), d.todaysBookings, '📅')}
      ${stat(t('dash.completedToday'), d.completedToday, '✅')}
      ${stat(t('dash.pickupValue'), money(d.pickupValueToday), '💰')}
      ${stat(t('dash.activePartners'), d.activePartners, '🛺')}
    </div>
    <h2>${t('dash.needsAction')}</h2>
    ${d.unassigned === 0 && d.pendingPartners === 0 ? html`<p class="muted">${t('dash.allClear')}</p>` : ''}
    ${d.unassigned > 0
      ? html`<button class="btn alt" id="unassigned">${t('dash.unassigned', { n: String(d.unassigned) })}</button>`
      : ''}
    ${d.pendingPartners > 0
      ? html`<a class="btn alt" href="#/partners" style="margin-top:10px">${t('dash.pendingPartners', { n: String(d.pendingPartners) })}</a>`
      : ''}`);
  const u = $('#unassigned');
  if (u)
    u.onclick = () => {
      filter.date = '';
      filter.status = 'requested';
      go('#/bookings');
    };
}

// ---------- Bookings ----------
async function bookings() {
  const q = new URLSearchParams();
  if (filter.date) q.set('date', filter.date);
  if (filter.status) q.set('status', filter.status);
  const { bookings: list } = await api('GET', '/admin/bookings?' + q);
  const today = istNow().date;
  render(html`
    <h1>${t('admin.tab.bookings')}</h1>
    <div class="card">
      <div>
        <div><label for="fdate" style="margin-top:0">${t('abook.date')}</label>
          <input id="fdate" type="date" value="${filter.date}"></div>
        <div><label for="fstatus">${t('abook.status')}</label>
          <select id="fstatus">
            <option value="">${t('abook.allStatuses')}</option>
            ${[...STATUS_FLOW, 'cancelled'].map(
              (s) => html`<option value="${s}" ${s === filter.status ? html`selected` : ''}>${t('status.' + s)}</option>`
            )}
          </select></div>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn alt sm" id="ftoday">${t('date.today')}</button>
        <button class="btn alt sm" id="fall">${t('abook.allDates')}</button>
      </div>
    </div>
    <p class="muted small">${t('abook.count', { n: String(list.length) })}</p>
    ${list.map(
      (b) => html`<a class="card" href="#/bookings/${b.id}">
        <div class="row"><b>${dateLabel(b.pickupDate, today)} · ${t('slotShort.' + b.slot)}</b>${badge(b.status)}</div>
        <div>${b.customer.name} · ${b.address.locality} ${b.address.pin}</div>
        <div class="row small muted" style="margin-top:4px">
          <span>#${b.id} · ${b.partnerName ? t('abook.partnerIs', { name: b.partnerName }) : t('abook.noPartner')}</span>
          <b>${b.final ? money(b.final.value) : t('home.approx', { amount: money(b.est.value) })}</b>
        </div>
      </a>`
    )}`);
  const apply = (date, status) => {
    filter.date = date;
    filter.status = status;
    bookings();
  };
  $('#fdate').onchange = (e) => apply(e.target.value, filter.status);
  $('#fstatus').onchange = (e) => apply(filter.date, e.target.value);
  $('#ftoday').onclick = () => apply(today, filter.status);
  $('#fall').onclick = () => apply('', filter.status);
}

async function bookingDetail(id) {
  const { booking: b, partners } = await api('GET', '/admin/bookings/' + id);
  const s = b.status;
  const three = (a, isEst) => html`
    <div class="kv"><span>${t('abook.customerAmount')}</span><b>${money(a.customer)}</b></div>
    <div class="kv"><span>${t('abook.partnerPayout')}</span><b>${money(a.payout)}</b></div>
    <div class="kv"><span>${t('abook.businessMargin')}</span><b class="${a.margin < 0 ? 'neg' : ''}">${money(a.margin)}</b></div>
    ${isEst ? html`<div class="small muted">${t('abook.estimatedNote')}</div>` : ''}`;

  render(html`
    <div class="row"><h1>${t('common.bookingNo', { id: String(b.id) })}</h1>${badge(s)}</div>
    <div class="card">${statusSteps(s)}</div>

    <div class="card">
      <div class="kv"><span>${t('abook.customer')}</span><b>${b.customer.name}</b></div>
      <div class="kv"><span>${t('abook.mobile')}</span><a href="tel:+91${b.customer.mobile}">${phone(b.customer.mobile)}</a></div>
      <div class="kv"><span>${t('book.date')}</span><b>${dateLabel(b.pickupDate, istNow().date)}</b></div>
      <div class="kv"><span>${t('book.slot')}</span><b>${t('slot.' + b.slot)}</b></div>
      <div class="kv"><span>${t('detail.partner')}</span><b>${b.partnerName || t('abook.noPartner')}</b></div>
      <div class="small muted" style="margin-top:6px">${t('book.pickupFrom')}</div>
      <div><b>${b.address.name}</b>, ${addressLine(b.address)}</div>
      <div class="small muted" style="margin-top:6px">${t('abook.bookedOn', { when: dateTime(b.createdAt) })}</div>
    </div>

    ${['requested', 'assigned'].includes(s)
      ? html`<div class="card">
          <label for="partner">${t(s === 'requested' ? 'abook.assignTo' : 'abook.reassignTo')}</label>
          ${partners.length === 0
            ? html`<div class="notice">${t('abook.noApprovedPartners')}</div>`
            : html`<select id="partner">
                ${partners.map(
                  (p) => html`<option value="${p.id}" ${p.id === b.partnerId ? html`selected` : ''}>${p.name} (${phone(p.mobile)})</option>`
                )}
              </select>
              <button class="btn" id="assign" style="margin-top:10px">${t('abook.assign')}</button>`}
        </div>`
      : ''}

    ${s === 'assigned' ? html`<button class="btn alt" id="otw" style="margin-bottom:12px">${t('abook.markOnTheWay')}</button>` : ''}

    ${['assigned', 'on_the_way'].includes(s)
      ? html`<form class="card" id="pickup" novalidate>
          <h2 style="margin-top:0">${t('abook.measuredTitle')}</h2>
          <p class="small muted">${t('abook.measuredHint')} ${t('abook.overrideHint')}</p>
          ${b.items.map(
            (i) => html`<div class="item">
              <div class="grow"><b>${t('cat.' + i.key)}</b>
                <div class="small muted">${t('abook.estimated', { q: qty(i.estQty, i.unit) })} · ${perUnit(i.buyPaise, i.unit)}</div></div>
              <input type="number" inputmode="decimal" min="0" step="${i.unit === 'piece' ? '1' : '0.1'}"
                style="width:96px" data-item="${i.id}" value="${i.measuredQty ?? i.estQty}"
                aria-label="${t('cat.' + i.key)}">
              <span class="small muted" style="width:26px">${t(i.unit === 'piece' ? 'unit.pc' : 'unit.kg')}</span>
            </div>`
          )}
          <button class="btn" style="margin-top:10px">${t('abook.markPickedUp')}</button>
        </form>`
      : ''}

    ${s === 'picked_up'
      ? html`<div class="card">
          <div class="kv total" style="border:0;margin:0;padding-top:0"><span>${t('abook.payCustomer')}</span><span>${money(b.final.customer)}</span></div>
          <label>${t('detail.paymentMode')}</label>
          <div class="choices" style="grid-template-columns:1fr 1fr">
            <label class="choice"><input type="radio" name="mode" value="cash" checked><span>${t('pay.cash')}</span></label>
            <label class="choice"><input type="radio" name="mode" value="upi"><span>${t('pay.upi')}</span></label>
          </div>
          <button class="btn" id="pay" style="margin-top:10px">${t('abook.markPaid')}</button>
        </div>`
      : ''}

    <div class="card">${itemsTable(b)}</div>
    <div class="card">${amountsBox(b)}</div>
    <div class="card">
      <h2 style="margin-top:0">${t('abook.threeAmounts')}</h2>
      ${three(b.final || b.proposed || b.est, !b.final)}
    </div>
    ${b.proposed ? html`<div class="notice info">${t('abook.waitingCode')}</div>` : ''}
    ${b.rating ? html`<div class="card"><div class="small muted">${t('rate.customerGave')}</div>${stars(b.rating.stars)}
      ${b.rating.comment ? html`<div>${b.rating.comment}</div>` : ''}</div>` : ''}

    ${['requested', 'assigned', 'on_the_way'].includes(s)
      ? html`<button class="btn danger" id="cancel">${t('detail.cancel')}</button>`
      : ''}
    <a class="btn alt" href="#/bookings" style="margin-top:10px">${t('common.back')}</a>`);

  const act = (sel, event, fn) => {
    const el = $(sel);
    if (!el) return;
    el[event] = (ev) => {
      ev.preventDefault();
      busy(el.tagName === 'FORM' ? $('button', el) : el, async () => {
        if ((await fn()) === false) return;
        toast(t('common.saved'));
        bookingDetail(id);
      });
    };
  };
  const post = (path, body = {}) => api('POST', `/admin/bookings/${id}/${path}`, body);
  act('#assign', 'onclick', () => post('assign', { partnerId: Number($('#partner').value) }));
  act('#otw', 'onclick', () => post('on-the-way'));
  act('#pickup', 'onsubmit', () =>
    post('pickup', { items: $$('[data-item]').map((i) => ({ id: Number(i.dataset.item), qty: i.value })) })
  );
  act('#pay', 'onclick', () => post('pay', { mode: $('input[name=mode]:checked').value }));
  act('#cancel', 'onclick', () => (confirm(t('detail.confirmCancel')) ? post('cancel') : false));
}

// ---------- Rates ----------
function marginText(buy, resale) {
  if (!Number.isFinite(buy) || !Number.isFinite(resale)) return '';
  const m = resale - buy;
  const pct = resale > 0 ? Math.round((m / resale) * 100) : 0;
  return t('rates.margin', { amount: money(Math.round(m * 100)), pct: String(pct) });
}

async function rates() {
  const { rates: list, history } = await api('GET', '/admin/rates');
  render(html`
    <h1>${t('rates.title')}</h1>
    <p class="muted small">${t('rates.help')}</p>
    ${list.map(
      (r) => html`<form class="card" data-rate="${r.id}" novalidate>
        <div class="row"><b>${t('cat.' + r.key)}</b>
          <span class="small muted">${t(r.unit === 'piece' ? 'rates.perPiece' : 'rates.perKg')}</span></div>
        <div class="grid2">
          <div><label for="buy${r.id}">${t('rates.buy')}</label>
            <input id="buy${r.id}" name="buy" type="number" inputmode="decimal" min="0" step="0.5" value="${rupees(r.buyPaise)}"></div>
          <div><label for="resale${r.id}">${t('rates.resale')}</label>
            <input id="resale${r.id}" name="resale" type="number" inputmode="decimal" min="0" step="0.5" value="${rupees(r.resalePaise)}"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <span class="margin bold"></span>
          <button class="btn sm">${t('common.save')}</button>
        </div>
      </form>`
    )}
    <h2>${t('rates.history')}</h2>
    <div class="card"><table>
      <tr><th>${t('rates.when')}</th><th>${t('detail.item')}</th><th class="num">${t('rates.buyShort')}</th><th class="num">${t('rates.resaleShort')}</th></tr>
      ${history.map(
        (h) => html`<tr><td class="small">${dateTime(h.effectiveAt)}<br><span class="muted">${h.changedBy || t('rates.initial')}</span></td>
          <td>${t('cat.' + h.key)}</td><td class="num">${money(h.buyPaise)}</td><td class="num">${money(h.resalePaise)}</td></tr>`
      )}
    </table></div>`);

  $$('form[data-rate]').forEach((f) => {
    const show = () => {
      const buy = f.buy.value === '' ? NaN : Number(f.buy.value);
      const resale = f.resale.value === '' ? NaN : Number(f.resale.value);
      const el = $('.margin', f);
      el.textContent = marginText(buy, resale);
      el.classList.toggle('neg', resale < buy);
    };
    f.buy.oninput = f.resale.oninput = show;
    show();
    f.onsubmit = (ev) => {
      ev.preventDefault();
      busy($('button', f), async () => {
        const r = await api('PUT', '/admin/rates/' + f.dataset.rate, { buy: f.buy.value, resale: f.resale.value });
        toast(t(r.changed ? 'rates.saved' : 'rates.noChange'));
        if (r.changed) rates();
      });
    };
  });
}

// ---------- Partners / Customers ----------
async function users(role) {
  const { users: list } = await api('GET', '/admin/users?role=' + role);
  const isPartner = role === 'partner';
  render(html`
    <h1>${t(isPartner ? 'admin.tab.partners' : 'admin.tab.customers')}</h1>
    ${list.length === 0 ? html`<p class="muted">${t(isPartner ? 'users.noPartners' : 'users.noCustomers')}</p>` : ''}
    ${list.map(
      (u) => html`<div class="card">
        <div class="row"><b>${u.name}</b>${badge(u.status)}</div>
        <div><a href="tel:+91${u.mobile}">${phone(u.mobile)}</a></div>
        <div class="small muted">${t('users.joined', { when: dateTime(u.createdAt) })}</div>
        <div class="small muted">${t(isPartner ? 'users.partnerStats' : 'users.customerStats', {
          n: String(u.bookings), done: String(u.completed),
        })}</div>
        ${isPartner && u.ratings > 0 ? html`<div class="small">${u.rating.toFixed(1)} ★ <span class="muted">${t('earn.ratingCount', { n: String(u.ratings) })}</span></div>` : ''}
        <div class="btn-row" style="margin-top:10px">
          ${u.status === 'pending' ? html`<button class="btn sm" data-set="approved" data-id="${u.id}">${t('users.approve')}</button>` : ''}
          ${u.status === 'blocked'
            ? html`<button class="btn alt sm" data-set="approved" data-id="${u.id}">${t('users.unblock')}</button>`
            : html`<button class="btn danger sm" data-set="blocked" data-id="${u.id}">${t('users.block')}</button>`}
        </div>
      </div>`
    )}`);
  $$('[data-set]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.set === 'blocked' && !confirm(t('users.confirmBlock'))) return;
      busy(b, async () => {
        await api('POST', `/admin/users/${b.dataset.id}/status`, { status: b.dataset.set });
        toast(t('common.saved'));
        users(role);
      });
    };
  });
}

// ---------- Settings ----------
async function settings() {
  const { settings: s } = await api('GET', '/admin/settings');
  render(html`
    <h1>${t('admin.tab.settings')}</h1>
    <form id="f" class="card" novalidate>
      <label for="fee">${t('set.fee')}</label>
      <input id="fee" type="number" inputmode="decimal" min="0" value="${rupees(s.pickupFeePaise)}">
      <label for="threshold">${t('set.threshold')}</label>
      <input id="threshold" type="number" inputmode="decimal" min="0" value="${rupees(s.freeThresholdPaise)}">
      <p class="hint">${t('set.thresholdHint')}</p>
      <label for="share">${t('set.share')}</label>
      <input id="share" type="number" inputmode="decimal" min="0" max="100" value="${s.partnerSharePct}">
      <p class="hint">${t('set.shareHint')}</p>
      <label for="pins">${t('set.pins')}</label>
      <input id="pins" type="text" inputmode="numeric" value="${s.servicePins.join(', ')}">
      <p class="hint">${t('set.pinsHint')}</p>
      <div id="msg"></div>
      <button class="btn" style="margin-top:14px">${t('common.save')}</button>
    </form>`);
  $('#f').onsubmit = (ev) => {
    ev.preventDefault();
    const pins = $('#pins').value.split(/[\s,]+/).filter(Boolean);
    if (pins.length === 0 || pins.some((p) => !/^[1-9]\d{5}$/.test(p)))
      return ($('#msg').innerHTML = html`<div class="notice err">${t('err.invalid_pin')}</div>`.s);
    busy($('#f button'), async () => {
      await api('PUT', '/admin/settings', {
        pickupFee: $('#fee').value,
        freeThreshold: $('#threshold').value,
        partnerSharePct: $('#share').value,
        servicePins: pins,
      });
      toast(t('common.saved'));
      settings();
    });
  };
}
