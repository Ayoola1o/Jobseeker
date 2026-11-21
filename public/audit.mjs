// Passive Website Audit, Platform Fingerprinting, Persona Filtering & Client Outreach Generator

export const PERSONA_TOOL_MODULES = {
  web_tech: {
    key: 'web_tech',
    label: 'Website Bugs, Speed & Security Hygiene',
    shortLabel: 'Web Dev & Speed',
    description: 'Missing website, mobile viewport & layout bugs, broken links/forms, slow TTFB/load speed, and HTTPS/security headers.'
  },
  ads_funnel: {
    key: 'ads_funnel',
    label: 'Ad Pixels, Lead Capture & Conversion Funnels',
    shortLabel: 'Ads & Funnels',
    description: 'Missing Meta/TikTok/Google Analytics pixels, missing instant booking/quote forms, live chat/WhatsApp widgets, and funnel leaks.'
  },
  seo_local: {
    key: 'seo_local',
    label: 'On-Page SEO, Search Ranking & Local Maps',
    shortLabel: 'SEO & Local Rank',
    description: 'Low search rank (Rank #11+), missing title/meta description/H1, image alt text, sitemap/robots/JSON-LD schema, and map ratings.'
  },
  social_brand: {
    key: 'social_brand',
    label: 'Social Media Presence & Brand Authority',
    shortLabel: 'Social Media',
    description: 'Unlinked or missing Instagram, TikTok, Facebook, LinkedIn, X/Twitter & YouTube profiles, Open Graph share cards, and social proof.'
  },
  ecommerce_cro: {
    key: 'ecommerce_cro',
    label: 'Shopify / E-Commerce CRO & Retention Stack',
    shortLabel: 'Shopify & E-Com CRO',
    description: 'Shopify/WooCommerce theme & currency, missing review widgets (Judge.me/Loox), missing Klaviyo/email cart recovery, and catalog CRO.'
  }
};

export const PERSONA_CATALOG = [
  {
    id: 'web_dev',
    label: 'Web Developer',
    title: 'Web Developer & UI/UX Designer',
    icon: 'globe',
    defaultService: 'modern web development, mobile UI/UX redesign, and site speed optimization',
    tagline: 'Pitch website builds, redesigns, bug fixes, mobile responsiveness & speed.',
    coreModules: ['web_tech']
  },
  {
    id: 'digital_marketer',
    label: 'Digital Marketer',
    title: 'Digital Marketer & Funnel Specialist',
    icon: 'megaphone',
    defaultService: 'paid advertising, conversion funnels, retargeting pixels, and lead generation',
    tagline: 'Pitch ad tracking pixels, high-converting landing pages, lead capture forms & live chat.',
    coreModules: ['ads_funnel']
  },
  {
    id: 'seo_specialist',
    label: 'SEO Specialist',
    title: 'SEO & Local Ranking Specialist',
    icon: 'search',
    defaultService: 'local SEO, Google/Bing page-1 ranking optimization, and technical search visibility',
    tagline: 'Pitch Rank #11+ businesses on meta tags, H1s, schema markup, sitemaps & map reviews.',
    coreModules: ['seo_local']
  },
  {
    id: 'social_media',
    label: 'Social Media Manager',
    title: 'Social Media & Brand Growth Manager',
    icon: 'users',
    defaultService: 'social media management, short-form content creation, and brand authority growth',
    tagline: 'Pitch businesses lacking Instagram, TikTok, Facebook, LinkedIn & social engagement.',
    coreModules: ['social_brand']
  },
  {
    id: 'shopify_cro',
    label: 'Shopify / E-Com CRO',
    title: 'Shopify & E-Commerce CRO Specialist',
    icon: 'sparkles',
    defaultService: 'Shopify conversion rate optimization, Klaviyo retention flows, and store revenue scaling',
    tagline: 'Pitch online stores on product review apps, abandoned cart flows & checkout conversion.',
    coreModules: ['ecommerce_cro']
  },
  {
    id: 'full_agency',
    label: 'Full-Service Agency',
    title: 'Full-Service Digital Growth Agency',
    icon: 'building',
    defaultService: 'full-stack web redesign, local SEO, paid acquisition funnels, and social media growth',
    tagline: 'Agency lead-gen pitch combining website conversion and lead capture funnels.',
    coreModules: ['web_tech', 'ads_funnel']
  }
];

export function getPersonaConfig(personaId = 'web_dev') {
  const cleaned = String(personaId || 'web_dev').trim().toLowerCase();
  return PERSONA_CATALOG.find(p => p.id === cleaned) || PERSONA_CATALOG[0];
}

export function getMaxAddedToolsForTier(tierLevel = 1) {
  const lvl = Number(tierLevel) || 1;
  if (lvl <= 1) return 0; // Basic: 0 added tools
  if (lvl === 2) return 1; // Silver (Starter): 1 added tool
  if (lvl === 3) return 2; // Gold (Pro): 2 added tools
  return 5; // Premium (Agency) & Diamond: all added tools available (off by default)
}

export function getActivePersonaModules(senderSettings = {}, tierLevel = 5) {
  const hasExplicitPersona = Boolean(senderSettings?.persona && String(senderSettings.persona).trim());
  const persona = getPersonaConfig(senderSettings?.persona || 'web_dev');
  const maxAddedTools = getMaxAddedToolsForTier(tierLevel);
  const rawAdded = Array.isArray(senderSettings?.addedTools) ? senderSettings.addedTools : [];
  const validExtraKeys = rawAdded
    .map(k => String(k || '').trim())
    .filter(k => Object.hasOwn(PERSONA_TOOL_MODULES, k) && !persona.coreModules.includes(k));
  const uniqueExtra = [...new Set(validExtraKeys)];
  const allowedAdded = uniqueExtra.slice(0, maxAddedTools);
  const activeList = hasExplicitPersona
    ? [...persona.coreModules, ...allowedAdded]
    : Object.keys(PERSONA_TOOL_MODULES);
  const availableExtraModules = Object.values(PERSONA_TOOL_MODULES).filter(m => !persona.coreModules.includes(m.key));

  return {
    persona,
    hasExplicitPersona,
    coreModules: persona.coreModules,
    addedTools: allowedAdded,
    activeModules: new Set(activeList),
    activeModuleKeys: activeList,
    availableExtraModules,
    maxAddedTools
  };
}

export function classifyFindingModule(finding = {}) {
  if (finding.module && Object.hasOwn(PERSONA_TOOL_MODULES, finding.module)) return finding.module;
  const title = String(finding.title || '').toLowerCase();
  const cat = String(finding.category || '').toLowerCase();

  if (/social media|open graph|og:title|og:image|instagram|tiktok|facebook|linkedin/i.test(title)) {
    return 'social_brand';
  }
  if (/shopify|woocommerce|review widget|judge\.me|loox|yotpo|klaviyo|omnisend|abandoned cart/i.test(title)) {
    return 'ecommerce_cro';
  }
  if (/privacy policy|pixel|tracking|booking|lead capture|live chat|whatsapp/i.test(title)) {
    return 'ads_funnel';
  }
  if (cat === 'seo' || /<title>|meta name="description"|<h1>|heading hierarchy|alt text|canonical|json-ld|robots\.txt|sitemap\.xml|thin indexable|search visibility|bing rank/i.test(title)) {
    return 'seo_local';
  }
  return 'web_tech';
}

export function filterAuditFindingsForPersona(findings = [], senderSettings = {}, tierLevel = 5) {
  const { activeModules, hasExplicitPersona } = getActivePersonaModules(senderSettings, tierLevel);
  const tagged = (Array.isArray(findings) ? findings : []).map(f => ({
    ...f,
    module: classifyFindingModule(f)
  }));
  const primary = tagged.filter(f => activeModules.has(f.module));
  const secondary = tagged.filter(f => !activeModules.has(f.module));
  return {
    primary: hasExplicitPersona ? primary : (primary.length ? primary : tagged.slice(0, 2)),
    secondary,
    allTagged: tagged
  };
}

export function detectPlatform(html = '', urlStr = '', headers = {}) {
  const lower = String(html || '').toLowerCase();
  const headerStr = JSON.stringify(headers || {}).toLowerCase();
  let host = '';
  try { host = new URL(urlStr).hostname.toLowerCase(); } catch {}

  const cmsList = [];
  const frameworks = [];
  const tools = [];
  const evidence = [];

  // 1. CMS & E-Commerce Platforms
  if (host.endsWith('.myshopify.com') || lower.includes('cdn.shopify.com') || lower.includes('shopify.theme') || lower.includes('shopify.shop') || headerStr.includes('x-shopid')) {
    cmsList.push('Shopify');
    evidence.push('Shopify CDN / Shopify.shop signature');
  }
  if (lower.includes('woocommerce') || lower.includes('wc-cart') || lower.includes('/wp-content/plugins/woocommerce')) {
    cmsList.push('WooCommerce');
    evidence.push('WooCommerce assets / cart signature');
  }
  if (lower.includes('/wp-content/') || lower.includes('/wp-includes/') || lower.includes('wp-json') || /name=["']generator["'][^>]+wordpress/i.test(html)) {
    cmsList.push('WordPress');
    const themeMatch = html.match(/\/wp-content\/themes\/([a-z0-9_-]+)/i);
    const plugins = [...new Set([...html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)/gi)].map(m => m[1]))].slice(0, 5);
    if (themeMatch?.[1]) evidence.push(`WP Theme: ${themeMatch[1]}`);
    if (plugins.length) evidence.push(`WP Plugins: ${plugins.join(', ')}`);
  }
  if (lower.includes('data-wf-site') || lower.includes('data-wf-page') || lower.includes('website-files.com') || host.endsWith('.webflow.io')) {
    cmsList.push('Webflow');
    evidence.push('Webflow data-wf-site / website-files.com');
  }
  if (lower.includes('wix.com') || lower.includes('wixstatic.com') || host.endsWith('.wixsite.com') || headerStr.includes('x-wix-')) {
    cmsList.push('Wix');
    evidence.push('Wix static CDN / runtime');
  }
  if (lower.includes('squarespace.com') || lower.includes('squarespace-cdn.com') || lower.includes('static1.squarespace')) {
    cmsList.push('Squarespace');
    evidence.push('Squarespace CDN signature');
  }
  if (lower.includes('mage/cookies') || lower.includes('magento_') || lower.includes('x-magento-')) {
    cmsList.push('Magento');
    evidence.push('Magento JS / header signature');
  }
  if (lower.includes('cdn11.bigcommerce.com') || lower.includes('bigcommerce.com') || host.endsWith('.mybigcommerce.com')) {
    cmsList.push('BigCommerce');
    evidence.push('BigCommerce CDN');
  }
  if (/name=["']generator["'][^>]+ghost/i.test(html) || host.endsWith('.ghost.io')) {
    cmsList.push('Ghost');
    evidence.push('Ghost CMS generator tag');
  }
  if (lower.includes('hs_cos_wrapper') || lower.includes('hs-scripts.com') || headerStr.includes('x-hs-')) {
    cmsList.push('HubSpot CMS');
    evidence.push('HubSpot COS wrapper');
  }

  // 2. Frontend & Backend Frameworks
  if (lower.includes('__next_data__') || lower.includes('/_next/static/') || headerStr.includes('x-nextjs')) {
    frameworks.push('Next.js');
    if (!frameworks.includes('React')) frameworks.push('React');
    evidence.push('Next.js /_next/static bundle');
  } else if (lower.includes('data-reactroot') || lower.includes('react-dom') || lower.includes('__react')) {
    frameworks.push('React');
  }
  if (lower.includes('__nuxt__') || lower.includes('/_nuxt/')) {
    frameworks.push('Nuxt');
    if (!frameworks.includes('Vue.js')) frameworks.push('Vue.js');
    evidence.push('Nuxt /_nuxt bundle');
  } else if (lower.includes('vue.runtime') || lower.includes('vue.global') || /data-v-[a-f0-9]{6,}/i.test(html)) {
    frameworks.push('Vue.js');
  }
  if (lower.includes('ng-version=') || lower.includes('ng-app=')) {
    frameworks.push('Angular');
  }
  if (lower.includes('__sveltekit') || lower.includes('svelte-')) {
    frameworks.push('SvelteKit');
  }
  if (lower.includes('astro-island') || /name=["']generator["'][^>]+astro/i.test(html)) {
    frameworks.push('Astro');
  }
  if (headerStr.includes('laravel_session') || headerStr.includes('xsrf-token') || lower.includes('csrf-token')) {
    if (headerStr.includes('laravel_session')) frameworks.push('Laravel');
  }
  if (lower.includes('csrfmiddlewaretoken')) {
    frameworks.push('Django');
  }
  if (lower.includes('bootstrap')) frameworks.push('Bootstrap');
  if (lower.includes('tailwindcss') || /class=["'][^"']*\b(?:flex|grid)\s+[^"']*\b(?:items-center|justify-between)\b/i.test(html)) {
    frameworks.push('Tailwind CSS');
  }

  // 3. Third-Party Tools, Pixels, Chat & Payments
  const toolChecks = [
    ['Google Analytics / GTM', /googletagmanager\.com|google-analytics\.com|gtag\(/i],
    ['Meta Pixel', /connect\.facebook\.net|fbq\(/i],
    ['TikTok Pixel', /analytics\.tiktok\.com|ttq\./i],
    ['Hotjar', /static\.hotjar\.com/i],
    ['Microsoft Clarity', /clarity\.ms/i],
    ['Klaviyo', /klaviyo\.com/i],
    ['Mailchimp', /mailchimp\.com|chimpstatic\.com/i],
    ['Omnisend', /omnisend\.com|omnisnippet/i],
    ['Intercom', /widget\.intercom\.io/i],
    ['Tidio Chat', /code\.tidio\.co/i],
    ['Crisp Chat', /client\.crisp\.chat/i],
    ['Zendesk', /zdassets\.com/i],
    ['Drift', /js\.driftt\.com/i],
    ['WhatsApp Chat', /wa\.me\/|api\.whatsapp\.com/i],
    ['Stripe', /js\.stripe\.com/i],
    ['PayPal', /paypal\.com\/sdk|paypalobjects\.com/i],
    ['Paystack', /js\.paystack\.co/i],
    ['Flutterwave', /checkout\.flutterwave\.com/i],
    ['Judge.me Reviews', /judge\.me/i],
    ['Loox Reviews', /loox\.io/i],
    ['Yotpo Reviews', /yotpo\.com/i],
    ['Trustpilot', /trustpilot\.com/i],
    ['Calendly', /calendly\.com/i],
    ['Typeform', /typeform\.com/i]
  ];
  for (const [label, regex] of toolChecks) {
    if (regex.test(html)) tools.push(label);
  }

  const myshopifyMatch = html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/i);
  const themeMatch = html.match(/Shopify\.theme\s*=\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/i);
  const currencyMatch = html.match(/Shopify\.currency\s*=\s*\{[^}]*?"active"\s*:\s*"([^"]+)"/i);

  const primaryPlatform = cmsList[0] || frameworks[0] || 'Custom HTML/JS';

  return {
    platform: primaryPlatform,
    cms: cmsList,
    frameworks,
    tools,
    techStack: [...new Set([...cmsList, ...frameworks, ...tools])],
    evidence,
    shopifyMeta: cmsList.includes('Shopify') ? {
      myshopifyDomain: myshopifyMatch?.[1] || (host.endsWith('.myshopify.com') ? host : ''),
      themeName: themeMatch?.[1] || '',
      currency: currencyMatch?.[1] || ''
    } : null
  };
}

export function analyzePageAudit({
  url = '',
  status = 200,
  ttfbMs = 0,
  headers = {},
  html = '',
  robotsTxtOk = true,
  sitemapXmlOk = true,
  brokenLinks = [],
  brokenAssets = []
} = {}) {
  const findings = [];
  const addFinding = (category, severity, title, detail, recommendation, businessImpact) => {
    findings.push({
      id: `${category}_${findings.length + 1}`,
      category, // 'bugs' | 'seo' | 'performance' | 'security'
      severity, // 'Critical' | 'Warning' | 'Info'
      title,
      detail,
      recommendation,
      businessImpact
    });
  };

  let parsedUrl = null;
  try { parsedUrl = new URL(url); } catch {}
  const isHttps = parsedUrl ? parsedUrl.protocol === 'https:' : url.startsWith('https://');
  const normHeaders = Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), String(v || '')])
  );

  const stack = detectPlatform(html, url, normHeaders);

  // Strip scripts & styles for text analysis
  const visibleText = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = visibleText ? visibleText.split(/\s+/).length : 0;

  // ---------------- 1. BUGS & FUNCTIONAL / UX LAPSES ----------------
  if (status >= 400) {
    addFinding(
      'bugs',
      'Critical',
      `Homepage returned HTTP ${status}`,
      `The primary URL responded with status code ${status} instead of 200 OK.`,
      'Fix server routing or broken redirect rules on the primary domain.',
      'Visitors and ad traffic land on an error page, causing immediate 100% bounce.'
    );
  }

  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  if (!hasViewport) {
    addFinding(
      'bugs',
      'Critical',
      'Missing responsive mobile viewport meta tag',
      'No <meta name="viewport" content="width=device-width, initial-scale=1"> tag was found in <head>.',
      'Add a responsive viewport meta tag so the layout scales properly on smartphones.',
      'Over 65% of local & e-commerce traffic is mobile; desktop-scaled pages cause visitors to pinch-zoom and leave.'
    );
  }

  if (brokenLinks.length > 0) {
    addFinding(
      'bugs',
      'Critical',
      `${brokenLinks.length} broken internal/navigation link${brokenLinks.length === 1 ? '' : 's'} detected`,
      `Dead links found: ${brokenLinks.slice(0, 3).map(l => `${l.url} (HTTP ${l.status || 'failed'})`).join(', ')}.`,
      'Update or redirect dead navigation and CTA links to active pages.',
      'High-intent buyers clicking dead service or checkout links abandon the site immediately.'
    );
  }

  if (brokenAssets.length > 0) {
    addFinding(
      'bugs',
      'Warning',
      `${brokenAssets.length} broken image or asset request${brokenAssets.length === 1 ? '' : 's'} (4xx/5xx)`,
      `Missing assets: ${brokenAssets.slice(0, 3).map(a => `${a.url} (HTTP ${a.status || 'failed'})`).join(', ')}.`,
      'Restore missing image files or update asset URLs in your template.',
      'Broken product or hero images make the business appear inactive or untrustworthy.'
    );
  }

  // Form hygiene check
  const formMatches = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  let formsWithoutSubmit = 0;
  for (const fm of formMatches) {
    const inner = fm[2] || '';
    if (!/<(?:button|input)\b[^>]*type=["']?submit["']?/i.test(inner) && !/<button\b/i.test(inner)) {
      formsWithoutSubmit++;
    }
  }
  if (formsWithoutSubmit > 0) {
    addFinding(
      'bugs',
      'Warning',
      `${formsWithoutSubmit} form${formsWithoutSubmit === 1 ? '' : 's'} missing a clear submit trigger`,
      'Detected <form> markup without a standard submit <button> or <input type="submit">.',
      'Ensure every lead capture and newsletter form has an accessible submit button.',
      'Broken or inaccessible forms silently drop inbound customer inquiries.'
    );
  }

  const inputTags = [...html.matchAll(/<input\b([^>]*)>/gi)]
    .map(m => m[1])
    .filter(attr => !/type=["']?(?:hidden|submit|button|reset|image)["']?/i.test(attr));
  const unlabeledInputs = inputTags.filter(attr => !/(?:aria-label|placeholder|id|name)=["'][^"']+["']/i.test(attr));
  if (unlabeledInputs.length > 0) {
    addFinding(
      'bugs',
      'Info',
      `${unlabeledInputs.length} form input${unlabeledInputs.length === 1 ? '' : 's'} missing labels or placeholders`,
      'Found form fields without descriptive id/name/placeholder/aria-label attributes.',
      'Add clear <label> elements and placeholders to all form fields.',
      'Improves mobile form completion rate and accessibility compliance.'
    );
  }

  const deadAnchors = [...html.matchAll(/<a\b[^>]*href=["'](?:#|javascript:void\(0\);?)["'][^>]*>/gi)];
  if (deadAnchors.length >= 4) {
    addFinding(
      'bugs',
      'Info',
      `${deadAnchors.length} placeholder links (href="#") on page`,
      'Multiple anchor tags point to "#" or "javascript:void(0)" instead of real destinations.',
      'Replace placeholder anchors with real destination URLs or <button type="button"> elements.',
      'Unfinished navigation links confuse visitors trying to explore services.'
    );
  }

  // ---------------- 2. SEO & AI-READABILITY LAPSES ----------------
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = (titleMatch?.[1] || '').replace(/\s+/g, ' ').trim();
  if (!titleText) {
    addFinding(
      'seo',
      'Critical',
      'Missing <title> tag on homepage',
      'No <title> element was found in the document head.',
      'Add a descriptive 50–60 character <title> including primary service and city.',
      'Severely hurts Google/Bing rankings and click-through rate from search results.'
    );
  } else if (titleText.length < 18) {
    addFinding(
      'seo',
      'Warning',
      `Page <title> is too short (${titleText.length} chars: "${titleText}")`,
      'Short title tags miss high-intent keywords for your category and location.',
      'Expand the title to 45–60 characters with your core service + target city.',
      'Missed organic search impressions for local and category keywords.'
    );
  } else if (titleText.length > 70) {
    addFinding(
      'seo',
      'Info',
      `Page <title> is over 70 characters (${titleText.length} chars)`,
      'Search engines truncate long titles in SERPs.',
      'Trim the <title> to under 60 characters while keeping primary keywords upfront.',
      'Cleaner search result appearance and higher organic click-through.'
    );
  }

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const metaDesc = (descMatch?.[1] || '').replace(/\s+/g, ' ').trim();
  if (!metaDesc) {
    addFinding(
      'seo',
      'Critical',
      'Missing SEO <meta name="description">',
      'The page has no meta description tag for search engines and AI answer engines.',
      'Add a compelling 140–160 character meta description with a clear value proposition and call to action.',
      'Lowers organic click-through rate by 15–30% on Google and Bing.'
    );
  } else if (metaDesc.length < 50) {
    addFinding(
      'seo',
      'Warning',
      `Meta description is very brief (${metaDesc.length} chars)`,
      `Current description: "${metaDesc}".`,
      'Expand the meta description to 130–160 characters highlighting services, location, and benefits.',
      'Better search snippet visibility and higher organic traffic.'
    );
  }

  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (h1Matches.length === 0) {
    addFinding(
      'seo',
      'Critical',
      'Missing primary <h1> heading',
      'No <h1> tag with visible text was found on the page.',
      'Add a single, clear <h1> heading stating what the business offers and who it serves.',
      'Search crawlers and AI models rely on <h1> to understand the primary topic of the page.'
    );
  } else if (h1Matches.length > 1) {
    addFinding(
      'seo',
      'Warning',
      `Multiple <h1> headings detected (${h1Matches.length} found)`,
      `Found ${h1Matches.length} <h1> tags ("${h1Matches.slice(0, 2).join('", "')}").`,
      'Use a single primary <h1> per page and structure sub-sections with <h2> and <h3>.',
      'Dilutes topical focus and heading hierarchy for search engines.'
    );
  }

  const hasH2 = /<h2\b/i.test(html);
  const hasH3 = /<h3\b/i.test(html);
  if (h1Matches.length > 0 && !hasH2 && hasH3) {
    addFinding(
      'seo',
      'Info',
      'Skipped heading hierarchy (H1 jumps directly to H3)',
      'The page contains <h1> and <h3> headings but no <h2> headings.',
      'Use sequential heading levels (H1 -> H2 -> H3) for proper semantic structure.',
      'Improves accessibility and AI/search content parsing.'
    );
  }

  const imgTags = [...html.matchAll(/<img\b([^>]*)>/gi)].map(m => m[1]);
  const imgsMissingAlt = imgTags.filter(attr => !/\balt=["'][^"']+["']/i.test(attr));
  if (imgsMissingAlt.length > 0) {
    addFinding(
      'seo',
      imgsMissingAlt.length >= 4 ? 'Warning' : 'Info',
      `${imgsMissingAlt.length} of ${imgTags.length} image${imgTags.length === 1 ? '' : 's'} missing descriptive alt text`,
      'Images lack non-empty alt attributes for Google Image Search and screen readers.',
      'Add descriptive alt attributes to product, service, and hero images.',
      'Loses free Google Images discovery traffic and hurts accessibility scores.'
    );
  }

  if (!/<link[^>]+rel=["']canonical["']/i.test(html)) {
    addFinding(
      'seo',
      'Warning',
      'Missing canonical URL tag (<link rel="canonical">)',
      'No canonical link tag was found to prevent duplicate URL indexing (e.g. ?utm= parameters or http/www variants).',
      'Add <link rel="canonical" href="..."> pointing to the preferred HTTPS URL.',
      'Prevents split ranking authority across duplicate URL variations.'
    );
  }

  if (!/property=["']og:title["']/i.test(html) || !/property=["']og:image["']/i.test(html)) {
    addFinding(
      'seo',
      'Info',
      'Incomplete Open Graph social preview tags (og:title / og:image)',
      'Missing og:title or og:image meta tags for rich previews when shared on WhatsApp, LinkedIn, Facebook, or X.',
      'Add og:title, og:description, and og:image tags in <head>.',
      'Links shared on social media or messaging apps appear plain without a branded preview card.'
    );
  }

  if (!/application\/ld\+json/i.test(html)) {
    addFinding(
      'seo',
      'Warning',
      'Missing JSON-LD Schema.org structured data',
      'No <script type="application/ld+json"> structured data was found for LocalBusiness, Organization, or Product rich results.',
      'Add Schema.org JSON-LD markup (LocalBusiness / Product / FAQPage) to unlock Google rich snippets.',
      'Misses star ratings, price badges, and AI search citations in Google results.'
    );
  }

  if (!robotsTxtOk) {
    addFinding(
      'seo',
      'Warning',
      'Missing or unreachable /robots.txt file',
      'Requesting /robots.txt did not return a valid robots directives file.',
      'Publish a clean /robots.txt referencing your XML sitemap.',
      'Helps search crawlers budget crawl activity efficiently.'
    );
  }

  if (!sitemapXmlOk) {
    addFinding(
      'seo',
      'Warning',
      'Missing or unreachable /sitemap.xml',
      'Requesting /sitemap.xml did not return an XML sitemap.',
      'Generate and submit an XML sitemap at /sitemap.xml and in Google Search Console.',
      'Slower discovery and indexing of inner service or product pages.'
    );
  }

  if (wordCount < 120) {
    addFinding(
      'seo',
      'Warning',
      `Thin indexable HTML content (${wordCount} visible words)`,
      'The initial server HTML contains very little indexable text (either thin copy or heavy client-side JS rendering).',
      'Add rich, keyword-aligned copy or enable SSR/pre-rendering so search & AI crawlers see full content immediately.',
      'Pages with thin initial text struggle to rank for competitive service keywords.'
    );
  }

  // ---------------- 3. PERFORMANCE & CORE WEB VITALS SIGNALS ----------------
  if (ttfbMs > 1400) {
    addFinding(
      'performance',
      'Critical',
      `Slow server response time / TTFB (${ttfbMs} ms)`,
      `Initial HTML response took ${ttfbMs} ms (recommended target is under 600 ms).`,
      'Enable full-page CDN caching (Cloudflare / edge cache) and optimize backend database queries.',
      'Every 1-second delay in mobile load time drops conversion rates by ~7–12%.'
    );
  } else if (ttfbMs > 700) {
    addFinding(
      'performance',
      'Warning',
      `Elevated server response time (${ttfbMs} ms)`,
      `Initial document response took ${ttfbMs} ms.`,
      'Add edge caching and server response compression.',
      'Faster initial paint improves Core Web Vitals (LCP) and mobile retention.'
    );
  }

  const headHtml = (html.match(/<head[\s\S]*?<\/head>/i)?.[0]) || '';
  const blockingScripts = [...headHtml.matchAll(/<script\b([^>]*)>/gi)]
    .map(m => m[1])
    .filter(attr => /\bsrc=["'][^"']+["']/i.test(attr) && !/\b(?:defer|async)\b/i.test(attr) && !/type=["']module["']/i.test(attr));
  if (blockingScripts.length > 0) {
    addFinding(
      'performance',
      blockingScripts.length >= 3 ? 'Warning' : 'Info',
      `${blockingScripts.length} render-blocking <script> tag${blockingScripts.length === 1 ? '' : 's'} in <head>`,
      'Synchronous external scripts in <head> pause browser HTML parsing and delay First Contentful Paint.',
      'Add defer or async attributes to non-critical third-party and bundle scripts.',
      'Speeds up mobile first paint so visitors see content before bouncing.'
    );
  }

  const totalScripts = [...html.matchAll(/<script\b[^>]*src=["'][^"']+["']/gi)].length;
  if (totalScripts > 22) {
    addFinding(
      'performance',
      'Warning',
      `High external script load (${totalScripts} external JS files)`,
      `The homepage loads ${totalScripts} separate external JavaScript files.`,
      'Audit and remove unused third-party tracking pixels, old apps, or duplicate widgets.',
      'Reduces main-thread blocking (INP/TBT) on mid-range mobile devices.'
    );
  }

  if (imgTags.length >= 4 && !imgTags.some(attr => /loading=["']lazy["']/i.test(attr))) {
    addFinding(
      'performance',
      'Info',
      'Below-the-fold images are not using native lazy-loading (loading="lazy")',
      `None of the ${imgTags.length} images on the page specify loading="lazy".`,
      'Add loading="lazy" and explicit width/height attributes to below-the-fold images.',
      'Cuts initial page weight and improves Largest Contentful Paint (LCP).'
    );
  }

  const cacheControl = normHeaders['cache-control'] || '';
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) {
    addFinding(
      'performance',
      'Info',
      'No public edge/browser caching policy on HTML response',
      `Cache-Control header is "${cacheControl || 'missing'}".`,
      'Configure CDN stale-while-revalidate or static asset caching headers.',
      'Repeat visitors and multi-page sessions load noticeably faster.'
    );
  }

  // ---------------- 4. PASSIVE SECURITY & TRUST HYGIENE ----------------
  if (!isHttps) {
    addFinding(
      'security',
      'Critical',
      'Website is served over unencrypted HTTP (No HTTPS)',
      'The site URL uses http:// instead of encrypted https://.',
      'Install a valid TLS/SSL certificate and enforce a 301 redirect from HTTP to HTTPS.',
      'Chrome and Safari display a "Not Secure" warning in the address bar, scaring away customers.'
    );
  } else {
    const mixedAssets = [...html.matchAll(/(?:src|href)=["'](http:\/\/[^"']+)["']/gi)]
      .map(m => m[1])
      .filter(u => !/^http:\/\/(?:www\.w3\.org|schemas\.|localhost)/i.test(u));
    if (mixedAssets.length > 0) {
      addFinding(
        'security',
        'Warning',
        `${mixedAssets.length} mixed-content HTTP reference${mixedAssets.length === 1 ? '' : 's'} on an HTTPS page`,
        `Insecure http:// references found (e.g. ${mixedAssets[0].slice(0, 65)}).`,
        'Update all asset, script, and link URLs to https://.',
        'Browsers block mixed-content resources or downgrade the padlock security indicator.'
      );
    }
  }

  const missingSecHeaders = [];
  if (isHttps && !normHeaders['strict-transport-security']) missingSecHeaders.push('Strict-Transport-Security (HSTS)');
  if (!normHeaders['content-security-policy']) missingSecHeaders.push('Content-Security-Policy (CSP)');
  if (!normHeaders['x-frame-options'] && !/frame-ancestors/i.test(normHeaders['content-security-policy'] || '')) missingSecHeaders.push('X-Frame-Options');
  if (!normHeaders['x-content-type-options']) missingSecHeaders.push('X-Content-Type-Options');
  if (!normHeaders['referrer-policy']) missingSecHeaders.push('Referrer-Policy');

  if (missingSecHeaders.length > 0) {
    addFinding(
      'security',
      missingSecHeaders.length >= 4 ? 'Warning' : 'Info',
      `Missing ${missingSecHeaders.length} standard HTTP security header${missingSecHeaders.length === 1 ? '' : 's'}`,
      `Not present on response: ${missingSecHeaders.join(', ')}.`,
      'Add standard HTTP security headers at your web server, CDN, or hosting layer.',
      'Protects visitors against clickjacking, MIME sniffing, and protocol downgrade risks.'
    );
  }

  if (/jquery[.-]1\.[0-9]+|jquery[.-]2\.[0-9]+|bootstrap\/3\.[0-3]/i.test(html)) {
    addFinding(
      'security',
      'Warning',
      'Outdated frontend JavaScript library version detected',
      'Detected legacy jQuery 1.x/2.x or Bootstrap 3.x script reference in page source.',
      'Upgrade legacy frontend libraries to current patched versions.',
      'Removes known public client-side DOM/XSS vulnerability signatures.'
    );
  }

  const hasTrackingOrForms = stack.tools.length > 0 || formMatches.length > 0;
  const hasPrivacyLink = /privacy[\s-_]*policy|\/privacy\b|cookie[\s-_]*policy/i.test(html);
  if (hasTrackingOrForms && !hasPrivacyLink) {
    addFinding(
      'security',
      'Warning',
      'No Privacy Policy link detected on a page with forms or tracking pixels',
      'The site collects visitor data or runs analytics pixels without a visible Privacy Policy link.',
      'Add a clear Privacy Policy link in the site footer and near lead forms.',
      'Required for ad platform compliance (Meta/Google Ads) and customer trust.'
    );
  }

  // Compute scores
  const calcCategoryScore = cat => {
    const items = findings.filter(f => f.category === cat);
    let score = 100;
    for (const f of items) {
      if (f.severity === 'Critical') score -= 24;
      else if (f.severity === 'Warning') score -= 11;
      else score -= 4;
    }
    return Math.max(15, Math.min(100, score));
  };

  const scores = {
    bugs: calcCategoryScore('bugs'),
    seo: calcCategoryScore('seo'),
    performance: calcCategoryScore('performance'),
    security: calcCategoryScore('security')
  };
  const overallScore = Math.round((scores.bugs + scores.seo + scores.performance + scores.security) / 4);

  const criticalCount = findings.filter(f => f.severity === 'Critical').length;
  const warningCount = findings.filter(f => f.severity === 'Warning').length;
  const infoCount = findings.filter(f => f.severity === 'Info').length;

  return {
    url,
    scannedAt: new Date().toISOString(),
    status,
    ttfbMs,
    wordCount,
    overallScore,
    scores,
    counts: {
      total: findings.length,
      critical: criticalCount,
      warning: warningCount,
      info: infoCount
    },
    stack,
    findings
  };
}

export function generateClientOutreach(auditReport = {}, lead = {}, senderSettings = {}, extraContext = '', tierLevel = 5) {
  const name = lead.name || 'your team';
  const city = lead.city || 'your area';
  const industry = lead.industry || 'business';
  const platform = auditReport.stack?.platform || lead.platform || 'website';
  const { persona, activeModules, addedTools } = getActivePersonaModules(senderSettings, tierLevel);
  const senderName = senderSettings?.senderName || 'Your Name';
  const senderService = senderSettings?.senderService || persona.defaultService;
  const score = auditReport.overallScore ?? 72;
  const rawFindings = Array.isArray(auditReport.findings) ? [...auditReport.findings] : [];
  const signals = lead.signals || {};

  // Add module-specific synthesized findings so each persona gets its exact pitch ammunition
  const activeSocials = [
    lead.facebook && 'Facebook',
    lead.instagram && 'Instagram',
    lead.twitter && 'X/Twitter',
    lead.linkedin && 'LinkedIn',
    lead.youtube && 'YouTube',
    lead.tiktok && 'TikTok'
  ].filter(Boolean);
  const missingSocials = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok'].filter(s => !activeSocials.includes(s));

  if (activeSocials.length === 0) {
    rawFindings.push({
      category: 'seo',
      module: 'social_brand',
      severity: 'Critical',
      title: 'No linked social media presence (Instagram, Facebook, LinkedIn, TikTok)',
      detail: 'Zero social media profiles are linked from the website or business listing.',
      recommendation: 'Connect active Instagram, Facebook, LinkedIn, and TikTok profiles with visible social proof.',
      businessImpact: 'Hurts brand trust and misses organic social discovery from local customers.'
    });
  } else if (missingSocials.length > 0) {
    rawFindings.push({
      category: 'seo',
      module: 'social_brand',
      severity: 'Warning',
      title: `Incomplete social presence (active on ${activeSocials.join(', ')}; missing ${missingSocials.join(', ')})`,
      detail: `Missing linked profiles on ${missingSocials.join(', ')}.`,
      recommendation: `Add and cross-link ${missingSocials.join(' & ')} channels to strengthen brand authority.`,
      businessImpact: 'Leaves organic reach and retargeting touchpoints on the table.'
    });
  }

  if (lead.searchRank && lead.searchRank > 10) {
    rawFindings.push({
      category: 'seo',
      module: 'seo_local',
      severity: 'Critical',
      title: `Low local search visibility (Bing Rank #${lead.searchRank}, Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)})`,
      detail: `Currently ranked #${lead.searchRank} for "${industry} in ${city}".`,
      recommendation: 'Optimize local SEO citations, on-page headings, and schema markup to reach Page 1.',
      businessImpact: 'High-intent local buyers click Page 1 competitors first.'
    });
  }

  if (signals.hasAnalytics === false) {
    rawFindings.push({
      category: 'bugs',
      module: 'ads_funnel',
      severity: 'Critical',
      title: 'Missing Meta Pixel, TikTok Pixel & Google Analytics conversion tracking',
      detail: 'No ad retargeting or conversion attribution pixels were detected on the website.',
      recommendation: 'Install Meta Pixel, Google Tag Manager (GA4), and conversion event tracking.',
      businessImpact: '95%+ of visitors leave without being retargeted or tracked in your ad funnel.'
    });
  }
  if (signals.hasBookingOrForm === false) {
    rawFindings.push({
      category: 'bugs',
      module: 'ads_funnel',
      severity: 'Critical',
      title: 'Missing above-the-fold lead capture or instant booking funnel',
      detail: 'No instant quote, appointment, or lead capture form was detected.',
      recommendation: 'Add a high-converting lead capture form and instant WhatsApp/Live Chat trigger.',
      businessImpact: 'Visitors ready to inquire have no frictionless way to convert online.'
    });
  }
  if ((platform === 'Shopify' || platform === 'WooCommerce') && !signals.hasReviewsApp) {
    rawFindings.push({
      category: 'bugs',
      module: 'ecommerce_cro',
      severity: 'Warning',
      title: `Missing e-commerce product review & retention apps on ${platform}`,
      detail: 'No Judge.me, Loox, Yotpo, or Klaviyo retention flow signature detected.',
      recommendation: 'Add verified product review widgets and automated Klaviyo abandoned-cart flows.',
      businessImpact: 'Lifts product page add-to-cart rate and recovers 15–25% of abandoned checkouts.'
    });
  }

  // Filter findings strictly to the active persona + checked added tools!
  const { primary: findings } = filterAuditFindingsForPersona(rawFindings, senderSettings, tierLevel);

  const sortedFindings = [...findings].sort((a, b) => {
    const weight = { Critical: 3, Warning: 2, Info: 1 };
    return (weight[b.severity] || 0) - (weight[a.severity] || 0);
  });
  const top3 = sortedFindings.slice(0, 3);
  const allBullets = (sortedFindings.length ? sortedFindings : [{
    title: `${persona.label} growth & conversion opportunities`,
    businessImpact: 'Visitors searching online may leave before converting into paying clients.'
  }]).map(f => `• ${f.title} — ${f.businessImpact}`);

  const profileContextParts = [
    `Platform: ${platform}`,
    activeModules.has('seo_local') && lead.searchRank ? `Search Rank: #${lead.searchRank}` : null,
    activeModules.has('seo_local') ? (lead.rating ? `Rating: ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}` : 'No map reviews listed') : null,
    activeModules.has('social_brand') ? (activeSocials.length ? `Socials: ${activeSocials.join(', ')} (missing ${missingSocials.join(', ') || 'none'})` : 'Socials: None linked') : null,
    activeModules.has('ads_funnel') ? (signals.hasAnalytics ? 'Pixels: Active' : 'Pixels: None detected') : null,
    lead.email ? `Email: ${lead.email}` : null
  ].filter(Boolean).join(' · ');

  const activeLensLabel = `${persona.title}${addedTools.length ? ` + ${addedTools.map(k => PERSONA_TOOL_MODULES[k]?.shortLabel).filter(Boolean).join(', ')}` : ''}`;

  const executiveSummary =
    `[${activeLensLabel} Lens] ${name} (${profileContextParts}) scored ${score}/100 ` +
    `with ${sortedFindings.length} persona-relevant finding${sortedFindings.length === 1 ? '' : 's'} ` +
    `(${sortedFindings.filter(f => f.severity === 'Critical').length} critical). ` +
    `Addressing these specific ${persona.label.toLowerCase()} lapses will directly increase ${name}’s conversions and revenue.`;

  const extraLine = extraContext ? `\n\n${String(extraContext).trim()}` : '';

  // 1. Short Cold Email (tailored to active persona + checked added tools)
  const shortFindings = sortedFindings.slice(0, 3).map(f => `• ${f.title}`).join('\n');
  const coldEmailSubject = `${persona.label} review for ${name} in ${city}`.slice(0, 85);
  const coldEmailBody =
    `Hi ${name} team,\n\n` +
    `As a ${persona.title.toLowerCase()}, I ran a quick review of ${name} in ${city} (${profileContextParts}) and spotted ${sortedFindings.length || 'a few'} specific fix${sortedFindings.length === 1 ? '' : 'es'} in my area of specialty that could unlock more clients right away:\n\n` +
    `${shortFindings || `• High-impact ${persona.label.toLowerCase()} & conversion improvements`}\n\n` +
    `I help ${industry.toLowerCase()} brands with ${senderService}. Fixing these specific gaps removes friction and turns more of your traffic into paying customers.${extraLine}\n\n` +
    `Mind if I send over a quick 60-second walkthrough showing the exact fixes?\n\n` +
    `Best,\n${senderName}`;

  // 2. Detailed Audit Email (focused on active persona + checked added tools)
  const detailedEmailSubject = `${persona.title} audit & growth ideas for ${name}`.slice(0, 85);
  const detailedEmailBody =
    `Hi ${name} team,\n\n` +
    `While reviewing ${industry.toLowerCase()} businesses in ${city}, I did a focused ${persona.label.toLowerCase()} review of ${name} (${auditReport.url || lead.website || name}).\n\n` +
    `Focused Snapshot (${activeLensLabel}): ${profileContextParts}${activeModules.has('web_tech') ? ` · Technical Score: ${score}/100` : ''}${activeModules.has('web_tech') && auditReport.ttfbMs ? ` · Response Time: ${auditReport.ttfbMs}ms` : ''}.\n\n` +
    `I’m ${senderName}, and I specialize in ${senderService}. Looking strictly at what impacts my craft for ${name}, here are the exact issues and missed opportunities I uncovered:\n\n` +
    `${allBullets.join('\n')}\n\n` +
    `Resolving these ${persona.label.toLowerCase()} lapses makes an immediate, measurable difference in how customers experience ${name} and convert.${extraLine}\n\n` +
    `I’ve already mapped out a practical implementation plan for ${name}. Would you be open to me sending it over, or hopping on a brief 10-minute call this week?\n\n` +
    `Best regards,\n${senderName}`;

  // 3. LinkedIn / WhatsApp DM Version (conversational, persona-specific)
  const dmMessage =
    `Hey ${name} team! 👋 I’m a ${persona.label.toLowerCase()} and was checking out ${name} in ${city} — I noticed ${top3.length >= 2 ? `2 quick things (${top3[0].title.toLowerCase()} & ${top3[1].title.toLowerCase()})` : (top3[0]?.title?.toLowerCase() || `a quick ${persona.label.toLowerCase()} win`)} that could help you get more customers. I put together a 60-sec breakdown—cool if I drop it here?`;

  // 4. Loom / Audit Call Talking Points
  const loomTalkingPoints = [
    `1. Opener (0:00–0:20): Introduce yourself as a ${persona.title} (${senderName}) and show ${name} in ${city} (${profileContextParts}).`,
    ...top3.map((f, idx) => `${idx + 2}. Finding #${idx + 1} (${f.severity}): Show "${f.title}". Explain business impact: ${f.businessImpact} Fix: ${f.recommendation}`),
    `${top3.length + 2}. Close & CTA (1:30–2:00): Explain how you can resolve these ${persona.label.toLowerCase()} gaps within a few days via ${senderService}. Invite them to reply for the 4-phase action plan.`
  ].join('\n\n');

  return {
    personaId: persona.id,
    personaLabel: activeLensLabel,
    executiveSummary,
    topLapses: top3,
    variants: {
      coldEmail: { subject: coldEmailSubject, body: coldEmailBody },
      detailedEmail: { subject: detailedEmailSubject, body: detailedEmailBody },
      dmMessage,
      loomTalkingPoints
    }
  };
}

export function generateLeadSolutionPack(lead = {}, senderSettings = {}, tierLevel = 5) {
  const name = lead.name || 'Client Business';
  const industry = lead.industry || 'Local Business';
  const city = lead.city || 'your market';
  const platform = lead.auditReport?.stack?.platform || lead.platform || 'Website';
  const { persona, activeModules, addedTools } = getActivePersonaModules(senderSettings, tierLevel);
  const senderName = senderSettings?.senderName || 'Your Name';
  const senderService = senderSettings?.senderService || persona.defaultService;
  const signals = lead.signals || {};
  const rawAuditFindings = Array.isArray(lead.auditReport?.findings) ? lead.auditReport.findings : [];
  const { primary: auditFindings } = filterAuditFindingsForPersona(rawAuditFindings, senderSettings, tierLevel);

  const activeSocials = [
    lead.facebook && 'Facebook',
    lead.instagram && 'Instagram',
    lead.twitter && 'X/Twitter',
    lead.linkedin && 'LinkedIn',
    lead.youtube && 'YouTube',
    lead.tiktok && 'TikTok'
  ].filter(Boolean);
  const missingSocials = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok'].filter(s => !activeSocials.includes(s));

  const spottedList = String(lead.userSpottedIssues || '')
    .split(/[\r\n;]+/)
    .map(s => s.replace(/^[\s•\-*]+/, '').trim())
    .filter(Boolean);

  // Build Problem -> Solution -> Outcome matrix strictly for activeModules
  const matrix = [];
  const addRow = (problem, solution, expectedOutcome, phase) => {
    if (!matrix.some(r => r.problem.toLowerCase() === problem.toLowerCase())) {
      matrix.push({ problem, solution, expectedOutcome, phase });
    }
  };

  for (const issue of spottedList) {
    addRow(
      `Custom Spotted Issue: ${issue}`,
      `Resolve "${issue}" directly on ${name}’s ${platform} setup and verify across mobile & desktop viewports.`,
      'Eliminates immediate visitor friction and recovers lost inquiries.',
      'Phase 1'
    );
  }

  if (activeModules.has('web_tech')) {
    if (!lead.website) {
      addRow(
        'No official website or dedicated landing page linked on listing',
        'Design and build a fast, mobile-first website with responsive UI/UX, service showcase, and clean architecture.',
        'Gives customers a professional 24/7 digital storefront that builds immediate trust.',
        'Phase 1'
      );
    } else if (signals.https === false) {
      addRow(
        'Website served over unencrypted HTTP ("Not Secure" warning)',
        'Provision SSL/TLS certificate, enforce 301 HTTPS redirects, and harden HTTP security headers.',
        'Restores browser padlock trust and protects visitor sessions.',
        'Phase 1'
      );
    }
  }

  if (activeModules.has('ads_funnel')) {
    if (!signals.hasBookingOrForm) {
      addRow(
        'No instant online booking or lead capture funnel',
        'Build an above-the-fold lead magnet / instant quote form wired to automated CRM notifications.',
        'Converts paid and organic visitors who prefer booking online.',
        'Phase 1'
      );
    }
    if (!signals.hasChatWidget) {
      addRow(
        'No Live Chat or WhatsApp quick-response conversion widget',
        'Install a floating WhatsApp / Live Chat widget with automated lead qualification prompts.',
        'Captures mobile and after-hours prospect inquiries immediately.',
        'Phase 2'
      );
    }
    if (!signals.hasAnalytics) {
      addRow(
        'Missing Meta Pixel, TikTok Pixel & Google Analytics 4 conversion tracking',
        'Deploy GTM, Meta Pixel, TikTok Pixel, and server/browser conversion event tracking.',
        'Enables retargeting campaigns and lowers Cost Per Lead (CPL).',
        'Phase 1'
      );
    }
  }

  // Pull in filtered Website Audit findings
  for (const f of auditFindings) {
    const phaseLabel = f.category === 'bugs' || f.category === 'security'
      ? 'Phase 1'
      : f.category === 'seo' || f.category === 'performance'
        ? 'Phase 2'
        : 'Phase 3';
    addRow(f.title, f.recommendation, f.businessImpact, phaseLabel);
  }

  if (activeModules.has('social_brand')) {
    if (activeSocials.length === 0) {
      addRow(
        'Lack of linked social media presence (Instagram, Facebook, LinkedIn, TikTok)',
        'Revamp and link official social channels, configure Open Graph preview cards, and launch short-form content pillars.',
        'Builds immediate brand credibility and organic social inquiry flow.',
        'Phase 1'
      );
    } else if (missingSocials.length > 0) {
      addRow(
        `Incomplete social footprint (missing ${missingSocials.join(', ')})`,
        `Expand brand presence to ${missingSocials.join(' & ')} and cross-link social proof on ${platform}.`,
        'Increases omnichannel brand reach and DM conversions.',
        'Phase 2'
      );
    }
  }

  if (activeModules.has('seo_local')) {
    if (lead.searchRank && lead.searchRank > 10) {
      addRow(
        `Buried at Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}) for "${industry} in ${city}"`,
        `Optimize local citations, on-page city/industry headings, and LocalBusiness JSON-LD schema for ${city}.`,
        'Moves listing toward Page 1 where 80%+ of local search clicks happen.',
        'Phase 2'
      );
    }
    if (!lead.rating || parseFloat(lead.rating) < 4.4) {
      addRow(
        `Local review proof gap (${lead.rating ? `★ ${lead.rating}` : 'no reviews displayed'})`,
        'Launch automated review generation flow and embed top customer reviews on key landing pages.',
        'Higher star rating and review volume lift local pack CTR by 20–35%.',
        'Phase 3'
      );
    }
  }

  if (activeModules.has('ecommerce_cro')) {
    if (!signals.hasReviewsApp) {
      addRow(
        `Missing verified product review widget on ${platform}`,
        'Install Judge.me / Loox photo & video review widgets across product and collection templates.',
        'Increases product page conversion rate by 15–30%.',
        'Phase 2'
      );
    }
    addRow(
      'Untapped e-commerce retention & abandoned-cart recovery flows',
      'Deploy Klaviyo / Omnisend automated abandoned-cart, welcome, and win-back email/SMS sequences.',
      'Recovers 15–25% of abandoned checkouts automatically.',
      'Phase 3'
    );
  }

  if (!matrix.length) {
    addRow(
      `${persona.title} optimization & conversion scaling`,
      `Execute tailored ${persona.label.toLowerCase()} improvements across ${name}’s digital footprint.`,
      'Drives measurable lift in client inquiries and conversion rate.',
      'Phase 1'
    );
  }

  const makeTasks = (prefix, list) => list.filter(Boolean).map((text, idx) => ({ id: `${prefix}_${idx + 1}`, text, done: false }));
  const addedTasks = addedTools.map(k => {
    if (k === 'web_tech') return `Added Tool — Web Dev & Speed: Fix responsive mobile layout, broken links, and speed bottlenecks on ${platform}`;
    if (k === 'ads_funnel') return 'Added Tool — Ads & Funnels: Install Meta/Google tracking pixels, instant lead capture form, and WhatsApp chat widget';
    if (k === 'seo_local') return `Added Tool — SEO & Local Rank: Optimize Titles/Meta/H1, JSON-LD Schema, and local map pack ranking in ${city}`;
    if (k === 'social_brand') return `Added Tool — Social Media: Link & optimize ${missingSocials.join(', ') || 'Instagram, TikTok & Facebook'} profiles + Open Graph share cards`;
    if (k === 'ecommerce_cro') return `Added Tool — E-Com CRO: Deploy product review widgets and automated Klaviyo abandoned-cart recovery flows`;
    return null;
  }).filter(Boolean);

  let phaseDefs;
  if (persona.id === 'web_dev') {
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–3',
        title: 'UI/UX Audit, Mobile Viewport & Bug Resolution',
        goal: 'Eliminate broken links, layout shifts, and mobile responsiveness bugs.',
        deliverables: 'Mobile-first viewport fix, clean navigation, and form validation repair',
        tasks: [
          ...spottedList.map(s => `Fix spotted issue: ${s}`),
          !lead.website ? `Architect & wireframe new responsive website for ${name}` : `Fix mobile viewport scaling and broken links/assets on ${platform}`,
          'Repair form submit triggers, input labels, and mobile CTA button placement'
        ]
      },
      {
        badge: 'Phase 2 · Days 4–7',
        title: `${platform} Frontend Modernization & Conversion Layout`,
        goal: `Give ${name} a modern, fast-loading interface that turns visitors into inquiries.`,
        deliverables: 'Redesigned hero section, clear service/product layout, and mobile click-to-call bar',
        tasks: [
          `Modernize above-the-fold hero layout and primary call-to-action on ${platform}`,
          'Streamline navigation architecture and responsive grid across mobile/tablet/desktop'
        ]
      },
      {
        badge: 'Phase 3 · Week 2',
        title: 'Core Web Vitals Speed & Security Hardening',
        goal: 'Cut page load time and lock down HTTPS and browser security hygiene.',
        deliverables: 'Deferred render-blocking scripts, lazy-loaded assets, SSL & HTTP security headers',
        tasks: [
          'Defer render-blocking JavaScript bundles and enable native image lazy-loading',
          'Configure edge caching (Cache-Control / CDN) to drop server TTFB under 500ms',
          'Enforce HTTPS, eliminate mixed-content URLs, and add HSTS/CSP/X-Frame-Options headers'
        ]
      },
      {
        badge: 'Phase 4 · Week 3',
        title: 'Cross-Device QA, Added Integrations & Handover',
        goal: 'Verify 90+ health score across devices and deploy any added growth modules.',
        deliverables: 'Before/after performance audit report, QA sign-off, and live deployment',
        tasks: [
          ...addedTasks,
          'Run full cross-browser & mobile device QA and deliver before/after speed & health report'
        ]
      }
    ];
  } else if (persona.id === 'digital_marketer') {
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–3',
        title: 'Ad Pixel Attribution & Conversion Tracking Setup',
        goal: 'Stop flying blind—track every visitor, click, call, and form submission.',
        deliverables: 'Google Tag Manager, GA4, Meta Pixel, TikTok Pixel & conversion events',
        tasks: [
          ...spottedList.map(s => `Fix spotted funnel issue: ${s}`),
          'Install Google Tag Manager (GTM), GA4, Meta Pixel, and TikTok Pixel',
          'Configure custom conversion events for lead forms, phone clicks, and WhatsApp chats'
        ]
      },
      {
        badge: 'Phase 2 · Days 4–7',
        title: 'High-Converting Landing Page & Lead Capture Funnel',
        goal: `Turn ${name}’s existing traffic into captured leads and booked appointments.`,
        deliverables: 'Above-the-fold instant quote/booking funnel + floating WhatsApp/Live Chat widget',
        tasks: [
          'Deploy high-converting instant quote / appointment booking form with irresistible offer hook',
          'Add floating WhatsApp / Live Chat widget to capture mobile & after-hours traffic'
        ]
      },
      {
        badge: 'Phase 3 · Week 2',
        title: 'Retargeting & Paid Acquisition Campaign Launch',
        goal: `Bring back bounced visitors and capture high-intent buyers in ${city}.`,
        deliverables: 'Custom retargeting audiences, ad creative hooks, and local lead campaigns',
        tasks: [
          `Build custom retargeting audiences for ${name}’s website visitors and social engagers`,
          `Launch targeted local lead-generation campaigns for ${industry.toLowerCase()} buyers in ${city}`
        ]
      },
      {
        badge: 'Phase 4 · Weeks 3–4',
        title: 'Automated Lead Nurture & ROAS Scaling',
        goal: 'Follow up with every lead within 60 seconds and scale winning ad angles.',
        deliverables: 'Automated email/SMS speed-to-lead sequence + live CPL/ROAS dashboard',
        tasks: [
          ...addedTasks,
          'Connect instant email/SMS speed-to-lead follow-up automation so no inquiry goes cold',
          'Deliver weekly conversion rate & Cost-Per-Lead performance dashboard'
        ]
      }
    ];
  } else if (persona.id === 'seo_specialist') {
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–4',
        title: 'Technical SEO, Crawlability & Indexing Foundation',
        goal: 'Ensure Google, Bing, and AI search engines can crawl and index every page cleanly.',
        deliverables: 'Clean /robots.txt, /sitemap.xml, canonical tags, and indexing fix',
        tasks: [
          ...spottedList.map(s => `Fix spotted SEO issue: ${s}`),
          'Publish optimized /robots.txt and dynamic /sitemap.xml and submit to Search Console',
          'Add canonical URL tags and resolve duplicate/unindexed URL variations'
        ]
      },
      {
        badge: 'Phase 2 · Days 5–10',
        title: `On-Page Keyword, Heading & Content Optimization (${city})`,
        goal: `Align ${name}’s titles, meta descriptions, and H1 hierarchy with high-intent "${industry} in ${city}" searches.`,
        deliverables: 'Optimized <title>, <meta description>, H1->H2->H3 hierarchy & image alt text',
        tasks: [
          `Rewrite homepage & core service <title> and <meta name="description"> for "${industry} in ${city}"`,
          'Restructure single primary <h1> and semantic <h2>/<h3> subheadings with descriptive image alt tags',
          'Expand thin indexable HTML copy with authoritative service & location content'
        ]
      },
      {
        badge: 'Phase 3 · Weeks 2–3',
        title: 'JSON-LD Schema Markup & Local Map Pack Authority',
        goal: `Climb from ${lead.searchRank ? `Rank #${lead.searchRank}` : 'current position'} into the Page 1 Local Pack in ${city}.`,
        deliverables: 'LocalBusiness JSON-LD Schema, NAP citation alignment & review velocity workflow',
        tasks: [
          'Deploy Schema.org JSON-LD (LocalBusiness / Service / FAQPage) for rich search snippets',
          `Optimize local map listing in ${city} (complete operating hours, categories, photos & review response flow)`
        ]
      },
      {
        badge: 'Phase 4 · Week 4+',
        title: 'Search Ranking Growth, Added Tools & Monthly Reporting',
        goal: 'Track Page 1 keyword movement and organic lead growth.',
        deliverables: 'Keyword rank tracker, organic click report, and authority growth roadmap',
        tasks: [
          ...addedTasks,
          `Deliver before/after rank tracking report for "${industry} in ${city}" and ongoing content plan`
        ]
      }
    ];
  } else if (persona.id === 'social_media') {
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–4',
        title: 'Social Profile Revamp, Bio Funnel & Website Cross-Linking',
        goal: `Connect and brand ${name}’s official social presence across top discovery platforms.`,
        deliverables: 'Optimized Instagram, TikTok, Facebook & LinkedIn profiles linked to website',
        tasks: [
          ...spottedList.map(s => `Fix spotted social issue: ${s}`),
          activeSocials.length === 0
            ? 'Set up, brand, and link official Instagram, Facebook, TikTok & LinkedIn profiles on the website'
            : `Optimize ${activeSocials.join(', ')} and expand brand footprint to ${missingSocials.join(', ') || 'all core channels'}`,
          'Configure Open Graph (og:title, og:image) tags so shared links render rich branded preview cards'
        ]
      },
      {
        badge: 'Phase 2 · Days 5–10',
        title: 'Content Pillar Strategy & Short-Form Video / Reel Calendar',
        goal: `Position ${name} as the go-to ${industry.toLowerCase()} brand in ${city}.`,
        deliverables: '30-day content calendar, short-form Reel/TikTok templates & brand highlight covers',
        tasks: [
          `Build 4 high-converting content pillars tailored to ${industry.toLowerCase()} customers in ${city}`,
          'Create pinned intro posts, customer proof highlights, and short-form video hooks'
        ]
      },
      {
        badge: 'Phase 3 · Weeks 2–3',
        title: 'Social Proof Integration & DM-to-Lead Conversion Funnel',
        goal: 'Turn social followers, comments, and profile visits into direct bookings and inquiries.',
        deliverables: 'On-site social feed/review embed + automated DM/WhatsApp inquiry flow',
        tasks: [
          'Embed live social proof & customer testimonial highlights on the website',
          'Set up frictionless DM keyword triggers and WhatsApp click-to-chat links in every bio'
        ]
      },
      {
        badge: 'Phase 4 · Week 4+',
        title: 'Community Growth, Added Tools & Engagement Analytics',
        goal: 'Scale local reach, follower engagement, and inbound DM leads.',
        deliverables: 'Monthly reach, engagement & DM lead attribution report',
        tasks: [
          ...addedTasks,
          'Deliver monthly social reach, engagement, and inbound DM conversion report'
        ]
      }
    ];
  } else if (persona.id === 'shopify_cro') {
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–4',
        title: `${platform} Storefront UX, Mobile Speed & Checkout Hygiene`,
        goal: 'Remove mobile shopping friction that causes cart abandonment.',
        deliverables: 'Theme speed optimization, sticky Add-to-Cart, and mobile checkout cleanup',
        tasks: [
          ...spottedList.map(s => `Fix spotted store issue: ${s}`),
          `Audit and optimize ${lead.shopifyMeta?.themeName ? `Shopify "${lead.shopifyMeta.themeName}" theme` : `${platform} storefront`} mobile product page layout`,
          'Defer heavy app scripts, enable native image lazy-loading, and speed up Add-to-Cart interaction'
        ]
      },
      {
        badge: 'Phase 2 · Days 5–10',
        title: 'Product Page Social Proof & Conversion Rate Optimization (CRO)',
        goal: 'Lift product page conversion rate with verified reviews, trust badges, and bundles.',
        deliverables: 'Judge.me/Loox photo reviews, trust badges, and average-order-value (AOV) upsells',
        tasks: [
          'Install and style verified photo/video product review widgets (Judge.me / Loox / Yotpo)',
          'Add clear shipping/returns trust badges, urgency indicators, and in-cart cross-sell offers'
        ]
      },
      {
        badge: 'Phase 3 · Weeks 2–3',
        title: 'Klaviyo / Omnisend Automated Cart Recovery & Retention Flows',
        goal: 'Recover 15–25% of abandoned checkouts and drive repeat purchases automatically.',
        deliverables: 'Abandoned Cart, Browse Abandonment, Welcome Series & Post-Purchase flows',
        tasks: [
          'Deploy 3-part Abandoned Cart & Checkout recovery email/SMS sequence',
          'Launch Welcome offer pop-up and post-purchase repeat buyer flow'
        ]
      },
      {
        badge: 'Phase 4 · Week 4',
        title: 'Attribution Pixels, Added Tools & Revenue Scaling',
        goal: 'Track store conversion rate, AOV, and recovered revenue.',
        deliverables: 'E-commerce conversion report + ongoing A/B test roadmap',
        tasks: [
          ...addedTasks,
          'Verify purchase pixel attribution and deliver before/after conversion & AOV report'
        ]
      }
    ];
  } else {
    // Full-Service Digital Agency
    phaseDefs = [
      {
        badge: 'Phase 1 · Days 1–4',
        title: 'Quick Wins, Website UX & Conversion Capture Setup',
        goal: 'Stop immediate visitor leaks and make it effortless for visitors to convert.',
        deliverables: 'Mobile UX & bug fixes, HTTPS/security hygiene, instant lead form + Live Chat widget',
        tasks: [
          ...spottedList.map(s => `Fix spotted issue: ${s}`),
          !lead.website ? 'Launch mobile-first conversion landing page' : `Resolve mobile viewport, broken links, and speed bottlenecks on ${platform}`,
          'Install high-converting instant quote / booking form & floating WhatsApp / Live Chat widget'
        ]
      },
      {
        badge: 'Phase 2 · Days 5–10',
        title: 'Ad Tracking Pixels & High-Intent Lead Funnel',
        goal: 'Track every visitor and retarget bounced traffic into booked clients.',
        deliverables: 'GA4, Meta/TikTok Pixels, conversion event tracking & retargeting setup',
        tasks: [
          'Deploy Google Analytics 4, Meta Pixel, and conversion tracking on all forms and calls',
          'Launch automated speed-to-lead email/SMS follow-up sequence'
        ]
      },
      {
        badge: 'Phase 3 · Weeks 2–3',
        title: 'Search Visibility, Social Proof & Brand Authority',
        goal: `Strengthen ${name}’s local market authority in ${city}.`,
        deliverables: 'On-site review showcase, local trust signals & active added growth channels',
        tasks: [
          ...addedTasks,
          'Embed verified customer reviews / testimonials widget across homepage and conversion pages'
        ]
      },
      {
        badge: 'Phase 4 · Week 4',
        title: 'Full-Funnel QA, Reporting & Growth Scaling',
        goal: 'Measure lead volume lift and scale highest-ROI acquisition channels.',
        deliverables: 'Before/after health report and monthly executive growth dashboard',
        tasks: [
          'Deliver final before/after audit score report and monthly client acquisition dashboard'
        ]
      }
    ];
  }

  const phases = phaseDefs.map((p, idx) => ({
    id: `phase_${idx + 1}`,
    badge: p.badge,
    title: p.title,
    goal: p.goal,
    deliverables: p.deliverables,
    tasks: makeTasks(`p${idx + 1}`, p.tasks)
  }));

  const activeLensLabel = `${persona.title}${addedTools.length ? ` + ${addedTools.map(k => PERSONA_TOOL_MODULES[k]?.shortLabel).filter(Boolean).join(', ')}` : ''}`;
  const replyProposalSubject = `${persona.label} Action Plan & 4-Phase Roadmap for ${name}`.slice(0, 88);
  const replyProposalBody =
    `Hi ${name} team,\n\n` +
    `Thanks for getting back to me! As a ${persona.title.toLowerCase()}, I put together a focused 4-Phase Solution Pack tailored specifically to the ${persona.label.toLowerCase()} opportunities we uncovered for ${name} in ${city}.\n\n` +
    `Here is how we solve each issue step-by-step without disrupting your day-to-day operations:\n\n` +
    phases.map(p =>
      `${p.badge.toUpperCase()} — ${p.title}\n` +
      `Goal: ${p.goal}\n` +
      p.tasks.map(t => `  ✓ ${t.text}`).join('\n')
    ).join('\n\n') +
    `\n\nEXPECTED OUTCOME FOR ${name.toUpperCase()}:\n` +
    matrix.slice(0, 3).map(m => `• ${m.expectedOutcome}`).join('\n') +
    `\n\nWould you like to kick off with Phase 1 this week, or hop on a quick 10-minute call to walk through the roadmap?\n\n` +
    `Best regards,\n${senderName}\n${senderService}`;

  return {
    generatedAt: new Date().toISOString(),
    personaId: persona.id,
    personaLabel: activeLensLabel,
    businessName: name,
    industry,
    city,
    platform,
    matrix,
    phases,
    replyProposalSubject,
    replyProposalBody
  };
}

export function buildSolutionPackHtml(pack = {}, lead = {}, senderSettings = {}) {
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = esc(pack.businessName || lead.name || 'Client');
  const city = esc(pack.city || lead.city || '');
  const industry = esc(pack.industry || lead.industry || '');
  const platform = esc(pack.platform || lead.platform || 'Website');
  const senderName = esc(senderSettings?.senderName || 'Outreach Specialist');
  const senderService = esc(senderSettings?.senderService || 'Digital Growth & Conversion');
  const score = lead.auditReport?.overallScore ?? 'N/A';

  const matrixRows = (pack.matrix || []).map(r => `
    <tr>
      <td><strong>${esc(r.problem)}</strong></td>
      <td>${esc(r.solution)}</td>
      <td>${esc(r.expectedOutcome)}</td>
      <td><span class="tag">${esc(r.phase)}</span></td>
    </tr>`).join('');

  const phaseCards = (pack.phases || []).map(p => `
    <div class="phase">
      <div class="phase-top"><span class="tag">${esc(p.badge)}</span><h3>${esc(p.title)}</h3></div>
      <p class="goal">${esc(p.goal)}</p>
      <ul>${(p.tasks || []).map(t => `<li>✓ ${esc(t.text)}</li>`).join('')}</ul>
      <div class="deliv"><strong>Deliverables:</strong> ${esc(p.deliverables)}</div>
    </div>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Solution Pack &amp; Roadmap — ${name}</title>
<style>
  body{font-family:Inter,-apple-system,Segoe UI,sans-serif;color:#0f2a2e;background:#f5f8f9;margin:0;padding:32px 18px;line-height:1.55}
  .wrap{max-width:920px;margin:auto;background:#fff;border:1px solid #dce7e4;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.06)}
  .hero{background:linear-gradient(135deg,#042e2a,#0a4f44);color:#fff;padding:28px 32px}
  .hero h1{margin:0 0 6px;font-size:26px}
  .hero p{margin:0;color:#bfe0d8;font-size:14px}
  .sec{padding:24px 32px;border-bottom:1px solid #e6eeec}
  h2{margin:0 0 14px;font-size:18px;color:#052e2b}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .phase{border:1px solid #dce7e4;border-radius:12px;padding:16px;background:#fafcfc}
  .phase h3{margin:6px 0;font-size:15.5px}
  .goal{margin:0 0 10px;font-size:13px;color:#5b7479}
  .phase ul{margin:0 0 10px;padding-left:18px;font-size:13px}
  .deliv{font-size:12px;color:#065f46;background:#e6f7ef;padding:8px 10px;border-radius:8px}
  .tag{display:inline-block;background:#e6f7ef;color:#057a55;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:10px 12px;border-bottom:1px solid #e6eeec;text-align:left;vertical-align:top}
  th{background:#f7fafa;color:#5b7479;font-size:11.5px;text-transform:uppercase}
  .foot{padding:20px 32px;background:#f8fbfa;font-size:13px;color:#5b7479;display:flex;justify-content:space-between}
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>Client Solution Pack &amp; 4-Phase Growth Roadmap</h1>
      <p>Prepared for ${name} (${industry}${city ? ' · ' + city : ''}) · Platform: ${platform} · Initial Audit Score: ${esc(score)}/100</p>
    </div>
    <div class="sec">
      <h2>1. Phased Implementation Plan</h2>
      <div class="grid">${phaseCards}</div>
    </div>
    <div class="sec">
      <h2>2. Discovered Problems → Solutions → Expected ROI</h2>
      <table>
        <thead><tr><th>Problem Discovered</th><th>Proposed Solution</th><th>Expected Client Outcome</th><th>Phase</th></tr></thead>
        <tbody>${matrixRows}</tbody>
      </table>
    </div>
    <div class="foot">
      <span>Prepared by <strong>${senderName}</strong> (${senderService})</span>
      <span>Generated ${new Date().toLocaleDateString()}</span>
    </div>
  </div>
</body>
</html>`;
}
