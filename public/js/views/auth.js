import { api, html, render, state, busy, $, toastErr, errText, phone } from '../ui.js';
import { t } from '../i18n.js';

export function login(onDone) {
  const test = state.app.testOtp;
  render(html`
    <h1>${t('login.title', { app: state.app.name })}</h1>
    <p class="muted">${t('login.subtitle', { city: state.app.city })}</p>
    <form id="f" class="card" novalidate>
      <label for="mobile">${t('login.mobile')}</label>
      <div class="inline-input"><span>+91</span>
        <input id="mobile" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="10" placeholder="98765 43210" required>
      </div>
      <p class="hint">${t('login.mobileHint')}</p>
      <div id="msg"></div>
      <button class="btn" style="margin-top:14px">${t('login.sendOtp')}</button>
    </form>
    ${test ? html`<div class="notice info">${t('login.testMode', { otp: test })}</div>` : ''}`);
  $('#f').onsubmit = (ev) => {
    ev.preventDefault();
    const mobile = $('#mobile').value.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(mobile)) return showMsg(t('err.invalid_mobile'));
    busy($('#f button'), async () => {
      await api('POST', '/auth/request-otp', { mobile });
      otpStep(mobile, onDone);
    });
  };
}

function showMsg(text) {
  $('#msg').innerHTML = html`<div class="notice err">${text}</div>`.s;
}

function otpStep(mobile, onDone) {
  const test = state.app.testOtp;
  render(html`
    <h1>${t('otp.title')}</h1>
    <p class="muted">${t('otp.sentTo', { mobile: phone(mobile) })}</p>
    <form id="f" class="card" novalidate>
      <label for="otp">${t('otp.label')}</label>
      <input id="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
      <div id="msg"></div>
      <button class="btn" style="margin-top:14px">${t('otp.verify')}</button>
    </form>
    ${test ? html`<div class="notice info">${t('login.testMode', { otp: test })}</div>` : ''}
    <div class="btn-row">
      <button class="btn alt" id="resend">${t('otp.resend')}</button>
      <button class="btn alt" id="change">${t('otp.changeNumber')}</button>
    </div>`);
  $('#otp').focus();
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = $('#f button');
    btn.disabled = true;
    try {
      const r = await api('POST', '/auth/verify-otp', { mobile, otp: $('#otp').value.trim() });
      state.user = r.user;
      onDone();
    } catch (e) {
      btn.disabled = false;
      showMsg(errText(e));
    }
  };
  $('#resend').onclick = (ev) =>
    busy(ev.target, async () => {
      await api('POST', '/auth/request-otp', { mobile });
      showMsgOk(t('otp.resent'));
    });
  $('#change').onclick = () => login(onDone);
}
function showMsgOk(text) {
  $('#msg').innerHTML = html`<div class="notice ok">${text}</div>`.s;
}

export function chooseRole(onDone) {
  render(html`
    <h1>${t('role.title')}</h1>
    <form id="f" class="card" novalidate>
      <label for="name">${t('role.name')}</label>
      <input id="name" type="text" autocomplete="name" maxlength="60" required>
      <label>${t('role.iAm')}</label>
      <div class="choices">
        <label class="choice"><input type="radio" name="role" value="customer" checked>
          <span><b>${t('role.customer')}</b><br><span class="small muted">${t('role.customerHint')}</span></span></label>
        <label class="choice"><input type="radio" name="role" value="partner">
          <span><b>${t('role.partner')}</b><br><span class="small muted">${t('role.partnerHint')}</span></span></label>
      </div>
      <div id="msg"></div>
      <button class="btn" style="margin-top:14px">${t('common.continue')}</button>
    </form>`);
  $('#f').onsubmit = (ev) => {
    ev.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return showMsg(t('err.name_required'));
    busy($('#f button'), async () => {
      const role = $('input[name=role]:checked').value;
      const r = await api('POST', '/me/role', { role, name });
      state.user = r.user;
      onDone();
    });
  };
}

// Shown to partners until the admin approves them.
export function partnerHome(onApproved) {
  render(html`
    <h1>${t('partner.hello', { name: state.user.name || '' })}</h1>
    <div class="notice"><b>${t('partner.pendingTitle')}</b><br>${t('partner.pendingText')}</div>
    <button class="btn alt" id="check">${t('partner.checkAgain')}</button>`);
  $('#check').onclick = async () => {
    try {
      state.user = (await api('GET', '/bootstrap')).user;
      if (state.user) onApproved();
    } catch (e) { toastErr(e); }
  };
}
