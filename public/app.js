import { platformDomains, searchList, googleQueries } from './discovery.mjs';
import { readBusinessCsv, writeBusinessCsv } from './csv.mjs';

const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const pageSize = 20;

const defaultTemplates = [
  {
    id: 'intro',
    name: 'Initial introduction',
    subject: 'Quick introduction to {{business_name}}',
    body: 'Hi {{business_name}} team,\n\nI’m {{your_name}}. I help businesses with {{your_service}}. I came across your business in {{city}} and wanted to introduce myself.\n\nWould you be open to a short conversation about {{specific_opportunity}}?\n\nThanks,\n{{your_name}}'
  },
  {
    id: 'followup',
    name: 'Friendly follow-up',
    subject: 'Re: Quick introduction to {{business_name}}',
    body: 'Hi {{business_name}} team,\n\nI wanted to quickly follow up on my previous note in case it got buried. Would you be open to a brief chat this week about how I can help with {{your_service}}?\n\nBest regards,\n{{your_name}}'
  },
  {
    id: 'value',
    name: 'Direct value pitch',
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

const stages = { prospect: 'Prospect', qualified: 'Qualified', contacted: 'Contacted',
  replied: 'Replied', booked: 'Booked', won: 'Won', lost: 'Lost' };
const stageOf = lead => lead.stage || (lead.replied ? 'replied' : lead.threads?.length ? 'contacted' : 'prospect');

const userLeadsKey = userId => `jobhunta.leads.v2.${userId}`;
const userSettingsKey = userId => `jobhunta.settings.v2.${userId}`;

let account = {};
let results = [];
let resultsPage = 1;
let activeBusinessId = null;
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

let workspaceSync = Promise.resolve();

function syncWorkspaceToServer() {
  if (!currentUser?.id) return;
  const userId = currentUser.id;
  const snapshot = JSON.parse(JSON.stringify({ userId, leads, settings }));
  workspaceSync = workspaceSync.then(async () => {
    if (currentUser?.id !== userId) return;
    await api('/api/workspace', snapshot);
  }).catch(error => {
    if (currentUser?.id === userId) report('Workspace could not be saved: ' + error.message, true);
  });
}

function persist({ sync = true } = {}) {
  if (currentUser?.id) {
    localStorage.setItem(userLeadsKey(currentUser.id), JSON.stringify(leads));
    localStorage.setItem(userSettingsKey(currentUser.id), JSON.stringify(settings));
    if (sync) syncWorkspaceToServer();
  }
  renderDashboard();
  renderLeads();
  renderInbox();
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

function row(item, details, actions, onSelect) {
  const card = create('article', '', 'surface row' + (onSelect ? ' clickable' : ''));
  const summary = create('div', '', onSelect ? 'card-summary' : '');
  summary.append(create('h3', item.name), create('p', details.filter(Boolean).join(' · ')));
  if (item.about) {
    summary.append(create('p', item.about, 'note'));
  }
  if (onSelect) {
    summary.tabIndex = 0;
    summary.setAttribute('role', 'button');
    summary.setAttribute('aria-label', 'View details for ' + item.name);
    summary.onclick = onSelect;
    summary.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect();
      }
    };
  }
  const controls = create('div', '', 'actions');
  controls.append(...actions.filter(Boolean));
  card.append(summary, controls);
  return card;
}

function applyEnrichmentToItem(item, found) {
  if (found.email && !item.email) item.email = found.email;
  if (found.phone && !item.phone) {
    item.phone = found.phone;
    item.phoneSource = found.phoneSource;
  }
  if (found.website && Array.isArray(found.emails)) {
    item.emailSources = { ...item.emailSources };
    for (const email of found.emails) item.emailSources[norm(email)] = found.emailSources?.[email] || found.website;
  }
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
  const pendingWebsites = results.filter(item => item.website && (!item.email || item.targetPlatform) && !item.scanned && !item.scanning).length;
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
    triggerButton.textContent = 'Combing website…';
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
      report(`Scanned ${item.name}'s website; no public email address listed on the page.`, true);
      if (triggerButton) triggerButton.textContent = 'Website scanned';
    }
  } catch (error) {
    item.scanned = true;
    report(error.message, true);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = 'Have a look (Comb website)';
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
        // Ignore individual site timeouts during background crawl
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
    const copy = { ...item, id: item.id || crypto.randomUUID(), threads: [] };
    delete copy.scanning;
    delete copy.scanned;
    leads.unshift(copy);
    persist();
    saved = copy;
  }
  activeBusinessId = saved.id;
  location.hash = '#business';
  renderBusinessPage();
}

function jumpToLeadsFilter(statusValue = '') {
  const select = $('#filter-status');
  if (select) select.value = statusValue;
  location.hash = '#leads';
  renderLeads();
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

function renderDashboard() {
  const container = $('#dashboard-content');
  if (!container) return;

  const counts = {
    total: leads.length,
    ready: 0,
    needsEmail: 0,
    contacted: 0,
    due: 0,
    positive: 0,
    aiAudited: 0
  };
  const industryCounts = new Map();
  const cityCounts = new Map();

  for (const lead of leads) {
    const st = leadStatus(lead);
    if (st === 'New') counts.ready++;
    if (st === 'Needs email') counts.needsEmail++;
    if (st === 'Contacted' || (lead.threads || []).length) counts.contacted++;
    if (st === 'Follow-up due') counts.due++;
    if (st === 'Interested' || st === 'Replied') counts.positive++;
    if (lead.aiBrief) counts.aiAudited++;
    if (lead.industry) industryCounts.set(lead.industry, (industryCounts.get(lead.industry) || 0) + 1);
    if (lead.city) cityCounts.set(lead.city, (cityCounts.get(lead.city) || 0) + 1);
  }

  const headerBar = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', 'Workspace Dashboard'),
    create('p', settings.senderName
      ? `Welcome back, ${settings.senderName}. Offering: ${settings.senderService || 'Set your service in Broadcast'}.`
      : 'Overview of your scraped business pipeline, AI lead audits, and outreach conversations.')
  );
  const quickActions = create('div', '', 'actions');
  quickActions.append(
    button('Find businesses ↗', () => { location.hash = '#discover'; }),
    button('Import CSV', importLeads, true),
    button('Add lead', () => editLead(), true)
  );
  headerBar.append(titleWrap, quickActions);

  const kpiGrid = create('div', '', 'kpi-grid');
  const makeKpi = (label, value, subtext, filterTarget) => {
    const card = create('article', '', 'surface kpi-card');
    card.append(create('small', label), create('strong', String(value)), create('span', subtext));
    card.onclick = () => jumpToLeadsFilter(filterTarget);
    return card;
  };
  kpiGrid.append(
    makeKpi('Total Saved Leads', counts.total, 'View all saved businesses →', ''),
    makeKpi('Ready to Email', counts.ready, 'Has email · Not contacted →', 'New'),
    makeKpi('Needs Email', counts.needsEmail, 'Scan websites for email →', 'Needs email'),
    makeKpi('Contacted', counts.contacted, 'Outreach sent via Gmail →', 'Contacted'),
    makeKpi('Follow-ups Due', counts.due, 'Needs follow-up today →', 'Follow-up due'),
    makeKpi('Interested / Replied', counts.positive, 'Warm leads & replies →', 'Interested')
  );

  const dashboardGrid = create('div', '', 'dossier-grid');

  // Left card: Priority Action Queue (Follow-ups due + Warm replies + Ready to review)
  const queueCard = create('article', '', 'surface dossier-card');
  queueCard.append(create('h2', 'Priority Follow-ups & Warm Leads'));
  const priorityLeads = leads.filter(lead => {
    const st = leadStatus(lead);
    return st === 'Follow-up due' || st === 'Replied' || st === 'Interested';
  }).slice(0, 6);

  if (priorityLeads.length) {
    for (const lead of priorityLeads) {
      const st = leadStatus(lead);
      queueCard.append(row(lead, [lead.industry, lead.city, lead.email, lead.due && 'Due ' + lead.due], [
        create('span', st, statusPillClass(st)),
        button('Open dossier', () => openBusinessPage(lead), true),
        button('Email', () => compose(lead))
      ], () => openBusinessPage(lead)));
    }
  } else {
    queueCard.append(empty('✉', 'No urgent follow-ups due', 'When a lead replies or reaches its follow-up date, it will appear here.'));
  }

  // Right card: Pipeline & Market Breakdown
  const statsCard = create('article', '', 'surface dossier-card');
  statsCard.append(create('h2', 'Pipeline & AI Audit Overview'));
  const statsList = create('div');
  const addStatRow = (label, val) => {
    const r = create('div', '', 'stat-row');
    r.append(create('span', label), create('strong', String(val)));
    statsList.append(r);
  };
  addStatRow('Gmail Connection', account.mailbox ? `Connected (${account.mailbox})` : 'Not connected');
  addStatRow('Database Storage', account.supabase?.connected ? 'Supabase Cloud Connected' : (account.supabase?.configured ? 'Supabase (Pending SQL setup)' : 'Local Storage'));
  addStatRow('Leads with Verified Email', leads.filter(l => l.email).length);
  addStatRow('Shopify / E-commerce Stores', leads.filter(l => l.platform === 'Shopify' || l.platform === 'WooCommerce').length);
  addStatRow('Leads with Social Media Links', leads.filter(l => l.facebook || l.instagram || l.twitter || l.linkedin).length);
  addStatRow('Leads Audited with AI Pitch', counts.aiAudited);
  const topIndustries = [...industryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join(', ') || 'None yet';
  const topCities = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (${v})`).join(', ') || 'None yet';
  addStatRow('Top Categories', topIndustries);
  addStatRow('Top Cities', topCities);
  statsCard.append(statsList);

  // Full width card: Recent Businesses Ready for Review & AI Analysis
  const recentCard = create('article', '', 'surface dossier-card full');
  const recentHeader = create('div', '', 'heading');
  recentHeader.style.margin = '0';
  recentHeader.append(
    create('h2', 'Recent Businesses Ready for Review'),
    leads.length ? button('View all leads →', () => { location.hash = '#leads'; }, true) : ''
  );
  recentCard.append(recentHeader);

  if (leads.length) {
    for (const lead of leads.slice(0, 6)) {
      const st = leadStatus(lead);
      recentCard.append(row(lead, [lead.industry, lead.city, lead.email, lead.phone, lead.address], [
        create('span', st, statusPillClass(st)),
        lead.aiBrief ? create('span', '✦ AI Pitch Ready', 'pill') : '',
        button('Review dossier & AI pitch →', () => openBusinessPage(lead), true),
        button('Draft email', () => compose(lead))
      ], () => openBusinessPage(lead)));
    }
  } else {
    recentCard.append(empty('⌕', 'Your pipeline is empty', 'Click "Find businesses" to scrape local leads from Bing Maps or import a CSV.'));
  }

  dashboardGrid.append(queueCard, statsCard, recentCard);
  container.replaceChildren(headerBar, kpiGrid, dashboardGrid);
}

function getVisibleSearchResults() {
  const mode = $('#results-filter')?.value || '';
  if (mode === 'no-website') return results.filter(item => !item.website);
  if (mode === 'has-email') return results.filter(item => item.email);
  if (mode === 'qualified') return results.filter(item => duplicate(item)?.finding?.confirmed);
  if (mode === 'target-platform') return results.filter(item => item.targetPlatform &&
    (item.platform === item.targetPlatform || item.techStack?.includes(item.targetPlatform)));
  if (mode === 'shopify') return results.filter(item => item.platform === 'Shopify');
  if (mode === 'ecommerce') return results.filter(item => item.platform === 'Shopify' || item.platform === 'WooCommerce');
  if (mode === 'low') return results.filter(item => (item.searchRank || 0) >= 21);
  return results;
}

function renderResults() {
  const visibleResults = getVisibleSearchResults();
  const saveAllBtn = $('#save-all');
  saveAllBtn.hidden = results.length === 0;
  saveAllBtn.textContent = 'Save all ' + results.length + ' to folder';
  const withEmailCount = results.filter(item => item.email).length;
  const shopifyCount = results.filter(item => item.platform === 'Shopify').length;
  const countEl = $('#results-count');
  if (countEl) {
    countEl.textContent = results.length
      ? `(${visibleResults.length}/${results.length} shown · ${shopifyCount} Shopify · ${withEmailCount} with email)`
      : '';
  }

  const paginationEl = $('#results-pagination');
  if (!visibleResults.length) {
    if (paginationEl) paginationEl.hidden = true;
    if (results.length) {
      $('#results').replaceChildren(empty('⌕', 'No matching results for this filter yet', streamActive ? 'Still scanning websites in the background…' : 'Switch filter to "Show all scraped results" to view all businesses.'));
    }
    return;
  }

  const totalPages = Math.max(1, Math.ceil(visibleResults.length / pageSize));
  if (resultsPage > totalPages) resultsPage = totalPages;
  if (resultsPage < 1) resultsPage = 1;
  const startIndex = (resultsPage - 1) * pageSize;
  const pageItems = visibleResults.slice(startIndex, startIndex + pageSize);

  $('#results').replaceChildren(...pageItems.map(item => {
    const saved = duplicate(item);
    const save = button(saved ? 'Open lead' : 'Save lead', () => {
      if (saved) {
        openBusinessPage(saved);
        return;
      }
      const copy = { ...item, threads: [] };
      delete copy.scanning;
      delete copy.scanned;
      leads.unshift(copy);
      persist();
      renderResults();
    });
    const rankPill = item.searchRank
      ? create('span', `Rank #${item.searchRank}`, item.searchRank >= 21 ? 'pill wait' : 'pill')
      : '';
    const statusPill = item.email
      ? create('span', 'Email found', 'pill')
      : item.scanning
        ? create('span', 'Scanning website…', 'pill wait')
        : create('span', 'Needs email', 'pill wait');
    const enrichBtn = (!item.email && item.website && !item.scanning && !item.scanned)
      ? button('Find email', event => enrichItemEmail(item, event.currentTarget), true)
      : '';
    const platformPill = (item.platform && item.platform !== 'Custom / Website')
      ? create('span', [item.platform, item.platformConfidence].filter(Boolean).join(' · '), 'pill')
      : '';
    return row(item, [item.discoveryProvider, item.industry, item.city, item.address, item.email, item.phone], [
      rankPill,
      platformPill,
      statusPill,
      enrichBtn,
      website(item.website, 'Website'),
      ...socialLinks(item),
      website(item.source, 'Bing Maps'),
      save
    ], () => openBusinessPage(item));
  }));

  if (paginationEl) {
    if (visibleResults.length > pageSize) {
      paginationEl.hidden = false;
      const startNum = startIndex + 1;
      const endNum = Math.min(visibleResults.length, startIndex + pageSize);
      const info = create('span', `Showing ${startNum}–${endNum} of ${visibleResults.length} businesses (Page ${resultsPage} of ${totalPages})`, 'small');
      const controls = create('div', '', 'actions');
      const prevBtn = button('← Previous page', () => {
        if (resultsPage > 1) {
          resultsPage--;
          renderResults();
          $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, true);
      prevBtn.disabled = resultsPage <= 1;
      const nextBtn = button('Next page →', () => {
        if (resultsPage < totalPages) {
          resultsPage++;
          renderResults();
          $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      nextBtn.disabled = resultsPage >= totalPages;
      controls.append(prevBtn, nextBtn);
      paginationEl.replaceChildren(info, controls);
    } else {
      paginationEl.hidden = true;
    }
  }
}

function getFilteredLeads() {
  const query = norm($('#filter-query')?.value);
  const statusFilter = $('#filter-status')?.value || '';
  const platformFilter = $('#filter-platform')?.value || '';
  const sortOrder = $('#filter-sort')?.value || 'recent';

  const stage = $('#filter-stage').value;
  const folder = $('#filter-folder').value;
  const filtered = leads.filter(lead => {
    if (stage && stageOf(lead) !== stage) return false;
    if (folder && !leadFolders(lead).some(name => norm(name) === folder)) return false;
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

function leadFolders(lead) {
  return Array.isArray(lead.folders) ? lead.folders.filter(name => typeof name === 'string' && name.trim()) : [];
}

function searchFolders() {
  const folders = new Map();
  for (const lead of leads) {
    for (const name of leadFolders(lead)) {
      const key = norm(name);
      const entry = folders.get(key) || { name, count: 0 };
      entry.count++;
      folders.set(key, entry);
    }
  }
  return folders;
}

function renderFolderFilter() {
  const select = $('#filter-folder');
  const selected = select.value;
  const folders = searchFolders();
  select.replaceChildren(new Option('All folders', ''));
  for (const [key, entry] of [...folders].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    select.add(new Option(entry.name + ' (' + entry.count + ')', key));
  }
  select.value = folders.has(selected) ? selected : '';
}

function renderLeads() {
  renderFolderFilter();
  const navCount = $('#nav-leads-count');
  if (navCount) {
    navCount.textContent = String(leads.length);
    navCount.hidden = leads.length === 0;
  }
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

  const strip = $('#leads-kpi-strip');
  if (strip) {
    const activeStatus = $('#filter-status')?.value || '';
    const chipCategories = [
      ['', `All (${leads.length})`],
      ['New', `New (${leads.filter(l => leadStatus(l) === 'New').length})`],
      ['Needs email', `Needs email (${leads.filter(l => leadStatus(l) === 'Needs email').length})`],
      ['Contacted', `Contacted (${leads.filter(l => leadStatus(l) === 'Contacted').length})`],
      ['Follow-up due', `Follow-up due (${leads.filter(l => leadStatus(l) === 'Follow-up due').length})`],
      ['Replied', `Replied (${leads.filter(l => leadStatus(l) === 'Replied').length})`],
      ['Interested', `Interested (${leads.filter(l => leadStatus(l) === 'Interested').length})`]
    ];
    strip.replaceChildren(...chipCategories.map(([val, label]) => {
      const chip = create('button', label, 'kpi-chip' + (activeStatus === val ? ' active' : ''));
      chip.type = 'button';
      chip.onclick = () => {
        $('#filter-status').value = val;
        renderLeads();
      };
      return chip;
    }));
  }

  const filtered = getFilteredLeads();
  const summary = $('#lead-summary');
  if (summary) {
    summary.textContent = leads.length
      ? `Showing ${filtered.length} of ${leads.length} saved lead${leads.length === 1 ? '' : 's'} — select a business name to open its dossier.`
      : '';
  }

  $('#lead-list').replaceChildren(...(filtered.length ? filtered.map(lead => {
    const status = leadStatus(lead);
    const enrichBtn = (!lead.email && lead.website)
      ? button('Find email', event => enrichItemEmail(lead, event.currentTarget), true)
      : '';
    const platformPill = (lead.platform && lead.platform !== 'Custom / Website')
      ? create('span', lead.platform, 'pill')
      : '';
    const card = create('article', '', 'surface saved-lead-card');
    const heading = create('div', '', 'saved-lead-heading');
    const name = button(lead.name, () => openBusinessPage(lead), 'saved-lead-name');
    const title = create('h3');
    title.append(name);
    const badges = create('div', '', 'actions');
    const stage = stages[stageOf(lead)];
    if (platformPill) badges.append(platformPill);
    if (stage && stage !== status) badges.append(create('span', stage, 'pill'));
    badges.append(create('span', status, statusPillClass(status)));
    if (lead.aiBrief) badges.append(create('span', 'AI Pitch', 'pill'));
    heading.append(title, badges);
    card.append(heading);

    const details = [lead.industry, lead.city, lead.email, lead.phone, lead.address,
      lead.due && 'Follow up ' + lead.due].filter(Boolean);
    if (details.length) card.append(create('p', details.join(' · '), 'saved-lead-details'));
    if (lead.about) card.append(create('p', lead.about, 'saved-lead-about'));

    const footer = create('div', '', 'saved-lead-footer');
    const links = create('div', '', 'actions saved-lead-links');
    links.append(...[website(lead.website, 'Website'), ...socialLinks(lead),
      website(lead.source, 'Listing')].filter(Boolean));
    const controls = create('div', '', 'actions');
    if (enrichBtn) controls.append(enrichBtn);
    controls.append(button('Edit', () => editLead(lead), true),
      button('Delete', () => deleteLead(lead), 'danger'),
      button('Draft email', () => compose(lead)));
    footer.append(links, controls);
    card.append(footer);
    return card;
  }) : [empty('▤', leads.length ? 'No matching leads' : 'No leads yet',
    leads.length ? 'Try clearing or changing your search and status filters.' : 'Save a business from search or add a contact manually.')]));
}

function kvItem(label, valueNodeOrText) {
  const box = create('div', '', 'kv-item');
  box.append(create('small', label));
  const val = create('div');
  if (valueNodeOrText instanceof Node) val.append(valueNodeOrText);
  else val.textContent = valueNodeOrText || 'Not listed';
  box.append(val);
  return box;
}

function renderQualification(lead) {
  const form = create('form', '', 'stack qualification');
  const stage = selectField('Pipeline stage', 'stage', stages, stageOf(lead));
  const note = field('Outreach finding', 'finding', lead.finding?.note || '', {
    type: 'textarea', maxLength: 600, placeholder: 'Example: the booking button returns an error'
  });
  const source = field('Evidence URL', 'source', lead.finding?.url || lead.website || lead.source || '', {
    type: 'url', maxLength: 1024
  });
  const status = selectField('Finding status', 'status', { draft: 'Needs verification', confirmed: 'Confirmed by me' },
    lead.finding?.confirmed ? 'confirmed' : 'draft');
  const feedback = create('p', '', 'small');
  feedback.setAttribute('role', 'status');
  form.append(create('h3', 'Qualification'), stage, note, source, status,
    website(lead.finding?.url, 'Open evidence') || '', feedback, create('button', 'Save qualification'));
  form.onsubmit = event => {
    event.preventDefault();
    const fields = new FormData(form);
    const finding = fields.get('finding').trim();
    const url = fields.get('source').trim();
    const confirmed = fields.get('status') === 'confirmed';
    if ((url && !website(url, 'Evidence')) || (confirmed && (!finding || !url))) {
      feedback.textContent = 'Use an HTTP or HTTPS evidence URL. A confirmed finding also needs a description.';
      return;
    }
    lead.stage = confirmed && fields.get('stage') === 'prospect' ? 'qualified' : fields.get('stage');
    if (['won', 'lost'].includes(lead.stage)) lead.due = '';
    lead.finding = { note: finding, url, confirmed };
    persist();
  };
  return form;
}

function renderBusinessPage() {
  const container = $('#business-detail');
  if (!container) return;
  const currentIndex = leads.findIndex(item => item.id === activeBusinessId);
  const lead = currentIndex !== -1 ? leads[currentIndex] : leads[0];
  if (!lead) {
    container.replaceChildren(
      empty('▤', 'No business selected', 'Choose a business from Saved leads or Search results to view its full dossier.')
    );
    return;
  }
  const leadIndex = currentIndex !== -1 ? currentIndex : 0;
  activeBusinessId = lead.id;

  const status = leadStatus(lead);
  const topBar = create('div', '', 'heading section-title');
  const titleWrap = create('div');

  const navQueueBar = create('div', '', 'actions');
  navQueueBar.style.marginBottom = '12px';
  const backBtn = button('← Back to saved leads', () => { location.hash = '#leads'; }, true);
  const prevLeadBtn = button('← Prev lead', () => {
    if (leadIndex > 0) {
      activeBusinessId = leads[leadIndex - 1].id;
      renderBusinessPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, true);
  prevLeadBtn.disabled = leadIndex <= 0;
  const nextLeadBtn = button(`Next lead (${leadIndex + 1}/${leads.length}) →`, () => {
    if (leadIndex < leads.length - 1) {
      activeBusinessId = leads[leadIndex + 1].id;
      renderBusinessPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, true);
  nextLeadBtn.disabled = leadIndex >= leads.length - 1;
  navQueueBar.append(backBtn, prevLeadBtn, nextLeadBtn);

  const titleRow = create('div', '', 'actions');
  titleRow.append(create('h1', lead.name), create('span', status, statusPillClass(status)));
  const subTitle = create('p', [lead.industry, lead.city, lead.address].filter(Boolean).join(' · '));
  titleWrap.append(navQueueBar, titleRow, subTitle);

  const actionGroup = create('div', '', 'actions');
  if (lead.website) {
    const combBtn = button('Have a look (Comb website)', event => enrichItemEmail(lead, event.currentTarget), true);
    actionGroup.append(combBtn);
  }
  const analyzeBtn = button('Generate AI Lead Brief & Pitch', async event => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Analyzing business…';
    try {
      if (lead.website && !lead.aboutSummary && !lead.scanned) {
        try {
          const enriched = await api('/api/enrich', { website: lead.website });
          lead.scanned = true;
          applyEnrichmentToItem(lead, enriched);
        } catch {
          // Proceed with existing data if website is unreachable
        }
      }
      lead.aiBrief = await api('/api/analyze', { lead });
      persist();
      report(`Generated AI lead intelligence & outreach pitch for ${lead.name}.`);
    } catch (error) {
      report(error.message, true);
      btn.disabled = false;
      btn.textContent = 'Generate AI Lead Brief & Pitch';
    }
  });
  actionGroup.append(
    analyzeBtn,
    button('Draft email', () => compose(lead)),
    button('Edit all fields', () => editLead(lead), true),
    button('Delete', () => deleteLead(lead), 'danger')
  );
  topBar.append(titleWrap, actionGroup);

  const grid = create('div', '', 'dossier-grid');

  // 1. All Scraped & Contact Details Card + Inline Quick Status / Follow-up / Notes
  const detailsCard = create('article', '', 'surface dossier-card full');
  detailsCard.append(create('h2', 'Scraped Business Details & Quick CRM Controls'));
  const kvGrid = create('div', '', 'kv-grid');
  const allEmails = [...new Set([lead.email, ...(lead.emails || [])].filter(Boolean))];
  kvGrid.append(
    kvItem('Business Name', lead.name),
    kvItem('Category / Industry', lead.industry || 'Not specified'),
    kvItem('City', lead.city || 'Not specified'),
    kvItem('Street Address', lead.address || 'Not listed'),
    kvItem('Phone Number', lead.phone || 'Not listed'),
    kvItem('Phone source', website(lead.phoneSource, 'Open source page') || 'Source not recorded'),
    kvItem('Contact form', website(lead.contactFormSource, 'Open page with form') || 'Not detected'),
    kvItem('Primary Email', lead.email || 'Needs email'),
    kvItem('Contact page', website(lead.contactPage, 'Open contact page') || 'Not found'),
    kvItem('Platform evidence', [lead.platformConfidence, lead.platformEvidence].filter(Boolean).join(' · ') || 'Not verified'),
    kvItem('Discovery query', lead.discoveryQuery || 'Not recorded'),
    kvItem('Email source', website(lead.emailSources?.[norm(lead.email)], 'Open scanned website') ||
      (lead.email ? 'Source not recorded' : 'No email found')),
    kvItem('All Discovered Emails', allEmails.length ? allEmails.join(', ') : 'None found yet'),
    kvItem('Website', website(lead.website, lead.website) || 'No website listed'),
    kvItem('Map / Listing Source', website(lead.source, 'Open on Bing Maps / Source') || 'Manual / CSV entry'),
    kvItem('Star Rating & Reviews', [lead.rating && `★ ${lead.rating}`, lead.ratingInfo].filter(Boolean).join(' · ') || 'No rating listed'),
    kvItem('Bing Search Position', lead.searchRank ? `Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)})` : 'Direct / Manual'),
    kvItem('Operating Hours', lead.openHours || 'Not listed'),
    kvItem('Coordinates', (lead.latitude && lead.longitude) ? `${lead.latitude}, ${lead.longitude}` : 'Not listed')
  );
  detailsCard.append(kvGrid, renderQualification(lead));

  // Inline CRM controls (Status, Follow-up Date, Primary Email, Quick Notes)
  const quickCrmGrid = create('div', '', 'filters');
  quickCrmGrid.style.margin = '4px 0 0';
  const statusSelect = selectField('Lead Status', 'classification', {
    '': 'Automatic (' + status + ')',
    ...statusNames
  }, lead.classification || '');
  statusSelect.lastChild.onchange = e => {
    lead.classification = e.target.value;
    if (['unsubscribe', 'bounced'].includes(lead.classification) && lead.email) {
      lead.suppressed = [...new Set([...(lead.suppressed || []), norm(lead.email)])];
      lead.due = '';
    }
    persist();
    report(`Updated status for ${lead.name}.`);
  };

  const dueField = field('Follow-up Date', 'due', lead.due, { type: 'date' });
  dueField.lastChild.onchange = e => {
    lead.due = e.target.value;
    persist();
    report(`Updated follow-up date for ${lead.name}.`);
  };

  const emailInline = field('Primary Outreach Email', 'email', lead.email, { type: 'email', placeholder: 'Add or update email…' });
  emailInline.lastChild.onchange = e => {
    lead.email = e.target.value.trim();
    persist();
    report(`Updated email for ${lead.name}.`);
  };
  quickCrmGrid.append(emailInline, statusSelect, dueField);

  const notesWrapper = field('Review Notes & Summary (auto-saves on change)', 'about', lead.about, {
    type: 'textarea',
    maxLength: 6000,
    placeholder: 'Add your review notes, pain points, or call observations for this business…'
  });
  notesWrapper.lastChild.style.minHeight = '80px';
  notesWrapper.lastChild.onchange = e => {
    lead.about = e.target.value.trim();
    persist();
    report('Saved business notes.');
  };
  detailsCard.append(quickCrmGrid, notesWrapper);

  // 2. Website Combing & Social Media Presence Card (with inline Website URL setter!)
  const webCard = create('article', '', 'surface dossier-card');
  webCard.append(create('h2', 'Website & Social Media Combing'));

  const webUrlForm = create('form', '', 'inline-bar');
  const webInput = field('Business Website URL', 'websiteUrl', lead.website, {
    type: 'url',
    placeholder: 'https://example.com'
  });
  const saveAndCombBtn = create('button', lead.website ? 'Have a look (Comb site)' : 'Save & Comb site');
  webUrlForm.append(webInput, saveAndCombBtn);
  webUrlForm.onsubmit = async event => {
    event.preventDefault();
    let urlVal = webInput.lastChild.value.trim();
    if (urlVal && !/^https?:\/\//i.test(urlVal)) urlVal = 'https://' + urlVal;
    lead.website = urlVal;
    persist();
    if (urlVal) await enrichItemEmail(lead, saveAndCombBtn);
  };
  webCard.append(webUrlForm);

  const socialsRow = create('div', '', 'actions');
  const foundSocials = socialLinks(lead);
  if (foundSocials.length) {
    socialsRow.append(...foundSocials);
  } else {
    socialsRow.append(create('span', 'No social media links discovered yet.', 'small'));
  }
  webCard.append(create('small', 'DISCOVERED SOCIAL LINKS', 'small'), socialsRow);

  const sig = lead.signals || {};
  const signalList = create('div', '', 'signal-list');
  const addSignalPill = (label, ok) => {
    if (ok === undefined) return;
    signalList.append(create('span', (ok ? '✓ ' : '✗ Missing: ') + label, ok ? 'pill' : 'pill warn'));
  };
  if (lead.website) {
    addSignalPill('HTTPS Security', sig.https ?? lead.website.startsWith('https://'));
    addSignalPill('SEO Meta Description', sig.hasMetaDescription);
    addSignalPill('Online Booking / Lead Form', sig.hasBookingOrForm);
    addSignalPill('Live Chat / WhatsApp Widget', sig.hasChatWidget);
    addSignalPill('Analytics / Retargeting Pixel', sig.hasAnalytics);
  } else {
    signalList.append(create('span', '✗ Missing: Official Website', 'pill warn'));
  }
  if (!lead.email) signalList.append(create('span', '✗ Missing: Public Email', 'pill warn'));
  if (!foundSocials.length) signalList.append(create('span', '✗ Missing: Linked Social Profiles', 'pill warn'));
  webCard.append(create('small', 'DIGITAL PRESENCE SIGNALS & WHAT IS MISSING', 'small'), signalList);

  const aboutBox = create('div', '', 'stack');
  if (lead.platform) {
    const platDetails = [
      lead.platform,
      lead.shopifyMeta?.themeName && `Theme: ${lead.shopifyMeta.themeName}`,
      lead.shopifyMeta?.myshopifyDomain,
      lead.shopifyMeta?.currency && `Currency: ${lead.shopifyMeta.currency}`
    ].filter(Boolean).join(' · ');
    aboutBox.append(kvItem('Detected Website Platform', platDetails));
  }
  if (Array.isArray(lead.techStack) && lead.techStack.length) {
    aboutBox.append(kvItem('Installed Apps & Tech Stack', lead.techStack.join(' • ')));
  }
  if (Array.isArray(lead.shopifyProducts) && lead.shopifyProducts.length) {
    const prodList = lead.shopifyProducts
      .map(p => `${p.title}${p.type ? ` (${p.type})` : ''}${p.price ? ` — $${p.price}` : ''}`)
      .join('\n• ');
    aboutBox.append(kvItem('Shopify Product Catalog Sample', '• ' + prodList));
  }
  if (lead.siteTitle) {
    aboutBox.append(kvItem('Website Title', lead.siteTitle));
  }
  if (lead.headings?.length) {
    aboutBox.append(kvItem('Key Website Headings', lead.headings.join(' • ')));
  }
  if (lead.aboutSummary) {
    aboutBox.append(kvItem('Combed "About the Business" Summary', lead.aboutSummary));
  } else if (lead.website) {
    aboutBox.append(create('p', 'Click "Have a look (Comb site)" above to crawl their website for About text, services, emails, and social links.', 'small'));
  }
  webCard.append(aboutBox);

  // 3. AI Lead Intelligence & Professional Outreach Pitch Card
  const aiCard = create('article', '', 'surface dossier-card ai-panel');
  const aiHeader = create('div', '', 'heading');
  aiHeader.style.margin = '0';
  aiHeader.append(
    create('h2', 'AI Lead Intelligence & Professional Pitch'),
    button(lead.aiBrief ? 'Regenerate AI Analysis' : 'Analyze & Generate Pitch', async event => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Analyzing…';
      try {
        lead.aiBrief = await api('/api/analyze', { lead });
        persist();
      } catch (error) {
        report(error.message, true);
        btn.disabled = false;
        btn.textContent = 'Analyze & Generate Pitch';
      }
    }, true)
  );
  aiCard.append(aiHeader);

  if (lead.aiBrief) {
    const overviewSec = create('div', '', 'ai-section');
    overviewSec.append(create('h3', 'Business Positioning & Overview'), create('p', lead.aiBrief.overview));

    const gapsSec = create('div', '', 'ai-section');
    gapsSec.append(create('h3', 'What They Are Missing (Opportunities to Pitch)'));
    const gapList = create('ul');
    for (const gap of lead.aiBrief.gaps || []) {
      gapList.append(create('li', gap));
    }
    gapsSec.append(gapList);

    const angleSec = create('div', '', 'ai-section');
    angleSec.append(create('h3', 'Recommended Outreach Strategy'), create('p', lead.aiBrief.angle));

    const pitchSec = create('div', '', 'ai-section stack');
    pitchSec.append(
      create('h3', 'Tailored Professional Lead Pitch'),
      create('strong', 'Subject: ' + lead.aiBrief.pitchSubject),
      create('div', lead.aiBrief.pitchBody, 'pitch-preview'),
      button('Use this pitch & Draft Email', () => compose(lead, null, null, {
        subject: lead.aiBrief.pitchSubject,
        body: lead.aiBrief.pitchBody
      }))
    );
    aiCard.append(overviewSec, gapsSec, angleSec, pitchSec);
  } else {
    aiCard.append(
      empty('✦', 'Ready to analyze ' + lead.name,
        'Click "Generate AI Lead Brief & Pitch" to evaluate what this business is missing online and craft a personalized outreach email.')
    );
  }

  // 4. Outreach History & Conversations for this Business
  const historyCard = create('article', '', 'surface dossier-card full');
  const historyHeader = create('div', '', 'heading');
  historyHeader.style.margin = '0';
  historyHeader.append(
    create('h2', 'Outreach Conversations with ' + lead.name),
    button('Compose new email', () => compose(lead))
  );
  historyCard.append(historyHeader);

  const leadThreads = lead.threads || [];
  if (leadThreads.length) {
    for (const conv of leadThreads) {
      const cached = messages.get(threadKey(conv)) || [];
      const hasReply = cached.some(m => !m.sent);
      historyCard.append(row(
        { name: conv.subject },
        ['To: ' + (conv.to || lead.email), new Date(conv.time).toLocaleString(), hasReply ? 'Reply received' : 'Sent'],
        [
          create('span', hasReply ? 'Reply received' : 'Sent', hasReply ? 'pill' : 'pill wait'),
          button('Open conversation & reply', () => openThread(lead, conv), true)
        ]
      ));
    }
  } else {
    historyCard.append(create('p', 'No outreach emails sent to this business yet.', 'small'));
  }

  grid.append(detailsCard, webCard, aiCard, historyCard);
  container.replaceChildren(topBar, grid);
}

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
  for (const [value, text] of Object.entries(optionsMap)) {
    select.add(new Option(text, value));
  }
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
  const submit = create('button', 'Save lead');
  const feedback = create('div', '', 'small');
  feedback.setAttribute('role', 'status');
  const statusSelect = selectField('Lead status', 'classification', {
    '': 'Automatic (based on activity)',
    ...statusNames
  }, lead?.classification || '');

  const actions = create('div', '', 'actions');
  actions.append(submit);
  if (lead) {
    actions.append(button('Delete lead', () => {
      dialog.close();
      deleteLead(lead);
    }, 'danger'));
  }

  form.append(
    field('Business name', 'name', lead?.name, { required: true }),
    field('Industry', 'industry', lead?.industry),
    field('City', 'city', lead?.city),
    field('Business email', 'email', lead?.email, { type: 'email', maxLength: 254 }),
    field('Phone number', 'phone', lead?.phone, { type: 'tel', maxLength: 80 }),
    field('Website', 'website', lead?.website, { type: 'url', maxLength: 1024 }),
    field('Address', 'address', lead?.address, { maxLength: 400 }),
    field('About / notes', 'about', lead?.about, { type: 'textarea', maxLength: 6000 }),
    statusSelect,
    field('Follow-up date', 'due', lead?.due, { type: 'date' }),
    feedback,
    actions
  );
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
    if (!values.name) { feedback.textContent = 'Enter a business name.'; return; }
    if (duplicate(values, lead?.id)) { feedback.textContent = 'This business is already saved.'; return; }
    if (['unsubscribe', 'bounced'].includes(values.classification) && values.email) {
      values.suppressed = [...new Set([...(lead?.suppressed || []), norm(values.email)])];
      values.due = '';
    }
    if (lead) Object.assign(lead, values);
    else leads.unshift({ ...values, id: crypto.randomUUID(), threads: [] });
    persist();
    if (results.length) renderResults();
    dialog.close();
  };
  show(lead ? 'Edit ' + lead.name : 'Add a lead', form);
}

function importLeads() {
  const form = create('form', '', 'stack');
  const label = create('label', 'Business CSV (Jobhunta or Bing Maps Scraper format)');
  const file = create('input');
  file.type = 'file';
  file.accept = '.csv,text/csv';
  file.required = true;
  label.append(file);
  const template = create('a', 'Download CSV template');
  template.href = '/business-import.csv';
  template.download = 'business-import.csv';
  const feedback = create('div', '', 'small');
  feedback.setAttribute('role', 'status');
  const submit = create('button', 'Import businesses');
  form.append(template, label, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;
    feedback.replaceChildren();
    try {
      if (file.files[0].size > 2_000_000) throw new Error('Choose a CSV file under 2 MB.');
      const { businesses, errors } = readBusinessCsv(await file.files[0].text());
      let added = 0;
      let skipped = 0;
      for (const business of businesses) {
        if (duplicate(business)) skipped++;
        else {
          leads.unshift({ ...business, id: crypto.randomUUID(), threads: [] });
          added++;
        }
      }
      persist();
      if (results.length) renderResults();
      feedback.append(create('p', added + ' imported, ' + skipped + ' duplicates skipped, ' + errors.length + ' invalid rows.'));
      if (errors.length) {
        const list = create('ul');
        list.append(...errors.slice(0, 10).map(error => create('li', error)));
        feedback.append(list);
      }
    } catch (error) { feedback.textContent = error.message; }
    finally { submit.disabled = false; }
  };
  show('Import businesses', form);
}

function exportLeads() {
  if (!leads.length) return;
  const csv = writeBusinessCsv(leads);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = create('a');
  link.href = url;
  link.download = `jobhunta-leads-${new Date().toLocaleDateString('en-CA')}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  report(`Exported ${leads.length} lead${leads.length === 1 ? '' : 's'} to CSV.`);
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
      } catch {
        // Continue to next lead
      }
    }
    persist();
    report(foundCount
      ? `Found emails for ${foundCount} of ${targets.length} business(es).`
      : `Scanned ${targets.length} website(s); no new public emails found.`);
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
    .replace(/\{\{\s*specific_opportunity\s*\}\}/gi, () =>
      lead.finding?.confirmed ? lead.finding.note : '[specific opportunity]')
    .replace(/\{\{\s*finding_source\s*\}\}/gi, () =>
      lead.finding?.confirmed ? lead.finding.url : '[specific opportunity source]')
    .replace(/\{\{\s*your_name\s*\}\}/gi, settings.senderName || '[your name]')
    .replace(/\{\{\s*your_service\s*\}\}/gi, settings.senderService || '[your service]');
}

function renderProfile() {
  const container = $('#profile-content');
  if (!container) return;

  const tierList = account.tiers?.length ? account.tiers : [
    { key: 'basic', label: 'Basic', dailySearchLimit: 50, dailyResultLimit: 250, dailyEmailLimit: 10 },
    { key: 'silver', label: 'Silver', dailySearchLimit: 20, dailyResultLimit: 500, dailyEmailLimit: 30 },
    { key: 'gold', label: 'Gold', dailySearchLimit: 50, dailyResultLimit: 1500, dailyEmailLimit: 50 },
    { key: 'premium', label: 'Premium', dailySearchLimit: 100, dailyResultLimit: 3000, dailyEmailLimit: 100 },
    { key: 'diamond', label: 'Diamond', dailySearchLimit: null, dailyResultLimit: null, dailyEmailLimit: null }
  ];

  const usage = currentUser?.usage || {
    tier: currentUser?.tier || 'basic',
    label: 'Basic',
    dailySearchLimit: 50,
    dailyEmailLimit: 10,
    searchesToday: 0,
    resultsToday: 0,
    emailsToday: 0,
    usageDate: new Date().toISOString().slice(0, 10)
  };
  const activeTier = tierList.find(t => t.key === usage.tier) || tierList[0];

  const topHeader = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', 'User Profile & Usage'),
    create('p', 'Track your daily search and email outreach limits across membership tiers.')
  );
  const tierBadge = create('span', activeTier.label + ' Tier', 'pill');
  topHeader.append(titleWrap, tierBadge);

  const grid = create('div', '', 'dossier-grid');

  // 1. User Account Card
  const userCard = create('article', '', 'surface dossier-card');
  userCard.append(create('h2', 'Account Identity'));
  const kv = create('div', '', 'kv-grid');
  kv.append(
    kvItem('Full Name', currentUser?.name || settings.senderName || 'Not set'),
    kvItem('Account Email', currentUser?.email || 'Not signed in'),
    kvItem('Unique User ID', currentUser?.id || '—'),
    kvItem('Membership Tier', activeTier.label),
    kvItem('Saved Leads in Workspace', String(leads.length)),
    kvItem('Connected Gmail', account.mailbox || 'Not connected')
  );
  userCard.append(kv);

  // 2. Daily Usage Card
  const usageCard = create('article', '', 'surface dossier-card');
  usageCard.append(create('h2', `Daily Usage (${usage.usageDate || 'Today'})`));

  const addMeter = (title, used, limit) => {
    const wrap = create('div', '', 'stack');
    wrap.style.gap = '4px';
    const isUnlimited = limit === null || limit === undefined;
    const labelText = isUnlimited ? `${used} used · Unlimited` : `${used} / ${limit} used today`;
    const rowTop = create('div', '', 'stat-row');
    rowTop.style.border = '0';
    rowTop.style.padding = '0';
    rowTop.append(create('span', title), create('strong', labelText));

    const meter = create('div', '', 'meter');
    const fill = create('div', '', 'meter-fill');
    const pct = isUnlimited ? 100 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
    fill.style.width = pct + '%';
    if (!isUnlimited && used >= limit) fill.style.background = '#9e2a2b';
    meter.append(fill);
    wrap.append(rowTop, meter);
    return wrap;
  };

  usageCard.append(
    addMeter('Business Searches Today', usage.searchesToday || 0, activeTier.dailySearchLimit),
    addMeter('Search Results Today', usage.resultsToday || 0, activeTier.dailyResultLimit),
    addMeter('Outreach Emails Sent Today', usage.emailsToday || 0, activeTier.dailyEmailLimit),
    create('p', 'Daily counters reset automatically every UTC day at 00:00.', 'small')
  );

  // 3. Membership Tiers Card
  const tiersCard = create('article', '', 'surface dossier-card full');
  tiersCard.append(create('h2', 'Membership Tiers & Daily Quotas'));
  const tierGrid = create('div', '', 'tier-grid');
  for (const tier of tierList) {
    const isCurrent = tier.key === activeTier.key;
    const card = create('div', '', 'tier-card' + (isCurrent ? ' active' : ''));
    const head = create('h3', tier.label);
    if (isCurrent) head.append(create('span', 'Active', 'pill'));
    const list = create('ul');
    list.append(
      create('li', tier.dailySearchLimit === null ? 'Unlimited searches / day' : `${tier.dailySearchLimit} searches / day`),
      create('li', tier.dailyResultLimit === null ? 'Unlimited search results / day' : `${tier.dailyResultLimit.toLocaleString()} search results / day`),
      create('li', tier.dailyEmailLimit === null ? 'Unlimited emails / day' : `${tier.dailyEmailLimit} emails / day`),
      create('li', 'Isolated Supabase workspace & AI pitches')
    );
    card.append(head, list);
    tierGrid.append(card);
  }
  tiersCard.append(tierGrid);

  grid.append(userCard, usageCard, tiersCard);
  container.replaceChildren(topHeader, grid);
}

function renderSettings() {
  const container = $('#settings-content');
  if (!container) return;

  const topHeader = create('div', '', 'heading section-title');
  const titleWrap = create('div');
  titleWrap.append(
    create('h1', 'Workspace Settings'),
    create('p', 'Manage your Gmail connection, outreach sender profile, email templates, and workspace tools.')
  );
  const quickNav = create('div', '', 'actions');
  quickNav.append(
    button('Find businesses ↗', () => { location.hash = '#discover'; }),
    button('Saved leads', () => { location.hash = '#leads'; }, true)
  );
  topHeader.append(titleWrap, quickNav);

  const grid = create('div', '', 'dossier-grid');

  // 1. Gmail Connection Card
  const gmailCard = create('article', '', 'surface dossier-card');
  const gmailHead = create('div', '', 'heading');
  gmailHead.style.margin = '0';
  gmailHead.append(
    create('h2', 'Gmail Outreach Account'),
    create('span', account.mailbox ? 'Connected' : 'Not connected', account.mailbox ? 'pill' : 'pill wait')
  );
  gmailCard.append(gmailHead);

  const expectedUri = account.redirectUri || (location.origin + '/oauth/callback');
  if (account.mailbox) {
    gmailCard.append(
      kvItem('Connected Mailbox', account.mailbox),
      button('Disconnect Gmail', async () => {
        try {
          await api('/api/disconnect', {});
          account.mailbox = null;
          messages.clear();
          renderAccount();
          report('Disconnected Gmail mailbox.');
        } catch (error) { report(error.message, true); }
      }, 'danger')
    );
  } else {
    const connectBtn = button('Connect Gmail →', async event => {
      const btn = event.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Redirecting to Google…';
      try {
        location.assign((await api('/api/connect', {})).url);
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Connect Gmail →';
        report(error.message, true);
      }
    });
    const copyUriBtn = button('Copy Redirect URI', async event => {
      const btn = event.currentTarget;
      try {
        await navigator.clipboard.writeText(expectedUri);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy Redirect URI'; }, 2000);
      } catch {
        btn.textContent = 'Copy from box above';
      }
    }, true);
    const gmailActions = create('div', '', 'actions');
    gmailActions.append(connectBtn, copyUriBtn, website('https://console.cloud.google.com/apis/credentials', 'Google Cloud Credentials'));
    gmailCard.append(
      kvItem('OAuth Client ID', account.clientId || 'Configure GOOGLE_CLIENT_ID in .env / Vercel'),
      kvItem('Authorized Redirect URI (add to Google Cloud)', expectedUri),
      gmailActions
    );
  }

  // 2. Supabase Cloud Persistence & Discovery Tools Card
  const toolsCard = create('article', '', 'surface dossier-card');
  const sbHead = create('div', '', 'heading');
  sbHead.style.margin = '0';
  const sbStatus = account.supabase?.connected
    ? ['Supabase Connected', 'pill']
    : account.supabase?.configured
      ? ['SQL Setup Needed', 'pill warn']
      : ['Local Storage Mode', 'pill wait'];
  sbHead.append(create('h2', 'Supabase Cloud Database'), create('span', sbStatus[0], sbStatus[1]));
  toolsCard.append(sbHead);

  if (account.supabase?.error) {
    toolsCard.append(create('p', account.supabase.error, 'small'));
  } else {
    toolsCard.append(create('p', account.supabase?.connected
      ? 'All leads, AI briefs, templates, and outreach threads are synced with your Supabase Postgres database.'
      : 'Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env / Vercel and run supabase/schema.sql in the Supabase SQL Editor to enable cloud database sync.', 'small'));
  }

  const copySqlBtn = button('Copy Supabase SQL Schema', async event => {
    const btn = event.currentTarget;
    const sql = `create table if not exists public.jobhunta_workspace (
  id text primary key default 'default',
  settings jsonb not null default '{}'::jsonb,
  auth jsonb,
  thread_owners jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.jobhunta_leads (
  id text primary key,
  name text not null,
  industry text default '',
  city text default '',
  address text default '',
  email text default '',
  phone text default '',
  website text default '',
  source text default '',
  platform text default '',
  rating text default '',
  open_hours text default '',
  search_rank integer,
  classification text default '',
  due text default '',
  about text default '',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);`;
    try {
      await navigator.clipboard.writeText(sql);
      btn.textContent = 'SQL Schema Copied!';
      setTimeout(() => { btn.textContent = 'Copy Supabase SQL Schema'; }, 2200);
    } catch {
      report('Open supabase/schema.sql in your project folder to copy the SQL.', true);
    }
  }, true);

  const toolsActions = create('div', '', 'actions');
  toolsActions.append(
    copySqlBtn,
    website('https://supabase.com/dashboard', 'Open Supabase Dashboard'),
    button('Import CSV', importLeads, true),
    button('Export CSV', exportLeads, true)
  );
  toolsCard.append(toolsActions);

  grid.append(gmailCard, toolsCard);
  container.replaceChildren(topHeader, grid);
}

function renderBroadcast() {
  const title = create('div', '', 'heading section-title');
  title.append(create('h1', 'Broadcast'));
  const formCard = create('article', '', 'surface dossier-card full');
  const formHeader = create('div', '', 'heading');
  formHeader.style.margin = '0';
  formHeader.append(
    create('h2', 'Outreach profile'),
    create('span', 'Changes save automatically', 'small')
  );
  formCard.append(formHeader);

  const form = create('form', '', 'stack');
  const profileGrid = create('div', '', 'grid-2');
  const senderNameInput = field('Your name', 'senderName', settings.senderName, { placeholder: 'e.g. Ayoola Adebisi' });
  const senderServiceInput = field('Your service / offer (used by AI Pitch Generator)', 'senderService', settings.senderService, { placeholder: 'e.g. Shopify CRO, local SEO & web design' });
  profileGrid.append(senderNameInput, senderServiceInput);

  const followUpInput = field('Auto follow-up reminder (days after sending, 0 to disable)', 'defaultFollowUpDays', String(settings.defaultFollowUpDays ?? 4), { type: 'number' });
  followUpInput.lastChild.min = '0';
  followUpInput.lastChild.max = '90';

  const autoSaveSettings = () => {
    settings.senderName = senderNameInput.lastChild.value.trim();
    settings.senderService = senderServiceInput.lastChild.value.trim();
    settings.defaultFollowUpDays = Math.max(0, Math.min(90, Number(followUpInput.lastChild.value) || 0));
    if (currentUser?.id) {
      localStorage.setItem(userSettingsKey(currentUser.id), JSON.stringify(settings));
      syncWorkspaceToServer();
    }
    renderDashboard();
  };

  senderNameInput.lastChild.onchange = autoSaveSettings;
  senderServiceInput.lastChild.onchange = autoSaveSettings;
  followUpInput.lastChild.onchange = autoSaveSettings;

  form.onsubmit = event => event.preventDefault();
  form.append(profileGrid, followUpInput);
  formCard.append(form);

  const library = create('section', '', 'broadcast-library');
  const libraryHeading = create('div', '', 'heading');
  const templateGrid = create('div', '', 'broadcast-grid');
  const addTemplate = button('New template', () => editBroadcastTemplate());
  addTemplate.disabled = settings.templates.length >= 25;
  libraryHeading.append(create('h2', 'Email templates'), addTemplate);
  settings.templates.forEach(template => {
    const card = create('article', '', 'surface broadcast-card');
    const actions = create('div', '', 'actions');
    actions.append(
      button('Edit', () => editBroadcastTemplate(template), true),
      button('Copy email', async () => {
        try {
          await navigator.clipboard.writeText(['Subject: ' + template.subject, template.body].join('\n\n'));
          report('Email template copied.');
        } catch {
          report('Clipboard access is unavailable. Open Edit to select and copy the template.', true);
        }
      }, true)
    );
    card.append(create('h3', template.name), create('p', template.subject, 'broadcast-subject'),
      create('p', template.body, 'broadcast-preview'), actions);
    templateGrid.append(card);
  });
  library.append(libraryHeading, templateGrid);
  const outcomes = create('section', '', 'surface dossier-card broadcast-library');
  outcomes.append(create('h2', 'Outreach outcomes'),
    create('p', 'Counts are per lead and use its first outreach template and discovery search.', 'small'));
  for (const [heading, key] of [
    ['By template', lead => lead.threads[0].templateName || 'Template not recorded'],
    ['By search', lead => lead.discoverySearch || 'Search not recorded']
  ]) {
    const groups = new Map();
    for (const lead of leads) {
      if (!lead.threads?.length) continue;
      const label = key(lead);
      const counts = groups.get(label) || { contacted: 0, replied: 0, booked: 0 };
      counts.contacted++;
      if (lead.replied) counts.replied++;
      if (['booked', 'won'].includes(stageOf(lead))) counts.booked++;
      groups.set(label, counts);
    }
    outcomes.append(create('h3', heading));
    if (!groups.size) outcomes.append(create('p', 'No outreach sent yet.', 'small'));
    for (const [label, counts] of groups) {
      outcomes.append(create('p', label + ' · ' + counts.contacted + ' contacted · ' +
        counts.replied + ' replied · ' + counts.booked + ' booked or won', 'small'));
    }
  }
  $('#broadcast-content').replaceChildren(title, formCard, library, outcomes);
}

function editBroadcastTemplate(template) {
  const form = create('form', '', 'stack');
  const name = field('Template name', 'name', template?.name || '', { required: true, maxLength: 80 });
  const subject = field('Subject', 'subject', template?.subject || '', { required: true, maxLength: 160 });
  const body = field('Message', 'body', template?.body || '', { type: 'textarea', required: true, maxLength: 16000 });
  const placeholders = create('p', 'Placeholders: {{business_name}}, {{city}}, {{industry}}, {{your_name}}, {{your_service}}, {{specific_opportunity}}, {{finding_source}}', 'small');
  const feedback = create('p', '', 'small');
  feedback.setAttribute('role', 'status');
  const actions = create('div', '', 'actions');
  const save = create('button', 'Save template');
  actions.append(save);
  if (template && settings.templates.length > 1) {
    actions.append(button('Delete template', () => {
      if (!window.confirm('Delete this template?')) return;
      settings.templates = settings.templates.filter(item => item.id !== template.id);
      persist();
      dialog.close();
      renderBroadcast();
    }, 'danger'));
  }
  form.append(name, subject, body, placeholders, feedback, actions);
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
    if (!values.name || !values.subject || !values.body) {
      feedback.textContent = 'Enter a name, subject, and message.';
      return;
    }
    if (template) Object.assign(template, values);
    else if (settings.templates.length < 25) {
      settings.templates = [...settings.templates, { id: crypto.randomUUID(), ...values }];
    } else {
      feedback.textContent = 'You can save up to 25 templates.';
      return;
    }
    persist();
    dialog.close();
    renderBroadcast();
  };
  show(template ? 'Edit template' : 'New template', form);
}

function futureDateString(days) {
  if (!days || days <= 0) return '';
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

function compose(lead, conversation, parent, customPitch = null) {
  const form = create('form', '', 'stack');
  const recipient = parent
    ? (parent.sent
        ? (parent.to || conversation?.to || lead.email)
        : (parent.replyTo || parent.from))
        .match(/<([^>]+)>/)?.[1] || (parent.sent ? (parent.to || conversation?.to || lead.email) : (parent.replyTo || parent.from))
    : lead.email;

  const defaultTpl = parent
    ? (settings.templates.find(tpl => tpl.id === 'followup') || settings.templates[0])
    : settings.templates[0];

  const templateWrapper = create('label', 'Template');
  const templateSelect = create('select');
  templateSelect.add(new Option(customPitch ? 'AI Generated Pitch' : (parent ? 'Blank reply / custom' : 'Select a template…'), ''));
  for (const tpl of settings.templates) {
    templateSelect.add(new Option(tpl.name, tpl.id));
  }
  if (!parent && !customPitch && defaultTpl) templateSelect.value = defaultTpl.id;
  templateWrapper.append(templateSelect);

  const to = field('To', 'to', recipient, { type: 'email', required: true, maxLength: 254 });
  const initialSubject = customPitch?.subject
    ? customPitch.subject
    : parent
      ? (/^re:/i.test(parent.subject || '') ? parent.subject : 'Re: ' + (parent.subject || conversation?.subject || ''))
      : interpolateTemplate(defaultTpl?.subject || 'Quick introduction to {{business_name}}', lead);
  const subject = field('Subject', 'subject', initialSubject, { required: true });
  const initialDraft = customPitch?.body
    ? customPitch.body
    : parent
      ? (parent.sent ? interpolateTemplate(defaultTpl?.body || '', lead) : '')
      : interpolateTemplate(defaultTpl?.body || '', lead);

  if (parent) {
    to.lastChild.readOnly = true;
    subject.lastChild.readOnly = true;
  }
  const body = field('Message', 'body', initialDraft, { type: 'textarea', required: true, maxLength: 16000 });

  templateSelect.onchange = () => {
    const chosen = settings.templates.find(tpl => tpl.id === templateSelect.value);
    if (!chosen) return;
    if (!parent) subject.lastChild.value = interpolateTemplate(chosen.subject, lead);
    body.lastChild.value = interpolateTemplate(chosen.body, lead);
  };

  const feedback = create('div', '', 'small');
  feedback.setAttribute('role', 'status');
  const submit = create('button', 'Send via Gmail');
  submit.disabled = !account.mailbox;
  const requestId = crypto.randomUUID();
  if (!account.mailbox) feedback.textContent = 'Connect Gmail before sending.';
  form.append(templateWrapper, to, subject, body, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (!values.body.trim() || !values.subject.trim() || /\[(?:your |specific )|\{\{[^}]+\}\}/.test(values.body) || /\{\{[^}]+\}\}/.test(values.subject)) {
      feedback.textContent = 'Complete the subject and replace any remaining template placeholders.';
      return;
    }
    if (blocked(values.to)) { feedback.textContent = 'This address is marked as unsubscribed or bounced.'; return; }
    submit.disabled = true;
    feedback.textContent = 'Sending…';
    const mailbox = account.mailbox;
    try {
      const sent = await api('/api/send', {
        ...values, requestId, threadId: conversation?.id, parentId: parent?.id
      });
      if (!conversation && !lead.threads.some(item => item.id === sent.threadId && item.mailbox === mailbox)) {
        if (['prospect', 'qualified'].includes(stageOf(lead))) lead.stage = 'contacted';
        const template = settings.templates.find(item => item.id === templateSelect.value);
        lead.threads.push({ id: sent.threadId, mailbox, subject: values.subject, time: Date.now(), to: values.to,
          templateName: template?.name || (customPitch ? 'AI pitch' : 'Custom email') });
      }
      if (!lead.email) lead.email = values.to;
      if (!lead.due && settings.defaultFollowUpDays > 0) {
        lead.due = futureDateString(settings.defaultFollowUpDays);
      }
      if (currentUser?.usage) {
        currentUser.usage.emailsToday = (currentUser.usage.emailsToday || 0) + 1;
      }
      persist();
      dialog.close();
      report('Email sent to ' + values.to + '.');
      if (location.hash === '#inbox') refresh();
    } catch (error) {
      feedback.textContent = error.message + ' Check Gmail Sent before composing this email again.';
    }
  };
  show(parent ? (parent.sent ? 'Follow up with ' : 'Reply to ') + lead.name : 'Email ' + lead.name, form);
}

const threadKey = conversation => conversation.mailbox + ':' + conversation.id;
const outgoing = () => leads.flatMap(lead => (lead.threads || []).map(conversation => ({ lead, conversation })));

function renderInbox() {
  const list = outgoing().filter(item => item.conversation.mailbox === account.mailbox);
  $('#refresh').disabled = !account.mailbox || refreshing;
  $('#conversations').replaceChildren(...(list.length ? list.map(({ lead, conversation }) => {
    const thread = messages.get(threadKey(conversation)) || [];
    const hasIncoming = thread.some(message => !message.sent);
    const statusLabel = lead.classification
      ? statusNames[lead.classification]
      : (hasIncoming ? 'Reply received' : 'Sent');
    return row(lead, [conversation.subject, conversation.to || lead.email, statusLabel], [
      create('span', statusLabel, statusPillClass(statusLabel)),
      button('Open thread', () => openThread(lead, conversation), true)
    ], () => openBusinessPage(lead));
  }) : [empty('✉', account.mailbox ? 'No conversations yet' : 'Connect your Gmail account',
    account.mailbox ? 'Send an email to a saved lead to start a conversation.' : 'Your Jobhunta replies will appear here after you connect.')]));
}

function classify(lead, conversation) {
  const select = create('select');
  const options = { '': 'Choose reply status', ...statusNames };
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
  const label = create('label', 'Reply status');
  label.append(select);
  return label;
}

async function syncThread(lead, conversation) {
  const key = threadKey(conversation);
  const thread = await api('/api/thread', { id: conversation.id, mailbox: conversation.mailbox });
  messages.set(key, thread);
  const incoming = thread.filter(message => !message.sent);
  const seen = new Set(conversation.seen || []);
  if (incoming.some(message => !seen.has(message.id))) {
    if (['prospect', 'qualified', 'contacted'].includes(stageOf(lead))) lead.stage = 'replied';
    lead.replied = true;
    lead.due = '';
    conversation.seen = incoming.map(message => message.id);
    persist();
  }
  return thread;
}

async function openThread(lead, conversation) {
  const panel = create('div', 'Loading conversation…');
  show(conversation.subject, panel);
  try {
    const thread = await syncThread(lead, conversation);
    const lastIncoming = thread.findLast(message => !message.sent);
    const replyTarget = lastIncoming || thread.at(-1);
    panel.replaceChildren(...thread.map(message => {
      const mail = create('article', '', 'mail' + (message.sent ? ' outgoing' : ''));
      mail.append(
        create('h3', (message.sent ? 'You → ' + (message.to || conversation.to || lead.email) : message.from)),
        create('small', new Date(message.time).toLocaleString()),
        create('p', message.body)
      );
      return mail;
    }));
    const footer = create('div', '', 'stack');
    footer.append(classify(lead, conversation));
    if (replyTarget) {
      footer.append(button(
        lastIncoming ? 'Reply in thread' : 'Send follow-up in thread',
        () => compose(lead, conversation, replyTarget)
      ));
    }
    panel.append(footer);
  } catch (error) { panel.textContent = error.message; }
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

function renderAccount() {
  const pill = $('#gmail-pill');
  if (pill) {
    pill.hidden = !account.mailbox;
    pill.textContent = account.mailbox ? 'Gmail connected' : '';
  }
  renderDashboard();
  renderInbox();
  renderSettings();
}

$('#settings-btn').onclick = () => {
  location.hash = '#settings';
};

$('#stop-search').onclick = () => {
  searchGeneration++;
  if (searchController) {
    searchController.abort();
    searchController = null;
  }
  streamActive = false;
  for (const item of results) {
    if (item.scanning) {
      item.scanning = false;
      item.scanned = true;
    } else if (!item.scanned) {
      item.scanned = true;
    }
  }
  renderResults();
  updateScrapeBanner();
};

function renderSavedSearches() {
  const select = $('#saved-search');
  const selected = select.value;
  select.replaceChildren(new Option('Saved searches', ''));
  for (const search of settings.savedSearches || []) {
    select.add(new Option([search.industry, search.city, search.rankMode].join(' · '), search.id));
  }
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
  $('#run-saved-search').disabled = $('#remove-search').disabled = !select.value;
}

const discoveryFields = ['industry', 'city', 'rankMode', 'mode', 'terms', 'locations', 'platform', 'sources', 'queries', 'urls'];
const searchForm = $('#search');
function syncDiscoveryMode() {
  const both = searchForm.elements.mode.value === 'both';
  if (both) searchForm.elements.sources.value = 'combined';
  searchForm.elements.sources.disabled = both;
}
searchForm.elements.mode.onchange = syncDiscoveryMode;
for (const platform of Object.keys(platformDomains)) $('#discovery-platform').add(new Option(platform, platform));

function renderGoogleLinks() {
  const queries = searchForm.elements.queries.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
  $('#google-query-links').replaceChildren(...queries.map(query =>
    website('https://www.google.com/search?' + new URLSearchParams({ q: query }), query)
  ));
}
searchForm.elements.queries.oninput = renderGoogleLinks;
$('#preview-discovery').onclick = () => {
  if (!searchForm.reportValidity()) return;
  const { industry, city, terms, locations, platform, mode } = Object.fromEntries(new FormData(searchForm));
  const keywords = searchList([industry, terms].join(','), 4);
  const areas = [city.trim(), ...searchList(locations, 4)].filter(Boolean);
  if (mode !== 'online' && !areas.length) { report('Enter a location to include local businesses.', true); return; }
  searchForm.elements.queries.value = keywords.flatMap(term => (areas.length ? areas : ['']).flatMap(area =>
    googleQueries(term, area, platform, mode))).slice(0, 12).join('\n');
  renderGoogleLinks();
};

$('#saved-search').onchange = renderSavedSearches;
$('#save-search').onclick = () => {
  const form = $('#search');
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const criteria = Object.fromEntries(discoveryFields.map(key => [key, String(data.get(key) || '').trim()]));
  if (criteria.mode === 'both') criteria.sources = 'combined';
  const saved = settings.savedSearches || [];
  if (criteria.industry.length < 2 || (!criteria.city && !criteria.locations && criteria.mode !== 'online')) {
    report('Enter an industry and a location for local discovery.', true);
    return;
  }
  if (saved.some(item => discoveryFields.every(key => norm(item[key]) === norm(criteria[key])))) {
    report('This search is already saved.');
    return;
  }
  if (saved.length >= 25) { report('Remove a saved search before adding another.', true); return; }
  settings.savedSearches = [...saved, { id: crypto.randomUUID(), ...criteria }];
  persist();
  renderSavedSearches();
};
$('#remove-search').onclick = () => {
  settings.savedSearches = (settings.savedSearches || []).filter(item => item.id !== $('#saved-search').value);
  persist();
  renderSavedSearches();
};
$('#run-saved-search').onclick = () => {
  const saved = settings.savedSearches?.find(item => item.id === $('#saved-search').value);
  if (!saved) return;
  const form = $('#search');
  const defaults = { mode: 'local', sources: 'combined', rankMode: 'all' };
  for (const key of discoveryFields) form.elements.namedItem(key).value = saved[key] || defaults[key] || '';
  syncDiscoveryMode();
  renderGoogleLinks();
  form.requestSubmit();
};
for (const [key, label] of Object.entries(stages)) $('#filter-stage').add(new Option(label, key));
$('#filter-stage').onchange = renderLeads;

$('#search').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type=submit]');
  if (searchController) searchController.abort();
  searchController = new AbortController();
  const generation = ++searchGeneration;
  activeWorkers = 0;
  results = [];
  resultsPage = 1;
  streamActive = true;
  currentScrapeStep = 'Preparing discovery…';
  $('#discovery-log').replaceChildren();
  $('#place-references').replaceChildren();
  $('#discovery-activity').hidden = true;
  submit.disabled = true;
  report();
  updateScrapeBanner();
  $('#save-all').hidden = true;
  $('#results-pagination').hidden = true;
  $('#results-count').textContent = '';
  $('#results').replaceChildren(empty('⌕', 'Searching businesses…', 'Results appear as each source responds.'));

  try {
    const params = new URLSearchParams(new FormData(form));
    params.set('expanded', '1');
    const response = await fetch('/api/search?' + params, { signal: searchController.signal });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Search failed.');
    }
    if (currentUser?.usage) {
      currentUser.usage.searchesToday = (currentUser.usage.searchesToday || 0) + 1;
      renderProfile();
    }

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
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'status') {
          currentScrapeStep = msg.message;
          updateScrapeBanner();
        } else if (msg.type === 'query') {
          $('#discovery-activity').hidden = false;
          $('#discovery-log').append(create('li', msg.message));
        } else if (msg.type === 'place') {
          $('#discovery-activity').hidden = false;
          const link = website(msg.url, 'Open in Google Maps · ' + msg.label);
          if (link) $('#place-references').append(link);
        } else if (msg.type === 'business' && msg.item) {
          if (!results.some(existing => existing.id === msg.item.id)) {
            msg.item.discoverySearch = [params.get('industry'), params.get('city'), params.get('rankMode')].join(' · ');
            results.push(msg.item);
            renderResults();
            updateScrapeBanner();
            triggerEnrichmentWorkers(generation);
          }
        } else if (msg.type === 'limit') {
          report(msg.message);
        } else if (msg.type === 'error') {
          throw new Error(msg.error);
        }
      }
    }

    if (generation === searchGeneration && !results.length) {
      const hasPlaces = $('#place-references').childElementCount > 0;
      if (hasPlaces) $('#discovery-activity').open = true;
      $('#results').replaceChildren(empty('⌕', hasPlaces ? 'Google Maps references found' : 'No matching businesses',
        hasPlaces ? 'Open the references in Source activity.' : 'Try a nearby city or another industry.'));
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (!results.length) {
        $('#results').replaceChildren(empty('⌕', 'Search unavailable', error.message));
      } else {
        report(error.message, true);
      }
    }
  } finally {
    if (generation === searchGeneration) {
      streamActive = false;
      searchController = null;
      updateScrapeBanner();
      const userId = currentUser?.id;
      if (userId) api('/api/status').then(status => {
        if (generation === searchGeneration && currentUser?.id === userId && status.user?.id === userId) {
          currentUser.usage = status.user.usage;
          renderProfile();
        }
      }).catch(() => {});
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

  submit.disabled = true;
  submit.textContent = 'Combing URL…';
  report();
  try {
    const enriched = await api('/api/enrich', { website: rawUrl });
    const parsedHost = new URL(enriched.website || rawUrl).hostname.replace(/^www\./, '');
    const newItem = {
      id: crypto.randomUUID(),
      name: enriched.brandName || parsedHost,
      industry: enriched.platform === 'Shopify' ? 'Shopify Store' : (enriched.platform || 'Online Business'),
      city: cityVal || 'Online',
      address: '',
      website: enriched.website || rawUrl,
      phone: '',
      email: enriched.email || '',
      source: enriched.website || rawUrl,
      about: [enriched.platform, enriched.shopifyMeta?.themeName && `Theme: ${enriched.shopifyMeta.themeName}`].filter(Boolean).join(' · '),
      scanned: true,
      threads: []
    };
    applyEnrichmentToItem(newItem, enriched);
    form.reset();
    openBusinessPage(newItem);
    report(`Combed ${newItem.name} (${newItem.platform || 'Website'}) and opened its dossier.`);
  } catch (error) {
    report(error.message, true);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Comb URL & Open Dossier ✦';
  }
};

$('#save-all').onclick = () => {
  const batch = [...results];
  if (!batch.length) return;
  const form = create('form', '', 'stack');
  const folder = field('Search folder name', 'folder', '', {
    required: true, maxLength: 80, placeholder: 'For example, Dentists in Ikeja'
  });
  const existing = create('datalist');
  existing.id = 'search-folder-names';
  for (const { name } of searchFolders().values()) existing.append(new Option(name, name));
  folder.lastChild.setAttribute('list', existing.id);
  const feedback = create('p', '', 'small');
  feedback.setAttribute('role', 'status');
  form.append(create('p', 'Save all ' + batch.length + ' results from this search.'), folder, existing, feedback,
    create('button', 'Save to folder'));
  form.onsubmit = event => {
    event.preventDefault();
    const name = folder.lastChild.value.trim().replace(/\s+/g, ' ');
    if (!name) { feedback.textContent = 'Enter a folder name.'; return; }
    const key = norm(name);
    const canonical = searchFolders().get(key)?.name || name;
    for (const item of batch) {
      let lead = duplicate(item);
      if (!lead) {
        lead = { ...item, threads: [] };
        delete lead.scanning;
        delete lead.scanned;
        leads.unshift(lead);
      }
      const folders = leadFolders(lead);
      if (!folders.some(value => norm(value) === key)) lead.folders = [...folders, canonical];
    }
    persist();
    renderResults();
    $('#filter-folder').value = key;
    for (const id of ['filter-query', 'filter-status', 'filter-platform', 'filter-stage']) $('#' + id).value = '';
    dialog.close();
    location.hash = '#leads';
    renderLeads();
  };
  show('Save search results', form);
};
$('#filter-folder').onchange = renderLeads;

$('#results-filter').onchange = () => {
  resultsPage = 1;
  renderResults();
};

function setMobileNav(open) {
  document.body.classList.toggle('nav-open', open);
  const toggleBtn = $('#menu-toggle');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(open));
}

function navigate() {
  setMobileNav(false);
  const pageTitles = {
    dashboard: 'Dashboard',
    discover: 'Find businesses',
    leads: 'Saved leads',
    business: 'Business dossier',
    inbox: 'Inbox',
    broadcast: 'Broadcast',
    profile: 'Profile & Usage',
    settings: 'Settings'
  };
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(pageTitles, requested) ? requested : 'dashboard';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== page;
  for (const link of document.querySelectorAll('nav a')) {
    const activeNav = page === 'business' ? 'leads' : page;
    if (link.hash === '#' + activeNav) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (page === 'dashboard') renderDashboard();
  if (page === 'discover') renderSavedSearches();
  if (page === 'business') renderBusinessPage();
  if (page === 'inbox') refresh();
  if (page === 'profile') renderProfile();
  if (page === 'settings') renderSettings();
  if (page === 'broadcast') renderBroadcast();
}

$('#menu-toggle').onclick = () => setMobileNav(!document.body.classList.contains('nav-open'));
$('#sidebar-close').onclick = () => setMobileNav(false);
$('#sidebar-backdrop').onclick = () => setMobileNav(false);
for (const navLink of document.querySelectorAll('aside a')) {
  navLink.addEventListener('click', () => setMobileNav(false));
}
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setMobileNav(false);
  }
});

$('#add').onclick = () => editLead();
$('#import').onclick = importLeads;
$('#export').onclick = exportLeads;
$('#enrich-all').onclick = enrichMissingEmails;
$('#close').onclick = () => dialog.close();
$('#refresh').onclick = () => refresh(true);
$('#filter-query').oninput = renderLeads;
$('#filter-status').onchange = renderLeads;
$('#filter-platform').onchange = renderLeads;
$('#filter-sort').onchange = renderLeads;
window.addEventListener('hashchange', navigate);
$('#results').replaceChildren(empty('⌕', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));
renderDashboard();
renderLeads();
renderInbox();
renderSettings();
navigate();

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
  $('#auth-submit').textContent = isSignup ? 'Create account & enter →' : 'Sign in to workspace →';
  $('#auth-error').hidden = true;
}

function applyUserSession(user, serverLeads = [], serverSettings = {}, serverMailbox = null) {
  currentUser = user;
  account.user = user;
  account.mailbox = serverMailbox;
  document.body.classList.remove('auth-locked');

  const sidebarUser = $('#sidebar-user');
  if (sidebarUser) {
    sidebarUser.replaceChildren(create('i'), document.createTextNode(' ' + (user.name || user.email)));
  }

  leads = Array.isArray(serverLeads) ? serverLeads : [];

  settings = {
    senderName: user.name || '',
    senderService: '',
    defaultFollowUpDays: 4,
    templates: defaultTemplates,
    ...(serverSettings && typeof serverSettings === 'object' ? serverSettings : {})
  };
  if (!Array.isArray(settings.templates) || !settings.templates.length) {
    settings.templates = defaultTemplates.map(template => ({ ...template }));
  }

  settings.templates = settings.templates.map(template => ({ ...template }));

  results = [];
  resultsPage = 1;
  activeBusinessId = null;
  messages.clear();
  $('#results').replaceChildren(empty('⌕', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));
  $('#save-all').hidden = true;
  $('#results-pagination').hidden = true;
  $('#results-count').textContent = '';

  persist({ sync: false });
  renderAccount();
  navigate();
  refresh();
}

function showAuthScreen() {
  currentUser = null;
  leads = [];
  results = [];
  activeBusinessId = null;
  messages.clear();
  setAuthMode('login');
  document.body.classList.add('auth-locked');
  setMobileNav(false);
}

$('#tab-login').onclick = () => setAuthMode('login');
$('#tab-signup').onclick = () => setAuthMode('signup');

$('#auth-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('#auth-submit');
  const errEl = $('#auth-error');
  errEl.hidden = true;
  submit.disabled = true;
  submit.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';

  try {
    const payload = Object.fromEntries(new FormData(form));
    const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
    const data = await api(endpoint, payload);
    form.reset();
    applyUserSession(data.user, data.leads, data.settings, data.mailbox);
  } catch (error) {
    errEl.textContent = error.message;
    errEl.hidden = false;
  } finally {
    submit.disabled = false;
    setAuthMode(authMode);
  }
};

$('#logout-btn').onclick = async () => {
  try {
    await api('/api/auth/logout', {});
  } catch {
    // Proceed with local lock
  }
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
  if (account.user) {
    applyUserSession(account.user, account.leads, account.settings, account.mailbox);
  } else {
    showAuthScreen();
  }
  setInterval(() => { if (currentUser && !document.hidden) refresh(); }, 60000);
} catch (error) { report(error.message, true); }
