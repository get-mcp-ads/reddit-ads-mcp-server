# Changelog

## 1.0.1 - 2026-10-26 - Zod 4 security update
- Update `zod` to 4.6.7. Every Zod release before 4.6.6 is covered by the high-severity advisory GHSA-mrhx-c7xc-m3w5: validating an oversized constrained collection can exhaust memory, and no Zod 3 release carries the fix. `npm audit --omit=dev` reports no vulnerability again.
- Keep the Zod 3 validation behaviour. A parameter default is still validated and completed before use, so an omitted object must still supply its required fields.
- Keep each parameter's own description when the parameter is optional or has a default. Zod 4 stores a description on the wrapped schema only, so the shared fallback description could otherwise replace it.
- `reddit_get_insights` still names the rejected value when a metric or breakdown is unknown.
- Tool names, parameters and descriptions published over MCP are unchanged. `server-card.json` is regenerated with Zod 4's JSON Schema output, which spells some constraints differently.

## 1.0.0 - 2026-10-23 - First standalone release
- Port the native Reddit Ads API v3 tools of getmcpads with their names, schemas and ownership checks: 31 read tools and 22 write tools, plus two resources.
- Validate write payloads locally against Reddit's own schemas, pinned on 2026-09-11.
- Require an explicit ad account allowlist, default to read-only and preview every write. Campaigns, ad groups and ads are created paused.
- Renew access tokens in memory from a refresh token, never on disk.
- Use fixed Reddit hosts, no redirects, timeouts, bounded responses and credential redaction, without automatic write retries.
- Require a Node.js release with the October 2026 security fixes and check Node 22, 24 and 26 in CI.
- No hosted creative UI, alerts, exports or MCP Apps integrations.
