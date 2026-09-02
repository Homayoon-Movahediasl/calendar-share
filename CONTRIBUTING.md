# Contributing

CalendarShare is a small, self-hosted Apps Script project. Contributions that keep it simple and dependency-light are especially welcome.

## Getting set up

```sh
npm ci
npm run check
```

`npm run check` runs the TypeScript typecheck, the Vitest suite, and the Apps Script production build. It must pass before you open a pull request.

There is no need for a live Google account or Apps Script deployment to work on the code: all core logic (sync, identity mapping, privacy policy, dashboard state) is tested with fixtures in `tests/`. Only `npm run setup:google` / `npm run deploy` touch a real Google account.

## Making a change

- Keep the production bundle free of runtime npm dependencies; Google services come from the Apps Script runtime.
- Add or update tests alongside any behavior change, particularly around event identity, recurrence handling, and privacy policy filtering.
- Don't commit `.clasp.json`, `.calendarshare.local.json`, real calendar IDs, deployment IDs, or screenshots containing real event data. See [docs/PRIVACY.md](docs/PRIVACY.md).
- Match the existing code style; there is no separate linter/formatter step beyond `tsc`.

## Pull requests

- Describe the behavior change and why it's needed.
- Include the output of `npm run check`.
- Keep pull requests focused; avoid bundling unrelated cleanups with a functional change.

## Reporting bugs

Open a GitHub issue with reproduction steps. If the bug involves recurrence or reconciliation behavior, a minimal fixture (synthetic event data, not real calendar content) makes it much easier to turn into a regression test.

## Security issues

Do not open a public issue for a security vulnerability. See [SECURITY.md](SECURITY.md).
