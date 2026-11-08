/**
 * Every outbound call carries a bearer token or the app secret. Following a
 * redirect would forward that credential to whatever host the redirect names,
 * so no fetch in this codebase may omit `redirect: "error"`, and no host other
 * than Reddit's API and token hosts may appear in the source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

function sourceFiles(dir = "src", acc = []) {
  for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(`${dir}/${entry.name}`, acc);
    else if (entry.name.endsWith(".ts")) acc.push(`${dir}/${entry.name}`);
  }
  return acc;
}

test("every fetch refuses to follow redirects", () => {
  const offenders = [];
  let calls = 0;
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    let index = text.indexOf("fetch(");
    while (index !== -1) {
      calls++;
      // The options object of a fetch call ends at the first `});` that follows.
      const tail = text.slice(index, index + 1200);
      const end = tail.indexOf("});");
      const call = end === -1 ? tail : tail.slice(0, end);
      if (!call.includes('redirect: "error"')) offenders.push(`${file}:${text.slice(0, index).split("\n").length}`);
      index = text.indexOf("fetch(", index + 1);
    }
  }
  assert.equal(calls, 2, "the API request and the token renewal are the only fetch calls");
  assert.deepEqual(offenders, [], `These fetch calls may follow a redirect and leak credentials: ${offenders.join(", ")}`);
});

test("the only hosts this server can reach are Reddit's API and token hosts", () => {
  const hosts = new Set();
  for (const file of sourceFiles()) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const match of text.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      const host = match[1].replace(/\.$/, "");
      // Server identity links and SPDX headers are not call targets.
      if (["mcp.getmcpads.com", "www.getmcpads.com", "github.com"].includes(host)) continue;
      hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), ["ads-api.reddit.com", "www.reddit.com"], "A new outbound host appeared. That is a deliberate decision, not an accident.");
  const declared = readFileSync(new URL("../src/hosts.ts", import.meta.url), "utf8");
  assert.match(declared, /ALLOWED_HOSTS = \["ads-api\.reddit\.com", "www\.reddit\.com"\]/);
});
