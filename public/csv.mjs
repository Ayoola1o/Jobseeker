const columns = {
  business_name: 'name', email: 'email', phone_number: 'phone', website: 'website',
  about_business: 'about', industry: 'industry', address: 'address', city: 'city',
  source: 'source', follow_up_date: 'due', status: 'classification',
  open_hours: 'openHours', rating: 'rating',
  facebook: 'facebook', instagram: 'instagram', twitter: 'twitter'
};
const aliases = {
  name: 'business_name', business: 'business_name', title: 'business_name',
  phone: 'phone_number', tel: 'phone_number',
  description: 'about_business', about: 'about_business', notes: 'about_business',
  email_address: 'email', emails: 'email',
  category: 'industry', type: 'industry',
  bing_maps_url: 'source', listing_url: 'source', url: 'website',
  follow_up: 'follow_up_date', due: 'follow_up_date', classification: 'status',
  hours: 'open_hours'
};

const emailRegex = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const validStatuses = new Set(['interested', 'declined', 'away', 'unsubscribe', 'bounced']);

function cleanScraperValue(value = '') {
  const trimmed = value.trim();
  if (/^\*{2,}.*\*{2,}$/.test(trimmed)) return '';
  return trimmed;
}

function extractEmail(raw = '') {
  const cleaned = cleanScraperValue(raw);
  if (!cleaned) return '';
  const candidates = cleaned.split(/[,;\s]+/).map(part => part.trim()).filter(Boolean);
  return candidates.find(candidate => emailRegex.test(candidate)) || candidates[0] || '';
}

function records(text) {
  const rows = [];
  let row = [];
  let field = '';
  let state = 'start';
  const finishField = () => {
    row.push(field.trim());
    field = '';
    state = 'start';
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (state === 'quoted') {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') state = 'closed';
      else field += character;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n' || character === '\r') {
      finishField();
      rows.push(row);
      row = [];
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else if (character === '"' && state === 'start') {
      state = 'quoted';
    } else {
      if (character === '"' || (state === 'closed' && !/\s/.test(character))) {
        throw new Error('Check the quotes in CSV row ' + (rows.length + 1) + '.');
      }
      field += character;
      if (state !== 'closed' && field.trim()) state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('An unfinished quote appears in CSV row ' + (rows.length + 1) + '.');
  if (row.length || field || state !== 'start') {
    finishField();
    rows.push(row);
  }
  return rows;
}

export function readBusinessCsv(text) {
  const rows = records(text.replace(/^\uFEFF/, ''));
  const header = rows.findIndex(row => row.some(Boolean));
  const keys = (rows[header] || []).map(value => {
    const key = value.toLowerCase().replace(/[\s-]+/g, '_');
    return Object.hasOwn(aliases, key) ? aliases[key] : key;
  });
  if (!keys.includes('business_name')) throw new Error('Add the business_name column or use the CSV template.');
  const known = keys.filter(key => Object.hasOwn(columns, key));
  if (new Set(known).size !== known.length) throw new Error('Remove repeated column headers.');
  const businesses = [];
  const errors = [];
  for (let index = header + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row.some(Boolean)) continue;
    const item = {
      name: '', email: '', phone: '', website: '', about: '', industry: '', address: '', city: '',
      source: '', due: '', classification: '', openHours: '', rating: '', facebook: '', instagram: '', twitter: ''
    };
    keys.forEach((key, column) => {
      if (Object.hasOwn(columns, key)) item[columns[key]] = cleanScraperValue(row[column] || '');
    });
    if (/^upgrade to pro plan/i.test(item.name)) continue;
    item.email = extractEmail(item.email);
    if (!item.about && (item.rating || item.openHours)) {
      item.about = [item.rating ? `★ ${item.rating}` : '', item.openHours].filter(Boolean).join(' · ');
    }
    if (item.classification) {
      const normalizedStatus = item.classification.toLowerCase().trim();
      item.classification = validStatuses.has(normalizedStatus) ? normalizedStatus : '';
    }
    let issue;
    if (row.length > keys.length) issue = 'extra fields. Put text containing commas inside double quotes.';
    else if (!item.name) issue = 'missing business name.';
    else if (item.email && !emailRegex.test(item.email)) issue = 'invalid email address.';
    for (const urlField of ['website', 'source', 'facebook', 'instagram', 'twitter']) {
      if (!issue && item[urlField]) {
        try {
          const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(item[urlField]) ? item[urlField] : 'https://' + item[urlField]);
          if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error();
          item[urlField] = url.href;
        } catch {
          if (urlField === 'website') issue = 'invalid website.';
          else item[urlField] = '';
        }
      }
    }
    if (issue) errors.push('Row ' + (index + 1) + ': ' + issue);
    else businesses.push(item);
  }
  return { businesses, errors };
}

function escapeCsvField(value = '') {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function writeBusinessCsv(leads) {
  const headers = [
    'email', 'business_name', 'phone_number', 'website', 'about_business', 'industry', 'address', 'city',
    'status', 'follow_up_date', 'source', 'open_hours', 'rating', 'facebook', 'instagram', 'twitter'
  ];
  const lines = [headers.join(',')];
  for (const lead of leads) {
    lines.push([
      lead.email || '',
      lead.name || '',
      lead.phone || '',
      lead.website || '',
      lead.about || '',
      lead.industry || '',
      lead.address || '',
      lead.city || '',
      lead.classification || '',
      lead.due || '',
      lead.source || '',
      lead.openHours || '',
      lead.rating || '',
      lead.facebook || '',
      lead.instagram || '',
      lead.twitter || ''
    ].map(escapeCsvField).join(','));
  }
  return lines.join('\r\n');
}
