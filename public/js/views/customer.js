import {
  api, html, render, state, busy, $, $$, toast, go,
  money, qty, perUnit, dateLabel, addressLine, badge,
} from '../ui.js';
import { t } from '../i18n.js';
import { computeAmounts, normaliseQty, istNow } from '../rules.js';

export const STATUS_FLOW = ['requested', 'assigned', 'on_the_way', 'picked_up', 'paid'];

// The booking being built. Kept in memory so the customer can add an address mid-way.
let draft;
export function resetDraft() {
  draft = { qty: {}, addressId: null, date: null, slot: null, step: 1 };
}
resetDraft();
let returnToBooking = false;

export const routes = [
  [/^\/$/, home],
  [/^\/book$/, book],
  [/^\/addresses$/, addresses],
  [/^\/addresses\/new$/, () => addressForm(null)],
  [/^\/addresses\/(\d+)$/, addressForm],
  [/^\/bookings\/(\d+)$/, bookingDetail],
];

const slotLabel = (id) => t('slot.' + id);

// ---------- Home ----------
async function home() {
  const { bookings } = await api('GET', '/bookings');
  const today = istNow().date;
  render(html`
    <h1>${t('home.hello', { name: state.user.name || '' })}</h1>
    <a class="btn" href="#/book">${t('home.book')}</a>
    <a class="btn alt" href="#/addresses" style="margin-top:10px">${t('home.addresses')}</a>
    <h2>${t('home.myBookings')}</h2>
    ${bookings.length === 0 ? html`<p class="muted">${t('home.noBookings')}</p>` : ''}
    ${bookings.map(
      (b) => html`<a class="card" href="#/bookings/${b.id}">
        <div class="row"><b>${dateLabel(b.pickupDate, today)}</b>${badge(b.status)}</div>
        <div class="muted small">${slotLabel(b.slot)}</div>
        <div class="row" style="margin-top:6px">
          <span class="muted small">${t('common.bookingNo', { id: String(b.id) })}</span>
          <b>${b.final ? money(b.final.customer) : t('home.approx', { amount: money(b.est.customer) })}</b>
        </div>
      </a>`
    )}`);
}

// ---------- Addresses ----------
async function addresses() {
  const { addresses: list } = await api('GET', '/addresses');
  render(html`
    <h1>${t('addr.title')}</h1>
    ${list.length === 0 ? html`<p class="muted">${t('addr.none')}</p>` : ''}
    ${list.map(
      (a) => html`<div class="card">
        <b>${a.name}</b>
        <div>${addressLine(a)}</div>
        ${a.serviceable ? '' : html`<div class="notice">${t('addr.notServiced', { pin: a.pin })}</div>`}
        <div class="btn-row" style="margin-top:10px">
          <a class="btn alt sm" href="#/addresses/${a.id}">${t('common.edit')}</a>
          <button class="btn danger sm" data-del="${a.id}">${t('common.delete')}</button>
        </div>
      </div>`
    )}
    <a class="btn" href="#/addresses/new">${t('addr.add')}</a>
    <a class="btn alt" href="#/" style="margin-top:10px">${t('common.back')}</a>`);
  $$('[data-del]').forEach((b) => {
    b.onclick = () => {
      if (!confirm(t('addr.confirmDelete'))) return;
      busy(b, async () => {
        await api('DELETE', '/addresses/' + b.dataset.del);
        if (draft.addressId === Number(b.dataset.del)) draft.addressId = null;
        addresses();
      });
    };
  });
}

async function addressForm(id) {
  let a = { name: state.user.name || '', houseNo: '', street: '', locality: '', pin: '', landmark: '' };
  if (id) {
    const { addresses: list } = await api('GET', '/addresses');
    a = list.find((x) => x.id === Number(id));
    if (!a) return go('#/addresses');
  }
  const back = returnToBooking ? '#/book' : '#/addresses';
  const field = (key, max, extra = '') => html`
    <label for="${key}">${t('addr.' + key)}</label>
    <input id="${key}" maxlength="${max}" value="${a[key]}" ${extra === 'pin' ? html`inputmode="numeric"` : ''}>`;
  render(html`
    <h1>${t(id ? 'addr.editTitle' : 'addr.newTitle')}</h1>
    <form id="f" class="card" novalidate>
      ${field('name', 60)} ${field('houseNo', 60)} ${field('street', 100)} ${field('locality', 60)}
      ${field('pin', 6, 'pin')}
      <label for="landmark">${t('addr.landmark')}</label>
      <input id="landmark" maxlength="100" value="${a.landmark}">
      <div id="msg"></div>
      <button class="btn" style="margin-top:14px">${t('addr.save')}</button>
    </form>
    <a class="btn alt" href="${back}">${t('common.cancel')}</a>`);
  $('#f').onsubmit = (ev) => {
    ev.preventDefault();
    const body = {};
    for (const k of ['name', 'houseNo', 'street', 'locality', 'pin', 'landmark']) body[k] = $('#' + k).value.trim();
    const err = !body.name || !body.houseNo || !body.street || !body.locality
      ? t('addr.fillAll')
      : !/^[1-9]\d{5}$/.test(body.pin) ? t('err.invalid_pin') : '';
    if (err) return ($('#msg').innerHTML = html`<div class="notice err">${err}</div>`.s);
    busy($('#f button'), async () => {
      const r = id ? await api('PUT', '/addresses/' + id, body) : await api('POST', '/addresses', body);
      toast(t(r.serviceable ? 'addr.saved' : 'addr.savedNotServiced'), !r.serviceable);
      if (returnToBooking && r.serviceable) draft.addressId = r.id;
      returnToBooking = false;
      go(back);
    });
  };
}

// ---------- Book a pickup (3 steps) ----------
async function book() {
  returnToBooking = false;
  const [cat, addr] = await Promise.all([api('GET', '/catalog'), api('GET', '/addresses')]);
  const ctx = { cat, addresses: addr.addresses };
  if (draft.step === 2) return stepAddress(ctx);
  if (draft.step === 3) return stepTime(ctx);
  stepItems(ctx);
}

function draftLines(cat) {
  return cat.categories
    .filter((c) => draft.qty[c.id] > 0)
    .map((c) => ({ c, qty: draft.qty[c.id], buyPaise: c.buyPaise }));
}
const estimate = (cat) =>
  computeAmounts(draftLines(cat), { feePaise: cat.feePaise, thresholdPaise: cat.thresholdPaise, sharePct: 0 });

function totalBox(cat) {
  const lines = draftLines(cat);
  const e = estimate(cat);
  if (lines.length === 0) return html`<p class="muted center">${t('book.pickItems')}</p>`;
  const toFree = cat.thresholdPaise - e.value;
  return html`
    <div class="kv"><span>${t('book.estValue')}</span><b>${money(e.value)}</b></div>
    <div class="kv"><span>${t('book.pickupFee')}</span>
      <b>${e.fee === 0 ? t('book.free') : '- ' + money(e.fee)}</b></div>
    ${toFree > 0 ? html`<div class="small muted">${t('book.addMore', { amount: money(toFree) })}</div>` : ''}
    <div class="kv total"><span>${t('book.youGet')}</span><span>${money(e.customer)}</span></div>
    <div class="small muted">${t('book.finalNote')}</div>`;
}

const stepHead = (n) => html`<p class="muted small">${t('book.step', { n: String(n) })}</p>`;

function stepItems(ctx) {
  const { cat } = ctx;
  draft.step = 1;
  render(html`
    ${stepHead(1)}
    <h1>${t('book.itemsTitle')}</h1>
    <div class="card">
      ${cat.categories.map((c) => {
        const piece = c.unit === 'piece';
        return html`<div class="item">
          <div class="grow"><b>${t('cat.' + c.key)}</b>
            <div class="small muted">${perUnit(c.buyPaise, c.unit)}</div></div>
          <div class="stepper">
            <button type="button" data-step="-1" data-id="${c.id}" aria-label="${t('book.less')}">−</button>
            <input type="number" inputmode="${piece ? 'numeric' : 'decimal'}" min="0" step="${piece ? '1' : '0.5'}"
              data-id="${c.id}" value="${draft.qty[c.id] || ''}" placeholder="0"
              aria-label="${t('cat.' + c.key)} (${t(piece ? 'unit.pieces' : 'unit.kg')})">
            <button type="button" data-step="1" data-id="${c.id}" aria-label="${t('book.more')}">+</button>
          </div>
          <span class="small muted" style="width:26px">${t(piece ? 'unit.pc' : 'unit.kg')}</span>
        </div>`;
      })}
    </div>
    <div id="total" class="card"></div>
    <div class="sticky-total">
      <div class="kv" id="mini"></div>
      <button class="btn" id="next">${t('common.next')}</button>
    </div>`);

  const byId = new Map(cat.categories.map((c) => [String(c.id), c]));
  const refresh = () => {
    $('#total').innerHTML = totalBox(cat).s;
    const has = draftLines(cat).length > 0;
    $('#mini').innerHTML = has
      ? html`<span>${t('book.youGet')}</span><span>${money(estimate(cat).customer)}</span>`.s
      : '';
    $('#next').disabled = draftLines(cat).length === 0;
  };
  const setQty = (id, raw) => {
    const n = normaliseQty(byId.get(id).unit, raw);
    if (n == null) delete draft.qty[id];
    else draft.qty[id] = n;
    refresh();
  };
  $$('.stepper input').forEach((inp) => {
    inp.oninput = () => setQty(inp.dataset.id, inp.value);
    inp.onblur = () => (inp.value = draft.qty[inp.dataset.id] || '');
  });
  $$('.stepper button').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const next = Math.max(0, (draft.qty[id] || 0) + Number(btn.dataset.step));
      setQty(id, next);
      $(`.stepper input[data-id="${id}"]`).value = draft.qty[id] || '';
    };
  });
  $('#next').onclick = () => stepAddress(ctx);
  refresh();
}

function stepAddress(ctx) {
  draft.step = 2;
  const list = ctx.addresses;
  const usable = list.filter((a) => a.serviceable);
  if (!usable.some((a) => a.id === draft.addressId)) draft.addressId = usable[0] ? usable[0].id : null;
  render(html`
    ${stepHead(2)}
    <h1>${t('book.addressTitle')}</h1>
    ${list.length === 0 ? html`<p class="muted">${t('addr.none')}</p>` : ''}
    <div class="choices">
      ${list.map(
        (a) => html`<label class="choice">
          <input type="radio" name="addr" value="${a.id}" ${a.id === draft.addressId ? html`checked` : ''}
            ${a.serviceable ? '' : html`disabled`}>
          <span><b>${a.name}</b><br>${addressLine(a)}
            ${a.serviceable ? '' : html`<br><span class="small neg">${t('addr.notServiced', { pin: a.pin })}</span>`}
          </span></label>`
      )}
    </div>
    <p class="hint">${t('book.serviceArea', { pins: ctx.cat.servicePins.join(', ') })}</p>
    <button class="btn alt" id="add" style="margin:10px 0">${t('addr.add')}</button>
    <div class="btn-row">
      <button class="btn alt" id="back">${t('common.back')}</button>
      <button class="btn" id="next" ${draft.addressId ? '' : html`disabled`}>${t('common.next')}</button>
    </div>`);
  $$('input[name=addr]').forEach((r) => {
    r.onchange = () => {
      draft.addressId = Number(r.value);
      $('#next').disabled = false;
    };
  });
  $('#add').onclick = () => {
    returnToBooking = true;
    go('#/addresses/new');
  };
  $('#back').onclick = () => stepItems(ctx);
  $('#next').onclick = () => stepTime(ctx);
}

function stepTime(ctx) {
  const { cat } = ctx;
  draft.step = 3;
  const today = cat.dates[0].date;
  const hasSlot = (d) => d.slots.some((s) => s.available);
  let day = cat.dates.find((d) => d.date === draft.date && hasSlot(d)) || cat.dates.find(hasSlot);
  draft.date = day.date;
  if (!day.slots.some((s) => s.id === draft.slot && s.available)) draft.slot = null;
  const addr = ctx.addresses.find((a) => a.id === draft.addressId);
  const lines = draftLines(cat);

  render(html`
    ${stepHead(3)}
    <h1>${t('book.timeTitle')}</h1>
    <label>${t('book.date')}</label>
    <div class="choices cols4">
      ${cat.dates.map(
        (d) => html`<label class="choice">
          <input type="radio" name="date" value="${d.date}" ${d.date === draft.date ? html`checked` : ''}
            ${hasSlot(d) ? '' : html`disabled`}>
          <span class="small">${d.date === today ? t('date.today') : dateLabel(d.date).split(',')[0]}<br>
            <b>${String(Number(d.date.slice(8)))}</b></span></label>`
      )}
    </div>
    <label>${t('book.slot')}</label>
    <div class="choices" id="slots"></div>

    <h2>${t('book.summary')}</h2>
    <div class="card">
      <div class="small muted">${t('book.pickupFrom')}</div>
      <div><b>${addr.name}</b>, ${addressLine(addr)}</div>
      <table style="margin-top:8px">
        ${lines.map(
          (l) => html`<tr><td>${t('cat.' + l.c.key)}</td><td class="num">${qty(l.qty, l.c.unit)}</td>
            <td class="num">${money(Math.round(l.qty * l.buyPaise))}</td></tr>`
        )}
      </table>
    </div>
    <div class="card">${totalBox(cat)}</div>
    <div class="btn-row">
      <button class="btn alt" id="back">${t('common.back')}</button>
      <button class="btn" id="confirm">${t('book.confirm')}</button>
    </div>`);

  const drawSlots = () => {
    day = cat.dates.find((d) => d.date === draft.date);
    $('#slots').innerHTML = html`${day.slots.map(
      (s) => html`<label class="choice">
        <input type="radio" name="slot" value="${s.id}" ${s.id === draft.slot ? html`checked` : ''}
          ${s.available ? '' : html`disabled`}>
        <span>${slotLabel(s.id)}${s.available ? '' : html` <span class="small">(${t('book.slotOver')})</span>`}</span>
      </label>`
    )}`.s;
    $$('input[name=slot]').forEach((r) => {
      r.onchange = () => {
        draft.slot = r.value;
        $('#confirm').disabled = false;
      };
    });
    $('#confirm').disabled = !draft.slot;
  };
  $$('input[name=date]').forEach((r) => {
    r.onchange = () => {
      draft.date = r.value;
      const d = cat.dates.find((x) => x.date === r.value);
      if (!d.slots.some((s) => s.id === draft.slot && s.available)) draft.slot = null;
      drawSlots();
    };
  });
  drawSlots();
  $('#back').onclick = () => stepAddress(ctx);
  $('#confirm').onclick = (ev) =>
    busy(ev.target, async () => {
      const r = await api('POST', '/bookings', {
        addressId: draft.addressId,
        date: draft.date,
        slot: draft.slot,
        items: lines.map((l) => ({ categoryId: l.c.id, qty: l.qty })),
      });
      resetDraft();
      toast(t('book.done'));
      go('#/bookings/' + r.id);
    });
}

// ---------- Booking detail ----------
export function statusSteps(status) {
  if (status === 'cancelled') return html`<div class="notice err"><b>${t('status.cancelled')}</b></div>`;
  const at = STATUS_FLOW.indexOf(status);
  return html`<ol class="steps">
    ${STATUS_FLOW.map(
      (s, i) => html`<li class="${i <= at ? 'done' : ''} ${i === at ? 'now' : ''}">${t('status.' + s)}</li>`
    )}
  </ol>`;
}

export function itemsTable(b) {
  const measured = b.final != null;
  return html`<table>
    <tr><th>${t('detail.item')}</th>
      <th class="num">${t(measured ? 'detail.measured' : 'detail.estQty')}</th>
      <th class="num">${t('detail.rate')}</th><th class="num">${t('detail.amount')}</th></tr>
    ${b.items.map((i) => {
      const q = measured ? i.measuredQty : i.estQty;
      return html`<tr><td>${t('cat.' + i.key)}
          ${measured ? html`<div class="small muted">${t('abook.estimated', { q: qty(i.estQty, i.unit) })}</div>` : ''}</td>
        <td class="num">${qty(q, i.unit)}</td>
        <td class="num">${money(i.buyPaise)}</td><td class="num">${money(Math.round(q * i.buyPaise))}</td></tr>`;
    })}
  </table>`;
}

export function amountsBox(b) {
  const f = b.final;
  return html`
    <div class="kv"><span>${t('detail.estValue')}</span><span>${money(b.est.value)}</span></div>
    ${f
      ? html`<div class="kv"><span>${t('detail.finalValue')}</span><span>${money(f.value)}</span></div>
          <div class="kv"><span>${t('book.pickupFee')}</span>
            <span>${f.fee === 0 ? t('book.free') : '- ' + money(f.fee)}</span></div>
          <div class="kv total"><span>${t('detail.finalAmount')}</span><span>${money(f.customer)}</span></div>`
      : html`<div class="kv"><span>${t('book.pickupFee')}</span>
            <span>${b.est.fee === 0 ? t('book.free') : '- ' + money(b.est.fee)}</span></div>
          <div class="kv total"><span>${t('detail.estAmount')}</span><span>${money(b.est.customer)}</span></div>
          <div class="kv"><span>${t('detail.finalAmount')}</span><span class="muted">${t('detail.afterPickup')}</span></div>`}
    <div class="kv"><span>${t('detail.paymentMode')}</span>
      <span>${b.paymentMode ? t('pay.' + b.paymentMode) : html`<span class="muted">${t('detail.notPaidYet')}</span>`}</span></div>
    ${f ? '' : html`<div class="small muted">${t('book.finalNote')}</div>`}`;
}

async function bookingDetail(id) {
  const { booking: b } = await api('GET', '/bookings/' + id);
  const canCancel = ['requested', 'assigned'].includes(b.status);
  render(html`
    <h1>${t('common.bookingNo', { id: String(b.id) })}</h1>
    <div class="card">${statusSteps(b.status)}</div>
    <div class="card">
      <div class="kv"><span>${t('book.date')}</span><b>${dateLabel(b.pickupDate, istNow().date)}</b></div>
      <div class="kv"><span>${t('book.slot')}</span><b>${slotLabel(b.slot)}</b></div>
      ${b.partnerName ? html`<div class="kv"><span>${t('detail.partner')}</span><b>${b.partnerName}</b></div>` : ''}
      <div class="small muted" style="margin-top:6px">${t('book.pickupFrom')}</div>
      <div><b>${b.address.name}</b>, ${addressLine(b.address)}</div>
    </div>
    <div class="card">${itemsTable(b)}</div>
    <div class="card">${amountsBox(b)}</div>
    ${canCancel ? html`<button class="btn danger" id="cancel">${t('detail.cancel')}</button>` : ''}
    <a class="btn alt" href="#/" style="margin-top:10px">${t('common.back')}</a>`);
  if (canCancel)
    $('#cancel').onclick = (ev) => {
      if (!confirm(t('detail.confirmCancel'))) return;
      busy(ev.target, async () => {
        await api('POST', `/bookings/${b.id}/cancel`, {});
        bookingDetail(id);
      });
    };
}
