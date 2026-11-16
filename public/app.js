import { readBusinessCsv, writeBusinessCsv } from './csv.mjs';

const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const storageKey = 'jobhunta.leads.v1';
const settingsKey = 'jobhunta.settings.v1';

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

let leads = JSON.parse(localStorage.getItem(storageKey) || '[]');
let settings = {
  senderName: '',
  senderService: '',
  defaultFollowUpDays: 4,
  templates: defaultTemplates,
  ...JSON.parse(localStorage.getItem(settingsKey) || '{}')
};
if (!Array.isArray(settings.templates) || !settings.templates.length) {
  settings.templates = defaultTemplates;
}

let account = {};
let results = [];
let searchGeneration = 0;
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
  const data = await response.json();
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
  api('/api/workspace', { leads, settings }).catch(() => {});
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(leads));
  localStorage.setItem(settingsKey, JSON.stringify(settings));
  syncWorkspaceToServer();
  renderLeads();
  renderInbox();
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
    website(item.twitter, 'X/Twitter')
  ].filter(Boolean);
}

function row(item, details, actions) {
  const card = create('article', '', 'surface row');
  const summary = create('div');
  summary.append(create('h3', item.name), create('p', details.filter(Boolean).join(' · ')));
  if (item.about) {
    summary.append(create('p', item.about, 'note'));
  }
  const controls = create('div', '', 'actions');
  controls.append(...actions.filter(Boolean));
  card.append(summary, controls);
  return card;
}

function applyEnrichmentToItem(item, found) {
  if (found.email && !item.email) item.email = found.email;
  if (found.facebook && !item.facebook) item.facebook = found.facebook;
  if (found.instagram && !item.instagram) item.instagram = found.instagram;
  if (found.twitter && !item.twitter) item.twitter = found.twitter;
  const savedLead = duplicate(item);
  if (savedLead) {
    if (found.email && !savedLead.email) savedLead.email = found.email;
    if (found.facebook && !savedLead.facebook) savedLead.facebook = found.facebook;
    if (found.instagram && !savedLead.instagram) savedLead.instagram = found.instagram;
    if (found.twitter && !savedLead.twitter) savedLead.twitter = found.twitter;
  }
}

async function enrichItemEmail(item, triggerButton) {
  if (!item.website) return;
  if (triggerButton) {
    triggerButton.disabled = true;
    triggerButton.textContent = 'Scanning…';
  }
  try {
    const found = await api('/api/enrich', { website: item.website });
    item.scanned = true;
    applyEnrichmentToItem(item, found);
    persist();
    if (results.length) renderResults();
    if (found.email) {
      report(`Found email for ${item.name}: ${found.email}`);
    } else {
      report(`No public email found on ${item.name}'s website.`, true);
      if (triggerButton) triggerButton.textContent = 'No email found';
    }
  } catch (error) {
    item.scanned = true;
    report(error.message, true);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = 'Find email';
    }
  }
}

async function autoEnrichSearchResults(generation) {
  let cursor = 0;
  const worker = async () => {
    while (generation === searchGeneration && cursor < results.length) {
      const item = results[cursor++];
      if (!item || !item.website || item.email || item.scanned) continue;
      item.scanning = true;
      renderResults();
      try {
        const found = await api('/api/enrich', { website: item.website });
        if (generation !== searchGeneration) return;
        applyEnrichmentToItem(item, found);
        if (duplicate(item)) persist();
      } catch {
        // Ignore individual site timeouts during background crawl
      } finally {
        item.scanning = false;
        item.scanned = true;
        if (generation === searchGeneration) renderResults();
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

function renderResults() {
  const unsavedCount = results.filter(item => !duplicate(item)).length;
  const saveAllBtn = $('#save-all');
  if (saveAllBtn) {
    saveAllBtn.hidden = results.length === 0;
    saveAllBtn.disabled = unsavedCount === 0;
    saveAllBtn.textContent = unsavedCount ? `Save all (${unsavedCount})` : 'All results saved';
  }
  const withEmailCount = results.filter(item => item.email).length;
  const countEl = $('#results-count');
  if (countEl) {
    countEl.textContent = results.length
      ? `(${results.length} found · ${withEmailCount} with email)`
      : '';
  }

  $('#results').replaceChildren(...results.map(item => {
    const saved = duplicate(item);
    const save = button(saved ? 'Saved' : 'Save lead', () => {
      if (duplicate(item)) return;
      const copy = { ...item, threads: [] };
      delete copy.scanning;
      delete copy.scanned;
      leads.unshift(copy);
      persist();
      renderResults();
    });
    save.disabled = Boolean(saved);
    const statusPill = item.email
      ? create('span', 'Email found', 'pill')
      : item.scanning
        ? create('span', 'Scanning website…', 'pill wait')
        : create('span', 'Needs email', 'pill wait');
    const enrichBtn = (!item.email && item.website && !item.scanning && !item.scanned)
      ? button('Find email', event => enrichItemEmail(item, event.currentTarget), true)
      : '';
    return row(item, [item.industry, item.city, item.address, item.email, item.phone], [
      statusPill,
      enrichBtn,
      website(item.website, 'Website'),
      ...socialLinks(item),
      website(item.source, 'Bing Maps'),
      save
    ]);
  }));
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

function getFilteredLeads() {
  const query = norm($('#filter-query')?.value);
  const statusFilter = $('#filter-status')?.value || '';
  const sortOrder = $('#filter-sort')?.value || 'recent';

  const filtered = leads.filter(lead => {
    const status = leadStatus(lead);
    if (statusFilter && status !== statusFilter) return false;
    if (!query) return true;
    const haystack = [lead.name, lead.industry, lead.city, lead.email, lead.phone, lead.address, lead.about]
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
  persist();
  if (results.length) renderResults();
  report(`Removed ${lead.name} from saved leads.`);
}

function renderLeads() {
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

  const filtered = getFilteredLeads();
  const summary = $('#lead-summary');
  if (summary) {
    summary.textContent = leads.length
      ? `Showing ${filtered.length} of ${leads.length} saved lead${leads.length === 1 ? '' : 's'}`
      : '';
  }

  $('#lead-list').replaceChildren(...(filtered.length ? filtered.map(lead => {
    const status = leadStatus(lead);
    const enrichBtn = (!lead.email && lead.website)
      ? button('Find email', event => enrichItemEmail(lead, event.currentTarget), true)
      : '';
    return row(lead, [
      lead.industry, lead.city, lead.email, lead.phone, lead.address, lead.due && 'Follow up ' + lead.due
    ], [
      website(lead.website, 'Website'),
      ...socialLinks(lead),
      website(lead.source, 'Listing'),
      create('span', status, statusPillClass(status)),
      enrichBtn,
      button('Edit', () => editLead(lead), true),
      button('Delete', () => deleteLead(lead), 'danger'),
      button('Draft email', () => compose(lead))
    ]);
  }) : [empty('▤', leads.length ? 'No matching leads' : 'No leads yet',
    leads.length ? 'Try clearing or changing your search and status filters.' : 'Save a business from search or add a contact manually.')]));
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
    .replace(/\{\{\s*your_name\s*\}\}/gi, settings.senderName || '[your name]')
    .replace(/\{\{\s*your_service\s*\}\}/gi, settings.senderService || '[your service]');
}

function openTemplatesSettings() {
  const form = create('form', '', 'stack');
  const profileGrid = create('div', '', 'grid-2');
  const senderNameInput = field('Your name', 'senderName', settings.senderName, { placeholder: 'e.g. Alex Rivera' });
  const senderServiceInput = field('Your service / offer', 'senderService', settings.senderService, { placeholder: 'e.g. local SEO & web design' });
  profileGrid.append(senderNameInput, senderServiceInput);

  const followUpInput = field('Auto follow-up reminder (days after sending, 0 to disable)', 'defaultFollowUpDays', String(settings.defaultFollowUpDays ?? 4), { type: 'number' });
  followUpInput.lastChild.min = '0';
  followUpInput.lastChild.max = '90';

  const templatesContainer = create('div', '', 'stack');
  const workingTemplates = settings.templates.map(tpl => ({ ...tpl }));

  function renderTemplateCards() {
    templatesContainer.replaceChildren();
    workingTemplates.forEach((tpl, index) => {
      const card = create('div', '', 'template-card');
      const nameField = field('Template name', `tpl_name_${index}`, tpl.name, { required: true, maxLength: 80 });
      nameField.lastChild.oninput = e => { tpl.name = e.target.value; };
      const subjField = field('Default subject', `tpl_subj_${index}`, tpl.subject, { required: true, maxLength: 160 });
      subjField.lastChild.oninput = e => { tpl.subject = e.target.value; };
      const bodyField = field('Message body (supports {{business_name}}, {{city}}, {{industry}}, {{your_name}}, {{your_service}}, {{specific_opportunity}})', `tpl_body_${index}`, tpl.body, { type: 'textarea', required: true, maxLength: 16000 });
      bodyField.lastChild.oninput = e => { tpl.body = e.target.value; };
      const cardActions = create('div', '', 'actions');
      if (workingTemplates.length > 1) {
        cardActions.append(button('Remove template', () => {
          workingTemplates.splice(index, 1);
          renderTemplateCards();
        }, 'danger'));
      }
      card.append(nameField, subjField, bodyField, cardActions);
      templatesContainer.append(card);
    });
  }
  renderTemplateCards();

  const addTemplateBtn = button('+ Add template', () => {
    workingTemplates.push({
      id: crypto.randomUUID(),
      name: 'New outreach template',
      subject: 'Quick question for {{business_name}}',
      body: 'Hi {{business_name}} team,\n\nI’m {{your_name}} and I help {{industry}} businesses in {{city}} with {{your_service}}.\n\nThanks,\n{{your_name}}'
    });
    renderTemplateCards();
  }, true);

  const submit = create('button', 'Save profile & templates');
  form.append(profileGrid, followUpInput, create('h3', 'Email templates'), templatesContainer, addTemplateBtn, submit);

  form.onsubmit = event => {
    event.preventDefault();
    settings.senderName = senderNameInput.lastChild.value.trim();
    settings.senderService = senderServiceInput.lastChild.value.trim();
    settings.defaultFollowUpDays = Math.max(0, Math.min(90, Number(followUpInput.lastChild.value) || 0));
    settings.templates = workingTemplates.map(tpl => ({
      id: tpl.id || crypto.randomUUID(),
      name: tpl.name.trim() || 'Untitled template',
      subject: tpl.subject.trim(),
      body: tpl.body.trim()
    }));
    persist();
    dialog.close();
    report('Saved sender profile and email templates.');
  };

  show('Templates & outreach profile', form);
}

function futureDateString(days) {
  if (!days || days <= 0) return '';
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA');
}

function compose(lead, conversation, parent) {
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
  templateSelect.add(new Option(parent ? 'Blank reply / custom' : 'Select a template…', ''));
  for (const tpl of settings.templates) {
    templateSelect.add(new Option(tpl.name, tpl.id));
  }
  if (!parent && defaultTpl) templateSelect.value = defaultTpl.id;
  templateWrapper.append(templateSelect);

  const to = field('To', 'to', recipient, { type: 'email', required: true, maxLength: 254 });
  const initialSubject = parent
    ? (/^re:/i.test(parent.subject || '') ? parent.subject : 'Re: ' + (parent.subject || conversation?.subject || ''))
    : interpolateTemplate(defaultTpl?.subject || 'Quick introduction to {{business_name}}', lead);
  const subject = field('Subject', 'subject', initialSubject, { required: true });
  const initialDraft = parent
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
        lead.threads.push({ id: sent.threadId, mailbox, subject: values.subject, time: Date.now(), to: values.to });
      }
      if (!lead.email) lead.email = values.to;
      if (!lead.due && settings.defaultFollowUpDays > 0) {
        lead.due = futureDateString(settings.defaultFollowUpDays);
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
    ]);
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
  $('#connect').textContent = account.mailbox ? 'Gmail connected' : account.configured ? 'Connect Gmail' : 'Set up Gmail';
  renderInbox();
}

$('#connect').onclick = async () => {
  if (account.mailbox) {
    show('Gmail account', create('p', account.mailbox), button('Disconnect', async () => {
      try {
        await api('/api/disconnect', {});
        account.mailbox = null;
        messages.clear();
        renderAccount();
        dialog.close();
      } catch (error) { dialog.close(); report(error.message, true); }
    }, true));
    return;
  }
  if (!account.configured) {
    show('Set up Gmail',
      create('p', account.credentialError || 'Jobhunta needs your Google Cloud OAuth client to connect Gmail.'),
      create('p', 'Enable Gmail API and create a Web application OAuth client. Add this authorized redirect URI:'),
      create('code', account.redirectUri || location.origin + '/oauth/callback'),
      create('p', 'Download the client JSON into the Jobhunta folder as .google-oauth.json, or add the credentials to .env. Restart Jobhunta when you’re done.'),
      website('https://console.cloud.google.com/auth/clients', 'Open Google Cloud OAuth clients'));
    return;
  }
  $('#connect').disabled = true;
  try { location.assign((await api('/api/connect', {})).url); }
  catch (error) { report(error.message, true); $('#connect').disabled = false; }
};

$('#search').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  const generation = ++searchGeneration;
  report();
  $('#results').replaceChildren(empty('⌕', 'Searching Bing Maps…', 'Scraping local business listings and contact details.'));
  try {
    results = await api('/api/search?' + new URLSearchParams(new FormData(form)));
    if (results.length) {
      renderResults();
      autoEnrichSearchResults(generation);
    } else {
      renderResults();
      $('#results').replaceChildren(empty('⌕', 'No matching businesses', 'Try a nearby city or another industry.'));
    }
  } catch (error) {
    results = [];
    renderResults();
    $('#results').replaceChildren(empty('⌕', 'Search unavailable', error.message));
  } finally { submit.disabled = false; }
};

$('#save-all').onclick = () => {
  let added = 0;
  for (const item of results) {
    if (!duplicate(item)) {
      const copy = { ...item, threads: [] };
      delete copy.scanning;
      delete copy.scanned;
      leads.unshift(copy);
      added++;
    }
  }
  if (added) {
    persist();
    renderResults();
    report(`Saved ${added} business${added === 1 ? '' : 'es'} to your leads.`);
  }
};

function navigate() {
  const pageTitles = { discover: 'Find businesses', leads: 'Saved leads', inbox: 'Inbox' };
  const requested = location.hash.slice(1);
  const page = Object.hasOwn(pageTitles, requested) ? requested : 'discover';
  for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== page;
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('#breadcrumb').textContent = pageTitles[page];
  if (page === 'inbox') refresh();
}

$('#templates').onclick = openTemplatesSettings;
$('#add').onclick = () => editLead();
$('#import').onclick = importLeads;
$('#export').onclick = exportLeads;
$('#enrich-all').onclick = enrichMissingEmails;
$('#close').onclick = () => dialog.close();
$('#refresh').onclick = () => refresh(true);
$('#filter-query').oninput = renderLeads;
$('#filter-status').onchange = renderLeads;
$('#filter-sort').onchange = renderLeads;
window.addEventListener('hashchange', navigate);
$('#results').replaceChildren(empty('⌕', 'Start a search', 'Choose or enter an industry and enter the city you want to explore.'));
renderLeads();
renderInbox();
navigate();

const oauthResult = new URLSearchParams(location.search).get('gmail');
if (oauthResult) {
  report(oauthResult === 'permissions' ? 'Allow both Gmail permissions and try again.' : 'Gmail could not be connected. Check your Google OAuth settings and try again.', true);
  history.replaceState(null, '', location.pathname + location.hash);
}
try {
  account = await api('/api/status');
  const datalist = $('#industries');
  datalist.replaceChildren(...account.industries.map(industry => new Option(industry, industry)));
  if (Array.isArray(account.leads) && account.leads.length) {
    for (const serverLead of account.leads) {
      if (!duplicate(serverLead)) leads.push(serverLead);
    }
  }
  if (account.settings && typeof account.settings === 'object') {
    settings = {
      ...settings,
      ...account.settings,
      senderName: account.settings.senderName || settings.senderName,
      senderService: account.settings.senderService || settings.senderService
    };
  }
  persist();
  renderAccount();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
} catch (error) { report(error.message, true); }
