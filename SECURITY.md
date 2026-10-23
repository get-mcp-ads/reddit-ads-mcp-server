# Security Policy

This server holds credentials that can read, and when writes are enabled modify,
live Reddit advertising accounts. We take reports seriously.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/reddit-ads-mcp-server/security/advisories/new),
or write to hello@getmcpads.com. Do not include live tokens or customer data.

We aim to acknowledge a report within 3 business days and to ship a fix or a
documented mitigation within 30 days. We will credit you in the advisory unless
you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## What this server does with your credentials

- The access token, the refresh token and the app secret are read once from the
  environment at startup and kept in memory. A renewed token stays in memory too.
  None is written to disk, logged or returned in a result.
- Two hosts are contacted, and only two: `ads-api.reddit.com` for the API and
  `www.reddit.com` for token renewal. A test fails the build if another host
  appears in the source.
- No fetch follows a redirect. Every outbound call sets `redirect: "error"`, so
  a redirect cannot forward a credential to another host. A test fails the build
  if a fetch omits it.
- Every request has a timeout and a response size limit.
- Provider error text is redacted of every known credential before it reaches the
  model, and is treated as untrusted data.
- No telemetry, no analytics, no phone-home.

## Account scope

Only the ad accounts listed in `REDDIT_ADS_ACCOUNT_IDS` are reachable. The
allowlist is checked before every request. Entity reads are checked against the
ad account, directly or through the profile, business or catalog that owns them.
Before a confirmed write, the campaigns, ad groups, posts, audiences, pixels,
product sets, profiles and assets it references are checked the same way.

Structured post jobs are polled with a receipt signed by a random key that exists
only in the memory of the running process, so a job ID from another account
cannot be polled.

## URLs returned by Reddit

Pagination links are not followed: only their page token is reused, after the
link was checked to point at the same Reddit endpoint. Media URLs in creative
results are returned as data and never downloaded by this server.

## Personal data

Lead submissions are not exposed at all. Lead form tools return form
configuration only. Customer-list member uploads are not exposed either.

## Handling your credentials safely

- Grant `adsread` only. Add `adsedit` only if you enable writes.
- Treat the tokens and the app secret like passwords.
- Your MCP client configuration file is usually plain text on disk. Check its
  permissions and never commit it.
- Revoke the app's access in your Reddit settings if you suspect exposure.

## Scope

Vulnerabilities in the Reddit Ads API itself are not in scope here; report those
to Reddit.
