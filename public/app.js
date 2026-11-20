import { readBusinessCsv, writeBusinessCsv } from './csv.mjs';

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
let activeBusinessId = null;
let dossierTab = 'overview';
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

function empty(icon, title, description) {
  const box = create('div', '', 'surface empty');
  const mark = create('span', icon);
  mark.setAttribute('aria-hidden', 'true');
  box.append(mark, create('h3', title), create('p', description));
  return box;
}

function syncWorkspaceToServer() {
  if (!currentUser?.id) return;
  api('/api/workspace', { leads, settings }).catch(() => {});
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
  const dueOrReplied = leads.filter(l => ['Follow-up due', 'Replied', 'Interested'].includes(leadStatus(l))).length;
  const bellDot = $('#bell-dot');
  if (bellDot) bellDot.hidden = dueOrReplied === 0;

  const avatarBtn = $('#header-avatar-btn');
  if (avatarBtn && currentUser) {
    avatarBtn.textContent = getInitials(currentUser.name || currentUser.email);
  }
  const tierLabel = currentUser?.usage?.label || 'Basic';
  const planTitle = $('#sidebar-plan-title');
  const planSub = $('#sidebar-plan-sub');
  if (planTitle) planTitle.textContent = tierLabel === 'Diamond' ? 'Diamond Plan Active' : `${tierLabel} Plan`;
  if (planSub) {
    planSub.textContent = tierLabel === 'Diamond'
      ? 'Unlimited searches & outreach'
      : 'Upgrade for higher daily quotas';
  }
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

/* ---------------- DASHBOARD (Figma Desktop Dashboard) ---------------- */
function buildActivitySvg() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 540 175');
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
  const maxVal = Math.max(5, ...days.map(d => Math.max(d.leads, d.emails)));

  for (let g = 0; g <= 3; g++) {
    const y = 20 + (g * 38);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '34'); line.setAttribute('x2', '520');
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', '#e8f0ee'); line.setAttribute('stroke-width', '1');
    svg.append(line);
  }

  const ptsLeads = days.map((d, idx) => {
    const x = 44 + idx * 78;
    const y = 134 - Math.round((d.leads / maxVal) * 108);
    return `${x},${y}`;
  }).join(' ');
  const ptsEmails = days.map((d, idx) => {
    const x = 44 + idx * 78;
    const y = 134 - Math.round((d.emails / maxVal) * 108);
    return `${x},${y}`;
  }).join(' ');

  const polyLeads = document.createElementNS(ns, 'polyline');
  polyLeads.setAttribute('fill', 'none');
  polyLeads.setAttribute('stroke', '#059669');
  polyLeads.setAttribute('stroke-width', '3');
  polyLeads.setAttribute('stroke-linecap', 'round');
  polyLeads.setAttribute('stroke-linejoin', 'round');
  polyLeads.setAttribute('points', ptsLeads);

  const polyEmails = document.createElementNS(ns, 'polyline');
  polyEmails.setAttribute('fill', 'none');
  polyEmails.setAttribute('stroke', '#6ee7b7');
  polyEmails.setAttribute('stroke-width', '2.5');
  polyEmails.setAttribute('stroke-linecap', 'round');
  polyEmails.setAttribute('stroke-linejoin', 'round');
  polyEmails.setAttribute('points', ptsEmails);

  svg.append(polyEmails, polyLeads);

  days.forEach((d, idx) => {
    const x = 44 + idx * 78;
    const txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', String(x));
    txt.setAttribute('y', '162');
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#5b7479');
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
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '120');
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
  const emailsSent = leads.reduce((sum, l) => sum + (l.threads?.length || 0), 0);
  const repliedCount = leads.filter(l => l.replied || l.classification === 'interested').length;
  const contactedCount = leads.filter(l => (l.threads?.length || 0) > 0).length;
  const responseRate = contactedCount ? Math.round((repliedCount / contactedCount) * 100) : 0;

  const headerBar = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', `Welcome back, ${firstName}!`),
    create('p', "Here's what's happening with your Jobhunta outreach workspace today.")
  );
  const rightActions = create('div', '', 'actions');
  rightActions.append(
    create('span', `● ${tierLabel} Plan`, 'pill'),
    button('Find Businesses ↗', () => { location.hash = '#discover'; })
  );
  headerBar.append(titleWrap, rightActions);

  const kpiGrid = create('div', '', 'kpi-grid');
  const makeKpi = (icon, value, label, sub, targetStatus) => {
    const card = create('article', '', 'surface kpi-card');
    const top = create('div', '', 'kpi-top');
    top.append(create('div', icon, 'kpi-ico'));
    card.append(top, create('strong', String(value)), create('small', label), create('div', sub, 'kpi-foot'));
    card.onclick = () => jumpToLeadsFilter(targetStatus);
    return card;
  };
  kpiGrid.append(
    makeKpi('👥', leads.length, 'Total Leads', 'View all →', ''),
    makeKpi('🏢', results.length || leads.filter(l => l.email).length, results.length ? 'Found This Search' : 'Leads With Email', 'Inspect →', 'New'),
    makeKpi('✉', emailsSent, 'Emails Sent', 'Outreach →', 'Contacted'),
    makeKpi('✓', `${responseRate}%`, 'Response Rate', `${repliedCount} replied →`, 'Replied')
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

  const addActionRow = (title, meta, handler) => {
    const item = create('div', '', 'biz-mini');
    const left = create('div', '', 'biz-mini-left');
    const dot = create('span', '●', 'pill wait');
    dot.style.padding = '4px 8px';
    const textWrap = create('div');
    textWrap.append(create('h4', title), create('p', meta));
    left.append(dot, textWrap);
    item.append(left, create('span', '→', 'small'));
    item.onclick = handler;
    priorityCard.append(item);
  };
  addActionRow(`Follow up with ${dueLeads.length} due lead${dueLeads.length === 1 ? '' : 's'}`, 'Scheduled reminders', () => jumpToLeadsFilter('Follow-up due'));
  addActionRow(`Review ${repliedLeads.length} warm response${repliedLeads.length === 1 ? '' : 's'}`, 'Inbox & replies', () => { location.hash = '#inbox'; });
  addActionRow(`Comb ${missingEmailLeads.length} website${missingEmailLeads.length === 1 ? '' : 's'} for emails`, 'Auto-enrichment', () => { location.hash = '#leads'; enrichMissingEmails(); });
  addActionRow('Check daily tier usage', `${currentUser?.usage?.searchesToday || 0} searches today`, () => { location.hash = '#profile'; });

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
    recentCard.append(empty('⌕', 'No saved leads yet', 'Search Bing Maps or inspect a Shopify URL to start building your pipeline.'));
  }
  botRow.append(sourceCard, recentCard);

  container.replaceChildren(headerBar, kpiGrid, midRow, botRow);
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
      $('#results').replaceChildren(empty('⌕', 'No matching results for this filter', streamActive ? 'Still scanning websites in the background…' : 'Switch filter to view all scraped businesses.'));
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
    const viewBtn = button(saved ? 'View' : 'Save & View', () => openBusinessPage(item), true);
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

  if (paginationEl) {
    if (visibleResults.length > pageSize) {
      paginationEl.hidden = false;
      const startNum = startIndex + 1;
      const endNum = Math.min(visibleResults.length, startIndex + pageSize);
      const info = create('span', `Showing ${startNum}–${endNum} of ${visibleResults.length} businesses (Page ${resultsPage} of ${totalPages})`, 'small');
      const controls = create('div', '', 'actions');
      const prevBtn = button('← Previous', () => {
        if (resultsPage > 1) { resultsPage--; renderResults(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }, true);
      prevBtn.disabled = resultsPage <= 1;
      const nextBtn = button('Next →', () => {
        if (resultsPage < totalPages) { resultsPage++; renderResults(); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
      nextBtn.disabled = resultsPage >= totalPages;
      controls.append(prevBtn, nextBtn);
      paginationEl.replaceChildren(info, controls);
    } else {
      paginationEl.hidden = true;
    }
  }
}

/* ---------------- SAVED LEADS (Figma KPI Grid + Clean Table) ---------------- */
function getFilteredLeads() {
  const query = norm($('#filter-query')?.value || $('#global-search')?.value);
  const statusFilter = $('#filter-status')?.value || '';
  const platformFilter = $('#filter-platform')?.value || '';
  const sortOrder = $('#filter-sort')?.value || 'recent';

  const filtered = leads.filter(lead => {
    const status = leadStatus(lead);
    if (statusFilter && status !== statusFilter) return false;
    if (platformFilter && (lead.platform || '') !== platformFilter) return false;
    if (!query) return true;
    const haystack = [lead.name, lead.industry, lead.city, lead.email, lead.phone, lead.address, lead.about, lead.platform]
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
    const makeKpi = (ico, val, lbl, filterVal) => {
      const card = create('article', '', 'surface kpi-card');
      const top = create('div', '', 'kpi-top');
      top.append(create('div', ico, 'kpi-ico'));
      card.append(top, create('strong', String(val)), create('small', lbl));
      card.onclick = () => { $('#filter-status').value = filterVal; renderLeads(); };
      return card;
    };
    kpiGrid.replaceChildren(
      makeKpi('👥', leads.length, 'Total Saved', ''),
      makeKpi('★', `${verifiedPct}%`, 'Has Email Rate', 'New'),
      makeKpi('✉', withEmail, 'With Email', 'New'),
      makeKpi('📁', inPipeline, 'In Pipeline', 'Contacted')
    );
  }

  const filtered = getFilteredLeads();
  const summary = $('#lead-summary');
  if (summary) {
    summary.textContent = leads.length
      ? `Showing ${filtered.length} of ${leads.length} saved lead${leads.length === 1 ? '' : 's'} — click any business row to open its full dossier.`
      : 'No saved leads yet.';
  }

  if (!filtered.length) {
    $('#lead-list').replaceChildren(empty('▤', leads.length ? 'No matching leads' : 'No leads yet',
      leads.length ? 'Try clearing or changing your search and status filters.' : 'Save a business from Find Businesses or add a contact manually.'));
    return;
  }

  const wrap = create('div', '', 'data-table-wrap');
  const table = create('table', '', 'data-table');
  const thead = create('thead');
  thead.innerHTML = '<tr><th>Business</th><th>Industry</th><th>Status</th><th>Platform / Source</th><th>Actions</th></tr>';
  const tbody = create('tbody');

  for (const lead of filtered) {
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
    if (lead.aiBrief) tdStatus.append(create('span', '✦ AI Pitch', 'pill'));

    const tdPlat = create('td');
    if (lead.platform && lead.platform !== 'Custom / Website') tdPlat.append(create('span', lead.platform, 'pill neutral'));
    else tdPlat.append(create('span', (lead.source || '').includes('bing') ? 'Bing Maps' : 'Workspace', 'small'));

    const tdAct = create('td');
    const actGroup = create('div', '', 'actions');
    actGroup.onclick = e => e.stopPropagation();
    actGroup.append(
      button('Dossier', () => openBusinessPage(lead), true),
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

function renderBusinessPage() {
  const container = $('#business-detail');
  if (!container) return;
  const currentIndex = leads.findIndex(item => item.id === activeBusinessId);
  const lead = currentIndex !== -1 ? leads[currentIndex] : leads[0];
  if (!lead) {
    container.replaceChildren(
      empty('▣', 'No business selected', 'Choose a business from Saved Leads or Find Businesses to open its Business Dossier.')
    );
    return;
  }
  const leadIndex = currentIndex !== -1 ? currentIndex : 0;
  activeBusinessId = lead.id;

  const status = leadStatus(lead);
  const navBar = create('div', '', 'heading');
  const queueLeft = create('div', '', 'actions');
  const backBtn = button('← Saved Leads', () => { location.hash = '#leads'; }, true);
  const prevBtn = button('← Prev', () => { if (leadIndex > 0) { activeBusinessId = leads[leadIndex - 1].id; renderBusinessPage(); } }, true);
  prevBtn.disabled = leadIndex <= 0;
  const nextBtn = button(`Next (${leadIndex + 1}/${leads.length}) →`, () => { if (leadIndex < leads.length - 1) { activeBusinessId = leads[leadIndex + 1].id; renderBusinessPage(); } }, true);
  nextBtn.disabled = leadIndex >= leads.length - 1;
  queueLeft.append(backBtn, prevBtn, nextBtn);

  const queueRight = create('div', '', 'actions');
  if (lead.website) queueRight.append(button('Have a look (Comb site)', event => enrichItemEmail(lead, event.currentTarget), true));
  queueRight.append(
    button('Draft Email', () => compose(lead)),
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
  cList.style.gap = '6px';
  cList.append(
    create('div', `✉  ${lead.email || 'Needs email'}`, 'small'),
    create('div', `☎  ${lead.phone || 'No phone listed'}`, 'small'),
    create('div', `⌖  ${[lead.address, lead.city].filter(Boolean).join(', ') || 'Location not listed'}`, 'small')
  );
  const webRow = create('div', '', 'small');
  webRow.append(document.createTextNode('🌐  '), website(lead.website, lead.website) || document.createTextNode('No website listed'));
  cList.append(webRow);
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

  const tabBody = create('div', '', 'dossier-grid');

  if (dossierTab === 'overview') {
    const ovCard = create('article', '', 'surface dossier-card');
    ovCard.append(create('h2', 'Company Overview'));
    ovCard.append(create('p', lead.aboutSummary || lead.about || 'No website overview extracted yet. Click "Have a look (Comb site)" to crawl their website.'));
    if (lead.headings?.length) {
      ovCard.append(kvItem('Key Website Headings', lead.headings.join(' • ')));
    }

    const crmCard = create('article', '', 'surface dossier-card');
    crmCard.append(create('h2', 'Quick CRM Controls (Auto-Saves)'));
    const statusSelect = selectField('Lead Status', 'classification', { '': `Automatic (${status})`, ...statusNames }, lead.classification || '');
    statusSelect.lastChild.onchange = e => { lead.classification = e.target.value; persist(); report('Updated lead status.'); };
    const dueField = field('Follow-up Date', 'due', lead.due, { type: 'date' });
    dueField.lastChild.onchange = e => { lead.due = e.target.value; persist(); report('Updated follow-up date.'); };
    const emailInline = field('Primary Outreach Email', 'email', lead.email, { type: 'email', placeholder: 'Add email…' });
    emailInline.lastChild.onchange = e => { lead.email = e.target.value.trim(); persist(); report('Updated email.'); };
    const notesField = field('Review Notes', 'about', lead.about, { type: 'textarea', maxLength: 6000, placeholder: 'Observations or call notes…' });
    notesField.lastChild.style.minHeight = '80px';
    notesField.lastChild.onchange = e => { lead.about = e.target.value.trim(); persist(); report('Saved notes.'); };
    crmCard.append(emailInline, statusSelect, dueField, notesField);

    tabBody.append(ovCard, crmCard);
  } else if (dossierTab === 'tech') {
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
    const addSig = (label, ok) => { if (ok !== undefined) signalList.append(create('span', (ok ? '✓ ' : '✗ Missing: ') + label, ok ? 'pill' : 'pill warn')); };
    if (lead.website) {
      addSig('HTTPS Security', sig.https ?? lead.website.startsWith('https://'));
      addSig('SEO Meta Description', sig.hasMetaDescription);
      addSig('Booking / Lead Form', sig.hasBookingOrForm);
      addSig('Live Chat / WhatsApp', sig.hasChatWidget);
      addSig('Analytics / Ad Pixel', sig.hasAnalytics);
      addSig('Product Reviews App', sig.hasReviewsApp);
    } else {
      signalList.append(create('span', '✗ Missing: Official Website', 'pill warn'));
    }
    if (!lead.email) signalList.append(create('span', '✗ Missing: Public Email', 'pill warn'));
    sigCard.append(signalList);
    tabBody.append(webCard, sigCard);
  } else if (dossierTab === 'insights') {
    const metaCard = create('article', '', 'surface dossier-card');
    metaCard.append(create('h2', 'Scraped Listing Metadata'));
    const kv = create('div', '', 'kv-grid');
    kv.append(
      kvItem('Star Rating & Reviews', [lead.rating && `★ ${lead.rating}`, lead.ratingInfo].filter(Boolean).join(' · ') || 'None'),
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
        item.append(info, button('Open in Inbox', () => { selectedInboxKey = threadKey(conv); location.hash = '#inbox'; }, true));
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
    const genBtn = button(lead.aiBrief ? 'Regenerate AI Analysis' : 'Generate AI Lead Brief & Pitch', async event => {
      const btn = event.currentTarget;
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
        lead.aiBrief = await api('/api/analyze', { lead });
        persist();
        report(`Generated AI lead brief for ${lead.name}.`);
      } catch (error) {
        report(error.message, true);
        btn.disabled = false;
        btn.textContent = 'Generate AI Lead Brief & Pitch';
      }
    });
    aiHeader.append(create('h2', 'AI Lead Intelligence & Professional Pitch'), genBtn);
    aiCard.append(aiHeader);

    if (lead.aiBrief) {
      const ovSec = create('div', '', 'ai-section');
      ovSec.append(create('h3', 'Business Positioning & Overview'), create('p', lead.aiBrief.overview));
      const gapsSec = create('div', '', 'ai-section');
      gapsSec.append(create('h3', 'What They Are Missing (Opportunities)'));
      const ul = create('ul');
      for (const g of lead.aiBrief.gaps || []) ul.append(create('li', g));
      gapsSec.append(ul);
      const angSec = create('div', '', 'ai-section');
      angSec.append(create('h3', 'Recommended Strategy'), create('p', lead.aiBrief.angle));
      const pitchSec = create('div', '', 'ai-section stack');
      pitchSec.append(
        create('h3', 'Outreach Pitch Preview'),
        create('strong', 'Subject: ' + lead.aiBrief.pitchSubject),
        create('div', lead.aiBrief.pitchBody, 'pitch-preview'),
        button('Use this pitch & Draft Email', () => compose(lead, null, null, { subject: lead.aiBrief.pitchSubject, body: lead.aiBrief.pitchBody }))
      );
      aiCard.append(ovSec, gapsSec, angSec, pitchSec);
    } else {
      aiCard.append(empty('✦', 'Ready to analyze ' + lead.name, 'Click "Generate AI Lead Brief & Pitch" to evaluate digital gaps and generate a tailored email.'));
    }
    tabBody.append(aiCard);
  }

  container.replaceChildren(navBar, headerGrid, tabsBar, tabBody);
}

/* ---------------- EMAIL BROADCAST (Figma Email Broadcast) ---------------- */
function getBroadcastAudienceLeads(type) {
  if (type === 'new') return leads.filter(l => l.email && !blocked(l.email) && !(l.threads?.length));
  if (type === 'due') return leads.filter(l => l.email && !blocked(l.email) && leadStatus(l) === 'Follow-up due');
  if (type === 'shopify') return leads.filter(l => l.email && !blocked(l.email) && l.platform === 'Shopify');
  return leads.filter(l => l.email && !blocked(l.email));
}

function renderBroadcast() {
  const container = $('#broadcast-content');
  if (!container) return;

  const top = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(create('h1', 'Email Broadcast'), create('p', 'Reach out to your saved leads with personalised 1-to-1 Gmail messages.'));
  top.append(titleWrap, button('Manage Templates', () => { location.hash = '#settings'; }, true));

  const grid = create('div', '', 'broadcast-grid');

  // Left: Templates Picker
  const leftCard = create('article', '', 'surface card-pad');
  leftCard.append(create('h2', 'Templates'));
  const tplList = create('div', '', 'stack');
  const currentTpl = settings.templates.find(t => t.id === selectedBroadcastTplId) || settings.templates[0];
  selectedBroadcastTplId = currentTpl.id;

  settings.templates.forEach(tpl => {
    const item = create('button', '', 'tpl-pick' + (tpl.id === selectedBroadcastTplId ? ' active' : ''));
    item.type = 'button';
    const textWrap = create('div');
    textWrap.append(create('strong', tpl.name), create('small', tpl.desc || tpl.subject));
    item.append(textWrap, create('span', '›', 'small'));
    item.onclick = () => { selectedBroadcastTplId = tpl.id; renderBroadcast(); };
    tplList.append(item);
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
            to: lead.email,
            subject: finalSubj,
            body: finalBody,
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
      persist();
      report(`Campaign finished: ${sentCount} sent, ${failedCount} failed.`);
    }
  );
  sendBtn.disabled = broadcastSending || !targetLeads.length;
  if (!account.mailbox) {
    progressText.textContent = 'Connect your Gmail account in Settings to send campaigns.';
  }

  rightCard.append(tplSelect, audSelect, subjectInput, bodyInput, progressText, sendBtn);
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
  const statusPill = account.mailbox
    ? create('span', '● Connected: ' + account.mailbox, 'pill')
    : create('span', 'Gmail not connected', 'pill wait');
  const titleRow = create('div', '', 'actions');
  titleRow.append(create('h1', 'Outreach Inbox'), statusPill);
  titleWrap.append(titleRow);
  const topActions = create('div', '', 'actions');
  topActions.append(button(refreshing ? 'Refreshing…' : 'Refresh Inbox', () => refresh(true), true));
  top.append(titleWrap, topActions);

  if (!account.mailbox) {
    container.replaceChildren(top, empty('✉', 'Connect your Gmail account', 'Go to Settings to connect your Gmail account and view replies here.'));
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
    itemsWrap.append(empty('✉', 'No conversations', 'Send an email to a lead to start a thread.'));
  }
  listPane.append(tabsRow, itemsWrap);

  // Right Thread Pane
  const threadPane = create('div', '', 'inbox-thread-pane');
  const activeEntry = allItems.find(item => threadKey(item.conversation) === selectedInboxKey) || filteredItems[0];
  if (!activeEntry) {
    threadPane.append(empty('✉', 'Select a conversation', 'Pick a thread from the left to read messages and reply.'));
  } else {
    const { lead, conversation } = activeEntry;
    const threadHead = create('div', '', 'heading');
    threadHead.style.margin = '0';
    threadHead.append(create('h2', conversation.subject), classify(lead, conversation));

    const threadMsgs = messages.get(threadKey(conversation)) || [];
    const msgsWrap = create('div', '', 'inbox-messages');
    if (threadMsgs.length) {
      for (const m of threadMsgs) {
        const mail = create('article', '', 'mail' + (m.sent ? ' outgoing' : ''));
        mail.append(
          create('h3', m.sent ? `You → ${m.to || conversation.to || lead.email}` : m.from),
          create('small', new Date(m.time).toLocaleString()),
          create('p', m.body)
        );
        msgsWrap.append(mail);
      }
    } else {
      msgsWrap.append(create('p', 'Loading thread messages… (or click Refresh Inbox)', 'small'));
    }

    const replyForm = create('form', '', 'stack');
    const replyBox = create('textarea');
    replyBox.placeholder = `Reply to ${lead.name}…`;
    replyBox.style.minHeight = '90px';
    replyBox.required = true;
    const replyActions = create('div', '', 'actions');
    const sendReplyBtn = create('button', 'Send Reply');
    replyActions.append(sendReplyBtn, button('View Business Dossier', () => openBusinessPage(lead), true));
    replyForm.append(replyBox, replyActions);
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
          requestId: crypto.randomUUID(),
          threadId: conversation.id,
          parentId: replyTarget?.id
        });
        replyBox.value = '';
        await syncThread(lead, conversation);
        if (currentUser?.usage) currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
        persist();
        report(`Reply sent to ${lead.name}.`);
      } catch (err) {
        report(err.message, true);
      } finally {
        sendReplyBtn.disabled = false;
        sendReplyBtn.textContent = 'Send Reply';
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
    { key: 'basic', label: 'Basic', searches: '50', emails: '10', dailySearchLimit: 50, dailyEmailLimit: 10 },
    { key: 'silver', label: 'Silver', searches: '120', emails: '30', dailySearchLimit: 120, dailyEmailLimit: 30 },
    { key: 'gold', label: 'Gold', searches: '300', emails: '50', dailySearchLimit: 300, dailyEmailLimit: 50 },
    { key: 'premium', label: 'Premium', searches: '500', emails: '100', dailySearchLimit: 500, dailyEmailLimit: 100 },
    { key: 'diamond', label: 'Diamond', searches: 'Unlimited', emails: 'Unlimited', dailySearchLimit: null, dailyEmailLimit: null }
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

  const topHeader = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(create('h1', 'Your Profile & Usage'), create('p', 'Manage your account and track your daily search & outreach quotas.'));
  topHeader.append(titleWrap, create('span', `● ${activeTier.label} Plan`, 'pill'));

  const topGrid = create('div', '', 'grid-2');
  topGrid.style.marginBottom = '18px';

  const userCard = create('article', '', 'surface dossier-hero-card');
  const uInfo = create('div', '', 'stack');
  uInfo.style.gap = '4px';
  uInfo.append(
    create('h2', currentUser?.name || settings.senderName || 'Jobhunta User'),
    create('p', currentUser?.email || '', 'small'),
    create('span', `● ${activeTier.label} Tier · ID: ${String(currentUser?.id || '').slice(0, 8)}`, 'pill')
  );
  userCard.append(makeAvatar(currentUser?.name || currentUser?.email || 'U', true), uInfo);

  const planCard = create('article', '', 'surface card-pad');
  const pCols = create('div', '', 'grid-2');
  const c1 = create('div'); c1.append(create('small', 'Current Plan', 'small'), create('h2', activeTier.label));
  const c2 = create('div'); c2.append(create('small', 'Daily Quota Reset', 'small'), create('h2', '00:00 UTC'));
  pCols.append(c1, c2);
  planCard.append(pCols);
  topGrid.append(userCard, planCard);

  const botGrid = create('div', '', 'dash-bot');
  const usageCard = create('article', '', 'surface card-pad');
  usageCard.append(create('h2', `Usage Overview (${usage.usageDate || 'Today'})`));
  const addMeter = (title, used, limit) => {
    const wrap = create('div');
    const isUnlimited = limit === null || limit === undefined;
    const labelText = isUnlimited ? `${used} / Unlimited` : `${used} / ${limit}`;
    const rowTop = create('div', '', 'stat-row');
    rowTop.style.border = '0'; rowTop.style.padding = '0';
    rowTop.append(create('span', title), create('strong', labelText));
    const meter = create('div', '', 'meter');
    const fill = create('div', '', 'meter-fill');
    fill.style.width = (isUnlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100))) + '%';
    if (!isUnlimited && used >= limit) fill.style.background = '#b91c1c';
    meter.append(fill);
    wrap.append(rowTop, meter);
    return wrap;
  };
  usageCard.append(
    addMeter('Searches Used Today', usage.searchesToday || 0, activeTier.dailySearchLimit),
    addMeter('Emails Sent Today', usage.emailsToday || 0, activeTier.dailyEmailLimit),
    addMeter('Saved Leads in Workspace', leads.length, null)
  );

  const compCard = create('article', '', 'surface card-pad');
  compCard.append(create('h2', 'Plan Comparison'));
  const tWrap = create('div', '', 'data-table-wrap');
  const tbl = create('table', '', 'plan-table');
  const thead = create('thead');
  const hRow = create('tr');
  hRow.append(create('th', 'Quota'));
  for (const t of tierList) {
    const th = create('th', t.label, t.key === activeTier.key ? 'col-active' : '');
    hRow.append(th);
  }
  thead.append(hRow);
  const tbody = create('tbody');
  const makeRow = (label, getter) => {
    const r = create('tr');
    r.append(create('td', label));
    for (const t of tierList) r.append(create('td', getter(t), t.key === activeTier.key ? 'col-active' : ''));
    return r;
  };
  tbody.append(
    makeRow('Searches / Day', t => t.searches),
    makeRow('Emails / Day', t => t.emails),
    makeRow('AI Lead Briefs', () => '✓'),
    makeRow('Supabase Sync', () => '✓')
  );
  tbl.append(thead, tbody);
  tWrap.append(tbl);
  compCard.append(tWrap);

  botGrid.append(usageCard, compCard);
  container.replaceChildren(topHeader, topGrid, botGrid);
}

/* ---------------- SETTINGS (Figma 2-Col Auto-Saving Grid, No Save Button) ---------------- */
function renderSettings() {
  const container = $('#settings-content');
  if (!container) return;

  const topHeader = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', 'Settings'),
    create('p', 'Configure your integrations, sender profile, and outreach templates (auto-saves).')
  );
  topHeader.append(titleWrap);

  const grid = create('div', '', 'grid-2');

  // 1. Gmail Integration Card
  const gmailCard = create('article', '', 'surface card-pad');
  const gHead = create('div', '', 'heading');
  gHead.style.margin = '0';
  gHead.append(create('h2', 'Gmail Integration'), create('span', account.mailbox ? '● Connected' : 'Not Connected', account.mailbox ? 'pill' : 'pill wait'));
  gmailCard.append(gHead);
  const expectedUri = account.redirectUri || (location.origin + '/oauth/callback');
  if (account.mailbox) {
    gmailCard.append(
      kvItem('Connected Mailbox', account.mailbox),
      button('Disconnect Gmail', async () => {
        try { await api('/api/disconnect', {}); account.mailbox = null; messages.clear(); renderAccount(); report('Disconnected Gmail.'); }
        catch (e) { report(e.message, true); }
      }, 'danger')
    );
  } else {
    const connectBtn = button('Connect Gmail →', async event => {
      const btn = event.currentTarget;
      btn.disabled = true; btn.textContent = 'Redirecting…';
      try { location.assign((await api('/api/connect', {})).url); }
      catch (e) { btn.disabled = false; btn.textContent = 'Connect Gmail →'; report(e.message, true); }
    });
    const copyUriBtn = button('Copy Redirect URI', async e => {
      try { await navigator.clipboard.writeText(expectedUri); e.currentTarget.textContent = 'Copied!'; } catch {}
    }, true);
    const acts = create('div', '', 'actions');
    acts.append(connectBtn, copyUriBtn);
    gmailCard.append(
      kvItem('OAuth Client ID', account.clientId || 'Configure GOOGLE_CLIENT_ID'),
      kvItem('Authorized Redirect URI', expectedUri),
      acts
    );
  }

  // 2. Supabase Cloud Sync Card
  const sbCard = create('article', '', 'surface card-pad');
  const sbHead = create('div', '', 'heading');
  sbHead.style.margin = '0';
  sbHead.append(
    create('h2', 'Supabase Cloud Sync'),
    create('span', account.supabase?.connected ? '● Connected' : 'Local Mode', account.supabase?.connected ? 'pill' : 'pill wait')
  );
  sbCard.append(
    sbHead,
    create('p', account.supabase?.connected
      ? 'Your leads, AI briefs, templates, and daily usage are synced with Supabase Postgres.'
      : (account.supabase?.error || 'Add SUPABASE_URL and SUPABASE_ANON_KEY to enable cloud sync.'), 'small'),
    create('div', '', 'actions')
  );
  sbCard.lastChild.append(button('Import CSV', importLeads, true), button('Export CSV', exportLeads, true));

  // 3. Sender Profile & Outreach Defaults (Auto-Saving, NO Save Button)
  const profCard = create('article', '', 'surface card-pad');
  profCard.append(create('h2', 'Sender Profile & Outreach Defaults'));
  const sName = field('Your Name', 'senderName', settings.senderName, { placeholder: 'Ayoola Adebisi' });
  const sService = field('Your Service / Offer (used by AI Pitch)', 'senderService', settings.senderService, { placeholder: 'Shopify CRO, web design & local SEO' });
  const sDays = field('Default Follow-up Reminder (days)', 'defaultFollowUpDays', String(settings.defaultFollowUpDays ?? 4), { type: 'number' });
  const autoSave = () => {
    settings.senderName = sName.lastChild.value.trim();
    settings.senderService = sService.lastChild.value.trim();
    settings.defaultFollowUpDays = Math.max(0, Math.min(90, Number(sDays.lastChild.value) || 0));
    if (currentUser?.id) {
      localStorage.setItem(userSettingsKey(currentUser.id), JSON.stringify(settings));
      syncWorkspaceToServer();
    }
    renderDashboard();
  };
  sName.lastChild.onchange = autoSave;
  sService.lastChild.onchange = autoSave;
  sDays.lastChild.onchange = autoSave;
  profCard.append(sName, sService, sDays);

  // 4. Email Templates Card (Auto-Saving)
  const tplCard = create('article', '', 'surface card-pad');
  const tplHead = create('div', '', 'heading');
  tplHead.style.margin = '0';
  tplHead.append(create('h2', 'Email Templates'), create('span', 'Auto-saves', 'small'));
  const tplsWrap = create('div', '', 'stack');
  function renderTplCards() {
    tplsWrap.replaceChildren();
    settings.templates.forEach((tpl, idx) => {
      const box = create('div', '', 'template-card');
      const nf = field('Template Name', `tn_${idx}`, tpl.name);
      nf.lastChild.onchange = e => { tpl.name = e.target.value.trim() || 'Untitled'; autoSave(); };
      const sf = field('Subject', `ts_${idx}`, tpl.subject);
      sf.lastChild.onchange = e => { tpl.subject = e.target.value.trim(); autoSave(); };
      const bf = field('Body', `tb_${idx}`, tpl.body, { type: 'textarea' });
      bf.lastChild.style.minHeight = '90px';
      bf.lastChild.onchange = e => { tpl.body = e.target.value.trim(); autoSave(); };
      box.append(nf, sf, bf);
      if (settings.templates.length > 1) {
        box.append(button('Remove', () => { settings.templates.splice(idx, 1); autoSave(); renderTplCards(); }, 'danger'));
      }
      tplsWrap.append(box);
    });
  }
  renderTplCards();
  tplCard.append(tplHead, tplsWrap, button('+ Add Template', () => {
    settings.templates.push({ id: crypto.randomUUID(), name: 'New Template', subject: 'Quick question for {{business_name}}', body: 'Hi {{business_name}} team,\n\nI’m {{your_name}}...\n\nThanks,\n{{your_name}}' });
    autoSave();
    renderTplCards();
  }, true));

  grid.append(gmailCard, sbCard, profCard, tplCard);
  container.replaceChildren(topHeader, grid);
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
  form.append(tplWrapper, to, subject, body, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (!values.body.trim() || !values.subject.trim() || /\[(?:your |specific )|\{\{[^}]+\}\}/.test(values.body)) {
      feedback.textContent = 'Complete the subject and replace any template placeholders.'; return;
    }
    if (blocked(values.to)) { feedback.textContent = 'Address is unsubscribed or bounced.'; return; }
    submit.disabled = true; feedback.textContent = 'Sending…';
    try {
      const sent = await api('/api/send', { ...values, requestId, threadId: conversation?.id, parentId: parent?.id });
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

/* ---------------- EVENT WIRING & NAVIGATION ---------------- */
$('#header-settings-btn').onclick = () => { location.hash = '#settings'; };
$('#header-avatar-btn').onclick = () => { location.hash = '#profile'; };
$('#header-bell-btn').onclick = () => { jumpToLeadsFilter('Follow-up due'); };
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
  renderResults(); updateScrapeBanner();
};

$('#search').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const generation = ++searchGeneration;
  activeWorkers = 0; results = []; resultsPage = 1; streamActive = true;
  currentScrapeStep = 'Connecting to Bing Maps…';
  submit.disabled = true; report(); updateScrapeBanner();
  $('#save-all').hidden = true; $('#results-pagination').hidden = true; $('#results-count').textContent = '';
  $('#results').replaceChildren(empty('⌕', 'Scraping live from Bing Maps…', 'Businesses will appear here in real time as each page is scraped.'));

  try {
    const params = new URLSearchParams(new FormData(form));
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
            results.push(msg.item); renderResults(); updateScrapeBanner(); triggerEnrichmentWorkers(generation);
          }
        } else if (msg.type === 'error') throw new Error(msg.error);
      }
    }
    if (generation === searchGeneration && !results.length) {
      $('#results').replaceChildren(empty('⌕', 'No matching businesses', 'Try a nearby city or another industry.'));
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (!results.length) $('#results').replaceChildren(empty('⌕', 'Search unavailable', error.message));
      else report(error.message, true);
    }
  } finally {
    if (generation === searchGeneration) { streamActive = false; searchController = null; updateScrapeBanner(); }
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
  finally { submit.disabled = false; submit.textContent = 'Comb URL & Open Dossier ✦'; }
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
$('#filter-query').oninput = renderLeads;
$('#filter-status').onchange = renderLeads;
$('#filter-platform').onchange = renderLeads;
$('#filter-sort').onchange = renderLeads;
window.addEventListener('hashchange', navigate);
$('#results').replaceChildren(empty('⌕', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));

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
  $('#auth-password').autocomplete = isSignup ? 'new-password' : 'current-password';
  $('#auth-submit').textContent = isSignup ? 'Create Account' : 'Sign In';
  $('#auth-switch-text').textContent = isSignup ? 'Already have an account?' : "Don't have an account?";
  $('#auth-switch-btn').textContent = isSignup ? 'Sign In' : 'Create Account';
  $('#auth-error').hidden = true;
}

$('#toggle-password').onclick = () => {
  const input = $('#auth-password');
  input.type = input.type === 'password' ? 'text' : 'password';
};
$('#tab-login').onclick = () => setAuthMode('login');
$('#tab-signup').onclick = () => setAuthMode('signup');
$('#auth-switch-btn').onclick = () => setAuthMode(authMode === 'login' ? 'signup' : 'login');

function applyUserSession(user, serverLeads = [], serverSettings = {}, serverMailbox = null) {
  currentUser = user;
  account.user = user;
  account.mailbox = serverMailbox;
  document.body.classList.remove('auth-locked');

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

  results = []; resultsPage = 1; activeBusinessId = null; selectedInboxKey = null; messages.clear();
  $('#results').replaceChildren(empty('⌕', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));
  $('#save-all').hidden = true; $('#results-pagination').hidden = true; $('#results-count').textContent = '';

  persist();
  renderAccount();
  navigate();
  refresh();
}

function showAuthScreen() {
  currentUser = null; leads = []; results = []; activeBusinessId = null; selectedInboxKey = null; messages.clear();
  setAuthMode('login');
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

try {
  account = await api('/api/status');
  const datalist = $('#industries');
  datalist.replaceChildren(...account.industries.map(industry => new Option(industry, industry)));
  if (account.user) applyUserSession(account.user, account.leads, account.settings, account.mailbox);
  else showAuthScreen();
  setInterval(() => { if (currentUser && !document.hidden) refresh(); }, 60000);
} catch (error) { report(error.message, true); }
