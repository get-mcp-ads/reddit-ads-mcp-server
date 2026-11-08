/**
 * stdout is the MCP channel. A misconfigured start must explain itself on
 * stderr, exit non-zero, write nothing to stdout and never echo a secret.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("REDDIT_ADS_")));

test("a missing account allowlist stops the server with an actionable stderr message", () => {
  const result = spawnSync(process.execPath, [cli], { env: { ...cleanEnv, REDDIT_ADS_ACCESS_TOKEN: "smoke-secret-token" }, input: "", encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /REDDIT_ADS_ACCOUNT_IDS/);
  assert.ok(!result.stderr.includes("smoke-secret-token"));
});

test("a configured server answers over stdio with reads only by default", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    env: { ...cleanEnv, REDDIT_ADS_ACCESS_TOKEN: "smoke-token", REDDIT_ADS_ACCOUNT_IDS: "a2_smoke" },
    stderr: "pipe",
  });
  const client = new Client({ name: "reddit-ads-smoke", version: "1" });
  try {
    await client.connect(transport, { timeout: 15000 });
    const tools = (await client.listTools()).tools;
    assert.ok(tools.length > 20);
    assert.ok(tools.every((tool) => tool.annotations.readOnlyHint === true));
    assert.ok(tools.some((tool) => tool.name === "reddit_health_check"));
    const guide = await client.readResource({ uri: "reddit-ads://guide" });
    assert.match(guide.contents[0].text, /REDDIT_ADS_ACCOUNT_IDS/);
  } finally {
    await client.close();
  }
});
