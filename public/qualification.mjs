const normalized = value => String(value || '').trim().toLowerCase();

export function normalizeLeadProfiles(value) {
  if (!Array.isArray(value)) return [];
  const folders = new Set();
  const profiles = [];
  for (const item of value) {
    if (!item || typeof item.folder !== 'string') continue;
    const folder = normalized(item.folder).slice(0, 80);
    if (!folder || folders.has(folder)) continue;
    const profile = { folder, requireContact: item.requireContact === true };
    for (const [key, limit] of Object.entries({ industry: 120, platform: 80, offer: 300, exclude: 240, angle: 300, templateId: 64 })) {
      profile[key] = typeof item[key] === 'string' ? item[key].trim().slice(0, limit) : '';
    }
    profiles.push(profile);
    folders.add(folder);
    if (profiles.length >= 100) break;
  }
  return profiles;
}

export function assessLead(lead, profile) {
  const email = normalized(lead.email);
  const suppressed = email && Array.isArray(lead.suppressed) &&
    lead.suppressed.some(address => normalized(address) === email);
  const contact = ['unsubscribe', 'declined'].includes(lead.classification) ? 'Do not contact'
    : email && !suppressed && lead.classification !== 'bounced' ? 'Public email'
    : (lead.contactFormSource || lead.contactPage) ? 'Contact page or form'
    : lead.phone ? 'Phone available' : 'Needs contact research';
  if (!profile) return { contact, fit: 'Set a target client profile', reasons: [] };
  const reasons = [];
  const industry = normalized(lead.industry);
  const requiredIndustry = normalized(profile.industry);
  const platform = normalized(profile.platform);
  const detected = [lead.platform, ...(Array.isArray(lead.techStack) ? lead.techStack : [])].map(normalized);
  const haystack = [lead.name, lead.industry, lead.about].map(normalized).join(' ');
  const exclusions = normalized(profile.exclude).split(',').map(term => term.trim()).filter(Boolean);
  if (exclusions.some(term => haystack.includes(term))) return { contact, fit: 'Excluded', reasons: ['Matches an exclusion'] };
  let mismatch = false;
  let unknown = false;
  if (requiredIndustry) {
    const matched = industry.includes(requiredIndustry);
    reasons.push(matched ? 'Industry matches' : industry ? 'Industry differs' : 'Industry unknown');
    mismatch ||= Boolean(industry) && !matched;
    unknown ||= !industry;
  }
  if (platform) {
    const matched = detected.includes(platform);
    if (matched && normalized(lead.platform) === platform && lead.platformConfidence === 'Likely') {
      reasons.push('Platform likely · verify on site');
      unknown = true;
    } else {
      reasons.push(matched ? profile.platform + ' detected' : 'Target platform unverified');
      unknown ||= !matched;
    }
  }
  if (profile.requireContact && !['Public email', 'Contact page or form', 'Phone available'].includes(contact)) {
    reasons.push('Public contact required');
    unknown = true;
  }
  return { contact, fit: mismatch ? 'Outside target' : unknown ? 'Needs research'
    : reasons.length ? 'Matches target' : 'Review fit', reasons };
}

export function industryAngle(lead, profile) {
  if (profile?.angle) return profile.angle;
  const industry = normalized(lead.industry);
  if (/dent|clinic|salon|spa|physio|vet/.test(industry)) return 'Ask how new clients book appointments and whether the booking flow could be simpler.';
  if (/restaurant|café|cafe|hospitality|hotel/.test(industry)) return 'Ask how customers make reservations or repeat orders.';
  if (/newsletter|publisher|publication|creator/.test(industry) || ['Substack', 'Beehiiv', 'Kit', 'Ghost'].includes(lead.platform)) {
    return 'Ask how new subscribers find the newsletter and what they receive after signup.';
  }
  if (/store|shop|retail|ecommerce|e-commerce/.test(industry) || ['Shopify', 'WooCommerce', 'BigCommerce'].includes(lead.platform)) {
    return 'Ask how the store turns first-time visitors into subscribers and repeat customers.';
  }
  if (/plumb|electric|roof|hvac|contractor|repair/.test(industry)) return 'Ask how customers request quotes and how the business follows up on enquiries.';
  return industry ? 'Ask how new customers discover the business and make their first enquiry.' : '';
}
