/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * The only hosts this server ever contacts. The API client and the token
 * renewal both read from here, and test/redirect-guard.test.mjs fails when a
 * host outside this list appears anywhere in src/.
 */
export const REDDIT_API_ORIGIN = "https://ads-api.reddit.com";
export const REDDIT_API_BASE = `${REDDIT_API_ORIGIN}/api/v3`;
export const REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
export const ALLOWED_HOSTS = ["ads-api.reddit.com", "www.reddit.com"] as const;
