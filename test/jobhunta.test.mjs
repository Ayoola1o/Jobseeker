import { test } from 'node:test';
import { assessLead, industryAngle, normalizeLeadProfiles } from '../public/qualification.mjs';
import { googleQueries, platformFootprintQueries, businessKeys, PLATFORM_DISCOVERY_GROUPS, REDDIT_SUBREDDIT_PACKS } from '../public/discovery.mjs';
import assert from 'node:assert/strict';
import { readBusinessCsv, writeBusinessCsv } from '../public/csv.mjs';
import {
  detectPlatform,
  analyzePageAudit,
  generateClientOutreach,
  generateLeadSolutionPack,
  buildSolutionPackHtml,
  PERSONA_CATALOG,
  getActivePersonaModules
} from '../public/audit.mjs';
import {
  extractMessageBody,
  outreachMessageKind,
  extractEmailsFromHtml,
  extractSocialsFromHtml,
  extractWebsiteInsights,
  detectPlatformAndTech,
  buildLeadIntelligence,
  buildRawMimeMessage,
  parseBingMapsHtml,
  parseBingWebSearchHtml,
  parseBingRssXml,
  parseDuckDuckGoHtml,
  classifyRedditPostIntent,
  decodeCloudflareEmail,
  rankDiscoveredEmails,
  resolveSearchLocations,
  hashPassword,
  verifyPassword,
  USER_TIERS,
  getUserQuotaStatus,
  industries
} from '../server.mjs';

test('outreach separates client replies, delivery failures and automatic messages', () => {
  const registration = { recipient: 'client@example.com' };
  assert.equal(outreachMessageKind({ sent: true, to: 'Client <CLIENT@example.com>' }, registration), 'sent');
  assert.equal(outreachMessageKind({ sent: true, to: 'other@example.com' }, registration), 'unrelated');
  assert.equal(outreachMessageKind({ from: 'Client <client@example.com>' }, registration), 'reply');
  assert.equal(outreachMessageKind({ from: 'client@example.com', autoSubmitted: 'auto-replied' }, registration), 'automatic');
  assert.equal(outreachMessageKind({ from: 'mailer-daemon@example.com' }, registration), 'bounce');
  assert.equal(outreachMessageKind({ from: 'different@example.com' }, registration), 'review');
});

test('lead qualification distinguishes industry fit, platform evidence and contactability', () => {
  const [profile] = normalizeLeadProfiles([{ folder: ' Skincare ', industry: 'skincare',
    platform: 'Shopify', requireContact: true, exclude: 'directory', templateId: 'intro' }]);
  assert.equal(profile.folder, 'skincare');
  assert.equal(profile.templateId, 'intro');
  const lead = { name: 'Glow', industry: 'Skincare store', platform: 'Shopify',
    platformConfidence: 'Confirmed', email: 'hello@glow.example' };
  assert.equal(assessLead(lead, profile).fit, 'Matches target');
  assert.equal(assessLead({ ...lead, platformConfidence: 'Likely' }, profile).fit, 'Needs research');
  assert.equal(assessLead({ ...lead, suppressed: ['HELLO@GLOW.EXAMPLE'] }, profile).fit, 'Needs research');
  assert.equal(assessLead({ ...lead, name: 'Store directory' }, profile).fit, 'Excluded');
  assert.equal(assessLead({ ...lead, industry: 'Dentists' }, profile).fit, 'Outside target');
  assert.match(industryAngle(lead, profile), /repeat customers/);
  assert.match(industryAngle({ industry: 'Dentists' }), /book appointments/);
});

test('platform discovery generates hosted and custom-domain queries and preserves separate branches', () => {
  const queries = googleQueries('skin care', '', 'Shopify', true);
  assert.ok(queries[0].startsWith('site:myshopify.com'));
  assert.match(queries[1], /"add to cart"/);
  const both = googleQueries('skin care', 'Ikeja', 'Shopify', 'both');
  assert.deepEqual(both, [
    '"skin care" "Ikeja" -jobs -vacancies',
    'site:myshopify.com "skin care" "Ikeja" -jobs -vacancies',
    '"skin care" "Ikeja" "add to cart" -jobs -vacancies'
  ]);
  const first = { id: 'one', name: 'Clinic', city: 'Ikeja', address: '12 Allen Ave', website: 'https://clinic.example' };
  const second = { ...first, id: 'two', address: '18 Allen Ave' };
  assert.equal(businessKeys(first, false).some(key => businessKeys(second, false).includes(key)), false);
  assert.ok(businessKeys(first, true).some(key => businessKeys(second, true).includes(key)));

  const hosted = detectPlatformAndTech('', 'https://newsletter.beehiiv.com');
  assert.equal(hosted.platform, 'Beehiiv');
  assert.equal(hosted.platformConfidence, 'Confirmed');
  const marketing = detectPlatformAndTech('<script src="https://js.hs-scripts.com/123.js"></script>');
  assert.equal(marketing.platformConfidence, 'Unknown');
  assert.ok(marketing.techStack.includes('HubSpot Marketing'));
  assert.equal(detectPlatformAndTech('', 'https://writer.substack.com').platform, 'Substack');
  assert.equal(detectPlatformAndTech('', 'https://creator.ck.page').platform, 'Kit');
  assert.equal(detectPlatformAndTech('', 'https://mailchi.mp/example/newsletter').platform, 'Mailchimp');
  assert.ok(googleQueries('fitness', '', 'Kit', true).some(query => query.startsWith('site:ck.page')));
  const shop = detectPlatformAndTech('<script src="https://cdn.shopify.com/store.js"></script><form action="https://brand.list-manage.com/subscribe"></form>');
  assert.equal(shop.platform, 'Shopify');
  assert.ok(shop.techStack.includes('Mailchimp'));
  assert.ok(detectPlatformAndTech('<script src="https://f.convertkit.com/example.js"></script>').techStack.includes('Kit'));
});

test('CSV import supports standard Jobhunta columns and round-trips via writeBusinessCsv', () => {
  const sampleLeads = [
    {
      name: 'Lagoon Dental Care',
      email: 'hello@lagoondental.ng',
      phone: '+234 800 123 4567',
      website: 'https://lagoondental.ng/',
      about: 'Family dental clinic, open Saturdays',
      industry: 'Dentists',
      address: '12 Allen Ave, Ikeja',
      city: 'Ikeja',
      classification: 'interested',
      due: '2026-11-20',
      source: 'https://www.openstreetmap.org/node/123',
      openHours: 'Open until 5 pm',
      rating: '4.5',
      facebook: 'https://www.facebook.com/lagoondental',
      instagram: 'https://www.instagram.com/lagoondental',
      twitter: 'https://x.com/lagoondental'
    }
  ];

  const csvText = writeBusinessCsv(sampleLeads);
  const { businesses, errors } = readBusinessCsv(csvText);
  assert.equal(errors.length, 0);
  assert.equal(businesses.length, 1);
  assert.equal(businesses[0].name, 'Lagoon Dental Care');
  assert.equal(businesses[0].email, 'hello@lagoondental.ng');
  assert.equal(businesses[0].about, 'Family dental clinic, open Saturdays');
  assert.equal(businesses[0].classification, 'interested');
  assert.equal(businesses[0].due, '2026-11-20');
  assert.equal(businesses[0].facebook, 'https://www.facebook.com/lagoondental');
  assert.equal(businesses[0].instagram, 'https://www.instagram.com/lagoondental');
  assert.equal(businesses[0].twitter, 'https://x.com/lagoondental');
});

test('CSV import supports Bing Maps Scraper (mapleedsscapper) format and cleans placeholders', () => {
  const bingCsv = [
    'ID,Name,Address,Category,Website,Phone,Emails,Bing Maps URL',
    '1,"Sunrise Bakery","45 Marina Rd",Bakeries,sunrisebakery.com,+23480999,"info@sunrisebakery.com,sales@sunrisebakery.com",https://www.bing.com/maps?osid=1',
    '2,"Apex Motors","10 Broad St",Car repair,apexmotors.ng,+23480111,"***PRO***",https://www.bing.com/maps?osid=2',
    '3,"Upgrade to Pro plan for unlimited scraping!",,,,,,'
  ].join('\r\n');

  const { businesses, errors } = readBusinessCsv(bingCsv);
  assert.equal(errors.length, 0);
  assert.equal(businesses.length, 2);
  assert.equal(businesses[0].name, 'Sunrise Bakery');
  assert.equal(businesses[0].industry, 'Bakeries');
  assert.equal(businesses[0].email, 'info@sunrisebakery.com');
  assert.equal(businesses[0].website, 'https://sunrisebakery.com/');
  assert.equal(businesses[1].name, 'Apex Motors');
  assert.equal(businesses[1].email, '');
});

test('parseBingMapsHtml extracts data-entity JSON, openHours, rating, and Bing Maps URL like mapleedsscapper', () => {
  const entityPayload = JSON.stringify({
    entity: {
      id: 'ypid:YN7EB4C1F617D5A121',
      title: 'Luxe Dental Clinic',
      address: 'Oba Aladejobi St, Ikeja',
      primaryCategoryName: 'Dentist',
      phone: '0904 437 4007',
      website: 'https://www.luxedental.com.ng/',
      openHoursText: 'Open until 5 pm',
      infoboxHtml: '<div class="bm_ib_ratings"><span class="csrc"><span class="sw_st"></span><span class="sw_st"></span><span class="sw_st"></span><span class="sw_st"></span><span class="sw_sth"></span></span> (24)</div>'
    },
    routablePoint: { latitude: 6.5855, longitude: 3.3494 }
  }).replace(/"/g, '&quot;');

  const html = `<li><a class="listings-item" data-entity="${entityPayload}"><div><span class="opHours"><span>Open · Closes 17:00</span></span></div></a></li>`;
  const parsed = parseBingMapsHtml(html, 'Dentists', 'Ikeja');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'ypid:YN7EB4C1F617D5A121');
  assert.equal(parsed[0].name, 'Luxe Dental Clinic');
  assert.equal(parsed[0].phone, '0904 437 4007');
  assert.equal(parsed[0].website, 'https://www.luxedental.com.ng/');
  assert.equal(parsed[0].rating, '4.5');
  assert.equal(parsed[0].openHours, 'Open · Closes 17:00');
  assert.match(parsed[0].source, /^https:\/\/www\.bing\.com\/maps\?cp=6\.5855%7E3\.3494/);
});

test('extractMessageBody parses HTML-only Gmail messages cleanly', () => {
  const htmlContent = '<html><head><style>body{color:red}</style></head><body><p>Hello <b>Alex</b>,</p><p>We would love to chat!<br>Call us &amp; let us know.</p></body></html>';
  const payload = {
    mimeType: 'text/html',
    body: {
      data: Buffer.from(htmlContent, 'utf8').toString('base64url')
    }
  };
  const text = extractMessageBody(payload, 'snippet fallback');
  assert.match(text, /Hello Alex,/);
  assert.match(text, /We would love to chat!\nCall us & let us know\./);
  assert.ok(!text.includes('<p>'));
});

test('extractEmailsFromHtml and extractSocialsFromHtml extract emails and social profiles cleanly', () => {
  const html = `
    <html>
      <body>
        <a href="mailto:Contact@BrightSmileClinic.com?subject=Hello">Email Us</a>
        <img src="banner@2x.png" />
        <p>Or reach out to support@brightsmileclinic.com or test@example.com.</p>
        <a href="https://www.facebook.com/tr?id=12345&ev=PageView">Pixel</a>
        <a href="https://www.facebook.com/brightsmileclinic">FB</a>
        <a href="https://www.instagram.com/brightsmile_ng">IG</a>
        <a href="https://x.com/brightsmile">X</a>
      </body>
    </html>
  `;
  const emails = extractEmailsFromHtml(html);
  assert.deepEqual(emails, ['contact@brightsmileclinic.com', 'support@brightsmileclinic.com']);
  const socials = extractSocialsFromHtml(html);
  assert.equal(socials.facebook, 'https://www.facebook.com/brightsmileclinic');
  assert.equal(socials.instagram, 'https://www.instagram.com/brightsmile_ng');
  assert.equal(socials.twitter, 'https://x.com/brightsmile');
});

test('Expanded industry catalog has over 20 presets', () => {
  assert.ok(Object.keys(industries).length >= 20);
});

test('extractWebsiteInsights and buildLeadIntelligence extract about info, digital signals, gaps, and pitch', () => {
  const html = `
    <html>
      <head>
        <title>Downtown Pharmacy | Prescription & Wellness in NYC</title>
        <meta name="description" content="Downtown Pharmacy provides fast prescription delivery and compounding services in Lower Manhattan." />
      </head>
      <body>
        <h1>Downtown Pharmacy NYC</h1>
        <h2>Same-Day Prescription Delivery</h2>
        <p>We are an independent neighborhood pharmacy serving Lower Manhattan with personalized care, vaccinations, and free local delivery.</p>
      </body>
    </html>
  `;
  const insights = extractWebsiteInsights(html, 'https://downtownpharmacy.com');
  assert.equal(insights.siteTitle, 'Downtown Pharmacy | Prescription & Wellness in NYC');
  assert.match(insights.aboutSummary, /independent neighborhood pharmacy/);
  assert.equal(insights.signals.https, true);
  assert.equal(insights.signals.hasMetaDescription, true);

  const brief = buildLeadIntelligence({
    name: 'Downtown Pharmacy',
    industry: 'Pharmacies',
    city: 'New York',
    rating: '4',
    ratingInfo: 'Yelp (38)',
    website: 'https://downtownpharmacy.com',
    ...insights
  }, { senderName: 'Ayoola', senderService: 'automated patient booking & local SEO' });

  assert.ok(brief.gaps.length >= 1);
  assert.match(brief.pitchSubject, /Downtown Pharmacy/);
  assert.match(brief.pitchBody, /Ayoola/);
});

test('detectPlatformAndTech detects Shopify stores, theme, currency, and installed apps', () => {
  const shopifyHtml = `
    <html>
      <head>
        <link href="https://cdn.shopify.com/s/files/1/0001/assets/base.css" rel="stylesheet">
        <script>
          Shopify.shop = "glow-skincare-ng.myshopify.com";
          Shopify.theme = {"name":"Dawn","id":123};
          Shopify.currency = {"active":"USD","rate":"1.0"};
        </script>
        <script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
        <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
      </head>
      <body></body>
    </html>
  `;
  const detected = detectPlatformAndTech(shopifyHtml);
  assert.equal(detected.platform, 'Shopify');
  assert.equal(detected.shopifyMeta.myshopifyDomain, 'glow-skincare-ng.myshopify.com');
  assert.equal(detected.shopifyMeta.themeName, 'Dawn');
  assert.equal(detected.shopifyMeta.currency, 'USD');
  assert.ok(detected.techStack.includes('Klaviyo'));
  assert.ok(detected.techStack.includes('Meta Pixel'));
});

test('resolveSearchLocations expands a State into constituent sub-cities for bit-by-bit scraping', async () => {
  const lagosCities = await resolveSearchLocations('Lagos State');
  assert.ok(lagosCities.length >= 8);
  assert.ok(lagosCities.some(c => c.startsWith('Ikeja')));
  assert.ok(lagosCities.some(c => c.startsWith('Lekki')));

  const texasCities = await resolveSearchLocations('Texas');
  assert.ok(texasCities.length >= 6);
  assert.ok(texasCities.some(c => c.startsWith('Houston')));
});

test('hashPassword and verifyPassword securely hash and verify user passwords', () => {
  const hash = hashPassword('MySecretPass123!');
  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword('MySecretPass123!', hash), true);
  assert.equal(verifyPassword('WrongPassword', hash), false);
});

test('USER_TIERS and getUserQuotaStatus enforce Basic through Diamond limits with doubled discovery & outreach quotas', () => {
  assert.equal(USER_TIERS.basic.dailySearchLimit, 10);
  assert.equal(USER_TIERS.basic.dailyResultLimit, 50);
  assert.equal(USER_TIERS.basic.dailyEmailLimit, 20);
  assert.equal(USER_TIERS.basic.level, 1);

  assert.equal(USER_TIERS.silver.dailySearchLimit, 40);
  assert.equal(USER_TIERS.silver.dailyResultLimit, 300);
  assert.equal(USER_TIERS.silver.dailyEmailLimit, 100);
  assert.equal(USER_TIERS.silver.level, 2);

  assert.equal(USER_TIERS.gold.dailySearchLimit, 150);
  assert.equal(USER_TIERS.gold.dailyResultLimit, 1000);
  assert.equal(USER_TIERS.gold.dailyEmailLimit, 400);
  assert.equal(USER_TIERS.gold.level, 3);

  assert.equal(USER_TIERS.premium.dailySearchLimit, 500);
  assert.equal(USER_TIERS.premium.dailyResultLimit, 4000);
  assert.equal(USER_TIERS.premium.dailyEmailLimit, 2000);
  assert.equal(USER_TIERS.premium.level, 4);

  assert.equal(USER_TIERS.diamond.dailySearchLimit, null);
  assert.equal(USER_TIERS.diamond.dailyResultLimit, null);
  assert.equal(USER_TIERS.diamond.dailyEmailLimit, null);
  assert.equal(USER_TIERS.diamond.level, 5);

  const diamondStatus = getUserQuotaStatus({ tier: 'diamond\r\n', searches_today: 999, emails_today: 500 });
  assert.equal(diamondStatus.tier, 'diamond');
  assert.equal(diamondStatus.level, 5);
  assert.equal(diamondStatus.dailySearchLimit, null);
  assert.equal(diamondStatus.dailyEmailLimit, null);

  const philipStatus = getUserQuotaStatus({ email: 'philipibitade@gmail.com', tier: 'basic' });
  assert.equal(philipStatus.tier, 'diamond');
  assert.equal(philipStatus.level, 5);

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(getUserQuotaStatus({ tier: 'basic', usage_date: today, results_today: 49 }).resultsToday, 49);
  assert.equal(getUserQuotaStatus({ tier: 'basic', usage_date: '2020-01-01', results_today: 50 }).resultsToday, 0);
});

test('buildLeadIntelligence incorporates user-spotted issues into a detailed lead-generation email', () => {
  const brief = buildLeadIntelligence(
    { name: 'Glow Skincare', industry: 'Cosmetics & Skincare', city: 'Lagos', website: 'https://glow.example.com', signals: { https: true, hasBookingOrForm: false } },
    { senderName: 'Ayoola', senderService: 'Shopify CRO & lead generation' },
    'Mobile checkout button is cut off\nHomepage hero image loads slowly',
    'We also recorded a free 2-minute video audit walking through your mobile checkout'
  );
  assert.ok(brief.gaps[0].includes('Mobile checkout button is cut off'));
  assert.ok(brief.gaps[1].includes('Homepage hero image loads slowly'));
  assert.ok(brief.pitchBody.includes('Mobile checkout button is cut off'));
  assert.ok(brief.pitchBody.includes('Homepage hero image loads slowly'));
  assert.ok(brief.pitchBody.includes('Social Media Presence:'));
  assert.ok(brief.pitchBody.includes('Lack of Social Media Presence'));
  assert.ok(brief.pitchBody.includes('We also recorded a free 2-minute video audit walking through your mobile checkout.'));
  assert.ok(brief.pitchBody.length > 500, 'Expected detailed multi-paragraph outreach email with all business data');
});

test('buildRawMimeMessage creates multipart/mixed MIME email with image and file attachments', () => {
  const pngB64 = Buffer.from('fake-png-bytes').toString('base64');
  const pdfB64 = Buffer.from('fake-pdf-bytes').toString('base64');
  const rawB64Url = buildRawMimeMessage({
    from: 'sender@example.com',
    to: 'lead@example.com',
    encodedSubject: '=?UTF-8?B?VGVzdA==?=',
    body: 'Hello with attachments!',
    attachments: [
      { filename: 'audit.png', mimeType: 'image/png', dataBase64: pngB64 },
      { filename: 'proposal.pdf', mimeType: 'application/pdf', dataBase64: pdfB64 }
    ]
  });
  const decoded = Buffer.from(rawB64Url, 'base64url').toString('utf8');
  assert.ok(decoded.includes('Content-Type: multipart/mixed; boundary="jobhunta_'));
  assert.ok(decoded.includes('Content-Type: image/png; name="audit.png"'));
  assert.ok(decoded.includes('Content-Disposition: attachment; filename="audit.png"'));
  assert.ok(decoded.includes('Content-Type: application/pdf; name="proposal.pdf"'));
  assert.ok(decoded.includes(pngB64));
  assert.ok(decoded.includes(pdfB64));
});

test('parseBingWebSearchHtml extracts site:myshopify.com and custom-domain stores from Bing web results', () => {
  const sampleHtml = `
    <ol id="b_results">
      <li class="b_algo">
        <h2><a href="https://lagosglow.myshopify.com/collections/all">Lagos Glow Skincare | Official Store</a></h2>
        <div class="b_caption"><p>Natural organic skincare products shipped across Lagos and Nigeria.</p></div>
      </li>
      <li class="b_algo">
        <h2><a href="https://www.bing.com/ck/a?!&&p=123&u=a1aHR0cHM6Ly92ZWx2ZXRib3V0aXF1ZS5jb20v">Velvet Boutique - Fashion &amp; Apparel</a></h2>
        <div class="b_caption"><p>Add to cart and shop our latest dresses.</p></div>
      </li>
    </ol>
  `;
  const results = parseBingWebSearchHtml(sampleHtml, 'Cosmetics & Skincare', 'Lagos', 1, 1, 'site:myshopify.com "Cosmetics & Skincare" "Lagos"');
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Lagos Glow Skincare');
  assert.equal(results[0].website, 'https://lagosglow.myshopify.com');
  assert.equal(results[0].platform, 'Shopify');
  assert.equal(results[0].shopifyMeta?.myshopifyDomain, 'lagosglow.myshopify.com');
  assert.equal(results[1].name, 'Velvet Boutique');
  assert.equal(results[1].website, 'https://velvetboutique.com');
});

test('detectPlatform, analyzePageAudit, and generateClientOutreach perform multi-layer audit and generate outreach variants', () => {
  const sampleHtml = `
    <!doctype html>
    <html>
      <head>
        <title>Short</title>
        <script src="https://cdn.shopify.com/s/files/1/shop.js"></script>
        <script src="http://insecure.example.com/jquery-1.11.3.min.js"></script>
      </head>
      <body>
        <img src="/hero.jpg">
        <form><input type="text"></form>
      </body>
    </html>
  `;
  const stack = detectPlatform(sampleHtml, 'https://demo.myshopify.com', {});
  assert.equal(stack.platform, 'Shopify');
  assert.ok(stack.cms.includes('Shopify'));

  const audit = analyzePageAudit({
    url: 'https://demo.myshopify.com',
    status: 200,
    ttfbMs: 950,
    headers: {},
    html: sampleHtml,
    robotsTxtOk: false,
    sitemapXmlOk: false,
    brokenLinks: [{ url: 'https://demo.myshopify.com/dead', status: 404 }],
    brokenAssets: []
  });
  assert.ok(audit.overallScore < 85);
  assert.ok(audit.counts.critical >= 3);
  assert.ok(audit.findings.some(f => f.category === 'bugs' && f.title.includes('viewport')));
  assert.ok(audit.findings.some(f => f.category === 'bugs' && f.title.includes('broken internal')));
  assert.ok(audit.findings.some(f => f.category === 'seo' && f.title.includes('meta name="description"')));
  assert.ok(audit.findings.some(f => f.category === 'performance' && f.title.includes('render-blocking')));
  assert.ok(audit.findings.some(f => f.category === 'security' && f.title.includes('mixed-content')));

  const outreach = generateClientOutreach(audit, { name: 'Demo Shop', city: 'Lagos', industry: 'Fashion' }, { senderName: 'Ayoola', senderService: 'Shopify CRO' });
  assert.ok(outreach.executiveSummary.includes('Demo Shop (Platform: Shopify'));
  assert.ok(outreach.executiveSummary.includes('Socials: None linked'));
  assert.ok(outreach.variants.coldEmail.body.includes('Shopify'));
  assert.ok(outreach.variants.detailedEmail.body.length > 250);
  assert.ok(outreach.variants.dmMessage.includes('Demo Shop'));
  assert.ok(outreach.variants.loomTalkingPoints.includes('Finding #1'));

  const solutionPack = generateLeadSolutionPack(
    { name: 'Demo Shop', city: 'Lagos', industry: 'Fashion', platform: 'Shopify', searchRank: 28, auditReport: audit, userSpottedIssues: 'Checkout button hidden on mobile' },
    { senderName: 'Ayoola', senderService: 'Shopify CRO' }
  );
  assert.equal(solutionPack.phases.length, 4);
  assert.ok(solutionPack.matrix.length >= 4);
  assert.ok(solutionPack.replyProposalBody.includes('PHASE 1'));
  assert.ok(solutionPack.replyProposalBody.includes('PHASE 4'));
  const htmlDoc = buildSolutionPackHtml(solutionPack, { name: 'Demo Shop', auditReport: audit }, { senderName: 'Ayoola' });
  assert.ok(htmlDoc.includes('Client Solution Pack &amp; 4-Phase Growth Roadmap'));
});

test('6 Personas filter AI pitches, audit outreach, and solution packs to persona core modules and enforce Added Tools checkbox tier limits', () => {
  assert.equal(PERSONA_CATALOG.length, 6);
  const sampleLead = {
    name: 'Apex Dental Studio',
    industry: 'Dentists',
    city: 'Lagos',
    website: 'https://apexdental.example.com',
    searchRank: 27,
    searchPage: 3,
    rating: '3.9',
    signals: {
      https: false,
      hasMetaDescription: false,
      hasBookingOrForm: false,
      hasChatWidget: false,
      hasAnalytics: false
    }
  };

  // 1. Web Developer persona (only web_tech by default — no social media or paid ad pixel noise)
  const webDevBrief = buildLeadIntelligence(sampleLead, {
    senderName: 'Ayoola',
    persona: 'web_dev',
    addedTools: []
  }, '', '', 5);
  assert.equal(webDevBrief.personaId, 'web_dev');
  assert.deepEqual(webDevBrief.activeModuleKeys, ['web_tech']);
  assert.ok(webDevBrief.pitchBody.includes('HTTPS'));
  assert.ok(!webDevBrief.pitchBody.includes('Lack of Social Media Presence'), 'Web Dev pitch should not include Social Media gaps when unchecked');
  assert.ok(!webDevBrief.pitchBody.includes('Missing Ad & Conversion Tracking Pixels'), 'Web Dev pitch should not include Digital Marketing pixel gaps when unchecked');

  // 2. Digital Marketer persona (only ads_funnel by default)
  const marketerBrief = buildLeadIntelligence(sampleLead, {
    senderName: 'Ayoola',
    persona: 'digital_marketer',
    addedTools: []
  }, '', '', 5);
  assert.equal(marketerBrief.personaId, 'digital_marketer');
  assert.deepEqual(marketerBrief.activeModuleKeys, ['ads_funnel']);
  assert.ok(marketerBrief.pitchBody.includes('Missing Ad & Conversion Tracking Pixels'));
  assert.ok(marketerBrief.pitchBody.includes('Missing Online Lead Capture / Booking Form'));
  assert.ok(!marketerBrief.pitchBody.includes('Lack of Social Media Presence'));

  // 3. Added Tools Checkbox Tier Limits: Basic = 0, Silver = 1, Gold = 2, Premium/Diamond = All
  const requestedExtras = ['social_brand', 'seo_local', 'ads_funnel'];
  const basicState = getActivePersonaModules({ persona: 'web_dev', addedTools: requestedExtras }, 1);
  assert.equal(basicState.addedTools.length, 0);

  const silverState = getActivePersonaModules({ persona: 'web_dev', addedTools: requestedExtras }, 2);
  assert.equal(silverState.addedTools.length, 1);
  assert.deepEqual(silverState.addedTools, ['social_brand']);

  const goldState = getActivePersonaModules({ persona: 'web_dev', addedTools: requestedExtras }, 3);
  assert.equal(goldState.addedTools.length, 2);
  assert.deepEqual(goldState.addedTools, ['social_brand', 'seo_local']);

  const diamondState = getActivePersonaModules({ persona: 'web_dev', addedTools: requestedExtras }, 5);
  assert.equal(diamondState.addedTools.length, 3);

  // When Web Dev checks 'social_brand' on Silver+, Social Media gaps ARE added to their pitch!
  const webDevPlusSocial = buildLeadIntelligence(sampleLead, {
    senderName: 'Ayoola',
    persona: 'web_dev',
    addedTools: ['social_brand']
  }, '', '', 2);
  assert.ok(webDevPlusSocial.pitchBody.includes('Lack of Social Media Presence'));
});

test('Cloudflare cfemail, obfuscated [at]/[dot], JSON-LD, and email ranking work accurately', () => {
  // Encode "founder@glowbrand.co" with XOR key 0x2a -> "2a4c455f444e4f586a4d46455d48584b444e044945"
  const plain = 'founder@glowbrand.co';
  const key = 0x2a;
  const hex = key.toString(16).padStart(2, '0') + [...plain].map(ch => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  assert.equal(decodeCloudflareEmail(hex), plain);

  const html = `
    <html>
      <script type="application/ld+json">{"@type":"LocalBusiness","email":"sales@glowbrand.co"}</script>
      <a class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a>
      <p>Contact us at noreply@glowbrand.co or hello [at] glowbrand [dot] co or user@sentry.io</p>
    </html>
  `;
  const extracted = extractEmailsFromHtml(html, 'glowbrand.co');
  assert.ok(extracted.includes('founder@glowbrand.co'));
  assert.ok(extracted.includes('sales@glowbrand.co'));
  assert.ok(extracted.includes('hello@glowbrand.co'));
  assert.ok(!extracted.includes('user@sentry.io'));
  // noreply@ must rank last behind founder/sales/hello
  assert.equal(extracted.at(-1), 'noreply@glowbrand.co');
  assert.ok(['founder@glowbrand.co', 'sales@glowbrand.co', 'hello@glowbrand.co'].includes(extracted[0]));
});

test('Bing RSS, DuckDuckGo Lite, Platform Footprints, Reddit Buyer Filter, and Gold 1/day quota rules work cleanly', () => {
  // 1. Tier Advanced Discovery Limits: Basic=0, Silver=0, Gold=1/day, Premium=null, Diamond=null
  assert.equal(USER_TIERS.basic.dailyAdvancedSearchLimit, 0);
  assert.equal(USER_TIERS.silver.dailyAdvancedSearchLimit, 0);
  assert.equal(USER_TIERS.gold.dailyAdvancedSearchLimit, 1);
  assert.equal(USER_TIERS.premium.dailyAdvancedSearchLimit, null);
  assert.equal(USER_TIERS.diamond.dailyAdvancedSearchLimit, null);

  // 2. Bing RSS XML parser filters directories & extracts clean stores
  const rssXml = `<?xml version="1.0"?><rss><channel>
    <item><title>Aura Skincare | Official Store</title><link>https://auraskincare.myshopify.com/collections/all</link><description>Organic skincare in Austin.</description></item>
    <item><title>Top 10 Skincare on Yelp</title><link>https://www.yelp.com/search?find_desc=skincare</link><description>Directory noise</description></item>
  </channel></rss>`;
  const rssItems = parseBingRssXml(rssXml, 'Skincare', 'Austin', 1, 'site:myshopify.com skincare');
  assert.equal(rssItems.length, 1);
  assert.equal(rssItems[0].platform, 'Shopify');
  assert.equal(rssItems[0].website, 'https://auraskincare.myshopify.com');

  // 3. DuckDuckGo HTML Lite parser decodes uddg= redirect links and skips Yelp/directories
  const ddgHtml = `
    <div class="result__body">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvelvetcoffee.co%2Fshop&amp;rut=123">Velvet Coffee Roasters - Shop</a>
      <a class="result__snippet">Specialty coffee roasters with Klaviyo newsletter.</a>
    </div>
    <div class="result__body">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tripadvisor.com%2FRestaurant">TripAdvisor</a>
    </div>
  `;
  const ddgItems = parseDuckDuckGoHtml(ddgHtml, 'Coffee', 'Denver', 1, 'coffee klaviyo');
  assert.equal(ddgItems.length, 1);
  assert.equal(ddgItems[0].website, 'https://velvetcoffee.co');
  assert.equal(ddgItems[0].discoveryProvider, 'DuckDuckGo');

  // 4. Platform & Email-Marketing footprint queries
  assert.ok(PLATFORM_DISCOVERY_GROUPS.length >= 2);
  assert.ok(Object.keys(REDDIT_SUBREDDIT_PACKS).includes('hiring'));
  const klaviyoQueries = platformFootprintQueries('skincare', 'London', 'Klaviyo');
  assert.ok(klaviyoQueries.some(q => /klaviyo/i.test(q)));

  // 5. Reddit Buyer-Intent Classifier accepts [Hiring] & owner pain points, rejects [For Hire] sellers
  const seller = classifyRedditPostIntent('[For Hire] Experienced Shopify & Web Developer ($40/hr)', 'Check my portfolio...', 'For Hire', 'forhire');
  assert.equal(seller.validBuyer, false);

  const buyer = classifyRedditPostIntent('[Hiring] Looking for a Shopify developer to redesign our store ($1,500 budget)', 'Our site is https://lumina-pets.com and email founder@lumina-pets.com', 'Hiring', 'forhire');
  assert.equal(buyer.validBuyer, true);
  assert.equal(buyer.intentType, 'Hiring Now');
  assert.equal(buyer.budgetHint, '$1,500 budget');
  assert.equal(buyer.externalWebsite, 'https://lumina-pets.com');
  assert.equal(buyer.extractedEmail, 'founder@lumina-pets.com');

  const ownerPain = classifyRedditPostIntent('Why is my Shopify store getting traffic from Facebook ads but not converting?', 'We get 400 clicks a day to my store https://nordicgear.shop but 0 sales.', '', 'smallbusiness');
  assert.equal(ownerPain.validBuyer, true);
  assert.equal(ownerPain.intentType, 'Business Pain Point');
  assert.equal(ownerPain.externalWebsite, 'https://nordicgear.shop');
});

test('extractWebsiteInsights captures ogImage, siteImages with missing-alt flags, and keyLinks for AI Research Evidence', () => {
  const sampleHtml = `
    <html>
      <head>
        <title>Bright Smile Dental | Austin TX</title>
        <meta property="og:image" content="https://brightsmile.example/assets/social-share.jpg">
        <link rel="apple-touch-icon" href="/apple-icon.png">
      </head>
      <body>
        <h1>Modern Cosmetic Dentistry in Austin</h1>
        <a href="/book-online">Book Appointment</a>
        <a href="/pricing">Services & Pricing</a>
        <img src="/images/clinic-hero.jpg" alt="Bright Smile Reception">
        <img src="/images/before-after.jpg">
        <img src="/images/pixel.gif" width="1" height="1">
      </body>
    </html>
  `;
  const info = extractWebsiteInsights(sampleHtml, 'https://brightsmile.example');
  assert.equal(info.logoUrl, 'https://brightsmile.example/apple-icon.png');
  assert.equal(info.ogImage, 'https://brightsmile.example/assets/social-share.jpg');
  assert.equal(info.siteImages.length, 2);
  assert.equal(info.siteImages[0].url, 'https://brightsmile.example/images/clinic-hero.jpg');
  assert.equal(info.siteImages[0].missingAlt, false);
  assert.equal(info.siteImages[1].url, 'https://brightsmile.example/images/before-after.jpg');
  assert.equal(info.siteImages[1].missingAlt, true);
  assert.ok(info.keyLinks.some(l => l.url === 'https://brightsmile.example/book-online' && l.label === 'Book Appointment'));
});
