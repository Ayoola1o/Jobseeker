export const platformDomains = {
  Shopify: 'myshopify.com', WooCommerce: '', Wix: 'wixsite.com',
  Beehiiv: 'beehiiv.com', BigCommerce: 'mybigcommerce.com',
  Squarespace: 'squarespace.com', Webflow: 'webflow.io',
  WordPress: 'wordpress.com', Ghost: 'ghost.io', 'HubSpot CMS': 'hubspotpagebuilder.com'
};

export function searchList(value, limit) {
  const unique = new Map();
  for (const entry of String(value || '').split(/[,\n]+/)) {
    const clean = entry.trim();
    if (clean && !unique.has(clean.toLowerCase())) unique.set(clean.toLowerCase(), clean);
  }
  return [...unique.values()].slice(0, limit);
}

export function googleQueries(term, location, platform, online) {
  const quote = value => '"' + value.replaceAll('"', '').trim() + '"';
  const base = [quote(term), location && quote(location)].filter(Boolean).join(' ');
  const domain = Object.hasOwn(platformDomains, platform) ? platformDomains[platform] : '';
  const suffix = ' -jobs -vacancies';
  if (!online) return [base + suffix];
  const clue = ['Beehiiv', 'Ghost'].includes(platform) ? 'newsletter' :
    ['Shopify', 'WooCommerce', 'BigCommerce', ''].includes(platform) ? '"add to cart"' : quote(platform);
  return [...(domain ? ['site:' + domain + ' ' + base + suffix] : []), base + ' ' + clue + suffix];
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
  const host = publicWebsite(item.website)?.hostname.replace(/^www\./, '');
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
