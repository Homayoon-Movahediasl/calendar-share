# Architecture

CalendarShare is a scheduled, one-way projection:

```text
CalendarList + Events API -> policy filter -> occurrence projection -> destination upsert/delete
                                                               |
                                                       generated calendar
```

The Apps Script trigger runs periodically (normally every 15 minutes). The dashboard runs the same operations on demand for the owner.

## State

The configuration stores the exact app-created destination ID, rolling horizon, and active source policies. Generated events carry private source calendar/event identity and a deterministic destination ID. This makes retries idempotent and prevents the destination from becoming a source. Script Properties hold configuration and health markers; no external database is needed.

## Synchronization

Each run discovers configured sources, reads events in the bounded horizon, expands recurring masters into occurrences, applies the privacy policy, and upserts the resulting event. A source is eligible for stale-event deletion only after a complete successful read. Removed or ignored sources are purged after the configured failure/revocation policy. Locks prevent concurrent executions; deterministic IDs make an interrupted run converge on retry.

Occurrence projection is intentionally simpler than mirroring Google event resources: every occurrence is treated as an independently addressable derived event. A moved or modified exception therefore updates its own projection, while a series edit is reflected when the next reconciliation expands the series again.

## Boundaries

The source adapter exposes read operations only. The destination writer asserts the exact configured destination ID before every mutation. The generated calendar is derived state and may be repaired after manual edits. External ICS freshness is controlled by Google's subscription refresh, not by this project.

See the source tree under `src/app`, `src/core`, and `src/google` for the implementation and [Troubleshooting](TROUBLESHOOTING.md) for operational recovery.
