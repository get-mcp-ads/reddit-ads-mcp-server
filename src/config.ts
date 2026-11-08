/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from "zod";

/** Reddit identifiers: letters, digits, underscore, dot and dash, never "..". */
export const NATIVE_ID = /^[\w.-]{1,128}$/;
const nativeId = z.string().regex(NATIVE_ID).refine(value => !value.includes(".."));
const secret = z.string().min(1).max(4096).optional();

const schema = z.object({
  accessToken: secret,
  refreshToken: secret,
  clientId: z.string().min(1).max(256).optional(),
  clientSecret: secret,
  allowedAccountIds: z.array(nativeId).min(1).max(200),
  enableWrites: z.boolean().prefault(false),
  userAgent: z.string().regex(/^[\x20-\x7e]{1,256}$/).optional(),
});

export type RedditServerConfig = z.infer<typeof schema>;
export type RedditServerInput = z.input<typeof schema>;

const VARIABLES: Record<string, string> = {
  accessToken: "REDDIT_ADS_ACCESS_TOKEN must be a nonempty token.",
  refreshToken: "REDDIT_ADS_REFRESH_TOKEN must be a nonempty token.",
  clientId: "REDDIT_ADS_CLIENT_ID must be the client ID of your Reddit app.",
  clientSecret: "REDDIT_ADS_CLIENT_SECRET must be the secret of your Reddit app.",
  allowedAccountIds: "REDDIT_ADS_ACCOUNT_IDS must list 1 to 200 Reddit ad account IDs separated by commas, such as a2_abc123.",
  enableWrites: "REDDIT_ADS_ENABLE_WRITES must be true or false.",
  userAgent: "REDDIT_ADS_USER_AGENT must be 1 to 256 printable ASCII characters.",
};

/**
 * Validates a configuration object. Messages name the variable to fix and
 * never repeat a value, so a misplaced token cannot end up in a log.
 */
export function validateConfig(value: unknown): RedditServerConfig {
  const result = schema.safeParse(value);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map(issue => String(issue.path[0] ?? "")))];
    throw new Error(`Invalid Reddit Ads configuration. ${keys.map(key => VARIABLES[key] ?? `Check ${key}.`).join(" ")}`);
  }
  const config = result.data;
  const refresh = [config.refreshToken, config.clientId, config.clientSecret];
  if (refresh.some(Boolean) && !refresh.every(Boolean)) {
    throw new Error("REDDIT_ADS_REFRESH_TOKEN, REDDIT_ADS_CLIENT_ID and REDDIT_ADS_CLIENT_SECRET work together. Set all three, or only REDDIT_ADS_ACCESS_TOKEN.");
  }
  if (!config.accessToken && !config.refreshToken) {
    throw new Error("Set REDDIT_ADS_ACCESS_TOKEN, or REDDIT_ADS_REFRESH_TOKEN with REDDIT_ADS_CLIENT_ID and REDDIT_ADS_CLIENT_SECRET.");
  }
  return { ...config, allowedAccountIds: [...new Set(config.allowedAccountIds)] };
}

/** Reads the configuration from REDDIT_ADS_* environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RedditServerConfig {
  const flag = env.REDDIT_ADS_ENABLE_WRITES ?? "";
  if (!["", "true", "false"].includes(flag)) {
    throw new Error("REDDIT_ADS_ENABLE_WRITES must be true or false. Only the exact value true exposes write tools.");
  }
  const optional = (name: string) => (env[name] ? env[name] : undefined);
  return validateConfig({
    accessToken: optional("REDDIT_ADS_ACCESS_TOKEN"),
    refreshToken: optional("REDDIT_ADS_REFRESH_TOKEN"),
    clientId: optional("REDDIT_ADS_CLIENT_ID"),
    clientSecret: optional("REDDIT_ADS_CLIENT_SECRET"),
    allowedAccountIds: (env.REDDIT_ADS_ACCOUNT_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean),
    enableWrites: flag === "true",
    userAgent: optional("REDDIT_ADS_USER_AGENT"),
  });
}
