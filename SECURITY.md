# Security policy

## Supported versions

CalendarShare is a single-branch, self-hosted project. Only the latest code on `main` is supported; there are no maintained release branches.

## Reporting a vulnerability

Please do not open a public GitHub issue for a security vulnerability.

Instead, use [GitHub Security Advisories](../../security/advisories/new) for this repository to report it privately. This opens a private discussion with the maintainer before any details become public.

Please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it, or a minimal proof of concept.
- Any relevant environment details (Node.js version, Apps Script runtime, etc.).

You should receive an acknowledgment within a few days. Fixes will be released as soon as practical given the severity.

## Scope notes

CalendarShare runs entirely inside the deploying user's own Google account: there is no shared server, no multi-tenant backend, and no OAuth application beyond the user's own Apps Script project. Most security-relevant behavior concerns:

- What the dashboard exposes to the deploying account versus any other viewer (see [docs/PRIVACY.md](docs/PRIVACY.md)).
- What the generated calendar exposes to people it is shared with, based on the configured privacy policy per source calendar.
- Handling of local secrets such as `.clasp.json` and `.calendarshare.local.json`, both of which are gitignored and must never be committed.
