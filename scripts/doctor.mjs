#!/usr/bin/env node
/**
 * Reports which REDDIT_ADS_* variables are set, without printing any value,
 * and whether this Node.js release carries the October 2026 security fixes.
 */
import { loadConfig, nodeRuntimeWarning } from "../dist/index.js";

const names = [
  "REDDIT_ADS_ACCESS_TOKEN",
  "REDDIT_ADS_REFRESH_TOKEN",
  "REDDIT_ADS_CLIENT_ID",
  "REDDIT_ADS_CLIENT_SECRET",
  "REDDIT_ADS_ACCOUNT_IDS",
  "REDDIT_ADS_ENABLE_WRITES",
  "REDDIT_ADS_USER_AGENT",
];
const present = (name) => typeof process.env[name] === "string" && process.env[name].length > 0;

let configError;
let config;
try { config = loadConfig(); } catch (error) { configError = error instanceof Error ? error.message : String(error); }
const runtimeWarning = nodeRuntimeWarning();

const result = {
  package: "@getmcpads/reddit-ads-mcp-server",
  ok: !configError && !runtimeWarning,
  node: { version: process.versions.node, warning: runtimeWarning ?? null },
  variables: names.map((name) => ({ name, present: present(name) })),
  accounts: config ? config.allowedAccountIds.length : 0,
  auth: config ? (config.refreshToken ? "refresh credentials (renewed in memory)" : "access token only") : null,
  writes: config ? config.enableWrites : false,
  error: configError ?? null,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
