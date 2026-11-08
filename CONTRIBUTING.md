# Contributing

Thanks for considering a contribution. This project is maintained by
[GetMCPAds](https://www.getmcpads.com) and is open to outside patches.

## Getting set up

Use Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines.

```bash
git clone https://github.com/get-mcp-ads/reddit-ads-mcp-server.git
cd reddit-ads-mcp-server
npm ci
cp .env.example .env
```

Then run the checks:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

All four must pass. CI runs them on Node 22, 24 and 26. Run `npm run catalog`
after changing a tool, so `server-card.json` stays current.

## Ground rules

**Never commit a credential.** `.env` is gitignored. Re-read your diff for
tokens and app secrets before opening a pull request.

**Tests use synthetic data.** Every test mocks `fetch`. Do not add a test that
needs live credentials or contacts a Reddit account.

**Field and metric names are Reddit's own.** Write payloads are checked against
the schemas pinned in `src/schema.json`, and reporting accepts only the names
listed there. If you add or change one, link the Reddit documentation it comes
from in the pull request.

**Writes must preview first.** Every write tool accepts `confirm`, returns a
preview without it, and is registered only when `REDDIT_ADS_ENABLE_WRITES` is
`true`. Campaigns, ad groups and ads are created paused. A write whose outcome is
uncertain must never be retried automatically.

**Keep the account scope.** Every tool takes `adAccountId`, checked against
`REDDIT_ADS_ACCOUNT_IDS`, and every entity and referenced ID is checked against
that account. Do not add a tool that bypasses either check.

**Credentials never reach another host.** Two tests enforce this: one fails if a
`fetch` omits `redirect: "error"`, the other if a host other than
`ads-api.reddit.com` or `www.reddit.com` appears in the source.

**Keep it self-contained.** Runtime dependencies are `@modelcontextprotocol/sdk`
and `zod`. Hosted features of getmcpads, such as creative galleries, alerts,
exports and MCP Apps UI, do not belong here.

**Write plain English.** No em dashes; the test suite checks for them.

## Commit and pull request style

- One logical change per pull request.
- Explain why, not only what.
- If you fix a bug, add the test that would have caught it.

## Reporting bugs

Open an issue with what you called, what you expected and what you got. Redact
IDs and tokens. For anything security-related, see [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the
Apache License 2.0, as stated in [LICENSE](LICENSE).
