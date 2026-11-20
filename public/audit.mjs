// Passive Website Audit, Platform Fingerprinting & Client Outreach Generator

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

export function generateClientOutreach(auditReport = {}, lead = {}, senderSettings = {}, extraContext = '') {
  const name = lead.name || 'your team';
  const city = lead.city || 'your area';
  const industry = lead.industry || 'business';
  const platform = auditReport.stack?.platform || lead.platform || 'website';
  const senderName = senderSettings?.senderName || 'Your Name';
  const senderService = senderSettings?.senderService || 'web conversion, SEO & digital growth';
  const score = auditReport.overallScore ?? 72;
  const findings = Array.isArray(auditReport.findings) ? [...auditReport.findings] : [];

  // Incorporate social media presence, local search rank, rating, and contactability gaps into audit outreach
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
    findings.push({
      category: 'seo',
      severity: 'Critical',
      title: 'No linked social media presence (Instagram, Facebook, LinkedIn, TikTok)',
      detail: 'Zero social media profiles are linked from the website or business listing.',
      recommendation: 'Connect active Instagram, Facebook, LinkedIn, and TikTok profiles with visible social proof.',
      businessImpact: 'Hurts brand trust and misses organic social discovery from local customers.'
    });
  } else if (missingSocials.length > 0) {
    findings.push({
      category: 'seo',
      severity: 'Warning',
      title: `Incomplete social presence (active on ${activeSocials.join(', ')}; missing ${missingSocials.join(', ')})`,
      detail: `Missing linked profiles on ${missingSocials.join(', ')}.`,
      recommendation: `Add and cross-link ${missingSocials.join(' & ')} channels to strengthen brand authority.`,
      businessImpact: 'Leaves organic reach and retargeting touchpoints on the table.'
    });
  }

  if (lead.searchRank && lead.searchRank > 10) {
    findings.push({
      category: 'seo',
      severity: 'Critical',
      title: `Low local search visibility (Bing Rank #${lead.searchRank}, Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)})`,
      detail: `Currently ranked #${lead.searchRank} for "${industry} in ${city}".`,
      recommendation: 'Optimize local SEO citations, on-page headings, and schema markup to reach Page 1.',
      businessImpact: 'High-intent local buyers click Page 1 competitors first.'
    });
  }

  const sortedFindings = [...findings].sort((a, b) => {
    const weight = { Critical: 3, Warning: 2, Info: 1 };
    return (weight[b.severity] || 0) - (weight[a.severity] || 0);
  });
  const top3 = sortedFindings.slice(0, 3);
  const allBullets = (sortedFindings.length ? sortedFindings : [{
    title: 'Conversion & local search capture gaps',
    businessImpact: 'Visitors searching online may leave before booking or requesting a quote.'
  }]).map(f => `• [${(f.category || 'AUDIT').toUpperCase()}] ${f.title} — ${f.businessImpact}`);

  const profileContextParts = [
    `Platform: ${platform}`,
    lead.searchRank ? `Search Rank: #${lead.searchRank}` : null,
    lead.rating ? `Rating: ★ ${lead.rating}${lead.ratingInfo ? ` (${lead.ratingInfo})` : ''}` : 'No map rating/reviews listed',
    activeSocials.length ? `Socials: ${activeSocials.join(', ')} (missing ${missingSocials.join(', ') || 'none'})` : 'Socials: None linked',
    lead.email ? `Email: ${lead.email}` : 'No public email listed',
    lead.phone ? `Phone: ${lead.phone}` : 'No phone listed'
  ].filter(Boolean).join(' · ');

  const executiveSummary =
    `${name} (${profileContextParts}) scored ${score}/100 in our 360° technical, SEO, social presence & conversion audit ` +
    `(${auditReport.counts?.critical || 0} critical, ${auditReport.counts?.warning || 0} warnings). ` +
    `Addressing the ${sortedFindings.length} discovered lapses below will directly improve local rankings, social credibility, mobile speed, and inbound customer leads.`;

  const extraLine = extraContext ? `\n\n${String(extraContext).trim()}` : '';

  // 1. Short Cold Email (referencing platform, social presence & top findings)
  const shortFindings = sortedFindings.slice(0, 4).map(f => `• ${f.title}`).join('\n');
  const coldEmailSubject = `Quick ${platform} & online presence audit for ${name} (${score}/100)`.slice(0, 85);
  const coldEmailBody =
    `Hi ${name} team,\n\n` +
    `I ran a quick 360° audit on ${name}’s ${platform} site and online presence in ${city} (${profileContextParts}) and noticed a few high-impact fixes that could unlock more inbound leads right away:\n\n` +
    `${shortFindings || '• Mobile conversion, social proof & local search visibility opportunities'}\n\n` +
    `I help ${industry.toLowerCase()} brands with ${senderService}. Fixing these directly boosts Google/Bing visibility, strengthens social trust, and stops mobile visitors from bouncing.${extraLine}\n\n` +
    `Mind if I send over a 60-second breakdown showing the exact fixes?\n\n` +
    `Best,\n${senderName}`;

  // 2. Detailed Audit Email (uses every single finding & business detail)
  const detailedEmailSubject = `Full online presence & ${platform} audit for ${name} in ${city}`.slice(0, 85);
  const detailedEmailBody =
    `Hi ${name} team,\n\n` +
    `While reviewing ${industry.toLowerCase()} businesses in ${city}, I did a complete review of ${name}’s online footprint (${auditReport.url || lead.website || name}).\n\n` +
    `Current Snapshot: ${profileContextParts} · Overall Health Score: ${score}/100${auditReport.ttfbMs ? ` · Server Response: ${auditReport.ttfbMs}ms` : ''}.\n\n` +
    `I’m ${senderName}, and I specialize in ${senderService}. Across your website, local search listing, and social presence, here is every specific lapse I found that is likely costing ${name} qualified inquiries and sales:\n\n` +
    `${allBullets.join('\n')}\n\n` +
    `Resolving these technical, SEO, and social proof gaps on ${platform} makes an immediate impact on how easily customers find ${name}, trust your brand, and reach out to buy or book.${extraLine}\n\n` +
    `I’ve already put together a tailored action plan for ${name}. Would you be open to me sending it over, or hopping on a brief 10-minute call this week?\n\n` +
    `Best regards,\n${senderName}`;

  // 3. LinkedIn / WhatsApp DM Version (conversational, low-friction)
  const dmMessage =
    `Hey ${name} team! 👋 I was checking out your ${platform} site in ${city} and spotted ${top3.length >= 2 ? `2 quick things (${top3[0].title.toLowerCase()} & ${top3[1].title.toLowerCase()})` : 'a quick conversion fix'} that could help you capture more leads from mobile visitors. I put together a quick 60-sec screenshot breakdown—cool if I drop it here?`;

  // 4. Loom / Audit Call Talking Points
  const loomTalkingPoints = [
    `1. Opener (0:00–0:20): Compliment ${name}’s brand in ${city} and show their ${platform} homepage (${score}/100 health score).`,
    ...top3.map((f, idx) => `${idx + 2}. Finding #${idx + 1} (${f.severity} — ${f.category.toUpperCase()}): Show "${f.title}". Explain impact: ${f.businessImpact} Fix: ${f.recommendation}`),
    `${top3.length + 2}. Close & CTA (1:30–2:00): Explain how ${senderName} can implement these fixes on ${platform} within a few days via ${senderService}. Invite them to reply or book a 10-min walkthrough.`
  ].join('\n\n');

  return {
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

export function generateLeadSolutionPack(lead = {}, senderSettings = {}) {
  const name = lead.name || 'Client Business';
  const industry = lead.industry || 'Local Business';
  const city = lead.city || 'your market';
  const platform = lead.auditReport?.stack?.platform || lead.platform || 'Website';
  const senderName = senderSettings?.senderName || 'Your Name';
  const senderService = senderSettings?.senderService || 'web conversion, SEO & digital growth';
  const signals = lead.signals || {};
  const auditFindings = Array.isArray(lead.auditReport?.findings) ? lead.auditReport.findings : [];

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

  // Build Problem -> Solution -> Outcome matrix
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

  if (!lead.website) {
    addRow(
      'No official website or dedicated landing page linked on listing',
      'Build and launch a fast, mobile-first conversion landing page with click-to-call, service showcase, and instant quote form.',
      'Gives high-intent searchers a 24/7 destination to trust and book with you.',
      'Phase 1'
    );
  } else {
    if (signals.https === false) {
      addRow(
        'Website served over unencrypted HTTP ("Not Secure" warning)',
        'Provision SSL/TLS certificate and enforce 301 HTTPS redirects across all pages and assets.',
        'Restores browser padlock trust and protects search rankings.',
        'Phase 1'
      );
    }
    if (!signals.hasBookingOrForm) {
      addRow(
        'No instant online booking or lead capture form',
        'Add an above-the-fold instant quote / appointment booking form with email & WhatsApp notifications.',
        'Captures visitors who prefer booking online rather than calling.',
        'Phase 1'
      );
    }
    if (!signals.hasChatWidget) {
      addRow(
        'No Live Chat or WhatsApp quick-response widget',
        'Install a floating WhatsApp / Live Chat widget with automated greeting and after-hours lead capture.',
        'Increases mobile visitor engagement and captures after-hours leads.',
        'Phase 1'
      );
    }
  }

  // Pull in Website Audit findings into their respective phases
  for (const f of auditFindings) {
    const phaseLabel = f.category === 'bugs' || f.category === 'security'
      ? 'Phase 1'
      : f.category === 'seo' || f.category === 'performance'
        ? 'Phase 2'
        : 'Phase 3';
    addRow(f.title, f.recommendation, f.businessImpact, phaseLabel);
  }

  // Social Media & Local Search gaps
  if (activeSocials.length === 0) {
    addRow(
      'Lack of linked social media presence (Instagram, Facebook, LinkedIn, TikTok)',
      'Set up, brand, and cross-link official social profiles on the website header/footer with embedded social proof.',
      'Builds immediate brand credibility and opens organic social discovery channels.',
      'Phase 3'
    );
  } else if (missingSocials.length > 0) {
    addRow(
      `Incomplete social footprint (missing ${missingSocials.join(', ')})`,
      `Connect and optimize ${missingSocials.join(' & ')} profiles and link them to your ${platform} site.`,
      'Expands multi-channel brand visibility and retargeting reach.',
      'Phase 3'
    );
  }

  if (lead.searchRank && lead.searchRank > 10) {
    addRow(
      `Buried at Rank #${lead.searchRank} (Page ${lead.searchPage || Math.ceil(lead.searchRank / 10)}) for "${industry} in ${city}"`,
      `Optimize local map citations, on-page city/industry headings, and LocalBusiness JSON-LD schema for ${city}.`,
      'Moves listing toward Page 1 where 80%+ of local clicks happen.',
      'Phase 3'
    );
  }

  if (!lead.rating || parseFloat(lead.rating) < 4.4) {
    addRow(
      `Local review proof gap (${lead.rating ? `★ ${lead.rating}` : 'no reviews displayed'})`,
      'Deploy an automated post-purchase / post-service review request flow and showcase top reviews on the homepage.',
      'Higher star rating and review count lift local conversion by 20–35%.',
      'Phase 3'
    );
  }

  if (!signals.hasAnalytics || (lead.platform === 'Shopify' && !signals.hasReviewsApp)) {
    addRow(
      'Missing conversion tracking pixels & automated retention flows',
      'Install Google Analytics 4, Meta/TikTok Pixels, and automated follow-up / abandoned-cart email sequences.',
      'Turns one-time visitors into tracked leads and repeat customers.',
      'Phase 4'
    );
  }

  // Build 4-Phase Implementation Roadmap
  const p1Tasks = [
    ...spottedList.map(s => `Fix spotted issue: ${s}`),
    !lead.website ? 'Launch mobile-first conversion landing page' : 'Resolve mobile viewport, broken links, and layout bugs',
    'Install high-converting instant quote / booking form & floating WhatsApp / Live Chat widget',
    'Enforce HTTPS security, fix mixed-content assets, and configure HTTP security headers'
  ];
  const p2Tasks = [
    `Optimize homepage & service <title>, <meta name="description">, and single primary <h1> for "${industry} in ${city}"`,
    'Add descriptive image alt attributes, canonical tags, Open Graph social cards, and JSON-LD Schema.org markup',
    'Publish clean /robots.txt and /sitemap.xml for faster Google & AI search indexing',
    `Speed optimization on ${platform}: defer render-blocking scripts, enable lazy-loading images, and edge caching`
  ];
  const p3Tasks = [
    activeSocials.length === 0
      ? 'Establish and link official Instagram, Facebook, LinkedIn & TikTok profiles to the website'
      : `Cross-link ${activeSocials.join(', ')} and expand presence to ${missingSocials.join(', ') || 'all key social channels'}`,
    `Local SEO boost in ${city}: align NAP (Name, Address, Phone, Hours) and target Page 1 local pack rankings`,
    'Embed verified customer reviews / testimonials widget on homepage and key conversion pages'
  ];
  const p4Tasks = [
    'Install Google Analytics 4 (GA4), Meta Pixel, and conversion event tracking on all forms, calls & checkouts',
    platform === 'Shopify' || platform === 'WooCommerce'
      ? 'Launch automated abandoned-cart, welcome, and repeat-buyer email flows (Klaviyo / Omnisend)'
      : 'Set up automated instant email/SMS lead follow-up sequence so no inquiry goes cold',
    'Deliver final before/after audit score report and monthly lead growth dashboard'
  ];

  const makeTasks = (prefix, list) => list.map((text, idx) => ({ id: `${prefix}_${idx + 1}`, text, done: false }));

  const phases = [
    {
      id: 'phase_1',
      badge: 'Phase 1 · Days 1–3',
      title: 'Quick Wins, Bug Fixes & Instant Lead Capture',
      goal: 'Stop immediate visitor leaks and make it effortless for mobile & desktop visitors to contact or buy.',
      deliverables: 'Mobile UX & bug fixes, HTTPS/security hygiene, instant lead form + WhatsApp/Live Chat widget',
      tasks: makeTasks('p1', p1Tasks)
    },
    {
      id: 'phase_2',
      badge: 'Phase 2 · Days 4–7',
      title: `On-Page SEO, Speed & ${platform} Optimization`,
      goal: `Make ${name} load fast and rank higher on Google, Bing, and AI search engines for ${industry.toLowerCase()} searches in ${city}.`,
      deliverables: 'Optimized Titles/Meta/H1, JSON-LD Schema, XML Sitemap, script deferral & Core Web Vitals tune-up',
      tasks: makeTasks('p2', p2Tasks)
    },
    {
      id: 'phase_3',
      badge: 'Phase 3 · Week 2',
      title: 'Social Media Presence, Reputation & Local Authority',
      goal: 'Build undeniable social proof and climb local map rankings ahead of competitors.',
      deliverables: 'Connected social profiles, local listing optimization, and on-site customer review showcase',
      tasks: makeTasks('p3', p3Tasks)
    },
    {
      id: 'phase_4',
      badge: 'Phase 4 · Weeks 3–4',
      title: 'Conversion Tracking, Retargeting & Automated Follow-Up',
      goal: 'Track every lead source and automatically nurture prospects into paying customers.',
      deliverables: 'GA4 & Ad Pixels, automated lead/cart follow-up sequences, and live performance report',
      tasks: makeTasks('p4', p4Tasks)
    }
  ];

  const replyProposalSubject = `Action Plan & 4-Phase Solution Roadmap for ${name}`.slice(0, 88);
  const replyProposalBody =
    `Hi ${name} team,\n\n` +
    `Thanks for getting back to me! As promised, I put together a clear, step-by-step Solution Pack & Phased Roadmap tailored specifically to the gaps we uncovered across ${name}’s ${platform} site, social media presence, and local search listing in ${city}.\n\n` +
    `Here is how we solve every issue in 4 focused phases without disrupting your day-to-day operations:\n\n` +
    phases.map(p =>
      `${p.badge.toUpperCase()} — ${p.title}\n` +
      `Goal: ${p.goal}\n` +
      p.tasks.map(t => `  ✓ ${t.text}`).join('\n')
    ).join('\n\n') +
    `\n\nEXPECTED OUTCOME FOR ${name.toUpperCase()}:\n` +
    `• Faster mobile experience and higher website health score (targeting 90+/100)\n` +
    `• Stronger local search visibility in ${city} and connected social media proof\n` +
    `• More qualified calls, form submissions, and customers captured automatically\n\n` +
    `I’ve attached the full Solution Pack breakdown for your review. Would you like to kick off with Phase 1 (Quick Wins & Lead Capture) this week, or hop on a quick 10-minute call to walk through the roadmap?\n\n` +
    `Best regards,\n${senderName}\n${senderService}`;

  return {
    generatedAt: new Date().toISOString(),
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
