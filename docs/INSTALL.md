# Installation

CalendarShare is a self-hosted Google Apps Script project. No server stays online and no shared OAuth application is required.

## Requirements

- Node.js 20 or newer and npm
- A Google account that can see the calendars to project
- A standalone Apps Script project
- The Apps Script API enabled in [Google user settings](https://script.google.com/home/usersettings)

## First installation

From a fresh clone:

```sh
npm install
npm run setup:google
npm run deploy
```

The setup command checks `clasp`, authenticates if necessary, creates a standalone project only when no `.clasp.json` exists, builds the bundle, pushes it, creates a versioned web-app deployment, and saves the deployment ID/URL in the ignored `.calendarshare.local.json`. It is safe to rerun after an interrupted step; it does not delete or replace an existing cloud project.

Open the printed dashboard URL. On first use, create the generated calendar, select source policies, run a dry run, and sync. Share the generated calendar in Google Calendar with **See all event details**.

## Updating

```sh
npm run check
npm run deploy
```

Updates push a new version and update the existing deployment, preserving its `/exec` URL. If deployment metadata is missing, the installer asks you to select the existing deployment instead of silently creating another one. `npm run push:google` is available for a HEAD-only development upload and does not update a production URL.

## Manual Apps Script fallback

If the guided setup cannot create a project, create a standalone script at [script.google.com](https://script.google.com), copy its Script ID, and place it in `.clasp.json` (use `.clasp.json.example` as a template). Then run `npx clasp login` and `npm run deploy`.

In Apps Script, authorize the requested Calendar read and app-created-calendar scopes. The manifest runs the web app as the deploying account and limits dashboard access to that account.

## Recovery

Do not rerun setup to fix a stale web URL. Push the code, create/select a new version for the existing deployment, and refresh `/exec`. If the generated calendar was deleted, stop and inspect the dashboard health state before deliberate recovery; the application will not create an unshared replacement automatically.
