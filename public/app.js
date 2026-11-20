import { readBusinessCsv, writeBusinessCsv } from './csv.mjs';
import { iconEl, iconSvg } from './icons.mjs';

const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const pageSize = 20;

const defaultTemplates = [
  {
    id: 'intro',
    name: 'Initial Introduction',
    desc: 'Introduce your service to a new local lead',
    subject: 'Quick introduction to {{business_name}}',
    body: 'Hi {{business_name}} team,\n\nI’m {{your_name}}. I help businesses with {{your_service}}. I came across your business in {{city}} and wanted to introduce myself.\n\nWould you be open to a short conversation about {{specific_opportunity}}?\n\nThanks,\n{{your_name}}'
  },
  {
    id: 'followup',
    name: 'Follow Up Email',
    desc: 'Follow up with leads who have not replied',
    subject: 'Re: Quick introduction to {{business_name}}',
    body: 'Hi {{business_name}} team,\n\nI wanted to quickly follow up on my previous note in case it got buried. Would you be open to a brief chat this week about how I can help with {{your_service}}?\n\nBest regards,\n{{your_name}}'
  },
  {
    id: 'value',
    name: 'Partnership Proposal',
    desc: 'Direct value pitch with niche opportunity',
    subject: 'Idea for {{business_name}} in {{city}}',
    body: 'Hi {{business_name}} team,\n\nWhile looking at {{industry}} businesses in {{city}}, I noticed {{business_name}} and put together a quick idea around {{specific_opportunity}}.\n\nI work on {{your_service}}—happy to share the details if it is useful to you.\n\nThanks,\n{{your_name}}'
  }
];

let currentUser = null;
let leads = [];
let settings = {
  senderName: '',
  senderService: '',
  defaultFollowUpDays: 4,
  templates: defaultTemplates
};

const userLeadsKey = userId => `jobhunta.leads.v2.${userId}`;
const userSettingsKey = userId => `jobhunta.settings.v2.${userId}`;

function loadLocalUserCache(userId) {
  if (!userId) return { cachedLeads: [], cachedSettings: {} };
  try {
    return {
      cachedLeads: JSON.parse(localStorage.getItem(userLeadsKey(userId)) || '[]'),
      cachedSettings: JSON.parse(localStorage.getItem(userSettingsKey(userId)) || '{}')
    };
  } catch {
    return { cachedLeads: [], cachedSettings: {} };
  }
}

let account = {};
let results = [];
let resultsPage = 1;
let leadsPage = 1;
let selectedLeadFolder = '';
let activeSearchFolder = '';
let autoPersistTimer = null;
let activeBusinessId = null;
let dossierTab = 'overview';
let settingsTab = 'integrations';
let selectedInboxKey = null;
let inboxFilter = 'all';
let selectedBroadcastTplId = 'intro';
let broadcastAudience = 'verified';
let broadcastSending = false;
let searchGeneration = 0;
let searchController = null;
let streamActive = false;
let currentScrapeStep = '';
let refreshing = false;
let enrichingAll = false;
const messages = new Map();

const statusNames = {
  interested: 'Interested',
  declined: 'Declined',
  away: 'Out of office',
  unsubscribe: 'Unsubscribed',
  bounced: 'Bounced'
};

const avatarColors = ['#0f4c81', '#059669', '#7c3aed', '#b45309', '#be185d', '#0369a1'];
function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function getAvatarColor(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return avatarColors[Math.abs(hash) % avatarColors.length];
}
function makeAvatar(name, large = false) {
  const el = create('div', getInitials(name), 'biz-avatar' + (large ? ' lg' : ''));
  el.style.background = getAvatarColor(name);
  return el;
}

function create(tag, value, className) {
  const element = document.createElement(tag);
  if (value) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function button(label, handler, variant = '') {
  const className = variant === true ? 'secondary' : variant;
  const element = create('button', label, className);
  element.type = 'button';
  element.onclick = handler;
  return element;
}

function btnWithIcon(iconName, label, handler, variant = '', iconSize = 15) {
  const className = variant === true ? 'secondary' : variant;
  const element = create('button', '', className);
  element.type = 'button';
  element.append(iconEl(iconName, iconSize), document.createTextNode(label));
  element.onclick = handler;
  return element;
}

function renderPagination(container, currentPage, totalPages, totalItems, onPageChange) {
  if (!container) return;
  if (totalPages <= 1) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const nums = create('div', '', 'page-nums');
  const prev = create('button', '', 'page-num-btn');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous page');
  prev.disabled = currentPage <= 1;
  prev.append(iconEl('chevronLeft', 15));
  prev.onclick = () => onPageChange(currentPage - 1);
  nums.append(prev);

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('…');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }
  for (const p of pages) {
    if (p === '…') {
      nums.append(create('span', '…', 'small'));
    } else {
      const b = create('button', String(p), 'page-num-btn' + (p === currentPage ? ' active' : ''));
      b.type = 'button';
      b.onclick = () => onPageChange(p);
      nums.append(b);
    }
  }

  const next = create('button', '', 'page-num-btn');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next page');
  next.disabled = currentPage >= totalPages;
  next.append(iconEl('chevronRight', 15));
  next.onclick = () => onPageChange(currentPage + 1);
  nums.append(next);

  container.replaceChildren(nums);
}

async function api(path, payload) {
  const response = await fetch(path, payload === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function report(message = '', error = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.hidden = !message;
  notice.classList.toggle('error', error);
}

function empty(iconName, title, description) {
  const box = create('div', '', 'surface empty');
  const mark = create('div', '', 'empty-ico');
  mark.setAttribute('aria-hidden', 'true');
  mark.append(iconEl(iconName || 'search', 22));
  box.append(mark, create('h3', title), create('p', description));
  return box;
}

function syncWorkspaceToServer() {
  if (!currentUser?.id) return;
  api('/api/workspace', { userId: currentUser.id, leads, settings }).catch(() => {});
}

function persist() {
  if (currentUser?.id) {
    localStorage.setItem(userLeadsKey(currentUser.id), JSON.stringify(leads));
    localStorage.setItem(userSettingsKey(currentUser.id), JSON.stringify(settings));
    syncWorkspaceToServer();
  }
  updateHeaderBadges();
  renderDashboard();
  renderLeads();
  renderInbox();
  renderBroadcast();
  renderProfile();
  renderSettings();
  if (activeBusinessId && location.hash === '#business') renderBusinessPage();
}

const norm = value => (value || '').trim().toLowerCase();
function duplicate(item, exclude) {
  return leads.find(lead => lead.id !== exclude && (lead.id === item.id || (
    norm(lead.name) === norm(item.name) &&
    ((norm(lead.city) === norm(item.city) && (!lead.address || !item.address || norm(lead.address) === norm(item.address))) ||
      (item.email && norm(lead.email) === norm(item.email)) ||
      (item.address && norm(lead.address) === norm(item.address)))
  )));
}

function blocked(email) {
  return leads.some(lead => (lead.suppressed || []).includes(norm(email)));
}

function website(url, label) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const link = create('a', label);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.onclick = e => e.stopPropagation();
    return link;
  } catch { return ''; }
}

function socialLinks(item) {
  return [
    website(item.facebook, 'Facebook'),
    website(item.instagram, 'Instagram'),
    website(item.twitter, 'X/Twitter'),
    website(item.linkedin, 'LinkedIn'),
    website(item.youtube, 'YouTube'),
    website(item.tiktok, 'TikTok')
  ].filter(Boolean);
}

function leadStatus(lead) {
  if (lead.classification && statusNames[lead.classification]) return statusNames[lead.classification];
  if (lead.replied) return 'Replied';
  if (lead.due && lead.due <= new Date().toLocaleDateString('en-CA')) return 'Follow-up due';
  if ((lead.threads || []).length) return 'Contacted';
  return lead.email ? 'New' : 'Needs email';
}

function statusPillClass(status) {
  if (status === 'Needs email' || status === 'Follow-up due' || status === 'Out of office') return 'pill wait';
  if (status === 'Declined' || status === 'Unsubscribed' || status === 'Bounced') return 'pill warn';
  return 'pill';
}

function updateHeaderBadges() {
  const navCount = $('#nav-leads-count');
  if (navCount) {
    navCount.textContent = String(leads.length);
    navCount.hidden = leads.length === 0;
  }
  const convCount = outgoing().filter(item => item.conversation.mailbox === account.mailbox).length;
  const navInbox = $('#nav-inbox-count');
  if (navInbox) {
    navInbox.textContent = String(convCount);
    navInbox.hidden = convCount === 0;
  }
  const notifications = buildNotifications();
  const bellDot = $('#bell-dot');
  if (bellDot) bellDot.hidden = notifications.length === 0;
  if (!$('#notif-popover')?.hidden) renderNotificationsPopover();

  const avatarBtn = $('#header-avatar-btn');
  if (avatarBtn && currentUser) {
    avatarBtn.textContent = getInitials(currentUser.name || currentUser.email);
  }
  const tierLabel = currentUser?.usage?.label || 'Basic';
  const planTitle = $('#sidebar-plan-title');
  const planSub = $('#sidebar-plan-sub');
  const planCta = document.querySelector('#sidebar-plan-card .plan-cta');
  if (planTitle) planTitle.textContent = tierLabel === 'Diamond' ? 'Diamond Plan Active' : `${tierLabel} Plan`;
  if (planSub) {
    planSub.textContent = tierLabel === 'Diamond'
      ? 'Unlimited searches & outreach'
      : 'Upgrade for higher daily quotas';
  }
  if (planCta) planCta.textContent = tierLabel === 'Diamond' ? 'View Usage & Plan' : 'Upgrade Now';
}

function applyEnrichmentToItem(item, found) {
  if (found.email && !item.email) item.email = found.email;
  if (Array.isArray(found.emails) && found.emails.length) {
    item.emails = [...new Set([...(item.emails || []), ...found.emails])];
  }
  for (const fieldName of ['facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'siteTitle', 'metaDescription', 'aboutSummary', 'platform']) {
    if (found[fieldName] && !item[fieldName]) item[fieldName] = found[fieldName];
  }
  if (found.platform && found.platform !== 'Custom / Website') {
    item.platform = found.platform;
  }
  if (Array.isArray(found.techStack) && found.techStack.length) {
    item.techStack = [...new Set([...(item.techStack || []), ...found.techStack])];
  }
  if (found.shopifyMeta) {
    item.shopifyMeta = { ...(item.shopifyMeta || {}), ...found.shopifyMeta };
  }
  if (Array.isArray(found.shopifyProducts) && found.shopifyProducts.length) {
    item.shopifyProducts = found.shopifyProducts;
  }
  if (Array.isArray(found.headings) && found.headings.length) {
    item.headings = found.headings;
  }
  if (found.signals) {
    item.signals = { ...(item.signals || {}), ...found.signals };
  }
  const savedLead = duplicate(item);
  if (savedLead && savedLead !== item) {
    applyEnrichmentToItem(savedLead, found);
  }
}

function updateScrapeBanner() {
  const banner = $('#scrape-banner');
  const statusEl = $('#scrape-status');
  const metricsEl = $('#scrape-metrics');
  const stopBtn = $('#stop-search');
  if (!banner || !statusEl || !metricsEl) return;

  const scanningWebsites = results.filter(item => item.scanning).length;
  const pendingWebsites = results.filter(item => item.website && !item.email && !item.scanned && !item.scanning).length;
  const activeEnrichment = scanningWebsites > 0 || pendingWebsites > 0;
  const isWorking = streamActive || activeEnrichment;

  if (stopBtn) stopBtn.hidden = !isWorking;
  if (!results.length && !streamActive) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.classList.toggle('done', !isWorking);

  const emailsFound = results.filter(item => item.email).length;
  const shopifyFound = results.filter(item => item.platform === 'Shopify').length;
  const socialsFound = results.filter(item => item.facebook || item.instagram || item.twitter || item.linkedin).length;

  if (streamActive) {
    statusEl.textContent = currentScrapeStep || 'Scraping businesses in real time…';
  } else if (activeEnrichment) {
    statusEl.textContent = `Scanning business websites for Shopify, emails & socials (${scanningWebsites + pendingWebsites} remaining)…`;
  } else {
    statusEl.textContent = `Scrape complete — ${results.length} businesses discovered.`;
  }

  metricsEl.textContent = `${results.length} scraped · ${shopifyFound} Shopify · ${emailsFound} email${emailsFound === 1 ? '' : 's'} · ${socialsFound} social${socialsFound === 1 ? '' : 's'}`;
}

async function enrichItemEmail(item, triggerButton) {
  if (!item.website) return;
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = 'Combing…';
  }
  try {
    const found = await api('/api/enrich', { website: item.website });
    item.scanned = true;
    applyEnrichmentToItem(item, found);
    persist();
    if (results.length) renderResults();
    if (found.email || found.aboutSummary) {
      report(`Combed ${item.name}'s website: ${found.email ? 'found ' + found.email : 'extracted website insights'}.`);
    } else {
      report(`Scanned ${item.name}'s website; no public email address listed.`, true);
      if (triggerButton) triggerButton.textContent = 'Scanned';
    }
  } catch (error) {
    item.scanned = true;
    report(error.message, true);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = 'Comb site';
    }
  }
}

let activeWorkers = 0;
function triggerEnrichmentWorkers(generation) {
  const maxWorkers = 3;
  while (activeWorkers < maxWorkers && generation === searchGeneration) {
    const nextItem = results.find(item => item.website && !item.email && !item.scanned && !item.scanning);
    if (!nextItem) break;
    activeWorkers++;
    nextItem.scanning = true;
    renderResults();
    updateScrapeBanner();
    (async () => {
      try {
        const found = await api('/api/enrich', { website: nextItem.website });
        if (generation !== searchGeneration) return;
        applyEnrichmentToItem(nextItem, found);
        if (duplicate(nextItem)) persist();
      } catch {
        // Ignore individual timeouts
      } finally {
        nextItem.scanning = false;
        nextItem.scanned = true;
        activeWorkers--;
        if (generation === searchGeneration) {
          renderResults();
          updateScrapeBanner();
          triggerEnrichmentWorkers(generation);
        }
      }
    })();
  }
}

function openBusinessPage(item) {
  let saved = duplicate(item);
  if (!saved) {
    const copy = { ...item, id: item.id || crypto.randomUUID(), savedAt: Date.now(), threads: [] };
    delete copy.scanning;
    delete copy.scanned;
    leads.unshift(copy);
    persist();
    saved = copy;
  }
  activeBusinessId = saved.id;
  dossierTab = 'overview';
  location.hash = '#business';
  renderBusinessPage();
}

function jumpToLeadsFilter(statusValue = '') {
  const select = $('#filter-status');
  if (select) select.value = statusValue;
  location.hash = '#leads';
  renderLeads();
}

/* ---------------- DASHBOARD (Figma Desktop Dashboard & Mobile Home) ---------------- */
function buildActivitySvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 540 185');
  svg.setAttribute('class', 'chart-svg');

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toLocaleDateString('en-CA'),
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      leads: 0,
      emails: 0
    });
  }
  for (const l of leads) {
    const dayKey = l.savedAt ? new Date(l.savedAt).toLocaleDateString('en-CA') : days[6].key;
    const slot = days.find(d => d.key === dayKey) || days[6];
    slot.leads++;
    for (const t of l.threads || []) {
      const tKey = t.time ? new Date(t.time).toLocaleDateString('en-CA') : days[6].key;
      const tSlot = days.find(d => d.key === tKey);
      if (tSlot) tSlot.emails++;
    }
  }
  const rawMax = Math.max(3, ...days.map(d => Math.max(d.leads, d.emails)));
  const maxVal = Math.ceil(rawMax / 3) * 3;

  for (let g = 0; g <= 3; g++) {
    const y = 20 + (g * 38);
    const val = Math.round(maxVal * (1 - g / 3));
    const yLbl = document.createElementNS(ns, 'text');
    yLbl.setAttribute('x', '28');
    yLbl.setAttribute('y', String(y + 4));
    yLbl.setAttribute('text-anchor', 'end');
    yLbl.setAttribute('fill', '#839a9e');
    yLbl.setAttribute('font-size', '11');
    yLbl.textContent = String(val);
    svg.append(yLbl);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '38'); line.setAttribute('x2', '522');
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#ebf2f0'); line.setAttribute('stroke-width', '1');
    svg.append(line);
  }

  const ptsLeads = days.map((d, idx) => {
    const x = 52 + idx * 76;
    const y = 134 - Math.round((d.leads / maxVal) * 114);
    return `${x},${y}`;
  }).join(' ');
  const ptsEmails = days.map((d, idx) => {
    const x = 52 + idx * 76;
    const y = 134 - Math.round((d.emails / maxVal) * 114);
    return `${x},${y}`;
  }).join(' ');

  const polyLeads = document.createElementNS(ns, 'polyline');
  polyLeads.setAttribute('fill', 'none');
  polyLeads.setAttribute('stroke', '#059669');
  polyLeads.setAttribute('stroke-width', '2.8');
  polyLeads.setAttribute('stroke-linecap', 'round');
  polyLeads.setAttribute('stroke-linejoin', 'round');
  polyLeads.setAttribute('points', ptsLeads);

  const polyEmails = document.createElementNS(ns, 'polyline');
  polyEmails.setAttribute('fill', 'none');
  polyEmails.setAttribute('stroke', '#6ee7b7');
  polyEmails.setAttribute('stroke-width', '2.4');
  polyEmails.setAttribute('stroke-linecap', 'round');
  polyEmails.setAttribute('stroke-linejoin', 'round');
  polyEmails.setAttribute('points', ptsEmails);

  svg.append(polyEmails, polyLeads);

  days.forEach((d, idx) => {
    const x = 52 + idx * 76;
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', String(x));
    txt.setAttribute('y', '166');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#647b80');
    txt.setAttribute('font-size', '11.5');
    txt.textContent = d.label;
    svg.append(txt);
  });
  return svg;
}

function buildDonutSvg(segments) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('width', '124');
  svg.setAttribute('height', '124');
  const total = Math.max(1, segments.reduce((s, x) => s + x.count, 0));
  const r = 42;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  segments.forEach(seg => {
    const len = (seg.count / total) * circ;
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '60');
    circle.setAttribute('cy', '60');
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', seg.color);
    circle.setAttribute('stroke-width', '20');
    circle.setAttribute('stroke-dasharray', `${len} ${circ - len}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('transform', 'rotate(-90 60 60)');
    svg.append(circle);
    offset += len;
  });
  return svg;
}

function renderDashboard() {
  const container = $('#dashboard-content');
  if (!container) return;

  const firstName = (currentUser?.name || settings.senderName || 'there').split(/\s+/)[0];
  const tierLabel = currentUser?.usage?.label || 'Basic';
  const usage = currentUser?.usage || {};
  const searchesLeft = usage.dailySearchLimit == null
    ? 'Unlimited searches'
    : `${Math.max(0, usage.dailySearchLimit - (usage.searchesToday || 0))} searches left today`;
  const emailsSent = leads.reduce((sum, l) => sum + (l.threads?.length || 0), 0);
  const repliedCount = leads.filter(l => l.replied || l.classification === 'interested').length;
  const contactedCount = leads.filter(l => (l.threads?.length || 0) > 0).length;
  const responseRate = contactedCount ? Math.round((repliedCount / contactedCount) * 100) : 0;
  const withEmailCount = leads.filter(l => l.email).length;

  // --- Mobile Home Layout (matches mobile-home.png on <= 640px) ---
  const mobWrap = create('div', '', 'mobile-home-wrap');
  const mobHero = create('div', '', 'mob-hero');
  mobHero.append(
    create('h1', `Hello, ${firstName}`),
    create('p', "Let's find new business opportunities today.")
  );
  const planGlass = create('div', '', 'mob-plan-glass');
  const planLeft = create('div', '', 'mob-plan-left');
  const planIco = create('div', '', 'mob-plan-ico');
  planIco.append(iconEl('crown', 19));
  const planText = create('div');
  planText.append(create('strong', `${tierLabel} Plan`), create('div', searchesLeft, 'small'));
  planText.lastChild.style.color = '#bfe0d8';
  planLeft.append(planIco, planText);
  const planChev = iconEl('chevronRight', 18);
  planGlass.append(planLeft, planChev);
  planGlass.onclick = () => { location.hash = '#profile'; };
  mobHero.append(planGlass);

  const mobSheet = create('div', '', 'mob-sheet');
  const mobKpis = create('div', '', 'mob-kpi-grid');
  const addMobKpi = (icoName, val, lbl, hash) => {
    const tile = create('div', '', 'mob-kpi');
    const ic = create('div', '', 'kpi-ico');
    ic.style.marginBottom = '4px';
    ic.append(iconEl(icoName, 20));
    tile.append(ic, create('strong', String(val)), create('small', lbl));
    tile.onclick = () => { location.hash = hash; };
    mobKpis.append(tile);
  };
  addMobKpi('users', leads.length, 'Total Leads', '#leads');
  addMobKpi('building', results.length || withEmailCount, results.length ? 'Found Businesses' : 'With Email', '#discover');
  addMobKpi('mail', emailsSent, 'Emails Sent', '#inbox');
  addMobKpi('checkCircle', `${responseRate}%`, 'Response Rate', '#inbox');

  const ctaBanner = create('div', '', 'mob-cta-banner');
  const ctaCopy = create('div');
  ctaCopy.append(create('strong', 'Find Businesses'), create('small', 'Search Bing Maps & Shopify stores'));
  const ctaBtn = create('div', '', 'mob-cta-btn');
  ctaBtn.append(iconEl('search', 20));
  ctaBanner.append(ctaCopy, ctaBtn);
  ctaBanner.onclick = () => { location.hash = '#discover'; };

  const mobQuickHead = create('h2', 'Quick Actions');
  const mobQuick = create('div', '', 'mob-quick-grid');
  const addQuick = (icoName, label, hash) => {
    const t = create('div', '', 'mob-quick-tile');
    const sp = create('span'); sp.append(iconEl(icoName, 17));
    t.append(sp, document.createTextNode(label));
    t.onclick = () => { location.hash = hash; };
    mobQuick.append(t);
  };
  addQuick('bookmark', 'Saved Leads', '#leads');
  addQuick('send', 'Broadcast', '#broadcast');
  addQuick('mail', 'Inbox', '#inbox');
  addQuick('settings', 'Settings', '#settings');

  mobSheet.append(mobKpis, ctaBanner, mobQuickHead, mobQuick);
  mobWrap.append(mobHero, mobSheet);

  // --- Desktop Dashboard Layout (matches desktop-dashboard.png) ---
  const deskWrap = create('div', '', 'desktop-dash-only');
  const headerBar = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', `Welcome back, ${firstName}!`),
    create('p', "Here's what's happening with your Jobhunta outreach workspace today.")
  );
  const rightActions = create('div', '', 'actions');
  const tierPill = create('span', '', 'pill');
  tierPill.append(create('i', '', 'status-dot'), document.createTextNode(`${tierLabel} Plan`));
  rightActions.append(
    tierPill,
    btnWithIcon('search', 'Find Businesses', () => { location.hash = '#discover'; })
  );
  headerBar.append(titleWrap, rightActions);

  const kpiGrid = create('div', '', 'kpi-grid');
  const makeKpi = (icoName, value, label, trend, targetStatus) => {
    const card = create('article', '', 'surface kpi-card');
    const ico = create('div', '', 'kpi-ico');
    ico.append(iconEl(icoName, 24));
    const foot = create('div', '', 'kpi-foot-row');
    foot.append(create('small', label), create('span', trend, 'kpi-trend'));
    card.append(ico, create('strong', String(value)), foot);
    card.onclick = () => jumpToLeadsFilter(targetStatus);
    return card;
  };
  kpiGrid.append(
    makeKpi('users', leads.length, 'Total Leads', `${withEmailCount} verified`, ''),
    makeKpi('building', results.length || withEmailCount, results.length ? 'Businesses Found' : 'Leads With Email', 'Inspect →', 'New'),
    makeKpi('mail', emailsSent, 'Emails Sent', `${contactedCount} threads`, 'Contacted'),
    makeKpi('checkCircle', `${responseRate}%`, 'Response Rate', `${repliedCount} replied`, 'Replied')
  );

  const midRow = create('div', '', 'dash-mid');
  const activityCard = create('article', '', 'surface card-pad');
  const actHead = create('div', '', 'heading');
  actHead.style.margin = '0';
  const legend = create('div', '', 'legend');
  const legLeads = create('span'); legLeads.innerHTML = '<i style="background:#059669"></i>Leads';
  const legEmails = create('span'); legEmails.innerHTML = '<i style="background:#6ee7b7"></i>Emails';
  legend.append(legLeads, legEmails);
  actHead.append(create('h2', 'Lead Activity'), legend);
  activityCard.append(actHead, buildActivitySvg());

  const priorityCard = create('article', '', 'surface card-pad');
  priorityCard.append(create('h2', 'Priority Actions'));
  const dueLeads = leads.filter(l => leadStatus(l) === 'Follow-up due');
  const repliedLeads = leads.filter(l => leadStatus(l) === 'Replied' || leadStatus(l) === 'Interested');
  const missingEmailLeads = leads.filter(l => !l.email && l.website);

  const addActionRow = (title, meta, rightLabel, handler) => {
    const item = create('div', '', 'priority-row');
    const left = create('div', '', 'priority-left');
    const textWrap = create('div');
    textWrap.append(create('h4', title), create('p', meta));
    left.append(create('span', '', 'priority-dot'), textWrap);
    item.append(left, create('span', rightLabel, 'priority-time'));
    item.onclick = handler;
    priorityCard.append(item);
  };
  addActionRow(`Follow up with ${dueLeads.length} due lead${dueLeads.length === 1 ? '' : 's'}`, 'Scheduled reminders', 'Today', () => jumpToLeadsFilter('Follow-up due'));
  addActionRow(`Review ${repliedLeads.length} warm response${repliedLeads.length === 1 ? '' : 's'}`, 'Outreach inbox', 'Inbox', () => { location.hash = '#inbox'; });
  addActionRow(`Comb ${missingEmailLeads.length} website${missingEmailLeads.length === 1 ? '' : 's'} for emails`, 'Auto-enrichment queue', 'Run', () => { location.hash = '#leads'; enrichMissingEmails(); });
  addActionRow('Daily quota & tier usage', `${usage.searchesToday || 0} searches used today`, tierLabel, () => { location.hash = '#profile'; });

  midRow.append(activityCard, priorityCard);

  const botRow = create('div', '', 'dash-bot');
  const sourceCard = create('article', '', 'surface card-pad');
  sourceCard.append(create('h2', 'Source Breakdown'));
  const bingCount = leads.filter(l => (l.source || '').includes('bing.com')).length;
  const shopifyCount = leads.filter(l => l.platform === 'Shopify').length;
  const osmCount = leads.filter(l => (l.source || '').includes('openstreetmap')).length;
  const otherCount = Math.max(0, leads.length - bingCount - shopifyCount - osmCount);
  const segs = [
    { label: 'Bing Maps', count: bingCount, color: '#064e3b' },
    { label: 'Shopify Stores', count: shopifyCount, color: '#059669' },
    { label: 'OpenStreetMap', count: osmCount, color: '#60a5fa' },
    { label: 'CSV / Direct', count: otherCount || (leads.length === 0 ? 1 : 0), color: '#cbd5e1' }
  ];
  const totalForPct = Math.max(1, segs.reduce((s, x) => s + x.count, 0));
  const donutWrap = create('div', '', 'donut-wrap');
  const donutList = create('div', '', 'donut-list');
  segs.forEach(s => {
    const r = create('div', '', 'donut-row');
    const lbl = create('span');
    const dot = create('i'); dot.style.background = s.color;
    lbl.append(dot, document.createTextNode(s.label));
    r.append(lbl, create('strong', `${Math.round((s.count / totalForPct) * 100)}%`));
    donutList.append(r);
  });
  donutWrap.append(buildDonutSvg(segs), donutList);
  sourceCard.append(donutWrap);

  const recentCard = create('article', '', 'surface card-pad');
  const recHead = create('div', '', 'heading');
  recHead.style.margin = '0';
  recHead.append(create('h2', 'Recent Leads'), button('View All →', () => { location.hash = '#leads'; }, 'link-btn'));
  recentCard.append(recHead);
  if (leads.length) {
    for (const l of leads.slice(0, 4)) {
      const item = create('div', '', 'biz-mini');
      const left = create('div', '', 'biz-mini-left');
      const info = create('div');
      info.append(create('h4', l.name), create('p', [l.industry, l.city].filter(Boolean).join(' · ') || 'Saved business'));
      left.append(makeAvatar(l.name), info);
      item.append(left, create('span', leadStatus(l), statusPillClass(leadStatus(l))));
      item.onclick = () => openBusinessPage(l);
      recentCard.append(item);
    }
  } else {
    recentCard.append(empty('search', 'No saved leads yet', 'Search Bing Maps or inspect a Shopify URL to start building your pipeline.'));
  }
  botRow.append(sourceCard, recentCard);

  deskWrap.append(headerBar, kpiGrid, midRow, botRow);
  container.replaceChildren(mobWrap, deskWrap);
}

/* ---------------- FIND BUSINESSES (Figma Table + Pagination) ---------------- */
function getVisibleSearchResults() {
  const mode = $('#results-filter')?.value || '';
  if (mode === 'shopify') return results.filter(item => item.platform === 'Shopify');
  if (mode === 'ecommerce') return results.filter(item => item.platform === 'Shopify' || item.platform === 'WooCommerce');
  if (mode === 'low') return results.filter(item => (item.searchRank || 0) >= 21);
  return results;
}

function renderResults() {
  const visibleResults = getVisibleSearchResults();
  const unsavedCount = visibleResults.filter(item => !duplicate(item)).length;
  const saveAllBtn = $('#save-all');
  if (saveAllBtn) {
    saveAllBtn.hidden = visibleResults.length === 0;
    saveAllBtn.disabled = unsavedCount === 0;
    saveAllBtn.textContent = unsavedCount ? `Save all (${unsavedCount})` : 'All saved';
  }
  const withEmailCount = results.filter(item => item.email).length;
  const shopifyCount = results.filter(item => item.platform === 'Shopify').length;
  const countEl = $('#results-count');
  if (countEl) {
    countEl.textContent = results.length
      ? `(${visibleResults.length} shown · ${shopifyCount} Shopify · ${withEmailCount} with email)`
      : '';
  }

  const paginationEl = $('#results-pagination');
  if (!visibleResults.length) {
    if (paginationEl) paginationEl.hidden = true;
    if (results.length) {
      $('#results').replaceChildren(empty('search', 'No matching results for this filter', streamActive ? 'Still scanning websites in the background…' : 'Switch filter to view all scraped businesses.'));
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(visibleResults.length / pageSize));
  if (resultsPage > totalPages) resultsPage = totalPages;
  if (resultsPage < 1) resultsPage = 1;
  const startIndex = (resultsPage - 1) * pageSize;
  const pageItems = visibleResults.slice(startIndex, startIndex + pageSize);

  const wrap = create('div', '', 'data-table-wrap');
  const table = create('table', '', 'data-table');
  const thead = create('thead');
  thead.innerHTML = '<tr><th>Business</th><th>Industry &amp; Rank</th><th>Location</th><th>Website &amp; Email</th><th>Actions</th></tr>';
  const tbody = create('tbody');

  for (const item of pageItems) {
    const saved = duplicate(item);
    const tr = create('tr', '', 'clickable-row');
    tr.onclick = () => openBusinessPage(item);

    const tdBiz = create('td');
    const bizBox = create('div', '', 'cell-biz');
    const bizText = create('div');
    bizText.append(create('strong', item.name), create('small', item.phone || item.openHours || ''));
    bizBox.append(makeAvatar(item.name), bizText);
    tdBiz.append(bizBox);

    const tdInd = create('td');
    tdInd.append(create('div', item.industry || 'Local business'));
    const badges = create('div', '', 'actions');
    if (item.searchRank) badges.append(create('span', `Rank #${item.searchRank}`, item.searchRank >= 21 ? 'pill wait' : 'pill neutral'));
    if (item.platform && item.platform !== 'Custom / Website') badges.append(create('span', item.platform, 'pill'));
    tdInd.append(badges);

    const tdLoc = create('td', [item.city, item.address].filter(Boolean).join(' · ') || '—');

    const tdWeb = create('td');
    if (item.website) tdWeb.append(website(item.website, item.website.replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)));
    else tdWeb.append(create('span', 'No website', 'small'));
    const emailRow = create('div');
    if (item.email) emailRow.append(create('span', item.email, 'pill'));
    else if (item.scanning) emailRow.append(create('span', 'Scanning…', 'pill wait'));
    else emailRow.append(create('span', 'Needs email', 'pill wait'));
    tdWeb.append(emailRow);

    const tdAct = create('td');
    const actGroup = create('div', '', 'actions');
    actGroup.onclick = e => e.stopPropagation();
    const viewBtn = button(saved ? 'View' : 'Save & View', () => openBusinessPage(item), 'btn-soft');
    actGroup.append(viewBtn);
    if (!item.email && item.website && !item.scanning && !item.scanned) {
      actGroup.append(button('Comb', event => enrichItemEmail(item, event.currentTarget), true));
    }
    tdAct.append(actGroup);

    tr.append(tdBiz, tdInd, tdLoc, tdWeb, tdAct);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  $('#results').replaceChildren(wrap);

  renderPagination(paginationEl, resultsPage, totalPages, visibleResults.length, newPage => {
    resultsPage = newPage;
    renderResults();
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------------- SAVED LEADS (Figma KPI Grid + Clean Table) ---------------- */
function buildSearchFolderName(industry = '', city = '', rankMode = 'all') {
  const base = [String(industry).trim(), String(city).trim()].filter(Boolean).join(' · ') || 'Search Results';
  if (rankMode === 'shopify') return `${base} (Shopify)`;
  if (rankMode === 'low') return `${base} (Low-Ranked)`;
  return base;
}

function upsertLeadIntoFolder(item, folderName) {
  const existing = duplicate(item);
  if (existing) {
    if (folderName && !existing.folder) existing.folder = folderName;
    return false;
  }
  const copy = { ...item, id: item.id || crypto.randomUUID(), folder: folderName || item.folder || '', savedAt: Date.now(), threads: [] };
  delete copy.scanning;
  delete copy.scanned;
  leads.unshift(copy);
  return true;
}

function scheduleAutoPersist(immediate = false) {
  if (autoPersistTimer) { clearTimeout(autoPersistTimer); autoPersistTimer = null; }
  if (immediate) {
    persist();
    return;
  }
  autoPersistTimer = setTimeout(() => {
    autoPersistTimer = null;
    persist();
  }, 1200);
}

function getFilteredLeads() {
  const query = norm($('#filter-query')?.value || $('#global-search')?.value);
  const statusFilter = $('#filter-status')?.value || '';
  const platformFilter = $('#filter-platform')?.value || '';
  const sortOrder = $('#filter-sort')?.value || 'recent';

  const filtered = leads.filter(lead => {
    const folderLabel = (lead.folder || '').trim() || 'General / Manual';
    if (selectedLeadFolder && folderLabel !== selectedLeadFolder) return false;
    const status = leadStatus(lead);
    if (statusFilter && status !== statusFilter) return false;
    if (platformFilter && (lead.platform || '') !== platformFilter) return false;
    if (!query) return true;
    const haystack = [lead.name, lead.industry, lead.city, lead.email, lead.phone, lead.address, lead.about, lead.platform, lead.folder]
      .map(norm)
      .join(' ');
    return haystack.includes(query);
  });

  if (sortOrder === 'name') {
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortOrder === 'due') {
    filtered.sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  }
  return filtered;
}

function deleteLead(lead) {
  const idx = leads.findIndex(item => item.id === lead.id);
  if (idx === -1) return;
  leads.splice(idx, 1);
  if (activeBusinessId === lead.id) {
    activeBusinessId = leads[idx]?.id || leads[idx - 1]?.id || null;
    if (!activeBusinessId && location.hash === '#business') location.hash = '#leads';
  }
  persist();
  if (results.length) renderResults();
  report(`Removed ${lead.name} from saved leads.`);
}

function renderLeads() {
  const missingWithWebsite = leads.filter(lead => !lead.email && lead.website).length;
  const enrichAllBtn = $('#enrich-all');
  if (enrichAllBtn) {
    enrichAllBtn.disabled = enrichingAll || missingWithWebsite === 0;
    enrichAllBtn.textContent = enrichingAll
      ? 'Finding emails…'
      : missingWithWebsite
        ? `Find missing emails (${missingWithWebsite})`
        : 'Find missing emails';
  }
  const exportBtn = $('#export');
  if (exportBtn) exportBtn.disabled = leads.length === 0;

  const kpiGrid = $('#leads-kpi-grid');
  if (kpiGrid) {
    const withEmail = leads.filter(l => l.email).length;
    const verifiedPct = leads.length ? Math.round((withEmail / leads.length) * 100) : 0;
    const inPipeline = leads.filter(l => (l.threads?.length || 0) > 0 || l.replied).length;
    const makeKpi = (icoName, val, lbl, filterVal, amber = false) => {
      const card = create('article', '', 'surface kpi-card');
      const ico = create('div', '', 'kpi-ico' + (amber ? ' amber' : ''));
      ico.append(iconEl(icoName, 24));
      card.append(ico, create('strong', String(val)), create('small', lbl));
      card.onclick = () => { $('#filter-status').value = filterVal; leadsPage = 1; renderLeads(); };
      return card;
    };
    kpiGrid.replaceChildren(
      makeKpi('users', leads.length, 'Total Saved', ''),
      makeKpi('star', `${verifiedPct}%`, 'Verified Rate', 'New', true),
      makeKpi('mail', withEmail, 'With Email', 'New'),
      makeKpi('folder', inPipeline, 'In Pipeline', 'Contacted')
    );
  }

  // Render Saved Search Folders bar
  const foldersEl = $('#leads-folders');
  if (foldersEl) {
    const folderMap = new Map();
    for (const l of leads) {
      const fName = (l.folder || '').trim() || 'General / Manual';
      const entry = folderMap.get(fName) || { name: fName, count: 0, latest: 0 };
      entry.count++;
      entry.latest = Math.max(entry.latest, Number(l.savedAt) || 0);
      folderMap.set(fName, entry);
    }
    const folderList = [...folderMap.values()].sort((a, b) => b.latest - a.latest);
    if (selectedLeadFolder && !folderMap.has(selectedLeadFolder)) selectedLeadFolder = '';

    if (folderList.length > 0) {
      foldersEl.hidden = false;
      const fHead = create('div', '', 'folders-head');
      const fTitle = create('strong');
      fTitle.append(iconEl('folder', 15), document.createTextNode(`Search Folders (${folderList.length})`));
      fHead.append(fTitle, create('span', 'Every search from Find Businesses is automatically saved into its own folder.', 'small'));

      const fGrid = create('div', '', 'folders-grid');
      const allChip = create('button', '', 'folder-chip' + (!selectedLeadFolder ? ' active' : ''));
      allChip.type = 'button';
      allChip.append(iconEl('folder', 14), document.createTextNode('All Leads'), create('span', String(leads.length), 'folder-cnt'));
      allChip.onclick = () => { selectedLeadFolder = ''; leadsPage = 1; renderLeads(); };
      fGrid.append(allChip);

      for (const f of folderList) {
        const chip = create('button', '', 'folder-chip' + (selectedLeadFolder === f.name ? ' active' : ''));
        chip.type = 'button';
        chip.append(iconEl('folder', 14), document.createTextNode(f.name), create('span', String(f.count), 'folder-cnt'));
        chip.onclick = () => { selectedLeadFolder = f.name; leadsPage = 1; renderLeads(); };
        fGrid.append(chip);
      }
      foldersEl.replaceChildren(fHead, fGrid);
    } else {
      foldersEl.hidden = true;
    }
  }

  const filtered = getFilteredLeads();
  const summary = $('#lead-summary');
  if (summary) {
    if (!leads.length) {
      summary.textContent = 'No saved leads yet.';
    } else if (selectedLeadFolder) {
      const metaBar = create('div', '', 'table-meta-bar');
      metaBar.append(create('span', `Folder "${selectedLeadFolder}" · Showing ${filtered.length} lead${filtered.length === 1 ? '' : 's'} — click any business row to open its full dossier.`));
      const metaActs = create('div', '', 'actions');
      metaActs.append(
        button('Show All Folders', () => { selectedLeadFolder = ''; leadsPage = 1; renderLeads(); }, true),
        button('Delete Folder', () => {
          const toDelete = selectedLeadFolder;
          const before = leads.length;
          leads = leads.filter(l => ((l.folder || '').trim() || 'General / Manual') !== toDelete);
          const removed = before - leads.length;
          selectedLeadFolder = '';
          leadsPage = 1;
          persist();
          report(`Deleted folder "${toDelete}" (${removed} lead${removed === 1 ? '' : 's'} removed).`);
        }, 'danger')
      );
      metaBar.append(metaActs);
      summary.replaceChildren(metaBar);
    } else {
      summary.textContent = `Showing ${filtered.length} of ${leads.length} saved lead${leads.length === 1 ? '' : 's'} — click any business row to open its full dossier.`;
    }
  }

  const leadsPaginationEl = $('#leads-pagination');
  if (!filtered.length) {
    if (leadsPaginationEl) leadsPaginationEl.hidden = true;
    $('#lead-list').replaceChildren(empty('bookmark', leads.length ? 'No matching leads' : 'No leads yet',
      leads.length ? 'Try clearing or changing your search and status filters.' : 'Save a business from Find Businesses or add a contact manually.'));
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  if (leadsPage > totalPages) leadsPage = totalPages;
  if (leadsPage < 1) leadsPage = 1;
  const pageLeads = filtered.slice((leadsPage - 1) * pageSize, leadsPage * pageSize);

  const wrap = create('div', '', 'data-table-wrap');
  const table = create('table', '', 'data-table');
  const thead = create('thead');
  thead.innerHTML = '<tr><th>Business</th><th>Industry</th><th>Status</th><th>Platform / Source</th><th>Actions</th></tr>';
  const tbody = create('tbody');

  for (const lead of pageLeads) {
    const status = leadStatus(lead);
    const tr = create('tr', '', 'clickable-row');
    tr.onclick = () => openBusinessPage(lead);

    const tdBiz = create('td');
    const bizBox = create('div', '', 'cell-biz');
    const bizText = create('div');
    bizText.append(
      create('strong', lead.name),
      create('small', [lead.city, lead.email || 'No email', lead.phone].filter(Boolean).join(' · '))
    );
    bizBox.append(makeAvatar(lead.name), bizText);
    tdBiz.append(bizBox);

    const tdInd = create('td', lead.industry || '—');

    const tdStatus = create('td');
    tdStatus.append(create('span', status, statusPillClass(status)));
    if (lead.aiBrief) {
      const aiPill = create('span', '', 'pill');
      aiPill.append(iconEl('sparkles', 12), document.createTextNode('AI Pitch'));
      tdStatus.append(aiPill);
    }

    const tdPlat = create('td');
    const platWrap = create('div', '', 'actions');
    if (lead.platform && lead.platform !== 'Custom / Website') platWrap.append(create('span', lead.platform, 'pill neutral'));
    else platWrap.append(create('span', (lead.source || '').includes('bing') ? 'Bing Maps' : 'Workspace', 'small'));
    if (lead.folder && !selectedLeadFolder) {
      const fPill = create('span', '', 'pill neutral');
      fPill.append(iconEl('folder', 11), document.createTextNode(lead.folder));
      platWrap.append(fPill);
    }
    tdPlat.append(platWrap);

    const tdAct = create('td');
    const actGroup = create('div', '', 'actions');
    actGroup.onclick = e => e.stopPropagation();
    actGroup.append(
      button('View', () => openBusinessPage(lead), 'btn-soft'),
      button('Email', () => compose(lead)),
      button('Edit', () => editLead(lead), true),
      button('Delete', () => deleteLead(lead), 'danger')
    );
    tdAct.append(actGroup);

    tr.append(tdBiz, tdInd, tdStatus, tdPlat, tdAct);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  $('#lead-list').replaceChildren(wrap);

  renderPagination(leadsPaginationEl, leadsPage, totalPages, filtered.length, newPage => {
    leadsPage = newPage;
    renderLeads();
    $('#lead-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------------- BUSINESS DOSSIER (Figma Tabbed Layout) ---------------- */
function kvItem(label, valueNodeOrText) {
  const box = create('div', '', 'kv-item');
  box.append(create('small', label));
  const val = create('div');
  if (valueNodeOrText instanceof Node) val.append(valueNodeOrText);
  else val.textContent = valueNodeOrText || 'Not listed';
  box.append(val);
  return box;
}

function buildSparklineSvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 220 56');
  svg.setAttribute('class', 'chart-svg');
  svg.innerHTML = '<defs><linearGradient id="spGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#059669" stop-opacity="0.22"/><stop offset="100%" stop-color="#059669" stop-opacity="0"/></linearGradient></defs>'
    + '<path d="M4,46 L38,38 L72,41 L108,26 L146,30 L182,14 L216,10 L216,54 L4,54 Z" fill="url(#spGrad)"/>'
    + '<polyline fill="none" stroke="#059669" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="4,46 38,38 72,41 108,26 146,30 182,14 216,10"/>';
  return svg;
}

function renderBusinessPage() {
  const container = $('#business-detail');
  if (!container) return;
  const currentIndex = leads.findIndex(item => item.id === activeBusinessId);
  const lead = currentIndex !== -1 ? leads[currentIndex] : leads[0];
  if (!lead) {
    container.replaceChildren(
      empty('building', 'No business selected', 'Choose a business from Saved Leads or Find Businesses to open its Business Dossier.')
    );
    return;
  }
  const leadIndex = currentIndex !== -1 ? currentIndex : 0;
  activeBusinessId = lead.id;

  const status = leadStatus(lead);
  const navBar = create('div', '', 'heading');
  const queueLeft = create('div', '', 'actions');
  const backBtn = btnWithIcon('chevronLeft', 'Saved Leads', () => { location.hash = '#leads'; }, true);
  const prevBtn = button('Prev', () => { if (leadIndex > 0) { activeBusinessId = leads[leadIndex - 1].id; renderBusinessPage(); } }, true);
  prevBtn.disabled = leadIndex <= 0;
  const nextBtn = button(`Next (${leadIndex + 1}/${leads.length})`, () => { if (leadIndex < leads.length - 1) { activeBusinessId = leads[leadIndex + 1].id; renderBusinessPage(); } }, true);
  nextBtn.disabled = leadIndex >= leads.length - 1;
  queueLeft.append(backBtn, prevBtn, nextBtn);

  const queueRight = create('div', '', 'actions');
  if (lead.website) queueRight.append(btnWithIcon('refresh', 'Comb Site', event => enrichItemEmail(lead, event.currentTarget), 'btn-soft'));
  queueRight.append(
    btnWithIcon('mail', 'Draft Email', () => compose(lead)),
    button('Delete', () => deleteLead(lead), 'danger')
  );
  navBar.append(queueLeft, queueRight);

  // Header Split Grid (Hero Card + Contact Info Card)
  const headerGrid = create('div', '', 'dossier-header-grid');
  const heroCard = create('article', '', 'surface dossier-hero-card');
  const heroText = create('div', '', 'stack');
  heroText.style.gap = '6px';
  const pills = create('div', '', 'actions');
  pills.append(create('span', status, statusPillClass(status)));
  if (lead.platform && lead.platform !== 'Custom / Website') pills.append(create('span', lead.platform, 'pill'));
  if (lead.industry) pills.append(create('span', lead.industry, 'pill neutral'));
  if (lead.searchRank) pills.append(create('span', `Bing Rank #${lead.searchRank}`, 'pill wait'));
  const h1 = create('h1', lead.name);
  h1.style.margin = '0';
  h1.style.fontSize = '24px';
  heroText.append(h1, create('p', lead.siteTitle || lead.about || 'Saved Business Prospect', 'small'), pills);
  heroCard.append(makeAvatar(lead.name, true), heroText);

  const contactCard = create('article', '', 'surface dossier-card');
  contactCard.append(create('h2', 'Contact Information'));
  const cList = create('div', '', 'stack');
  cList.style.gap = '9px';
  const addContactLine = (icoName, contentNodeOrText) => {
    const row = create('div', '', 'contact-line');
    row.append(iconEl(icoName, 16));
    if (contentNodeOrText instanceof Node) row.append(contentNodeOrText);
    else row.append(document.createTextNode(contentNodeOrText));
    cList.append(row);
  };
  addContactLine('mail', lead.email || 'Needs email');
  addContactLine('phone', lead.phone || 'No phone listed');
  addContactLine('mapPin', [lead.address, lead.city].filter(Boolean).join(', ') || 'Location not listed');
  addContactLine('globe', website(lead.website, lead.website) || 'No website listed');
  contactCard.append(cList);
  headerGrid.append(heroCard, contactCard);

  // Sub-Navigation Tabs
  const tabsBar = create('div', '', 'dossier-tabs');
  const tabDefs = [
    ['overview', 'Overview'],
    ['tech', 'Tech Stack'],
    ['socials', 'Social Links'],
    ['insights', 'Insights & History'],
    ['ai', 'AI Analysis']
  ];
  for (const [key, label] of tabDefs) {
    const t = create('button', label, 'dossier-tab' + (dossierTab === key ? ' active' : ''));
    t.type = 'button';
    t.onclick = () => { dossierTab = key; renderBusinessPage(); };
    tabsBar.append(t);
  }

  const contentWrap = create('div');

  if (dossierTab === 'overview') {
    // Figma 3-Column Overview Grid (Company Overview | Website Insights | AI Lead Intelligence)
    const ov3 = create('div', '', 'dossier-overview-grid');

    const ovCard = create('article', '', 'surface dossier-card');
    ovCard.append(create('h2', 'Company Overview'));
    ovCard.append(create('p', lead.aboutSummary || lead.about || 'Click "Comb Site" above to crawl this business website and extract positioning, tech stack, and email details.', 'small'));
    const highlights = create('ul', '', 'check-list');
    const hlItems = [
      lead.industry && `Industry: ${lead.industry}`,
      lead.city && `Market: ${lead.city}`,
      lead.platform && `Platform: ${lead.platform}`,
      lead.searchRank && `Search Visibility: Bing Rank #${lead.searchRank}`
    ].filter(Boolean);
    (hlItems.length ? hlItems : ['Saved in your Jobhunta pipeline']).forEach(txt => {
      const li = create('li');
      li.append(iconEl('check', 15), document.createTextNode(txt));
      highlights.append(li);
    });
    ovCard.append(highlights);

    const insCard = create('article', '', 'surface dossier-card');
    insCard.append(create('h2', 'Website Insights'));
    insCard.append(buildSparklineSvg());
    const sig = lead.signals || {};
    const insRows = create('div', '', 'stack');
    insRows.style.gap = '6px';
    const addStat = (k, v) => {
      const r = create('div', '', 'stat-row');
      r.style.padding = '5px 0';
      r.append(create('span', k, 'small'), create('strong', v));
      insRows.append(r);
    };
    addStat('SSL / HTTPS', lead.website ? ((sig.https ?? lead.website.startsWith('https://')) ? 'Active' : 'Missing') : 'No site');
    addStat('Platform', lead.platform || 'Not combed');
    addStat('Tech Apps', String(lead.techStack?.length || 0));
    insCard.append(insRows);

    const aiCard = create('article', '', 'surface dossier-card');
    const aiTop = create('div', '', 'heading');
    aiTop.style.margin = '0';
    const oppPill = create('span', '', 'pill');
    oppPill.append(iconEl('star', 12), document.createTextNode(lead.aiBrief ? 'High Opportunity' : 'Ready for AI'));
    aiTop.append(create('h2', 'AI Lead Intelligence'), oppPill);
    aiCard.append(aiTop);
    const aiBullets = create('ul', '', 'check-list');
    const points = lead.aiBrief?.gaps?.slice(0, 3) || [
      !lead.email ? 'No public email extracted yet — comb site to uncover contacts.' : 'Verified email contact ready for 1-to-1 outreach.',
      lead.searchRank >= 21 ? `Low search rank (#${lead.searchRank}) — strong SEO & conversion pitch.` : 'Active local listing — tailor pitch to their website gaps.',
      'Click "AI Analysis" tab to generate a full custom brief.'
    ];
    points.forEach(p => {
      const li = create('li');
      li.append(iconEl('sparkles', 14), document.createTextNode(p));
      aiBullets.append(li);
    });
    aiCard.append(aiBullets);

    ov3.append(ovCard, insCard, aiCard);

    // Figma Full-Width Soft-Mint Outreach Pitch Preview Banner
    const pitchBanner = create('div', '', 'pitch-banner');
    const pitchCopy = create('div', '', 'pitch-banner-copy');
    const pitchTitle = create('h3');
    pitchTitle.append(iconEl('sparkles', 16), document.createTextNode('Outreach Pitch Preview'));
    const previewBody = lead.aiBrief?.pitchBody || interpolateTemplate(settings.templates[0]?.body || '', lead);
    const previewSubj = lead.aiBrief?.pitchSubject || interpolateTemplate(settings.templates[0]?.subject || '', lead);
    pitchCopy.append(pitchTitle, create('p', previewBody.slice(0, 260) + (previewBody.length > 260 ? '…' : '')));
    const pitchActs = create('div', '', 'actions');
    pitchActs.append(
      btnWithIcon('copy', 'Copy Pitch', async e => {
        try {
          await navigator.clipboard.writeText(`${previewSubj}\n\n${previewBody}`);
          report('Copied outreach pitch to clipboard.');
        } catch {}
      }, true),
      btnWithIcon('mail', 'Draft Email', () => compose(lead, null, null, lead.aiBrief ? { subject: previewSubj, body: previewBody } : null))
    );
    pitchBanner.append(pitchCopy, pitchActs);

    // Auto-Saving Quick CRM Controls
    const crmCard = create('article', '', 'surface dossier-card');
    crmCard.append(create('h2', 'Quick CRM Controls (Auto-Saves)'));
    const crmGrid = create('div', '', 'grid-2');
    const statusSelect = selectField('Lead Status', 'classification', { '': `Automatic (${status})`, ...statusNames }, lead.classification || '');
    statusSelect.lastChild.onchange = e => { lead.classification = e.target.value; persist(); report('Updated lead status.'); };
    const dueField = field('Follow-up Date', 'due', lead.due, { type: 'date' });
    dueField.lastChild.onchange = e => { lead.due = e.target.value; persist(); report('Updated follow-up date.'); };
    const emailInline = field('Primary Outreach Email', 'email', lead.email, { type: 'email', placeholder: 'Add email…' });
    emailInline.lastChild.onchange = e => { lead.email = e.target.value.trim(); persist(); report('Updated email.'); };
    const notesField = field('Review Notes', 'about', lead.about, { type: 'textarea', maxLength: 6000, placeholder: 'Observations or call notes…' });
    notesField.lastChild.style.minHeight = '76px';
    notesField.lastChild.onchange = e => { lead.about = e.target.value.trim(); persist(); report('Saved notes.'); };
    crmGrid.append(emailInline, statusSelect, dueField, notesField);
    crmCard.append(crmGrid);

    contentWrap.append(ov3, pitchBanner, crmCard);
  } else {
    const tabBody = create('div', '', 'dossier-grid');
    if (dossierTab === 'tech') {
      const platCard = create('article', '', 'surface dossier-card');
      platCard.append(create('h2', 'Platform & Tech Stack'));
      platCard.append(
        kvItem('Detected Platform', lead.platform || 'Not scanned yet'),
        kvItem('Installed Apps & Pixels', lead.techStack?.length ? lead.techStack.join(' • ') : 'None detected yet')
      );
      if (lead.shopifyMeta) {
        platCard.append(kvItem('Shopify Store Details', [
          lead.shopifyMeta.myshopifyDomain,
          lead.shopifyMeta.themeName && `Theme: ${lead.shopifyMeta.themeName}`,
          lead.shopifyMeta.currency && `Currency: ${lead.shopifyMeta.currency}`
        ].filter(Boolean).join(' · ')));
      }

      const prodCard = create('article', '', 'surface dossier-card');
      prodCard.append(create('h2', 'Shopify Product Catalog Sample'));
      if (lead.shopifyProducts?.length) {
        const list = create('ul');
        for (const p of lead.shopifyProducts) {
          list.append(create('li', `${p.title}${p.type ? ` (${p.type})` : ''}${p.price ? ` — $${p.price}` : ''}`));
        }
        prodCard.append(list);
      } else {
        prodCard.append(create('p', 'No Shopify /products.json catalog found (or website not combed yet).', 'small'));
      }
      tabBody.append(platCard, prodCard);
    } else if (dossierTab === 'socials') {
      const webCard = create('article', '', 'surface dossier-card');
      webCard.append(create('h2', 'Website & Social Media Combing'));
      const webUrlForm = create('form', '', 'inline-bar');
      const webInput = field('Business Website URL', 'websiteUrl', lead.website, { type: 'url', placeholder: 'https://example.com' });
      const combBtn = create('button', lead.website ? 'Comb Website' : 'Save & Comb');
      webUrlForm.append(webInput, combBtn);
      webUrlForm.onsubmit = async event => {
        event.preventDefault();
        let urlVal = webInput.lastChild.value.trim();
        if (urlVal && !/^https?:\/\//i.test(urlVal)) urlVal = 'https://' + urlVal;
        lead.website = urlVal;
        persist();
        if (urlVal) await enrichItemEmail(lead, combBtn);
      };
      const foundSocials = socialLinks(lead);
      const socialsRow = create('div', '', 'actions');
      if (foundSocials.length) socialsRow.append(...foundSocials);
      else socialsRow.append(create('span', 'No social media links discovered yet.', 'small'));
      webCard.append(webUrlForm, create('small', 'DISCOVERED SOCIAL LINKS', 'small'), socialsRow);

      const sigCard = create('article', '', 'surface dossier-card');
      sigCard.append(create('h2', 'Digital Presence Signals & Missing Gaps'));
      const sig = lead.signals || {};
      const signalList = create('div', '', 'signal-list');
      const addSig = (label, ok) => {
        if (ok === undefined) return;
        const p = create('span', '', ok ? 'pill' : 'pill warn');
        p.append(iconEl(ok ? 'check' : 'x', 13), document.createTextNode(ok ? label : `Missing: ${label}`));
        signalList.append(p);
      };
      if (lead.website) {
        addSig('HTTPS Security', sig.https ?? lead.website.startsWith('https://'));
        addSig('SEO Meta Description', sig.hasMetaDescription);
        addSig('Booking / Lead Form', sig.hasBookingOrForm);
        addSig('Live Chat / WhatsApp', sig.hasChatWidget);
        addSig('Analytics / Ad Pixel', sig.hasAnalytics);
        addSig('Product Reviews App', sig.hasReviewsApp);
      } else {
        addSig('Official Website', false);
      }
      if (!lead.email) addSig('Public Email', false);
      sigCard.append(signalList);
      tabBody.append(webCard, sigCard);
    } else if (dossierTab === 'insights') {
      const metaCard = create('article', '', 'surface dossier-card');
      metaCard.append(create('h2', 'Scraped Listing Metadata'));
      const kv = create('div', '', 'kv-grid');
      kv.append(
        kvItem('Star Rating & Reviews', [lead.rating && `${lead.rating} / 5`, lead.ratingInfo].filter(Boolean).join(' · ') || 'None'),
        kvItem('Bing Search Rank', lead.searchRank ? `Rank #${lead.searchRank} (Page ${lead.searchPage || 1})` : 'Direct / Manual'),
        kvItem('Operating Hours', lead.openHours || 'Not listed'),
        kvItem('Coordinates', (lead.latitude && lead.longitude) ? `${lead.latitude}, ${lead.longitude}` : 'Not listed'),
        kvItem('All Discovered Emails', [...new Set([lead.email, ...(lead.emails || [])].filter(Boolean))].join(', ') || 'None'),
        kvItem('Listing Source', website(lead.source, 'Open Listing') || 'Manual')
      );
      metaCard.append(kv);

      const histCard = create('article', '', 'surface dossier-card');
      histCard.append(create('h2', 'Outreach Conversations'));
      if (lead.threads?.length) {
        for (const conv of lead.threads) {
          const item = create('div', '', 'biz-mini');
          const info = create('div');
          info.append(create('h4', conv.subject), create('p', `To: ${conv.to || lead.email} · ${new Date(conv.time).toLocaleDateString()}`));
          item.append(info, button('Open in Inbox', () => { selectedInboxKey = threadKey(conv); location.hash = '#inbox'; }, 'btn-soft'));
          histCard.append(item);
        }
      } else {
        histCard.append(create('p', 'No outreach emails sent to this business yet.', 'small'));
      }
      tabBody.append(metaCard, histCard);
    } else if (dossierTab === 'ai') {
      const aiCard = create('article', '', 'surface dossier-card full ai-panel');
      const aiHeader = create('div', '', 'heading');
      aiHeader.style.margin = '0';

      const issuesBox = create('div', '', 'issues-prompt-box');
      const issuesField = field(
        'Issues You Spotted on Their Site / Listing (Optional — included in AI email)',
        'userSpottedIssues',
        lead.userSpottedIssues || '',
        {
          type: 'textarea',
          maxLength: 2000,
          placeholder: 'e.g. Slow mobile checkout, broken contact form, outdated homepage banner, no Google review replies… (one per line)'
        }
      );
      issuesField.lastChild.onchange = e => {
        lead.userSpottedIssues = e.target.value.trim();
        persist();
      };
      const issuesHint = create('small', 'Tip: If you personally noticed any issues or quick wins, list them above so the AI highlights them and writes a detailed lead-generation email.', 'small');
      issuesBox.append(issuesField, issuesHint);

      const genBtn = btnWithIcon('sparkles', lead.aiBrief ? 'Regenerate AI Analysis & Email' : 'Generate AI Lead Brief & Email', async event => {
        const btn = event.currentTarget;
        const userIssues = issuesField.lastChild.value.trim();
        lead.userSpottedIssues = userIssues;
        btn.disabled = true;
        btn.textContent = 'Analyzing business…';
        try {
          if (lead.website && !lead.aboutSummary && !lead.scanned) {
            try {
              const enriched = await api('/api/enrich', { website: lead.website });
              lead.scanned = true;
              applyEnrichmentToItem(lead, enriched);
            } catch {}
          }
          lead.aiBrief = await api('/api/analyze', { lead, userIssues });
          persist();
          report(`Generated detailed AI lead brief & email for ${lead.name}.`);
        } catch (error) {
          report(error.message, true);
          btn.disabled = false;
          btn.replaceChildren(iconEl('sparkles', 15), document.createTextNode('Generate AI Lead Brief & Email'));
        }
      });
      aiHeader.append(create('h2', 'AI Lead Intelligence & Professional Pitch'), genBtn);
      aiCard.append(aiHeader, issuesBox);

      if (lead.aiBrief) {
        const ovSec = create('div', '', 'ai-section');
        ovSec.append(create('h3', 'Business Positioning & Overview'), create('p', lead.aiBrief.overview));
        const gapsSec = create('div', '', 'ai-section');
        gapsSec.append(create('h3', 'Issues Found & Growth Opportunities'));
        const ul = create('ul');
        for (const g of lead.aiBrief.gaps || []) ul.append(create('li', g));
        gapsSec.append(ul);
        const angSec = create('div', '', 'ai-section');
        angSec.append(create('h3', 'Recommended Strategy'), create('p', lead.aiBrief.angle));
        const pitchSec = create('div', '', 'ai-section stack');
        pitchSec.append(
          create('h3', 'Detailed Lead-Generation Email Preview'),
          create('strong', 'Subject: ' + lead.aiBrief.pitchSubject),
          create('div', lead.aiBrief.pitchBody, 'pitch-preview'),
          btnWithIcon('mail', 'Use this email & Attach Files / Send', () => compose(lead, null, null, { subject: lead.aiBrief.pitchSubject, body: lead.aiBrief.pitchBody }))
        );
        aiCard.append(ovSec, gapsSec, angSec, pitchSec);
      } else {
        aiCard.append(empty('sparkles', 'Ready to analyze ' + lead.name, 'Optionally list any issues you spotted above, then click "Generate AI Lead Brief & Email" to craft a detailed outreach email.'));
      }
      tabBody.append(aiCard);
    }
    contentWrap.append(tabBody);
  }

  container.replaceChildren(navBar, headerGrid, tabsBar, contentWrap);
}

/* ---------------- EMAIL BROADCAST (Figma Email Broadcast) ---------------- */
function getBroadcastAudienceLeads(type) {
  if (type === 'new') return leads.filter(l => l.email && !blocked(l.email) && !(l.threads?.length));
  if (type === 'due') return leads.filter(l => l.email && !blocked(l.email) && leadStatus(l) === 'Follow-up due');
  if (type === 'shopify') return leads.filter(l => l.email && !blocked(l.email) && l.platform === 'Shopify');
  return leads.filter(l => l.email && !blocked(l.email));
}

function editTemplateModal(tpl = null) {
  const form = create('form', '', 'stack');
  const nameInput = field('Template Name', 'name', tpl?.name || '', { required: true, maxLength: 80, placeholder: 'e.g. Initial Introduction' });
  const descInput = field('Short Description', 'desc', tpl?.desc || '', { maxLength: 140, placeholder: 'e.g. Introduce your service to a new local lead' });
  const subjInput = field('Email Subject', 'subject', tpl?.subject || 'Quick introduction to {{business_name}}', { required: true, maxLength: 160 });
  const bodyInput = field('Email Body (supports {{business_name}}, {{city}}, {{industry}}, {{your_name}}, {{your_service}})', 'body', tpl?.body || 'Hi {{business_name}} team,\n\nI’m {{your_name}}...\n\nThanks,\n{{your_name}}', { type: 'textarea', required: true, maxLength: 16000 });
  bodyInput.lastChild.style.minHeight = '160px';

  const acts = create('div', '', 'actions');
  acts.append(create('button', tpl ? 'Save Template' : 'Create Template'));
  if (tpl && settings.templates.length > 1) {
    acts.append(button('Delete Template', () => {
      const idx = settings.templates.findIndex(t => t.id === tpl.id);
      if (idx !== -1) {
        settings.templates.splice(idx, 1);
        if (selectedBroadcastTplId === tpl.id) selectedBroadcastTplId = settings.templates[0]?.id || '';
        persist();
        dialog.close();
        report(`Deleted template "${tpl.name}".`);
      }
    }, 'danger'));
  }

  form.append(nameInput, descInput, subjInput, bodyInput, acts);
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v.trim()]));
    if (!values.name || !values.subject || !values.body) return;
    if (tpl) {
      Object.assign(tpl, values);
      report(`Updated template "${tpl.name}".`);
    } else {
      const created = { id: crypto.randomUUID(), ...values };
      settings.templates.push(created);
      selectedBroadcastTplId = created.id;
      report(`Created template "${created.name}".`);
    }
    persist();
    dialog.close();
  };
  show(tpl ? `Edit Template: ${tpl.name}` : 'New Email Template', form);
}

function renderBroadcast() {
  const container = $('#broadcast-content');
  if (!container) return;

  const top = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(create('h1', 'Email Broadcast'), create('p', 'Manage your email template cards and send personalised 1-to-1 Gmail campaigns.'));
  top.append(titleWrap, btnWithIcon('plus', 'New Template', () => editTemplateModal(null)));

  const grid = create('div', '', 'broadcast-grid');

  // Left: Email Templates as rich interactive cards
  const leftCard = create('article', '', 'surface card-pad');
  const leftHead = create('div', '', 'heading');
  leftHead.style.margin = '0';
  leftHead.append(create('h2', `Email Templates (${settings.templates.length})`), btnWithIcon('plus', 'Add', () => editTemplateModal(null), 'btn-soft', 14));
  leftCard.append(leftHead);

  const tplList = create('div', '', 'stack');
  const currentTpl = settings.templates.find(t => t.id === selectedBroadcastTplId) || settings.templates[0];
  selectedBroadcastTplId = currentTpl.id;
  const tplStyles = [
    ['fileText', 'mint'],
    ['sparkles', 'blue'],
    ['megaphone', 'amber']
  ];

  settings.templates.forEach((tpl, idx) => {
    const [icoName, colorClass] = tplStyles[idx % tplStyles.length];
    const isActive = tpl.id === selectedBroadcastTplId;
    const card = create('article', '', 'tpl-card' + (isActive ? ' active' : ''));
    card.onclick = () => { selectedBroadcastTplId = tpl.id; renderBroadcast(); };

    const head = create('div', '', 'tpl-card-head');
    const left = create('div', '', 'tpl-pick-left');
    const badge = create('div', '', `tpl-badge ${colorClass}`);
    badge.append(iconEl(icoName, 19));
    const textWrap = create('div');
    textWrap.style.minWidth = '0';
    textWrap.append(create('strong', tpl.name), create('div', tpl.subject, 'tpl-subj'));
    left.append(badge, textWrap);
    head.append(left);
    if (isActive) {
      const selPill = create('span', '', 'pill');
      selPill.append(iconEl('check', 12), document.createTextNode('Selected'));
      head.append(selPill);
    }

    const snippet = create('p', tpl.desc || tpl.body.replace(/\s+/g, ' ').slice(0, 130), 'tpl-snippet');

    const foot = create('div', '', 'tpl-card-foot');
    const footActs = create('div', '', 'actions');
    footActs.onclick = e => e.stopPropagation();
    footActs.append(
      button(isActive ? 'Active in Composer' : 'Use Template', () => { selectedBroadcastTplId = tpl.id; renderBroadcast(); }, isActive ? 'btn-soft' : true),
      button('Edit', () => editTemplateModal(tpl), true)
    );
    if (settings.templates.length > 1) {
      footActs.append(button('Delete', () => {
        settings.templates.splice(idx, 1);
        if (selectedBroadcastTplId === tpl.id) selectedBroadcastTplId = settings.templates[0]?.id || '';
        persist();
        report(`Deleted template "${tpl.name}".`);
      }, 'danger'));
    }
    foot.append(footActs);

    card.append(head, snippet, foot);
    tplList.append(card);
  });
  leftCard.append(tplList);

  // Right: Create Campaign
  const rightCard = create('article', '', 'surface card-pad');
  rightCard.append(create('h2', 'Create Campaign'));

  const tplSelect = selectField('Select Template', 'tpl', Object.fromEntries(settings.templates.map(t => [t.id, t.name])), selectedBroadcastTplId);
  tplSelect.lastChild.onchange = e => { selectedBroadcastTplId = e.target.value; renderBroadcast(); };

  const allVerified = getBroadcastAudienceLeads('verified');
  const newOnly = getBroadcastAudienceLeads('new');
  const dueOnly = getBroadcastAudienceLeads('due');
  const shopifyOnly = getBroadcastAudienceLeads('shopify');

  const audSelect = selectField('Recipients', 'audience', {
    verified: `All Verified Leads (${allVerified.length})`,
    new: `Ready to Email / Not Contacted (${newOnly.length})`,
    due: `Follow-up Due Leads (${dueOnly.length})`,
    shopify: `Shopify Stores with Email (${shopifyOnly.length})`
  }, broadcastAudience);
  audSelect.lastChild.onchange = e => { broadcastAudience = e.target.value; renderBroadcast(); };

  const targetLeads = getBroadcastAudienceLeads(broadcastAudience);
  const sampleLead = targetLeads[0] || { name: 'TechCorp Solutions', city: 'Lagos', industry: 'Technology' };

  const subjectInput = field('Subject Preview', 'subj', interpolateTemplate(currentTpl.subject, sampleLead));
  const bodyInput = field('Message Template', 'body', interpolateTemplate(currentTpl.body, { name: '{{business_name}}', city: '{{city}}', industry: '{{industry}}' }), { type: 'textarea' });
  bodyInput.lastChild.style.minHeight = '140px';
  const broadcastAtts = createAttachmentPicker();

  const progressText = create('p', '', 'small');
  const sendBtn = button(
    broadcastSending ? 'Sending Campaign…' : `Send Campaign (${targetLeads.length} recipients)`,
    async () => {
      if (!account.mailbox) { report('Connect your Gmail account in Settings first.', true); return; }
      if (!targetLeads.length) { report('No eligible recipients with verified emails in this audience.', true); return; }
      const rawSubj = subjectInput.lastChild.value.trim();
      const rawBody = bodyInput.lastChild.value.trim();
      if (!rawSubj || !rawBody) { report('Enter a campaign subject and message.', true); return; }

      broadcastSending = true;
      sendBtn.disabled = true;
      let sentCount = 0;
      let failedCount = 0;
      const attachments = broadcastAtts.getAttachments();

      for (let i = 0; i < targetLeads.length; i++) {
        const lead = targetLeads[i];
        progressText.textContent = `Sending ${i + 1} of ${targetLeads.length}: ${lead.name} (${lead.email})…`;
        const finalSubj = interpolateTemplate(currentTpl.subject, lead);
        const finalBody = interpolateTemplate(rawBody, lead)
          .replace(/\[your name\]/gi, settings.senderName || 'Team')
          .replace(/\[your service\]/gi, settings.senderService || 'our services')
          .replace(/\[specific opportunity\]/gi, 'growing your online presence');
        try {
          const sent = await api('/api/send', {
            leadId: lead.id,
            to: lead.email,
            subject: finalSubj,
            body: finalBody,
            attachments,
            templateName: currentTpl.name,
            requestId: crypto.randomUUID()
          });
          if (!lead.threads) lead.threads = [];
          lead.threads.push({ id: sent.threadId, mailbox: account.mailbox, subject: finalSubj, time: Date.now(), to: lead.email });
          if (!lead.due && settings.defaultFollowUpDays > 0) lead.due = futureDateString(settings.defaultFollowUpDays);
          if (currentUser?.usage) currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
          sentCount++;
        } catch (err) {
          failedCount++;
          if (err.message.includes('limit')) {
            report(err.message, true);
            break;
          }
        }
      }
      broadcastSending = false;
      broadcastAtts.clear();
      persist();
      report(`Campaign finished: ${sentCount} sent, ${failedCount} failed.`);
    }
  );
  sendBtn.disabled = broadcastSending || !targetLeads.length;
  if (!account.mailbox) {
    progressText.textContent = 'Connect your Gmail account in Settings to send campaigns.';
  }

  rightCard.append(tplSelect, audSelect, subjectInput, bodyInput, broadcastAtts.el, progressText, sendBtn);
  grid.append(leftCard, rightCard);
  container.replaceChildren(top, grid);
}

/* ---------------- SPLIT-PANE INBOX (Figma Desktop & Mobile Inbox) ---------------- */
const threadKey = conversation => conversation.mailbox + ':' + conversation.id;
const outgoing = () => leads.flatMap(lead => (lead.threads || []).map(conversation => ({ lead, conversation })));

function renderInbox() {
  const container = $('#inbox-content');
  if (!container) return;

  const top = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  const statusPill = create('span', '', account.mailbox ? 'pill' : 'pill wait');
  statusPill.append(create('i', '', 'status-dot'), document.createTextNode(account.mailbox ? `Connected: ${account.mailbox}` : 'Gmail not connected'));
  const titleRow = create('div', '', 'actions');
  titleRow.append(create('h1', 'Outreach Inbox'), statusPill);
  titleWrap.append(titleRow);
  const topActions = create('div', '', 'actions');
  topActions.append(
    btnWithIcon('mail', 'Send Test Email', () => composeDirectEmail({
      defaultTo: account.mailbox || currentUser?.email || '',
      defaultSubject: 'Test email from Jobhunta',
      defaultBody: `Hi ${currentUser?.name || 'there'},\n\nThis is a test email sent from your Jobhunta outreach workspace to verify that Gmail sending and attachments are working properly.\n\nBest regards,\n${settings.senderName || currentUser?.name || 'Jobhunta'}`
    }), 'btn-soft'),
    btnWithIcon('plus', 'Compose Email', () => composeDirectEmail()),
    btnWithIcon('refresh', refreshing ? 'Refreshing…' : 'Refresh Inbox', () => refresh(true), true)
  );
  top.append(titleWrap, topActions);

  if (!account.mailbox) {
    container.replaceChildren(top, empty('mail', 'Connect your Gmail account', 'Go to Settings to connect your Gmail account and view replies here.'));
    return;
  }

  const allItems = outgoing().filter(item => item.conversation.mailbox === account.mailbox);
  const filteredItems = allItems.filter(({ lead, conversation }) => {
    const thread = messages.get(threadKey(conversation)) || [];
    const hasReply = thread.some(m => !m.sent) || lead.replied;
    if (inboxFilter === 'replied') return hasReply;
    if (inboxFilter === 'sent') return !hasReply;
    return true;
  });

  if (!selectedInboxKey && filteredItems[0]) {
    selectedInboxKey = threadKey(filteredItems[0].conversation);
  }

  const shell = create('div', '', 'surface inbox-shell');

  // Left List Pane
  const listPane = create('div', '', 'inbox-list-pane');
  const tabsRow = create('div', '', 'inbox-tabs');
  [['all', `All (${allItems.length})`], ['replied', 'Replies'], ['sent', 'Sent']].forEach(([key, lbl]) => {
    const t = create('button', lbl, 'inbox-tab' + (inboxFilter === key ? ' active' : ''));
    t.type = 'button';
    t.onclick = () => { inboxFilter = key; renderInbox(); };
    tabsRow.append(t);
  });
  const itemsWrap = create('div', '', 'inbox-items');
  if (filteredItems.length) {
    for (const { lead, conversation } of filteredItems) {
      const k = threadKey(conversation);
      const rowEl = create('div', '', 'inbox-item' + (k === selectedInboxKey ? ' active' : ''));
      const body = create('div', '', 'inbox-item-body');
      const rTop = create('div', '', 'inbox-item-top');
      rTop.append(create('strong', lead.name), create('small', new Date(conversation.time || Date.now()).toLocaleDateString()));
      body.append(rTop, create('div', conversation.subject, 'inbox-item-sub'));
      rowEl.append(makeAvatar(lead.name), body);
      rowEl.onclick = async () => {
        selectedInboxKey = k;
        renderInbox();
        try { await syncThread(lead, conversation); renderInbox(); } catch {}
      };
      itemsWrap.append(rowEl);
    }
  } else {
    itemsWrap.append(empty('mail', 'No conversations', 'Send an email to a lead to start a thread.'));
  }
  listPane.append(tabsRow, itemsWrap);

  // Right Thread Pane
  const threadPane = create('div', '', 'inbox-thread-pane');
  const activeEntry = allItems.find(item => threadKey(item.conversation) === selectedInboxKey) || filteredItems[0];
  if (!activeEntry) {
    threadPane.append(empty('mail', 'Select a conversation', 'Pick a thread from the left to read messages and reply.'));
  } else {
    const { lead, conversation } = activeEntry;
    const threadHead = create('div', '', 'heading');
    threadHead.style.margin = '0';
    const headRight = create('div', '', 'actions');
    headRight.append(
      classify(lead, conversation),
      btnWithIcon('plus', 'Compose', () => compose(lead))
    );
    threadHead.append(create('h2', conversation.subject), headRight);

    const threadMsgs = messages.get(threadKey(conversation)) || [];
    const msgsWrap = create('div', '', 'inbox-messages');
    if (threadMsgs.length) {
      for (const m of threadMsgs) {
        const mail = create('article', '', 'mail' + (m.sent ? ' outgoing' : ''));
        const mHead = create('div', '', 'mail-head');
        const mSender = create('div', '', 'mail-sender');
        const senderLabel = m.sent ? (currentUser?.name || 'You') : lead.name;
        const senderMeta = create('div');
        senderMeta.append(
          create('h3', m.sent ? `You → ${m.to || conversation.to || lead.email}` : m.from),
          create('small', new Date(m.time).toLocaleString())
        );
        mSender.append(makeAvatar(senderLabel), senderMeta);
        mHead.append(mSender);
        mail.append(mHead, create('p', m.body));
        msgsWrap.append(mail);
      }
    } else {
      msgsWrap.append(create('p', 'Loading thread messages… (or click Refresh Inbox)', 'small'));
    }

    const replyForm = create('form', '', 'reply-box-wrap');
    const replyBox = create('textarea');
    replyBox.placeholder = `Write a reply to ${lead.name}…`;
    replyBox.required = true;
    const replyAtts = createAttachmentPicker();
    const replyActions = create('div', '', 'actions');
    const sendReplyBtn = create('button', '', '');
    sendReplyBtn.type = 'submit';
    sendReplyBtn.append(iconEl('send', 14), document.createTextNode('Send Reply'));
    replyActions.append(sendReplyBtn, button('View Dossier', () => openBusinessPage(lead), 'btn-soft'));
    replyForm.append(replyBox, replyAtts.el, replyActions);
    replyForm.onsubmit = async event => {
      event.preventDefault();
      const text = replyBox.value.trim();
      if (!text) return;
      const lastIncoming = threadMsgs.findLast(m => !m.sent);
      const replyTarget = lastIncoming || threadMsgs.at(-1);
      sendReplyBtn.disabled = true;
      sendReplyBtn.textContent = 'Sending…';
      try {
        await api('/api/send', {
          to: conversation.to || lead.email,
          subject: conversation.subject,
          body: text,
          attachments: replyAtts.getAttachments(),
          requestId: crypto.randomUUID(),
          threadId: conversation.id,
          parentId: replyTarget?.id
        });
        replyBox.value = '';
        replyAtts.clear();
        await syncThread(lead, conversation);
        if (currentUser?.usage) currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
        persist();
        report(`Reply sent to ${lead.name}.`);
      } catch (err) {
        report(err.message, true);
      } finally {
        sendReplyBtn.disabled = false;
        sendReplyBtn.replaceChildren(iconEl('send', 14), document.createTextNode('Send Reply'));
      }
    };

    threadPane.append(threadHead, msgsWrap, replyForm);
  }

  shell.append(listPane, threadPane);
  container.replaceChildren(top, shell);
}

function classify(lead, conversation) {
  const select = create('select');
  select.style.width = 'auto';
  const options = { '': 'Status: Auto', ...statusNames };
  for (const [value, label] of Object.entries(options)) select.add(new Option(label, value));
  select.value = lead.classification || '';
  select.onchange = () => {
    lead.classification = select.value;
    if (['unsubscribe', 'bounced'].includes(select.value)) {
      lead.suppressed = [...new Set([...(lead.suppressed || []), norm(conversation.to || lead.email)])];
      lead.due = '';
    }
    persist();
  };
  return select;
}

async function syncThread(lead, conversation) {
  const key = threadKey(conversation);
  const thread = await api('/api/thread', { id: conversation.id, mailbox: conversation.mailbox });
  messages.set(key, thread);
  const incoming = thread.filter(message => !message.sent);
  const seen = new Set(conversation.seen || []);
  if (incoming.some(message => !seen.has(message.id))) {
    lead.replied = true;
    lead.due = '';
    conversation.seen = incoming.map(message => message.id);
    persist();
  }
  return thread;
}

async function refresh(manual = false) {
  if (!account.mailbox || refreshing) return;
  refreshing = true;
  renderInbox();
  let failed = 0;
  try {
    const list = outgoing().filter(item => item.conversation.mailbox === account.mailbox);
    for (let index = 0; index < list.length; index += 4) {
      const batch = await Promise.allSettled(list.slice(index, index + 4)
        .map(({ lead, conversation }) => syncThread(lead, conversation)));
      failed += batch.filter(result => result.status === 'rejected').length;
    }
    if (failed) report('Could not refresh ' + failed + ' conversation(s). Check Gmail or reconnect.', true);
    else if (manual) report(list.length ? 'Inbox is up to date.' : 'There are no outreach conversations to refresh.');
  } finally {
    refreshing = false;
    renderInbox();
  }
}

/* ---------------- PROFILE & USAGE (Figma Profile & Plan Comparison) ---------------- */
function renderProfile() {
  const container = $('#profile-content');
  if (!container) return;

  const tierList = [
    { key: 'basic', label: 'Basic', tagline: 'Starter outreach', searches: '50', emails: '10', dailySearchLimit: 50, dailyEmailLimit: 10 },
    { key: 'silver', label: 'Silver', tagline: 'Growing pipeline', searches: '120', emails: '30', dailySearchLimit: 120, dailyEmailLimit: 30 },
    { key: 'gold', label: 'Gold', tagline: 'Active prospecting', searches: '300', emails: '50', dailySearchLimit: 300, dailyEmailLimit: 50 },
    { key: 'premium', label: 'Premium', tagline: 'High-volume teams', searches: '500', emails: '100', dailySearchLimit: 500, dailyEmailLimit: 100 },
    { key: 'diamond', label: 'Diamond', tagline: 'Unrestricted scale', searches: 'Unlimited', emails: 'Unlimited', dailySearchLimit: null, dailyEmailLimit: null }
  ];

  const usage = currentUser?.usage || {
    tier: currentUser?.tier || 'basic',
    label: 'Basic',
    dailySearchLimit: 50,
    dailyEmailLimit: 10,
    searchesToday: 0,
    emailsToday: 0,
    usageDate: new Date().toISOString().slice(0, 10)
  };
  const activeTier = tierList.find(t => t.key === usage.tier) || tierList[0];
  const withEmailCount = leads.filter(l => l.email).length;
  const contactedCount = leads.filter(l => (l.threads?.length || 0) > 0).length;
  const totalEmailsSent = leads.reduce((sum, l) => sum + (l.threads?.length || 0), 0);
  const repliedCount = leads.filter(l => l.replied || l.classification === 'interested').length;
  const responseRate = contactedCount ? Math.round((repliedCount / contactedCount) * 100) : 0;
  const shopifyCount = leads.filter(l => l.platform === 'Shopify').length;
  const aiBriefCount = leads.filter(l => l.aiBrief).length;
  const cityCounts = new Map();
  for (const l of leads) {
    if (l.city) cityCounts.set(l.city, (cityCounts.get(l.city) || 0) + 1);
  }
  const topCities = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c).join(', ') || 'None yet';
  const memberSince = currentUser?.createdAt
    ? new Date(currentUser.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Active Member';
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const now = new Date();
  const nextMidnightUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minsLeft = Math.max(1, Math.round((nextMidnightUtc - Date.now()) / 60000));
  const resetCountdown = `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left`;

  // 1. Modern Emerald Hero Banner
  const hero = create('section', '', 'profile-hero');
  const heroLeft = create('div', '', 'profile-hero-left');
  const avatar = create('div', getInitials(currentUser?.name || currentUser?.email || 'U'), 'profile-avatar-lg');
  const heroText = create('div');
  const heroPills = create('div', '', 'profile-hero-pills');
  const tierGlass = create('span', '', 'hero-glass-pill emerald');
  tierGlass.append(iconEl('crown', 13), document.createTextNode(`${activeTier.label} Plan`));
  const memberGlass = create('span', `Joined ${memberSince}`, 'hero-glass-pill');
  const idGlass = create('button', '', 'hero-glass-pill');
  idGlass.type = 'button';
  idGlass.style.cursor = 'pointer';
  const shortId = String(currentUser?.id || 'local').slice(0, 8);
  idGlass.append(iconEl('copy', 12), document.createTextNode(`ID: ${shortId}`));
  idGlass.onclick = async () => {
    try { await navigator.clipboard.writeText(currentUser?.id || ''); report('Copied Workspace ID to clipboard.'); } catch {}
  };
  heroPills.append(tierGlass, memberGlass, idGlass);
  heroText.append(
    create('h1', currentUser?.name || settings.senderName || 'Jobhunta User'),
    create('p', currentUser?.email || 'Personal Workspace', 'profile-hero-email'),
    heroPills
  );
  heroLeft.append(avatar, heroText);

  const heroActs = create('div', '', 'actions');
  heroActs.append(
    btnWithIcon('settings', 'Edit Profile', () => { settingsTab = 'outreach'; location.hash = '#settings'; }, 'hero-btn-ghost'),
    btnWithIcon('search', 'Find Businesses', () => { location.hash = '#discover'; })
  );
  hero.append(heroLeft, heroActs);

  // 2. 4-Card Live Usage & Workspace KPI Strip
  const kpiGrid = create('div', '', 'kpi-grid');
  const makeProfileKpi = (icoName, value, label, sub, handler, amber = false) => {
    const card = create('article', '', 'surface kpi-card');
    const ico = create('div', '', 'kpi-ico' + (amber ? ' amber' : ''));
    ico.append(iconEl(icoName, 24));
    const foot = create('div', '', 'kpi-foot-row');
    foot.append(create('small', label), create('span', sub, 'kpi-trend'));
    card.append(ico, create('strong', String(value)), foot);
    if (handler) card.onclick = handler;
    return card;
  };
  const searchRemain = activeTier.dailySearchLimit == null ? 'Unlimited' : `${Math.max(0, activeTier.dailySearchLimit - (usage.searchesToday || 0))} left`;
  const emailRemain = activeTier.dailyEmailLimit == null ? 'Unlimited' : `${Math.max(0, activeTier.dailyEmailLimit - (usage.emailsToday || 0))} left`;
  kpiGrid.append(
    makeProfileKpi('search', usage.searchesToday || 0, 'Searches Today', searchRemain, () => { location.hash = '#discover'; }),
    makeProfileKpi('mail', usage.emailsToday || 0, 'Emails Sent Today', emailRemain, () => { location.hash = '#broadcast'; }),
    makeProfileKpi('users', leads.length, 'Saved Leads', `${withEmailCount} with email`, () => { location.hash = '#leads'; }),
    makeProfileKpi('refresh', '00:00 UTC', 'Daily Quota Reset', resetCountdown, null, true)
  );

  // 3. Detailed Profile Info Cards Row (3 Rich Information Cards)
  const infoGrid = create('div', '', 'profile-info-grid');
  const makeInfoCard = (icoName, tone, title, subtitle, rows, footerBtn = null) => {
    const card = create('article', '', 'surface card-pad');
    const head = create('div', '', 'setting-card-head');
    const titleWrap = create('div', '', 'setting-card-title');
    const ico = create('div', '', `setting-ico ${tone}`); ico.append(iconEl(icoName, 18));
    const txt = create('div'); txt.append(create('h2', title), create('p', subtitle));
    titleWrap.append(ico, txt);
    head.append(titleWrap);
    card.append(head);
    const list = create('div', '', 'info-kv-list');
    for (const [k, v] of rows) {
      const r = create('div', '', 'info-kv-row');
      r.append(create('span', k), create('strong', String(v || '—')));
      list.append(r);
    }
    card.append(list);
    if (footerBtn) card.append(footerBtn);
    return card;
  };

  const personalInfoCard = makeInfoCard(
    'user', '', 'Personal & Account Info', 'Your Jobhunta identity & workspace details',
    [
      ['Full Name', currentUser?.name || settings.senderName || 'Not set'],
      ['Email Address', currentUser?.email || '—'],
      ['Workspace ID', shortId + '…'],
      ['Subscription Tier', `${activeTier.label} Tier`],
      ['Member Since', memberSince],
      ['Local Timezone', localTz]
    ],
    btnWithIcon('copy', 'Copy Full Workspace ID', async () => {
      try { await navigator.clipboard.writeText(currentUser?.id || ''); report('Copied Workspace ID to clipboard.'); } catch {}
    }, 'btn-soft', 14)
  );

  const outreachInfoCard = makeInfoCard(
    'send', 'blue', 'Outreach & Sender Profile', 'Identity used in templates & AI pitches',
    [
      ['Sender Name', settings.senderName || currentUser?.name || 'Not set'],
      ['Core Service / Offer', settings.senderService || 'Not configured yet'],
      ['Connected Gmail', account.mailbox || 'Not connected'],
      ['Follow-up Cadence', settings.defaultFollowUpDays ? `Every ${settings.defaultFollowUpDays} days` : 'Off'],
      ['Email Templates', `${settings.templates.length} template(s) ready`],
      ['Daily Email Limit', activeTier.emails]
    ],
    btnWithIcon('settings', 'Edit Sender Identity', () => { settingsTab = 'outreach'; location.hash = '#settings'; }, 'btn-soft', 14)
  );

  const pipelineInfoCard = makeInfoCard(
    'barChart', 'amber', 'Pipeline & Performance', 'All-time discovery & outreach metrics',
    [
      ['Total Emails Sent', `${totalEmailsSent} message(s)`],
      ['Contacted Leads', `${contactedCount} business(es)`],
      ['Warm Replies', `${repliedCount} (${responseRate}% rate)`],
      ['Shopify Stores Found', `${shopifyCount} store(s)`],
      ['AI Lead Briefs', `${aiBriefCount} generated`],
      ['Top Target Cities', topCities]
    ],
    btnWithIcon('bookmark', 'View Saved Leads', () => { location.hash = '#leads'; }, 'btn-soft', 14)
  );

  infoGrid.append(personalInfoCard, outreachInfoCard, pipelineInfoCard);

  // 4. 2-Column Split: Daily Usage Meters + Security & Integrations Card
  const midGrid = create('div', '', 'profile-mid-grid');

  const usageCard = create('article', '', 'surface card-pad');
  const uHead = create('div', '', 'setting-card-head');
  const uTitleWrap = create('div', '', 'setting-card-title');
  const uIco = create('div', '', 'setting-ico'); uIco.append(iconEl('barChart', 19));
  const uTitleTxt = create('div');
  uTitleTxt.append(create('h2', 'Daily Quota & Activity'), create('p', `Live usage tracking for ${usage.usageDate || 'today'}`));
  uTitleWrap.append(uIco, uTitleTxt);
  uHead.append(uTitleWrap, create('span', activeTier.label, 'pill'));
  usageCard.append(uHead);

  const addMeter = (title, used, limit, suffix = '') => {
    const wrap = create('div');
    const isUnlimited = limit === null || limit === undefined;
    const pct = isUnlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
    const labelText = isUnlimited ? `${used} / Unlimited` : `${used} / ${limit}${suffix ? ' ' + suffix : ''} (${pct}%)`;
    const rowTop = create('div', '', 'stat-row');
    rowTop.style.border = '0'; rowTop.style.padding = '0';
    rowTop.append(create('span', title), create('strong', labelText));
    const meter = create('div', '', 'meter');
    const fill = create('div', '', 'meter-fill');
    fill.style.width = `${isUnlimited ? 100 : Math.max(pct, used > 0 ? 4 : 0)}%`;
    if (!isUnlimited && pct >= 100) fill.style.background = '#b91c1c';
    else if (!isUnlimited && pct >= 80) fill.style.background = '#d97706';
    meter.append(fill);
    wrap.append(rowTop, meter);
    return wrap;
  };
  usageCard.append(
    addMeter('Business Searches Used Today', usage.searchesToday || 0, activeTier.dailySearchLimit),
    addMeter('Outreach Emails Sent Today', usage.emailsToday || 0, activeTier.dailyEmailLimit),
    addMeter('Verified Email Coverage', withEmailCount, Math.max(1, leads.length), 'leads'),
    addMeter('AI Brief Enrichment Coverage', aiBriefCount, Math.max(1, leads.length), 'leads')
  );
  const usageFoot = create('div', '', 'actions');
  usageFoot.style.marginTop = '4px';
  usageFoot.append(
    btnWithIcon('search', 'New Search', () => { location.hash = '#discover'; }, 'btn-soft'),
    btnWithIcon('send', 'Open Broadcast', () => { location.hash = '#broadcast'; }, true)
  );
  usageCard.append(usageFoot);

  const detailsCard = create('article', '', 'surface card-pad');
  const dHead = create('div', '', 'setting-card-head');
  const dTitleWrap = create('div', '', 'setting-card-title');
  const dIco = create('div', '', 'setting-ico slate'); dIco.append(iconEl('lock', 19));
  const dTitleTxt = create('div');
  dTitleTxt.append(create('h2', 'Security, Sync & Data'), create('p', 'Workspace protection, cloud sync, and session controls'));
  dTitleWrap.append(dIco, dTitleTxt);
  dHead.append(dTitleWrap);
  detailsCard.append(dHead);

  const addDetailRow = (title, sub, actionNode) => {
    const r = create('div', '', 'setting-row');
    const c = create('div', '', 'setting-row-copy');
    c.append(create('strong', title), create('small', sub));
    r.append(c, actionNode);
    detailsCard.append(r);
  };
  const secBadge = create('span', '', 'pill');
  secBadge.append(iconEl('check', 12), document.createTextNode('Encrypted'));
  addDetailRow('Account Security', 'Salted scrypt password hash · HttpOnly AES-256 cookie', secBadge);
  const sbBadge = create('span', '', account.supabase?.connected ? 'pill' : 'pill wait');
  sbBadge.append(create('i', '', 'status-dot'), document.createTextNode(account.supabase?.connected ? 'Synced' : 'Local'));
  addDetailRow('Supabase Cloud Sync', 'Isolated per-user Postgres workspace', sbBadge);
  addDetailRow(
    'Export Workspace Data',
    `Download all ${leads.length} saved lead(s) as a CSV backup`,
    btnWithIcon('fileText', 'Export CSV', exportLeads, 'btn-soft', 14)
  );
  addDetailRow(
    'Active Session',
    'Sign out of your Jobhunta account on this device',
    btnWithIcon('logOut', 'Log Out', async () => {
      try { await api('/api/auth/logout', {}); } catch {}
      showAuthScreen();
    }, 'danger')
  );

  midGrid.append(usageCard, detailsCard);

  // 5. Full-Width 5-Tier Modern Plan Comparison Cards
  const plansSection = create('section', '', 'surface card-pad');
  const pHead = create('div', '', 'heading');
  pHead.style.margin = '0';
  const pHeadCopy = create('div');
  pHeadCopy.append(create('h2', 'Subscription Tiers & Daily Allowances'), create('p', 'Compare daily search and outreach email limits across all Jobhunta plans.', 'small'));
  pHead.append(pHeadCopy, create('span', `Current: ${activeTier.label}`, 'pill'));

  const cardsGrid = create('div', '', 'plan-cards-grid');
  for (const t of tierList) {
    const isCurrent = t.key === activeTier.key;
    const tc = create('article', '', 'tier-card' + (isCurrent ? ' active' : ''));
    if (isCurrent) tc.append(create('span', 'Current Plan', 'tier-card-badge'));

    const h3 = create('h3');
    h3.append(document.createTextNode(t.label));
    if (t.key === 'diamond') h3.append(iconEl('crown', 16));
    tc.append(h3, create('p', t.tagline, 'tier-tagline'));

    const statBox = create('div', '', 'tier-stat-box');
    const sRow = create('div', '', 'tier-stat-line');
    sRow.append(create('span', 'Searches / day'), create('strong', t.searches));
    const eRow = create('div', '', 'tier-stat-line');
    eRow.append(create('span', 'Emails / day'), create('strong', t.emails));
    statBox.append(sRow, eRow);

    const feats = create('ul', '', 'tier-features');
    ['Bing Maps & Shopify Scraper', 'AI Lead Briefs & Pitches', 'Supabase Cloud Sync'].forEach(f => {
      const li = create('li');
      li.append(iconEl('check', 14), document.createTextNode(f));
      feats.append(li);
    });

    tc.append(statBox, feats);
    cardsGrid.append(tc);
  }
  plansSection.append(pHead, cardsGrid);

  container.replaceChildren(hero, kpiGrid, infoGrid, midGrid, plansSection);
}

/* ---------------- SETTINGS (Modern SaaS Categorized Settings, Auto-Saving) ---------------- */
function renderSettings() {
  const container = $('#settings-content');
  if (!container) return;

  const autoSaveBadge = create('span', '', 'pill');
  autoSaveBadge.append(iconEl('check', 13), document.createTextNode('Auto-saves on change'));

  const topHeader = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', 'Settings'),
    create('p', 'Manage your integrations, sender identity, outreach automation, and workspace data.')
  );
  const topActs = create('div', '', 'actions');
  topActs.append(
    autoSaveBadge,
    btnWithIcon('search', 'Find Businesses', () => { location.hash = '#discover'; }, 'btn-soft')
  );
  topHeader.append(titleWrap, topActs);

  const shell = create('div', '', 'settings-shell');

  // Left vertical category nav
  const nav = create('nav', '', 'settings-nav');
  nav.setAttribute('aria-label', 'Settings sections');
  const sections = [
    ['integrations', 'mail', 'Integrations'],
    ['outreach', 'sparkles', 'Sender & Outreach'],
    ['data', 'database', 'Data & Workspace'],
    ['account', 'user', 'Account & Plan']
  ];
  for (const [key, ico, lbl] of sections) {
    const b = create('button', '', 'settings-nav-btn' + (settingsTab === key ? ' active' : ''));
    b.type = 'button';
    b.append(iconEl(ico, 17), document.createTextNode(lbl));
    b.onclick = () => { settingsTab = key; renderSettings(); };
    nav.append(b);
  }

  const panel = create('div', '', 'settings-panel');

  const cardHead = (icoName, icoTone, title, subtitle, rightBadge = null) => {
    const h = create('div', '', 'setting-card-head');
    const left = create('div', '', 'setting-card-title');
    const ico = create('div', '', `setting-ico ${icoTone}`);
    ico.append(iconEl(icoName, 19));
    const txt = create('div');
    txt.append(create('h2', title), create('p', subtitle));
    left.append(ico, txt);
    h.append(left);
    if (rightBadge) h.append(rightBadge);
    return h;
  };

  const actionRow = (title, desc, ...btns) => {
    const row = create('div', '', 'setting-row');
    const copy = create('div', '', 'setting-row-copy');
    copy.append(create('strong', title), create('small', desc));
    const acts = create('div', '', 'actions');
    acts.append(...btns);
    row.append(copy, acts);
    return row;
  };

  const flashSaved = () => {
    autoSaveBadge.replaceChildren(iconEl('check', 13), document.createTextNode('Saved just now'));
    setTimeout(() => {
      autoSaveBadge.replaceChildren(iconEl('check', 13), document.createTextNode('Auto-saves on change'));
    }, 2000);
  };

  const autoSaveSettings = () => {
    if (currentUser?.id) {
      localStorage.setItem(userSettingsKey(currentUser.id), JSON.stringify(settings));
      syncWorkspaceToServer();
    }
    renderDashboard();
    flashSaved();
  };

  if (settingsTab === 'integrations') {
    // 1. Gmail OAuth Integration
    const gmailCard = create('article', '', 'surface card-pad');
    const gPill = create('span', '', account.mailbox ? 'pill' : 'pill wait');
    gPill.append(create('i', '', 'status-dot'), document.createTextNode(account.mailbox ? 'Connected' : 'Not Connected'));
    gmailCard.append(cardHead('mail', '', 'Gmail Integration', 'Send 1-to-1 outreach emails and track replies directly from Jobhunta.', gPill));

    const expectedUri = account.redirectUri || (location.origin + '/oauth/callback');
    if (account.mailbox) {
      gmailCard.append(
        kvItem('Connected Mailbox', account.mailbox),
        actionRow(
          'Inbox Sync & Test Email',
          'Send yourself a test email to verify Gmail delivery, refresh threads, or disconnect.',
          btnWithIcon('send', 'Send Test Email', () => composeDirectEmail({
            defaultTo: account.mailbox || currentUser?.email || '',
            defaultSubject: 'Test email from Jobhunta',
            defaultBody: `Hi ${currentUser?.name || 'there'},\n\nThis is a test email sent from your Jobhunta outreach workspace to confirm Gmail delivery is working.\n\nBest regards,\n${settings.senderName || currentUser?.name || 'Jobhunta'}`
          }), 'btn-soft'),
          btnWithIcon('refresh', 'Sync Inbox', () => { location.hash = '#inbox'; refresh(true); }, true),
          button('Disconnect Gmail', async () => {
            try { await api('/api/disconnect', {}); account.mailbox = null; messages.clear(); renderAccount(); report('Disconnected Gmail.'); }
            catch (e) { report(e.message, true); }
          }, 'danger')
        )
      );
    } else {
      const connectBtn = btnWithIcon('mail', 'Connect Gmail', async event => {
        const btn = event.currentTarget;
        btn.disabled = true; btn.textContent = 'Redirecting…';
        try { location.assign((await api('/api/connect', {})).url); }
        catch (e) { btn.disabled = false; btn.replaceChildren(iconEl('mail', 15), document.createTextNode('Connect Gmail')); report(e.message, true); }
      });
      const copyUriBtn = btnWithIcon('copy', 'Copy Redirect URI', async e => {
        try { await navigator.clipboard.writeText(expectedUri); e.currentTarget.textContent = 'Copied!'; } catch {}
      }, 'btn-soft');
      gmailCard.append(
        kvItem('OAuth Client ID', account.clientId || 'Configure GOOGLE_CLIENT_ID in .env'),
        kvItem('Authorized Redirect URI', expectedUri),
        actionRow('Authorize Gmail Access', 'Connect your Google account to unlock 1-to-1 sending and Broadcast campaigns.', connectBtn, copyUriBtn)
      );
    }

    // 2. Supabase Cloud Sync
    const sbCard = create('article', '', 'surface card-pad');
    const sbPill = create('span', '', account.supabase?.connected ? 'pill' : 'pill wait');
    sbPill.append(create('i', '', 'status-dot'), document.createTextNode(account.supabase?.connected ? 'Cloud Synced' : 'Local Mode'));
    sbCard.append(
      cardHead('database', 'blue', 'Supabase Cloud Sync', 'Per-user isolated Postgres storage for leads, AI briefs, templates, and quotas.', sbPill),
      actionRow(
        `${leads.length} Leads · ${settings.templates.length} Templates`,
        account.supabase?.connected
          ? 'Everything syncs automatically to your isolated Supabase workspace.'
          : (account.supabase?.error || 'Add SUPABASE_URL and SUPABASE_ANON_KEY to enable cloud sync.'),
        btnWithIcon('refresh', 'Sync Now', async e => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Syncing…';
          try {
            await api('/api/workspace', { userId: currentUser.id, leads, settings });
            report('Workspace synced with Supabase.');
          } catch (err) { report(err.message, true); }
          finally { b.disabled = false; b.replaceChildren(iconEl('refresh', 15), document.createTextNode('Sync Now')); }
        }, 'btn-soft')
      )
    );

    panel.append(gmailCard, sbCard);
  } else if (settingsTab === 'outreach') {
    // 1. Sender Identity Card
    const idCard = create('article', '', 'surface card-pad');
    idCard.append(cardHead('user', '', 'Sender Identity', 'Used automatically in {{your_name}}, {{your_service}}, and AI pitch generation.'));

    const fieldsGrid = create('div', '', 'grid-2');
    const sName = field('Your Display Name', 'senderName', settings.senderName, { placeholder: 'e.g. Ayoola Adebisi' });
    const sService = field('Your Service / Offer', 'senderService', settings.senderService, { placeholder: 'e.g. Shopify CRO, web design & local SEO' });
    fieldsGrid.append(sName, sService);

    const sigBox = create('div', '', 'sig-preview');
    const updateSig = () => {
      const nm = settings.senderName || currentUser?.name || 'Your Name';
      const srv = settings.senderService || 'your core service offer';
      sigBox.replaceChildren(
        create('small', 'Live Outreach Preview'),
        document.createTextNode(`“Hi team, I’m ${nm}. I help businesses with ${srv} and put together a quick idea for your website.”`)
      );
    };
    updateSig();

    sName.lastChild.oninput = () => { settings.senderName = sName.lastChild.value.trim(); updateSig(); };
    sService.lastChild.oninput = () => { settings.senderService = sService.lastChild.value.trim(); updateSig(); };
    sName.lastChild.onchange = autoSaveSettings;
    sService.lastChild.onchange = autoSaveSettings;

    idCard.append(fieldsGrid, sigBox);

    // 2. Outreach Automation & Follow-up Cadence
    const autoCard = create('article', '', 'surface card-pad');
    autoCard.append(cardHead('sparkles', 'amber', 'Outreach Automation', 'Configure default follow-up reminders and access your email template cards.'));

    const presetWrap = create('div', '', 'preset-pills');
    const presets = [
      [0, 'Off'],
      [2, '2 days'],
      [4, '4 days'],
      [7, '7 days'],
      [14, '14 days']
    ];
    const currentDays = Number(settings.defaultFollowUpDays ?? 4);
    presets.forEach(([d, label]) => {
      const p = create('button', label, 'preset-pill' + (currentDays === d ? ' active' : ''));
      p.type = 'button';
      p.onclick = () => {
        settings.defaultFollowUpDays = d;
        autoSaveSettings();
        renderSettings();
      };
      presetWrap.append(p);
    });

    autoCard.append(
      actionRow('Default Follow-up Reminder', 'Automatically sets a follow-up due date after sending an initial outreach email.', presetWrap),
      actionRow(
        `Email Template Cards (${settings.templates.length} saved)`,
        'Create, edit, and preview your outreach templates directly on the Broadcast page.',
        btnWithIcon('send', 'Manage Templates', () => { location.hash = '#broadcast'; }, 'btn-soft')
      )
    );

    panel.append(idCard, autoCard);
  } else if (settingsTab === 'data') {
    const dataCard = create('article', '', 'surface card-pad');
    dataCard.append(cardHead('folder', 'blue', 'Lead Data & Enrichment', 'Import, export, or bulk-enrich your saved business leads.'));

    const missingCount = leads.filter(l => !l.email && l.website).length;
    const dlTpl = create('a', 'Download Template');
    dlTpl.href = '/business-import.csv';
    dlTpl.download = 'business-import.csv';
    dlTpl.className = 'secondary';
    dlTpl.style.cssText = 'text-decoration:none;padding:9px 14px;border-radius:10px;border:1px solid var(--line);font-size:13.5px;font-weight:600;color:var(--ink)';

    dataCard.append(
      actionRow('Import Businesses (CSV)', 'Upload a Jobhunta or Bing Maps Scraper CSV file into your workspace.', btnWithIcon('plus', 'Import CSV', importLeads, 'btn-soft'), dlTpl),
      actionRow('Export Saved Leads', `Download all ${leads.length} saved business lead(s) as a clean CSV spreadsheet.`, btnWithIcon('fileText', 'Export CSV', exportLeads, 'btn-soft')),
      actionRow('Bulk Website Email Combing', missingCount ? `${missingCount} saved business(es) have websites without an email address yet.` : 'All saved businesses with websites already have emails or were combed.', btnWithIcon('sparkles', enrichingAll ? 'Combing…' : `Enrich Missing (${missingCount})`, enrichMissingEmails, 'btn-soft'))
    );

    const toolsCard = create('article', '', 'surface card-pad');
    toolsCard.append(cardHead('settings', 'slate', 'Workspace Tools', 'Quick shortcuts and local cache controls.'));
    toolsCard.append(
      actionRow('Business Discovery', 'Jump straight to the Bing Maps & Shopify scraper to find new leads.', btnWithIcon('search', 'Find Businesses', () => { location.hash = '#discover'; })),
      actionRow('Reset Local Browser Cache', 'Clears cached browser data and reloads your latest workspace from Supabase.', button('Clear Local Cache', () => {
        if (currentUser?.id) {
          localStorage.removeItem(userLeadsKey(currentUser.id));
          localStorage.removeItem(userSettingsKey(currentUser.id));
        }
        report('Local browser cache cleared. Reloading workspace…');
        setTimeout(() => location.reload(), 600);
      }, true))
    );

    panel.append(dataCard, toolsCard);
  } else if (settingsTab === 'account') {
    const tierLabel = currentUser?.usage?.label || 'Basic';
    const accCard = create('article', '', 'surface card-pad');
    const tierPill = create('span', '', 'pill');
    tierPill.append(iconEl('crown', 13), document.createTextNode(`${tierLabel} Plan`));
    accCard.append(cardHead('crown', 'amber', 'Account & Subscription', 'Your Jobhunta identity, unique workspace ID, and daily quota tier.', tierPill));

    accCard.append(
      kvItem('Account Name', currentUser?.name || settings.senderName || 'Jobhunta User'),
      kvItem('Email Address', currentUser?.email || '—'),
      kvItem('Unique Workspace ID', currentUser?.id || '—'),
      actionRow('Usage & Tier Limits', 'Track your daily searches, email quota, and compare available plans.', btnWithIcon('barChart', 'Open Profile & Usage', () => { location.hash = '#profile'; }, 'btn-soft'))
    );

    const secCard = create('article', '', 'surface card-pad');
    secCard.append(
      cardHead('lock', 'slate', 'Session & Security', 'Manage your active login session on this device.'),
      actionRow('Sign Out of Jobhunta', 'Securely end your current session and return to the sign-in screen.', btnWithIcon('logOut', 'Log Out', async () => {
        try { await api('/api/auth/logout', {}); } catch {}
        showAuthScreen();
      }, 'danger'))
    );

    panel.append(accCard, secCard);
  }

  shell.append(nav, panel);
  container.replaceChildren(topHeader, shell);
}

/* ---------------- SHARED HELPERS & MODALS ---------------- */
function field(label, name, value = '', { type = 'text', required = false, maxLength = 160, placeholder = '' } = {}) {
  const wrapper = create('label', label);
  const input = create(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.name = name;
  input.value = value || '';
  input.required = required;
  if (placeholder) input.placeholder = placeholder;
  if (type !== 'date' && type !== 'number') input.maxLength = maxLength;
  wrapper.append(input);
  return wrapper;
}

function selectField(label, name, optionsMap, currentValue = '') {
  const wrapper = create('label', label);
  const select = create('select');
  select.name = name;
  for (const [value, text] of Object.entries(optionsMap)) select.add(new Option(text, value));
  select.value = currentValue || '';
  wrapper.append(select);
  return wrapper;
}

function show(title, ...content) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').replaceChildren(...content);
  if (!dialog.open) dialog.showModal();
}

function editLead(lead) {
  const form = create('form', '', 'stack');
  const submit = create('button', 'Save Lead');
  const feedback = create('div', '', 'small');
  const statusSelect = selectField('Lead status', 'classification', { '': 'Automatic', ...statusNames }, lead?.classification || '');
  const actions = create('div', '', 'actions');
  actions.append(submit);
  if (lead) actions.append(button('Delete', () => { dialog.close(); deleteLead(lead); }, 'danger'));

  form.append(
    field('Business name', 'name', lead?.name, { required: true }),
    field('Industry', 'industry', lead?.industry),
    field('City', 'city', lead?.city),
    field('Business email', 'email', lead?.email, { type: 'email', maxLength: 254 }),
    field('Phone number', 'phone', lead?.phone, { type: 'tel', maxLength: 80 }),
    field('Website', 'website', lead?.website, { type: 'url', maxLength: 1024 }),
    field('Address', 'address', lead?.address, { maxLength: 400 }),
    field('Notes', 'about', lead?.about, { type: 'textarea', maxLength: 6000 }),
    statusSelect,
    field('Follow-up date', 'due', lead?.due, { type: 'date' }),
    feedback,
    actions
  );
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, v.trim()]));
    if (!values.name) { feedback.textContent = 'Enter a business name.'; return; }
    if (duplicate(values, lead?.id)) { feedback.textContent = 'This business is already saved.'; return; }
    if (lead) Object.assign(lead, values);
    else leads.unshift({ ...values, id: crypto.randomUUID(), savedAt: Date.now(), threads: [] });
    persist();
    if (results.length) renderResults();
    dialog.close();
  };
  show(lead ? 'Edit ' + lead.name : 'Add a Lead', form);
}

function importLeads() {
  const form = create('form', '', 'stack');
  const label = create('label', 'Business CSV (Jobhunta or Bing Maps Scraper format)');
  const file = create('input');
  file.type = 'file'; file.accept = '.csv,text/csv'; file.required = true;
  label.append(file);
  const template = create('a', 'Download CSV template');
  template.href = '/business-import.csv'; template.download = 'business-import.csv';
  const feedback = create('div', '', 'small');
  const submit = create('button', 'Import Businesses');
  form.append(template, label, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const { businesses, errors } = readBusinessCsv(await file.files[0].text());
      let added = 0, skipped = 0;
      for (const b of businesses) {
        if (duplicate(b)) skipped++;
        else { leads.unshift({ ...b, id: crypto.randomUUID(), savedAt: Date.now(), threads: [] }); added++; }
      }
      persist();
      feedback.textContent = `${added} imported, ${skipped} duplicates skipped, ${errors.length} invalid rows.`;
    } catch (e) { feedback.textContent = e.message; }
    finally { submit.disabled = false; }
  };
  show('Import Businesses', form);
}

function exportLeads() {
  if (!leads.length) return;
  const csv = writeBusinessCsv(leads);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = create('a');
  link.href = url; link.download = `jobhunta-leads-${new Date().toLocaleDateString('en-CA')}.csv`;
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  report(`Exported ${leads.length} lead(s) to CSV.`);
}

async function enrichMissingEmails() {
  const targets = leads.filter(lead => !lead.email && lead.website);
  if (!targets.length || enrichingAll) return;
  enrichingAll = true;
  renderLeads();
  let foundCount = 0;
  try {
    for (const lead of targets) {
      try {
        const res = await api('/api/enrich', { website: lead.website });
        applyEnrichmentToItem(lead, res);
        if (res.email) foundCount++;
      } catch {}
    }
    persist();
    report(foundCount ? `Found emails for ${foundCount} of ${targets.length} business(es).` : `Scanned ${targets.length} website(s); no new public emails found.`);
  } finally {
    enrichingAll = false;
    renderLeads();
  }
}

function interpolateTemplate(text = '', lead = {}) {
  return text
    .replace(/\{\{\s*business_name\s*\}\}/gi, lead.name || 'there')
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || 'your area')
    .replace(/\{\{\s*industry\s*\}\}/gi, lead.industry || 'local')
    .replace(/\{\{\s*your_name\s*\}\}/gi, settings.senderName || '[your name]')
    .replace(/\{\{\s*your_service\s*\}\}/gi, settings.senderService || '[your service]');
}

function futureDateString(days) {
  if (!days || days <= 0) return '';
  const date = new Date(); date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function createAttachmentPicker() {
  const attached = [];
  const box = create('div', '', 'attach-box');
  const bar = create('div', '', 'attach-bar');
  const input = create('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.zip';
  input.hidden = true;

  const pickBtn = btnWithIcon('paperclip', 'Attach Images / Files', () => input.click(), 'btn-soft', 14);
  const note = create('small', 'Max 5 files · 10 MB total (images, PDF, docs)', 'small');
  bar.append(pickBtn, note, input);

  const chips = create('div', '', 'attach-chips');
  const renderChips = () => {
    chips.replaceChildren();
    attached.forEach((item, idx) => {
      const chip = create('div', '', 'attach-chip');
      if (item.previewUrl) {
        const img = create('img', '', 'attach-thumb');
        img.src = item.previewUrl;
        img.alt = item.filename;
        chip.append(img);
      } else {
        chip.append(iconEl('fileText', 15));
      }
      chip.append(create('span', item.filename), create('small', formatBytes(item.size)));
      const rm = create('button', '', 'attach-rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', `Remove ${item.filename}`);
      rm.append(iconEl('x', 13));
      rm.onclick = () => { attached.splice(idx, 1); renderChips(); };
      chip.append(rm);
      chips.append(chip);
    });
  };

  input.onchange = async () => {
    const files = [...(input.files || [])];
    input.value = '';
    for (const file of files) {
      if (attached.length >= 5) { report('You can attach up to 5 files per email.', true); break; }
      const currentTotal = attached.reduce((s, a) => s + a.size, 0);
      if (currentTotal + file.size > 10 * 1024 * 1024) {
        report('Total attachment size cannot exceed 10 MB.', true);
        break;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsDataURL(file);
      });
      const commaIdx = dataUrl.indexOf(',');
      const dataBase64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : '';
      const mimeType = file.type || 'application/octet-stream';
      attached.push({
        filename: file.name,
        mimeType,
        size: file.size,
        dataBase64,
        previewUrl: mimeType.startsWith('image/') ? dataUrl : ''
      });
    }
    renderChips();
  };

  box.append(bar, chips);
  return {
    el: box,
    getAttachments: () => attached.map(({ filename, mimeType, dataBase64 }) => ({ filename, mimeType, dataBase64 })),
    clear: () => { attached.length = 0; renderChips(); }
  };
}

function composeDirectEmail({ defaultTo = '', defaultSubject = '', defaultBody = '' } = {}) {
  const form = create('form', '', 'stack');
  const to = field('To (any email address)', 'to', defaultTo, { type: 'email', required: true, maxLength: 254, placeholder: 'you@example.com' });
  const subject = field('Subject', 'subject', defaultSubject, { required: true, maxLength: 160, placeholder: 'e.g. Test email from Jobhunta' });
  const body = field('Message', 'body', defaultBody, { type: 'textarea', required: true, maxLength: 16000, placeholder: 'Write your message here…' });
  body.lastChild.style.minHeight = '160px';
  const picker = createAttachmentPicker();
  const feedback = create('div', '', 'small');
  const submit = create('button', 'Send via Gmail');
  submit.disabled = !account.mailbox;
  const requestId = crypto.randomUUID();
  if (!account.mailbox) feedback.textContent = 'Connect your Gmail account in Settings → Integrations before sending.';

  form.append(to, subject, body, picker.el, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (!values.to.trim() || !values.subject.trim() || !values.body.trim()) {
      feedback.textContent = 'Enter a recipient email, subject, and message.';
      return;
    }
    submit.disabled = true;
    feedback.textContent = 'Sending…';
    try {
      await api('/api/send', {
        to: values.to.trim(),
        subject: values.subject.trim(),
        body: values.body.trim(),
        attachments: picker.getAttachments(),
        direct: true,
        requestId
      });
      if (currentUser?.usage) currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
      persist();
      dialog.close();
      report(`Email sent to ${values.to.trim()}! Check the inbox to verify delivery.`);
    } catch (e) {
      feedback.textContent = e.message;
      submit.disabled = false;
    }
  };
  show(defaultTo ? 'Send Test Email' : 'Compose Direct Email', form);
}

function compose(lead, conversation, parent, customPitch = null) {
  const form = create('form', '', 'stack');
  const recipient = parent
    ? (parent.sent ? (parent.to || conversation?.to || lead.email) : (parent.replyTo || parent.from))
        .match(/<([^>]+)>/)?.[1] || (parent.sent ? (parent.to || conversation?.to || lead.email) : (parent.replyTo || parent.from))
    : lead.email;

  const defaultTpl = parent ? (settings.templates.find(t => t.id === 'followup') || settings.templates[0]) : settings.templates[0];
  const tplWrapper = create('label', 'Template');
  const tplSelect = create('select');
  tplSelect.add(new Option(customPitch ? 'AI Generated Pitch' : 'Select a template…', ''));
  for (const tpl of settings.templates) tplSelect.add(new Option(tpl.name, tpl.id));
  if (!parent && !customPitch && defaultTpl) tplSelect.value = defaultTpl.id;
  tplWrapper.append(tplSelect);

  const to = field('To', 'to', recipient, { type: 'email', required: true, maxLength: 254 });
  const subject = field('Subject', 'subject', customPitch?.subject || interpolateTemplate(defaultTpl?.subject || 'Quick introduction to {{business_name}}', lead), { required: true });
  const body = field('Message', 'body', customPitch?.body || interpolateTemplate(defaultTpl?.body || '', lead), { type: 'textarea', required: true, maxLength: 16000 });
  body.lastChild.style.minHeight = '190px';
  const picker = createAttachmentPicker();
  tplSelect.onchange = () => {
    const chosen = settings.templates.find(t => t.id === tplSelect.value);
    if (!chosen) return;
    if (!parent) subject.lastChild.value = interpolateTemplate(chosen.subject, lead);
    body.lastChild.value = interpolateTemplate(chosen.body, lead);
  };
  const feedback = create('div', '', 'small');
  const submit = create('button', 'Send via Gmail');
  submit.disabled = !account.mailbox;
  const requestId = crypto.randomUUID();
  if (!account.mailbox) feedback.textContent = 'Connect Gmail in Settings before sending.';
  form.append(tplWrapper, to, subject, body, picker.el, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (!values.body.trim() || !values.subject.trim() || /\[(?:your |specific )|\{\{[^}]+\}\}/.test(values.body)) {
      feedback.textContent = 'Complete the subject and replace any template placeholders.'; return;
    }
    if (blocked(values.to)) { feedback.textContent = 'Address is unsubscribed or bounced.'; return; }
    submit.disabled = true; feedback.textContent = 'Sending…';
    try {
      const sent = await api('/api/send', {
        ...values,
        leadId: lead.id,
        attachments: picker.getAttachments(),
        requestId,
        threadId: conversation?.id,
        parentId: parent?.id
      });
      if (!conversation && !lead.threads.some(i => i.id === sent.threadId)) {
        lead.threads.push({ id: sent.threadId, mailbox: account.mailbox, subject: values.subject, time: Date.now(), to: values.to });
      }
      if (!lead.email) lead.email = values.to;
      if (!lead.due && settings.defaultFollowUpDays > 0) lead.due = futureDateString(settings.defaultFollowUpDays);
      if (currentUser?.usage) currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
      persist(); dialog.close(); report('Email sent to ' + values.to + '.');
    } catch (e) { feedback.textContent = e.message; submit.disabled = false; }
  };
  show('Email ' + lead.name, form);
}

function renderAccount() {
  updateHeaderBadges();
  renderDashboard();
  renderInbox();
  renderSettings();
}

const dismissedNotifs = new Set();

function buildNotifications() {
  const items = [];
  const dueLeads = leads.filter(l => leadStatus(l) === 'Follow-up due');
  const repliedLeads = leads.filter(l => leadStatus(l) === 'Replied' || leadStatus(l) === 'Interested');
  const missingEmailLeads = leads.filter(l => !l.email && l.website);

  if (dueLeads.length && !dismissedNotifs.has('due')) {
    items.push({
      id: 'due',
      icon: 'bell',
      tone: 'amber',
      title: `${dueLeads.length} follow-up${dueLeads.length === 1 ? '' : 's'} due`,
      sub: dueLeads.slice(0, 2).map(l => l.name).join(', ') + (dueLeads.length > 2 ? ` +${dueLeads.length - 2} more` : ''),
      action: () => jumpToLeadsFilter('Follow-up due')
    });
  }
  if (repliedLeads.length && !dismissedNotifs.has('replied')) {
    items.push({
      id: 'replied',
      icon: 'mail',
      tone: '',
      title: `${repliedLeads.length} warm repl${repliedLeads.length === 1 ? 'y' : 'ies'} waiting`,
      sub: 'Open Outreach Inbox to respond while interest is fresh.',
      action: () => { location.hash = '#inbox'; }
    });
  }
  if (!account.mailbox && !dismissedNotifs.has('gmail')) {
    items.push({
      id: 'gmail',
      icon: 'mail',
      tone: 'amber',
      title: 'Connect Gmail to send outreach',
      sub: 'Link your Google account in Settings to unlock Broadcast & Inbox.',
      action: () => { settingsTab = 'integrations'; location.hash = '#settings'; }
    });
  }
  if (missingEmailLeads.length && !dismissedNotifs.has('missing')) {
    items.push({
      id: 'missing',
      icon: 'sparkles',
      tone: 'blue',
      title: `${missingEmailLeads.length} lead${missingEmailLeads.length === 1 ? '' : 's'} ready for email combing`,
      sub: 'Click to scan their websites for public email addresses.',
      action: () => { location.hash = '#leads'; enrichMissingEmails(); }
    });
  }
  const usage = currentUser?.usage;
  if (usage?.dailySearchLimit && (usage.searchesToday || 0) >= Math.ceil(usage.dailySearchLimit * 0.8) && !dismissedNotifs.has('quota')) {
    items.push({
      id: 'quota',
      icon: 'barChart',
      tone: 'amber',
      title: `Daily search quota at ${Math.min(100, Math.round(((usage.searchesToday || 0) / usage.dailySearchLimit) * 100))}%`,
      sub: `${usage.searchesToday || 0} of ${usage.dailySearchLimit} searches used today.`,
      action: () => { location.hash = '#profile'; }
    });
  }
  return items;
}

function setNotificationsOpen(open) {
  const pop = $('#notif-popover');
  const btn = $('#header-bell-btn');
  if (!pop || !btn) return;
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) renderNotificationsPopover();
}

function renderNotificationsPopover() {
  const pop = $('#notif-popover');
  if (!pop) return;
  const items = buildNotifications();
  const head = create('div', '', 'notif-head');
  const h3 = create('h3');
  h3.append(document.createTextNode('Notifications'));
  if (items.length) h3.append(create('span', String(items.length), 'pill'));
  head.append(h3);
  if (items.length) {
    head.append(button('Clear all', () => {
      items.forEach(i => dismissedNotifs.add(i.id));
      updateHeaderBadges();
      renderNotificationsPopover();
    }, 'link-btn'));
  }

  const body = create('div', '', 'notif-list');
  if (items.length) {
    for (const item of items) {
      const row = create('button', '', 'notif-item');
      row.type = 'button';
      const ico = create('div', '', `notif-ico ${item.tone}`);
      ico.append(iconEl(item.icon, 16));
      const txt = create('div', '', 'notif-body');
      txt.append(create('strong', item.title), create('small', item.sub));
      row.append(ico, txt, iconEl('chevronRight', 15));
      row.onclick = () => {
        setNotificationsOpen(false);
        item.action();
      };
      body.append(row);
    }
  } else {
    const emptyEl = create('div', '', 'notif-empty');
    const ic = create('div', '', 'empty-ico');
    ic.style.margin = '0 auto 10px';
    ic.append(iconEl('checkCircle', 22));
    emptyEl.append(ic, create('strong', 'All caught up!'), create('p', 'No urgent follow-ups or workspace alerts right now.', 'small'));
    body.append(emptyEl);
  }
  pop.replaceChildren(head, body);
}

/* ---------------- EVENT WIRING & NAVIGATION ---------------- */
$('#header-settings-btn').onclick = () => { setNotificationsOpen(false); location.hash = '#settings'; };
$('#header-avatar-btn').onclick = () => { setNotificationsOpen(false); location.hash = '#profile'; };
$('#header-bell-btn').onclick = e => {
  e.stopPropagation();
  const pop = $('#notif-popover');
  setNotificationsOpen(pop ? pop.hidden : false);
};
document.addEventListener('click', e => {
  const wrap = document.querySelector('.notif-wrap');
  const pop = $('#notif-popover');
  if (pop && !pop.hidden && wrap && !wrap.contains(e.target)) setNotificationsOpen(false);
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') setNotificationsOpen(false);
});
$('#global-search').oninput = e => {
  const q = e.target.value.trim();
  if ($('#filter-query')) $('#filter-query').value = q;
  if (q && location.hash !== '#leads') location.hash = '#leads';
  renderLeads();
};

for (const chip of document.querySelectorAll('.chip-pill')) {
  chip.onclick = () => {
    $('#industry-input').value = chip.dataset.industry || '';
    $('#city-input').focus();
  };
}

$('#stop-search').onclick = () => {
  searchGeneration++;
  if (searchController) { searchController.abort(); searchController = null; }
  streamActive = false;
  for (const item of results) { item.scanning = false; item.scanned = true; }
  if (results.length) scheduleAutoPersist(true);
  renderResults(); updateScrapeBanner();
};

$('#search').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const generation = ++searchGeneration;
  const formData = new FormData(form);
  activeSearchFolder = buildSearchFolderName(formData.get('industry'), formData.get('city'), formData.get('rankMode'));
  activeWorkers = 0; results = []; resultsPage = 1; streamActive = true;
  currentScrapeStep = 'Connecting to Bing Maps…';
  submit.disabled = true; report(); updateScrapeBanner();
  $('#save-all').hidden = true; $('#results-pagination').hidden = true; $('#results-count').textContent = '';
  $('#results').replaceChildren(empty('search', 'Scraping live from Bing Maps…', 'Businesses will appear here in real time and auto-save into your search folder in Saved Leads.'));

  let autoSavedCount = 0;
  try {
    const params = new URLSearchParams(formData);
    params.set('stream', '1');
    const response = await fetch('/api/search?' + params, { signal: searchController.signal });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Search failed.');
    }
    if (currentUser?.usage) { currentUser.usage.searchesToday = (currentUser.usage.searchesToday || 0) + 1; renderProfile(); }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (generation === searchGeneration) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'status') { currentScrapeStep = msg.message; updateScrapeBanner(); }
        else if (msg.type === 'business' && msg.item) {
          if (!results.some(x => x.id === msg.item.id)) {
            msg.item.folder = activeSearchFolder;
            results.push(msg.item);
            if (upsertLeadIntoFolder(msg.item, activeSearchFolder)) autoSavedCount++;
            scheduleAutoPersist(false);
            renderResults(); updateScrapeBanner(); triggerEnrichmentWorkers(generation);
          }
        } else if (msg.type === 'error') throw new Error(msg.error);
      }
    }
    if (generation === searchGeneration && !results.length) {
      $('#results').replaceChildren(empty('search', 'No matching businesses', 'Try a nearby city or another industry.'));
    } else if (generation === searchGeneration && results.length) {
      scheduleAutoPersist(true);
      report(`Saved ${results.length} business${results.length === 1 ? '' : 'es'} into folder "${activeSearchFolder}" in Saved Leads.`);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (!results.length) $('#results').replaceChildren(empty('search', 'Search unavailable', error.message));
      else report(error.message, true);
    }
  } finally {
    if (generation === searchGeneration) {
      streamActive = false; searchController = null;
      if (autoSavedCount > 0) scheduleAutoPersist(true);
      updateScrapeBanner();
    }
    submit.disabled = false;
  }
};

$('#inspect-url').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  const formData = new FormData(form);
  let rawUrl = (formData.get('website') || '').trim();
  const cityVal = (formData.get('city') || '').trim();
  if (!rawUrl) return;
  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
  submit.disabled = true; submit.textContent = 'Combing URL…'; report();
  try {
    const enriched = await api('/api/enrich', { website: rawUrl });
    const parsedHost = new URL(enriched.website || rawUrl).hostname.replace(/^www\./, '');
    const newItem = {
      id: crypto.randomUUID(), savedAt: Date.now(),
      folder: 'Direct URL · ' + (cityVal || 'Online'),
      name: enriched.brandName || parsedHost,
      industry: enriched.platform === 'Shopify' ? 'Shopify Store' : (enriched.platform || 'Online Business'),
      city: cityVal || 'Online', address: '', website: enriched.website || rawUrl,
      phone: '', email: enriched.email || '', source: enriched.website || rawUrl,
      about: [enriched.platform, enriched.shopifyMeta?.themeName && `Theme: ${enriched.shopifyMeta.themeName}`].filter(Boolean).join(' · '),
      scanned: true, threads: []
    };
    applyEnrichmentToItem(newItem, enriched);
    form.reset();
    openBusinessPage(newItem);
    report(`Combed ${newItem.name} (${newItem.platform || 'Website'}) and opened its dossier.`);
  } catch (error) { report(error.message, true); }
  finally {
    submit.disabled = false;
    submit.replaceChildren(iconEl('sparkles', 15), document.createTextNode('Comb URL & Open Dossier'));
  }
};

$('#save-all').onclick = () => {
  let added = 0;
  for (const item of getVisibleSearchResults()) {
    if (!duplicate(item)) {
      const copy = { ...item, savedAt: Date.now(), threads: [] };
      delete copy.scanning; delete copy.scanned;
      leads.unshift(copy); added++;
    }
  }
  if (added) { persist(); renderResults(); report(`Saved ${added} business(es) to your leads.`); }
};

$('#results-filter').onchange = () => { resultsPage = 1; renderResults(); };

function setMobileNav(open) {
  document.body.classList.toggle('nav-open', open);
  const toggleBtn = $('#menu-toggle');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(open));
}

function navigate() {
  setMobileNav(false);
  const validPages = new Set(['dashboard', 'discover', 'leads', 'business', 'inbox', 'broadcast', 'profile', 'settings']);
  const requested = location.hash.slice(1);
  const page = validPages.has(requested) ? requested : 'dashboard';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== page;
  for (const link of document.querySelectorAll('aside nav a, .mobile-bottom-nav a')) {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (page === 'dashboard') renderDashboard();
  if (page === 'business') renderBusinessPage();
  if (page === 'inbox') refresh();
  if (page === 'broadcast') renderBroadcast();
  if (page === 'profile') renderProfile();
  if (page === 'settings') renderSettings();
}

$('#menu-toggle').onclick = () => setMobileNav(!document.body.classList.contains('nav-open'));
$('#sidebar-close').onclick = () => setMobileNav(false);
$('#sidebar-backdrop').onclick = () => setMobileNav(false);
for (const navLink of document.querySelectorAll('aside a')) navLink.addEventListener('click', () => setMobileNav(false));
window.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('nav-open')) setMobileNav(false); });

$('#add').onclick = () => editLead();
$('#import').onclick = importLeads;
$('#export').onclick = exportLeads;
$('#enrich-all').onclick = enrichMissingEmails;
$('#close').onclick = () => dialog.close();
$('#filter-query').oninput = () => { leadsPage = 1; renderLeads(); };
$('#filter-status').onchange = () => { leadsPage = 1; renderLeads(); };
$('#filter-platform').onchange = () => { leadsPage = 1; renderLeads(); };
$('#filter-sort').onchange = () => { leadsPage = 1; renderLeads(); };
window.addEventListener('hashchange', navigate);
$('#results').replaceChildren(empty('search', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));

/* ---------------- AUTH SCREEN ---------------- */
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === 'signup';
  $('#tab-login').classList.toggle('active', !isSignup);
  $('#tab-login').setAttribute('aria-selected', String(!isSignup));
  $('#tab-signup').classList.toggle('active', isSignup);
  $('#tab-signup').setAttribute('aria-selected', String(isSignup));
  $('#auth-name-wrap').hidden = !isSignup;
  $('#auth-name').required = isSignup;
  const remRow = $('#auth-remember-row');
  if (remRow) remRow.hidden = isSignup;
  $('#auth-password').autocomplete = isSignup ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = isSignup ? 'Create Account' : 'Sign In';
  $('#auth-switch-text').textContent = isSignup ? 'Already have an account?' : "Don't have an account?";
  $('#auth-switch-btn').textContent = isSignup ? 'Sign In' : 'Create Account';
  $('#auth-error').hidden = true;
}

$('#toggle-password').onclick = () => {
  const input = $('#auth-password');
  const showPwd = input.type === 'password';
  input.type = showPwd ? 'text' : 'password';
  const btn = $('#toggle-password');
  btn.setAttribute('aria-label', showPwd ? 'Hide password' : 'Show password');
  btn.replaceChildren(iconEl(showPwd ? 'eyeOff' : 'eye', 17));
};
$('#tab-login').onclick = () => setAuthMode('login');
$('#tab-signup').onclick = () => setAuthMode('signup');
$('#auth-switch-btn').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');

function applyUserSession(user, serverLeads = [], serverSettings = {}, serverMailbox = null, { isHydration = false } = {}) {
  currentUser = user;
  account.user = user;
  if (serverMailbox !== undefined) account.mailbox = serverMailbox;
  document.body.classList.remove('auth-checking', 'auth-locked');
  try {
    localStorage.setItem('jobhunta.activeUser', JSON.stringify({
      id: user.id, name: user.name, email: user.email, tier: user.tier, usage: user.usage, createdAt: user.createdAt || null
    }));
  } catch {}

  const sidebarUser = $('#sidebar-user');
  if (sidebarUser) sidebarUser.replaceChildren(create('i'), document.createTextNode(' ' + (user.name || user.email)));

  const { cachedLeads, cachedSettings } = loadLocalUserCache(user.id);
  leads = Array.isArray(serverLeads) && serverLeads.length ? serverLeads : (Array.isArray(cachedLeads) ? cachedLeads : []);
  if (Array.isArray(cachedLeads) && cachedLeads.length && Array.isArray(serverLeads) && serverLeads.length) {
    for (const localLead of cachedLeads) if (!duplicate(localLead)) leads.push(localLead);
  }
  settings = {
    senderName: user.name || '', senderService: '', defaultFollowUpDays: 4, templates: defaultTemplates,
    ...cachedSettings, ...(serverSettings && typeof serverSettings === 'object' ? serverSettings : {})
  };
  if (!Array.isArray(settings.templates) || !settings.templates.length) settings.templates = defaultTemplates;

  if (!isHydration) {
    results = []; resultsPage = 1; leadsPage = 1; activeBusinessId = null; selectedInboxKey = null; messages.clear();
    $('#results').replaceChildren(empty('search', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));
    $('#save-all').hidden = true; $('#results-pagination').hidden = true; $('#results-count').textContent = '';
    persist();
  } else {
    updateHeaderBadges();
    renderDashboard();
    renderLeads();
    renderInbox();
    renderBroadcast();
    renderProfile();
    renderSettings();
  }
  renderAccount();
  navigate();
  if (!isHydration) refresh();
}

function showAuthScreen() {
  currentUser = null; leads = []; results = []; activeBusinessId = null; selectedInboxKey = null; messages.clear();
  try { localStorage.removeItem('jobhunta.activeUser'); } catch {}
  setAuthMode('login');
  document.body.classList.remove('auth-checking');
  document.body.classList.add('auth-locked');
  setMobileNav(false);
}

$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('#auth-submit');
  const errEl = $('#auth-error');
  errEl.hidden = true; submit.disabled = true;
  submit.textContent = authMode === 'signup' ? 'Creating Account…' : 'Signing In…';
  try {
    const payload = Object.fromEntries(new FormData(form));
    const data = await api(authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login', payload);
    form.reset();
    applyUserSession(data.user, data.leads, data.settings, data.mailbox);
  } catch (error) {
    errEl.textContent = error.message; errEl.hidden = false;
  } finally {
    submit.disabled = false; setAuthMode(authMode);
  }
};

$('#logout-btn').onclick = async () => {
  try { await api('/api/auth/logout', {}); } catch {}
  showAuthScreen();
};

const oauthResult = new URLSearchParams(location.search).get('gmail');
if (oauthResult) {
  report(oauthResult === 'permissions' ? 'Allow both Gmail permissions and try again.' : 'Gmail could not be connected. Check your Google OAuth settings and try again.', true);
  history.replaceState(null, '', location.pathname + location.hash);
}

// Instant optimistic hydration on refresh so logged-in users never see a login flash or blank delay
try {
  const cachedUserRaw = localStorage.getItem('jobhunta.activeUser');
  if (cachedUserRaw && !document.body.classList.contains('auth-locked')) {
    const cachedUser = JSON.parse(cachedUserRaw);
    if (cachedUser?.id && cachedUser?.email) {
      applyUserSession(cachedUser, [], {}, undefined, { isHydration: true });
    }
  }
} catch {}

try {
  account = await api('/api/status');
  const datalist = $('#industries');
  datalist.replaceChildren(...account.industries.map(industry => new Option(industry, industry)));
  if (account.user) applyUserSession(account.user, account.leads, account.settings, account.mailbox);
  else showAuthScreen();
  setInterval(() => { if (currentUser && !document.hidden) refresh(); }, 60000);
} catch (error) {
  if (!currentUser) showAuthScreen();
  report(error.message, true);
}
