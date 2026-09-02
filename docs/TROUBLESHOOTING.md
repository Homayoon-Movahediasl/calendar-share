# Troubleshooting

## `Script function not found: doGet`

The deployment is usually pointing at an old immutable version. Run `npm run deploy`, then edit the existing deployment in **Deploy → Manage deployments**, choose **New version**, and deploy. Keep using the same `/exec` URL.

## Apps Script API is disabled

Open [Google Apps Script user settings](https://script.google.com/home/usersettings), enable the Apps Script API, wait a few minutes, and rerun the command. Authenticate `clasp` with the same account that owns the script.

## No source calendars appear

Run a dashboard refresh and inspect the Calendar API account. A calendar visible in the Google Calendar UI may be inaccessible through the API or may expose only limited event details. Confirm the account, subscription, and sharing permission before changing code.

## Events are missing or stale

Check dashboard health and the Apps Script Executions page. Run a dry run, then sync manually. External ICS calendars are limited by Google's cached refresh. A temporary source failure intentionally retains the last known projection rather than deleting it.

## Duplicates or a destination used as a source

Run another sync; deterministic IDs should converge. Ensure the generated calendar is not selected as a source. Never delete generated events manually as a troubleshooting step unless you intend the next sync to repair them.

## I deleted the Apps Script project and want to start over

`npm run setup:google` only checks whether a local `.clasp.json` file exists — it doesn't verify the project it points to is still there. If you delete the Apps Script project (or the whole thing gets removed) but `.clasp.json` remains, the installer will still try to reuse that project and may prompt you to pick a deployment on it.

To start completely fresh, delete the local state and rerun setup:

```sh
rm -f .clasp.json .calendarshare.local.json
npm run setup:google
```

This only removes local config; it does not touch anything in your Google account. With no `.clasp.json`, the installer creates a brand-new standalone Apps Script project.

## Authorization or quota errors

Reauthorize the script in Apps Script and verify Calendar API is enabled. Reduce the selected source set or horizon if executions approach the Apps Script time or Calendar quotas. For unusually large accounts, consider a separately designed serverless worker.
