import { test } from 'node:test';
import { assessLead, industryAngle, normalizeLeadProfiles } from '../public/qualification.mjs';
import { googleQueries, businessKeys } from '../public/discovery.mjs';
import assert from 'node:assert/strict';
import { readBusinessCsv, writeBusinessCsv } from '../public/csv.mjs';
import { detectPlatform, analyzePageAudit, generateClientOutreach, generateLeadSolutionPack, buildSolutionPackHtml } from '../public/audit.mjs';
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

test('USER_TIERS and getUserQuotaStatus enforce Basic through Diamond limits', () => {
  assert.equal(USER_TIERS.basic.dailySearchLimit, 50);
  assert.equal(USER_TIERS.basic.dailyResultLimit, 250);
  assert.equal(USER_TIERS.basic.dailyEmailLimit, 10);
  assert.equal(USER_TIERS.silver.dailySearchLimit, 20);
  assert.equal(USER_TIERS.silver.dailyResultLimit, 500);
  assert.equal(USER_TIERS.silver.dailyEmailLimit, 30);
  assert.equal(USER_TIERS.gold.dailySearchLimit, 50);
  assert.equal(USER_TIERS.gold.dailyResultLimit, 1500);
  assert.equal(USER_TIERS.gold.dailyEmailLimit, 50);
  assert.equal(USER_TIERS.premium.dailySearchLimit, 100);
  assert.equal(USER_TIERS.premium.dailyResultLimit, 3000);
  assert.equal(USER_TIERS.premium.dailyEmailLimit, 100);
  assert.equal(USER_TIERS.diamond.dailySearchLimit, null);
  assert.equal(USER_TIERS.diamond.dailyResultLimit, null);
  assert.equal(USER_TIERS.diamond.dailyEmailLimit, null);

  const diamondStatus = getUserQuotaStatus({ tier: 'diamond', searches_today: 999, emails_today: 500 });
  assert.equal(diamondStatus.tier, 'diamond');
  assert.equal(diamondStatus.dailySearchLimit, null);
  assert.equal(diamondStatus.dailyEmailLimit, null);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(getUserQuotaStatus({ tier: 'basic', usage_date: today, results_today: 249 }).resultsToday, 249);
  assert.equal(getUserQuotaStatus({ tier: 'basic', usage_date: '2020-01-01', results_today: 250 }).resultsToday, 0);
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
