<div align="center">

# Reddit Ads MCP server

### Bring your Reddit Ads accounts into your MCP client.

Read campaigns and reporting, inspect targeting and prepare changes for explicitly allowed ad accounts.

[![Release](https://img.shields.io/github/v/release/get-mcp-ads/reddit-ads-mcp-server?color=2448e5)](https://github.com/get-mcp-ads/reddit-ads-mcp-server/releases/latest)
[![CI](https://github.com/get-mcp-ads/reddit-ads-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/get-mcp-ads/reddit-ads-mcp-server/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-22.23.4%2B%20%7C%2024.22.1%2B%20%7C%2026.12.1%2B-brightgreen.svg)](package.json)

[Watch the film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4) · [What's new](#whats-new) · [Install](#install-this-release) · [Tool reference](#tools) · [Try hosted getmcpads](https://www.getmcpads.com/tools/reddit-ads?utm_source=github&utm_medium=readme&utm_campaign=reddit-ads)

[![Watch the getmcpads film: every ad account in one conversation with your AI assistant](https://www.getmcpads.com/home/film/brand-film-poster-promise.webp)](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)

**[Play the 45-second film](https://www.getmcpads.com/home/film/get-mcp-ads-brand-film-1080p.mp4)**

</div>

The film shows hosted getmcpads with sample data. Its MCP Apps, from creative galleries and alerts to Google Sheets exports and bulk launches, belong to the hosted product. This repository provides the standalone native API tools.

**31 read tools** · **22 write tools**, disabled by default.

Run locally with your own platform credentials and a client that supports stdio MCP, such as Claude Desktop, Claude Code or Cursor. Your requests go directly to the platform. For managed connections, including supported ChatGPT setups, use the hosted option.

## What's new

<!-- release-history:start -->
**[v1.0.1: Zod 4 security update](https://github.com/get-mcp-ads/reddit-ads-mcp-server/releases/tag/v1.0.1) · October 26, 2026**

- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- `reddit_get_insights` still names the rejected value when a metric or breakdown is unknown.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

**Earlier releases**

| Version | Date | Highlights |
| --- | --- | --- |
| 1.0.0 | October 23, 2026 | First standalone release |

[Full changelog](CHANGELOG.md) · [All releases](https://github.com/get-mcp-ads/reddit-ads-mcp-server/releases)
<!-- release-history:end -->

Source synchronization: [SOURCE_SYNC.md](SOURCE_SYNC.md).

### Upgrade notes

Requires **Node.js 22.23.4, 24.22.1, 26.12.1 or a newer release of those lines**. CI covers Node 22, 24 and 26, and the server prints a warning to stderr on an older runtime. Writes remain optional and require explicit confirmation. Hosted creative integrations and MCP Apps UI are outside this release.

## Install this release

This is a GitHub source release. npm and MCP Registry versions are published separately. The commands below select this exact version; unpinned `npx` examples later in this document select the version currently available on npm.

```bash
git clone --branch v1.0.1 --depth 1 https://github.com/get-mcp-ads/reddit-ads-mcp-server.git
cd reddit-ads-mcp-server
npm ci
npm run build
```

Configure your MCP client to run `node` with the absolute path to `dist/cli.js` and the platform credentials documented below. Once the package is on npm, the same server runs with `npx -y @getmcpads/reddit-ads-mcp-server`. A Claude Desktop entry looks like this:

```json
{
  "mcpServers": {
    "reddit-ads": {
      "command": "npx",
      "args": ["-y", "@getmcpads/reddit-ads-mcp-server"],
      "env": {
        "REDDIT_ADS_REFRESH_TOKEN": "your-refresh-token",
        "REDDIT_ADS_CLIENT_ID": "your-app-client-id",
        "REDDIT_ADS_CLIENT_SECRET": "your-app-secret",
        "REDDIT_ADS_ACCOUNT_IDS": "a2_abc123"
      }
    }
  }
}
```

> **Managed connection.** [Use Reddit Ads with hosted getmcpads](https://www.getmcpads.com/tools/reddit-ads?utm_source=github&utm_medium=readme&utm_campaign=reddit-ads). Connect your account, select the data your assistant may access and use the hosted MCP connection. See the site for current features and plans.

## Configuration

Provide these environment variables through the client's secret configuration:

| Variable | Purpose |
|---|---|
| `REDDIT_ADS_ACCESS_TOKEN` | OAuth access token with `adsread`, and `adsedit` if you enable writes. Optional when the three refresh variables are set. |
| `REDDIT_ADS_REFRESH_TOKEN` | Permanent refresh token. With the two variables below, the server renews access tokens in memory. |
| `REDDIT_ADS_CLIENT_ID` | Client ID of your Reddit app, needed with the refresh token. |
| `REDDIT_ADS_CLIENT_SECRET` | Secret of your Reddit app, needed with the refresh token. |
| `REDDIT_ADS_ACCOUNT_IDS` | Required comma-separated ad account IDs, such as `a2_abc123`. Every other account is refused, for reads too. |
| `REDDIT_ADS_ENABLE_WRITES` | Defaults to `false`. Only the exact value `true` exposes the 22 write tools. |
| `REDDIT_ADS_USER_AGENT` | Optional. Reddit asks clients to identify themselves, for example `node:my-ads-app:v1.0.0 (by /u/your_username)`. |

Register a developer application and request Ads API access as described in [Reddit's Ads API documentation](https://ads-api.reddit.com/docs/v3/). Then run Reddit's OAuth authorization code flow with the scopes `adsread`, plus `adsedit` only if you plan to enable writes, and `duration=permanent` to receive a refresh token.
Reddit access tokens expire after about an hour. Give the refresh token and the app credentials for daily use; an access token alone works until it expires.
This package accepts tokens. It does not run an OAuth browser flow and never writes a renewed token to disk. Reddit ad account IDs start with `a2_`; the business ID is a different value.

`npm run doctor` reports which variables are set, without printing any value, and whether your Node.js release carries the October 2026 security fixes. Run `reddit_health_check` as the first call: it reads the account, its business, currency and timezone.

## Safety and coverage

Writes preview by default. Review the exact account, target and payload before repeating the call with `confirm: true`.
Campaigns, ad groups and ads are created paused. Activation can spend advertising budget, and previews that set `configured_status` to `ACTIVE` say so with `activationMaySpend`.
Do not retry a write automatically when its result is uncertain. Read the account and reconcile it first. The server retries only after an HTTP 401, once, when it renewed the token, because Reddit rejected that request before acting on it.
The account allowlist applies before every request. Each entity read is checked against the ad account, directly or through its profile, business or catalog. Before a confirmed write, the campaigns, ad groups, posts, audiences, pixels, product sets, profiles and assets it references are checked the same way.
Write payloads are validated against Reddit's schemas pinned on 2026-09-11. Billing fields and computed statuses are refused. Passing local validation is not provider acceptance.
Budgets, bids and `SPEND` are microcurrency: one millionth of the account currency. Other reporting fields keep their native units. Pagination cursors are Reddit's own page tokens.

Requests go only to `ads-api.reddit.com` and, for token renewal, `www.reddit.com`. No request follows a redirect. Each one has a timeout and a response size limit. Credentials are redacted from every result and error.
Media URLs that Reddit returns are passed on as data. This server never downloads them.

Some Reddit capabilities are intentionally not exposed:

- Customer-list member uploads and conversion event injection.
- Lead submissions and any other download of personal records. Lead forms are readable as configuration only.
- Product feeds, billing and funding instruments.
- Destructive deletes. Status updates accept `PAUSED` and `ACTIVE` only, and saved audiences cannot be set to `DELETED`.
- Onsite lead-form creation, which Reddit ended on September 21, 2026.

This server exposes a reviewed subset of the Reddit Ads API. It does not automatically expose new upstream endpoints. Hosted creative galleries, alerts, exports and MCP Apps UI are excluded.
Use `tools/list` or [server-card.json](server-card.json) for exact schemas, `reddit_get_write_schema` for the pinned write schemas and [Reddit's API reference](https://ads-api.reddit.com/docs/v3/) for provider details.

## Hosted option

[getmcpads for Reddit Ads](https://www.getmcpads.com/tools/reddit-ads) manages the hosted connection and account selection.
Hosted and source releases can differ. Contact: hello@getmcpads.com.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run catalog
```

All tests run offline with synthetic responses. No live account is changed.

## Tools

Every tool is listed below. See [server-card.json](server-card.json) for complete parameter and output schemas.

<details>
<summary><b>31 read tools</b></summary>

| Tool | Purpose |
| --- | --- |
| `reddit_get_setup_guide` | Coverage, prerequisites, units, renaming and known limits of this server |
| `reddit_get_write_schema` | Pinned native schema for one write operation, including targeting and formats |
| `reddit_get_reporting_schema` | Every reporting metric and breakdown name Reddit accepts |
| `reddit_health_check` | Read the allowed ad account, its business, currency and timezone |
| `reddit_get_campaigns` | List campaigns with native configuration and status |
| `reddit_get_campaign` | Read one campaign after checking its account |
| `reddit_get_ad_groups` | List ad groups with native configuration and status |
| `reddit_get_ad_group` | Read one ad group after checking its account |
| `reddit_get_ads` | List ads with native configuration and status |
| `reddit_get_ad` | Read one ad after checking its account |
| `reddit_get_saved_audiences` | List saved audiences |
| `reddit_get_saved_audience` | Read one saved audience after checking its account |
| `reddit_get_custom_audiences` | List custom audiences |
| `reddit_get_custom_audience` | Read one custom audience after checking its account |
| `reddit_get_lead_gen_forms` | List lead form configurations, never lead submissions |
| `reddit_get_lead_form` | Read one lead form configuration after checking its account |
| `reddit_get_targeting` | Read the configured targeting of an ad group |
| `reddit_get_targeting_options` | Discover valid geolocations, languages, interests, devices, carriers and communities |
| `reddit_get_profiles` | List profiles attached to the ad account |
| `reddit_get_pixels` | List pixels available to the ad account |
| `reddit_get_insights` | Run a native report with metrics, up to three breakdowns, UTC dates and pagination |
| `reddit_get_creative_assets` | List the asset library of an attached profile |
| `reddit_get_posts` | List structured posts of an attached profile |
| `reddit_get_post` | Read one structured post after checking its profile |
| `reddit_get_asset_uploads` | Poll the processing of creative asset imports |
| `reddit_get_post_job` | Poll a structured post creation job with its signed receipt |
| `reddit_list_ad_creatives` | Resolve the images and videos behind ads, with explicit coverage |
| `reddit_get_catalogs` | List product catalogs of the business that owns the ad account |
| `reddit_get_products` | List products of an owned catalog |
| `reddit_get_product_sets` | List product sets of an owned catalog |
| `reddit_get_catalog_imports` | List catalog imports of an owned catalog |

</details>

<details>
<summary><b>22 write tools</b></summary>

Disabled by default. Calls preview unless explicitly confirmed. Check the configuration and exact schema before use.

| Tool | Purpose |
| --- | --- |
| `reddit_create_campaign` | Create a campaign, always paused |
| `reddit_update_campaign` | Update campaign fields, including pause or reactivation |
| `reddit_create_ad_group` | Create an ad group, always paused |
| `reddit_update_ad_group` | Update ad group fields, including targeting, bids and status |
| `reddit_create_ad` | Create an ad, always paused |
| `reddit_update_ad` | Update ad fields, including pause or reactivation |
| `reddit_create_saved_audience` | Create a saved audience |
| `reddit_update_saved_audience` | Update a saved audience, without deletion |
| `reddit_create_custom_audience` | Create a pixel, engagement or empty customer-list audience |
| `reddit_upload_creative_assets` | Import images, videos or headlines into a profile's asset library |
| `reddit_create_post` | Start a structured post creation job and return its receipt |
| `reddit_create_catalog` | Create a product catalog for the owning business |
| `reddit_create_product_set` | Create a product set in an owned catalog |
| `reddit_upsert_products` | Create or update products in an owned catalog |
| `reddit_rename_campaign` | Rename a campaign, nothing else |
| `reddit_rename_ad_group` | Rename an ad group, nothing else |
| `reddit_rename_ad` | Rename an ad, nothing else |
| `reddit_rename_ad_account` | Rename the ad account, nothing else |
| `reddit_update_post` | Change whether comments are allowed on a structured post |
| `reddit_update_asset` | Rename a creative asset |
| `reddit_update_catalog` | Update a catalog's name or event sources |
| `reddit_update_product_set` | Update a product set's name or filter |

</details>

### Resources

| Resource | Content |
| --- | --- |
| `reddit-ads://guide` | The setup guide, also returned by `reddit_get_setup_guide` |
| `reddit-ads://reporting-catalog` | Every metric with its category and unit note, and every dimension with whether it is a breakdown |

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

## More from getmcpads

[Meta Ads](https://github.com/get-mcp-ads/meta-ads-mcp-server) · [Google Ads](https://github.com/get-mcp-ads/google-ads-mcp-server) · [Google Analytics 4](https://github.com/get-mcp-ads/google-analytics-mcp-server) · [Google Search Console](https://github.com/get-mcp-ads/google-search-console-mcp-server) · [TikTok Ads](https://github.com/get-mcp-ads/tiktok-ads-mcp-server) · [Pinterest Ads](https://github.com/get-mcp-ads/pinterest-ads-mcp-server) · [X Ads](https://github.com/get-mcp-ads/x-ads-mcp-server)

Maintained by **Emmanuel** at [getmcpads](https://www.getmcpads.com). Questions: [hello@getmcpads.com](mailto:hello@getmcpads.com).
