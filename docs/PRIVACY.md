# Privacy and data handling

CalendarShare copies data from selected calendars into a derived calendar that you may share with other people. Treat every selected source as an explicit disclosure decision.

## Policies

- `IGNORE`: no events are read into the projection.
- `BUSY_ONLY`: copies occupied time, all-day state, timezone, and a generic label.
- `FULL`: copies the title and, when enabled, location and description.

The projection does not clone attendees, organizer, conference data, attachments, reminders, HTML links, or extended properties. A description or location can still contain sensitive text or a pasted meeting link; choose `BUSY_ONLY` or disable those fields where appropriate. Source permissions remain authoritative: the script cannot reveal fields the API does not return.

## Storage and access

Configuration and source inventory are stored in the Apps Script project's private Script Properties. Event identity metadata is private to generated events. The owner-only dashboard is protected by Apps Script web-app access settings. The generated calendar is the only surface intended for viewers.

The project does not send calendar data to a third-party server. Google Calendar and Apps Script retain data under the account's Google terms and settings.

## Safety rules

Never commit `.clasp.json`, OAuth credentials, Script Properties exports, real calendar IDs, or screenshots containing event data. Use fictional fixtures for tests and documentation. Review the generated calendar's sharing settings after every deployment.
