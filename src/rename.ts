/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Rename tools, one per level. Reddit updates are partial PATCHes, so the
 * name is the only field a rename sends.
 */
export const RENAMING = [
  { level: "account", native: "ad account", tool: "reddit_rename_ad_account", params: ["adAccountId"], limits: "3 to 500 characters.", doc: "https://ads-api.reddit.com/docs/v3/api/update-ad-account" },
  { level: "campaign", native: "campaign", tool: "reddit_rename_campaign", params: ["adAccountId", "campaignId"], limits: "3 to 500 characters.", doc: "https://ads-api.reddit.com/docs/v3/api/update-campaign" },
  { level: "ad_group", native: "ad group", tool: "reddit_rename_ad_group", params: ["adAccountId", "adGroupId"], limits: "3 to 500 characters.", doc: "https://ads-api.reddit.com/docs/v3/api/update-ad-group" },
  { level: "ad", native: "ad", tool: "reddit_rename_ad", params: ["adAccountId", "adId"], limits: "3 to 500 characters.", doc: "https://ads-api.reddit.com/docs/v3/api/update-ad" },
];

/** The preview every rename returns until confirm is true. Nothing is sent. */
export function renamePreview(action: string, target: string, newName: string) {
  return {
    applied: false,
    action,
    change: { target, newName },
    message: "Preview only, nothing was changed. Repeat the same call with confirm: true to apply this rename to the live account.",
  };
}
