# Changelog

## 1.0.0 - 2026-10-23 - First standalone release
- Port the native Reddit Ads API v3 tools of getmcpads with their names, schemas and ownership checks: 31 read tools and 22 write tools, plus two resources.
- Validate write payloads locally against Reddit's own schemas, pinned on 2026-09-11.
- Require an explicit ad account allowlist, default to read-only and preview every write. Campaigns, ad groups and ads are created paused.
- Renew access tokens in memory from a refresh token, never on disk.
- Use fixed Reddit hosts, no redirects, timeouts, bounded responses and credential redaction, without automatic write retries.
- Require a Node.js release with the October 2026 security fixes and check Node 22, 24 and 26 in CI.
- No hosted creative UI, alerts, exports or MCP Apps integrations.
