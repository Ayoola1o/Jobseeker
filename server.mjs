import { normalizeLeadProfiles } from './public/qualification.mjs';
import {
  platformDomains,
  PLATFORM_DISCOVERY_GROUPS,
  SOCIAL_DIRECTORY_PACKS,
  LAUNCH_DOMAIN_MODES,
  REDDIT_SUBREDDIT_PACKS,
  classifyRentedOrIntermediaryUrl,
  searchList,
  googleQueries,
  platformFootprintQueries,
  publicWebsite,
  businessKeys,
  websiteIdentity
} from './public/discovery.mjs';
import {
  detectPlatform,
  analyzePageAudit,
  generateClientOutreach,
  PERSONA_TOOL_MODULES,
  PERSONA_CATALOG,
  getPersonaConfig,
  getActivePersonaModules,
  filterAuditFindingsForPersona
} from './public/audit.mjs';
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
      avatarUrl: '',
      persona: 'web_dev',
      addedTools: [],
      autoEnrichDiscovery: false,
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
          leadProfiles: normalizeLeadProfiles(saved.settings?.leadProfiles),
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
    ...(supabaseKey.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + supabaseKey }),
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

export const TIER_ALIASES = {
  free: 'basic',
  starter: 'silver',
  pro: 'gold',
  agency: 'premium'
};

export const USER_TIERS = {
  basic: {
    key: 'basic',
    label: 'Basic',
    displayLabel: 'Basic (Free)',
    price: 'Free',
    level: 1,
    dailySearchLimit: 10,
    dailyResultLimit: 50,
    dailyEmailLimit: 20,
    dailyAdvancedSearchLimit: 0,
    maxSearchPages: 8,
    features: {
      searchModes: ['all'],
      stateExpansion: false,
      maxFolders: 1,
      opportunityFilter: false,
      csvImportExport: false,
      bulkEnrich: false,
      auditCategories: ['score_only'],
      aiPitch: 'basic',
      outreachVariants: false,
      solutionPack: 'locked',
      inboxSolutionInsert: false,
      attachments: false,
      broadcast: false,
      maxBroadcastRecipients: 0
    }
  },
  silver: {
    key: 'silver',
    label: 'Silver',
    displayLabel: 'Silver (Starter)',
    price: '$29/mo',
    level: 2,
    dailySearchLimit: 40,
    dailyResultLimit: 300,
    dailyEmailLimit: 100,
    dailyAdvancedSearchLimit: 0,
    maxSearchPages: 11,
    features: {
      searchModes: ['all', 'low'],
      stateExpansion: false,
      maxFolders: null,
      opportunityFilter: true,
      csvImportExport: false,
      bulkEnrich: false,
      auditCategories: ['bugs', 'seo'],
      aiPitch: 'editable',
      outreachVariants: false,
      solutionPack: 'phase1',
      inboxSolutionInsert: false,
      attachments: true,
      broadcast: false,
      maxBroadcastRecipients: 0
    }
  },
  gold: {
    key: 'gold',
    label: 'Gold',
    displayLabel: 'Gold (Pro)',
    price: '$79/mo',
    level: 3,
    dailySearchLimit: 150,
    dailyResultLimit: 1000,
    dailyEmailLimit: 400,
    dailyAdvancedSearchLimit: 1,
    maxSearchPages: 15,
    features: {
      searchModes: ['all', 'low', 'shopify'],
      stateExpansion: false,
      maxFolders: null,
      opportunityFilter: true,
      csvImportExport: true,
      bulkEnrich: false,
      auditCategories: ['all', 'bugs', 'seo', 'performance', 'security'],
      aiPitch: 'custom_prompt',
      outreachVariants: true,
      solutionPack: 'full',
      inboxSolutionInsert: false,
      attachments: true,
      broadcast: true,
      maxBroadcastRecipients: 50
    }
  },
  premium: {
    key: 'premium',
    label: 'Premium',
    displayLabel: 'Premium (Agency)',
    price: '$199/mo',
    level: 4,
    dailySearchLimit: 500,
    dailyResultLimit: 4000,
    dailyEmailLimit: 2000,
    dailyAdvancedSearchLimit: null,
    maxSearchPages: 19,
    features: {
      searchModes: ['all', 'low', 'shopify'],
      stateExpansion: true,
      maxFolders: null,
      opportunityFilter: true,
      csvImportExport: true,
      bulkEnrich: true,
      auditCategories: ['all', 'bugs', 'seo', 'performance', 'security'],
      aiPitch: 'custom_prompt',
      outreachVariants: true,
      solutionPack: 'downloadable',
      inboxSolutionInsert: true,
      attachments: true,
      broadcast: true,
      maxBroadcastRecipients: 250
    }
  },
  diamond: {
    key: 'diamond',
    label: 'Diamond',
    displayLabel: 'Diamond',
    price: '$499/mo',
    level: 5,
    dailySearchLimit: null,
    dailyResultLimit: null,
    dailyEmailLimit: null,
    dailyAdvancedSearchLimit: null,
    maxSearchPages: 25,
    features: {
      searchModes: ['all', 'low', 'shopify'],
      stateExpansion: true,
      maxFolders: null,
      opportunityFilter: true,
      csvImportExport: true,
      bulkEnrich: true,
      auditCategories: ['all', 'bugs', 'seo', 'performance', 'security'],
      aiPitch: 'custom_prompt',
      outreachVariants: true,
      solutionPack: 'downloadable',
      inboxSolutionInsert: true,
      attachments: true,
      broadcast: true,
      maxBroadcastRecipients: null
    }
  }
};

export function normalizeTierKey(rawTier = 'basic', email = '') {
  if (String(email || '').trim().toLowerCase() === 'philipibitade@gmail.com') {
    return 'diamond';
  }
  const cleaned = String(rawTier || 'basic').trim().toLowerCase();
  const mapped = TIER_ALIASES[cleaned] || cleaned;
  return Object.hasOwn(USER_TIERS, mapped) ? mapped : 'basic';
}

function todayUsageDate() {
  return new Date().toISOString().slice(0, 10);
}

export function getMaxSearchPagesForTier(tierLevel = 1) {
  const lvl = Number(tierLevel) || 1;
  if (lvl <= 1) return 8;
  if (lvl === 2) return 11;
  if (lvl === 3) return 15;
  if (lvl === 4) return 19;
  return 25;
}

export function getUserQuotaStatus(userRecord = {}) {
  const tierKey = normalizeTierKey(userRecord?.tier, userRecord?.email);
  const tier = USER_TIERS[tierKey] || USER_TIERS.basic;
  const today = todayUsageDate();
  const sameDay = userRecord?.usage_date === today;
  const searchesToday = sameDay ? Math.max(0, Number(userRecord?.searches_today) || 0) : 0;
  const resultsToday = sameDay ? Math.max(0, Number(userRecord?.results_today) || 0) : 0;
  const emailsToday = sameDay ? Math.max(0, Number(userRecord?.emails_today) || 0) : 0;
  return {
    tier: tier.key,
    label: tier.label,
    displayLabel: tier.displayLabel,
    price: tier.price,
    level: tier.level,
    features: tier.features,
    dailySearchLimit: tier.dailySearchLimit,
    dailyEmailLimit: tier.dailyEmailLimit,
    dailyResultLimit: tier.dailyResultLimit,
    dailyAdvancedSearchLimit: tier.dailyAdvancedSearchLimit,
    maxSearchPages: tier.maxSearchPages,
    searchesToday,
    resultsToday,
    emailsToday,
    usageDate: today
  };
}

function getAdvancedSearchUsage(userId, quotaStatus) {
  const ws = getWorkspace(userId || 'default');
  const today = todayUsageDate();
  const raw = ws.settings?._advancedUsage;
  const used = raw && raw.date === today ? Math.max(0, Number(raw.count) || 0) : 0;
  const limit = quotaStatus?.dailyAdvancedSearchLimit ?? 0;
  return { used, limit, date: today };
}

async function consumeAdvancedSearchQuota(userId, quotaStatus, refundDate = null) {
  const tierLevel = quotaStatus?.level || 1;
  if (tierLevel < 3) {
    fail(403, 'Multi-Engine Platform/Email-Stack & Reddit Lead Discovery requires Gold (Pro — 1/day), Premium (Agency), or Diamond.');
  }
  const ws = getWorkspace(userId || 'default');
  const { used, limit, date } = getAdvancedSearchUsage(userId, quotaStatus);
  if (refundDate) {
    if (refundDate === date && used > 0) {
      ws.settings._advancedUsage = { date, count: Math.max(0, used - 1) };
      await saveStore(userId).catch(() => {});
    }
    return date;
  }
  if (limit !== null && used >= limit) {
    fail(429, `Gold (Pro) includes ${limit} Advanced Multi-Engine / Reddit search per day (resets at 00:00 UTC). Upgrade to Premium (Agency) or Diamond for unlimited access.`);
  }
  ws.settings._advancedUsage = { date, count: used + 1 };
  await saveStore(userId).catch(() => {});
  return date;
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
  if (!userId) fail(401, 'Sign in to your Job Hunta account first.');
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
      results_today: 'eq.' + (record.results_today ?? 0)
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
      if (!res.ok) throw new Error('Supabase returned HTTP ' + res.status + '.');
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected Supabase response.');
      return rows[0] || null;
    } catch {
      fail(503, 'Job Hunta cannot reach its account database. Check the Supabase server credentials and try again.');
    }
  }
  return store.users.find(u => u.email.toLowerCase() === normalized) || null;
}

async function createUserAccount({ name, email, password, senderService = '', tier = 'basic' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  const tierKey = normalizeTierKey(tier, normalizedEmail);
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
          avatarUrl: String(row.settings.avatarUrl || '').slice(0, 180000),
          persona: getPersonaConfig(row.settings.persona || 'web_dev').id,
          addedTools: Array.isArray(row.settings.addedTools)
            ? row.settings.addedTools.map(String).filter(k => Object.hasOwn(PERSONA_TOOL_MODULES, k))
            : [],
          autoEnrichDiscovery: Boolean(row.settings.autoEnrichDiscovery),
          _advancedUsage: row.settings._advancedUsage && typeof row.settings._advancedUsage === 'object'
            ? { date: String(row.settings._advancedUsage.date || ''), count: Math.max(0, Number(row.settings._advancedUsage.count) || 0) }
            : undefined,
          savedSearches: normalizeSavedSearches(row.settings.savedSearches),
          leadProfiles: normalizeLeadProfiles(row.settings.leadProfiles),
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
          thread_owners: {}, updated_at: new Date().toISOString() },
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
  '/icons.mjs': ['icons.mjs', 'text/javascript; charset=utf-8'],
  '/audit.mjs': ['audit.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/lucide.mjs': ['lucide.mjs', 'text/javascript; charset=utf-8'],
  '/LUCIDE-LICENSE.txt': ['LUCIDE-LICENSE.txt', 'text/plain; charset=utf-8'],
  '/qualification.mjs': ['qualification.mjs', 'text/javascript; charset=utf-8'],
  '/discovery.mjs': ['discovery.mjs', 'text/javascript; charset=utf-8'],
  '/csv.mjs': ['csv.mjs', 'text/javascript; charset=utf-8'],
  '/business-import.csv': ['business-import.csv', 'text/csv; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/favicon.ico': ['logo.png', 'image/png'],
  '/logo.png': ['logo.png', 'image/png'],
  '/logo-full.jpg': ['logo-full.jpg', 'image/jpeg'],
  '/logo-splash.jpg': ['logo-splash.jpg', 'image/jpeg']
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

async function outreachRegistry(userId) {
  const ws = getWorkspace(userId);
  if (!supabaseConfigured) return ws.threadOwners;
  const params = new URLSearchParams({ id: 'eq.' + userId, select: 'thread_owners' });
  try {
    const response = await fetch(supabaseUrl + '/rest/v1/jobhunta_workspace?' + params, {
      headers: supabaseHeaders(), signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error();
    return (await response.json())[0]?.thread_owners || {};
  } catch {
    fail(503, 'Outreach conversations could not be loaded.');
  }
}

async function registerOutreach(userId, id, registration) {
  if (supabaseConfigured) {
    const response = await fetch(supabaseUrl + '/rest/v1/rpc/jobhunta_register_outreach', {
      method: 'POST', headers: supabaseHeaders(),
      body: JSON.stringify({ workspace_id: userId, thread_id: id, registration }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('Outreach storage returned HTTP ' + response.status);
  }
  getWorkspace(userId).threadOwners[id] = registration;
  if (!supabaseConfigured) await saveStore(userId);
}

function emailMatches(headerValue, address) {
  const emails = (headerValue || '').match(/[A-Z0-9.!#$%&'*+/=?^_{}|~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Boolean(address) && emails.some(email => email.toLowerCase() === address.toLowerCase());
}

export function outreachMessageKind(message, registration) {
  if (message.sent) return emailMatches(message.to, registration.recipient) ? 'sent' : 'unrelated';
  if (/mailer-daemon|postmaster/i.test(message.from) ||
      /report-type\s*=\s*"?delivery-status/i.test(message.contentType)) return 'bounce';
  if (/^auto-(replied|generated)/i.test(message.autoSubmitted) ||
      /^(?:automatic reply|auto reply|out of office)\b/i.test(message.subject)) return 'automatic';
  return emailMatches(message.from, registration.recipient) ||
    (registration.replyAddresses || []).some(address => emailMatches(message.from, address))
    ? 'reply' : 'review';
}

async function fetchGmailThread(session, id) {
  const result = await gmail(session, 'threads/' + id + '?format=full');
  return (result.messages || []).map(message => ({
    id: message.id, from: header(message, 'from'), to: header(message, 'to'),
    replyTo: header(message, 'reply-to'),
    subject: header(message, 'subject'), messageId: header(message, 'message-id'),
    references: header(message, 'references'), inReplyTo: header(message, 'in-reply-to'),
    autoSubmitted: header(message, 'auto-submitted'), contentType: header(message, 'content-type'),
    labelIds: message.labelIds || [],
    sent: message.labelIds?.includes('SENT') ?? false,
    time: Number(message.internalDate),
    body: extractMessageBody(message.payload, message.snippet)
  })).sort((a, b) => a.time - b.time);
}

async function thread(session, id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) fail(400, 'Invalid Gmail thread.');
  const registry = await outreachRegistry(session.userId);
  let registration = Object.hasOwn(registry, id) ? registry[id] : null;
  if (!registration || (typeof registration === 'string' ? registration : registration.mailbox) !== session.mailbox) {
    fail(404, 'This conversation is not registered to the connected Gmail account.');
  }
  let legacy;
  if (typeof registration === 'string') {
    if (supabaseConfigured) await loadFromSupabase(session.userId);
    const lead = getWorkspace(session.userId).leads.find(item => item.threads?.some(conv =>
      conv.id === id && conv.mailbox === session.mailbox && Number.isFinite(Number(conv.time)) && validEmail(conv.to)));
    const conversation = lead?.threads.find(item => item.id === id && item.mailbox === session.mailbox);
    if (!conversation) fail(404, 'No saved outreach record is available for this conversation.');
    legacy = { leadId: lead.id, mailbox: session.mailbox, recipient: conversation.to,
      subject: conversation.subject, time: Number(conversation.time), templateName: conversation.templateName };
  }
  const messages = await fetchGmailThread(session, id);
  if (legacy) {
    const sent = messages.find(message => message.sent && emailMatches(message.to, legacy.recipient) &&
      message.subject === legacy.subject && Math.abs(message.time - legacy.time) <= 15 * 60 * 1000);
    if (!sent) fail(404, 'Gmail could not verify the original outreach message.');
    registration = { ...legacy, time: sent.time, messageId: sent.id };
    await registerOutreach(session.userId, id, registration);
  }
  const start = messages.findIndex(message => message.id === registration.messageId && message.sent &&
    emailMatches(message.to, registration.recipient));
  if (start < 0) fail(404, 'The original outreach message is unavailable in Gmail.');
  const isSelfThread = emailMatches(registration.recipient, session.mailbox);
  const filtered = [];
  for (let i = start; i < messages.length; i++) {
    const message = messages[i];
    let kind = outreachMessageKind(message, registration);
    let sent = message.sent;
    if (i > start && isSelfThread && message.labelIds?.includes('INBOX')) {
      // Self-test replies have both SENT and INBOX labels in Gmail; treat subsequent messages as replies
      sent = false;
      kind = 'reply';
    }
    if (kind === 'unrelated' && !sent) kind = 'review';
    if (kind === 'unrelated') continue;
    filtered.push({ ...message, sent, kind });
  }
  return filtered;
}

async function savedOutreachLead(userId, id) {
  if (!supabaseConfigured) return getWorkspace(userId).leads.some(lead => lead.id === id);
  const params = new URLSearchParams({ id: 'eq.' + dbRowId(userId, id), user_id: 'eq.' + userId, select: 'id', limit: '1' });
  try {
    const response = await fetch(supabaseUrl + '/rest/v1/jobhunta_leads?' + params, {
      headers: supabaseHeaders(), signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error();
    return Boolean((await response.json())[0]);
  } catch {
    fail(503, 'Could not verify the saved lead.');
  }
}

export function buildRawMimeMessage({ from, to, encodedSubject, extraHeaders = [], body, htmlBody = '', attachments = [] }) {
  const safeAttachments = Array.isArray(attachments) ? attachments : [];
  if (safeAttachments.length > 5) fail(400, 'Attach up to 5 files per email.');
  let totalDecodedBytes = 0;
  const normalizedAtts = safeAttachments.map(att => {
    const rawName = String(att?.filename || 'attachment').replace(/[\r\n"\\]/g, '_').trim().slice(0, 120) || 'attachment';
    const mimeType = String(att?.mimeType || 'application/octet-stream').replace(/[\r\n;]/g, '').trim() || 'application/octet-stream';
    const b64 = String(att?.dataBase64 || '').replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) fail(400, `Invalid attachment data for "${rawName}".`);
    const byteLen = Math.floor((b64.length * 3) / 4);
    totalDecodedBytes += byteLen;
    if (totalDecodedBytes > 10 * 1024 * 1024) fail(400, 'Total attachment size must be 10 MB or less.');
    return { filename: rawName, mimeType, b64 };
  });

  const headers = ['From: ' + from, 'To: ' + to, ...extraHeaders, 'Subject: ' + encodedSubject, 'MIME-Version: 1.0'];
  const encodedBody = (Buffer.from(body).toString('base64').match(/.{1,76}/g) || ['']).join('\r\n');
  const cleanHtml = typeof htmlBody === 'string' && htmlBody.trim().length <= 150000 ? htmlBody.trim() : '';
  const encodedHtml = cleanHtml ? (Buffer.from(cleanHtml).toString('base64').match(/.{1,76}/g) || ['']).join('\r\n') : '';

  if (!normalizedAtts.length && !encodedHtml) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + encodedBody).toString('base64url');
  }

  if (!normalizedAtts.length && encodedHtml) {
    const altBoundary = 'jobhunta_alt_' + randomBytes(12).toString('hex');
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    const altParts = [
      `--${altBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`,
      `--${altBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedHtml}`,
      `--${altBoundary}--`
    ];
    return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + altParts.join('\r\n')).toString('base64url');
  }

  const boundary = 'jobhunta_' + randomBytes(12).toString('hex');
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  let firstBodyPart;
  if (encodedHtml) {
    const altBoundary = 'jobhunta_alt_' + randomBytes(12).toString('hex');
    firstBodyPart =
      `--${boundary}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
      `--${altBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n` +
      `--${altBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedHtml}\r\n` +
      `--${altBoundary}--`;
  } else {
    firstBodyPart = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`;
  }

  const parts = [firstBodyPart];
  for (const att of normalizedAtts) {
    const wrapped = (att.b64.match(/.{1,76}/g) || ['']).join('\r\n');
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n${wrapped}`
    );
  }
  parts.push(`--${boundary}--`);
  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + parts.join('\r\n')).toString('base64url');
}

async function send(session, data) {
  const { to, body, htmlBody = '', threadId, requestId, attachments = [], direct = false } = data;
  let { subject } = data;
  if (!validEmail(to) || typeof body !== 'string' || !body.trim() || body.length > 16000 ||
      typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || subject.length > 160 ||
      !/^[a-z0-9-]{16,64}$/i.test(requestId || '')) fail(400, 'Enter a valid recipient, subject and message.');
  if (!session.mailbox) fail(401, 'Connect Gmail first.');
  if (!threadId && !direct && (typeof data.leadId !== 'string' || !data.leadId || data.leadId.length > 512)) {
    fail(400, 'Select a saved lead before sending outreach.');
  }
  const key = session.mailbox + ':' + requestId;
  if (session.sends.has(key)) return session.sends.get(key);
  const operation = (async () => {
    if (!threadId && !direct && !await savedOutreachLead(session.userId, data.leadId)) {
      fail(404, 'Save this lead before sending outreach.');
    }
    const extraHeaders = [];
    if (threadId) {
      const messages = await thread(session, threadId);
      const parent = data.parentId
        ? messages.find(message => message.id === data.parentId)
        : messages.at(-1);
      if (!parent || !['sent', 'reply'].includes(parent.kind) || !/^<[^<>\s]+>$/.test(parent.messageId)) {
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
      extraHeaders.push('In-Reply-To: ' + parent.messageId, 'References: ' + [...references.slice(-15), parent.messageId].join(' '));
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
    const raw = buildRawMimeMessage({
      from: session.mailbox,
      to,
      encodedSubject,
      extraHeaders,
      body,
      htmlBody,
      attachments
    });
    const chargedOn = await consumeQuota(session.userId, 'email');
    let result;
    try {
      result = await gmail(session, 'messages/send', { raw, ...(threadId ? { threadId } : {}) });
    } catch (error) {
      // A transport failure has an unknown delivery outcome.
      if (error.providerRejected) await consumeQuota(session.userId, 'email', chargedOn).catch(console.error);
      throw error;
    }
    if (!threadId || threadId !== result.threadId) {
      const registration = {
        leadId: data.leadId || ('direct:' + to.toLowerCase()), recipient: to, mailbox: session.mailbox, subject, time: Date.now(),
        messageId: result.id, templateName: String(data.templateName || (direct ? 'Direct / Test Email' : '')).slice(0, 80)
      };
      try {
        await registerOutreach(session.userId, result.threadId, registration);
      } catch (error) {
        console.error('Gmail accepted outreach but registration failed:', error.message);
        return { ...result, trackingError: true };
      }
    }
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
      headers: { 'User-Agent': 'Job Hunta/1.1 (local business discovery)' },
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

const cityCoordsCache = new Map();
async function resolveCityCoords(city = '') {
  const key = String(city || '').trim().toLowerCase();
  if (!key || /^(online|global|worldwide|remote|any)$/i.test(key)) return null;
  if (cityCoordsCache.has(key)) return cityCoordsCache.get(key);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'Job Hunta/1.2 (local business discovery)' },
      signal: AbortSignal.timeout(3200)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.[0]?.lat && data?.[0]?.lon) {
        const coords = { lat: Number(data[0].lat).toFixed(5), lon: Number(data[0].lon).toFixed(5) };
        cityCoordsCache.set(key, coords);
        return coords;
      }
    }
  } catch {}
  cityCoordsCache.set(key, null);
  return null;
}

export function getSearchOffsets(rankMode = 'all', isMultiCity = false, tierLevel = 1) {
  const maxPage = getMaxSearchPagesForTier(tierLevel);
  if (isMultiCity) {
    if (rankMode === 'deep_full' && tierLevel >= 5) {
      return [{ first: 1, page: 1 }, { first: 21, page: 3 }, { first: 61, page: 7 }, { first: 101, page: 11 }, { first: 161, page: 17 }];
    }
    if (rankMode === 'deep_19' && tierLevel >= 4) {
      return [{ first: 81, page: 9 }, { first: 121, page: 13 }, { first: 161, page: 17 }];
    }
    return ['low', 'deep_15', 'shopify'].includes(rankMode)
      ? [{ first: 21, page: 3 }, { first: 51, page: 6 }]
      : [{ first: 1, page: 1 }, { first: 11, page: 2 }, { first: 21, page: 3 }];
  }

  let startPage = 1;
  let endPage = maxPage;
  if (rankMode === 'low') {
    startPage = 3;
    endPage = Math.max(8, Math.min(maxPage, 11));
  } else if (rankMode === 'deep_15') {
    startPage = 6;
    endPage = Math.min(maxPage, 15);
  } else if (rankMode === 'deep_19') {
    startPage = 9;
    endPage = Math.min(maxPage, 19);
  } else if (rankMode === 'deep_full') {
    startPage = 1;
    endPage = Math.max(maxPage, 25);
  }

  const offsets = [];
  for (let p = startPage; p <= endPage; p++) {
    offsets.push({ first: (p - 1) * 10 + 1, page: p });
  }
  return offsets;
}

const ignoredWebHosts = /(?:^|\.)(?:bing\.com|microsoft\.com|google\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com|twitter\.com|x\.com|amazon\.com|ebay\.com|etsy\.com|yelp\.com|tripadvisor\.com|yellowpages\.com|wikipedia\.org|reddit\.com|shopify\.com|apps\.shopify\.com|community\.shopify\.com|help\.shopify\.com)$/i;

function decodeBingRedirectUrl(rawHref = '') {
  const cleanHref = decodeHtmlEntities(rawHref).trim();
  try {
    const parsed = new URL(cleanHref);
    if (/bing\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/ck/a')) {
      const uParam = parsed.searchParams.get('u') || '';
      if (uParam.startsWith('a1')) {
        const decoded = Buffer.from(uParam.slice(2), 'base64url').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    return parsed.href;
  } catch {
    return '';
  }
}

export function parseBingWebSearchHtml(html = '', industry = '', city = '', firstOffset = 1, pageNumber = 1, query = '') {
  const items = [];
  const seenHosts = new Set();
  const blockRegex = /<li\b[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const resolvedHref = decodeBingRedirectUrl(linkMatch[1]);
    const url = publicWebsite(resolvedHref);
    if (!url) continue;
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host || ignoredWebHosts.test(host) || seenHosts.has(host)) continue;
    seenHosts.add(host);

    const rawTitle = decodeHtmlEntities(linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const cleanName = (rawTitle.split(/\s+[|\-–—:]\s+/)[0] || host).trim().slice(0, 110);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch
      ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 260)
      : '';
    const isMyshopify = host.endsWith('.myshopify.com');
    const rank = firstOffset + items.length;

    items.push({
      id: `web-${host}`,
      name: cleanName || host,
      industry,
      city,
      address: city,
      website: url.origin,
      phone: '',
      email: '',
      platform: isMyshopify ? 'Shopify' : '',
      shopifyMeta: isMyshopify ? { myshopifyDomain: host } : null,
      about: snippet,
      searchRank: rank,
      searchPage: pageNumber,
      discoveryQuery: query,
      source: url.origin
    });
  }
  return items;
}

const DIRECTORY_NOISE_DOMAINS = new Set([
  'yelp.com', 'yellowpages.com', 'tripadvisor.com', 'bbb.org', 'angi.com',
  'thumbtack.com', 'mapquest.com', 'foursquare.com', 'wikipedia.org',
  'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com',
  'twitter.com', 'pinterest.com', 'linkedin.com', 'reddit.com', 'amazon.com',
  'ebay.com', 'walmart.com', 'etsy.com', 'trustpilot.com', 'clutch.co', 'g2.com'
]);

function isNoiseDirectoryDomain(hostname = '') {
  const clean = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!clean) return true;
  if (DIRECTORY_NOISE_DOMAINS.has(clean)) return true;
  for (const d of DIRECTORY_NOISE_DOMAINS) {
    if (clean.endsWith('.' + d)) return true;
  }
  return false;
}

export function parseBingRssXml(xml = '', fallbackIndustry = '', city = '', startRank = 1, query = '', allowAllHosts = false) {
  const items = [];
  const seenHosts = new Set();
  let rank = startRank;
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const rawTitle = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    const rawLink = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
    const rawDesc = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
    const linkStr = decodeHtmlEntities(rawLink.replace(/<!\[CDATA\[|\]\]>/g, '').trim());
    const url = publicWebsite(linkStr);
    if (!url || (!allowAllHosts && isNoiseDirectoryDomain(url.hostname))) continue;
    const identity = websiteIdentity(url);
    if (!identity || seenHosts.has(identity)) continue;
    seenHosts.add(identity);
    const title = decodeHtmlEntities(rawTitle.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const snippet = decodeHtmlEntities(rawDesc.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 260);
    const isMyShopify = url.hostname.endsWith('.myshopify.com');
    const cleanName = (title.split(/\s+[|\-–—:]\s+/)[0] || title || identity).slice(0, 100);
    const currentRank = rank++;
    items.push({
      id: `rss-${identity.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      name: cleanName,
      industry: fallbackIndustry,
      city: city || 'Online',
      address: '',
      about: [
        `Bing RSS #${currentRank}`,
        isMyShopify ? 'Shopify Store (.myshopify.com)' : '',
        snippet
      ].filter(Boolean).join(' · '),
      website: (allowAllHosts || identity.includes('/')) ? url.href : url.origin,
      phone: '',
      email: '',
      source: url.href,
      platform: isMyShopify ? 'Shopify' : '',
      searchRank: currentRank,
      searchPage: Math.ceil(currentRank / 10),
      discoveryProvider: 'Bing RSS',
      discoveryQuery: query
    });
  }
  return items;
}

export function parseDuckDuckGoHtml(html = '', fallbackIndustry = '', city = '', startRank = 1, query = '', allowAllHosts = false) {
  const items = [];
  const seenHosts = new Set();
  let rank = startRank;
  const resultBlocks = String(html || '').split(/class=["'][^"']*\bresult__body\b[^"']*["']/i).slice(1);
  for (const block of resultBlocks) {
    const linkMatch = block.match(/class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/href=["']([^"']+)["'][^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    let rawHref = decodeHtmlEntities(linkMatch[1].trim());
    if (rawHref.includes('uddg=')) {
      const uddg = rawHref.match(/[?&]uddg=([^&]+)/)?.[1];
      if (uddg) {
        try { rawHref = decodeURIComponent(uddg); } catch {}
      }
    } else if (rawHref.startsWith('//')) {
      rawHref = 'https:' + rawHref;
    }
    if (/duckduckgo\.com\/y\.js/i.test(rawHref)) continue;
    const url = publicWebsite(rawHref);
    if (!url || (!allowAllHosts && isNoiseDirectoryDomain(url.hostname))) continue;
    const identity = websiteIdentity(url);
    if (!identity || seenHosts.has(identity)) continue;
    seenHosts.add(identity);
    const title = decodeHtmlEntities(linkMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const snippetMatch = block.match(/class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    const snippet = snippetMatch
      ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 260)
      : '';
    const isMyShopify = url.hostname.endsWith('.myshopify.com');
    const cleanName = (title.split(/\s+[|\-–—:]\s+/)[0] || title || identity).slice(0, 100);
    const currentRank = rank++;
    items.push({
      id: `ddg-${identity.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      name: cleanName,
      industry: fallbackIndustry,
      city: city || 'Online',
      address: '',
      about: [
        `DuckDuckGo #${currentRank}`,
        isMyShopify ? 'Shopify Store (.myshopify.com)' : '',
        snippet
      ].filter(Boolean).join(' · '),
      website: (allowAllHosts || identity.includes('/')) ? url.href : url.origin,
      phone: '',
      email: '',
      source: url.href,
      platform: isMyShopify ? 'Shopify' : '',
      searchRank: currentRank,
      searchPage: Math.ceil(currentRank / 10),
      discoveryProvider: 'DuckDuckGo',
      discoveryQuery: query
    });
  }
  return items;
}

async function searchBingRss(query, cleanIndustry, subCity, startRank = 1, firstOffset = 1, allowAllHosts = false) {
  try {
    const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=20&first=${firstOffset}`;
    const response = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseBingRssXml(xml, cleanIndustry, subCity, startRank, query, allowAllHosts);
  } catch {
    return [];
  }
}

async function searchDuckDuckGoLite(query, cleanIndustry, subCity, startRank = 1, allowAllHosts = false) {
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8500)
    });
    if (!response.ok) return [];
    const html = await response.text();
    if (/anomaly-modal|captcha|challenge-form/i.test(html)) return [];
    return parseDuckDuckGoHtml(html, cleanIndustry, subCity, startRank, query, allowAllHosts);
  } catch {
    return [];
  }
}

const CRT_NOISE_HOSTS = /(?:cloudflare|amazonaws|azure|googleusercontent|fastly|akamai|vercel|netlify|github|gitlab|heroku|digitalocean|linode|plesk|cpanel|whm|letsencrypt|sectigo|digicert|godaddy|namecheap|wixdns|myshopify|squarespace|wordpress\.com|gov\.|edu\.|\.gov$|\.edu$|\.internal$|\.local$)/i;

export function parseCrtShCertificates(rows = [], keyword = '', locationFilter = '') {
  const seenDomains = new Map();
  const locSlug = String(locationFilter || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    String(b?.entry_timestamp || b?.not_before || '').localeCompare(String(a?.entry_timestamp || a?.not_before || ''))
  );

  for (const row of sorted) {
    const rawNames = String(row?.name_value || row?.common_name || '').split(/\s+/);
    const issuedDate = String(row?.entry_timestamp || row?.not_before || '').slice(0, 10);
    for (const raw of rawNames) {
      const host = raw.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '').trim();
      if (!/^[a-z0-9-]{3,42}\.(?:com|co|io|ai|shop|store|org|net|us|uk|ca|ng|au|de|fr|health|dental|clinic|studio|agency|beauty|care|homes)$/i.test(host)) continue;
      if (host.split('.').length > 3) continue;
      if (/^(mail|smtp|imap|pop|webmail|autodiscover|cpanel|whm|cpcontacts|cpcalendars|staging|dev|test|api|cdn|ns1|ns2)\./i.test(host)) continue;
      if (CRT_NOISE_HOSTS.test(host) || isNoiseDirectoryDomain(host)) continue;
      if (locSlug && locSlug.length >= 3 && !/^(online|global|worldwide|remote|any)$/i.test(locationFilter)) {
        // Prefer domains containing location hint if many results exist, otherwise allow clean brand domains
      }
      if (seenDomains.has(host)) continue;
      const brandLabel = host.split('.')[0]
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      const crtProofUrl = row?.id ? `https://crt.sh/?id=${encodeURIComponent(row.id)}` : `https://crt.sh/?q=${encodeURIComponent(host)}`;
      seenDomains.set(host, {
        id: `crt-${host}`,
        name: `${brandLabel} (${host})`,
        industry: keyword,
        city: locationFilter || 'Newly Registered',
        address: issuedDate ? `SSL Issued: ${issuedDate}` : 'Certificate Transparency Log',
        about: `Newly issued SSL domain (${host})${issuedDate ? ` · Registered/Issued ${issuedDate}` : ''} via Certificate Transparency (crt.sh)`,
        website: `https://${host}`,
        phone: '',
        email: '',
        source: crtProofUrl,
        platform: 'New Domain',
        discoveryProvider: 'crt.sh SSL Feed',
        channelMeta: {
          channel: 'new_domain',
          badgeLabel: issuedDate ? `New Domain (${issuedDate})` : 'New Domain (crt.sh)',
          certIssuedAt: issuedDate,
          listingUrl: crtProofUrl,
          hasStandaloneSite: true
        }
      });
      if (seenDomains.size >= 35) break;
    }
    if (seenDomains.size >= 35) break;
  }
  return [...seenDomains.values()];
}

async function searchCrtShNewDomains(keyword = '', locationFilter = '') {
  const slug = String(keyword || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  if (slug.length < 3) return [];
  try {
    const crtUrl = `https://crt.sh/?q=%25${encodeURIComponent(slug)}%25&output=json`;
    const res = await fetch(crtUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JobHunta/1.2)',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(11000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return parseCrtShCertificates(data, keyword, locationFilter);
  } catch {
    return [];
  }
}

async function runTargetedSiteQueries(queries = [], keyword = '', city = '', decorateItem = null) {
  const out = [];
  const seen = new Set();
  for (const q of queries) {
    const [rssItems, ddgItems] = await Promise.all([
      searchBingRss(q, keyword, city || 'Online', 1, 1, true),
      searchDuckDuckGoLite(q, keyword, city || 'Online', 1, true)
    ]);
    for (const item of [...rssItems, ...ddgItems]) {
      const key = item.website || item.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const decorated = decorateItem ? decorateItem(item, q) : item;
      if (decorated) out.push(decorated);
    }
  }
  return out;
}

async function searchSocialAndDirectoryLeads(keyword = '', city = '', packKey = 'link_in_bio') {
  const pack = SOCIAL_DIRECTORY_PACKS[packKey] || SOCIAL_DIRECTORY_PACKS.link_in_bio;
  const useLoc = city && !/^(online|global|worldwide|remote|any)$/i.test(city) ? ` "${city}"` : '';
  const queries = pack.sites.slice(0, 4).map(site => `site:${site} "${keyword}"${useLoc}`);
  return runTargetedSiteQueries(queries, keyword, city || 'Online', item => {
    let hostLabel = pack.badge;
    try { hostLabel = new URL(item.website).hostname.replace(/^www\./, ''); } catch {}
    return {
      ...item,
      id: `dir-${Buffer.from(item.website).toString('base64url').slice(0, 22)}`,
      platform: pack.badge,
      discoveryProvider: hostLabel,
      about: `[${pack.badge} · ${hostLabel}] ${item.about || ''}`.slice(0, 450),
      channelMeta: {
        channel: pack.channel,
        badgeLabel: `${pack.badge} (${hostLabel})`,
        rentedPlatform: hostLabel,
        listingUrl: item.website,
        hasStandaloneSite: false
      }
    };
  });
}

async function searchProductLaunches(keyword = '', city = '') {
  const useLoc = city && !/^(online|global|worldwide|remote|any)$/i.test(city) ? ` "${city}"` : '';
  const queries = [
    `site:producthunt.com/posts "${keyword}"${useLoc}`,
    `site:kickstarter.com/projects "${keyword}"${useLoc}`,
    `site:indiehackers.com/product "${keyword}"${useLoc}`
  ];
  return runTargetedSiteQueries(queries, keyword, city || 'Online', item => {
    let host = 'Launch Platform';
    try { host = new URL(item.website).hostname.replace(/^www\./, ''); } catch {}
    return {
      ...item,
      id: `launch-${Buffer.from(item.website).toString('base64url').slice(0, 22)}`,
      platform: 'Product Launch',
      discoveryProvider: host,
      channelMeta: {
        channel: 'launch',
        badgeLabel: `Product Launch (${host})`,
        listingUrl: item.website
      }
    };
  });
}

async function searchJobBoardCompanies(keyword = '', city = '') {
  const useLoc = city && !/^(online|global|worldwide|remote|any)$/i.test(city) ? ` "${city}"` : '';
  const queries = [
    `site:boards.greenhouse.io "${keyword}"${useLoc}`,
    `site:jobs.lever.co "${keyword}"${useLoc}`,
    `site:apply.workable.com "${keyword}"${useLoc}`,
    `site:jobs.ashbyhq.com "${keyword}"${useLoc}`
  ];
  return runTargetedSiteQueries(queries, keyword, city || 'Remote', item => {
    let host = 'Job Board';
    let companySlug = '';
    try {
      const u = new URL(item.website);
      host = u.hostname.replace(/^www\./, '');
      companySlug = u.pathname.split('/').filter(Boolean)[0] || '';
    } catch {}
    const cleanCompany = companySlug
      ? companySlug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : item.name;
    return {
      ...item,
      id: `job-${Buffer.from(item.website).toString('base64url').slice(0, 22)}`,
      name: `${cleanCompany} (Hiring: ${item.name.slice(0, 48)})`,
      platform: 'Hiring on Job Board',
      discoveryProvider: host,
      channelMeta: {
        channel: 'job_board',
        badgeLabel: `Hiring Now (${host})`,
        openRole: item.name,
        listingUrl: item.website
      }
    };
  });
}

async function searchAdFunnelSpenders(keyword = '', city = '') {
  const useLoc = city && !/^(online|global|worldwide|remote|any)$/i.test(city) ? ` "${city}"` : '';
  const queries = [
    `"${keyword}"${useLoc} (inurl:"/lp/" OR inurl:"/pages/offer" OR "claim your free" OR "limited time offer") -yelp -pinterest`,
    `"${keyword}"${useLoc} ("book your free consultation" OR "get an instant quote") -yelp -jobs`
  ];
  return runTargetedSiteQueries(queries, keyword, city || 'Online', item => {
    if (isNoiseDirectoryDomain(publicWebsite(item.website)?.hostname || '')) return null;
    return {
      ...item,
      platform: item.platform || 'Active Funnel / LP',
      channelMeta: {
        channel: 'ad_funnel',
        badgeLabel: 'Active Promo / Funnel Page',
        listingUrl: item.source || item.website
      }
    };
  });
}

async function searchChamberDirectories(cleanIndustry = '', subCity = '') {
  const queries = [
    `"${cleanIndustry}" "${subCity}" ("chamber of commerce" OR inurl:chamber) -yelp -jobs`,
    `"${cleanIndustry}" "${subCity}" "member directory" -yelp -facebook`
  ];
  return runTargetedSiteQueries(queries, cleanIndustry, subCity, item => {
    if (isNoiseDirectoryDomain(publicWebsite(item.website)?.hostname || '')) return null;
    return {
      ...item,
      discoveryProvider: 'Chamber / Trade Directory',
      channelMeta: {
        channel: 'chamber',
        badgeLabel: 'Chamber / Association Lead',
        listingUrl: item.source || item.website
      }
    };
  });
}

async function searchSerperMaps(cleanIndustry, city) {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return [];
  try {
    const response = await fetch('https://google.serper.dev/maps', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${cleanIndustry} in ${city}` }),
      signal: AbortSignal.timeout(8500)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.places || []).map((p, idx) => ({
      id: `gmaps-${p.cid || p.placeId || idx}-${(p.title || '').slice(0, 24)}`,
      name: p.title || 'Unnamed Business',
      industry: p.type || cleanIndustry,
      city,
      address: p.address || '',
      about: [`Google Maps #${p.position || (idx + 1)}`, p.rating ? `★ ${p.rating} (${p.ratingCount || 0} reviews)` : '', p.type].filter(Boolean).join(' · '),
      website: p.website || '',
      phone: p.phoneNumber || '',
      email: '',
      source: p.cid ? `https://www.google.com/maps?cid=${p.cid}` : 'https://www.google.com/maps',
      rating: p.rating ? String(p.rating) : '',
      ratingInfo: p.ratingCount ? `${p.ratingCount} Google reviews` : '',
      searchRank: p.position || (idx + 1),
      searchPage: 1,
      discoveryProvider: 'Google Maps'
    }));
  } catch {
    return [];
  }
}

async function searchPlatformAndStackWeb(cleanIndustry, subCity, targetPlatform = 'Shopify') {
  const queries = platformFootprintQueries(cleanIndustry, subCity, targetPlatform);
  const discovered = [];
  const seenDomains = new Set();

  const pushUnique = list => {
    for (const it of list) {
      const u = publicWebsite(it.website);
      const key = u ? websiteIdentity(u) : it.id;
      if (!key || seenDomains.has(key)) continue;
      seenDomains.add(key);
      if (!it.platform && targetPlatform) {
        const hostDomain = platformDomains[targetPlatform];
        if (hostDomain && u?.hostname.endsWith(hostDomain)) it.platform = targetPlatform;
        else it.targetPlatform = targetPlatform;
      }
      discovered.push(it);
    }
  };

  for (const q of queries) {
    if (process.env.TAVILY_API_KEY?.trim()) {
      try { pushUnique(await tavilyDiscovery(q, cleanIndustry, subCity || 'Online')); } catch {}
    } else if (process.env.SERPER_API_KEY?.trim()) {
      try { pushUnique(await googleDiscovery(q, cleanIndustry, subCity || 'Online')); } catch {}
    }

    const [rssItems, ddgItems] = await Promise.all([
      searchBingRss(q, cleanIndustry, subCity || 'Online', 1, 1, ['Etsy Shop', 'Faire Brand', 'eBay Store'].includes(targetPlatform)),
      searchDuckDuckGoLite(q, cleanIndustry, subCity || 'Online', 1, ['Etsy Shop', 'Faire Brand', 'eBay Store'].includes(targetPlatform))
    ]);
    pushUnique(rssItems);
    pushUnique(ddgItems);

    try {
      const webUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&first=1&count=15`;
      const response = await fetch(webUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(7500)
      });
      if (response.ok) {
        const html = await response.text();
        pushUnique(parseBingWebSearchHtml(html, cleanIndustry, subCity || 'Online', 1, 1, q));
      }
    } catch {}
  }
  return discovered;
}

export function classifyRedditPostIntent(title = '', selftext = '', flair = '', subreddit = '') {
  const t = String(title || '').trim();
  const body = String(selftext || '').trim();
  const fl = String(flair || '').trim();
  const combined = `${fl} ${t} ${body}`;

  // Strictly reject freelancer self-promotion posts ([For Hire], offering my services, etc.)
  if (/^\s*\[?\s*for\s*hire\s*\]?/i.test(t) || /^\s*\[?\s*for\s*hire\s*\]?/i.test(fl)) {
    return { validBuyer: false, reason: 'for_hire_seller' };
  }
  if (/\b(i am for hire|available for hire|offering my services|hire me for|dm me to hire me|my freelance services)\b/i.test(combined) &&
      !/^\s*\[?\s*hiring\s*\]?/i.test(t)) {
    return { validBuyer: false, reason: 'seller_pitch' };
  }

  const isDirectHiring = /^\s*\[?\s*hiring\s*\]?/i.test(t) || /^\s*\[?\s*hiring\s*\]?/i.test(fl) ||
    /\b(hiring a|looking to hire|want to hire|budget is \$|paying \$|need a freelancer|looking for a developer|looking for an? agency|looking for seo|looking for a marketer)\b/i.test(combined);

  const isPainPointOwner = /\b(my website|our website|my store|my shopify|our business|my small business|roast my|review my site|not converting|low conversion|need help with|struggling with|losing customers|how do i get more leads|facebook ads|google ads)\b/i.test(combined);

  const subLower = String(subreddit || '').toLowerCase();
  const isHiringSub = ['forhire', 'designjobs', 'hireawriter', 'jobbit'].includes(subLower);
  if (isHiringSub && !isDirectHiring) {
    return { validBuyer: false, reason: 'non_hiring_in_job_board' };
  }
  if (!isDirectHiring && !isPainPointOwner) {
    return { validBuyer: false, reason: 'low_buyer_intent' };
  }

  const budgetMatch = combined.match(/(?:\$|USD\s*|€|£)\s?\d{1,6}(?:[.,]\d{1,3})?(?:\s*(?:\/hr|\/mo|\/month|k|per month|budget))?/i);
  const externalUrls = [...combined.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})([^\s)"'<>]*)/gi)]
    .map(m => m[0].replace(/[.,;:'")\]}>]+$/, ''))
    .filter(u => !/(reddit\.com|redd\.it|imgur\.com|gyazo\.com|prnt\.sc|loom\.com|docs\.google\.com|drive\.google\.com|github\.com)/i.test(u));
  const emails = extractEmailsFromHtml(combined);

  return {
    validBuyer: true,
    intentType: isDirectHiring ? 'Hiring Now' : 'Business Pain Point',
    budgetHint: budgetMatch ? budgetMatch[0].trim() : '',
    externalWebsite: externalUrls[0] || '',
    extractedEmail: emails[0] || ''
  };
}

function redditSubmissionToLead(post = {}, fallbackKeyword = '', locationFilter = '') {
  const subreddit = post.subreddit || '';
  const title = decodeHtmlEntities(String(post.title || '').replace(/\s+/g, ' ').trim());
  const selftext = decodeHtmlEntities(String(post.selftext || '').trim());
  const author = String(post.author || '').trim();
  if (!title || !author || author === '[deleted]' || author === 'AutoModerator') return null;

  const check = classifyRedditPostIntent(title, selftext, post.link_flair_text || '', subreddit);
  if (!check.validBuyer) return null;

  if (locationFilter && !/^(online|global|worldwide|remote|any)$/i.test(locationFilter)) {
    const locNorm = locationFilter.toLowerCase();
    if (!`${title} ${selftext}`.toLowerCase().includes(locNorm)) {
      // Allow remote hiring posts, only filter if user specified a strict non-matching geo on non-hiring posts
      if (check.intentType !== 'Hiring Now') return null;
    }
  }

  const permalink = post.permalink
    ? (post.permalink.startsWith('http') ? post.permalink : `https://www.reddit.com${post.permalink}`)
    : (post.url || `https://www.reddit.com/r/${subreddit}`);
  const cleanSnippet = selftext.replace(/\s+/g, ' ').slice(0, 320);
  let websiteHost = '';
  if (check.externalWebsite) {
    try { websiteHost = new URL(check.externalWebsite).hostname.replace(/^www\./, ''); } catch {}
  }
  const leadName = websiteHost
    ? `${websiteHost} (u/${author})`
    : `u/${author} · ${title.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 58)}`;

  return {
    id: `reddit-${post.id || Buffer.from(permalink).toString('base64url').slice(0, 18)}`,
    name: leadName,
    industry: fallbackKeyword || `r/${subreddit}`,
    city: locationFilter || 'Remote / Reddit',
    address: `r/${subreddit} · Posted by u/${author}`,
    about: [
      `[${check.intentType}] r/${subreddit}`,
      check.budgetHint ? `Budget: ${check.budgetHint}` : '',
      title,
      cleanSnippet ? `— "${cleanSnippet}"` : ''
    ].filter(Boolean).join(' · ').slice(0, 600),
    website: check.externalWebsite || '',
    phone: '',
    email: check.extractedEmail || '',
    source: permalink,
    platform: check.externalWebsite?.includes('myshopify.com') ? 'Shopify' : 'Reddit Lead',
    discoveryProvider: `Reddit r/${subreddit}`,
    redditMeta: {
      subreddit,
      author,
      postTitle: title,
      postSnippet: cleanSnippet,
      permalink,
      intentType: check.intentType,
      budgetHint: check.budgetHint
    }
  };
}

async function searchRedditSubreddit(subreddit, keyword, intentFilter = 'all_buyers', locationFilter = '') {
  const qParts = [keyword];
  if (intentFilter === 'hiring') qParts.push('hiring OR budget OR looking');
  const query = qParts.filter(Boolean).join(' ').trim();
  const results = [];
  const headers = {
    'User-Agent': 'web:com.jobhunta.leadfinder:v1.2 (B2B Lead Discovery)',
    Accept: 'application/json, text/xml, */*'
  };

  // 1. Primary: Reddit Public JSON Search
  try {
    const jsonUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=month&limit=25`;
    const res = await fetch(jsonUrl, { headers, signal: AbortSignal.timeout(7500) });
    if (res.ok) {
      const payload = await res.json();
      const children = payload?.data?.children || [];
      for (const child of children) {
        const lead = redditSubmissionToLead(child?.data || {}, keyword, locationFilter);
        if (lead && (intentFilter !== 'hiring' || lead.redditMeta?.intentType === 'Hiring Now')) {
          results.push(lead);
        }
      }
      if (results.length) return results;
    }
  } catch {}

  // 2. Secondary: Reddit Public RSS Feed
  try {
    const rssUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new&t=month`;
    const res = await fetch(rssUrl, { headers, signal: AbortSignal.timeout(7500) });
    if (res.ok) {
      const xml = await res.text();
      for (const entry of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
        const block = entry[1];
        const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
        const author = (block.match(/<name>\/?u\/([^<]+)<\/name>/i)?.[1] || 'redditor').trim();
        const link = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
        const contentRaw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || '';
        const selftext = decodeHtmlEntities(contentRaw).replace(/<[^>]+>/g, ' ');
        const idMatch = block.match(/<id>([^<]+)<\/id>/i)?.[1] || link;
        const lead = redditSubmissionToLead({ id: idMatch, subreddit, title, selftext, author, permalink: link }, keyword, locationFilter);
        if (lead && (intentFilter !== 'hiring' || lead.redditMeta?.intentType === 'Hiring Now')) {
          results.push(lead);
        }
      }
      if (results.length) return results;
    }
  } catch {}

  // 3. Tertiary Zero-Key Fallback: PullPush Community Archive API
  try {
    const ppUrl = `https://api.pullpush.io/reddit/search/submission/?subreddit=${encodeURIComponent(subreddit)}&q=${encodeURIComponent(keyword)}&size=25&sort=desc`;
    const res = await fetch(ppUrl, { headers, signal: AbortSignal.timeout(8500) });
    if (res.ok) {
      const payload = await res.json();
      for (const post of payload?.data || []) {
        const lead = redditSubmissionToLead(post, keyword, locationFilter);
        if (lead && (intentFilter !== 'hiring' || lead.redditMeta?.intentType === 'Hiring Now')) {
          results.push(lead);
        }
      }
    }
  } catch {}

  return results;
}

async function searchShopifySiteWeb(cleanIndustry, subCity) {
  return searchPlatformAndStackWeb(cleanIndustry, subCity, 'Shopify');
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

async function searchOverpassFallback(cleanIndustry, city, limitNodes = 100, radiusMeters = 6000) {
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cityName = `["name"~${JSON.stringify('^' + escapedCity + '$')},i]`;

  let areaQuery;
  let nearbyQuery;
  if (Object.hasOwn(industries, cleanIndustry)) {
    const [tag, value] = industries[cleanIndustry];
    const filter = `["${tag}"="${value}"]["name"]`;
    areaQuery = `area${cityName}["boundary"="administrative"]->.city;nwr(area.city)${filter};`;
    nearbyQuery = `node${cityName}["place"~"^(city|town|village|suburb|borough|municipality)$"]->.city;nwr(around.city:${radiusMeters})${filter};`;
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
      `nwr(around.city:${radiusMeters})["amenity"~${tagRegex},i]["name"];` +
      `nwr(around.city:${radiusMeters})["shop"~${tagRegex},i]["name"];` +
      `nwr(around.city:${radiusMeters})["office"~${tagRegex},i]["name"];` +
      `nwr(around.city:${radiusMeters})["craft"~${tagRegex},i]["name"];` +
      `nwr(around.city:${radiusMeters})["tourism"~${tagRegex},i]["name"];` +
      `nwr(around.city:${radiusMeters})["name"~${nameRegex},i];);`;
  }

  const queryOverpass = async query => {
    for (const host of ['overpass-api.de', 'overpass.private.coffee']) {
      try {
        const result = await provider('https://' + host + '/api/interpreter', {
          method: 'POST',
          headers: { 'User-Agent': 'Job Hunta/1.2 (personal local business search)', Accept: 'application/json' },
          body: new URLSearchParams({ data: `[out:json][timeout:14];${query}out tags ${Math.min(350, Math.max(50, limitNodes))};` })
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

async function streamSearch(res, industry, city, rankMode = 'all', reserveResults, onFailure, tierLevel = 5, extraOpts = {}) {
  const cleanIndustry = (industry || '').trim();
  const sourceType = ['local', 'platform', 'directory', 'launches', 'reddit'].includes(extraOpts.sourceType) ? extraOpts.sourceType : 'local';
  const cleanCity = (city || '').trim() || (sourceType !== 'local' ? 'Online' : '');
  if (!/^[\p{L}\p{M}\p{N} .,'’&/+()-]{2,60}$/u.test(cleanIndustry) ||
      !/^[\p{L}\p{M}\p{N} .,'’/()-]{2,75}$/u.test(cleanCity)) {
    fail(400, 'Choose or enter a keyword/industry and enter a city, state, or Online.');
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

  const seen = new Set();
  const seenDomains = new Set();
  let stopped = false;
  const emitBusinesses = async items => {
    const deduped = [];
    for (const item of items) {
      if (!item || seen.has(item.id)) continue;
      const host = item.website ? websiteIdentity(publicWebsite(item.website)) : '';
      if (host && seenDomains.has(host) && !item.redditMeta) continue;
      seen.add(item.id);
      if (host && !item.redditMeta) seenDomains.add(host);
      deduped.push(item);
    }
    if (closed || !deduped.length) return 0;
    let granted;
    try {
      granted = await reserveResults(deduped.length);
    } catch (error) {
      stopped = true;
      sendEvent({ type: 'error', error: error.message || 'Usage is temporarily unavailable.' });
      return 0;
    }
    for (const item of deduped.slice(0, granted)) {
      sendEvent({ type: 'business', item, totalFound: seen.size });
    }
    if (granted < deduped.length) {
      stopped = true;
      sendEvent({ type: 'limit', message: 'Daily search result limit reached. Your allowance resets at midnight UTC.' });
    }
    return granted;
  };

  // MODE A0: SOCIAL & DIRECTORY-ONLY BUSINESSES (Link-in-Bio, Booksy/Fresha/Houzz/Clutch, Social Pages)
  if (sourceType === 'directory') {
    const packKey = Object.hasOwn(SOCIAL_DIRECTORY_PACKS, extraOpts.directoryPack) ? extraOpts.directoryPack : 'link_in_bio';
    const pack = SOCIAL_DIRECTORY_PACKS[packKey];
    sendEvent({
      type: 'status',
      page: 1,
      totalPages: 1,
      totalFound: seen.size,
      message: `Scanning ${pack.label} for "${cleanIndustry}" businesses…`
    });
    const dirItems = await searchSocialAndDirectoryLeads(cleanIndustry, cleanCity, packKey);
    if (dirItems.length) await emitBusinesses(dirItems);
    if (seen.size === 0) await onFailure?.();
    sendEvent({ type: 'done', totalFound: seen.size });
    if (!res.writableEnded) res.end();
    return;
  }

  // MODE A1: NEWLY REGISTERED DOMAINS (crt.sh) & PRODUCT LAUNCHES
  if (sourceType === 'launches') {
    const launchMode = Object.hasOwn(LAUNCH_DOMAIN_MODES, extraOpts.launchMode) ? extraOpts.launchMode : 'both';
    if (launchMode === 'crt_sh' || launchMode === 'both') {
      sendEvent({
        type: 'status',
        page: 1,
        totalPages: launchMode === 'both' ? 2 : 1,
        totalFound: seen.size,
        message: `Querying live Certificate Transparency logs (crt.sh) for newly registered "${cleanIndustry}" domains…`
      });
      const crtItems = await searchCrtShNewDomains(cleanIndustry, cleanCity);
      if (crtItems.length) await emitBusinesses(crtItems);
    }
    if (!stopped && (launchMode === 'product_launch' || launchMode === 'both')) {
      sendEvent({
        type: 'status',
        page: launchMode === 'both' ? 2 : 1,
        totalPages: launchMode === 'both' ? 2 : 1,
        totalFound: seen.size,
        message: `Scanning Product Hunt, Kickstarter & Indie Hackers for "${cleanIndustry}" launches…`
      });
      const launchItems = await searchProductLaunches(cleanIndustry, cleanCity);
      if (launchItems.length) await emitBusinesses(launchItems);
    }
    if (seen.size === 0) await onFailure?.();
    sendEvent({ type: 'done', totalFound: seen.size });
    if (!res.writableEnded) res.end();
    return;
  }

  // MODE A: REDDIT, COMPANY JOB BOARDS & PAID-AD FUNNEL BUYER-INTENT ENGINE
  if (sourceType === 'reddit') {
    const packKey = Object.hasOwn(REDDIT_SUBREDDIT_PACKS, extraOpts.redditPack) ? extraOpts.redditPack : 'hiring';
    const pack = REDDIT_SUBREDDIT_PACKS[packKey];

    if (pack.kind === 'job_boards') {
      sendEvent({
        type: 'status',
        page: 1,
        totalPages: 1,
        totalFound: seen.size,
        message: `Scanning Greenhouse, Lever, Workable & Ashby job boards for companies hiring "${cleanIndustry}"…`
      });
      const jobItems = await searchJobBoardCompanies(cleanIndustry, cleanCity);
      if (jobItems.length) await emitBusinesses(jobItems);
      if (seen.size === 0) await onFailure?.();
      sendEvent({ type: 'done', totalFound: seen.size });
      if (!res.writableEnded) res.end();
      return;
    }

    if (pack.kind === 'ad_funnels') {
      sendEvent({
        type: 'status',
        page: 1,
        totalPages: 1,
        totalFound: seen.size,
        message: `Scanning active paid-traffic & promo landing pages for "${cleanIndustry}"…`
      });
      const funnelItems = await searchAdFunnelSpenders(cleanIndustry, cleanCity);
      if (funnelItems.length) await emitBusinesses(funnelItems);
      if (seen.size === 0) await onFailure?.();
      sendEvent({ type: 'done', totalFound: seen.size });
      if (!res.writableEnded) res.end();
      return;
    }
    const customSubs = searchList(extraOpts.subreddits || '', 6).map(s => s.replace(/^r\//i, '').replace(/[^a-zA-Z0-9_]/g, '')).filter(Boolean);
    const subreddits = customSubs.length ? customSubs : pack.subreddits;
    const intentFilter = extraOpts.redditIntent === 'hiring' ? 'hiring' : 'all_buyers';
    const geoFilter = /^(online|global|worldwide|remote|any)$/i.test(cleanCity) ? '' : cleanCity;

    for (let i = 0; i < subreddits.length; i++) {
      if (closed || stopped) break;
      const sub = subreddits[i];
      sendEvent({
        type: 'status',
        page: i + 1,
        totalPages: subreddits.length,
        totalFound: seen.size,
        message: `Scanning Reddit r/${sub} for "${cleanIndustry}" buyer & hiring posts [${i + 1}/${subreddits.length}]…`
      });
      const items = await searchRedditSubreddit(sub, cleanIndustry, intentFilter, geoFilter);
      if (items.length) await emitBusinesses(items);
    }

    if (seen.size === 0) await onFailure?.();
    sendEvent({ type: 'done', totalFound: seen.size });
    if (!res.writableEnded) res.end();
    return;
  }

  // MODE B: MULTI-ENGINE PLATFORM & EMAIL MARKETING STACK DISCOVERY
  if (sourceType === 'platform') {
    const targetPlatform = Object.hasOwn(platformDomains, extraOpts.targetPlatform) ? extraOpts.targetPlatform : 'Shopify';
    const isGlobalOnline = /^(online|global|worldwide|remote|any)$/i.test(cleanCity);
    let subLocations = isGlobalOnline ? [''] : await resolveSearchLocations(cleanCity);
    if (subLocations.length > 1 && tierLevel < 4) subLocations = [cleanCity];

    for (let locIdx = 0; locIdx < subLocations.length; locIdx++) {
      if (closed || stopped) break;
      const subCity = subLocations[locIdx];
      const locLabel = subCity || 'Global Web';
      sendEvent({
        type: 'status',
        page: locIdx + 1,
        totalPages: subLocations.length,
        totalFound: seen.size,
        message: `Searching Bing RSS, DuckDuckGo & Web for ${targetPlatform} "${cleanIndustry}" leads (${locLabel})…`
      });
      const webItems = await searchPlatformAndStackWeb(cleanIndustry, subCity, targetPlatform);
      if (webItems.length) await emitBusinesses(webItems);

      if (!stopped && subCity && ['Shopify', 'WooCommerce', 'BigCommerce', 'Wix', 'Squarespace'].includes(targetPlatform)) {
        sendEvent({
          type: 'status',
          page: locIdx + 1,
          totalPages: subLocations.length,
          totalFound: seen.size,
          message: `Cross-checking Bing Maps stores for "${cleanIndustry}" in ${subCity}…`
        });
        const mapItems = await searchBingMaps(cleanIndustry, subCity, 'shopify');
        if (mapItems.length) await emitBusinesses(mapItems);
      }
    }

    if (seen.size === 0) await onFailure?.();
    sendEvent({ type: 'done', totalFound: seen.size });
    if (!res.writableEnded) res.end();
    return;
  }

  // MODE C: MULTI-ENGINE LOCAL & MAPS DISCOVERY (Progressive Page Depth: Basic 1–8, Silver 1–11, Gold 1–15, Premium 1–19, Diamond 1–25+ Full)
  let subLocations = await resolveSearchLocations(cleanCity);
  if (subLocations.length > 1 && tierLevel < 4) {
    subLocations = [cleanCity];
    sendEvent({
      type: 'status',
      totalFound: 0,
      message: `Searching "${cleanCity}" (State-wide multi-city expansion unlocks on Premium / Agency & Diamond plans)…`
    });
  }
  const isStateBreakdown = subLocations.length > 1;
  const offsetConfigs = getSearchOffsets(rankMode === 'shopify' ? 'low' : rankMode, isStateBreakdown, tierLevel);
  const isDeepRankMode = ['low', 'deep_15', 'deep_19', 'deep_full'].includes(rankMode);

  if (isStateBreakdown) {
    sendEvent({
      type: 'status',
      totalFound: 0,
      message: `Breaking "${cleanCity}" into ${subLocations.length} cities/districts (${subLocations.slice(0, 4).map(s => s.split(',')[0]).join(', ')}…) to scrape bit-by-bit…`
    });
  }

  for (let locIndex = 0; locIndex < subLocations.length; locIndex++) {
    if (closed || stopped) break;
    const subCity = subLocations[locIndex];
    const cityCoords = await resolveCityCoords(subCity);
    const cpParam = cityCoords ? `&cp=${cityCoords.lat}%7E${cityCoords.lon}&lvl=13.5` : '';

    // 1. Optional Google Maps via Serper (if configured)
    if (process.env.SERPER_API_KEY?.trim() && !['low', 'deep_15', 'deep_19'].includes(rankMode) && !closed && !stopped) {
      sendEvent({
        type: 'status',
        page: 1,
        totalPages: offsetConfigs.length,
        totalFound: seen.size,
        message: `Querying Google Maps for "${cleanIndustry}" in ${subCity}…`
      });
      const gMapItems = await searchSerperMaps(cleanIndustry, subCity);
      if (gMapItems.length) await emitBusinesses(gMapItems);
    }

    // 2. Shopify Web Discovery if rankMode === 'shopify'
    if (rankMode === 'shopify' && !closed && !stopped) {
      sendEvent({
        type: 'status',
        page: 1,
        totalPages: offsetConfigs.length,
        totalFound: seen.size,
        message: `Scraping Shopify stores via Bing RSS, DuckDuckGo & site:myshopify.com in ${subCity}…`
      });
      try {
        const siteItems = await searchShopifySiteWeb(cleanIndustry, subCity);
        if (siteItems.length) await emitBusinesses(siteItems);
      } catch {}
    }

    // 3. Multi-Page Bing Maps + Multi-Page Bing Web RSS Pagination (up to Plan Max Page: 8 / 11 / 15 / 19 / 25+)
    const queries = rankMode === 'shopify'
      ? [`${cleanIndustry} store in ${subCity}`, `${cleanIndustry} boutique shop in ${subCity}`]
      : [`${cleanIndustry} in ${subCity}`];

    const rssWebQuery = `"${cleanIndustry}" "${subCity}" -jobs -vacancies -yelp -tripadvisor -yellowpages`;
    let emptyStreak = 0;
    const maxEmptyStreak = isDeepRankMode ? 5 : 3;

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
            ? `Scraping ${cleanCity} bit-by-bit [${locIndex + 1}/${subLocations.length}: ${subCity} · Page ${page}]…`
            : (isDeepRankMode || rankMode === 'shopify'
                ? `Scraping deep-ranked businesses in ${subCity} (Page ${page}, Rank #${first}+)…`
                : `Scraping Multi-Engine Page ${page} (Rank #${first}+) in ${subCity}…`)
        });
        try {
          const mapUrl = `https://www.bing.com/maps/overlaybfpr?q=${encodeURIComponent(query)}&count=20&first=${first}${cpParam}`;
          const [mapRes, rssPageItems] = await Promise.all([
            fetch(mapUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
              },
              signal: AbortSignal.timeout(9500)
            }).catch(() => null),
            !isStateBreakdown
              ? searchBingRss(rssWebQuery, cleanIndustry, subCity, first, first)
              : Promise.resolve([])
          ]);

          let mapItems = [];
          if (mapRes && mapRes.ok) {
            const html = await mapRes.text();
            mapItems = parseBingMapsHtml(html, cleanIndustry, subCity, first, page);
          }
          for (const rItem of rssPageItems) rItem.searchPage = page;

          const combinedPageItems = [...mapItems, ...rssPageItems];
          const addedOnPage = await emitBusinesses(combinedPageItems);
          if (stopped) break;
          if (addedOnPage === 0) {
            emptyStreak++;
            if (emptyStreak >= maxEmptyStreak) break;
          } else {
            emptyStreak = 0;
          }
        } catch {
          break;
        }
      }
    }

    // 4. DuckDuckGo Lite Sweep + Weak-SEO / Outdated-Website Dorks + Chamber of Commerce (Gold/Premium/Diamond)
    if (!closed && !stopped && !isStateBreakdown) {
      if (rankMode === 'chamber') {
        sendEvent({
          type: 'status',
          totalFound: seen.size,
          message: `Scanning Chamber of Commerce & Trade Member Directories in ${subCity}…`
        });
        const chamberItems = await searchChamberDirectories(cleanIndustry, subCity);
        if (chamberItems.length) await emitBusinesses(chamberItems);
      }
      sendEvent({
        type: 'status',
        totalFound: seen.size,
        message: `Sweeping DuckDuckGo${isDeepRankMode && tierLevel >= 3 ? ' & Weak-SEO footprints' : ''} for buried "${cleanIndustry}" websites in ${subCity}…`
      });
      const ddgBase = searchDuckDuckGoLite(rssWebQuery, cleanIndustry, subCity, Math.max(seen.size + 1, offsetConfigs[0]?.first || 1));
      const weakSeoPromises = (isDeepRankMode && tierLevel >= 3)
        ? [
            searchBingRss(`intitle:"Home" "${cleanIndustry}" "${subCity}" -yelp -facebook`, cleanIndustry, subCity, 120, 1),
            searchBingRss(`"${cleanIndustry}" "${subCity}" ("powered by WordPress" OR "created with Wix" OR "© 2020" OR "© 2021") -yelp`, cleanIndustry, subCity, 140, 1),
            ...(rankMode === 'deep_full' ? [searchChamberDirectories(cleanIndustry, subCity)] : [])
          ]
        : [];
      const extraBatches = await Promise.all([ddgBase, ...weakSeoPromises]);
      const extraFlat = extraBatches.flat();
      if (extraFlat.length) await emitBusinesses(extraFlat);
    }

    // 5. Diamond Deepest Full Sweep: Intra-City Neighborhood Zone Slicing + 300-node 15km OpenStreetMap Sweep
    if (!closed && !stopped && !isStateBreakdown && rankMode === 'deep_full' && tierLevel >= 5) {
      const zones = [`North ${subCity}`, `South ${subCity}`, `East ${subCity}`, `West ${subCity}`, `Downtown ${subCity}`];
      for (let zIdx = 0; zIdx < zones.length; zIdx++) {
        if (closed || stopped) break;
        const zoneName = zones[zIdx];
        sendEvent({
          type: 'status',
          totalFound: seen.size,
          message: `Diamond Deep-Zone Sweep [${zIdx + 1}/${zones.length}: ${zoneName}] — uncovering buried neighborhood businesses…`
        });
        const zoneQuery = `"${cleanIndustry}" "${zoneName}" -yelp -tripadvisor -jobs`;
        const [zoneRss, zoneDdg] = await Promise.all([
          searchBingRss(zoneQuery, cleanIndustry, subCity, Math.max(201, seen.size + 1), 1),
          searchDuckDuckGoLite(zoneQuery, cleanIndustry, subCity, Math.max(201, seen.size + 1))
        ]);
        const taggedZone = [...zoneRss, ...zoneDdg].map(it => ({ ...it, searchPage: Math.max(it.searchPage || 21, 21) }));
        if (taggedZone.length) await emitBusinesses(taggedZone);
      }

      if (!closed && !stopped) {
        sendEvent({
          type: 'status',
          totalFound: seen.size,
          message: `Diamond 300-Node OpenStreetMap Deep Sweep (15km around ${subCity})…`
        });
        try {
          const osmDeep = await searchOverpassFallback(cleanIndustry, subCity, 300, 15000);
          const taggedOsm = osmDeep.map((it, idx) => ({
            ...it,
            searchRank: it.searchRank || (220 + idx),
            searchPage: 23,
            discoveryProvider: 'OpenStreetMap Deep'
          }));
          if (taggedOsm.length) await emitBusinesses(taggedOsm);
        } catch {}
      }
    }
  }

  if (seen.size === 0 && !closed && !stopped) {
    sendEvent({ type: 'status', message: 'Checking OpenStreetMap fallback…', totalFound: 0 });
    try {
      const fallbackItems = await searchOverpassFallback(cleanIndustry, cleanCity, tierLevel >= 5 ? 300 : 100, tierLevel >= 5 ? 15000 : 6000);
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
    mode: ['online', 'both'].includes(values.mode) ? values.mode : 'local',
    locations: String(values.locations || '').slice(0, 500),
    terms: String(values.terms || '').slice(0, 350),
    platform: Object.hasOwn(platformDomains, values.platform) ? values.platform : '',
    sources: values.mode !== 'both' && ['combined', 'google', 'tavily', 'maps', 'places'].includes(values.sources) ? values.sources : 'combined',
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
  return webDiscoveryItems(data.organic || [], 'Google web', query, term, city);
}

async function tavilyDiscovery(query, term, city) {
  const includeDomains = [...query.matchAll(/(?:^|\s)site:([a-z0-9.-]+)(?=\s|$)/gi)].map(match => match[1]);
  const phrase = query.replace(/(?:^|\s)site:[a-z0-9.-]+(?=\s|$)/gi, ' ')
    .replace(/\s+-\S+/g, '').trim() || [term, city].filter(Boolean).join(' ');
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.TAVILY_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: phrase.slice(0, 400), search_depth: 'basic', max_results: 10,
      ...(includeDomains.length ? { include_domains: includeDomains } : {})
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('Tavily web search returned HTTP ' + response.status + '.');
  const data = await response.json();
  if (!Array.isArray(data.results)) throw new Error('Tavily returned an unexpected search response.');
  return webDiscoveryItems(data.results, 'Tavily web', query, term, city);
}

function webDiscoveryItems(results, provider, query, term, city) {
  return results.flatMap(result => {
    const url = publicWebsite(result?.url || result?.link);
    if (!url) return [];
    const identity = websiteIdentity(url);
    return [{
      id: 'web:' + identity,
      name: result.title || url.hostname, website: identity.includes('/') ? url.href : url.origin, source: url.href,
      industry: term, city, discoveryQuery: query, discoveryProvider: provider
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
  const web = ['google', 'tavily', 'combined'].includes(options.sources);
  const useTavily = options.sources === 'tavily' ||
    (options.sources === 'combined' && Boolean(process.env.TAVILY_API_KEY?.trim()));
  const webKey = useTavily ? process.env.TAVILY_API_KEY?.trim() : process.env.SERPER_API_KEY?.trim();
  const webLabel = useTavily ? 'Tavily' : 'Google';
  const maps = !online && ['maps', 'combined'].includes(options.sources);
  const places = !online && ['places', 'combined'].includes(options.sources);
  if (options.sources === 'places' && (!places || !process.env.GOOGLE_PLACES_API_KEY)) {
    fail(503, 'Google Places requires a local search and GOOGLE_PLACES_API_KEY.');
  }
  if (['tavily', 'google'].includes(options.sources) && !webKey && !urls.length) {
    fail(503, 'Set ' + (useTavily ? 'TAVILY_API_KEY' : 'SERPER_API_KEY') + ' to enable this web search source.');
  }
  if (!(maps || urls.length || (web && webKey) || (places && process.env.GOOGLE_PLACES_API_KEY))) {
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
      const webResult = ['Google web', 'Tavily web'].includes(item.discoveryProvider);
      if (webResult && domain && mapDomains.has(domain)) continue;
      const keys = businessKeys(item, online || webResult || item.discoveryProvider === 'Imported URL');
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
    if (web && !webKey) {
      send({ type: 'query', message: 'Web search is unconfigured. Set TAVILY_API_KEY or SERPER_API_KEY, open the Google links, or paste website URLs.' });
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
    if (web && webKey) {
      const discoverWeb = useTavily ? tavilyDiscovery : googleDiscovery;
      const custom = options.queries.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 12);
      const queries = custom.length ? custom.map(query => ({ query, term: industry, location: city })) :
        pairs.flatMap(({ term, location }) => googleQueries(term, location, options.platform, options.mode)
          .map(query => ({ query, term, location }))).slice(0, 12);
      for (const { query, term, location } of queries) {
        if (stopped) break;
        await run(webLabel + ' · ' + query, () => discoverWeb(query, term, location));
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

const ignoredEmailDomains = new Set([
  'example.com', 'example.org', 'domain.com', 'yourdomain.com', 'email.com',
  'sentry.io', 'sentry.wixpress.com', 'wixpress.com', 'cloudflare.com',
  'shopify.com', 'myshopify.com', 'klaviyo.com', 'w3.org', 'schema.org', 'googleapis.com'
]);
const ignoredExtensions = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|eot|ico|pdf|mp4|mp3|zip)$/i;

export function decodeCloudflareEmail(encodedHex = '') {
  const clean = String(encodedHex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6,200}$/.test(clean) || clean.length % 2 !== 0) return '';
  const key = parseInt(clean.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16) ^ key);
  }
  return out.trim().toLowerCase();
}

export function rankDiscoveredEmails(emails = [], siteHostname = '') {
  const cleanSiteHost = String(siteHostname || '').toLowerCase().replace(/^www\./, '');
  const scoreEmail = addr => {
    const [local = '', domain = ''] = String(addr || '').toLowerCase().split('@');
    let score = 50;
    if (cleanSiteHost && (domain === cleanSiteHost || domain.endsWith('.' + cleanSiteHost))) score += 30;
    if (/^(founder|owner|ceo|hello|hi|contact|sales|inquiries|enquiries|projects|studio|booking|team)$/.test(local)) score += 20;
    else if (/^[a-z]{2,18}(\.[a-z]{2,18})?$/.test(local) && !/^(info|support|admin|help|office|mail)$/.test(local)) score += 25;
    if (/^(noreply|no-reply|donotreply|do-not-reply|bounce|mailer-daemon|privacy|legal|abuse|dmca|postmaster)/.test(local)) score -= 60;
    return score;
  };
  return [...new Set(emails)].sort((a, b) => scoreEmail(b) - scoreEmail(a));
}

export function extractEmailsFromHtml(html = '', siteHostname = '') {
  const found = new Set();
  const addCandidate = candidate => {
    let raw = String(candidate || '');
    try { raw = decodeURIComponent(raw); } catch {}
    const cleaned = decodeHtmlEntities(raw)
      .replace(/^mailto:/i, '')
      .split('?')[0]
      .trim()
      .replace(/^[<([{"']+|[.,;:'")\]}>]+$/g, '')
      .toLowerCase();
    if (!validEmail(cleaned) || ignoredExtensions.test(cleaned)) return;
    const [local, domain] = cleaned.split('@');
    if (!local || !domain || local.length > 64) return;
    if (/^\d+x\d+$/.test(local) || ignoredEmailDomains.has(domain)) return;
    for (const bad of ignoredEmailDomains) {
      if (domain.endsWith('.' + bad)) return;
    }
    found.add(cleaned);
  };

  // 1. Direct mailto: links
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"'>\s]+)/gi)) {
    addCandidate(match[1]);
  }
  // 2. Cloudflare Email Protection ([data-cfemail] & /cdn-cgi/l/email-protection#...)
  for (const match of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-fA-F]{6,200})["']/gi)) {
    addCandidate(decodeCloudflareEmail(match[1]));
  }
  for (const match of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]{6,200})/gi)) {
    addCandidate(decodeCloudflareEmail(match[1]));
  }
  // 3. Schema.org JSON-LD ContactPoint / Organization email
  for (const match of html.matchAll(/"email"\s*:\s*"([^"]{5,160})"/gi)) {
    addCandidate(match[1]);
  }
  // 4. Plain text + De-obfuscated ([at] / (at) / [dot]) emails
  const decodedText = decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*/gi, '@')
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\})\s*/gi, '.');
  for (const match of decodedText.matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)) {
    addCandidate(match[0]);
  }
  return rankDiscoveredEmails([...found], siteHostname);
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
    ['Klaviyo', /klaviyo[.]com|klaviyo[.]js|_learnq/i],
    ['Omnisend', /omnisend[.]com|omnisnippet/i],
    ['Brevo', /sibforms[.]com|sibautomation[.]com|brevo[.]com/i],
    ['ActiveCampaign', /activehosted[.]com|trackcmp[.]net/i],
    ['Drip', /dc[.]getdrip[.]com|_dcq/i],
    ['Privy', /widget[.]privy[.]com/i],
    ['GetResponse', /app[.]getresponse[.]com/i],
    ['Constant Contact', /constantcontact[.]com|ctctcdn[.]com/i],
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

  const resolveAsset = raw => {
    const clean = decodeHtmlEntities(String(raw || '').trim());
    if (!clean || clean.startsWith('data:image/svg+xml') || clean.length > 500) return '';
    try {
      const u = new URL(clean, urlStr || 'https://example.com');
      return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
    } catch { return ''; }
  };

  // Extract business logo in priority order: Apple Touch Icon -> JSON-LD logo -> Header Logo <img> -> Favicon -> og:image
  const appleIconMatch =
    html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i);
  const jsonLdLogoMatch = html.match(/"logo"\s*:\s*(?:"([^"]+)"|\{\s*[^}]*"url"\s*:\s*"([^"]+)")/i);
  const imgLogoMatch = html.match(/<img\b[^>]*(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["'][^>]*src=["']([^"']+)["']/i)
    || html.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*(?:class|id|alt)=["'][^"']*\blogo\b[^"']*["']/i);
  const faviconMatch =
    html.match(/<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*\bicon\b[^"']*["']/i);
  const ogImgMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

  const ogImage = resolveAsset(ogImgMatch?.[1]) || '';
  const logoUrl =
    resolveAsset(appleIconMatch?.[1]) ||
    resolveAsset(jsonLdLogoMatch?.[1] || jsonLdLogoMatch?.[2]) ||
    resolveAsset(imgLogoMatch?.[1]) ||
    resolveAsset(faviconMatch?.[1]) ||
    ogImage ||
    '';

  // Extract up to 6 meaningful website images (hero banners, portfolio/product photos, content visuals)
  const siteImages = [];
  const seenImgUrls = new Set([logoUrl, ogImage].filter(Boolean));
  for (const imgTagMatch of html.matchAll(/<img\b([^>]+)>/gi)) {
    const attrs = imgTagMatch[1] || '';
    const rawSrc = attrs.match(/\b(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const resolved = resolveAsset(rawSrc);
    if (!resolved || seenImgUrls.has(resolved)) continue;
    if (/(1x1|pixel|spacer|blank\.gif|gravatar|wp-smiley|emoji|\.svg(?:\?|$)|badge|icon[-_])/i.test(resolved)) continue;
    const widthAttr = Number(attrs.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
    const heightAttr = Number(attrs.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] || 0);
    if ((widthAttr > 0 && widthAttr < 48) || (heightAttr > 0 && heightAttr < 48)) continue;
    const altRaw = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    const alt = decodeHtmlEntities((altRaw || '').replace(/\s+/g, ' ').trim()).slice(0, 120);
    seenImgUrls.add(resolved);
    siteImages.push({
      url: resolved,
      alt: alt || '',
      missingAlt: !alt
    });
    if (siteImages.length >= 6) break;
  }

  // Extract up to 8 key navigation / action links on the website
  const keyLinks = [];
  const seenLinkUrls = new Set();
  for (const aMatch of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = aMatch[1];
    const label = decodeHtmlEntities(aMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 60);
    if (!label || label.length < 2) continue;
    try {
      const u = new URL(rawHref, urlStr || 'https://example.com');
      if (!['http:', 'https:'].includes(u.protocol) || seenLinkUrls.has(u.href)) continue;
      if (/(javascript:|mailto:|tel:|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|youtube\.com)/i.test(u.href)) continue;
      seenLinkUrls.add(u.href);
      keyLinks.push({ label, url: u.href });
      if (keyLinks.length >= 8) break;
    } catch {}
  }

  // Extract Schema.org JSON-LD @type entities, CTA buttons, and render-blocking head scripts for deep audit documentation
  const schemaTypes = [];
  for (const sm of html.matchAll(/"@type"\s*:\s*"([A-Za-z0-9_-]{3,40})"/g)) {
    if (!schemaTypes.includes(sm[1])) schemaTypes.push(sm[1]);
    if (schemaTypes.length >= 6) break;
  }

  const ctaButtons = [];
  const ctaPattern = /\b(book|schedule|appointment|quote|estimate|shop|order|buy|subscribe|join|contact|call|demo|trial|consult|enquire|inquire)\b/i;
  for (const bm of html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)) {
    const label = decodeHtmlEntities(bm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (label.length >= 4 && label.length <= 42 && ctaPattern.test(label) && !ctaButtons.includes(label)) {
      ctaButtons.push(label);
      if (ctaButtons.length >= 6) break;
    }
  }

  const headBlock = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] || '';
  const blockingScriptUrls = [];
  for (const sc of headBlock.matchAll(/<script\b([^>]+)>/gi)) {
    const tagAttrs = sc[1] || '';
    if (/\b(?:async|defer|type\s*=\s*["']module["']|type\s*=\s*["']application\/ld\+json["'])\b/i.test(tagAttrs)) continue;
    const srcRaw = tagAttrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const resolvedSrc = resolveAsset(srcRaw);
    if (resolvedSrc && !blockingScriptUrls.includes(resolvedSrc)) {
      blockingScriptUrls.push(resolvedSrc);
      if (blockingScriptUrls.length >= 5) break;
    }
  }

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
    logoUrl,
    ogImage,
    siteImages,
    keyLinks,
    schemaTypes,
    ctaButtons,
    blockingScriptUrls,
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Job Hunta/1.1)', Accept: 'application/json' },
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
      price: String(p.variants?.[0]?.price || ''),
      image: String(p.images?.[0]?.src || ''),
      url: p.handle ? new URL('/products/' + p.handle, originUrl).href : ''
    })).filter(p => p.title);
  } catch {
    return [];
  }
}

async function fetchWebsiteEmails(websiteUrl) {
  const base = await assertSafePublicUrl(websiteUrl);
  let homepageMeta = { status: 200, ttfbMs: 0, headers: {} };
  const fetchHtml = async (url, captureMeta = false) => {
    let target = await assertSafePublicUrl(String(url));
    let response;
    const t0 = Date.now();
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
    if (captureMeta && response) {
      homepageMeta = {
        status: response.status,
        ttfbMs: Date.now() - t0,
        headers: Object.fromEntries(response.headers.entries())
      };
    }
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return '';
    const text = await response.text();
    return text.slice(0, 350000);
  };

  let homepageHtml = '';
  try {
    homepageHtml = await fetchHtml(base.href, true);
  } catch {
    fail(502, 'Could not reach the business website.');
  }
  const emails = new Set(extractEmailsFromHtml(homepageHtml, base.hostname));
  const emailSources = Object.fromEntries([...emails].map(email => [email, base.href]));
  let contactPage = '';
  let contactFormSource = '';
  let phone = '';
  let phoneSource = '';
  function collectContactDetails(html, source) {
    if (!phone) {
      const phoneLink = html.match(/href\s*=\s*["']tel:([+\d().\s-]{7,35})["']/i)?.[1]?.trim()
        || html.match(/"telephone"\s*:\s*"([+\d().\s-]{7,35})"/i)?.[1]?.trim();
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

  const crawledPages = homepageHtml ? [base.href] : [];
  const intermediaryInfo = classifyRentedOrIntermediaryUrl(base.href);
  let channelResolution = null;

  if (homepageHtml && intermediaryInfo.isIntermediary) {
    const NON_STANDALONE_OUTBOUND = /(?:facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|youtube\.com|wa\.me|whatsapp\.com|t\.me|calendly\.com|acuityscheduling\.com|paypal\.com|venmo\.com|cash\.app|stripe\.com|apple\.com|play\.google\.com|spotify\.com|amazon\.com|goo\.gl|bit\.ly)/i;
    const outboundBioLinks = [];
    let standaloneCandidate = null;

    for (const m of homepageHtml.matchAll(/href\s*=\s*["'](https?:\/\/[^"'#\s]+)["']/gi)) {
      try {
        const outUrl = new URL(decodeHtmlEntities(m[1]));
        const outHost = outUrl.hostname.toLowerCase().replace(/^www\./, '');
        if (outHost === base.hostname.toLowerCase().replace(/^www\./, '')) continue;
        if (!outboundBioLinks.includes(outUrl.href) && outboundBioLinks.length < 10) {
          outboundBioLinks.push(outUrl.href);
        }
        if (!standaloneCandidate &&
            !NON_STANDALONE_OUTBOUND.test(outHost) &&
            !isNoiseDirectoryDomain(outHost) &&
            !classifyRentedOrIntermediaryUrl(outUrl.href).isIntermediary) {
          standaloneCandidate = outUrl;
        }
      } catch {}
    }

    if (standaloneCandidate) {
      try {
        const hopHtml = await fetchHtml(standaloneCandidate.origin, true);
        if (hopHtml) {
          crawledPages.push(standaloneCandidate.origin);
          homepageHtml = hopHtml;
          collectContactDetails(hopHtml, standaloneCandidate.origin);
          for (const email of extractEmailsFromHtml(hopHtml, standaloneCandidate.hostname)) {
            emails.add(email);
            emailSources[email] ||= standaloneCandidate.origin;
          }
          const hopSocials = extractSocialsFromHtml(hopHtml);
          for (const key of Object.keys(socials)) {
            if (!socials[key] && hopSocials[key]) socials[key] = hopSocials[key];
          }
          const hopInsights = extractWebsiteInsights(hopHtml, standaloneCandidate.origin);
          Object.assign(insights, hopInsights);
          channelResolution = {
            intermediaryKind: intermediaryInfo.kind,
            listingUrl: base.href,
            resolvedStandaloneWebsite: standaloneCandidate.origin,
            hasStandaloneSite: true,
            outboundBioLinks
          };
        }
      } catch {}
    }

    if (!channelResolution) {
      insights.signals.rentedPlatformOnly = true;
      channelResolution = {
        intermediaryKind: intermediaryInfo.kind,
        listingUrl: base.href,
        resolvedStandaloneWebsite: '',
        hasStandaloneSite: false,
        outboundBioLinks
      };
    }
  }

  if (homepageHtml) {
    const subLinks = [...homepageHtml.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)]
      .map(match => match[1])
      .filter(href => /(contact|about|team|our-story|who-we-are|impressum|get-in-touch|reach-us|pages\/contact|pages\/about|policies\/contact-information)/i.test(href));
    if (insights.platform === 'Shopify') {
      subLinks.unshift('/policies/contact-information', '/pages/contact');
    }
    const uniqueSubUrls = [];
    for (const href of subLinks) {
      try {
        const subUrl = new URL(href, base.href);
        if (subUrl.hostname === base.hostname && subUrl.href !== base.href &&
            ['http:', 'https:'].includes(subUrl.protocol) && !uniqueSubUrls.includes(subUrl.href)) {
          uniqueSubUrls.push(subUrl.href);
          if (uniqueSubUrls.length >= 4) break;
        }
      } catch {
        // Ignore invalid sublink
      }
    }
    for (const subHref of uniqueSubUrls) {
      try {
        const subHtml = await fetchHtml(subHref);
        if (subHtml) crawledPages.push(subHref);
        collectContactDetails(subHtml, subHref);
        if (subHtml && /contact|get-in-touch|reach-us|impressum/i.test(subHref)) contactPage ||= subHref;
        for (const email of extractEmailsFromHtml(subHtml, base.hostname)) {
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

  // Passive technical, SEO, performance & security hygiene checks (robots.txt, sitemap.xml, sample link/asset status)
  const probeStatus = async targetHref => {
    try {
      const safeTarget = await assertSafePublicUrl(targetHref);
      const r = await fetch(safeTarget, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobhuntaAuditor/1.1)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(3200)
      });
      return r.status;
    } catch {
      return 0;
    }
  };

  let robotsTxtOk = true;
  let sitemapXmlOk = true;
  const brokenLinks = [];
  const brokenAssets = [];

  if (homepageHtml) {
    const sampleLinks = [];
    for (const m of homepageHtml.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
      try {
        const u = new URL(m[1], base.href);
        if (u.hostname === base.hostname && ['http:', 'https:'].includes(u.protocol) && u.href !== base.href && !sampleLinks.includes(u.href)) {
          sampleLinks.push(u.href);
          if (sampleLinks.length >= 3) break;
        }
      } catch {}
    }
    const sampleAssets = [];
    for (const m of homepageHtml.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)) {
      if (m[1].startsWith('data:')) continue;
      try {
        const u = new URL(m[1], base.href);
        if (u.hostname === base.hostname && ['http:', 'https:'].includes(u.protocol) && !sampleAssets.includes(u.href)) {
          sampleAssets.push(u.href);
          if (sampleAssets.length >= 3) break;
        }
      } catch {}
    }

    const [robStatus, siteStatus, ...probeResults] = await Promise.all([
      probeStatus(new URL('/robots.txt', base.origin).href),
      probeStatus(new URL('/sitemap.xml', base.origin).href),
      ...sampleLinks.map(async u => ({ kind: 'link', url: u, status: await probeStatus(u) })),
      ...sampleAssets.map(async u => ({ kind: 'asset', url: u, status: await probeStatus(u) }))
    ]);
    robotsTxtOk = robStatus >= 200 && robStatus < 400;
    sitemapXmlOk = siteStatus >= 200 && siteStatus < 400;
    for (const p of probeResults) {
      if (p.status >= 400) {
        if (p.kind === 'link') brokenLinks.push({ url: p.url, status: p.status });
        else brokenAssets.push({ url: p.url, status: p.status });
      }
    }
  }

  const auditReport = analyzePageAudit({
    url: base.href,
    status: homepageMeta.status,
    ttfbMs: homepageMeta.ttfbMs,
    headers: homepageMeta.headers,
    html: homepageHtml,
    robotsTxtOk,
    sitemapXmlOk,
    brokenLinks,
    brokenAssets
  });

  const mergedTech = [...new Set([...(insights.techStack || []), ...(auditReport.stack?.techStack || [])])];
  const detectedPlat = (insights.platform && insights.platform !== 'Custom / Website')
    ? insights.platform
    : (auditReport.stack?.platform || insights.platform);

  const rankedEmails = rankDiscoveredEmails([...emails], channelResolution?.resolvedStandaloneWebsite ? new URL(channelResolution.resolvedStandaloneWebsite).hostname : base.hostname);
  return {
    website: channelResolution?.resolvedStandaloneWebsite || base.href,
    channelResolution,
    brandName: insights.brandName || insights.siteTitle?.split(/[|\-–—]/)[0]?.trim() || base.hostname.replace(/^www\./, ''),
    logoUrl: insights.logoUrl || '',
    ogImage: insights.ogImage || '',
    siteImages: insights.siteImages || [],
    keyLinks: insights.keyLinks || [],
    schemaTypes: insights.schemaTypes || [],
    ctaButtons: insights.ctaButtons || [],
    blockingScriptUrls: insights.blockingScriptUrls || [],
    serverMeta: {
      status: homepageMeta.status,
      ttfbMs: homepageMeta.ttfbMs,
      serverHeader: homepageMeta.headers?.server || '',
      cacheControl: homepageMeta.headers?.['cache-control'] || '',
      hasHsts: Boolean(homepageMeta.headers?.['strict-transport-security']),
      hasCsp: Boolean(homepageMeta.headers?.['content-security-policy']),
      hasXFrameOptions: Boolean(homepageMeta.headers?.['x-frame-options']),
      auditedAt: new Date().toISOString()
    },
    crawledPages,
    robotsTxtUrl: new URL('/robots.txt', base.origin).href,
    robotsTxtOk,
    sitemapXmlUrl: new URL('/sitemap.xml', base.origin).href,
    sitemapXmlOk,
    brokenLinks,
    brokenAssets,
    emails: rankedEmails,
    emailSources,
    contactPage,
    contactFormSource,
    phone,
    phoneSource,
    email: rankedEmails[0] || '',
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
    platform: detectedPlat,
    platformEvidence: insights.platformEvidence?.length ? insights.platformEvidence : (auditReport.stack?.evidence || []),
    platformConfidence: insights.platformConfidence,
    techStack: mergedTech,
    shopifyMeta: insights.shopifyMeta || auditReport.stack?.shopifyMeta || null,
    shopifyProducts,
    signals: insights.signals,
    auditReport
  };
}

export function buildLeadIntelligence(lead = {}, senderSettings = {}, userIssues = '', extraContext = '', tierLevel = 5) {
  const name = lead.name || 'this business';
  const industry = lead.industry || 'local business';
  const city = lead.city || 'their area';
  const { persona, hasExplicitPersona, activeModules, addedTools } = getActivePersonaModules(senderSettings, tierLevel);
  const senderName = senderSettings.senderName || '[your name]';
  const senderService = senderSettings.senderService || persona.defaultService || 'digital growth, lead capture, and client acquisition';
  const spottedList = (Array.isArray(userIssues) ? userIssues : String(userIssues || '').split(/[\r\n;]+/))
    .map(s => s.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const cleanExtra = String(extraContext || '').trim().slice(0, 1500);

  const socialChannels = [
    lead.facebook && 'Facebook',
    lead.instagram && 'Instagram',
    lead.twitter && 'X/Twitter',
    lead.linkedin && 'LinkedIn',
    lead.youtube && 'YouTube',
    lead.tiktok && 'TikTok'
  ].filter(Boolean);

  const allSocialChannels = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'X/Twitter', 'YouTube'];
  const missingSocials = allSocialChannels.filter(ch => !socialChannels.includes(ch));
  const ratingNum = parseFloat(lead.rating);
  const signals = lead.signals || {};
  const auditReport = lead.auditReport || null;
  const activeLensLabel = `${persona.title}${addedTools.length ? ` + ${addedTools.map(k => PERSONA_TOOL_MODULES[k]?.shortLabel).filter(Boolean).join(', ')}` : ''}`;

  const cm = lead.channelMeta || {};
  const overviewParts = [
    lead.redditMeta
      ? `${name} posted in r/${lead.redditMeta.subreddit} (${lead.redditMeta.intentType}${lead.redditMeta.budgetHint ? ` · Budget: ${lead.redditMeta.budgetHint}` : ''}): "${lead.redditMeta.postTitle}".`
      : cm.channel === 'new_domain'
        ? `${name} is a newly registered business domain (${cm.certIssuedAt ? `SSL issued ${cm.certIssuedAt} via Certificate Transparency` : 'discovered via crt.sh SSL logs'}) in the ${industry} space.`
        : cm.channel === 'job_board'
          ? `${name} is actively hiring (${cm.openRole || industry}) on ${lead.discoveryProvider || 'their job board'} — proving active budget and immediate growth needs.`
          : (cm.channel === 'link_in_bio' || cm.channel === 'directory' || cm.channel === 'social_only')
            ? `${name} operates in ${city} primarily through ${cm.rentedPlatform || lead.platform || 'a rented directory/social profile'}${cm.hasStandaloneSite === false ? ' without a dedicated standalone website' : ''}.`
            : `${name} operates as a ${industry} in ${city}${lead.address ? ` (${lead.address})` : ''}.`
  ];
  if (lead.redditMeta?.postSnippet) {
    overviewParts.push(`Reddit request summary: "${lead.redditMeta.postSnippet.slice(0, 260)}".`);
  }
  if (activeModules.has('seo_local') && lead.searchRank) {
    overviewParts.push(`Current Bing Search Position: Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}).`);
  }
  if (activeModules.has('web_tech') || activeModules.has('ecommerce_cro')) {
    if (lead.platform && lead.platform !== 'Custom / Website') {
      overviewParts.push(`Website platform: ${lead.platform}${lead.shopifyMeta?.themeName ? ` (Theme: ${lead.shopifyMeta.themeName})` : ''}${lead.shopifyMeta?.currency ? ` [${lead.shopifyMeta.currency}]` : ''}.`);
    } else if (lead.website) {
      overviewParts.push(`Website: ${lead.website}.`);
    } else {
      overviewParts.push('Website: No official website linked.');
    }
    if (auditReport?.overallScore !== undefined) {
      overviewParts.push(`Website Audit Health Score: ${auditReport.overallScore}/100 (${auditReport.counts?.critical || 0} critical, ${auditReport.counts?.warning || 0} warnings${auditReport.ttfbMs ? `, ${auditReport.ttfbMs}ms TTFB` : ''}).`);
    }
  }
  if (activeModules.has('ecommerce_cro') && Array.isArray(lead.shopifyProducts) && lead.shopifyProducts.length) {
    overviewParts.push(`Catalog sample: ${lead.shopifyProducts.slice(0, 4).map(p => `${p.title}${p.price ? ` ($${p.price})` : ''}`).join(', ')}.`);
  }
  if ((activeModules.has('web_tech') || activeModules.has('ads_funnel') || activeModules.has('ecommerce_cro')) && Array.isArray(lead.techStack) && lead.techStack.length) {
    overviewParts.push(`Detected tech stack: ${lead.techStack.join(', ')}.`);
  }
  if (activeModules.has('social_brand')) {
    if (socialChannels.length) {
      overviewParts.push(`Active social channels: ${socialChannels.join(', ')} (missing: ${missingSocials.join(', ') || 'none'}).`);
    } else {
      overviewParts.push('Social media presence: None linked on website or listing.');
    }
  }
  if (activeModules.has('seo_local')) {
    if (lead.siteTitle || lead.metaDescription) {
      overviewParts.push(`Website positioning: "${lead.siteTitle || lead.metaDescription}".`);
    }
    if (lead.headings?.length) {
      overviewParts.push(`Key headings: ${lead.headings.slice(0, 4).join(' | ')}.`);
    }
    if (lead.rating) {
      overviewParts.push(`Listed rating: ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}.`);
    } else {
      overviewParts.push('Listed rating: No star rating or customer reviews displayed.');
    }
    if (lead.openHours) {
      overviewParts.push(`Operating hours: ${lead.openHours}.`);
    }
  }
  if (lead.phone || lead.email) {
    overviewParts.push(`Direct contacts found: ${[lead.email && `Email (${lead.email})`, lead.phone && `Phone (${lead.phone})`].filter(Boolean).join(', ')}.`);
  }

  const gaps = [];
  if (cm.channel === 'link_in_bio' || cm.channel === 'directory' || cm.channel === 'social_only' || signals.rentedPlatformOnly) {
    if (cm.hasStandaloneSite === false || signals.rentedPlatformOnly) {
      gaps.push(`Relying on Rented Platform (${cm.rentedPlatform || lead.platform || 'Link-in-Bio / Directory'}): Customers currently land on a third-party profile instead of a branded, Google-indexed website you own — losing organic search traffic and paying platform commissions.`);
    }
  }
  if (cm.channel === 'new_domain') {
    gaps.push(`Brand-New Domain Launch Readiness (${cm.certIssuedAt || 'Recent SSL'}): Newly registered domains need immediate technical SEO indexing, mobile conversion UX, and trust proof so early visitors convert.`);
  }
  if (cm.channel === 'job_board' && cm.openRole) {
    gaps.push(`Active Hiring Bottleneck (${cm.openRole}): Instead of waiting months to onboard full-time headcount, key ${persona.label.toLowerCase()} deliverables can be shipped immediately with faster ROI.`);
  }
  if (activeModules.has('seo_local')) {
    if (lead.searchRank && lead.searchRank > 10) {
      gaps.push(`Local Search Visibility: Buried at Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}) in search for "${industry} in ${city}" — losing high-intent local buyers to Page 1 competitors.`);
    } else if (lead.searchRank) {
      gaps.push(`Search Capture Opportunity: Ranked #${lead.searchRank} in ${city}, meaning competitors right alongside you are competing for the same clicks if your landing page & local SEO don’t convert immediately.`);
    }
    if (lead.website && signals.hasMetaDescription === false) {
      gaps.push('SEO Meta Description Missing: Missing <meta name="description"> on your website, reducing organic click-through rates from Google and Bing.');
    }
    if (!lead.rating || (!Number.isNaN(ratingNum) && ratingNum < 4.4)) {
      gaps.push(`Local Reputation & Review Volume: ${lead.rating ? `Current listed rating is ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}` : 'No star rating or customer reviews displayed on your map listing'} — strengthening visible review proof will lift local click-through.`);
    }
    if (!lead.openHours) {
      gaps.push('Missing Operating Hours on Listing: Operating hours are not displayed on your map profile, which reduces local pack engagement.');
    }
  }

  if (activeModules.has('web_tech')) {
    if (!lead.website) {
      gaps.push('Missing Official Website: No website is linked on your listing — high-intent customers searching online have no dedicated landing page, catalog, or booking funnel to convert.');
    } else if (signals.https === false) {
      gaps.push('Security & Trust Warning: Website is not using HTTPS security, which triggers browser "Not Secure" warnings and hurts visitor trust.');
    }
  }

  if (activeModules.has('ecommerce_cro')) {
    if (lead.platform === 'Shopify' || lead.platform === 'WooCommerce' || persona.id === 'shopify_cro') {
      if (!signals.hasReviewsApp) {
        gaps.push(`E-Commerce Social Proof (${lead.platform || 'Store'}): Running without a dedicated product review widget (Judge.me, Loox, or Yotpo) to boost product page conversion.`);
      }
      if (!(lead.techStack || []).some(t => /Klaviyo|Omnisend|Mailchimp/i.test(t))) {
        gaps.push(`E-Commerce Retention (${lead.platform || 'Store'}): No automated email/SMS retention stack (Klaviyo / Omnisend) detected for abandoned cart recovery and repeat buyer flows.`);
      }
    }
  }

  if (activeModules.has('ads_funnel')) {
    if (!lead.website) {
      gaps.push('No Dedicated Paid Traffic Landing Page: Missing a conversion-optimized landing page with tracking pixels and lead capture form.');
    } else {
      if (signals.hasBookingOrForm === false) {
        gaps.push('Missing Online Lead Capture / Booking Form: No clear instant quote, booking, or lead capture form detected — forcing visitors to call manually.');
      }
      if (signals.hasChatWidget === false) {
        gaps.push('No Live Chat / WhatsApp Widget: No instant chat or WhatsApp response widget on site to capture mobile and after-hours inquiries.');
      }
      if (signals.hasAnalytics === false) {
        gaps.push('Missing Ad & Conversion Tracking Pixels: No Google Analytics/GTM, Meta Pixel, or TikTok Pixel detected — visitors leave without retargeting or conversion attribution.');
      }
    }
  }

  // Merge multi-layer Website Audit findings filtered strictly to activeModules (smart deduplication, clean human bullets)
  const normalizeGapKey = str => String(str || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(missing|seo|website|on|your|the|a|an|of|is|are|for|and|tag)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const auditFindingDetails = [];
  if (Array.isArray(auditReport?.findings)) {
    const { primary: personaFindings } = filterAuditFindingsForPersona(auditReport.findings, senderSettings, tierLevel);
    for (const f of personaFindings) {
      auditFindingDetails.push({
        title: String(f.title || '').trim(),
        severity: String(f.severity || 'warning').trim(),
        detail: String(f.detail || '').trim(),
        businessImpact: String(f.businessImpact || '').trim(),
        recommendation: String(f.recommendation || '').trim()
      });
      const fKey = normalizeGapKey(f.title);
      const isDup = gaps.some(existing => {
        const eKey = normalizeGapKey(existing);
        return (fKey && eKey.includes(fKey.slice(0, 18))) ||
          (/meta description/i.test(f.title) && /meta description/i.test(existing)) ||
          (/https/i.test(f.title) && /https/i.test(existing));
      });
      if (!isDup) {
        const cleanDetail = String(f.detail || '').trim();
        const cleanImpact = String(f.businessImpact || '').trim();
        const cleanRec = String(f.recommendation || '').trim();
        const parts = [f.title];
        if (cleanDetail) parts.push(cleanDetail);
        if (cleanImpact) parts.push(`Impact: ${cleanImpact}`);
        if (cleanRec) parts.push(`Fix: ${cleanRec}`);
        gaps.push(parts.join(' — '));
      }
    }
  }

  if (activeModules.has('social_brand')) {
    if (socialChannels.length === 0) {
      gaps.push('Lack of Social Media Presence: Zero social media profiles (Instagram, Facebook, LinkedIn, TikTok, X/Twitter, YouTube) are linked from your website — hurting brand credibility and missing organic social traffic.');
    } else if (missingSocials.length) {
      gaps.push(`Incomplete Social Media Footprint: Linked to ${socialChannels.join(', ')}, but missing active/linked presence on ${missingSocials.join(', ')} where local customers discover and vet ${industry.toLowerCase()} brands.`);
    }
  }

  if (!hasExplicitPersona) {
    if (!lead.email) {
      gaps.push('No Public Business Email Listed: Customers and B2B partners cannot easily find a direct email contact on your site or listing.');
    }
    if (!lead.phone) {
      gaps.push('No Direct Phone / Click-to-Call Listed: Missing a visible click-to-call phone number for mobile visitors.');
    }
  }

  if (!gaps.length) {
    gaps.push(`${persona.title} Growth & Conversion Scaling: Opportunity to resolve ${persona.label.toLowerCase()} friction and scale inbound clients via ${senderService}.`);
  }

  const combinedGaps = [
    ...spottedList.map(s => `[Spotted Issue] ${s}`),
    ...gaps.filter(g => !spottedList.some(u => g.toLowerCase().includes(u.toLowerCase())))
  ];

  const foundationPhrases = {
    web_dev: 'website speed, security, and mobile experience',
    digital_marketer: 'ad tracking, retargeting, and lead-capture funnel',
    seo_specialist: 'local search visibility and Google/Bing rankings',
    social_media: 'social media presence and brand authority',
    shopify_cro: 'online store conversion rate and checkout retention',
    full_agency: 'website experience and automated lead-capture funnel'
  };
  const personaRoleIntro = {
    web_dev: 'a Web Developer & UI/UX Designer',
    digital_marketer: 'a Digital Marketer & Funnel Specialist',
    seo_specialist: 'an SEO & Local Ranking Specialist',
    social_media: 'a Social Media & Brand Growth Manager',
    shopify_cro: 'a Shopify & E-Commerce CRO Specialist',
    full_agency: 'a Full-Service Digital Growth Agency'
  };
  const cleanIndustryGroup = /\b(business|store|shop|clinic|agency|company|studio|salon|restaurant|hotel|firm)s?$/i.test(industry)
    ? industry.toLowerCase()
    : `${industry.toLowerCase()} brands`;
  const foundationPhrase = foundationPhrases[persona.id] || 'digital presence';
  const roleIntro = personaRoleIntro[persona.id] || `a ${persona.title}`;

  const angle = `Pitch from the [${activeLensLabel}] lens (${combinedGaps.length} focused findings), avoiding unrelated noise and offering a tailored action plan using ${senderService}.`;

  const specificHook = !lead.website
    ? `I came across ${name} while researching ${cleanIndustryGroup} in ${city}${activeModules.has('seo_local') && lead.searchRank ? ` (currently listed at Rank #${lead.searchRank} on Bing Maps)` : ''}, and noticed you don’t currently have an official website linked for customers searching online`
    : hasExplicitPersona
      ? `As ${roleIntro}, I just reviewed ${name} (${lead.website}${lead.headings?.[0] ? ` — “${lead.headings[0].slice(0, 60)}”` : ''}) in ${city}`
      : lead.headings?.length
        ? `I just completed a full 360° online presence & website review of ${name} (${lead.website} — “${lead.headings[0]}”) in ${city}`
        : `I just completed a full 360° online presence & website review of ${name} (${lead.website}) in ${city}`;

  const snapshotLines = [
    `• Business & Location: ${name} (${industry} in ${city}${lead.address ? ` · ${lead.address}` : ''})`,
    activeModules.has('seo_local')
      ? `• Search & Map Listing: ${lead.searchRank ? `Bing Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)})` : 'Local listing'} · ${lead.rating ? `Rating: ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}` : 'No map reviews displayed'} · ${lead.openHours ? `Hours: ${lead.openHours}` : 'Hours not listed'}`
      : null,
    (activeModules.has('web_tech') || activeModules.has('ecommerce_cro'))
      ? `• Website & Tech Stack: ${lead.website ? `${lead.platform || 'Website'}${lead.shopifyMeta?.themeName ? ` (Theme: ${lead.shopifyMeta.themeName})` : ''}${auditReport?.overallScore !== undefined ? ` · Health Score: ${auditReport.overallScore}/100` : ''}${auditReport?.ttfbMs ? ` · Response Time: ${auditReport.ttfbMs}ms` : ''}` : 'No website linked'}${lead.techStack?.length ? ` · Stack: ${lead.techStack.join(', ')}` : ''}`
      : null,
    activeModules.has('ecommerce_cro') && lead.shopifyProducts?.length
      ? `• Product Catalog Sampled: ${lead.shopifyProducts.slice(0, 3).map(p => `${p.title}${p.price ? ` ($${p.price})` : ''}`).join(', ')}`
      : null,
    activeModules.has('social_brand')
      ? `• Social Media Presence: ${socialChannels.length ? `Linked: ${socialChannels.join(', ')} | Missing: ${missingSocials.join(', ') || 'None'}` : 'No social media profiles (Instagram, Facebook, LinkedIn, TikTok) linked on site'}`
      : null,
    activeModules.has('ads_funnel')
      ? `• Contact & Lead Capture Funnel: ${[signals.hasAnalytics ? 'Ad/Analytics pixels detected' : 'No Meta/TikTok/GA4 pixels detected', signals.hasBookingOrForm ? 'Lead form present' : 'No instant booking/lead form', signals.hasChatWidget ? 'Chat widget active' : 'No live chat/WhatsApp widget'].join(' · ')}`
      : null
  ].filter(Boolean).join('\n');

  const numberedDetailedFindings = combinedGaps.slice(0, 8).map((item, idx) => {
    const cleanText = item.replace(/^\[Spotted Issue\]\s*/i, '');
    return `${idx + 1}. ${cleanText}`;
  }).join('\n\n');
  const extraParagraph = cleanExtra
    ? `${/[.!?]$/.test(cleanExtra) ? cleanExtra : cleanExtra + '.'}\n\n`
    : '';

  const pitchSubject = (hasExplicitPersona
    ? `Detailed ${persona.label} audit report for ${name} (${city})`
    : `Detailed 360° website & digital audit report for ${name} (${city})`
  ).slice(0, 88);

  const pitchBody =
    `Hi ${name} team,\n\n` +
    `${specificHook}. I’m ${senderName}, and I help ${cleanIndustryGroup} grow through ${senderService}.\n\n` +
    `I put together a concise, actionable audit report below so you can see exactly what is working and what is currently costing ${name} qualified leads:\n\n` +
    `CURRENT SNAPSHOT (${activeLensLabel.toUpperCase()}):\n` +
    `${snapshotLines}\n\n` +
    `KEY FINDINGS & RECOMMENDED FIXES (${Math.min(combinedGaps.length, 8)} ITEMS):\n\n` +
    `${numberedDetailedFindings}\n\n` +
    `RECOMMENDED QUICK-WIN ROADMAP:\n` +
    `• Step 1 (Quick Wins): Resolve the highest-impact technical, visibility, or conversion blockers listed above.\n` +
    `• Step 2 (Conversion Upgrade): Strengthen trust signals and streamline how visitors in ${city} inquire or book.\n` +
    `• Step 3 (Tracking & Growth): Verify analytics and performance so every improvement drives measurable ROI.\n\n` +
    extraParagraph +
    `If helpful, I can send over a short 2-minute walkthrough video showing each of these items live on your site, or we can hop on a quick 10-minute call this week.\n\n` +
    `Best regards,\n${senderName}\n${senderService}`;

  const followUpMessage =
    `Hi ${name} team — just floating this back to the top of your inbox in case it got buried. Happy to send over the 2-minute walkthrough on the findings in the audit report for ${name} whenever you have a moment.\n\nBest,\n${senderName}`;

  return {
    personaId: persona.id,
    personaLabel: activeLensLabel,
    activeModuleKeys: [...activeModules],
    aiSource: 'smart-engine',
    overview: overviewParts.join(' '),
    gaps: combinedGaps,
    auditFindingDetails,
    angle,
    pitchSubject,
    pitchBody,
    followUpMessage,
    userIssues: spottedList,
    extraContext: cleanExtra,
    generatedAt: new Date().toISOString()
  };
}

const PERSONA_PROMPT_BLUEPRINTS = {
  web_dev: 'Write like a senior Web Developer & UI/UX Designer. Focus strictly on website design quality, mobile responsiveness, viewport/layout bugs, broken links/forms, server speed (TTFB), and HTTPS/security hygiene.',
  digital_marketer: 'Write like a senior Performance Marketer & Funnel Strategist. Focus strictly on missing ad tracking/retargeting pixels (Meta, TikTok, GA4), missing instant booking/lead capture forms, missing Live Chat/WhatsApp widgets, and converting traffic into booked clients.',
  seo_specialist: 'Write like a senior Local SEO & Search Growth Strategist. Focus strictly on Bing/Google search rank, Page 1 competitor clicks, missing title/meta description/H1/Schema/sitemap, and local map rating/review authority.',
  social_media: 'Write like a senior Social Media & Brand Growth Director. Focus strictly on missing or unlinked Instagram, TikTok, Facebook, LinkedIn, and YouTube profiles, Open Graph social preview cards, brand trust, and turning social viewers into DM inquiries.',
  shopify_cro: 'Write like a senior Shopify & E-Commerce CRO Specialist. Focus strictly on their store theme, product catalog conversion, missing Judge.me/Loox/Yotpo review proof, and Klaviyo/Omnisend abandoned-cart recovery flows.',
  full_agency: 'Write like a senior Digital Growth Agency founder. Focus on connecting a high-converting website with an automated lead capture and tracking funnel.'
};

async function analyzeLeadWithAi(lead, senderSettings, userIssues = '', extraContext = '', tierLevel = 5) {
  const baseline = buildLeadIntelligence(lead, senderSettings, userIssues, extraContext, tierLevel);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return baseline;

  try {
    const { persona, activeModuleKeys, addedTools } = getActivePersonaModules(senderSettings, tierLevel);
    const activeModuleLabels = activeModuleKeys.map(k => PERSONA_TOOL_MODULES[k]?.label).filter(Boolean).join('; ');
    const addedToolLabels = addedTools.map(k => PERSONA_TOOL_MODULES[k]?.label).filter(Boolean).join('; ');
    const excludedModuleLabels = Object.values(PERSONA_TOOL_MODULES)
      .filter(m => !activeModuleKeys.includes(m.key))
      .map(m => m.label)
      .join('; ');
    const blueprint = PERSONA_PROMPT_BLUEPRINTS[persona.id] || PERSONA_PROMPT_BLUEPRINTS.web_dev;
    const addedToolsDirective = addedToolLabels
      ? `\n\nADDED TOOLS ENABLED BY USER (MUST BE INCLUDED): The user explicitly toggled ON these extra Added Tool modules: ${addedToolLabels}. You MUST weave relevant verified findings from BOTH their primary persona (${persona.title}) AND these enabled Added Tools into the overview, gaps, angle, pitchBody, and followUpMessage.`
      : '';

    const userIssuesNote = baseline.userIssues.length
      ? `\n\nPRIORITY — Specific issues personally spotted by the user (MUST be featured prominently):\n${baseline.userIssues.map(i => '- ' + i).join('\n')}`
      : '';
    const extraContextNote = baseline.extraContext
      ? `\n\nPRIORITY — Extra offer/instructions provided by the user (MUST be woven naturally into pitchBody):\n${baseline.extraContext}`
      : '';

    const prompt = `${blueprint}${addedToolsDirective}

STRICT PERSONA & DETAILED REPORT EMAIL RULES:
1. Active Persona: "${persona.title}". Enabled Pitch Modules ONLY: ${activeModuleLabels}.
${excludedModuleLabels ? `2. STRICTLY EXCLUDED (DO NOT mention or pitch these topics): ${excludedModuleLabels}.` : '2. Use all enabled modules cleanly.'}
3. Write in natural, warm, authoritative human B2B prose. NEVER include raw internal log tags like "[BUGS · Critical]" or "[SEO · Warning]". NEVER use placeholder brackets like [your name]. NEVER use markdown asterisks (**) — use clean plain-text section headers in UPPERCASE and numbered items so it looks crisp in Gmail.
4. Reference real details scraped from the company's actual website or listing (e.g., their exact headline, about summary, city, platform, tech stack, health score, search rank, or social channels) so the owner immediately sees a real audit was performed.
5. Keep pitchSubject under 75 characters (clear, executive, non-spammy).
6. Make pitchBody a DETAILED, WELL-STRUCTURED CLIENT AUDIT REPORT EMAIL (320–480 words) using this exact scannable layout:
   - Greeting & Personalized Opener (2–3 sentences referencing their business & what you reviewed)
   - AUDIT SNAPSHOT FOR ${(lead.name || 'YOUR BUSINESS').toUpperCase()}: 3–5 concise "• " metric bullets (only for enabled modules: e.g. Platform/Health Score/Speed, Search Rank/Rating, Social Channels, Lead Capture/Tracking)
   - DETAILED FINDINGS & RECOMMENDED FIXES: A clear numbered list (1., 2., 3., 4., up to 6–8 items covering EVERY major verified finding & any user-spotted issues). For EACH numbered item include:
     • Exact finding & concrete evidence from their site/listing
     • Why it matters (revenue, lead, trust, or visibility impact)
     • Recommended fix (practical action)
   - RECOMMENDED QUICK-WIN PLAN: 3 crisp "• Step 1 / Step 2 / Step 3" bullets showing the priority order to fix them
   - Warm, low-friction CTA (offer a 2-minute walkthrough or brief 10-minute call) & clean sign-off as ${senderSettings?.senderName || 'Outreach Specialist'}.${userIssuesNote}${extraContextNote}

Verified Persona-Filtered Findings (list and explain ALL key ones in the report):
${JSON.stringify(baseline.gaps, null, 2)}

Detailed Technical Audit Evidence (use exact numbers, details & fix recommendations where relevant):
${JSON.stringify((baseline.auditFindingDetails || []).slice(0, 8), null, 2)}

Scraped Company Intelligence:
${JSON.stringify({
      name: lead.name,
      industry: lead.industry,
      city: lead.city,
      address: lead.address,
      website: lead.website,
      siteTitle: lead.siteTitle,
      headings: (lead.headings || []).slice(0, 3),
      aboutSummary: (lead.aboutSummary || '').slice(0, 350),
      platform: lead.platform,
      techStack: lead.techStack,
      shopifyMeta: lead.shopifyMeta,
      shopifyProducts: (lead.shopifyProducts || []).slice(0, 3),
      searchRank: lead.searchRank,
      rating: lead.rating,
      ratingInfo: lead.ratingInfo,
      openHours: lead.openHours,
      socialChannels: [lead.facebook && 'Facebook', lead.instagram && 'Instagram', lead.twitter && 'X/Twitter', lead.linkedin && 'LinkedIn', lead.youtube && 'YouTube', lead.tiktok && 'TikTok'].filter(Boolean),
      signals: lead.signals || {},
      auditScore: lead.auditReport?.overallScore ?? null,
      ttfbMs: lead.auditReport?.ttfbMs ?? null
    })}

Sender Profile:
Name: ${senderSettings?.senderName || 'Outreach Specialist'}
Persona: ${persona.title}
Service Offered: ${senderSettings?.senderService || persona.defaultService}`;

    const responseSchema = {
      type: 'OBJECT',
      properties: {
        overview: { type: 'STRING' },
        gaps: { type: 'ARRAY', items: { type: 'STRING' } },
        angle: { type: 'STRING' },
        pitchSubject: { type: 'STRING' },
        pitchBody: { type: 'STRING' },
        followUpMessage: { type: 'STRING' }
      },
      required: ['overview', 'gaps', 'angle', 'pitchSubject', 'pitchBody', 'followUpMessage']
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0.6
        }
      }),
      signal: AbortSignal.timeout(24000)
    });
    if (!response.ok) return baseline;
    const result = await response.json();
    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(rawText);
    return {
      personaId: baseline.personaId,
      personaLabel: baseline.personaLabel,
      activeModuleKeys: baseline.activeModuleKeys,
      aiSource: 'gemini-2.5-flash',
      overview: String(parsed.overview || baseline.overview),
      gaps: Array.isArray(parsed.gaps) && parsed.gaps.length ? parsed.gaps.map(String) : baseline.gaps,
      angle: String(parsed.angle || baseline.angle),
      pitchSubject: String(parsed.pitchSubject || baseline.pitchSubject).slice(0, 150),
      pitchBody: String(parsed.pitchBody || baseline.pitchBody),
      followUpMessage: String(parsed.followUpMessage || baseline.followUpMessage),
      userIssues: baseline.userIssues,
      extraContext: baseline.extraContext,
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
      let content = await readFile(new URL('./public/' + file, import.meta.url));
      if (path === '/') {
        const rawUserCookie = req.headers.cookie?.match(/(?:^|;\s*)jobhunta_user=([\w.-]+)/)?.[1] || '';
        const cookieUser = unsealCookie(rawUserCookie);
        const bodyClass = (cookieUser?.id && cookieUser?.email) ? '' : 'auth-locked';
        content = Buffer.from(content.toString('utf8').replace('class="auth-checking"', bodyClass ? `class="${bodyClass}"` : ''), 'utf8');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(content);
    }
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== reqOrigin) {
      fail(403, 'Open Job Hunta directly to submit this request.');
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
      session = { expires: Date.now() + maxAge, sends: new Map() };
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
      const user = { id: record.id, email: record.email, name: record.name || '', tier: usage.tier, createdAt: record.created_at || null, usage };
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
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
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
          const adv = getAdvancedSearchUsage(session.userId, usage);
          usage.advancedSearchesToday = adv.used;
          usage.dailyAdvancedSearchLimit = adv.limit;
          activeUser = { id: record.id, email: record.email, name: record.name || '', tier: usage.tier, createdAt: record.created_at || null, usage };
          session.user = activeUser;
        }
      }
      const ws = session.userId ? getWorkspace(session.userId) : createEmptyWorkspace();
      const { _advancedUsage: _omitAdv, ...publicSettings } = (session.userId ? ws.settings : createEmptyWorkspace().settings) || {};
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
        settings: publicSettings
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
      }
      if (payload.settings && typeof payload.settings === 'object') {
        const userRecord = await findUserById(session.userId);
        const quotaStatus = getUserQuotaStatus(userRecord);
        const tierLevel = quotaStatus.level || 1;
        const { persona, addedTools } = getActivePersonaModules(payload.settings, tierLevel);
        const rawAvatar = String(payload.settings.avatarUrl || '').trim();
        const safeAvatar = (rawAvatar.startsWith('data:image/') || /^https?:\/\//i.test(rawAvatar)) && rawAvatar.length <= 180000
          ? rawAvatar
          : '';
        ws.settings = {
          senderName: String(payload.settings.senderName || '').slice(0, 120),
          senderService: String(payload.settings.senderService || '').slice(0, 300),
          avatarUrl: safeAvatar,
          persona: persona.id,
          addedTools,
          autoEnrichDiscovery: tierLevel >= 3 ? Boolean(payload.settings.autoEnrichDiscovery) : false,
          _advancedUsage: previous.settings?._advancedUsage,
          savedSearches: normalizeSavedSearches(payload.settings.savedSearches),
          leadProfiles: normalizeLeadProfiles(payload.settings.leadProfiles),
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
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
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
      const userRecord = await findUserById(session.userId);
      const quotaStatus = getUserQuotaStatus(userRecord);
      const tierLevel = quotaStatus.level || 1;
      const rankMode = url.searchParams.get('rankMode') || 'all';
      const sourceType = ['local', 'platform', 'directory', 'launches', 'reddit'].includes(url.searchParams.get('sourceType'))
        ? url.searchParams.get('sourceType')
        : 'local';
      const isAdvancedSearch = ['platform', 'directory', 'launches', 'reddit'].includes(sourceType) || ['shopify', 'chamber'].includes(rankMode);

      if (rankMode === 'low' && tierLevel < 2) {
        fail(403, 'Low-Ranking Business Discovery (Pages 3–11) requires the Silver (Starter) plan or higher.');
      }
      if (rankMode === 'deep_15' && tierLevel < 3) {
        fail(403, 'Deep Low-Ranking Discovery (Pages 6–15) requires the Gold (Pro) plan or higher.');
      }
      if (rankMode === 'deep_19' && tierLevel < 4) {
        fail(403, 'Ultra-Low Ranking Discovery (Pages 9–19) requires the Premium (Agency) plan or higher.');
      }
      if (rankMode === 'deep_full' && tierLevel < 5) {
        fail(403, 'Deepest Full-Page & Neighborhood Discovery (Pages 1–25+ & 300-node OSM) requires the Diamond plan.');
      }
      if (isAdvancedSearch && tierLevel < 3) {
        fail(403, 'Multi-Engine Store/Email-Platform & Reddit Lead Discovery requires Gold (Pro — 1/day), Premium (Agency), or Diamond.');
      }
      if (url.searchParams.get('expanded') === '1') return await streamDiscovery(res, url.searchParams, session.userId);

      const rawCity = (url.searchParams.get('city') || '').trim() || (sourceType !== 'local' ? 'Online' : '');
      const rawIndustry = (url.searchParams.get('industry') || '').trim();
      if (!rawIndustry || !rawCity) fail(400, 'Choose or enter a keyword/industry and enter a city or Online.');

      const advChargedOn = isAdvancedSearch ? await consumeAdvancedSearchQuota(session.userId, quotaStatus) : null;
      let chargedOn;
      try {
        chargedOn = await consumeQuota(session.userId, 'search');
      } catch (err) {
        if (advChargedOn) await consumeAdvancedSearchQuota(session.userId, quotaStatus, advChargedOn).catch(() => {});
        throw err;
      }

      if (url.searchParams.get('stream') === '1') {
        return await streamSearch(
          res,
          rawIndustry,
          rawCity,
          rankMode,
          count => consumeQuota(session.userId, 'result', null, count),
          async () => {
            await consumeQuota(session.userId, 'search', chargedOn).catch(console.error);
            if (advChargedOn) await consumeAdvancedSearchQuota(session.userId, quotaStatus, advChargedOn).catch(() => {});
          },
          tierLevel,
          {
            sourceType,
            targetPlatform: url.searchParams.get('targetPlatform') || 'Shopify',
            directoryPack: url.searchParams.get('directoryPack') || 'link_in_bio',
            launchMode: url.searchParams.get('launchMode') || 'both',
            redditPack: url.searchParams.get('redditPack') || 'hiring',
            redditIntent: url.searchParams.get('redditIntent') || 'all_buyers',
            subreddits: url.searchParams.get('subreddits') || ''
          }
        );
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
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      const { website } = await readJson(req);
      if (typeof website !== 'string' || !website.trim()) fail(400, 'Provide a website URL to scan.');
      return json(await fetchWebsiteEmails(website.trim()));
    }
    if (req.method === 'POST' && path === '/api/evidence-assets') {
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      const userRecord = await findUserById(session.userId);
      const quotaStatus = getUserQuotaStatus(userRecord);
      if ((quotaStatus.level || 1) < 2) {
        fail(403, 'Attaching captured research pictures requires the Silver (Starter) plan or higher.');
      }
      const { items = [] } = await readJson(req);
      const safeItems = Array.isArray(items) ? items.slice(0, 3) : [];
      const fetched = [];
      for (let i = 0; i < safeItems.length; i++) {
        const entry = safeItems[i];
        const rawUrl = typeof entry === 'string' ? entry : entry?.url;
        const labelSlug = String((typeof entry === 'object' && entry?.label) || `evidence-${i + 1}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 36) || `evidence-${i + 1}`;
        if (!rawUrl) continue;
        try {
          const safeTarget = await assertSafePublicUrl(rawUrl);
          const r = await fetch(safeTarget, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; JobHuntaEvidence/1.2)',
              Accept: 'image/jpeg,image/png,image/webp,image/gif,*/*;q=0.5'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(6000)
          });
          if (!r.ok) continue;
          const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(ct)) continue;
          const ab = await r.arrayBuffer();
          if (!ab.byteLength || ab.byteLength > 900 * 1024) continue;
          const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : ct === 'image/gif' ? 'gif' : 'jpg';
          fetched.push({
            url: rawUrl,
            filename: `${labelSlug}.${ext}`,
            mimeType: ct,
            size: ab.byteLength,
            dataBase64: Buffer.from(ab).toString('base64')
          });
        } catch {}
      }
      return json({ attachments: fetched });
    }
    if (req.method === 'POST' && path === '/api/audit') {
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      const userRecord = await findUserById(session.userId);
      const quotaStatus = getUserQuotaStatus(userRecord);
      const tierLevel = quotaStatus.level || 1;
      const { website, lead = {}, extraContext = '', senderSettings: reqSenderSettings = null } = await readJson(req);
      const targetUrl = String(website || lead?.website || '').trim();
      if (!targetUrl) fail(400, 'Provide a website URL to audit.');
      const ws = getWorkspace(session.userId || 'default');
      const effectiveSettings = reqSenderSettings && typeof reqSenderSettings === 'object'
        ? {
            ...ws.settings,
            persona: reqSenderSettings.persona || ws.settings.persona,
            addedTools: Array.isArray(reqSenderSettings.addedTools) ? reqSenderSettings.addedTools : ws.settings.addedTools,
            senderName: reqSenderSettings.senderName || ws.settings.senderName,
            senderService: reqSenderSettings.senderService || ws.settings.senderService
          }
        : ws.settings;
      const enriched = await fetchWebsiteEmails(targetUrl);
      const mergedLead = { ...lead, ...enriched, name: lead?.name || enriched.brandName };
      const outreach = generateClientOutreach(enriched.auditReport, mergedLead, effectiveSettings, tierLevel >= 3 ? extraContext : '', tierLevel);
      const { primary: personaFindings } = filterAuditFindingsForPersona(enriched.auditReport.findings || [], effectiveSettings, tierLevel);
      const { addedTools: activeAddedTools } = getActivePersonaModules(effectiveSettings, tierLevel);
      const gatedFindings = tierLevel === 1
        ? personaFindings.slice(0, 1)
        : tierLevel === 2
          ? personaFindings.filter(f => f.category === 'bugs' || f.category === 'seo' || activeAddedTools.includes(f.module))
          : personaFindings;
      return json({
        ...enriched,
        auditReport: {
          ...enriched.auditReport,
          findings: gatedFindings,
          allFindings: tierLevel >= 2 ? (enriched.auditReport.findings || []) : gatedFindings,
          totalUnlockedFindings: gatedFindings.length,
          totalDiscoveredFindings: (enriched.auditReport.findings || []).length,
          tierLevel,
          outreach
        }
      });
    }
    if (req.method === 'POST' && path === '/api/analyze') {
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      const userRecord = await findUserById(session.userId);
      const quotaStatus = getUserQuotaStatus(userRecord);
      const tierLevel = quotaStatus.level || 1;
      const { lead, userIssues, extraContext, senderSettings: reqSenderSettings = null } = await readJson(req);
      if (!lead || typeof lead !== 'object') fail(400, 'Provide business details to analyze.');
      if (String(extraContext || '').trim() && tierLevel < 3) {
        fail(403, 'Custom AI instructions & prompt refinement require the Gold (Pro) plan or higher.');
      }
      let enrichedLead = { ...lead };
      let combedSnapshot = null;
      if (enrichedLead.website && (!enrichedLead.auditReport || !Array.isArray(enrichedLead.crawledPages))) {
        try {
          combedSnapshot = await fetchWebsiteEmails(enrichedLead.website);
          enrichedLead = {
            ...enrichedLead,
            ...combedSnapshot,
            name: enrichedLead.name || combedSnapshot.brandName,
            email: enrichedLead.email || combedSnapshot.email,
            phone: enrichedLead.phone || combedSnapshot.phone
          };
        } catch {}
      }
      const ws = getWorkspace(session.userId || 'default');
      const effectiveSettings = reqSenderSettings && typeof reqSenderSettings === 'object'
        ? {
            ...ws.settings,
            persona: reqSenderSettings.persona || ws.settings.persona,
            addedTools: Array.isArray(reqSenderSettings.addedTools) ? reqSenderSettings.addedTools : ws.settings.addedTools,
            senderName: reqSenderSettings.senderName || ws.settings.senderName,
            senderService: reqSenderSettings.senderService || ws.settings.senderService
          }
        : ws.settings;
      const brief = await analyzeLeadWithAi(
        enrichedLead,
        effectiveSettings,
        userIssues ?? enrichedLead.userSpottedIssues ?? '',
        tierLevel >= 3 ? (extraContext ?? enrichedLead.aiExtraContext ?? '') : '',
        tierLevel
      );
      return json({
        ...brief,
        auditReport: enrichedLead.auditReport || null,
        enrichedData: combedSnapshot
      });
    }
    if (req.method === 'POST' && path === '/api/send') {
      if (!session.userId) fail(401, 'Sign in to send email.');
      const payload = await readJson(req, 15 * 1024 * 1024);
      if (Array.isArray(payload.attachments) && payload.attachments.length > 0) {
        const userRecord = await findUserById(session.userId);
        const quotaStatus = getUserQuotaStatus(userRecord);
        if ((quotaStatus.level || 1) < 2) {
          fail(403, 'Email file & image attachments require the Silver (Starter) plan or higher.');
        }
      }
      return json(await send(session, payload));
    }
    if (req.method === 'GET' && path === '/api/outreach') {
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      if (!session.mailbox) fail(401, 'Connect Gmail first.');
      const registry = await outreachRegistry(session.userId);
      return json(Object.entries(registry).flatMap(([id, item]) =>
        item?.mailbox === session.mailbox ? [{ id, mailbox: item.mailbox, leadId: item.leadId,
          to: item.recipient, subject: item.subject, time: item.time, templateName: item.templateName }] : []));
    }
    if (req.method === 'POST' && path === '/api/thread') {
      if (!session.userId) fail(401, 'Sign in to your Job Hunta account first.');
      const { id, mailbox } = await readJson(req);
      if (!session.mailbox) fail(401, 'Connect your Gmail account first.');
      if (session.mailbox !== mailbox) fail(403, 'Connect the Gmail account that sent this conversation.');
      return json(await thread(session, id));
    }
    return json({ error: 'Page not found.' }, 404);
  } catch (error) {
    return json({ error: error.status ? error.message : 'Job Hunta could not complete the request.' }, error.status || 500);
  }
}

export const server = createServer(handleRequest);
export default handleRequest;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, 'localhost', () => console.log('Job Hunta is running at ' + localOrigin));
}
