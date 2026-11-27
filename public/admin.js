import { iconEl, planBadgeEl } from './icons.mjs';
import { PERSONA_CATALOG } from './audit.mjs';

const $ = sel => document.querySelector(sel);

let currentAdmin = null;
let overviewData = null;
let activePage = 'overview';
let chartMetric = 'searches';
let userQuery = '';
let planFilter = '';
let billingFilter = '';
let statusFilter = '';
let activeDrawerUserId = null;

function el(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function btn(label, onClick, className = 'btn-primary', ico = '') {
  const b = el('button', '', className);
  b.type = 'button';
  if (ico) b.append(iconEl(ico, 15));
  b.append(document.createTextNode(label));
  if (onClick) b.onclick = onClick;
  return b;
}

function field(labelText, name, value = '', attrs = {}) {
  const wrap = el('label');
  wrap.append(el('span', labelText));
  const input = el(attrs.tag || 'input');
  input.name = name;
  if (attrs.tag !== 'textarea') input.type = attrs.type || 'text';
  if (value !== undefined && value !== null) input.value = String(value);
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== 'tag' && k !== 'type') input.setAttribute(k, String(v));
  }
  wrap.append(input);
  return wrap;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const box = $('#admin-toast');
  if (!box) return;
  if (!msg) { box.hidden = true; return; }
  box.textContent = msg;
  box.className = 'admin-toast' + (isError ? ' error' : '');
  box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 4500);
}

async function api(url, body) {
  const opts = body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' };
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function initials(str = '') {
  const parts = String(str || 'U').trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || 'U';
}

/* ---------------- AUTHENTICATION ---------------- */
function showLogin(errorMsg = '') {
  currentAdmin = null;
  overviewData = null;
  document.body.classList.remove('auth-checking');
  document.body.classList.add('auth-locked');
  const errEl = $('#admin-auth-error');
  if (errEl) {
    errEl.textContent = errorMsg;
    errEl.hidden = !errorMsg;
  }
}

async function loadOverview(showSpinnerToast = false) {
  try {
    overviewData = await api('/api/admin/overview');
    const k = overviewData.kpis || {};
    if ($('#nav-users-badge')) $('#nav-users-badge').textContent = String(k.totalUsers || 0);
    if ($('#nav-mrr-badge')) $('#nav-mrr-badge').textContent = `$${(k.netPaidMrr || 0).toLocaleString()}`;
    const dbPill = $('#topbar-db-pill');
    if (dbPill) {
      const h = overviewData.systemHealth || {};
      const label = h.supabaseConfigured
        ? (h.supabaseConnected ? `Supabase Live · ${h.supabaseLatencyMs}ms` : 'Supabase Offline')
        : 'Local JSON Store';
      dbPill.innerHTML = `<i class="dot"></i> ${label}`;
    }
    renderCurrentPage();
    if (activeDrawerUserId) {
      const updatedUser = (overviewData.users || []).find(u => u.id === activeDrawerUserId);
      if (updatedUser) openCrmDrawer(updatedUser);
      else closeDrawer();
    }
    if (showSpinnerToast) toast('Refreshed live customer, usage, and revenue metrics.');
  } catch (err) {
    if (/401|403|authorized|Sign in/i.test(err.message)) {
      showLogin(err.message);
    } else {
      toast(err.message, true);
    }
  }
}

function enterAdminShell(user) {
  currentAdmin = user;
  document.body.classList.remove('auth-checking', 'auth-locked');
  if ($('#sidebar-admin-name')) $('#sidebar-admin-name').textContent = user.name || 'Super Admin';
  if ($('#sidebar-admin-email')) $('#sidebar-admin-email').textContent = user.email || 'admin@jobhunta.com';
  syncRoute();
  loadOverview(false);
}

$('#admin-pwd-toggle').onclick = () => {
  const inp = $('#admin-password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#admin-pwd-toggle').replaceChildren(iconEl(show ? 'eyeOff' : 'eye', 17));
};

$('#admin-login-form').onsubmit = async e => {
  e.preventDefault();
  const submit = $('#admin-login-submit');
  const errEl = $('#admin-auth-error');
  errEl.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Verifying Admin Access…';
  try {
    const fd = new FormData(e.currentTarget);
    const data = await api('/api/auth/login', {
      email: String(fd.get('email') || '').trim(),
      password: String(fd.get('password') || '')
    });
    if (!data.user?.isAdmin) {
      await api('/api/auth/logout', {}).catch(() => {});
      throw new Error('Access denied: This account does not have Super Admin privileges.');
    }
    e.currentTarget.reset();
    enterAdminShell(data.user);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign In to cPanel';
  }
};

$('#admin-logout-btn').onclick = async () => {
  try { await api('/api/auth/logout', {}); } catch {}
  closeDrawer();
  showLogin();
};

/* ---------------- NAVIGATION & TOPBAR ---------------- */
const VALID_PAGES = ['overview', 'users', 'monetization', 'plans', 'telemetry', 'system'];

function syncRoute() {
  document.body.classList.remove('nav-open');
  closeDrawer();
  const hash = location.hash.replace(/^#/, '');
  activePage = VALID_PAGES.includes(hash) ? hash : 'overview';
  for (const a of document.querySelectorAll('#admin-nav a, #admin-mobile-nav a')) {
    a.classList.toggle('active', a.dataset.page === activePage);
  }
  if (overviewData) renderCurrentPage();
}

window.addEventListener('hashchange', syncRoute);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeDrawer();
    document.body.classList.remove('nav-open');
  }
});
if ($('#admin-toast')) {
  $('#admin-toast').onclick = () => { $('#admin-toast').hidden = true; };
}
$('#menu-toggle').onclick = () => document.body.classList.toggle('nav-open');
$('#sidebar-close').onclick = () => document.body.classList.remove('nav-open');
$('#sidebar-backdrop').onclick = () => document.body.classList.remove('nav-open');
$('#topbar-refresh').onclick = () => loadOverview(true);
$('#topbar-create-user').onclick = () => openCreateUserModal();

$('#topbar-user-search').oninput = e => {
  userQuery = e.target.value;
  if (activePage !== 'users') {
    location.hash = '#users';
  } else {
    renderCurrentPage();
  }
};

/* ---------------- SVG CHART & BAR HELPERS ---------------- */
function buildTrendSvg(series = [], key = 'searches') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 700 210');
  svg.setAttribute('class', 'chart-svg');

  const vals = series.map(s => Number(s[key]) || 0);
  const maxVal = Math.max(1, ...vals);
  const padL = 44; const padR = 14; const padT = 18; const padB = 30;
  const w = 700 - padL - padR;
  const h = 210 - padT - padB;

  for (let i = 0; i <= 3; i++) {
    const y = padT + (h * i) / 3;
    const ln = document.createElementNS(ns, 'line');
    ln.setAttribute('x1', String(padL));
    ln.setAttribute('x2', String(700 - padR));
    ln.setAttribute('y1', String(y));
    ln.setAttribute('y2', String(y));
    ln.setAttribute('stroke', '#e2ebe8');
    ln.setAttribute('stroke-dasharray', '3,3');
    svg.append(ln);

    const tv = Math.round(maxVal * (1 - i / 3));
    const tx = document.createElementNS(ns, 'text');
    tx.setAttribute('x', String(padL - 7));
    tx.setAttribute('y', String(y + 4));
    tx.setAttribute('text-anchor', 'end');
    tx.setAttribute('fill', '#64748b');
    tx.setAttribute('font-size', '11');
    tx.textContent = key === 'revenueUsd' ? `$${tv}` : String(tv);
    svg.append(tx);
  }

  const slot = w / Math.max(1, series.length);
  const barW = Math.min(30, Math.max(12, slot * 0.56));
  series.forEach((pt, idx) => {
    const v = Number(pt[key]) || 0;
    const bh = Math.max(v > 0 ? 4 : 1.5, (v / maxVal) * h);
    const x = padL + idx * slot + (slot - barW) / 2;
    const y = padT + h - bh;

    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(barW));
    r.setAttribute('height', String(bh));
    r.setAttribute('rx', '6');
    r.setAttribute('fill', idx === series.length - 1 ? '#059669' : '#34d399');
    const ttl = document.createElementNS(ns, 'title');
    ttl.textContent = `${pt.date}: ${key === 'revenueUsd' ? '$' + v : v}`;
    r.append(ttl);
    svg.append(r);

    if (idx % 2 === 0 || idx === series.length - 1) {
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', String(x + barW / 2));
      lbl.setAttribute('y', '200');
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('fill', '#64748b');
      lbl.setAttribute('font-size', '10.5');
      lbl.textContent = String(pt.date || '').slice(5);
      svg.append(lbl);
    }
  });
  return svg;
}

function makeKpiCard(label, val, sub, ico = 'barChart', tone = '') {
  const c = el('article', '', 'kpi-card');
  const top = el('div', '', 'kpi-top');
  const ic = el('span', '', 'kpi-ico' + (tone ? ' ' + tone : ''));
  ic.append(iconEl(ico, 18));
  top.append(el('span', label), ic);
  c.append(top, el('div', String(val), 'kpi-val'), el('div', sub, 'kpi-sub'));
  return c;
}

function makeBarList(rows = []) {
  const wrap = el('div', '', 'bar-list');
  const max = Math.max(1, ...rows.map(r => r.count || 0));
  for (const r of rows) {
    const item = el('div', '', 'bar-item');
    const top = el('div', '', 'bar-top');
    top.append(el('span', r.label), el('strong', `${r.count}${r.suffix || ''}`));
    const track = el('div', '', 'bar-track');
    const fill = el('div', '', 'bar-fill');
    fill.style.width = `${Math.round(((r.count || 0) / max) * 100)}%`;
    if (r.color) fill.style.background = r.color;
    track.append(fill);
    item.append(top, track);
    wrap.append(item);
  }
  return wrap;
}

function exportUsersCsv(users = []) {
  const cols = ['ID', 'Name', 'Email', 'Plan', 'BillingType', 'MonthlyUSD', 'Status', 'SearchesToday', 'LeadsToday', 'EmailsToday', 'SavedLeads', 'VerifiedEmails', 'AuditedLeads', 'OutreachSent', 'GmailMailbox', 'Persona', 'CreatedAt'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    cols.join(','),
    ...users.map(u => [
      u.id, u.name, u.email, u.tier, u.billingType, u.monthlyUsd, u.status,
      u.searchesToday, u.resultsToday, u.emailsToday, u.leadsCount, u.leadsWithEmail,
      u.auditedCount, u.outreachSentCount, u.gmailConnected ? u.gmailMailbox : '', u.persona, u.createdAt || ''
    ].map(esc).join(','))
  ].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jobhunta-crm-accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* ---------------- SLIDE-OVER CRM ACCOUNT DRAWER ---------------- */
function closeDrawer() {
  activeDrawerUserId = null;
  const drawer = $('#crm-drawer');
  const backdrop = $('#drawer-backdrop');
  if (drawer) drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
}
$('#drawer-close').onclick = closeDrawer;
$('#drawer-backdrop').onclick = closeDrawer;

function openCrmDrawer(u) {
  activeDrawerUserId = u.id;
  $('#drawer-title').textContent = u.name || u.email.split('@')[0];
  $('#drawer-subtitle').textContent = `${u.email} · ID: ${String(u.id).slice(0, 12)}…`;

  const body = $('#drawer-body');
  const meterBox = el('div', '', 'meter-box');
  meterBox.append(el('strong', `Live Today Quotas & Pipeline (${u.tierLabel})`));
  for (const [lbl, used, lim] of [
    ['Searches Today', u.searchesToday, u.dailySearchLimit],
    ['Leads Scraped Today', u.resultsToday, u.dailyResultLimit],
    ['Outreach Emails Today', u.emailsToday, u.dailyEmailLimit]
  ]) {
    const line = el('div', '', 'meter-line');
    const top = el('div', '', 'meter-top');
    const pct = lim === null ? 100 : Math.min(100, Math.round((used / Math.max(1, lim)) * 100));
    top.append(el('span', lbl), el('strong', lim === null ? `${used} / Unlimited` : `${used} / ${lim} (${pct}%)`));
    const bar = el('div', '', 'meter-bar');
    const fill = el('i');
    fill.style.width = `${lim === null ? 100 : Math.max(pct, used > 0 ? 4 : 0)}%`;
    if (lim !== null && pct >= 90) fill.style.background = '#dc2626';
    bar.append(fill);
    line.append(top, bar);
    meterBox.append(line);
  }
  const pipeNote = el('div', `Saved Leads: ${u.leadsCount} (${u.leadsWithEmail} w/ email) · Audits: ${u.auditedCount} · Sent Threads: ${u.outreachSentCount} · Interested: ${u.interestedCount} · Gmail: ${u.gmailConnected ? u.gmailMailbox : 'Not linked'}`);
  pipeNote.style.fontSize = '12px';
  pipeNote.style.color = 'var(--muted)';
  meterBox.append(pipeNote);

  const form = el('form', '', 'stack');
  const nameF = field('Customer Full Name', 'name', u.name || '');

  const g1 = el('div', '', 'grid-2');
  g1.style.marginBottom = '0';
  const tierWrap = el('label', '');
  tierWrap.append(el('span', 'Subscription Plan'));
  const tierSel = el('select');
  for (const t of overviewData?.tierCatalog || []) {
    const optLabel = t.key === 'basic' || String(t.displayLabel).includes(t.price)
      ? t.displayLabel
      : `${t.displayLabel} · ${t.price}`;
    const opt = new Option(optLabel, t.key);
    if (t.key === u.tier) opt.selected = true;
    tierSel.append(opt);
  }
  tierWrap.append(tierSel);

  const billWrap = el('label', '');
  billWrap.append(el('span', 'Billing Status'));
  const billSel = el('select');
  for (const [v, l] of [['paid', 'Paid Subscriber (MRR)'], ['trial', 'Timed Trial'], ['comped', 'Comped / Partner VIP'], ['free', 'Free Plan']]) {
    const opt = new Option(l, v);
    if (v === u.billingType) opt.selected = true;
    billSel.append(opt);
  }
  billWrap.append(billSel);
  g1.append(tierWrap, billWrap);

  const g2 = el('div', '', 'grid-2');
  g2.style.marginBottom = '0';
  const trialDaysLeft = u.trialEndsAt ? Math.max(1, Math.ceil((Date.parse(u.trialEndsAt) - Date.now()) / 86400000)) : 7;
  const trialF = field('Trial Days (if Timed Trial)', 'trialDays', trialDaysLeft, { type: 'number', min: 0, max: 365 });
  const priceF = field('Monthly USD Paid ($)', 'monthlyPricePaid', u.monthlyUsd ?? 0, { type: 'number', min: 0, max: 9999 });
  g2.append(trialF, priceF);

  const g3 = el('div', '', 'grid-3');
  const bS = field('+Bonus Searches', 'bonusSearches', u.bonusSearches || 0, { type: 'number', min: 0 });
  const bL = field('+Bonus Leads', 'bonusResults', u.bonusResults || 0, { type: 'number', min: 0 });
  const bE = field('+Bonus Emails', 'bonusEmails', u.bonusEmails || 0, { type: 'number', min: 0 });
  g3.append(bS, bL, bE);

  const g4 = el('div', '', 'grid-2');
  g4.style.marginBottom = '0';
  const stWrap = el('label', '');
  stWrap.append(el('span', 'Account State'));
  const stSel = el('select');
  stSel.append(new Option('Active', 'active'), new Option('Suspended (Blocked)', 'suspended'));
  stSel.value = u.status || 'active';
  stWrap.append(stSel);
  const pwdF = field('Reset Password (Optional)', 'newPassword', '', { placeholder: 'Min 6 chars to reset' });
  g4.append(stWrap, pwdF);

  const notesF = field('Internal CRM Notes', 'notes', u.notes || '', { tag: 'textarea', rows: 3, placeholder: 'Billing history, onboarding notes, upsell context…' });

  const acts = el('div', '', 'drawer-sticky-actions');
  const saveBtn = btn('Save Changes', null, 'btn-primary', 'check');
  saveBtn.type = 'submit';
  const resetBtn = btn('Reset Quotas', async () => {
    try {
      await api('/api/admin/reset-quota', { userId: u.id });
      toast(`Reset daily quotas to 0 for ${u.email}.`);
      loadOverview(false);
    } catch (err) { toast(err.message, true); }
  }, 'btn-soft', 'refresh');
  const cancelBtn = btn('Close', closeDrawer, 'btn-secondary');

  acts.append(saveBtn, resetBtn, cancelBtn);
  if (String(u.email).toLowerCase() !== 'admin@jobhunta.com') {
    acts.append(btn('Delete', async () => {
      if (!confirm(`Permanently delete ${u.email} and all their workspace data?`)) return;
      try {
        await api('/api/admin/delete-user', { userId: u.id });
        toast(`Deleted ${u.email}.`);
        closeDrawer();
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    }, 'btn-danger'));
  }

  form.append(nameF, g1, g2, g3, g4, notesF, acts);
  form.onsubmit = async e => {
    e.preventDefault();
    saveBtn.disabled = true;
    try {
      await api('/api/admin/user-update', {
        userId: u.id,
        name: nameF.lastChild.value.trim(),
        tier: tierSel.value,
        billingType: billSel.value,
        trialDays: Number(trialF.lastChild.value) || 0,
        monthlyPricePaid: Number(priceF.lastChild.value) || 0,
        bonusSearches: Number(bS.lastChild.value) || 0,
        bonusResults: Number(bL.lastChild.value) || 0,
        bonusEmails: Number(bE.lastChild.value) || 0,
        status: stSel.value,
        newPassword: pwdF.lastChild.value.trim(),
        notes: notesF.lastChild.value.trim()
      });
      toast(`Saved CRM changes for ${u.email}.`);
      closeDrawer();
      loadOverview(false);
    } catch (err) {
      toast(err.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  };

  body.replaceChildren(meterBox, form);
  $('#drawer-backdrop').hidden = false;
  $('#crm-drawer').hidden = false;
}

/* ---------------- CREATE NEW ACCOUNT MODAL ---------------- */
const dialog = $('#admin-dialog');
$('#dialog-close').onclick = () => dialog.close();

function openCreateUserModal() {
  $('#dialog-title').textContent = 'Create Customer / Team Account';
  const form = el('form', '', 'stack');
  const fName = field('Full Name', 'name', '', { placeholder: 'e.g. Sarah Jenkins', required: 'true' });
  const fEmail = field('Email Address', 'email', '', { type: 'email', placeholder: 'sarah@agency.com', required: 'true' });
  const fPwd = field('Initial Password', 'password', '', { placeholder: 'Minimum 6 characters', required: 'true' });

  const row = el('div', '', 'grid-2');
  row.style.marginBottom = '0';
  const tWrap = el('label'); tWrap.append(el('span', 'Starting Plan'));
  const tSel = el('select');
  for (const t of overviewData?.tierCatalog || [
    { key: 'basic', displayLabel: 'Basic (Free)' },
    { key: 'silver', displayLabel: 'Silver ($29/mo)' },
    { key: 'gold', displayLabel: 'Gold ($79/mo)' },
    { key: 'premium', displayLabel: 'Premium ($199/mo)' },
    { key: 'diamond', displayLabel: 'Diamond ($499/mo)' }
  ]) {
    tSel.append(new Option(t.displayLabel, t.key));
  }
  tWrap.append(tSel);

  const bWrap = el('label'); bWrap.append(el('span', 'Billing Type'));
  const bSel = el('select');
  bSel.append(new Option('Free', 'free'), new Option('Paid Subscriber', 'paid'), new Option('Timed Trial (7d)', 'trial'), new Option('Comped VIP', 'comped'));
  bWrap.append(bSel);
  row.append(tWrap, bWrap);

  const fNotes = field('CRM Notes (Optional)', 'notes', '', { placeholder: 'Onboarded via direct sales…' });
  const submit = btn('Create Account', null, 'btn-primary btn-lg', 'plus');
  submit.type = 'submit';
  form.append(fName, fEmail, fPwd, row, fNotes, submit);

  form.onsubmit = async e => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await api('/api/admin/create-user', {
        name: fName.lastChild.value.trim(),
        email: fEmail.lastChild.value.trim(),
        password: fPwd.lastChild.value,
        tier: tSel.value,
        billingType: bSel.value,
        trialDays: 7,
        notes: fNotes.lastChild.value.trim()
      });
      dialog.close();
      toast('Created new customer account!');
      location.hash = '#users';
      loadOverview(false);
    } catch (err) {
      toast(err.message, true);
    } finally {
      submit.disabled = false;
    }
  };

  $('#dialog-body').replaceChildren(form);
  dialog.showModal();
}

/* ---------------- PAGE RENDERER ---------------- */
function renderCurrentPage() {
  const main = $('#admin-main');
  if (!main || !overviewData) return;
  const d = overviewData;
  const k = d.kpis || {};

  if (activePage === 'overview') {
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'Executive Overview & Pulse'), el('p', 'Real-time user growth, active subscriptions, platform usage, and revenue health.'));
    head.append(hLeft, btn('Export CRM CSV', () => exportUsersCsv(d.users || []), 'btn-secondary', 'fileText'));

    const kpis = el('div', '', 'kpi-grid-4');
    kpis.append(
      makeKpiCard('Total Accounts', k.totalUsers || 0, `+${k.newUsersToday || 0} today · +${k.newUsers7d || 0} in 7d`, 'users'),
      makeKpiCard('Active Users (DAU/WAU/MAU)', `${k.dau || 0} / ${k.wau || 0} / ${k.mau || 0}`, `${k.gmailConnectedUsers || 0} Gmail mailboxes linked`, 'zap', 'blue'),
      makeKpiCard('Net Paid MRR', `$${(k.netPaidMrr || 0).toLocaleString()}`, `Projected ARR: $${(k.projectedArr || 0).toLocaleString()}/yr`, 'crown', 'amber'),
      makeKpiCard('Paid Subscribers', `${k.paidSubscribers || 0}`, `${k.conversionRate || 0}% conversion · ${k.compedOrTrialUsers || 0} Trial/VIP`, 'trendingUp', 'purple'),
      makeKpiCard('Searches Today', k.searchesToday || 0, `${k.resultsToday || 0} leads scraped today`, 'search'),
      makeKpiCard('Total Saved Leads', (k.totalLeads || 0).toLocaleString(), `${k.leadsWithEmail || 0} verified emails`, 'database', 'blue'),
      makeKpiCard('Outreach Sent Today', k.emailsToday || 0, `${k.totalOutreachThreads || 0} total threads tracked`, 'send'),
      makeKpiCard('Website Audits & Replies', `${k.auditedLeads || 0} Audits`, `${k.repliedLeads || 0} warm interested leads`, 'shieldCheck', 'amber')
    );

    const split = el('div', '', 'split-2');
    const chartCard = el('section', '', 'card');
    const cHead = el('div', '', 'card-head');
    cHead.append(el('h2', '14-Day Platform Activity & Revenue'));
    const pills = el('div', '', 'actions');
    for (const [mKey, mLbl] of [['searches', 'Searches'], ['results', 'Leads'], ['emails', 'Emails'], ['signups', 'Signups'], ['revenueUsd', 'Revenue $']]) {
      const b = btn(mLbl, () => { chartMetric = mKey; renderCurrentPage(); }, chartMetric === mKey ? 'btn-primary' : 'btn-secondary');
      b.style.padding = '5px 10px';
      b.style.fontSize = '12px';
      pills.append(b);
    }
    cHead.append(pills);
    chartCard.append(cHead, buildTrendSvg(d.dailySeries || [], chartMetric));

    const planCard = el('section', '', 'card');
    planCard.append(el('div', '', 'card-head'));
    planCard.firstChild.append(el('h2', 'Accounts by Subscription Tier'));
    const td = d.tierDistribution || {};
    planCard.append(makeBarList([
      { label: 'Basic (Free)', count: td.basic || 0, color: '#94a3b8' },
      { label: 'Silver ($29/mo)', count: td.silver || 0, color: '#64748b' },
      { label: 'Gold ($79/mo)', count: td.gold || 0, color: '#d97706' },
      { label: 'Premium ($199/mo)', count: td.premium || 0, color: '#7c3aed' },
      { label: 'Diamond ($499/mo)', count: td.diamond || 0, color: '#059669' }
    ]));
    split.append(chartCard, planCard);

    const bottomGrid = el('div', '', 'grid-2');
    const upCard = el('section', '', 'card');
    const upHead = el('div', '', 'card-head');
    upHead.append(el('h2', 'Hot Upsell Candidates (>=80% Quota Today)'));
    upCard.append(upHead);
    const upFeed = el('div', '', 'feed-list');
    if ((d.quotaHitUsers || []).length) {
      for (const qu of d.quotaHitUsers) {
        const r = el('div', '', 'feed-row');
        r.append(el('span', `${qu.name || qu.email} (${qu.tierLabel}) — ${qu.maxQuotaPct}% used`), btn('Inspect', () => openCrmDrawer(qu), 'btn-soft'));
        upFeed.append(r);
      }
    } else {
      upFeed.append(el('p', 'No accounts are above 80% of their daily quota right now.', 'card-sub'));
    }
    upCard.append(upFeed);

    const evCard = el('section', '', 'card');
    const evHead = el('div', '', 'card-head');
    evHead.append(el('h2', 'Live Platform Activity Stream'));
    evCard.append(evHead);
    const evFeed = el('div', '', 'feed-list');
    if ((d.recentEvents || []).length) {
      for (const ev of d.recentEvents.slice(0, 20)) {
        const r = el('div', '', 'feed-row');
        r.append(el('span', ev.summary), el('small', new Date(ev.time).toLocaleString()));
        evFeed.append(r);
      }
    } else {
      evFeed.append(el('p', 'Live signups, searches, audits, outreach emails, and payments stream here.', 'card-sub'));
    }
    evCard.append(evFeed);
    bottomGrid.append(upCard, evCard);

    main.replaceChildren(head, kpis, split, bottomGrid);
    return;
  }

  if (activePage === 'users') {
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'Accounts & Customer CRM'), el('p', 'Click any account to inspect usage meters, change plans, grant trials, reset quotas, or add CRM notes.'));
    const hActs = el('div', '', 'actions');
    hActs.append(
      btn('Export CSV', () => exportUsersCsv(d.users || []), 'btn-secondary', 'fileText'),
      btn('Create Account', openCreateUserModal, 'btn-primary', 'plus')
    );
    head.append(hLeft, hActs);

    const fBar = el('div', '', 'filter-bar');
    const qIn = el('input');
    qIn.placeholder = 'Filter by name, email, or account ID…';
    qIn.value = userQuery;
    qIn.oninput = e => { userQuery = e.target.value; renderCurrentPage(); };

    const pSel = el('select');
    pSel.append(new Option('All Plans', ''));
    for (const t of d.tierCatalog || []) pSel.append(new Option(t.displayLabel, t.key));
    pSel.value = planFilter;
    pSel.onchange = e => { planFilter = e.target.value; renderCurrentPage(); };

    const bSel = el('select');
    bSel.append(new Option('All Billing', ''), new Option('Paid Subscribers', 'paid'), new Option('Timed Trials', 'trial'), new Option('Comped VIP', 'comped'), new Option('Free Plan', 'free'));
    bSel.value = billingFilter;
    bSel.onchange = e => { billingFilter = e.target.value; renderCurrentPage(); };

    const sSel = el('select');
    sSel.append(new Option('All States', ''), new Option('Active Only', 'active'), new Option('Suspended', 'suspended'), new Option('Near Quota (>=80%)', 'quota'), new Option('Gmail Connected', 'gmail'));
    sSel.value = statusFilter;
    sSel.onchange = e => { statusFilter = e.target.value; renderCurrentPage(); };

    fBar.append(qIn, pSel, bSel, sSel);

    const q = userQuery.trim().toLowerCase();
    const rows = (d.users || []).filter(u => {
      if (q && !`${u.name} ${u.email} ${u.id} ${u.notes || ''}`.toLowerCase().includes(q)) return false;
      if (planFilter && u.tier !== planFilter) return false;
      if (billingFilter && u.billingType !== billingFilter) return false;
      if (statusFilter === 'active' && u.status !== 'active') return false;
      if (statusFilter === 'suspended' && u.status !== 'suspended') return false;
      if (statusFilter === 'quota' && (u.maxQuotaPct || 0) < 80) return false;
      if (statusFilter === 'gmail' && !u.gmailConnected) return false;
      return true;
    });

    const tCard = el('div', '', 'table-card');
    const tWrap = el('div', '', 'table-wrap');
    const tbl = el('table', '', 'crm-table');
    tbl.innerHTML = '<thead><tr><th>Customer Account</th><th>Plan &amp; Billing</th><th>Today Quotas</th><th>CRM Pipeline</th><th>Last Active</th><th>Controls</th></tr></thead>';
    const tb = el('tbody');

    for (const u of rows) {
      const tr = el('tr', '', 'row-click');
      tr.onclick = () => openCrmDrawer(u);

      const tdU = el('td');
      const uCell = el('div', '', 'user-cell');
      uCell.append(el('div', initials(u.name || u.email), 'user-avatar'));
      const uTxt = el('div');
      uTxt.append(el('strong', u.name || u.email.split('@')[0]));
      const em = el('div', u.email); em.style.fontSize = '12px'; em.style.color = 'var(--muted)';
      const tags = el('div', '', 'actions'); tags.style.marginTop = '3px';
      if (u.isAdmin) tags.append(el('span', 'Super Admin', 'pill'));
      if (u.status === 'suspended') tags.append(el('span', 'Suspended', 'pill suspended'));
      if (u.gmailConnected) tags.append(el('span', 'Gmail Linked', 'pill neutral'));
      uTxt.append(em, tags);
      uCell.append(uTxt);
      tdU.append(uCell);

      const tdP = el('td');
      const pTop = el('div', '', 'actions');
      pTop.append(planBadgeEl(u.tier, 22), el('strong', u.tierLabel));
      const bCls = u.billingType === 'paid' ? 'pill paid' : u.billingType === 'trial' ? 'pill trial' : u.billingType === 'comped' ? 'pill comped' : 'pill neutral';
      const bTxt = u.billingType === 'paid' ? `Paid ($${u.monthlyUsd}/mo)` : u.billingType === 'trial' ? `Trial${u.trialEndsAt ? ' → ' + u.trialEndsAt.slice(0, 10) : ''}` : u.billingType === 'comped' ? 'Comped VIP' : 'Free';
      const bWrap = el('div'); bWrap.style.marginTop = '4px'; bWrap.append(el('span', bTxt, bCls));
      tdP.append(pTop, bWrap);

      const tdQ = el('td');
      const qm = el('div', '', 'quota-mini');
      const fmt = (used, lim) => `${used} / ${lim === null ? '∞' : lim}`;
      for (const [l, used, lim] of [['Searches', u.searchesToday, u.dailySearchLimit], ['Leads', u.resultsToday, u.dailyResultLimit], ['Emails', u.emailsToday, u.dailyEmailLimit]]) {
        const dRow = el('div'); dRow.append(el('span', l), el('strong', fmt(used, lim)));
        qm.append(dRow);
      }
      tdQ.append(qm);

      const tdPipe = el('td');
      tdPipe.append(
        el('strong', `${u.leadsCount} leads`),
        el('div', `${u.leadsWithEmail} emails · ${u.auditedCount} audits · ${u.outreachSentCount} sent`, 'kpi-sub')
      );

      const tdAct = el('td', u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : '—');

      const tdCtl = el('td');
      const ctl = el('div', '', 'actions');
      ctl.onclick = e => e.stopPropagation();
      ctl.append(
        btn('Manage CRM', () => openCrmDrawer(u), 'btn-soft'),
        btn('Reset 0', async () => {
          try {
            await api('/api/admin/reset-quota', { userId: u.id });
            toast(`Reset quotas for ${u.email}.`);
            loadOverview(false);
          } catch (err) { toast(err.message, true); }
        }, 'btn-secondary')
      );
      tdCtl.append(ctl);

      tr.append(tdU, tdP, tdQ, tdPipe, tdAct, tdCtl);
      tb.append(tr);
    }
    tbl.append(tb);
    tWrap.append(tbl);
    tCard.append(tWrap);

    main.replaceChildren(head, fBar, tCard);
    return;
  }

  if (activePage === 'monetization') {
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'Subscriptions, Monetization & Billing'), el('p', 'MRR analytics, self-serve Paystack/Stripe checkout URLs, promo codes, upgrade intents, and payment ledger.'));
    head.append(hLeft);

    const kpis = el('div', '', 'kpi-grid-4');
    kpis.append(
      makeKpiCard('Net Paid MRR', `$${(k.netPaidMrr || 0).toLocaleString()}`, `Gross Plan Value: $${(k.grossPlanValueMrr || 0).toLocaleString()}/mo`, 'crown', 'amber'),
      makeKpiCard('Projected ARR', `$${(k.projectedArr || 0).toLocaleString()}`, `${k.paidSubscribers || 0} active paid subscribers`, 'trendingUp'),
      makeKpiCard('ARPU', `$${k.arpu || 0}`, `${k.conversionRate || 0}% free-to-paid conversion`, 'barChart', 'blue'),
      makeKpiCard('Ledger Revenue', `$${(k.totalRevenueRecorded || 0).toLocaleString()}`, `${(d.transactions || []).length} recorded transactions`, 'database', 'purple')
    );

    const checkoutCard = el('section', '', 'card stack');
    checkoutCard.style.marginBottom = '18px';
    checkoutCard.append(
      el('div', '', 'card-head'),
    );
    checkoutCard.firstChild.append(
      el('div', '')
    );
    checkoutCard.firstChild.firstChild.append(
      el('h2', 'Payment Gateway Checkout URLs (Paystack / Stripe / Flutterwave / LemonSqueezy)'),
      el('p', 'Customers clicking "Upgrade" open your checkout link with their email pre-filled. Webhooks auto-upgrade their plan.', 'card-sub')
    );
    const webhookUrl = `${location.origin}/api/webhooks/billing`;
    const whBanner = el('div', '', 'webhook-banner');
    whBanner.append(
      el('span', `Webhook Endpoint (Stripe & Paystack): ${webhookUrl}`),
      btn('Copy Webhook URL', async () => {
        try { await navigator.clipboard.writeText(webhookUrl); toast('Copied Billing Webhook URL!'); } catch {}
      }, 'btn-soft', 'copy')
    );
    const urlGrid = el('div', '', 'grid-2');
    urlGrid.style.marginBottom = '0';
    const urlInputs = {};
    for (const [tKey, lbl] of [['silver', 'Silver ($29/mo) Checkout URL'], ['gold', 'Gold ($79/mo) Checkout URL'], ['premium', 'Premium ($199/mo) Checkout URL'], ['diamond', 'Diamond ($499/mo) Checkout URL']]) {
      const f = field(lbl, tKey, d.checkoutUrls?.[tKey] || '', { placeholder: 'https://paystack.com/pay/... or https://buy.stripe.com/...' });
      urlInputs[tKey] = f.lastChild;
      urlGrid.append(f);
    }
    const saveUrlsBtn = btn('Save Checkout Links', async () => {
      try {
        await api('/api/admin/billing/config', {
          checkoutUrls: {
            silver: urlInputs.silver.value.trim(),
            gold: urlInputs.gold.value.trim(),
            premium: urlInputs.premium.value.trim(),
            diamond: urlInputs.diamond.value.trim()
          }
        });
        toast('Saved live checkout links!');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    }, 'btn-primary', 'check');
    const urlFoot = el('div', '', 'actions'); urlFoot.append(saveUrlsBtn);
    checkoutCard.append(whBanner, urlGrid, urlFoot);

    const mid = el('div', '', 'grid-2');

    // Promo Codes
    const promoCard = el('section', '', 'card stack');
    promoCard.append(el('h2', 'Promo & Trial Codes'), el('p', 'Customers redeem these codes on their Profile page for instant upgrades.', 'card-sub'));
    const pForm = el('form', '', 'grid-2');
    pForm.style.marginBottom = '0';
    const pCode = field('Promo Code', 'code', '', { placeholder: 'e.g. LAUNCH7', required: 'true' });
    const pTierW = el('label'); pTierW.append(el('span', 'Unlocks Plan'));
    const pTier = el('select');
    for (const tk of ['silver', 'gold', 'premium', 'diamond']) pTier.append(new Option(tk.toUpperCase(), tk));
    pTier.value = 'gold';
    pTierW.append(pTier);
    const pDays = field('Trial Days (0 = Permanent)', 'days', 7, { type: 'number', min: 0 });
    const pMax = field('Max Redemptions', 'max', 100, { type: 'number', min: 1 });
    const pSubmit = btn('Create Promo Code', null, 'btn-soft', 'plus'); pSubmit.type = 'submit';
    pForm.append(pCode, pTierW, pDays, pMax, pSubmit);
    pForm.onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/api/admin/billing/config', {
          addPromo: {
            code: pCode.lastChild.value.trim(),
            tier: pTier.value,
            durationDays: Number(pDays.lastChild.value) || 0,
            maxUses: Number(pMax.lastChild.value) || 50
          }
        });
        toast('Created promo code!');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    };
    const pFeed = el('div', '', 'feed-list');
    for (const pr of d.promoCodes || []) {
      const r = el('div', '', 'feed-row');
      r.append(
        el('span', `${pr.code} → ${pr.tier.toUpperCase()} (${pr.durationDays ? pr.durationDays + 'd trial' : 'Permanent'}) · ${pr.usesCount || 0}/${pr.maxUses} used`),
        btn('Delete', async () => {
          await api('/api/admin/billing/config', { deletePromoCode: pr.code });
          loadOverview(false);
        }, 'btn-danger')
      );
      pFeed.append(r);
    }
    promoCard.append(pForm, pFeed);

    // Manual Payment / Refund Ledger
    const txCard = el('section', '', 'card stack');
    txCard.append(el('h2', 'Record Payment / Refund Ledger'), el('p', 'Log offline/bank/card payments and auto-upgrade the customer.', 'card-sub'));
    const txForm = el('form', '', 'grid-2');
    txForm.style.marginBottom = '0';
    const txEm = field('Customer Email', 'email', '', { type: 'email', placeholder: 'customer@domain.com', required: 'true' });
    const txTW = el('label'); txTW.append(el('span', 'Plan'));
    const txT = el('select');
    for (const [tk, usd] of [['silver', 29], ['gold', 79], ['premium', 199], ['diamond', 499]]) txT.append(new Option(`${tk.toUpperCase()} ($${usd})`, tk));
    txT.value = 'gold';
    txTW.append(txT);
    const txAmt = field('Amount USD ($)', 'amount', 79, { type: 'number', min: 0 });
    txT.onchange = () => { txAmt.lastChild.value = ({ silver: 29, gold: 79, premium: 199, diamond: 499 })[txT.value] || 79; };
    const txKW = el('label'); txKW.append(el('span', 'Type'));
    const txK = el('select'); txK.append(new Option('Payment (Auto-Upgrade)', 'payment'), new Option('Refund', 'refund'));
    txKW.append(txK);
    const txBtn = btn('Record Transaction', null, 'btn-primary', 'check'); txBtn.type = 'submit';
    txForm.append(txEm, txTW, txAmt, txKW, txBtn);
    txForm.onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/api/admin/billing/transaction', {
          email: txEm.lastChild.value.trim(),
          tier: txT.value,
          amountUsd: Number(txAmt.lastChild.value) || 0,
          kind: txK.value,
          provider: 'Admin cPanel'
        });
        toast('Recorded transaction & updated customer account!');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    };
    const txFeed = el('div', '', 'feed-list');
    for (const tx of (d.transactions || []).slice(0, 15)) {
      const r = el('div', '', 'feed-row');
      r.append(
        el('span', `${tx.kind === 'refund' ? 'REFUND' : 'PAID'} $${tx.amountUsd} · ${tx.email} (${tx.tier.toUpperCase()} · ${tx.provider})`),
        el('small', new Date(tx.time).toLocaleDateString())
      );
      txFeed.append(r);
    }
    txCard.append(txForm, txFeed);
    mid.append(promoCard, txCard);

    // Upgrade Intents Queue
    const intCard = el('section', '', 'card stack');
    intCard.append(el('h2', 'Customer Upgrade Intent Queue (Paywall Triggers)'), el('p', 'Accounts that clicked locked features — follow up or grant a short trial to close them.', 'card-sub'));
    const intFeed = el('div', '', 'feed-list');
    if ((d.upgradeIntents || []).length) {
      for (const it of d.upgradeIntents) {
        const matched = (d.users || []).find(u => u.id === it.userId || u.email === it.email);
        const r = el('div', '', 'feed-row');
        r.append(
          el('span', `${it.name || it.email} (${it.currentTier.toUpperCase()} → ${it.targetTier.toUpperCase()}) clicked "${it.featureTitle}"`),
          matched ? btn('Open in CRM', () => openCrmDrawer(matched), 'btn-soft') : el('small', new Date(it.time).toLocaleString())
        );
        intFeed.append(r);
      }
    } else {
      intFeed.append(el('p', 'Paywall upgrade clicks from customer accounts appear here automatically.', 'card-sub'));
    }
    intCard.append(intFeed);

    main.replaceChildren(head, kpis, checkoutCard, mid, intCard);
    return;
  }

  if (activePage === 'plans') {
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'Plans, Pricing & Daily Quotas Configurator'), el('p', 'Live-edit monthly pricing and daily discovery/outreach limits across all 5 tiers without redeploying code. Leave a limit blank for Unlimited.'));
    head.append(hLeft);

    const card = el('section', '', 'card stack');
    const wrap = el('div', '', 'table-wrap');
    const tbl = el('table', '', 'crm-table');
    tbl.innerHTML = '<thead><tr><th>Subscription Tier</th><th>Monthly USD ($)</th><th>Searches / Day</th><th>Leads / Day</th><th>Outreach Emails / Day</th><th>Max Search Pages</th></tr></thead>';
    const tb = el('tbody');
    const inputs = {};

    for (const t of d.tierCatalog || []) {
      const tr = el('tr');
      const mk = (v, ph = 'Unlimited') => {
        const inp = el('input');
        inp.type = 'number';
        inp.value = v === null || v === undefined ? '' : String(v);
        inp.placeholder = ph;
        inp.style.width = '120px';
        return inp;
      };
      inputs[t.key] = {
        monthlyUsd: mk(t.monthlyUsd ?? 0, '0'),
        dailySearchLimit: mk(t.dailySearchLimit),
        dailyResultLimit: mk(t.dailyResultLimit),
        dailyEmailLimit: mk(t.dailyEmailLimit),
        maxSearchPages: mk(t.maxSearchPages, '8')
      };
      const td0 = el('td');
      const pRow = el('div', '', 'actions');
      pRow.append(planBadgeEl(t.key, 26), el('strong', t.displayLabel));
      td0.append(pRow);

      const td1 = el('td'); td1.append(inputs[t.key].monthlyUsd);
      const td2 = el('td'); td2.append(inputs[t.key].dailySearchLimit);
      const td3 = el('td'); td3.append(inputs[t.key].dailyResultLimit);
      const td4 = el('td'); td4.append(inputs[t.key].dailyEmailLimit);
      const td5 = el('td'); td5.append(inputs[t.key].maxSearchPages);
      tr.append(td0, td1, td2, td3, td4, td5);
      tb.append(tr);
    }
    tbl.append(tb);
    wrap.append(tbl);

    const saveBtn = btn('Save Live Tier Pricing & Quotas', async () => {
      const tierOverrides = {};
      for (const [key, f] of Object.entries(inputs)) {
        const usd = Number(f.monthlyUsd.value) || 0;
        tierOverrides[key] = {
          monthlyUsd: usd,
          price: key === 'basic' && usd === 0 ? 'Free' : `$${usd}/mo`,
          dailySearchLimit: f.dailySearchLimit.value === '' ? null : Number(f.dailySearchLimit.value),
          dailyResultLimit: f.dailyResultLimit.value === '' ? null : Number(f.dailyResultLimit.value),
          dailyEmailLimit: f.dailyEmailLimit.value === '' ? null : Number(f.dailyEmailLimit.value),
          maxSearchPages: Number(f.maxSearchPages.value) || 8
        };
      }
      try {
        await api('/api/admin/billing/config', { tierOverrides });
        toast('Updated live pricing & daily quotas across all accounts!');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    }, 'btn-primary', 'check');
    const foot = el('div', '', 'actions'); foot.append(saveBtn);
    card.append(wrap, foot);
    main.replaceChildren(head, card);
    return;
  }

  if (activePage === 'telemetry') {
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'Platform Usage & Engine Telemetry'), el('p', 'Omnichannel lead discovery volume, outreach personas, and top searched markets across all accounts.'));
    head.append(hLeft);

    const ch = d.channelBreakdown || {};
    const g1 = el('div', '', 'grid-2');
    const chCard = el('section', '', 'card stack');
    chCard.append(el('h2', 'Leads Discovered by Omnichannel Engine'));
    chCard.append(makeBarList([
      { label: 'Bing Maps, Google Maps & Local Web', count: ch.mapsLocal || 0, color: '#059669' },
      { label: 'Shopify, Klaviyo/ESPs & Etsy/Faire', count: ch.shopifyEcom || 0, color: '#2563eb' },
      { label: 'Link-in-Bio, Booking & Chamber Directories', count: ch.rentedDirectory || 0, color: '#d97706' },
      { label: 'Newly Registered Domains (crt.sh) & Launches', count: ch.newDomainsLaunches || 0, color: '#7c3aed' },
      { label: 'Hiring Job Boards, Reddit & Paid-Ad Funnels', count: ch.hiringRedditAds || 0, color: '#dc2626' }
    ]));

    const perCard = el('section', '', 'card stack');
    perCard.append(el('h2', 'Customer Outreach Personas'));
    const pb = d.personaBreakdown || {};
    perCard.append(makeBarList(PERSONA_CATALOG.map(p => ({ label: p.title, count: pb[p.id] || 0, color: '#0f766e' }))));
    g1.append(chCard, perCard);

    const g2 = el('div', '', 'grid-2');
    const indCard = el('section', '', 'card stack');
    indCard.append(el('h2', 'Top Searched Industries'));
    indCard.append((d.topIndustries || []).length
      ? makeBarList(d.topIndustries.map(x => ({ label: x.name, count: x.count, suffix: ' searches' })))
      : el('p', 'Customer search terms will populate here automatically.', 'card-sub'));

    const cityCard = el('section', '', 'card stack');
    cityCard.append(el('h2', 'Top Searched Cities & Markets'));
    cityCard.append((d.topCities || []).length
      ? makeBarList(d.topCities.map(x => ({ label: x.name, count: x.count, suffix: ' searches', color: '#2563eb' })))
      : el('p', 'Target cities searched by customers will populate here automatically.', 'card-sub'));
    g2.append(indCard, cityCard);

    main.replaceChildren(head, g1, g2);
    return;
  }

  if (activePage === 'system') {
    const h = d.systemHealth || {};
    const head = el('div', '', 'page-head');
    const hLeft = el('div');
    hLeft.append(el('h1', 'System Health, Customer Broadcasts & Audit Log'), el('p', 'Infrastructure status, global customer bell announcements, co-admin permissions, and immutable security logs.'));
    head.append(hLeft);

    const kpis = el('div', '', 'kpi-grid-4');
    kpis.append(
      makeKpiCard('Supabase Postgres', h.supabaseConfigured ? (h.supabaseConnected ? `${h.supabaseLatencyMs}ms` : 'Offline') : 'Local JSON', `${h.dbCounts?.users || 0} users · ${h.dbCounts?.leads || 0} leads`, 'database'),
      makeKpiCard('Google Gmail OAuth', h.gmailOAuthConfigured ? 'Configured' : 'Not Set', `${k.gmailConnectedUsers || 0} linked mailboxes`, 'mail', 'blue'),
      makeKpiCard('Gemini 2.5 Flash AI', h.geminiConfigured ? 'Active' : 'Smart Fallback', h.serperConfigured || h.tavilyConfigured ? 'Serper/Tavily Active' : 'Built-in Multi-Engine', 'sparkles', 'purple'),
      makeKpiCard('Node Server Runtime', `${h.memoryRssMb || 0} MB RSS`, `Uptime: ${Math.floor((h.uptimeSeconds || 0) / 60)}m · Heap ${h.heapUsedMb || 0} MB`, 'zap', 'amber')
    );

    const g = el('div', '', 'grid-2');

    const annCard = el('section', '', 'card stack');
    annCard.append(el('h2', 'Global Customer Notification Broadcast'), el('p', 'Push announcements or promo offers straight to customers’ notification bells.', 'card-sub'));
    const annForm = el('form', '', 'stack');
    const aTitle = field('Title', 'title', '', { placeholder: 'e.g. Flash Offer: Use LAUNCH7 for 7 Days of Gold!', required: 'true' });
    const aMsg = field('Message', 'message', '', { placeholder: 'Details shown inside customer notification bells…', required: 'true' });
    const aTW = el('label'); aTW.append(el('span', 'Target Audience'));
    const aT = el('select');
    aT.append(new Option('All Customers', 'all'), new Option('Basic (Free) Only', 'basic'), new Option('Silver Only', 'silver'), new Option('Gold Only', 'gold'));
    aTW.append(aT);
    const aBtn = btn('Publish Announcement', null, 'btn-primary', 'megaphone'); aBtn.type = 'submit';
    annForm.append(aTitle, aMsg, aTW, aBtn);
    annForm.onsubmit = async e => {
      e.preventDefault();
      try {
        await api('/api/admin/broadcast', {
          addAnnouncement: {
            title: aTitle.lastChild.value.trim(),
            message: aMsg.lastChild.value.trim(),
            targetTier: aT.value,
            ctaHash: '#profile'
          }
        });
        toast('Published customer broadcast!');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    };
    const aFeed = el('div', '', 'feed-list');
    for (const a of d.announcements || []) {
      const r = el('div', '', 'feed-row');
      r.append(
        el('span', `[${a.targetTier.toUpperCase()}] ${a.title} — ${a.message}`),
        btn('Remove', async () => {
          await api('/api/admin/broadcast', { deleteAnnouncementId: a.id });
          loadOverview(false);
        }, 'btn-danger')
      );
      aFeed.append(r);
    }
    annCard.append(annForm, aFeed);

    const coCard = el('section', '', 'card stack');
    coCard.append(el('h2', 'Super Admin & Co-Admin Access'), el('p', 'Primary Root Admin: admin@jobhunta.com. Add or revoke additional administrator emails below.', 'card-sub'));
    const coF = field('Co-Admin Emails (comma-separated)', 'coAdmins', (d.coAdmins || []).join(', '), { placeholder: 'ops@jobhunta.com, support@jobhunta.com' });
    const coBtn = btn('Save Co-Admin List', async () => {
      const list = coF.lastChild.value.split(',').map(s => s.trim()).filter(Boolean);
      try {
        await api('/api/admin/broadcast', { coAdmins: list });
        toast('Updated Co-Admin permissions.');
        loadOverview(false);
      } catch (err) { toast(err.message, true); }
    }, 'btn-soft', 'shieldCheck');
    const coActs = el('div', '', 'actions'); coActs.append(coBtn);
    coCard.append(coF, coActs);
    g.append(annCard, coCard);

    const logCard = el('section', '', 'card stack');
    logCard.append(el('h2', 'Immutable Admin Security Audit Log'));
    const logFeed = el('div', '', 'feed-list');
    if ((d.auditLog || []).length) {
      for (const entry of d.auditLog) {
        const r = el('div', '', 'feed-row');
        r.append(
          el('span', `[${entry.action}] ${entry.actorEmail}${entry.targetEmail ? ' → ' + entry.targetEmail : ''}: ${entry.details}`),
          el('small', new Date(entry.time).toLocaleString())
        );
        logFeed.append(r);
      }
    } else {
      logFeed.append(el('p', 'Every administrative action is logged here chronologically.', 'card-sub'));
    }
    logCard.append(logFeed);

    main.replaceChildren(head, kpis, g, logCard);
  }
}

/* ---------------- BOOTSTRAP ---------------- */
(async () => {
  try {
    const st = await api('/api/status');
    if (st.user?.isAdmin) {
      enterAdminShell(st.user);
    } else {
      showLogin(st.user ? 'Signed-in user is not an administrator. Sign in with your Admin credentials.' : '');
    }
  } catch {
    showLogin();
  }
})();
