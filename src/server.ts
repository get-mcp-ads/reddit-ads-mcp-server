/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { installToolQuality } from "./tool-quality.js";
import { validateConfig, type RedditServerInput } from "./config.js";
import { RedditClient } from "./client.js";
import { GUIDE, registerRedditReads, registerRedditWrites, type Collector } from "./tools.js";
import { REDDIT_DIMENSIONS, REDDIT_METRICS } from "./catalog.js";
import { REDDIT_SCHEMA } from "./validation.js";

export const PACKAGE_VERSION = "1.0.1";
export const DEFAULT_USER_AGENT = `node:reddit-ads-mcp-server:v${PACKAGE_VERSION} (self-hosted)`;

export function createServer(input: RedditServerInput): McpServer {
  const config = validateConfig(input);
  const server = new McpServer(
    { name: "reddit-ads-mcp", version: PACKAGE_VERSION, title: "Reddit Ads", websiteUrl: "https://www.getmcpads.com/tools/reddit-ads", icons: [{ src: "https://mcp.getmcpads.com/icon.svg", mimeType: "image/svg+xml" }] },
    { capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } } },
  );
  installToolQuality(server);
  const api = new RedditClient({
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    allowedAccountIds: config.allowedAccountIds,
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    // Signs post job receipts for this process only. Never stored or logged.
    jobSigningKey: randomBytes(32).toString("hex"),
  });
  const collector = server as unknown as Collector;
  registerRedditReads(collector, api);
  if (config.enableWrites) registerRedditWrites(collector, api);

  const json = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });
  server.registerResource("Reddit Ads guide", "reddit-ads://guide", {
    title: "Reddit Ads guide",
    description: "Coverage, prerequisites, units, renaming and known limits of this server. Same content as reddit_get_setup_guide.",
    mimeType: "application/json",
  }, async uri => json(uri, GUIDE));
  server.registerResource("Reddit Ads reporting catalog", "reddit-ads://reporting-catalog", {
    title: "Reddit Ads reporting catalog",
    description: "Every reporting metric with its category and unit note, and every dimension with whether Reddit accepts it as a breakdown.",
    mimeType: "application/json",
  }, async uri => json(uri, { source: REDDIT_SCHEMA.source, checkedAt: REDDIT_SCHEMA.checkedAt, metrics: REDDIT_METRICS, dimensions: REDDIT_DIMENSIONS }));
  return server;
}
