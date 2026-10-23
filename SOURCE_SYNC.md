# Source synchronization

Reviewed on 2026-10-23 against getmcpads source revision `3e1c2c8`.

## Synchronized

- Every native Reddit Ads tool of the hosted connector (`apps/mcp/src/sources/reddit_ads`), with the same names, parameters, ownership checks and write previews: 31 read tools and 22 write tools. Descriptions are adapted to the standalone configuration.
- The Reddit write schemas pinned from `https://ads-api.reddit.com/api/v3/openapi.json` on 2026-09-11 (`src/schema.json`, copied unchanged) and their local validator.
- The reporting catalog derived from those schemas, served as the `reddit-ads://reporting-catalog` resource.
- The native asset resolution behind `reddit_list_ad_creatives`, taken from the hosted gallery module without its gallery output.
- The rename tools and their documented limits.
- The gateway's Reddit tests, ported to the standalone server in `test/unit/reddit.test.ts` and `test/unit/reddit-creatives.test.ts`.

## Standalone differences

- Credentials come from `REDDIT_ADS_*` environment variables. Token renewal happens in memory and is never persisted.
- `REDDIT_ADS_ACCOUNT_IDS` is an explicit allowlist, checked before every request and inside the API client.
- Structured post job receipts are signed with a random key held in memory, so they are valid only within the server process that issued them, for at most seven days.
- Onsite lead-form creation is not ported. Reddit ended it on 2026-09-21 and the hosted tool now refuses every call. Lead form reads remain.
- Saved audiences cannot be set to `DELETED`, completing the hosted rule that no write deletes.
- Write previews add `applied: false` and `activationMaySpend`, and an HTTP 200 response that carries an error body is reported as an error.
- The `User-Agent` sent to Reddit is configurable, because Reddit asks each client to identify its own app.

## Hosted only

Billing, quotas and plans, workspaces, stored account selection, token storage and encryption, creative galleries, creative performance and trends, MCP Apps UI, the Launcher, alerts and the alert metric catalog, Google Sheets exports, client memory, telemetry, partner integrations and the discovery meta-tools remain in the hosted product.

Validation uses synthetic data. No live advertising request is made by the test suite. The generated `server-card.json` is the source of truth for this revision's tool schemas.

Maintainer: Emmanuel, getmcpads. Contact: hello@getmcpads.com.
