# Jobhunta

Find local businesses, enrich contact emails, save leads, and manage one-to-one Gmail outreach from a personal workspace.

## Run on Windows

Open PowerShell in the Jobhunta folder. With Node.js 24 or newer installed, run:

```powershell
npm start
```

Open [http://localhost:4173](http://localhost:4173). Search, website email scanning, and manual/CSV lead management are available before connecting Gmail.

To run the automated test suite:

```powershell
npm test
```

## Connect Gmail

1. In your Google Cloud project, enable the Gmail API. Configure the OAuth consent screen and add your Gmail address as a test user if the app is in testing.
2. Create an OAuth client of type **Web application**. Add `http://localhost:4173/oauth/callback` as an authorized redirect URI.
3. Download the Web application client JSON and save it beside `server.mjs` as `.google-oauth.json`, or copy `.env.example` to `.env` and enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Keep credential files private.
4. Restart the server, choose **Connect Gmail**, and grant both Gmail permissions. Your session tokens, leads, and outreach templates are persisted locally in `.jobhunta-data.json` across server restarts.

[Google OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server) · [Gmail API setup](https://developers.google.com/workspace/gmail/api/quickstart/js)

## Outreach Templates & Same-Thread Follow-ups

1. Click **Templates & profile** in the top bar to save your name, service description, default follow-up reminder interval, and reusable pitch templates (`{{business_name}}`, `{{city}}`, `{{industry}}`, `{{your_name}}`, `{{your_service}}`).
2. Open **Draft email** on any lead, pick a template, complete any remaining placeholders, and send via Gmail.
3. Open **Inbox** to read replies (including HTML-formatted replies) and send either a **Reply in thread** or a **Send follow-up in thread** directly in the same Gmail conversation.

## Import, Export & Enrich Businesses

* **Import & Export CSV:** Open **Saved leads → Import CSV** to import either the standard Jobhunta CSV template or CSV exports from the Bing Maps Scraper extension (`mapleedsscapper`). Use **Export CSV** to back up all saved leads, notes, statuses, and follow-up dates.
* **Website Email Discovery:** Click **Find email** on an individual lead or **Find missing emails** in **Saved leads** to scan business websites and contact pages for public email addresses.
* **Custom Industry Search:** Choose from 22 built-in industry categories or type any custom business keyword in **Find businesses**.

## Production upgrade

Before deploying, run the updated SQL in supabase/schema.sql and set an independent
SESSION_SECRET of at least 32 characters in the deployment environment. Use the same
secret across instances. Changing it invalidates old sessions and encrypted Gmail
connections. Users may need to sign in and reconnect Gmail. Legacy single-user
records retain the private default workspace owner until explicitly assigned.

## Business discovery

Choose Local businesses or Online websites and enter comma-separated related terms
and locations. Use Generate queries to preview editable Google operators or open
the searches in Google. Paste business URLs or import directory CSV files from
Saved leads. Include the listing URL in the CSV source column to retain provenance.

Set TAVILY_API_KEY server-side to enable Tavily web search. Combined sources
prefers Tavily when configured. Set SERPER_API_KEY to enable the separate
Google web source or use Google web in combined mode when Tavily is unconfigured. Set
GOOGLE_PLACES_API_KEY with Places API (New) enabled to include Google Maps
references. Google Places lookups request place IDs only. The app opens those
references in Google Maps and saves lead details from other sources.

A submitted batch uses one search. Up to 12 term/location combinations and 12 web
queries run per batch. Repeated businesses within the batch count once toward
the daily business-result quota. Google Maps references do not consume that quota.

## Outreach inbox upgrade

Apply the updated supabase/schema.sql before deploying. It adds the
service-role-only outreach registration function and preserves existing thread
records when the workspace is saved. Existing outreach records are checked
against Gmail before they are upgraded.
