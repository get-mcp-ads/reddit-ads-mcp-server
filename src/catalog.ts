/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reporting catalog derived from the pinned schema: every metric with its
 * category and unit note, and every dimension with whether Reddit accepts it
 * as a breakdown. Served as the reddit-ads://reporting-catalog resource.
 */
import { REDDIT_SCHEMA } from "./validation.js";

const ATTRIBUTES = new Set(
  "ACCOUNT_ID AD_CREATE_TIME AD_EFFECTIVE_STATUS AGE AD_GROUP_ID AD_ID AD_UPDATE_TIME ADGROUP_CREATE_TIME ADGROUP_UPDATE_TIME BID_STRATEGY CAMPAIGN_CREATE_TIME CAMPAIGN_ID CAMPAIGN_UPDATE_TIME COMMUNITY COUNTRY CURRENCY DATE DATETIME DMA GALLERY_ITEM_CAPTION GALLERY_ITEM_ID GENDER HOUR INTEREST KEYWORD PLACEMENT POST_ID PRIORITY REGION CLICK_ATTRIBUTION_WINDOW VIEW_ATTRIBUTION_WINDOW".split(" "),
);

function category(key: string): string {
  if (key.startsWith("APP_INSTALL")) return "app_conversion";
  if (key.startsWith("CONVERSION")) return "web_conversion";
  if (/VIDEO|VIEW|QUARTILE/.test(key)) return "video";
  if (/SPEND|CPC|CPV|ECPM|COST/.test(key)) return "cost";
  return "delivery";
}

export const REDDIT_METRICS = REDDIT_SCHEMA.metrics
  .filter(key => !ATTRIBUTES.has(key))
  .map(key => ({
    key,
    name: key.replaceAll("_", " "),
    apiField: key,
    category: category(key),
    description:
      key === "SPEND"
        ? "Native spend in microcurrency; divide by 1,000,000 for account currency."
        : "Native Reddit reporting metric, passed in fields. Retains provider units and attribution; availability depends on the breakdown, date range and privacy thresholds.",
    ...(key === "SPEND" ? { format: "micro_currency" } : {}),
  }));

export const REDDIT_DIMENSIONS = [...new Set([...ATTRIBUTES, ...REDDIT_SCHEMA.breakdowns])].map(key => {
  const breakdown = REDDIT_SCHEMA.breakdowns.includes(key);
  const column = REDDIT_SCHEMA.metrics.includes(key);
  return {
    key,
    name: key.replaceAll("_", " "),
    apiField: key,
    category: breakdown ? "breakdowns" : "report_attributes",
    description: `${breakdown ? "Accepted in breakdowns; at most three per request. " : "Report attribute, not an accepted breakdown. "}${column ? "Also accepted in fields. " : "Not a fields selector. "}${key === "HOUR" ? "Hourly reports are limited to seven days. " : ""}Delivery reporting does not establish configured targeting.`,
    requiredLevel: breakdown ? "breakdowns" : "fields",
  };
});
