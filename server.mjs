import { platformDomains, searchList, googleQueries, publicWebsite, businessKeys, websiteIdentity } from './public/discovery.mjs';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile?.(fileURLToPath(new URL('./.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const port = Number(process.env.PORT || 4173);
const localOrigin = `http://localhost:${port}`;
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dataFilePath = isServerless
  ? join(tmpdir(), 'jobhunta-data.json')
  : fileURLToPath(new URL('./.jobhunta-data.json', import.meta.url));

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

const sessionSecret = process.env.SESSION_SECRET?.trim();
if ((isServerless || process.env.NODE_ENV === 'production') &&
    (!sessionSecret || sessionSecret.length < 32 || sessionSecret === client_secret)) {
  throw new Error('Production requires an independent SESSION_SECRET of at least 32 characters.');
}
const cookieKey = createHash('sha256')
  .update(sessionSecret || randomBytes(32))
  .digest();

function sealCookie(payload) {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', cookieKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  } catch {
    return '';
  }
}

function unsealCookie(token = '') {
  try {
    const [ivB64, tagB64, dataB64] = token.split('.');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', cookieKey, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

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
  'Dry cleaners': ['shop', 'dry_cleaning'], Coworking: ['amenity', 'coworking_space'],
  'Clothing & Fashion': ['shop', 'clothes'], 'Cosmetics & Skincare': ['shop', 'cosmetics'],
  'Jewelry stores': ['shop', 'jewelry'], 'Furniture & Home': ['shop', 'furniture'],
  'Electronics stores': ['shop', 'electronics'], 'Shoe stores': ['shop', 'shoes'],
  'Sporting goods': ['shop', 'sports'], 'Pet stores': ['shop', 'pet'],
  'Gift shops': ['shop', 'gift']
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

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash = '') {
  const [salt, keyHex] = String(storedHash).split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = scryptSync(String(password), salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return timingSafeEqual(keyBuf, derivedBuf);
}

function createEmptyWorkspace(name = '', service = '') {
  return {
    auth: null,
    leads: [],
    settings: {
      senderName: name,
      senderService: service,
      defaultFollowUpDays: 4,
      templates: defaultTemplates
    },
    threadOwners: {}
  };
}

const store = {
  users: [],
  workspaces: {
    default: createEmptyWorkspace()
  }
};

function getWorkspace(userId = 'default') {
  const key = userId || 'default';
  if (!store.workspaces[key]) {
    store.workspaces[key] = createEmptyWorkspace();
  }
  return store.workspaces[key];
}

try {
  const saved = JSON.parse(await readFile(dataFilePath, 'utf8'));
  if (saved && typeof saved === 'object') {
    if (Array.isArray(saved.users)) store.users = saved.users;
    if (saved.workspaces && typeof saved.workspaces === 'object') {
      store.workspaces = saved.workspaces;
    } else if (Array.isArray(saved.leads) || saved.settings) {
      store.workspaces.default = {
        auth: saved.auth || null,
        leads: Array.isArray(saved.leads) ? saved.leads : [],
        settings: {
          senderName: String(saved.settings?.senderName || ''),
          senderService: String(saved.settings?.senderService || ''),
          savedSearches: normalizeSavedSearches(saved.settings?.savedSearches),
          defaultFollowUpDays: Number(saved.settings?.defaultFollowUpDays) || 4,
          templates: Array.isArray(saved.settings?.templates) && saved.settings.templates.length
            ? saved.settings.templates
            : defaultTemplates
        },
        threadOwners: saved.threadOwners || {}
      };
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Could not load .jobhunta-data.json:', error.message);
}

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
const supabaseKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();
const supabaseConfigured = Boolean(supabaseUrl.startsWith('https://') && supabaseKey);
let supabaseStatus = { configured: supabaseConfigured, connected: false, error: null };

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseKey,
    Authorization: 'Bearer ' + supabaseKey,
    'Content-Type': 'application/json',
    ...extra
  };
}

function dbRowId(userId, leadId) {
  const raw = String(leadId || randomBytes(12).toString('hex'));
  return raw.startsWith(userId + ':') ? raw : `${userId}:${raw}`;
}

function stripUserPrefix(userId, rowId = '') {
  const prefix = userId + ':';
  return String(rowId).startsWith(prefix) ? String(rowId).slice(prefix.length) : String(rowId);
}

function leadToSupabaseRow(lead, userId = 'default') {
  const cleanId = stripUserPrefix(userId, lead.id || randomBytes(12).toString('hex'));
  return {
    id: dbRowId(userId, cleanId),
    user_id: userId,
    name: String(lead.name || 'Unnamed Business'),
    industry: String(lead.industry || ''),
    city: String(lead.city || ''),
    address: String(lead.address || ''),
    email: String(lead.email || ''),
    phone: String(lead.phone || ''),
    website: String(lead.website || ''),
    source: String(lead.source || ''),
    platform: String(lead.platform || ''),
    rating: String(lead.rating || ''),
    open_hours: String(lead.openHours || ''),
    search_rank: Number.isFinite(Number(lead.searchRank)) ? Number(lead.searchRank) : null,
    classification: String(lead.classification || ''),
    due: String(lead.due || ''),
    about: String(lead.about || ''),
    data: { ...lead, id: cleanId },
    updated_at: new Date().toISOString()
  };
}

function supabaseRowToLead(row, userId = 'default') {
  const cleanId = stripUserPrefix(userId, row.id);
  return {
    ...(row.data && typeof row.data === 'object' ? row.data : {}),
    id: cleanId,
    name: row.name,
    industry: row.industry || '',
    city: row.city || '',
    address: row.address || '',
    email: row.email || '',
    phone: row.phone || '',
    website: row.website || '',
    source: row.source || '',
    platform: row.platform || '',
    rating: row.rating || '',
    openHours: row.open_hours || row.data?.openHours || '',
    searchRank: row.search_rank ?? row.data?.searchRank,
    classification: row.classification || '',
    due: row.due || '',
    about: row.about || ''
  };
}

export const USER_TIERS = {
  basic: { key: 'basic', label: 'Basic', dailySearchLimit: 50, dailyResultLimit: 250, dailyEmailLimit: 10 },
  silver: { key: 'silver', label: 'Silver', dailySearchLimit: 20, dailyResultLimit: 500, dailyEmailLimit: 30 },
  gold: { key: 'gold', label: 'Gold', dailySearchLimit: 50, dailyResultLimit: 1500, dailyEmailLimit: 50 },
  premium: { key: 'premium', label: 'Premium', dailySearchLimit: 100, dailyResultLimit: 3000, dailyEmailLimit: 100 },
  diamond: { key: 'diamond', label: 'Diamond', dailySearchLimit: null, dailyResultLimit: null, dailyEmailLimit: null }
};

function todayUsageDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getUserQuotaStatus(userRecord = {}) {
  const tierKey = String(userRecord?.tier || 'basic').toLowerCase();
  const tier = USER_TIERS[tierKey] || USER_TIERS.basic;
  const today = todayUsageDate();
  const sameDay = userRecord?.usage_date === today;
  const searchesToday = sameDay ? Math.max(0, Number(userRecord?.searches_today) || 0) : 0;
  const resultsToday = sameDay ? Math.max(0, Number(userRecord?.results_today) || 0) : 0;
  const emailsToday = sameDay ? Math.max(0, Number(userRecord?.emails_today) || 0) : 0;
  return {
    tier: tier.key,
    label: tier.label,
    dailySearchLimit: tier.dailySearchLimit,
    dailyEmailLimit: tier.dailyEmailLimit,
    dailyResultLimit: tier.dailyResultLimit,
    searchesToday,
    resultsToday,
    emailsToday,
    usageDate: today
  };
}

async function findUserById(userId) {
  if (!userId) return null;
  if (supabaseConfigured) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/jobhunta_users?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`, {
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]) return rows[0];
      }
    } catch {
      // Fallback to local store
    }
  }
  return store.users.find(u => u.id === userId) || null;
}

async function consumeQuota(userId, kind, refundDate = null, requested = 1) {
  if (!userId) fail(401, 'Sign in to your Jobhunta account first.');
  const field = { search: 'searches_today', email: 'emails_today', result: 'results_today' }[kind];
  for (let attempt = 0; attempt < 8; attempt++) {
    const record = await findUserById(userId);
    if (!record) fail(503, 'Usage is temporarily unavailable.');
    const quota = getUserQuotaStatus(record);
    if (refundDate && refundDate !== quota.usageDate) return;
    const counters = { search: quota.searchesToday, email: quota.emailsToday, result: quota.resultsToday };
    const limits = { search: quota.dailySearchLimit, email: quota.dailyEmailLimit, result: quota.dailyResultLimit };
    const used = counters[kind];
    const limit = limits[kind];
    if (kind === 'search' && !refundDate && quota.dailyResultLimit !== null && quota.resultsToday >= quota.dailyResultLimit) {
      fail(429, 'Daily search result limit reached. Your allowance resets at midnight UTC.');
    }
    const granted = limit === null ? requested : Math.max(0, Math.min(requested, limit - used));
    if (!refundDate && !granted) {
      if (kind === 'result') return 0;
      fail(429, 'Daily ' + kind + ' limit reached.');
    }
    const changes = {
      usage_date: quota.usageDate,
      searches_today: quota.searchesToday,
      emails_today: quota.emailsToday,
      results_today: quota.resultsToday
    };
    changes[field] = Math.max(0, used + (refundDate ? -1 : granted));
    const result = kind === 'result' ? granted : quota.usageDate;
    if (!supabaseConfigured) {
      Object.assign(record, changes);
      await saveStore(userId);
      return result;
    }
    const match = new URLSearchParams({
      id: 'eq.' + userId, usage_date: 'eq.' + record.usage_date,
      searches_today: 'eq.' + record.searches_today, emails_today: 'eq.' + record.emails_today,
      results_today: 'eq.' + (record.results_today ?? 0), tier: 'eq.' + record.tier
    });
    const response = await fetch(supabaseUrl + '/rest/v1/jobhunta_users?' + match, {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(changes),
      signal: AbortSignal.timeout(6000)
    }).catch(() => fail(503, 'Usage is temporarily unavailable.'));
    if (!response.ok) fail(503, 'Usage is temporarily unavailable.');
    if ((await response.json()).length) return result;
  }
  fail(503, 'Usage changed during the request. Try again.');
}

async function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  if (supabaseConfigured) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/jobhunta_users?email=eq.${encodeURIComponent(normalized)}&select=*&limit=1`, {
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows[0]) return rows[0];
      }
    } catch {
      // Fallback to local store
    }
  }
  return store.users.find(u => u.email.toLowerCase() === normalized) || null;
}

async function createUserAccount({ name, email, password, senderService = '', tier = 'basic' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const tierKey = Object.hasOwn(USER_TIERS, String(tier).toLowerCase()) ? String(tier).toLowerCase() : 'basic';
  const userRecord = {
    id: randomUUID(),
    email: normalizedEmail,
    name: cleanName,
    password_hash: hashPassword(password),
    tier: tierKey,
    searches_today: 0,
    results_today: 0,
    emails_today: 0,
    usage_date: todayUsageDate(),
    created_at: new Date().toISOString()
  };
  if (supabaseConfigured) {
    const res = await fetch(`${supabaseUrl}/rest/v1/jobhunta_users`, {
      method: 'POST',
      headers: supabaseHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify(userRecord),
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) {
      fail(400, 'An account with this email already exists.');
    }
    const created = await res.json();
    if (Array.isArray(created) && created[0]) {
      userRecord.id = created[0].id;
    }
  }
  store.users.push(userRecord);
  store.workspaces[userRecord.id] = createEmptyWorkspace(cleanName, String(senderService || '').trim());
  await saveStore(userRecord.id);
  return {
    id: userRecord.id,
    email: userRecord.email,
    name: userRecord.name,
    tier: userRecord.tier,
    usage: getUserQuotaStatus(userRecord)
  };
}

async function loadFromSupabase(userId = 'default') {
  if (!supabaseConfigured || !userId) return;
  const ws = getWorkspace(userId);
  try {
    const [wsRes, leadsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/jobhunta_workspace?id=eq.${encodeURIComponent(userId)}&select=*`, {
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(6000)
      }),
      fetch(`${supabaseUrl}/rest/v1/jobhunta_leads?user_id=eq.${encodeURIComponent(userId)}&select=*&order=updated_at.desc&limit=5000`, {
        headers: supabaseHeaders(),
        signal: AbortSignal.timeout(6000)
      })
    ]);
    if (!wsRes.ok || !leadsRes.ok) {
      supabaseStatus = {
        configured: true,
        connected: false,
        error: `Supabase returned HTTP ${!wsRes.ok ? wsRes.status : leadsRes.status}.`
      };
      return;
    }
    const wsRows = await wsRes.json();
    const leadRows = await leadsRes.json();
    if (Array.isArray(wsRows) && wsRows[0]) {
      const row = wsRows[0];
      const rawAuth = typeof row.auth?.sealed === 'string' ? unsealCookie(row.auth.sealed) : row.auth;
      if (rawAuth?.mailbox && rawAuth?.tokens) ws.auth = rawAuth;
      if (row.settings && typeof row.settings === 'object' && Object.keys(row.settings).length) {
        ws.settings = {
          senderName: String(row.settings.senderName || ''),
          senderService: String(row.settings.senderService || ''),
          savedSearches: normalizeSavedSearches(row.settings.savedSearches),
          defaultFollowUpDays: Number(row.settings.defaultFollowUpDays) || 4,
          templates: Array.isArray(row.settings.templates) && row.settings.templates.length
            ? row.settings.templates
            : defaultTemplates
        };
      }
      if (row.thread_owners && typeof row.thread_owners === 'object') {
        ws.threadOwners = { ...ws.threadOwners, ...row.thread_owners };
      }
    }
    if (Array.isArray(leadRows)) {
      ws.leads = leadRows.map(r => supabaseRowToLead(r, userId));
    }
    supabaseStatus = { configured: true, connected: true, error: null };
  } catch (error) {
    supabaseStatus = { configured: true, connected: false, error: error.message };
  }
}

async function syncToSupabase(userId, leadChanges) {
  const ws = getWorkspace(userId);
  try {
    const response = await fetch(supabaseUrl + '/rest/v1/rpc/jobhunta_save_workspace', {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        workspace: { id: userId, settings: ws.settings, auth: ws.auth ? { sealed: sealCookie(ws.auth) } : null,
          thread_owners: ws.threadOwners, updated_at: new Date().toISOString() },
        lead_rows: leadChanges ? ws.leads.map(lead => leadToSupabaseRow(lead, userId)) : [],
        removed_ids: (leadChanges || []).map(id => dbRowId(userId, id))
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Supabase returned HTTP ' + response.status + '.');
    supabaseStatus = { configured: true, connected: true, error: null };
  } catch (error) {
    supabaseStatus = { configured: true, connected: false, error: error.message };
    fail(503, 'Workspace could not be saved to Supabase. Try again.');
  }
}

let writeQueue = Promise.resolve();
function saveStore(userId = 'default', leadChanges = null) {
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    if (supabaseConfigured) await syncToSupabase(userId, leadChanges);
    if (!isServerless) {
      try {
        await writeFile(dataFilePath, JSON.stringify(store, null, 2), 'utf8');
      } catch (error) {
        if (!supabaseConfigured) fail(503, 'Workspace could not be saved to disk. Try again.');
        console.error('Local workspace backup failed:', error.code);
      }
    }
  });
  return writeQueue;
}

await loadFromSupabase('default');

const sessions = new Map();
const searches = new Map();
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/discovery.mjs': ['discovery.mjs', 'text/javascript; charset=utf-8'],
  '/csv.mjs': ['csv.mjs', 'text/javascript; charset=utf-8'],
  '/business-import.csv': ['business-import.csv', 'text/csv; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['logo.png', 'image/png'],
  '/logo.png': ['logo.png', 'image/png']
};
const nonce = () => randomBytes(32).toString('base64url');
const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const validEmail = value => typeof value === 'string' && value.length <= 254 && emailPattern.test(value);
const jsonHeaders = { 'Content-Type': 'application/json' };
const maxAge = 30 * 24 * 60 * 60 * 1000;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function getRequestOrigin(req) {
  if (req.headers.origin && /^https?:\/\//i.test(req.headers.origin)) {
    return req.headers.origin.replace(/\/$/, '');
  }
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`).split(',')[0].trim();
  const forwardedProto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function getRedirectUri(reqOrigin) {
  const envRedirect = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (envRedirect && (!isServerless || !envRedirect.includes('localhost'))) {
    return envRedirect;
  }
  return reqOrigin + '/oauth/callback';
}

async function provider(url, options, label) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(22000) });
  } catch {
    fail(502, `${label} could not be reached. Check the connection and try again.`);
  }
  if (!response.ok) {
    if (label === 'Gmail') {
      const expired = response.status === 401;
      throw Object.assign(new Error(expired ? 'Gmail authorization expired. Reconnect your mailbox.' :
        'Gmail returned HTTP ' + response.status + '.'), {
        status: expired ? 401 : 502,
        providerRejected: response.status >= 400 && response.status < 500
      });
    }
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
  const userId = session.userId || 'default';
  const ws = getWorkspace(userId);
  if (session.tokens.expires < Date.now() + 60000) {
    session.refresh ??= exchange({ grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token })
      .then(tokens => {
        session.tokens = { ...session.tokens, ...tokens, expires: Date.now() + tokens.expires_in * 1000 };
        if (ws.auth && ws.auth.mailbox === session.mailbox) {
          ws.auth.tokens = session.tokens;
          saveStore(userId).catch(console.error);
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
  const ws = getWorkspace(session.userId || 'default');
  const owner = session.threadOwners.get(id) || ws.threadOwners[id];
  if (owner && owner !== session.mailbox) fail(404, 'This conversation is unavailable in the connected mailbox.');
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
    const chargedOn = await consumeQuota(session.userId, 'email');
    let result;
    try {
      result = await gmail(session, 'messages/send', { raw, ...(threadId ? { threadId } : {}) });
    } catch (error) {
      // A transport failure has an unknown delivery outcome.
      if (error.providerRejected) await consumeQuota(session.userId, 'email', chargedOn).catch(console.error);
      throw error;
    }
    const userId = session.userId || 'default';
    const ws = getWorkspace(userId);
    session.threadOwners.set(result.threadId, session.mailbox);
    ws.threadOwners[result.threadId] = session.mailbox;
    saveStore(userId).catch(console.error);
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

export function parseBingMapsHtml(html = '', fallbackIndustry = '', city = '', startRank = 1, pageNumber = 1) {
  const results = [];
  const cardRegex = /data-entity="([^"]+)"([\s\S]*?)(?=data-entity="|$)/g;
  let itemOffset = 0;
  for (const match of html.matchAll(cardRegex)) {
    let parsed;
    try {
      parsed = JSON.parse(decodeHtmlEntities(match[1]));
    } catch {
      continue;
    }
    const entity = parsed?.entity;
    if (!entity?.id || !entity?.title) continue;
    const searchRank = startRank + itemOffset;
    itemOffset++;
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
      `Bing Rank #${searchRank} (Page ${pageNumber})`,
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
      searchRank,
      searchPage: pageNumber,
      facebook: '',
      instagram: '',
      twitter: ''
    });
  }
  return results;
}

export const stateSubCities = {
  'lagos': ['Ikeja', 'Lekki', 'Victoria Island', 'Ikoyi', 'Surulere', 'Yaba', 'Ajah', 'Maryland', 'Gbagada', 'Festac', 'Ikorodu', 'Apapa'],
  'lagos state': ['Ikeja', 'Lekki', 'Victoria Island', 'Ikoyi', 'Surulere', 'Yaba', 'Ajah', 'Maryland', 'Gbagada', 'Festac', 'Ikorodu', 'Apapa'],
  'abuja': ['Wuse', 'Maitama', 'Garki', 'Gwarinpa', 'Asokoro', 'Jabi', 'Utako', 'Kubwa', 'Lugbe'],
  'fct': ['Wuse', 'Maitama', 'Garki', 'Gwarinpa', 'Asokoro', 'Jabi', 'Utako', 'Kubwa', 'Lugbe'],
  'ogun': ['Abeokuta', 'Ota', 'Ijebu Ode', 'Sagamu', 'Mowe', 'Ilaro'],
  'ogun state': ['Abeokuta', 'Ota', 'Ijebu Ode', 'Sagamu', 'Mowe', 'Ilaro'],
  'oyo': ['Ibadan', 'Bodija', 'Ring Road Ibadan', 'Challenge Ibadan', 'Ogbomosho', 'Oyo'],
  'oyo state': ['Ibadan', 'Bodija', 'Ring Road Ibadan', 'Challenge Ibadan', 'Ogbomosho', 'Oyo'],
  'rivers': ['Port Harcourt', 'GRA Port Harcourt', 'Trans Amadi', 'Rumuola', 'Obio-Akpor', 'Bonny'],
  'rivers state': ['Port Harcourt', 'GRA Port Harcourt', 'Trans Amadi', 'Rumuola', 'Obio-Akpor', 'Bonny'],
  'kano': ['Kano Municipal', 'Nassarawa Kano', 'Fagge', 'Tarauni', 'Gwale'],
  'kano state': ['Kano Municipal', 'Nassarawa Kano', 'Fagge', 'Tarauni', 'Gwale'],
  'enugu': ['Enugu', 'Independence Layout Enugu', 'New Haven Enugu', 'Achara Layout', 'Nsukka'],
  'enugu state': ['Enugu', 'Independence Layout Enugu', 'New Haven Enugu', 'Achara Layout', 'Nsukka'],
  'delta': ['Asaba', 'Warri', 'Effurun', 'Sapele', 'Ughelli'],
  'delta state': ['Asaba', 'Warri', 'Effurun', 'Sapele', 'Ughelli'],
  'edo': ['Benin City', 'GRA Benin City', 'Ekpoma', 'Auchi', 'Uromi'],
  'edo state': ['Benin City', 'GRA Benin City', 'Ekpoma', 'Auchi', 'Uromi'],
  'california': ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Irvine', 'Oakland', 'Pasadena', 'Santa Monica', 'Beverly Hills'],
  'texas': ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'Plano', 'El Paso', 'Arlington', 'Frisco'],
  'florida': ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'St. Petersburg', 'West Palm Beach', 'Boca Raton'],
  'new york state': ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Buffalo', 'Rochester', 'Albany', 'White Plains'],
  'illinois': ['Chicago', 'Naperville', 'Aurora', 'Evanston', 'Schaumburg', 'Oak Brook', 'Springfield'],
  'georgia': ['Atlanta', 'Savannah', 'Augusta', 'Alpharetta', 'Marietta', 'Sandy Springs'],
  'pennsylvania': ['Philadelphia', 'Pittsburgh', 'Allentown', 'King of Prussia', 'Harrisburg'],
  'ohio': ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton'],
  'north carolina': ['Charlotte', 'Raleigh', 'Durham', 'Greensboro', 'Winston-Salem', 'Cary'],
  'new jersey': ['Newark', 'Jersey City', 'Hoboken', 'Princeton', 'Paramus', 'Cherry Hill'],
  'washington': ['Seattle', 'Bellevue', 'Tacoma', 'Spokane', 'Redmond', 'Kirkland'],
  'massachusetts': ['Boston', 'Cambridge', 'Somerville', 'Worcester', 'Waltham', 'Quincy'],
  'ontario': ['Toronto', 'Ottawa', 'Mississauga', 'Brampton', 'Hamilton', 'London Ontario', 'Markham'],
  'british columbia': ['Vancouver', 'Victoria', 'Burnaby', 'Surrey', 'Richmond', 'Kelowna'],
  'england': ['London', 'Manchester', 'Birmingham', 'Leeds', 'Liverpool', 'Bristol', 'Sheffield', 'Newcastle']
};

export async function resolveSearchLocations(rawLocation = '') {
  const cleaned = rawLocation.trim();
  if (!cleaned) return [];
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts.slice(0, 12);
  }
  const key = cleaned.toLowerCase();
  if (Object.hasOwn(stateSubCities, key)) {
    const parentName = cleaned.replace(/\s+state$/i, '');
    return stateSubCities[key].map(sub => `${sub}, ${parentName}`);
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'Jobhunta/1.1 (local business discovery)' },
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const data = await res.json();
      const top = data?.[0];
      if (top && ['state', 'province', 'region', 'county'].includes(top.addresstype)) {
        const apiKey = process.env.GEMINI_API_KEY?.trim();
        if (apiKey) {
          try {
            const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
              method: 'POST',
              headers: jsonHeaders,
              body: JSON.stringify({
                contents: [{ parts: [{ text: `Return a JSON array of strings listing the 8 largest commercial cities or districts inside "${cleaned}". Only return the JSON array.` }] }],
                generationConfig: { responseMimeType: 'application/json' }
              }),
              signal: AbortSignal.timeout(5000)
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const parsed = JSON.parse(aiData.candidates?.[0]?.content?.parts?.[0]?.text || '[]');
              if (Array.isArray(parsed) && parsed.length >= 2) {
                return parsed.slice(0, 10).map(city => `${String(city).trim()}, ${cleaned}`);
              }
            }
          } catch {
            // Fallback below
          }
        }
        return [
          `Central ${cleaned}`,
          `North ${cleaned}`,
          `South ${cleaned}`,
          `East ${cleaned}`,
          `West ${cleaned}`
        ];
      }
    }
  } catch {
    // Treat as a single city if lookup times out
  }
  return [cleaned];
}

function getSearchOffsets(rankMode = 'all', isMultiCity = false) {
  if (isMultiCity) {
    return rankMode === 'low' || rankMode === 'shopify'
      ? [{ first: 21, page: 3 }, { first: 41, page: 4 }]
      : [{ first: 1, page: 1 }, { first: 11, page: 2 }];
  }
  if (rankMode === 'low') {
    return [
      { first: 21, page: 3 },
      { first: 41, page: 4 },
      { first: 61, page: 5 },
      { first: 81, page: 6 },
      { first: 101, page: 7 },
      { first: 121, page: 8 }
    ];
  }
  return [
    { first: 1, page: 1 },
    { first: 11, page: 2 },
    { first: 21, page: 3 },
    { first: 31, page: 4 },
    { first: 41, page: 5 },
    { first: 51, page: 6 },
    { first: 61, page: 7 },
    { first: 71, page: 8 }
  ];
}

async function searchBingMaps(cleanIndustry, city, rankMode = 'all') {
  const query = rankMode === 'shopify'
    ? `${cleanIndustry} shop store in ${city}`
    : `${cleanIndustry} in ${city}`;
  const seen = new Map();
  const offsetConfigs = getSearchOffsets(rankMode === 'shopify' ? 'low' : rankMode);
  const pages = await Promise.allSettled(offsetConfigs.map(async ({ first, page }) => {
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
    return parseBingMapsHtml(html, cleanIndustry, city, first, page);
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

async function streamSearch(res, industry, city, rankMode = 'all', reserveResults, onFailure) {
  const cleanIndustry = (industry || '').trim();
  if (!/^[\p{L}\p{M}\p{N} .,'’&/()-]{2,50}$/u.test(cleanIndustry) ||
      !/^[\p{L}\p{M}\p{N} .,'’()-]{2,75}$/u.test(city)) {
    fail(400, 'Choose or enter an industry and enter a city or state.');
  }
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  let closed = false;
  res.on('close', () => { closed = true; });
  const sendEvent = payload => {
    if (!closed && !res.writableEnded) {
      res.write(JSON.stringify(payload) + '\n');
    }
  };

  const subLocations = await resolveSearchLocations(city);
  const isStateBreakdown = subLocations.length > 1;
  const offsetConfigs = getSearchOffsets(rankMode === 'shopify' ? 'low' : rankMode, isStateBreakdown);
  const seen = new Set();
  let stopped = false;
  const emitBusinesses = async items => {
    const fresh = [...new Map(items.filter(item => !seen.has(item.id)).map(item => [item.id, item])).values()];
    if (closed || !fresh.length) return 0;
    let granted;
    try {
      granted = await reserveResults(fresh.length);
    } catch (error) {
      stopped = true;
      sendEvent({ type: 'error', error: error.message || 'Usage is temporarily unavailable.' });
      return 0;
    }
    for (const item of fresh.slice(0, granted)) {
      seen.add(item.id);
      sendEvent({ type: 'business', item, totalFound: seen.size });
    }
    if (granted < fresh.length) {
      stopped = true;
      sendEvent({ type: 'limit', message: 'Daily search result limit reached. Your allowance resets at midnight UTC.' });
    }
    return granted;
  };


  if (isStateBreakdown) {
    sendEvent({
      type: 'status',
      totalFound: 0,
      message: `Breaking "${city}" into ${subLocations.length} cities/districts (${subLocations.slice(0, 4).map(s => s.split(',')[0]).join(', ')}…) to scrape bit-by-bit…`
    });
  }

  for (let locIndex = 0; locIndex < subLocations.length; locIndex++) {
    if (closed || stopped) break;
    const subCity = subLocations[locIndex];
    const queries = rankMode === 'shopify'
      ? [`${cleanIndustry} store in ${subCity}`, `${cleanIndustry} boutique shop in ${subCity}`]
      : [`${cleanIndustry} in ${subCity}`];

    let emptyStreak = 0;
    for (const query of queries) {
      for (let idx = 0; idx < offsetConfigs.length; idx++) {
        if (closed || stopped) break;
        const { first, page } = offsetConfigs[idx];
        sendEvent({
          type: 'status',
          page,
          totalPages: offsetConfigs.length,
          totalFound: seen.size,
          message: isStateBreakdown
            ? `Scraping ${city} bit-by-bit [${locIndex + 1}/${subLocations.length}: ${subCity} · Page ${page}]…`
            : (rankMode === 'low' || rankMode === 'shopify'
                ? `Scraping low-ranked Bing results in ${subCity} (Page ${page}, Rank #${first}+)…`
                : `Scraping Bing Maps in ${subCity} (Page ${page}, Rank #${first}+)…`)
        });
        try {
          const url = `https://www.bing.com/maps/overlaybfpr?q=${encodeURIComponent(query)}&count=20&first=${first}`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: AbortSignal.timeout(10000)
          });
          if (!response.ok) break;
          const html = await response.text();
          const items = parseBingMapsHtml(html, cleanIndustry, subCity, first, page);
          const addedOnPage = await emitBusinesses(items);
          if (stopped) break;
          if (addedOnPage === 0) {
            emptyStreak++;
            if (emptyStreak >= 2) break;
          } else {
            emptyStreak = 0;
          }
        } catch {
          break;
        }
      }
    }
  }

  if (seen.size === 0 && !closed && !stopped) {
    sendEvent({ type: 'status', message: 'Checking OpenStreetMap fallback…', totalFound: 0 });
    try {
      const fallbackItems = await searchOverpassFallback(cleanIndustry, city);
      await emitBusinesses(fallbackItems);
    } catch (error) {
      await onFailure?.();
      sendEvent({ type: 'error', error: error.message || 'Search unavailable.' });
    }
  }

  sendEvent({ type: 'done', totalFound: seen.size });
  if (!res.writableEnded) res.end();
}

function discoveryOptions(values) {
  return {
    mode: values.mode === 'online' ? 'online' : 'local',
    locations: String(values.locations || '').slice(0, 500),
    terms: String(values.terms || '').slice(0, 350),
    platform: Object.hasOwn(platformDomains, values.platform) ? values.platform : '',
    sources: ['combined', 'google', 'maps', 'places'].includes(values.sources) ? values.sources : 'combined',
    queries: String(values.queries || '').slice(0, 3000),
    urls: String(values.urls || '').slice(0, 3000)
  };
}

async function googleDiscovery(query, term, city) {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Google web search returned HTTP ' + response.status + '.');
  const data = await response.json();
  return (data.organic || []).flatMap(result => {
    const url = publicWebsite(result.link);
    if (!url) return [];
    const identity = websiteIdentity(url);
    return [{
      id: 'web:' + identity,
      name: result.title || url.hostname, website: identity.includes('/') ? url.href : url.origin, source: url.href,
      industry: term, city, discoveryQuery: query, discoveryProvider: 'Google web'
    }];
  });
}

async function googlePlacesReferences(term, city) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id', 'Content-Type': 'application/json'
    },
    body: JSON.stringify({ textQuery: term + ' in ' + city, pageSize: 10 }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Google Places returned HTTP ' + response.status + '.');
  const data = await response.json();
  return (data.places || []).filter(place => typeof place.id === 'string').map(place => ({
    id: place.id,
    url: 'https://www.google.com/maps/search/?' + new URLSearchParams({
      api: '1', query: term + ' in ' + city, query_place_id: place.id
    })
  }));
}

async function streamDiscovery(res, params, userId) {
  const options = discoveryOptions(Object.fromEntries(params));
  const online = options.mode === 'online';
  const industry = (params.get('industry') || '').trim();
  const city = (params.get('city') || '').trim();
  const terms = [...new Set([industry, ...searchList(options.terms, 3)])];
  const cities = [...new Set([city, ...searchList(options.locations, 4)].filter(Boolean))];
  if (!cities.length && online) cities.push('');
  if (!cities.length) fail(400, 'Enter a city or state for local discovery.');
  for (const term of terms) for (const location of cities) validateSearch(term, location || 'Online');
  const urls = searchList(options.urls, 20).map(publicWebsite);
  if (urls.some(url => !url)) fail(400, 'Enter full HTTP or HTTPS website URLs.');
  const web = options.sources === 'google' || options.sources === 'combined';
  const maps = !online && ['maps', 'combined'].includes(options.sources);
  const places = !online && ['places', 'combined'].includes(options.sources);
  if (options.sources === 'places' && (!places || !process.env.GOOGLE_PLACES_API_KEY)) {
    fail(503, 'Google Places requires a local search and GOOGLE_PLACES_API_KEY.');
  }
  if (!(maps || urls.length || (web && process.env.SERPER_API_KEY) || (places && process.env.GOOGLE_PLACES_API_KEY))) {
    fail(503, 'Choose a configured source, open the query links in Google, or paste website URLs.');
  }
  const chargedOn = await consumeQuota(userId, 'search');
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform' });
  let stopped = false;
  let delivered = 0;
  let successful = false;
  const seen = new Set();
  const placeIds = new Set();
  const mapDomains = new Set();
  res.on('close', () => { stopped = true; });
  const send = event => {
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  const emit = async (items, query) => {
    const fresh = [];
    const batch = new Set();
    for (const item of items) {
      const domain = publicWebsite(item.website)?.hostname.replace(/^www[.]/, '');
      if (item.discoveryProvider === 'Google web' && domain && mapDomains.has(domain)) continue;
      const keys = businessKeys(item, online || item.discoveryProvider === 'Google web' || item.discoveryProvider === 'Imported URL');
      if (keys.some(key => seen.has(key) || batch.has(key))) continue;
      for (const key of keys) batch.add(key);
      fresh.push({ item, keys });
    }
    if (stopped) return;
    const granted = fresh.length ? await consumeQuota(userId, 'result', null, fresh.length) : 0;
    for (const { item, keys } of fresh.slice(0, granted)) {
      keys.forEach(key => seen.add(key));
      const domain = publicWebsite(item.website)?.hostname.replace(/^www[.]/, '');
      if (domain && ['Bing Maps', 'OpenStreetMap'].includes(item.discoveryProvider)) mapDomains.add(domain);
      delivered++;
      send({ type: 'business', item: { ...item, targetPlatform: options.platform, discoveryQuery: query }, totalFound: delivered });
    }
    send({ type: 'query', message: query + ' · ' + granted + ' new businesses' });
    if (granted < fresh.length) {
      stopped = true;
      send({ type: 'limit', message: 'Daily search result limit reached.' });
    }
  };
  const run = async (label, fetchItems) => {
    if (stopped) return;
    send({ type: 'status', message: 'Searching ' + label });
    let items;
    try {
      items = await fetchItems();
      successful = true;
    } catch (error) {
      send({ type: 'query', message: label + ' · ' + error.message });
      return;
    }
    await emit(items, label);
  };
  try {
    if (web && !process.env.SERPER_API_KEY) {
      send({ type: 'query', message: 'Google web automation is unconfigured. Use the Google query links or paste website URLs.' });
    }
    if (urls.length) await run('Imported websites', async () => urls.map(url => ({
      id: 'web:' + websiteIdentity(url), name: url.hostname, website: url.href,
      source: url.href, industry, city, discoveryProvider: 'Imported URL'
    })));
    const pairs = terms.flatMap(term => cities.map(location => ({ term, location }))).slice(0, 12);
    if (terms.length * cities.length > pairs.length) {
      send({ type: 'query', message: 'This batch uses the first 12 term and location combinations.' });
    }
    const mapCities = new Map();
    if (maps) {
      for (const area of cities) {
        if (stopped) break;
        try { mapCities.set(area, await resolveSearchLocations(area)); }
        catch { mapCities.set(area, [area]); }
      }
    }
    const mapPairs = maps ? pairs.flatMap(({ term, location }) =>
      (mapCities.get(location) || [location]).map(area => ({ term, location: area }))).slice(0, 12) : pairs;
    for (const { term, location } of mapPairs) {
      if (stopped) break;
      if (maps) {
        await run('Bing Maps · ' + term + ' · ' + location, async () =>
          (await searchBingMaps(term, location, params.get('rankMode') || 'all')).map(item => ({ ...item, discoveryProvider: 'Bing Maps' })));
        await run('OpenStreetMap · ' + term + ' · ' + location, async () =>
          (await searchOverpassFallback(term, location)).map(item => ({ ...item, discoveryProvider: 'OpenStreetMap' })));
      }
      if (!stopped && places && process.env.GOOGLE_PLACES_API_KEY) {
        try {
          const references = await googlePlacesReferences(term, location);
          successful = true;
          for (const reference of references) {
            if (placeIds.has(reference.id)) continue;
            placeIds.add(reference.id);
            send({ type: 'place', url: reference.url, label: term + ' · ' + location });
          }
        } catch (error) { send({ type: 'query', message: error.message }); }
      }
    }
    if (web && process.env.SERPER_API_KEY) {
      const custom = options.queries.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
      const queries = custom.length ? custom.map(query => ({ query, term: industry, location: city })) :
        pairs.flatMap(({ term, location }) => googleQueries(term, location, options.platform, online)
          .map(query => ({ query, term, location }))).slice(0, 12);
      for (const { query, term, location } of queries) {
        if (stopped) break;
        await run('Google · ' + query, () => googleDiscovery(query, term, location));
      }
    }
    if (!successful) {
      await consumeQuota(userId, 'search', chargedOn).catch(console.error);
      send({ type: 'error', error: 'No discovery source completed. Check the source activity for details.' });
    }
  } catch (error) {
    send({ type: 'error', error: error.message || 'Discovery could not finish.' });
  } finally {
    send({ type: 'done', totalFound: delivered });
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

function normalizeSavedSearches(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item.id === 'string' &&
    typeof item.industry === 'string' && typeof item.city === 'string' &&
    item.industry.trim() && (item.mode === 'online' || item.city.trim() || String(item.locations || '').trim())).slice(0, 25).map(item => ({
    id: item.id.slice(0, 64),
    industry: item.industry.trim().slice(0, 50),
    city: item.city.trim().slice(0, 75),
    ...discoveryOptions(item),
    rankMode: ['low', 'shopify'].includes(item.rankMode) ? item.rankMode : 'all'
  }));
}

function validateSearch(industry, city) {
  const cleanIndustry = (industry || '').trim();
  if (!/^[\p{L}\p{M}\p{N} .,'’&/()-]{2,50}$/u.test(cleanIndustry) ||
      !/^[\p{L}\p{M}\p{N} .,'’()-]{2,75}$/u.test(city)) {
    fail(400, 'Choose or enter an industry and enter a city.');
  }
  return cleanIndustry;
}

async function search(industry, city) {
  const cleanIndustry = validateSearch(industry, city);
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
  const socials = { facebook: '', instagram: '', twitter: '', linkedin: '', youtube: '', tiktok: '' };
  const urlRegex = /https?:\/\/(?:www\.)?(facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com)\/[^\s"'<>)]+/gi;
  for (const match of html.matchAll(urlRegex)) {
    const raw = decodeHtmlEntities(match[0]).replace(/[.,;:'")\]}>]+$/, '');
    const host = match[1].toLowerCase();
    if (/\/(tr\?|sharer|share|plugins|dialog|intent\/|watch\?)/i.test(raw)) continue;
    if (host === 'facebook.com' && !socials.facebook) socials.facebook = raw;
    else if (host === 'instagram.com' && !socials.instagram) socials.instagram = raw;
    else if ((host === 'twitter.com' || host === 'x.com') && !socials.twitter) socials.twitter = raw;
    else if (host === 'linkedin.com' && !socials.linkedin) socials.linkedin = raw;
    else if (host === 'youtube.com' && !socials.youtube) socials.youtube = raw;
    else if (host === 'tiktok.com' && !socials.tiktok) socials.tiktok = raw;
  }
  return socials;
}

export function detectPlatformAndTech(html = '', siteUrl = '') {
  const hostname = publicWebsite(siteUrl)?.hostname || '';
  const fingerprints = [
    ['Shopify', /cdn[.]shopify[.]com|Shopify[.](shop|theme)/i, /myshopify[.]com/i],
    ['WooCommerce', /wp-content[/]plugins[/]woocommerce|wc-blocks|wc-ajax/i, /woocommerce/i],
    ['Wix', /static[.]wixstatic[.]com|wix-thunderbolt/i, /wixstatic[.]com|wix[.]com/i],
    ['Beehiiv', /beehiiv[.]com[/](?:assets|static)[/]|beehiiv[.]cdn/i, /beehiiv[.]com/i],
    ['Substack', /<meta[^>]*content=["']Substack["'][^>]*>/i, /substackcdn[.]com/i],
    ['Kit'],
    ['Mailchimp'],
    ['MailerLite'],
    ['Buttondown'],
    ['BigCommerce', /cdn[0-9]*[.]bigcommerce[.]com|stencil-utils/i, /bigcommerce[.]com/i],
    ['Squarespace', /static[0-9]*[.]squarespace[.]com|squarespace-cdn[.]com/i, /squarespace[.]com|sqsp[.]net/i],
    ['Webflow', /data-wf-site|website-files[.]com/i, /webflow[.]com/i],
    ['Ghost', /name=["']generator["'][^>]+content=["']Ghost|ghost[.]io[/]assets/i, /ghost[.]io/i],
    ['HubSpot CMS', /hs_cos_wrapper|hs-content-id-/i, /hubspotpagebuilder[.]com/i],
    ['WordPress', /wp-content|wp-includes/i, /wordpress[.]com/i]
  ];
  let platform = 'Custom / Website';
  let platformEvidence = '';
  let platformConfidence = 'Unknown';
  for (const [label, strong, weak] of fingerprints) {
    const domain = platformDomains[label];
    const hosted = domain && (hostname === domain || hostname.endsWith('.' + domain)) ||
      label === 'Kit' && (hostname === 'ck.page' || hostname.endsWith('.ck.page'));
    const signal = strong && html.match(strong)?.[0];
    if (!hosted && !signal) continue;
    platform = label;
    platformEvidence = hosted ? 'Hosted domain: ' + hostname : 'Page fingerprint: ' + signal;
    platformConfidence = 'Confirmed';
    break;
  }
  if (platformConfidence === 'Unknown') {
    for (const [label, , weak] of fingerprints) {
      const signal = weak && html.match(weak)?.[0];
      if (!signal) continue;
      platform = label;
      platformEvidence = 'Page reference: ' + signal;
      platformConfidence = 'Likely';
      break;
    }
  }

  const techStack = [];
  const checks = [
    ['HubSpot Marketing', /js[.]hs-scripts[.]com|hsforms[.]net/i],
    ['Kit', /f[.]convertkit[.]com|app[.]kit[.]com[/]forms|convertkit[.]com[/]assets/i],
    ['Mailchimp', /list-manage[.]com|chimpstatic[.]com|mailchimp[.]com[/]embedcode/i],
    ['MailerLite', /assets[.]mailerlite[.]com|mlcdn[.]com|mlsend[.]com[/]forms/i],
    ['Buttondown', /buttondown[.](?:com|email)[/]api[/]emails[/]embed-subscribe/i],
    ['Klaviyo', /klaviyo[.]com|klaviyo[.]js/i],
    ['Omnisend', /omnisend[.]com|omnisnippet/i],
    ['Brevo', /sibforms[.]com|sibautomation[.]com/i],
    ['ActiveCampaign', /activehosted[.]com|trackcmp[.]net/i],
    ['Judge.me Reviews', /judge\.me/i],
    ['Loox Reviews', /loox\.io/i],
    ['Yotpo Reviews', /yotpo/i],
    ['Trustpilot', /trustpilot/i],
    ['Gorgias Chat', /gorgias/i],
    ['Tidio Chat', /tidio/i],
    ['Shopify Inbox', /shopify-chat|shopifyinbox/i],
    ['WhatsApp Widget', /wa\.me|whatsapp\.com/i],
    ['Meta Pixel', /fbevents\.js|fbq\(/i],
    ['TikTok Pixel', /analytics\.tiktok\.com|ttq\./i],
    ['Google Tag / Analytics', /googletagmanager|gtag\(|google-analytics/i],
    ['Shop Pay', /shop-pay|shopify-payment-button/i],
    ['Klarna / Afterpay', /klarna|afterpay/i]
  ];
  for (const [label, regex] of checks) {
    if (regex.test(html)) techStack.push(label);
  }

  const myshopifyMatch = html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/i);
  const themeMatch = html.match(/Shopify\.theme\s*=\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
  const currencyMatch = html.match(/Shopify\.currency\s*=\s*\{[^}]*?"active"\s*:\s*"([^"]+)"/i);

  return {
    platform,
    platformEvidence,
    platformConfidence,
    techStack,
    shopifyMeta: platform === 'Shopify' ? {
      myshopifyDomain: myshopifyMatch?.[1] || '',
      themeName: themeMatch?.[1] || '',
      currency: currencyMatch?.[1] || ''
    } : null
  };
}

export function extractWebsiteInsights(html = '', urlStr = '') {
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const siteTitle = decodeHtmlEntities((titleMatch?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 180);

  const ogSiteNameMatch =
    html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const brandName = decodeHtmlEntities((ogSiteNameMatch?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 100);

  const metaDescMatch =
    cleanHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    cleanHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
    cleanHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const metaDescription = decodeHtmlEntities((metaDescMatch?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 400);

  const headings = [];
  for (const match of cleanHtml.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)) {
    const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text.length >= 4 && text.length <= 120 && !headings.includes(text)) {
      headings.push(text);
      if (headings.length >= 6) break;
    }
  }

  const paragraphs = [];
  for (const match of cleanHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text.length >= 45 && text.length <= 420 && !/(cookie|privacy policy|all rights reserved|copyright|terms of use)/i.test(text)) {
      if (!paragraphs.includes(text)) paragraphs.push(text);
      if (paragraphs.length >= 4) break;
    }
  }

  const aboutSummary = [metaDescription, ...paragraphs]
    .filter(Boolean)
    .filter((val, idx, arr) => arr.indexOf(val) === idx)
    .join('\n\n')
    .slice(0, 1500);

  const { platform, techStack, shopifyMeta, platformEvidence, platformConfidence } = detectPlatformAndTech(html, urlStr);

  const signals = {
    https: urlStr.startsWith('https://'),
    hasMetaDescription: Boolean(metaDescription),
    hasBookingOrForm: /(book online|schedule appointment|book now|appointment|calendly|contact-form|<form\b|newsletter|klaviyo|mailchimp)/i.test(html),
    hasChatWidget: /(tawk\.to|intercom|crisp\.chat|drift|livechat|whatsapp\.com|wa\.me|tidio|zendesk|gorgias|shopify-chat)/i.test(html),
    hasAnalytics: /(googletagmanager|gtag\(|google-analytics|fbq\(|fbevents\.js|analytics\.tiktok\.com)/i.test(html),
    hasReviewsApp: /(judge\.me|loox\.io|yotpo|trustpilot|stamped\.io)/i.test(html)
  };

  return {
    siteTitle,
    brandName,
    metaDescription,
    headings,
    aboutSummary,
    platform,
    platformEvidence,
    platformConfidence,
    techStack,
    shopifyMeta,
    signals
  };
}

async function fetchShopifyProducts(originUrl) {
  try {
    const res = await fetch(new URL('/products.json?limit=6', originUrl).href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Jobhunta/1.1)', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
      redirect: 'manual'
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.products)) return [];
    return data.products.slice(0, 6).map(p => ({
      title: String(p.title || '').slice(0, 100),
      type: String(p.product_type || '').slice(0, 60),
      vendor: String(p.vendor || '').slice(0, 60),
      price: String(p.variants?.[0]?.price || '')
    })).filter(p => p.title);
  } catch {
    return [];
  }
}

async function fetchWebsiteEmails(websiteUrl) {
  const base = await assertSafePublicUrl(websiteUrl);
  const fetchHtml = async targetUrl => {
    let target = await assertSafePublicUrl(String(targetUrl));
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml'
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000)
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const next = response.headers.get('location');
      if (!next || redirects === 3) return '';
      target = await assertSafePublicUrl(new URL(next, target).href);
    }
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
  const emailSources = Object.fromEntries([...emails].map(email => [email, base.href]));
  let contactPage = '';
  let contactFormSource = '';
  let phone = '';
  let phoneSource = '';
  function collectContactDetails(html, source) {
    if (!phone) {
      const phoneLink = html.match(/href\s*=\s*["']tel:([+\d().\s-]{7,35})["']/i)?.[1]?.trim();
      if (phoneLink && phoneLink.replace(/\D/g, '').length >= 7) {
        phone = phoneLink;
        phoneSource = source;
      }
    }
    if (!contactFormSource && /<form\b/i.test(html) && /contact|message|enquiry|inquiry/i.test(html)) {
      contactFormSource = source;
    }
  }
  collectContactDetails(homepageHtml, base.href);
  const socials = extractSocialsFromHtml(homepageHtml);
  const insights = extractWebsiteInsights(homepageHtml, base.href);

  let shopifyProducts = [];
  if (insights.platform === 'Shopify' || base.hostname.endsWith('.myshopify.com')) {
    insights.platform = 'Shopify';
    shopifyProducts = await fetchShopifyProducts(base.origin);
  }

  if (homepageHtml) {
    const subLinks = [...homepageHtml.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
      .map(match => match[1])
      .filter(href => /(contact|about|services|our-story|who-we-are|impressum|get-in-touch|reach-us|pages\/contact|pages\/about)/i.test(href));
    const uniqueSubUrls = [];
    for (const href of subLinks) {
      try {
        const subUrl = new URL(href, base.href);
        if (subUrl.hostname === base.hostname && subUrl.href !== base.href &&
            ['http:', 'https:'].includes(subUrl.protocol) && !uniqueSubUrls.includes(subUrl.href)) {
          uniqueSubUrls.push(subUrl.href);
          if (uniqueSubUrls.length >= 2) break;
        }
      } catch {
        // Ignore invalid sublink
      }
    }
    for (const subHref of uniqueSubUrls) {
      try {
        const subHtml = await fetchHtml(subHref);
        collectContactDetails(subHtml, subHref);
        if (subHtml && /contact|get-in-touch|reach-us|impressum/i.test(subHref)) contactPage ||= subHref;
        for (const email of extractEmailsFromHtml(subHtml)) {
          emails.add(email);
          emailSources[email] ||= subHref;
        }
        const subSocials = extractSocialsFromHtml(subHtml);
        for (const key of Object.keys(socials)) {
          if (!socials[key] && subSocials[key]) socials[key] = subSocials[key];
        }
        const subInsights = extractWebsiteInsights(subHtml, subHref);
        if (!insights.aboutSummary && subInsights.aboutSummary) {
          insights.aboutSummary = subInsights.aboutSummary;
        } else if (subInsights.aboutSummary && insights.aboutSummary.length < 500 && !insights.aboutSummary.includes(subInsights.aboutSummary)) {
          insights.aboutSummary = (insights.aboutSummary + '\n\n' + subInsights.aboutSummary).slice(0, 1500);
        }
        for (const h of subInsights.headings) {
          if (insights.headings.length < 8 && !insights.headings.includes(h)) insights.headings.push(h);
        }
        for (const appName of subInsights.techStack || []) {
          if (!insights.techStack.includes(appName)) insights.techStack.push(appName);
        }
        insights.signals.hasBookingOrForm ||= subInsights.signals.hasBookingOrForm;
        insights.signals.hasChatWidget ||= subInsights.signals.hasChatWidget;
        insights.signals.hasReviewsApp ||= subInsights.signals.hasReviewsApp;
      } catch {
        // Ignore subpage fetch failure
      }
    }
  }
  return {
    website: base.href,
    brandName: insights.brandName || insights.siteTitle?.split(/[|\-–—]/)[0]?.trim() || base.hostname.replace(/^www\./, ''),
    emails: [...emails],
    emailSources,
    contactPage,
    contactFormSource,
    phone,
    phoneSource,
    email: [...emails][0] || '',
    socials,
    facebook: socials.facebook,
    instagram: socials.instagram,
    twitter: socials.twitter,
    linkedin: socials.linkedin,
    youtube: socials.youtube,
    tiktok: socials.tiktok,
    siteTitle: insights.siteTitle,
    metaDescription: insights.metaDescription,
    headings: insights.headings,
    aboutSummary: insights.aboutSummary,
    platform: insights.platform,
    platformEvidence: insights.platformEvidence,
    platformConfidence: insights.platformConfidence,
    techStack: insights.techStack,
    shopifyMeta: insights.shopifyMeta,
    shopifyProducts,
    signals: insights.signals
  };
}

export function buildLeadIntelligence(lead = {}, senderSettings = {}) {
  const name = lead.name || 'this business';
  const industry = lead.industry || 'local business';
  const city = lead.city || 'their area';
  const senderName = senderSettings.senderName || '[your name]';
  const senderService = senderSettings.senderService || 'digital growth, lead capture, and client acquisition';

  const socialChannels = [
    lead.facebook && 'Facebook',
    lead.instagram && 'Instagram',
    lead.twitter && 'X/Twitter',
    lead.linkedin && 'LinkedIn',
    lead.youtube && 'YouTube',
    lead.tiktok && 'TikTok'
  ].filter(Boolean);

  const missingSocials = ['Instagram', 'Facebook', 'LinkedIn'].filter(ch => !socialChannels.includes(ch));
  const ratingNum = parseFloat(lead.rating);
  const signals = lead.signals || {};

  const overviewParts = [
    `${name} operates as a ${industry} in ${city}${lead.address ? ` (${lead.address})` : ''}.`
  ];
  if (lead.searchRank) {
    overviewParts.push(`Current Bing Search Position: Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}).`);
  }
  if (lead.platform && lead.platform !== 'Custom / Website') {
    overviewParts.push(`Website platform: ${lead.platform}${lead.shopifyMeta?.themeName ? ` (Theme: ${lead.shopifyMeta.themeName})` : ''}.`);
  }
  if (Array.isArray(lead.shopifyProducts) && lead.shopifyProducts.length) {
    overviewParts.push(`Catalog sample: ${lead.shopifyProducts.slice(0, 3).map(p => `${p.title}${p.price ? ` ($${p.price})` : ''}`).join(', ')}.`);
  }
  if (Array.isArray(lead.techStack) && lead.techStack.length) {
    overviewParts.push(`Detected tech stack: ${lead.techStack.join(', ')}.`);
  }
  if (lead.siteTitle || lead.metaDescription) {
    overviewParts.push(`Website positioning: "${lead.siteTitle || lead.metaDescription}".`);
  }
  if (lead.rating) {
    overviewParts.push(`Listed rating: ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}.`);
  }
  if (lead.openHours) {
    overviewParts.push(`Operating hours: ${lead.openHours}.`);
  }

  const gaps = [];
  if (lead.searchRank && lead.searchRank > 10) {
    gaps.push(`Buried at Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}) in Bing search for "${industry} in ${city}" — losing high-intent buyers to Page 1 competitors.`);
  }
  if (!lead.website) {
    gaps.push('No official website linked on their map listing — high-intent customers searching online have no dedicated landing page to convert.');
  } else {
    if (signals.https === false) {
      gaps.push('Website is not using HTTPS security, which triggers browser warnings and hurts local search trust.');
    }
    if (signals.hasMetaDescription === false) {
      gaps.push('Missing SEO meta description on their website, reducing click-through rates from Google and Bing local search.');
    }
    if (lead.platform === 'Shopify' || lead.platform === 'WooCommerce') {
      if (!signals.hasReviewsApp) {
        gaps.push(`Running on ${lead.platform} without a dedicated product review widget (Judge.me, Loox, or Yotpo) to boost product page conversion.`);
      }
      if (!(lead.techStack || []).some(t => /Klaviyo|Omnisend|Mailchimp/i.test(t))) {
        gaps.push(`No automated e-commerce email retention stack (Klaviyo / Omnisend) detected for abandoned cart and repeat buyer flows.`);
      }
    }
    if (signals.hasBookingOrForm === false) {
      gaps.push('No clear online booking / instant lead capture form detected — visitors must call manually during open hours.');
    }
    if (signals.hasChatWidget === false) {
      gaps.push('No live chat or WhatsApp quick-response widget on site to capture after-hours inquiries.');
    }
    if (signals.hasAnalytics === false) {
      gaps.push('No conversion tracking / ad pixel detected (Google Tag, Meta Pixel, or TikTok Pixel), meaning missed retargeting opportunities.');
    }
  }
  if (!lead.email) {
    gaps.push('No public business email is easily accessible for direct customer or B2B inquiries.');
  }
  if (socialChannels.length === 0) {
    gaps.push('No social media profiles (Instagram, Facebook, LinkedIn) are linked from their website.');
  } else if (missingSocials.length) {
    gaps.push(`Active on ${socialChannels.join(', ')}, but missing linked presence on ${missingSocials.join(' & ')}.`);
  }
  if (!lead.rating || (!Number.isNaN(ratingNum) && ratingNum < 4.2)) {
    gaps.push('Local map rating / review volume has room for growth to stand out against top-ranked local competitors.');
  }
  if (!gaps.length) {
    gaps.push(`Strong baseline presence; primary opportunity is scaling inbound client flow and automating follow-ups via ${senderService}.`);
  }

  const primaryGap = !lead.website
    ? 'building a high-converting web presence and local search capture'
    : signals.hasBookingOrForm === false
      ? 'turning website visitors into booked appointments automatically'
      : socialChannels.length === 0
        ? 'connecting their website with active social proof and local lead capture'
        : `strengthening their local visibility and conversion flow in ${city}`;

  const angle = `Lead with a compliment on their ${industry.toLowerCase()} presence in ${city}${lead.rating ? ` (★ ${lead.rating})` : ''}, then highlight a concrete quick win around ${primaryGap} using ${senderService}.`;

  const specificHook = !lead.website
    ? `I noticed ${name} on Bing Maps in ${city}, but saw there wasn’t a website linked for customers looking to book online`
    : lead.headings?.length
      ? `I was looking through ${name}’s website (${lead.headings[0]}) in ${city}`
      : `I came across ${name} while researching ${industry.toLowerCase()} businesses in ${city}`;

  const pitchSubject = `Quick idea for ${name} in ${city}`;
  const pitchBody =
    `Hi ${name} team,\n\n` +
    `${specificHook}.\n\n` +
    `I’m ${senderName}, and I help ${industry.toLowerCase()} businesses with ${senderService}. ` +
    `While reviewing your online presence, I spotted a quick opportunity around ${primaryGap} (${gaps[0].charAt(0).toLowerCase() + gaps[0].slice(1)})\n\n` +
    `Would you be open to a short 5-minute chat this week so I can share a few practical ideas tailored for ${name}?\n\n` +
    `Best regards,\n${senderName}`;

  return {
    overview: overviewParts.join(' '),
    gaps,
    angle,
    pitchSubject,
    pitchBody,
    generatedAt: new Date().toISOString()
  };
}

async function analyzeLeadWithAi(lead, senderSettings) {
  const baseline = buildLeadIntelligence(lead, senderSettings);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return baseline;

  try {
    const prompt = `You are a B2B lead intelligence analyst. Analyze this local business and return a JSON object with keys: "overview" (string), "gaps" (array of 3-5 specific actionable strings about what they are missing online/in marketing), "angle" (string strategy for pitching them), "pitchSubject" (string under 80 chars), "pitchBody" (string personalized cold outreach email with no unreplaced brackets).\n\nBusiness data:\n${JSON.stringify({
      name: lead.name,
      industry: lead.industry,
      city: lead.city,
      address: lead.address,
      website: lead.website,
      email: lead.email,
      phone: lead.phone,
      rating: lead.rating,
      ratingInfo: lead.ratingInfo,
      openHours: lead.openHours,
      siteTitle: lead.siteTitle,
      metaDescription: lead.metaDescription,
      headings: lead.headings,
      aboutSummary: lead.aboutSummary,
      platform: lead.platform,
      techStack: lead.techStack,
      shopifyMeta: lead.shopifyMeta,
      shopifyProducts: lead.shopifyProducts,
      socials: { facebook: lead.facebook, instagram: lead.instagram, twitter: lead.twitter, linkedin: lead.linkedin },
      signals: lead.signals
    })}\n\nSender profile:\nName: ${senderSettings?.senderName || 'Outreach Specialist'}\nService offered: ${senderSettings?.senderService || 'digital growth & client acquisition'}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) return baseline;
    const result = await response.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(rawText);
    return {
      overview: String(parsed.overview || baseline.overview),
      gaps: Array.isArray(parsed.gaps) && parsed.gaps.length ? parsed.gaps.map(String) : baseline.gaps,
      angle: String(parsed.angle || baseline.angle),
      pitchSubject: String(parsed.pitchSubject || baseline.pitchSubject).slice(0, 150),
      pitchBody: String(parsed.pitchBody || baseline.pitchBody),
      generatedAt: new Date().toISOString()
    };
  } catch {
    return baseline;
  }
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

function hydrateSession(session, rawAuthCookie, rawUserCookie) {
  const cookieUser = unsealCookie(rawUserCookie);
  if (cookieUser?.id && cookieUser?.email) {
    session.user = { id: cookieUser.id, email: cookieUser.email, name: cookieUser.name || '' };
    session.userId = cookieUser.id;
  } else {
    session.user = null;
    session.userId = null;
  }
  const ws = getWorkspace(session.userId || 'default');
  const cookieAuth = unsealCookie(rawAuthCookie);
  if (session.userId && cookieAuth?.mailbox && cookieAuth?.tokens && cookieAuth.userId === session.userId) {
    session.mailbox = cookieAuth.mailbox;
    session.tokens = cookieAuth.tokens;
  } else if (session.userId && ws.auth?.mailbox && ws.auth?.tokens) {
    session.mailbox = ws.auth.mailbox;
    session.tokens = ws.auth.tokens;
  } else {
    delete session.mailbox;
    delete session.tokens;
  }
  session.oauth = session.userId && cookieAuth?.userId === session.userId ? cookieAuth.oauth : null;
  session.threadOwners.clear();
  for (const [threadId, owner] of Object.entries(ws.threadOwners)) {
    session.threadOwners.set(threadId, owner);
  }
}

export async function handleRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const json = (value, status = 200) => { res.writeHead(status, jsonHeaders); res.end(JSON.stringify(value)); };
  const redirect = location => { res.writeHead(303, { Location: location }); res.end(); };
  try {
    const reqOrigin = getRequestOrigin(req);
    const activeRedirectUri = getRedirectUri(reqOrigin);
    const isHttps = reqOrigin.startsWith('https://');
    const cookieFlags = `HttpOnly; SameSite=Lax; Path=/${isHttps ? '; Secure' : ''}`;
    const url = new URL(req.url, reqOrigin);
    const rawPath = url.searchParams.get('__path') || url.pathname;
    const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    if (req.method === 'GET' && Object.hasOwn(files, path)) {
      const [file, contentType] = files[path];
      const content = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(content);
    }
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== reqOrigin) {
      fail(403, 'Open Jobhunta directly to submit this request.');
    }
    const cookiesToSet = [];
    let sessionToken = req.headers.cookie?.match(/(?:^|;\s*)jobhunta=([\w-]+)/)?.[1];
    const rawAuthCookie = req.headers.cookie?.match(/(?:^|;\s*)jobhunta_auth=([\w.-]+)/)?.[1] || '';
    const rawUserCookie = req.headers.cookie?.match(/(?:^|;\s*)jobhunta_user=([\w.-]+)/)?.[1] || '';
    for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
    let session = sessions.get(sessionToken);
    if (!session) {
      const token = sessionToken || nonce();
      sessionToken = token;
      session = { expires: Date.now() + maxAge, sends: new Map(), threadOwners: new Map() };
      hydrateSession(session, rawAuthCookie, rawUserCookie);
      sessions.set(token, session);
      cookiesToSet.push(`jobhunta=${token}; ${cookieFlags}`);
    } else {
      hydrateSession(session, rawAuthCookie, rawUserCookie);
    }
    const writeAuthCookie = data => {
      const sealed = data ? sealCookie({ ...data, userId: session.userId }) : '';
      cookiesToSet.push(`jobhunta_auth=${sealed}; ${cookieFlags}${data ? '; Max-Age=2592000' : '; Max-Age=0'}`);
      res.setHeader('Set-Cookie', cookiesToSet);
    };
    const writeUserCookie = userData => {
      const sealed = userData ? sealCookie(userData) : '';
      cookiesToSet.push(`jobhunta_user=${sealed}; ${cookieFlags}${userData ? '; Max-Age=2592000' : '; Max-Age=0'}`);
      res.setHeader('Set-Cookie', cookiesToSet);
    };
    if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet);

    if (req.method === 'POST' && path === '/api/auth/signup') {
      const { name, email, password, senderService } = await readJson(req);
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
        fail(400, 'Enter your name (2–80 characters).');
      }
      if (!validEmail(email)) {
        fail(400, 'Enter a valid email address.');
      }
      if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
        fail(400, 'Password must be at least 6 characters.');
      }
      const existing = await findUserByEmail(email);
      if (existing) {
        fail(409, 'An account with this email already exists. Please sign in.');
      }
      const user = await createUserAccount({ name, email, password, senderService });
      session.user = user;
      session.userId = user.id;
      delete session.mailbox;
      delete session.tokens;
      writeUserCookie(user);
      writeAuthCookie(null);
      const ws = getWorkspace(user.id);
      return json({
        user,
        leads: ws.leads,
        settings: ws.settings,
        mailbox: null
      });
    }

    if (req.method === 'POST' && path === '/api/auth/login') {
      const { email, password } = await readJson(req);
      if (!validEmail(email) || typeof password !== 'string' || !password) {
        fail(400, 'Enter your email and password.');
      }
      const record = await findUserByEmail(email);
      if (!record || !verifyPassword(password, record.password_hash)) {
        fail(401, 'Invalid email or password.');
      }
      const usage = getUserQuotaStatus(record);
      const user = { id: record.id, email: record.email, name: record.name || '', tier: usage.tier, usage };
      session.user = user;
      session.userId = user.id;
      await loadFromSupabase(user.id);
      const ws = getWorkspace(user.id);
      if (ws.auth?.mailbox && ws.auth?.tokens) {
        session.mailbox = ws.auth.mailbox;
        session.tokens = ws.auth.tokens;
        writeAuthCookie({ mailbox: session.mailbox, tokens: session.tokens });
      } else {
        delete session.mailbox;
        delete session.tokens;
        writeAuthCookie(null);
      }
      writeUserCookie(user);
      return json({
        user,
        leads: ws.leads,
        settings: ws.settings,
        mailbox: session.mailbox ?? null
      });
    }

    if (req.method === 'POST' && path === '/api/auth/logout') {
      session.user = null;
      session.userId = null;
      delete session.mailbox;
      delete session.tokens;
      writeUserCookie(null);
      writeAuthCookie(null);
      return json({ ok: true });
    }

    if (req.method === 'POST' && path === '/api/connect') {
      if (!session.userId) fail(401, 'Sign in to your Jobhunta account first.');
      if (!gmailConfigured) fail(503, credentialError || 'Add a Google web OAuth client to enable Gmail.');
      const verifier = nonce();
      const stateToken = nonce();
      session.oauth = { state: stateToken, verifier, sessionToken, redirectUri: activeRedirectUri, expires: Date.now() + 600000 };
      writeAuthCookie({ mailbox: session.mailbox, tokens: session.tokens, oauth: session.oauth });
      const params = new URLSearchParams({
        client_id,
        redirect_uri: activeRedirectUri,
        response_type: 'code',
        scope: gmailScopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: stateToken,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256'
      });
      return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params, redirectUri: activeRedirectUri });
    }
    if (req.method === 'GET' && path === '/oauth/callback') {
      const stateParam = url.searchParams.get('state') || '';
      const pending = session.oauth;
      delete session.oauth;
      if (!session.userId || !pending || pending.expires < Date.now() ||
          pending.sessionToken !== sessionToken || stateParam !== pending.state) return redirect('/?gmail=failed#inbox');
      writeAuthCookie(session.tokens ? { mailbox: session.mailbox, tokens: session.tokens } : null);
      if (!url.searchParams.get('code')) return redirect('/?gmail=failed#inbox');
      try {
        const tokens = await exchange({
          grant_type: 'authorization_code',
          code: url.searchParams.get('code'),
          redirect_uri: pending.redirectUri || activeRedirectUri,
          code_verifier: pending.verifier
        });
        if (!tokens.refresh_token || !gmailScopes.every(scope => (tokens.scope || '').split(' ').includes(scope))) {
          return redirect('/?gmail=permissions#inbox');
        }
        const candidate = { userId: session.userId, tokens: { ...tokens, expires: Date.now() + tokens.expires_in * 1000 } };
        const account = await gmail(candidate, 'profile');
        if (!validEmail(account.emailAddress)) return redirect('/?gmail=failed#inbox');
        const targetUserId = session.userId;
        const ws = getWorkspace(targetUserId);
        session.userId = targetUserId;
        session.tokens = candidate.tokens;
        session.mailbox = account.emailAddress;
        ws.auth = { mailbox: account.emailAddress, tokens: candidate.tokens };
        await saveStore(targetUserId);
        writeAuthCookie({ mailbox: session.mailbox, tokens: session.tokens });
        return redirect('/#inbox');
      } catch { return redirect('/?gmail=failed#inbox'); }
    }
    if (req.method === 'GET' && path === '/api/status') {
      let activeUser = session.user ?? null;
      if (session.userId) {
        if (supabaseConfigured) {
          await loadFromSupabase(session.userId);
          hydrateSession(session, rawAuthCookie, rawUserCookie);
        }
        const record = await findUserById(session.userId);
        if (record) {
          const usage = getUserQuotaStatus(record);
          activeUser = { id: record.id, email: record.email, name: record.name || '', tier: usage.tier, usage };
          session.user = activeUser;
        }
      }
      const ws = session.userId ? getWorkspace(session.userId) : createEmptyWorkspace();
      return json({
        user: activeUser,
        tiers: Object.values(USER_TIERS),
        industries: Object.keys(industries),
        configured: gmailConfigured,
        clientId: client_id || null,
        credentialError,
        redirectUri: activeRedirectUri,
        mailbox: session.userId ? (session.mailbox ?? null) : null,
        supabase: supabaseStatus,
        leads: session.userId ? ws.leads : [],
        settings: session.userId ? ws.settings : createEmptyWorkspace().settings
      });
    }
    if (req.method === 'POST' && path === '/api/workspace') {
      if (!session.userId) fail(401, 'Sign in to save your workspace.');
      const payload = await readJson(req, 2000000);
      if (payload.userId !== session.userId) fail(409, 'The active workspace changed. Sign in again.');
      const ws = getWorkspace(session.userId);
      const previous = { leads: ws.leads, settings: ws.settings, threadOwners: { ...ws.threadOwners } };
      let removedIds = null;
      if (Array.isArray(payload.leads)) {
        const incomingIds = new Set(payload.leads.map(l => l.id));
        removedIds = ws.leads.filter(l => l.id && !incomingIds.has(l.id)).map(l => l.id);
        ws.leads = payload.leads.slice(0, 5000);
        for (const lead of ws.leads) {
          for (const conv of lead.threads || []) {
            if (conv.id && conv.mailbox) {
              ws.threadOwners[conv.id] = conv.mailbox;
              session.threadOwners.set(conv.id, conv.mailbox);
            }
          }
        }
      }
      if (payload.settings && typeof payload.settings === 'object') {
        ws.settings = {
          senderName: String(payload.settings.senderName || '').slice(0, 120),
          senderService: String(payload.settings.senderService || '').slice(0, 300),
          savedSearches: normalizeSavedSearches(payload.settings.savedSearches),
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
      try {
        await saveStore(session.userId, removedIds);
      } catch (error) {
        Object.assign(ws, previous);
        throw error;
      }
      return json({ ok: true, supabase: supabaseStatus });
    }
    if (req.method === 'POST' && path === '/api/disconnect') {
      if (!session.userId) fail(401, 'Sign in to your Jobhunta account first.');
      const targetUserId = session.userId || 'default';
      const ws = getWorkspace(targetUserId);
      delete session.tokens;
      delete session.mailbox;
      ws.auth = null;
      writeAuthCookie(null);
      await saveStore(targetUserId);
      return json({ ok: true });
    }
    if (req.method === 'GET' && path === '/api/search') {
      if (!session.userId) fail(401, 'Sign in to search for businesses.');
      if (url.searchParams.get('expanded') === '1') return await streamDiscovery(res, url.searchParams, session.userId);
      const city = (url.searchParams.get('city') || '').trim();
      const industry = validateSearch(url.searchParams.get('industry'), city);
      const chargedOn = await consumeQuota(session.userId, 'search');
      const rankMode = url.searchParams.get('rankMode') || 'all';
      if (url.searchParams.get('stream') === '1') {
        return await streamSearch(res, industry, city, rankMode,
          count => consumeQuota(session.userId, 'result', null, count),
          () => consumeQuota(session.userId, 'search', chargedOn).catch(console.error));
      }
      try {
        const businesses = await search(industry, city);
        const unique = [...new Map(businesses.map(item => [item.id, item])).values()];
        if (!unique.length) return json([]);
        const granted = await consumeQuota(session.userId, 'result', null, unique.length);
        if (!granted) fail(429, 'Daily search result limit reached. Your allowance resets at midnight UTC.');
        return json(unique.slice(0, granted));
      } catch (error) {
        await consumeQuota(session.userId, 'search', chargedOn).catch(console.error);
        throw error;
      }
    }
    if (req.method === 'POST' && path === '/api/enrich') {
      if (!session.userId) fail(401, 'Sign in to your Jobhunta account first.');
      const { website } = await readJson(req);
      if (typeof website !== 'string' || !website.trim()) fail(400, 'Provide a website URL to scan.');
      return json(await fetchWebsiteEmails(website.trim()));
    }
    if (req.method === 'POST' && path === '/api/analyze') {
      if (!session.userId) fail(401, 'Sign in to your Jobhunta account first.');
      const { lead } = await readJson(req);
      if (!lead || typeof lead !== 'object') fail(400, 'Provide business details to analyze.');
      const ws = getWorkspace(session.userId || 'default');
      return json(await analyzeLeadWithAi(lead, ws.settings));
    }
    if (req.method === 'POST' && path === '/api/send') {
      if (!session.userId) fail(401, 'Sign in to send email.');
      return json(await send(session, await readJson(req)));
    }
    if (req.method === 'POST' && path === '/api/thread') {
      if (!session.userId) fail(401, 'Sign in to your Jobhunta account first.');
      const { id, mailbox } = await readJson(req);
      if (!session.mailbox) fail(401, 'Connect your Gmail account first.');
      if (session.mailbox !== mailbox) fail(403, 'Connect the Gmail account that sent this conversation.');
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) fail(400, 'Invalid Gmail thread.');
      const targetUserId = session.userId || 'default';
      const ws = getWorkspace(targetUserId);
      session.threadOwners.set(id, mailbox);
      ws.threadOwners[id] = mailbox;
      saveStore(targetUserId).catch(console.error);
      return json(await thread(session, id));
    }
    return json({ error: 'Page not found.' }, 404);
  } catch (error) {
    return json({ error: error.status ? error.message : 'Jobhunta could not complete the request.' }, error.status || 500);
  }
}

export const server = createServer(handleRequest);
export default handleRequest;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, 'localhost', () => console.log('Jobhunta is running at ' + localOrigin));
}
