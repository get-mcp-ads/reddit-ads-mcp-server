/**
 * The README documents every tool and resource by name. A tool renamed in the
 * code and not in the README is a documentation bug, and this test fails on it.
 * Counts in the README, package.json and server.json must equal the code.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const README = read("README.md");
const pkg = JSON.parse(read("package.json"));
const server = JSON.parse(read("server.json"));

let cached;
async function introspect() {
  if (cached) return cached;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js"],
    env: { ...process.env, REDDIT_ADS_ACCESS_TOKEN: "token-for-listing", REDDIT_ADS_ACCOUNT_IDS: "a2_listing", REDDIT_ADS_ENABLE_WRITES: "true" },
  });
  const client = new Client({ name: "readme-check", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  const definitions = (await client.listTools()).tools;
  const resources = (await client.listResources()).resources.map((r) => r.uri);
  await client.close();
  cached = { tools: definitions.map((t) => t.name), resources, definitions };
  return cached;
}

test("README documents every tool the server exposes, and invents none", async () => {
  const { tools } = await introspect();
  const cited = new Set([...README.matchAll(/`(reddit_[a-z_]+)`/g)].map((m) => m[1]));
  const undocumented = tools.filter((t) => !cited.has(t));
  assert.deepEqual(undocumented, [], `Tools missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !tools.includes(c));
  assert.deepEqual(invented, [], `README cites tools that do not exist: ${invented.join(", ")}`);
});

test("README documents every resource the server exposes, and invents none", async () => {
  const { resources } = await introspect();
  const cited = new Set([...README.matchAll(/`(reddit-ads:\/\/[a-z0-9-]+)`/g)].map((m) => m[1]));
  const undocumented = resources.filter((r) => !cited.has(r));
  assert.deepEqual(undocumented, [], `Resources missing from README: ${undocumented.join(", ")}`);
  const invented = [...cited].filter((c) => !resources.includes(c));
  assert.deepEqual(invented, [], `README cites resources that do not exist: ${invented.join(", ")}`);
});

test("README, package.json and server.json counts match reality", async () => {
  const { tools, resources, definitions } = await introspect();
  const writes = definitions.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
  const reads = tools.filter((t) => !writes.includes(t));

  assert.equal(reads.length, 31, "read tool count changed, update the README");
  assert.equal(writes.length, 22, "write tool count changed, update the README");
  assert.equal(resources.length, 2, "resource count changed, update the README");

  assert.match(README, new RegExp(`\\*\\*${reads.length} read tools\\*\\* · \\*\\*${writes.length} write tools\\*\\*, disabled by default\\.`));
  assert.match(README, new RegExp(`<b>${reads.length} read tools</b>`));
  assert.match(README, new RegExp(`<b>${writes.length} write tools</b>`));
  for (const description of [pkg.description, server.description]) {
    assert.match(description, new RegExp(`\\b${reads.length} read tools, ${writes.length} opt-in`));
  }
  const flag = server.packages[0].environmentVariables.find((v) => v.name === "REDDIT_ADS_ENABLE_WRITES");
  assert.match(flag.description, new RegExp(`\\b${writes.length} write tools`));
});

test("published prose uses no em dashes", () => {
  const files = ["README.md", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "CHANGELOG.md", "RELEASING.md", "SOURCE_SYNC.md", "NOTICE", ".env.example", "server.json", "package.json"];
  const walk = (dir, acc = []) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`, acc);
      else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
    }
    return acc;
  };
  const offenders = [];
  for (const file of [...files, ...walk("src")]) {
    read(file).split("\n").forEach((line, i) => {
      if (line.includes("—")) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Em dashes are not used in this project. Rewrite the sentence instead of swapping the character. Found at: ${offenders.join(", ")}`);
});

test("README names no competing or community project and compares with no official server", () => {
  assert.doesNotMatch(README, /\bofficial (Reddit Ads )?MCP server\b/i);
  assert.doesNotMatch(README, /\bvs\.? /i);
});
