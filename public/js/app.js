import { api, html, render, state, toastErr, errText, go, $, ICON } from './ui.js';
import { t } from './i18n.js';
import * as auth from './views/auth.js';
import * as customer from './views/customer.js';
import * as admin from './views/admin.js';
import * as partner from './views/partner.js';

const $tabs = document.getElementById('tabs');
const $logout = document.getElementById('logout');
const $nav = document.getElementById('bottomnav');

// Bottom navigation for customers and partners (shown on their main screens only).
const NAVS = {
  customer: [['/', 'nav.home', 'home'], ['/book', 'nav.book', 'plus'], ['/addresses', 'nav.addresses', 'pin']],
  partner: [['/', 'ptab.pickups', 'truck'], ['/earnings', 'ptab.earnings', 'wallet']],
};

function chrome(path) {
  const u = state.user;
  $logout.hidden = !u;
  $logout.textContent = t('common.logout');
  const ok = u && u.status === 'approved';
  const tabs = ok && u.role === 'admin' ? admin.tabs : null;
  const nav = ok && NAVS[u.role];
  const showNav = !!nav && nav.some(([href]) => href === path && href !== '/book');
  $nav.hidden = !showNav;
  document.body.classList.toggle('has-nav', showNav);
  if (showNav)
    $nav.innerHTML = html`${nav.map(
      ([href, key, icon]) => html`<a href="#${href}" class="${href === path ? 'on' : ''}">
        <span class="nav-ico">${ICON[icon]}</span>${t(key)}</a>`
    )}`.s;
  $tabs.hidden = !tabs;
  if (tabs) {
    $tabs.innerHTML = html`${tabs.map(
      ([href, key]) => html`<a href="#${href}" class="${isActive(path, href) ? 'on' : ''}">${t(key)}</a>`
    )}`.s;
    const on = $tabs.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}
const isActive = (path, href) => (href === '/' ? path === '/' : path.startsWith(href));

async function route() {
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const u = state.user;
  chrome(path);
  if (!u) return auth.login(route);
  if (!u.role) return auth.chooseRole(route);
  if (u.role === 'partner' && u.status !== 'approved') return auth.partnerHome(route);
  const table = { admin: admin.routes, partner: partner.routes }[u.role] || customer.routes;
  for (const [re, view] of table) {
    const m = re.exec(path);
    if (!m) continue;
    try {
      await view(...m.slice(1));
    } catch (e) {
      if (!state.user) return; // session ended; the login screen is already shown
      render(html`<div class="notice err">${errText(e)}</div>
        <button class="btn alt" id="retry">${t('common.retry')}</button>`);
      $('#retry').onclick = route;
    }
    return;
  }
  go('#/');
}

async function start() {
  try {
    const boot = await api('GET', '/bootstrap');
    state.app = boot.app;
    state.user = boot.user;
  } catch (e) {
    render(html`<div class="notice err">${errText(e)}</div>
      <button class="btn alt" id="retry">${t('common.retry')}</button>`);
    $('#retry').onclick = start;
    return;
  }
  route();
}

$logout.onclick = async () => {
  try { await api('POST', '/auth/logout', {}); } catch (e) { toastErr(e); return; }
  state.user = null;
  customer.resetDraft();
  go('#/');
  route();
};
window.addEventListener('hashchange', route);
window.addEventListener('session-lost', () => {
  if (!state.user) return;
  state.user = null;
  route();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
