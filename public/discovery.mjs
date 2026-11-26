export const platformDomains = {
  Shopify: 'myshopify.com',
  WooCommerce: '',
  BigCommerce: 'mybigcommerce.com',
  Wix: 'wixsite.com',
  Squarespace: 'squarespace.com',
  Webflow: 'webflow.io',
  WordPress: 'wordpress.com',
  Ghost: 'ghost.io',
  'HubSpot CMS': 'hubspotpagebuilder.com',
  Klaviyo: '',
  Mailchimp: 'mailchi.mp',
  Omnisend: '',
  Brevo: '',
  ActiveCampaign: '',
  Beehiiv: 'beehiiv.com',
  Substack: 'substack.com',
  Kit: 'kit.com',
  MailerLite: 'mailerlite.io',
  Buttondown: 'buttondown.com'
};

export const PLATFORM_DISCOVERY_GROUPS = [
  {
    group: 'E-Commerce & Website Platforms',
    items: [
      { key: 'Shopify', label: 'Shopify Stores' },
      { key: 'WooCommerce', label: 'WooCommerce Stores' },
      { key: 'BigCommerce', label: 'BigCommerce Stores' },
      { key: 'Wix', label: 'Wix Websites' },
      { key: 'Squarespace', label: 'Squarespace Websites' },
      { key: 'Webflow', label: 'Webflow Websites' },
      { key: 'WordPress', label: 'WordPress Websites' }
    ]
  },
  {
    group: 'Email Marketing & Newsletter Platforms',
    items: [
      { key: 'Klaviyo', label: 'Klaviyo Brands & Stores' },
      { key: 'Mailchimp', label: 'Mailchimp Businesses' },
      { key: 'Omnisend', label: 'Omnisend Stores' },
      { key: 'Brevo', label: 'Brevo (Sendinblue) Businesses' },
      { key: 'ActiveCampaign', label: 'ActiveCampaign Funnels' },
      { key: 'Beehiiv', label: 'Beehiiv Newsletters' },
      { key: 'Substack', label: 'Substack Publications' },
      { key: 'Kit', label: 'Kit (ConvertKit) Creators' },
      { key: 'MailerLite', label: 'MailerLite Pages & Lists' }
    ]
  }
];

export const REDDIT_SUBREDDIT_PACKS = {
  hiring: {
    key: 'hiring',
    label: 'Direct Hiring & Gig Boards (r/forhire, r/DesignJobs…)',
    subreddits: ['forhire', 'DesignJobs', 'hireawriter', 'jobbit', 'shopify'],
    defaultIntent: 'hiring'
  },
  smallbiz: {
    key: 'smallbiz',
    label: 'Business Owners Needing Help (r/smallbusiness, r/ecommerce…)',
    subreddits: ['smallbusiness', 'entrepreneur', 'ecommerce', 'shopify'],
    defaultIntent: 'all_buyers'
  },
  marketing_seo: {
    key: 'marketing_seo',
    label: 'SEO, Website & Ads Pain Points (r/SEO, r/PPC, r/web_design…)',
    subreddits: ['SEO', 'PPC', 'web_design', 'digital_marketing', 'socialmedia'],
    defaultIntent: 'all_buyers'
  }
};

const PLATFORM_FOOTPRINT_CLUES = {
  Shopify: ['"powered by Shopify"', '"add to cart"'],
  WooCommerce: ['"powered by WooCommerce"', '"wp-content/plugins/woocommerce"', '"add to cart" "woocommerce"'],
  BigCommerce: ['"powered by BigCommerce"', '"add to cart"'],
  Wix: ['"proudly created with Wix"', 'site:wixsite.com'],
  Squarespace: ['"powered by Squarespace"'],
  Webflow: ['site:webflow.io'],
  WordPress: ['"powered by WordPress"'],
  Klaviyo: ['"klaviyo" "subscribe"', '"add to cart" "klaviyo"'],
  Omnisend: ['"omnisend" "newsletter"', '"add to cart" "omnisend"'],
  Mailchimp: ['site:mailchi.mp', '"mailchimp" "subscribe"'],
  Brevo: ['site:sibforms.com', '"brevo" "newsletter"'],
  ActiveCampaign: ['site:activehosted.com', '"activecampaign" "subscribe"'],
  Beehiiv: ['site:beehiiv.com', '"beehiiv" newsletter'],
  Substack: ['site:substack.com', '"substack" newsletter'],
  Kit: ['site:ck.page', 'site:kit.com', '"convertkit" newsletter'],
  MailerLite: ['site:mailerlite.io', '"mailerlite" newsletter']
};

export function searchList(value, limit) {
  const unique = new Map();
  for (const entry of String(value || '').split(/[,\n]+/)) {
    const clean = entry.trim();
    if (clean && !unique.has(clean.toLowerCase())) unique.set(clean.toLowerCase(), clean);
  }
  return [...unique.values()].slice(0, limit);
}

export function googleQueries(term, location, platform, mode) {
  const quote = value => '"' + value.replaceAll('"', '').trim() + '"';
  const base = [quote(term), location && quote(location)].filter(Boolean).join(' ');
  const domain = Object.hasOwn(platformDomains, platform) ? platformDomains[platform] : '';
  const suffix = ' -jobs -vacancies';
  if (mode !== true && mode !== 'online' && mode !== 'both') return [base + suffix];
  const clue = ['Beehiiv', 'Ghost', 'Substack', 'Kit', 'MailerLite', 'Buttondown', 'Mailchimp'].includes(platform) ? 'newsletter' :
    ['Shopify', 'WooCommerce', 'BigCommerce', ''].includes(platform) ? '"add to cart"' : quote(platform);
  const domains = platform === 'Kit' ? ['kit.com', 'ck.page'] : domain ? [domain] : [];
  return [
    ...(mode === 'both' ? [base + suffix] : []),
    ...domains.map(host => 'site:' + host + ' ' + base + suffix),
    base + ' ' + clue + suffix
  ];
}

export function platformFootprintQueries(term, location = '', platform = 'Shopify') {
  const quote = value => '"' + String(value || '').replaceAll('"', '').trim() + '"';
  const cleanLoc = String(location || '').trim();
  const useLoc = cleanLoc && !/^(online|global|worldwide|remote|any)$/i.test(cleanLoc);
  const base = [quote(term), useLoc && quote(cleanLoc)].filter(Boolean).join(' ');
  const suffix = ' -jobs -vacancies -reddit -pinterest';
  const baseQueries = googleQueries(term, useLoc ? cleanLoc : '', platform, 'online');
  const extraClues = (PLATFORM_FOOTPRINT_CLUES[platform] || []).map(clue =>
    clue.startsWith('site:') ? `${clue} ${base}${suffix}` : `${base} ${clue}${suffix}`
  );
  return [...new Set([...baseQueries, ...extraClues])].slice(0, 5);
}

export function publicWebsite(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function businessKeys(item, online) {
  const normal = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const host = websiteIdentity(publicWebsite(item.website));
  const address = normal(item.address);
  const name = normal(item.name);
  const city = normal(item.city);
  const phone = String(item.phone || '').replace(/\D/g, '');
  return [
    item.id && 'id:' + item.id,
    online && host && 'domain:' + host,
    address && city && name && 'address:' + city + ':' + address + ':' + name,
    address && city && phone.length >= 7 && 'phone:' + city + ':' + address + ':' + phone
  ].filter(Boolean);
}

export function websiteIdentity(url) {
  if (!url) return '';
  const host = url.hostname.replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'mailchi.mp' && segments.length) return host + '/' + segments.slice(0, 2).join('/');
  if (host === 'substack.com' && segments[0]?.startsWith('@')) return host + '/' + segments[0];
  if (host === 'reddit.com' && segments.length >= 4) return host + '/' + segments.slice(0, 4).join('/');
  return host;
}
