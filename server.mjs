import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

try {
  loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const port = Number(process.env.PORT || 4173);
const origin = `http://localhost:${port}`;
const redirect_uri = origin + '/oauth/callback';
const dataFilePath = fileURLToPath(new URL('./.jobhunta-data.json', import.meta.url));

let googleClient;
let credentialError;
try {
  googleClient = JSON.parse(await readFile(new URL('./.google-oauth.json', import.meta.url), 'utf8')).web;
  if (!googleClient) credentialError = 'Use a Google OAuth client of type Web application.';
} catch (error) {
  if (error.code !== 'ENOENT') credentialError = 'The Google OAuth JSON file could not be read.';
}
const client_id = process.env.GOOGLE_CLIENT_ID?.trim() || googleClient?.client_id;
const client_secret = process.env.GOOGLE_CLIENT_SECRET?.trim() || googleClient?.client_secret;
const gmailConfigured = Boolean(client_id?.endsWith('.apps.googleusercontent.com') && client_secret);
const gmailScopes = ['gmail.send', 'gmail.readonly'].map(scope => 'https://www.googleapis.com/auth/' + scope);

export const industries = {
  Dentists: ['amenity', 'dentist'], Restaurants: ['amenity', 'restaurant'],
  Cafés: ['amenity', 'cafe'], Hotels: ['tourism', 'hotel'],
  Pharmacies: ['amenity', 'pharmacy'], Hairdressers: ['shop', 'hairdresser'],
  Supermarkets: ['shop', 'supermarket'], 'Car repair': ['shop', 'car_repair'],
  'Real estate': ['office', 'estate_agent'], Lawyers: ['office', 'lawyer'],
  Accountants: ['office', 'accountant'], Gyms: ['leisure', 'fitness_centre'],
  Bakeries: ['shop', 'bakery'], Clinics: ['amenity', 'clinic'],
  Veterinarians: ['amenity', 'veterinary'], Plumbers: ['craft', 'plumber'],
  Electricians: ['craft', 'electrician'], Florists: ['shop', 'florist'],
  'Travel agencies': ['shop', 'travel_agency'], Schools: ['amenity', 'school'],
  'Dry cleaners': ['shop', 'dry_cleaning'], Coworking: ['amenity', 'coworking_space']
};

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

const store = {
  auth: null,
  leads: [],
  settings: {
    senderName: '',
    senderService: '',
    defaultFollowUpDays: 4,
    templates: defaultTemplates
  },
  threadOwners: {}
};

try {
  const saved = JSON.parse(await readFile(dataFilePath, 'utf8'));
  if (saved && typeof saved === 'object') {
    if (saved.auth?.mailbox && saved.auth?.tokens) store.auth = saved.auth;
    if (Array.isArray(saved.leads)) store.leads = saved.leads;
    if (saved.settings && typeof saved.settings === 'object') {
      store.settings = {
        senderName: String(saved.settings.senderName || ''),
        senderService: String(saved.settings.senderService || ''),
        defaultFollowUpDays: Number(saved.settings.defaultFollowUpDays) || 4,
        templates: Array.isArray(saved.settings.templates) && saved.settings.templates.length
          ? saved.settings.templates
          : defaultTemplates
      };
    }
    if (saved.threadOwners && typeof saved.threadOwners === 'object') {
      store.threadOwners = saved.threadOwners;
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not load .jobhunta-data.json:', error.message);
}

let writeQueue = Promise.resolve();
function saveStore() {
  writeQueue = writeQueue.catch(() => {}).then(() =>
    writeFile(dataFilePath, JSON.stringify(store, null, 2), 'utf8')
  );
  return writeQueue;
}

const sessions = new Map();
const searches = new Map();
const files = {
  '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'], '/csv.mjs': ['csv.mjs', 'text/javascript'],
  '/business-import.csv': ['business-import.csv', 'text/csv']
};
const nonce = () => randomBytes(32).toString('base64url');
const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const validEmail = value => typeof value === 'string' && value.length <= 254 && emailPattern.test(value);
const jsonHeaders = { 'Content-Type': 'application/json' };
const maxAge = 30 * 24 * 60 * 60 * 1000;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

async function provider(url, options, label) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(22000) });
  } catch {
    fail(502, `${label} could not be reached. Check the connection and try again.`);
  }
  if (!response.ok) {
    if (label === 'Gmail' && response.status === 401) fail(401, 'Gmail authorization expired. Reconnect your mailbox.');
    fail(502, `${label} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function exchange(params) {
  return provider('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id, client_secret, ...params })
  }, 'Google sign-in');
}

async function gmail(session, path, payload) {
  if (!session.tokens) fail(401, 'Connect your Gmail account first.');
  if (session.tokens.expires < Date.now() + 60000) {
    session.refresh ??= exchange({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token })
      .then(tokens => {
        session.tokens = { ...session.tokens, ...tokens, expires: Date.now() + tokens.expires_in * 1000 };
        if (store.auth && store.auth.mailbox === session.mailbox) {
          store.auth.tokens = session.tokens;
          saveStore();
        }
      }).finally(() => { session.refresh = null; });
    await session.refresh;
  }
  return provider('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
    method: payload ? 'POST' : 'GET',
    headers: { ...jsonHeaders, Authorization: 'Bearer ' + session.tokens.access_token },
    body: payload ? JSON.stringify(payload) : undefined
  }, 'Gmail');
}

function header(message, name) {
  return message.payload?.headers?.find(item => item.name.toLowerCase() === name)?.value || '';
}

export function htmlToPlain(html = '') {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function plainPart(part, mimeType) {
  if (part?.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  return (part?.parts || []).map(child => plainPart(child, mimeType)).filter(Boolean).join('\n');
}

export function extractMessageBody(payload, snippet = '') {
  const plain = plainPart(payload, 'text/plain').trim();
  if (plain) return plain.slice(0, 24000);
  const html = plainPart(payload, 'text/html').trim();
  if (html) {
    const converted = htmlToPlain(html);
    if (converted) return converted.slice(0, 24000);
  }
  return (snippet || '').slice(0, 24000);
}

function extractAddress(value = '') {
  return (value.match(/<([^>]+)>/)?.[1] || value).trim();
}

async function thread(session, id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) fail(400, 'Invalid Gmail thread.');
  const owner = session.threadOwners.get(id) || store.threadOwners[id];
  if (owner !== session.mailbox) fail(404, 'This conversation is unavailable in the connected mailbox.');
  const result = await gmail(session, 'threads/' + id + '?format=full');
  return (result.messages || []).map(message => ({
    id: message.id, from: header(message, 'from'), to: header(message, 'to'),
    replyTo: header(message, 'reply-to'),
    subject: header(message, 'subject'), messageId: header(message, 'message-id'),
    references: header(message, 'references'),
    sent: message.labelIds?.includes('SENT') ?? false,
    time: Number(message.internalDate),
    body: extractMessageBody(message.payload, message.snippet)
  }));
}

async function send(session, data) {
  const { to, body, threadId, requestId } = data;
  let { subject } = data;
  if (!validEmail(to) || typeof body !== 'string' || !body.trim() || body.length > 16000 ||
      typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || subject.length > 160 ||
      !/^[a-z0-9-]{16,64}$/i.test(requestId || '')) fail(400, 'Enter a valid recipient, subject and message.');
  if (!session.mailbox) fail(401, 'Connect Gmail first.');
  const key = session.mailbox + ':' + requestId;
  if (session.sends.has(key)) return session.sends.get(key);
  const operation = (async () => {
    const headers = ['From: ' + session.mailbox, 'To: ' + to];
    if (threadId) {
      const messages = await thread(session, threadId);
      const parent = data.parentId
        ? messages.find(message => message.id === data.parentId)
        : messages.at(-1);
      if (!parent || !/^<[^<>\s]+>$/.test(parent.messageId)) {
        fail(400, 'Refresh the thread and try replying again.');
      }
      const expectedAddress = parent.sent
        ? extractAddress(parent.to)
        : extractAddress(parent.replyTo || parent.from);
      if (expectedAddress && expectedAddress.toLowerCase() !== to.toLowerCase()) {
        fail(400, 'Recipient must match the conversation address.');
      }
      subject = parent.subject || subject;
      if (!/^re:/i.test(subject)) subject = 'Re: ' + subject;
      if (/[\r\n]/.test(subject)) fail(400, 'Invalid thread subject.');
      const references = parent.references.match(/<[^<>\s]+>/g) || [];
      headers.push('In-Reply-To: ' + parent.messageId, 'References: ' + [...references.slice(-15), parent.messageId].join(' '));
    }
    const subjectParts = [];
    let subjectPart = '';
    for (const character of subject) {
      if (Buffer.byteLength(subjectPart + character) > 42) {
        subjectParts.push(subjectPart);
        subjectPart = '';
      }
      subjectPart += character;
    }
    subjectParts.push(subjectPart);
    const encodedSubject = subjectParts.map(part => '=?UTF-8?B?' + Buffer.from(part).toString('base64') + '?=').join('\r\n ');
    headers.push('Subject: ' + encodedSubject, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64');
    const encodedBody = Buffer.from(body).toString('base64').match(/.{1,76}/g).join('\r\n');
    const raw = Buffer.from(headers.join('\r\n') + '\r\n\r\n' + encodedBody).toString('base64url');
    const result = await gmail(session, 'messages/send', { raw, ...(threadId ? { threadId } : {}) });
    session.threadOwners.set(result.threadId, session.mailbox);
    store.threadOwners[result.threadId] = session.mailbox;
    saveStore();
    return result;
  })();
  session.sends.set(key, operation);
  return operation;
}

function decodeHtmlEntities(str = '') {
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function extractBingInfoboxRating(infoboxHtml = '') {
  if (!infoboxHtml) return { rating: '', ratingInfo: '' };
  let stars = 0;
  for (const match of infoboxHtml.matchAll(/class=["'][^"']*\b(sw_st|sw_sth|sw_ste)\b[^"']*["']/g)) {
    if (match[1] === 'sw_st') stars += 1;
    else if (match[1] === 'sw_sth') { stars += 0.5; break; }
    else if (match[1] === 'sw_ste') break;
  }
  const ratingsBlock = infoboxHtml.match(/class=["'][^"']*bm_ib_ratings[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const ratingInfo = decodeHtmlEntities(ratingsBlock.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return { rating: stars > 0 ? String(stars) : '', ratingInfo };
}

export function parseBingMapsHtml(html = '', fallbackIndustry = '', city = '') {
  const results = [];
  const cardRegex = /data-entity="([^"]+)"([\s\S]*?)(?=data-entity="|$)/g;
  for (const match of html.matchAll(cardRegex)) {
    let parsed;
    try {
      parsed = JSON.parse(decodeHtmlEntities(match[1]));
    } catch {
      continue;
    }
    const entity = parsed?.entity;
    if (!entity?.id || !entity?.title) continue;
    const cardSnippet = match[2] || '';
    const opHoursMatch = cardSnippet.match(/class=["'][^"']*opHours[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/span>/i);
    const cardHours = opHoursMatch
      ? decodeHtmlEntities(opHoursMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      : '';
    const openHours = cardHours || entity.openHoursText || '';
    const { rating, ratingInfo } = extractBingInfoboxRating(entity.infoboxHtml || '');
    const lat = parsed.routablePoint?.latitude ?? parsed.geometry?.y ?? '';
    const lng = parsed.routablePoint?.longitude ?? parsed.geometry?.x ?? '';
    const address = entity.address || '';
    const bingMapsUrl = (entity.title && address && lat && lng)
      ? `https://www.bing.com/maps?cp=${lat}%7E${lng}&lvl=17.0&q=${encodeURIComponent(entity.title + ' , ' + address)}`
      : `https://www.bing.com/maps?q=${encodeURIComponent(entity.title + ' ' + (address || city))}`;
    const category = entity.primaryCategoryName || fallbackIndustry;
    const aboutParts = [
      category && category !== fallbackIndustry ? category : '',
      rating ? `★ ${rating}` : '',
      ratingInfo,
      openHours
    ].filter(Boolean);

    let website = entity.website || '';
    if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;

    results.push({
      id: entity.id,
      name: entity.title,
      industry: category || fallbackIndustry,
      city,
      address,
      about: aboutParts.join(' · '),
      website,
      phone: entity.phone || '',
      email: '',
      source: bingMapsUrl,
      imageUrl: entity.imageUrl || '',
      latitude: lat,
      longitude: lng,
      rating,
      ratingInfo,
      openHours,
      facebook: '',
      instagram: '',
      twitter: ''
    });
  }
  return results;
}

async function searchBingMaps(cleanIndustry, city) {
  const query = `${cleanIndustry} in ${city}`;
  const seen = new Map();
  const offsets = [1, 11, 21, 31, 41];
  const pages = await Promise.allSettled(offsets.map(async first => {
    const url = `https://www.bing.com/maps/overlaybfpr?q=${encodeURIComponent(query)}&count=20&first=${first}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseBingMapsHtml(html, cleanIndustry, city);
  }));

  for (const page of pages) {
    if (page.status === 'fulfilled') {
      for (const item of page.value) {
        if (!seen.has(item.id)) seen.set(item.id, item);
      }
    }
  }
  return [...seen.values()];
}

async function searchOverpassFallback(cleanIndustry, city) {
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cityName = `["name"~${JSON.stringify('^' + escapedCity + '$')},i]`;

  let areaQuery;
  let nearbyQuery;
  if (Object.hasOwn(industries, cleanIndustry)) {
    const [tag, value] = industries[cleanIndustry];
    const filter = `["${tag}"="${value}"]["name"]`;
    areaQuery = `area${cityName}["boundary"="administrative"]->.city;nwr(area.city)${filter};`;
    nearbyQuery = `node${cityName}["place"~"^(city|town|village|suburb|borough|municipality)$"]->.city;nwr(around.city:6000)${filter};`;
  } else {
    const escapedInd = cleanIndustry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const slugInd = cleanIndustry.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const tagRegex = JSON.stringify(slugInd ? `(${escapedInd}|${slugInd})` : escapedInd);
    const nameRegex = JSON.stringify(escapedInd);
    areaQuery = `area${cityName}["boundary"="administrative"]->.city;(` +
      `nwr(area.city)["amenity"~${tagRegex},i]["name"];` +
      `nwr(area.city)["shop"~${tagRegex},i]["name"];` +
      `nwr(area.city)["office"~${tagRegex},i]["name"];` +
      `nwr(area.city)["craft"~${tagRegex},i]["name"];` +
      `nwr(area.city)["tourism"~${tagRegex},i]["name"];` +
      `nwr(area.city)["name"~${nameRegex},i];);`;
    nearbyQuery = `node${cityName}["place"~"^(city|town|village|suburb|borough|municipality)$"]->.city;(` +
      `nwr(around.city:6000)["amenity"~${tagRegex},i]["name"];` +
      `nwr(around.city:6000)["shop"~${tagRegex},i]["name"];` +
      `nwr(around.city:6000)["office"~${tagRegex},i]["name"];` +
      `nwr(around.city:6000)["craft"~${tagRegex},i]["name"];` +
      `nwr(around.city:6000)["tourism"~${tagRegex},i]["name"];` +
      `nwr(around.city:6000)["name"~${nameRegex},i];);`;
  }

  const queryOverpass = async query => {
    for (const host of ['overpass-api.de', 'overpass.private.coffee']) {
      try {
        const result = await provider('https://' + host + '/api/interpreter', {
          method: 'POST',
          headers: { 'User-Agent': 'Jobhunta/1.1 (personal local business search)', Accept: 'application/json' },
          body: new URLSearchParams({ data: '[out:json][timeout:12];' + query + 'out tags 100;' })
        }, 'Business search');
        if (!result.remark && Array.isArray(result.elements)) return result;
      } catch {
        // Try the next public instance when the first returns no usable response.
      }
    }
    fail(502, 'Business search is temporarily unavailable. Try again later or import a CSV from Saved leads.');
  };

  let result = await queryOverpass(areaQuery);
  if (!result.elements.length) result = await queryOverpass(nearbyQuery);
  return (result.elements || []).map(({ type, id, tags = {} }) => ({
    id: `osm-${type}-${id}`, name: tags.name, industry: cleanIndustry, city,
    address: tags['addr:full'] || [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    about: tags.description || '',
    website: tags['contact:website'] || tags.website || '',
    phone: tags['contact:phone'] || tags.phone || '',
    email: [tags['contact:email'], tags.email].find(validEmail) || '',
    source: `https://www.openstreetmap.org/${type}/${id}`
  }));
}

async function search(industry, city) {
  const cleanIndustry = (industry || '').trim();
  if (!/^[\p{L}\p{M}\p{N} .,'’&/()-]{2,50}$/u.test(cleanIndustry) ||
      !/^[\p{L}\p{M}\p{N} .,'’()-]{2,75}$/u.test(city)) {
    fail(400, 'Choose or enter an industry and enter a city.');
  }
  const key = cleanIndustry.toLowerCase() + '/' + city.toLowerCase();
  if (searches.has(key)) return searches.get(key);

  const operation = (async () => {
    const bingResults = await searchBingMaps(cleanIndustry, city);
    if (bingResults.length) return bingResults;
    return await searchOverpassFallback(cleanIndustry, city);
  })();
  searches.set(key, operation);
  setTimeout(() => searches.delete(key), 300000).unref();
  try { return await operation; } catch (error) { searches.delete(key); throw error; }
}

function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return true;
}

async function assertSafePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail(400, 'Enter a valid website URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.') ||
      parsed.username || parsed.password || parsed.hostname.endsWith('.local')) {
    fail(400, 'Enter a public http or https website URL.');
  }
  if (isIP(parsed.hostname)) {
    if (isPrivateAddress(parsed.hostname)) fail(400, 'Private network addresses are not allowed.');
    return parsed;
  }
  try {
    const records = await lookup(parsed.hostname, { all: true });
    if (!records.length || records.some(record => isPrivateAddress(record.address))) {
      fail(400, 'Website address could not be verified as a public host.');
    }
  } catch (error) {
    if (error.status) throw error;
    fail(502, 'Could not resolve website address.');
  }
  return parsed;
}

const ignoredEmailDomains = new Set(['example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com', 'sentry.io', 'wixpress.com']);
const ignoredExtensions = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|eot|ico|pdf|mp4|mp3|zip)$/i;

export function extractEmailsFromHtml(html = '') {
  const found = new Set();
  const addCandidate = candidate => {
    const cleaned = decodeURIComponent(candidate || '')
      .replace(/^mailto:/i, '')
      .split('?')[0]
      .trim()
      .replace(/[.,;:'")\]}>]+$/, '')
      .toLowerCase();
    if (!validEmail(cleaned) || ignoredExtensions.test(cleaned)) return;
    const domain = cleaned.split('@')[1];
    if (ignoredEmailDomains.has(domain)) return;
    found.add(cleaned);
  };
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'>\s]+)/gi)) {
    addCandidate(match[1]);
  }
  const text = html.replace(/<[^>]+>/g, ' ');
  for (const match of text.matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
    addCandidate(match[0]);
  }
  return [...found];
}

export function extractSocialsFromHtml(html = '') {
  const socials = { facebook: '', instagram: '', twitter: '', linkedin: '' };
  const urlRegex = /https?:\/\/(?:www\.)?(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com)\/[^\s"'<>)]+/gi;
  for (const match of html.matchAll(urlRegex)) {
    const raw = decodeHtmlEntities(match[0]).replace(/[.,;:'")\]}>]+$/, '');
    const host = match[1].toLowerCase();
    if (/\/(tr\?|sharer|share|plugins|dialog|intent\/)/i.test(raw)) continue;
    if (host === 'facebook.com' && !socials.facebook) socials.facebook = raw;
    else if (host === 'instagram.com' && !socials.instagram) socials.instagram = raw;
    else if ((host === 'twitter.com' || host === 'x.com') && !socials.twitter) socials.twitter = raw;
    else if (host === 'linkedin.com' && !socials.linkedin) socials.linkedin = raw;
  }
  return socials;
}

async function fetchWebsiteEmails(websiteUrl) {
  const base = await assertSafePublicUrl(websiteUrl);
  const fetchHtml = async targetUrl => {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return '';
    const text = await response.text();
    return text.slice(0, 350000);
  };

  let homepageHtml = '';
  try {
    homepageHtml = await fetchHtml(base.href);
  } catch {
    fail(502, 'Could not reach the business website.');
  }
  const emails = new Set(extractEmailsFromHtml(homepageHtml));
  const socials = extractSocialsFromHtml(homepageHtml);
  if (!emails.size && homepageHtml) {
    const contactMatch = [...homepageHtml.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
      .map(match => match[1])
      .find(href => /(contact|about|impressum|get-in-touch|reach-us)/i.test(href));
    if (contactMatch) {
      try {
        const contactUrl = new URL(contactMatch, base.href);
        if (contactUrl.hostname === base.hostname && ['http:', 'https:'].includes(contactUrl.protocol)) {
          const contactHtml = await fetchHtml(contactUrl.href);
          for (const email of extractEmailsFromHtml(contactHtml)) emails.add(email);
          const subSocials = extractSocialsFromHtml(contactHtml);
          for (const key of Object.keys(socials)) {
            if (!socials[key] && subSocials[key]) socials[key] = subSocials[key];
          }
        }
      } catch {
        // Ignore subpage fetch failure
      }
    }
  }
  return {
    emails: [...emails],
    email: [...emails][0] || '',
    socials,
    facebook: socials.facebook,
    instagram: socials.instagram,
    twitter: socials.twitter
  };
}

async function readJson(req, limit = 512000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Invalid form data.');
    return parsed;
  } catch { fail(400, 'Invalid form data.'); }
}

function hydrateSessionFromStore(session) {
  if (!session.mailbox && store.auth?.mailbox && store.auth?.tokens) {
    session.mailbox = store.auth.mailbox;
    session.tokens = store.auth.tokens;
  }
  for (const [threadId, owner] of Object.entries(store.threadOwners)) {
    session.threadOwners.set(threadId, owner);
  }
}

export const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json = (value, status = 200) => { res.writeHead(status, jsonHeaders); res.end(JSON.stringify(value)); };
  const redirect = location => { res.writeHead(303, { Location: location }); res.end(); };
  try {
    if (req.headers.host !== new URL(origin).host) fail(403, 'Open Jobhunta using ' + origin);
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method === 'GET' && Object.hasOwn(files, path)) {
      const [file, contentType] = files[path];
      const content = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
      return res.end(content);
    }
    if (req.method === 'POST' && req.headers.origin !== origin) fail(403, 'Open Jobhunta directly to submit this request.');
    const sessionToken = req.headers.cookie?.match(/(?:^|;\s*)jobhunta=([\w-]+)/)?.[1];
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    let session = sessions.get(sessionToken);
    if (!session) {
      const token = nonce();
      session = { expires: Date.now() + maxAge, sends: new Map(), threadOwners: new Map() };
      hydrateSessionFromStore(session);
      sessions.set(token, session);
      res.setHeader('Set-Cookie', `jobhunta=${token}; HttpOnly; SameSite=Lax; Path=/`);
    } else {
      hydrateSessionFromStore(session);
    }
    if (req.method === 'POST' && path === '/api/connect') {
      if (!gmailConfigured) fail(503, credentialError || 'Add a Google web OAuth client to enable Gmail.');
      session.oauth = { state: nonce(), verifier: nonce(), expires: Date.now() + 600000 };
      const params = new URLSearchParams({ client_id, redirect_uri, response_type: 'code', scope: gmailScopes.join(' '),
        access_type: 'offline', prompt: 'consent', state: session.oauth.state,
        code_challenge: createHash('sha256').update(session.oauth.verifier).digest('base64url'), code_challenge_method: 'S256' });
      return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params });
    }
    if (req.method === 'GET' && path === '/oauth/callback') {
      const pending = session.oauth;
      delete session.oauth;
      if (!pending || pending.expires < Date.now() || url.searchParams.get('state') !== pending.state ||
          !url.searchParams.get('code')) return redirect('/?gmail=failed#inbox');
      try {
        const tokens = await exchange({ grant_type: 'authorization_code', code: url.searchParams.get('code'),
          redirect_uri, code_verifier: pending.verifier });
        if (!tokens.refresh_token || !gmailScopes.every(scope => (tokens.scope || '').split(' ').includes(scope))) {
          return redirect('/?gmail=permissions#inbox');
        }
        const candidate = { tokens: { ...tokens, expires: Date.now() + tokens.expires_in * 1000 } };
        const account = await gmail(candidate, 'profile');
        if (!validEmail(account.emailAddress)) return redirect('/?gmail=failed#inbox');
        session.tokens = candidate.tokens;
        session.mailbox = account.emailAddress;
        store.auth = { mailbox: account.emailAddress, tokens: candidate.tokens };
        await saveStore();
        return redirect('/#inbox');
      } catch { return redirect('/?gmail=failed#inbox'); }
    }
    if (req.method === 'GET' && path === '/api/status') {
      return json({
        industries: Object.keys(industries),
        configured: gmailConfigured,
        credentialError,
        redirectUri: redirect_uri,
        mailbox: session.mailbox ?? null,
        leads: store.leads,
        settings: store.settings
      });
    }
    if (req.method === 'POST' && path === '/api/workspace') {
      const payload = await readJson(req, 2000000);
      if (Array.isArray(payload.leads)) {
        store.leads = payload.leads.slice(0, 5000);
        for (const lead of store.leads) {
          for (const conv of lead.threads || []) {
            if (conv.id && conv.mailbox) {
              store.threadOwners[conv.id] = conv.mailbox;
              session.threadOwners.set(conv.id, conv.mailbox);
            }
          }
        }
      }
      if (payload.settings && typeof payload.settings === 'object') {
        store.settings = {
          senderName: String(payload.settings.senderName || '').slice(0, 120),
          senderService: String(payload.settings.senderService || '').slice(0, 300),
          defaultFollowUpDays: Math.max(0, Math.min(90, Number(payload.settings.defaultFollowUpDays) || 0)),
          templates: Array.isArray(payload.settings.templates) && payload.settings.templates.length
            ? payload.settings.templates.slice(0, 25).map(tpl => ({
                id: String(tpl.id || nonce()).slice(0, 64),
                name: String(tpl.name || 'Untitled template').slice(0, 80),
                subject: String(tpl.subject || '').slice(0, 160),
                body: String(tpl.body || '').slice(0, 16000)
              }))
            : defaultTemplates
        };
      }
      await saveStore();
      return json({ ok: true });
    }
    if (req.method === 'POST' && path === '/api/disconnect') {
      delete session.tokens;
      delete session.mailbox;
      store.auth = null;
      await saveStore();
      return json({ ok: true });
    }
    if (req.method === 'GET' && path === '/api/search') {
      return json(await search(url.searchParams.get('industry'), (url.searchParams.get('city') || '').trim()));
    }
    if (req.method === 'POST' && path === '/api/enrich') {
      const { website } = await readJson(req);
      if (typeof website !== 'string' || !website.trim()) fail(400, 'Provide a website URL to scan.');
      return json(await fetchWebsiteEmails(website.trim()));
    }
    if (req.method === 'POST' && path === '/api/send') return json(await send(session, await readJson(req)));
    if (req.method === 'POST' && path === '/api/thread') {
      const { id, mailbox } = await readJson(req);
      if (!session.mailbox) fail(401, 'Connect your Gmail account first.');
      if (session.mailbox !== mailbox) fail(403, 'Connect the Gmail account that sent this conversation.');
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) fail(400, 'Invalid Gmail thread.');
      session.threadOwners.set(id, mailbox);
      store.threadOwners[id] = mailbox;
      saveStore();
      return json(await thread(session, id));
    }
    return json({ error: 'Page not found.' }, 404);
  } catch (error) {
    return json({ error: error.status ? error.message : 'Jobhunta could not complete the request.' }, error.status || 500);
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, 'localhost', () => console.log('Jobhunta is running at ' + origin));
}
