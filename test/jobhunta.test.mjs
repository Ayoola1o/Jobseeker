import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBusinessCsv, writeBusinessCsv } from '../public/csv.mjs';
import {
  extractMessageBody,
  extractEmailsFromHtml,
  extractSocialsFromHtml,
  extractWebsiteInsights,
  detectPlatformAndTech,
  buildLeadIntelligence,
  parseBingMapsHtml,
  resolveSearchLocations,
  industries
} from '../server.mjs';

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
