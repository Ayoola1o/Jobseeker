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
  Buttondown: 'buttondown.com',
  'Etsy Shop': 'etsy.com',
  'Faire Brand': 'faire.com',
  'eBay Store': 'ebay.com'
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
  },
  {
    group: 'Marketplace Sellers (Need Own DTC Store)',
    items: [
      { key: 'Etsy Shop', label: 'Etsy Shops (site:etsy.com/shop)' },
      { key: 'Faire Brand', label: 'Faire Wholesale Brands (site:faire.com/brand)' },
      { key: 'eBay Store', label: 'eBay Stores (site:ebay.com/str)' }
    ]
  }
];

export const SOCIAL_DIRECTORY_PACKS = {
  link_in_bio: {
    key: 'link_in_bio',
    label: 'Link-in-Bio Only (Linktree, Beacons, Stan, Carrd)',
    badge: 'Link-in-Bio Storefront',
    channel: 'link_in_bio',
    sites: ['linktr.ee', 'beacons.ai', 'stan.store', 'carrd.co', 'bio.site']
  },
  booking_beauty: {
    key: 'booking_beauty',
    label: 'Booking Directories (Booksy, Fresha, Vagaro, Mindbody)',
    badge: 'Rented Booking Directory',
    channel: 'directory',
    sites: ['booksy.com', 'fresha.com', 'vagaro.com', 'mindbodyonline.com']
  },
  home_b2b: {
    key: 'home_b2b',
    label: 'Service & Agency Directories (Houzz, Thumbtack, Clutch)',
    badge: 'Directory Listing',
    channel: 'directory',
    sites: ['houzz.com/professionals', 'thumbtack.com', 'clutch.co/profile', 'designrush.com/agency']
  },
  social_pages: {
    key: 'social_pages',
    label: 'Social-First Businesses (Instagram, Facebook & TikTok)',
    badge: 'Social-Only Brand',
    channel: 'social_only',
    sites: ['instagram.com', 'facebook.com', 'tiktok.com']
  }
};

export const LAUNCH_DOMAIN_MODES = {
  both: {
    key: 'both',
    label: 'New Domains (crt.sh) + Product Launches (Combined)'
  },
  crt_sh: {
    key: 'crt_sh',
    label: 'Newly Registered Domains Only (crt.sh Live SSL Feed)'
  },
  product_launch: {
    key: 'product_launch',
    label: 'Product Hunt, Kickstarter & Indie Hackers Launches'
  }
};

export const REDDIT_SUBREDDIT_PACKS = {
  hiring: {
    key: 'hiring',
    label: 'Reddit Direct Hiring Boards (r/forhire, r/DesignJobs…)',
    kind: 'reddit',
    subreddits: ['forhire', 'DesignJobs', 'hireawriter', 'jobbit', 'shopify'],
    defaultIntent: 'hiring'
  },
  job_boards: {
    key: 'job_boards',
    label: 'Company Job Boards Hiring Now (Greenhouse, Lever, Workable…)',
    kind: 'job_boards',
    sites: ['boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com', 'jobs.ashbyhq.com', 'weworkremotely.com/remote-jobs', 'wellfound.com/company']
  },
  ad_funnels: {
    key: 'ad_funnels',
    label: 'Active Paid-Ad & Promo Landing Pages (/lp/, /offer…)',
    kind: 'ad_funnels'
  },
  smallbiz: {
    key: 'smallbiz',
    label: 'Reddit Business Owners Needing Help (r/smallbusiness…)',
    kind: 'reddit',
    subreddits: ['smallbusiness', 'entrepreneur', 'ecommerce', 'shopify'],
    defaultIntent: 'all_buyers'
  },
  marketing_seo: {
    key: 'marketing_seo',
    label: 'Reddit SEO, Website & Ads Pain Points (r/SEO, r/PPC…)',
    kind: 'reddit',
    subreddits: ['SEO', 'PPC', 'web_design', 'digital_marketing', 'socialmedia'],
    defaultIntent: 'all_buyers'
  }
};

const RENTED_OR_INTERMEDIARY_HOSTS = [
  'linktr.ee', 'beacons.ai', 'stan.store', 'carrd.co', 'bio.site', 'lnk.bio', 'taplink.cc',
  'booksy.com', 'fresha.com', 'vagaro.com', 'mindbodyonline.com', 'styleseat.com',
  'houzz.com', 'thumbtack.com', 'clutch.co', 'designrush.com', 'etsy.com', 'faire.com', 'ebay.com',
  'boards.greenhouse.io', 'greenhouse.io', 'jobs.lever.co', 'lever.co', 'apply.workable.com', 'workable.com',
  'jobs.ashbyhq.com', 'ashbyhq.com', 'weworkremotely.com', 'wellfound.com',
  'producthunt.com', 'kickstarter.com', 'indiegogo.com', 'indiehackers.com'
];

export function classifyRentedOrIntermediaryUrl(urlStr = '') {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const h of RENTED_OR_INTERMEDIARY_HOSTS) {
      if (host === h || host.endsWith('.' + h)) {
        const isJobBoard = /(greenhouse|lever|workable|ashbyhq|weworkremotely|wellfound)/i.test(h);
        const isLaunch = /(producthunt|kickstarter|indiegogo|indiehackers)/i.test(h);
        const isLinkBio = /(linktr\.ee|beacons\.ai|stan\.store|carrd\.co|bio\.site|lnk\.bio|taplink)/i.test(h);
        const isMarketplace = /(etsy\.com|faire\.com|ebay\.com)/i.test(h);
        return {
          isIntermediary: true,
          host: h,
          kind: isJobBoard ? 'job_board' : isLaunch ? 'launch' : isLinkBio ? 'link_in_bio' : isMarketplace ? 'marketplace' : 'directory'
        };
      }
    }
  } catch {}
  return { isIntermediary: false, host: '', kind: '' };
}

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
  MailerLite: ['site:mailerlite.io', '"mailerlite" newsletter'],
  'Etsy Shop': ['site:etsy.com/shop "sales"'],
  'Faire Brand': ['site:faire.com/brand'],
  'eBay Store': ['site:ebay.com/str']
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
  if (platform === 'Etsy Shop') {
    const loc = location && !/^(online|global|worldwide|remote|any)$/i.test(location) ? ` "${location}"` : '';
    return [`site:etsy.com/shop "${term}"${loc}`, `site:etsy.com/shop ${term} handmade${loc}`];
  }
  if (platform === 'Faire Brand') {
    const loc = location && !/^(online|global|worldwide|remote|any)$/i.test(location) ? ` "${location}"` : '';
    return [`site:faire.com/brand "${term}"${loc}`, `site:faire.com "${term}" wholesale${loc}`];
  }
  if (platform === 'eBay Store') {
    const loc = location && !/^(online|global|worldwide|remote|any)$/i.test(location) ? ` "${location}"` : '';
    return [`site:ebay.com/str "${term}"${loc}`];
  }
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
  if (['linktr.ee', 'beacons.ai', 'stan.store', 'bio.site', 'boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com', 'jobs.ashbyhq.com'].includes(host) && segments.length) {
    return host + '/' + segments[0];
  }
  if (['etsy.com', 'faire.com', 'ebay.com', 'booksy.com', 'fresha.com', 'vagaro.com', 'clutch.co', 'houzz.com', 'producthunt.com', 'kickstarter.com'].includes(host) && segments.length >= 2) {
    return host + '/' + segments.slice(0, 2).join('/');
  }
  return host;
}
