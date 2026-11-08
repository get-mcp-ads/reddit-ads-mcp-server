#!/usr/bin/env node
/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * stdout carries the MCP protocol, so every diagnostic goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { nodeRuntimeWarning } from "./runtime-check.js";

const warning = nodeRuntimeWarning();
if (warning) console.error(`[reddit-ads-mcp] ${warning}`);

try {
  await createServer(loadConfig()).connect(new StdioServerTransport());
} catch (error) {
  console.error(`[reddit-ads-mcp] ${error instanceof Error ? error.message : "Reddit Ads server failed to start."}`);
  process.exitCode = 1;
}
