import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateConfig } from "../src/config.ts";

const secret = "private-token-value";

test("invalid or incomplete configuration fails with an actionable message that never repeats a secret", () => {
  for (const value of [
    {},
    { accessToken: secret, allowedAccountIds: [] },
    { accessToken: secret, allowedAccountIds: ["../other"] },
    { refreshToken: secret, allowedAccountIds: ["a2_abc"] },
    { refreshToken: secret, clientId: "app", allowedAccountIds: ["a2_abc"] },
    { allowedAccountIds: ["a2_abc"] },
    { accessToken: secret, allowedAccountIds: ["a2_abc"], userAgent: "bad\nagent" },
  ]) {
    assert.throws(() => validateConfig(value), (error) => /REDDIT_ADS_/.test(error.message) && !error.message.includes(secret));
  }
});

test("writes stay off unless REDDIT_ADS_ENABLE_WRITES is exactly true", () => {
  const base = { REDDIT_ADS_ACCESS_TOKEN: secret, REDDIT_ADS_ACCOUNT_IDS: "a2_abc, a2_def,a2_abc" };
  const config = loadConfig(base);
  assert.equal(config.enableWrites, false);
  assert.deepEqual(config.allowedAccountIds, ["a2_abc", "a2_def"]);
  assert.equal(loadConfig({ ...base, REDDIT_ADS_ENABLE_WRITES: "false" }).enableWrites, false);
  assert.equal(loadConfig({ ...base, REDDIT_ADS_ENABLE_WRITES: "true" }).enableWrites, true);
  for (const flag of ["1", "TRUE", "yes", " true"]) assert.throws(() => loadConfig({ ...base, REDDIT_ADS_ENABLE_WRITES: flag }), /exact value true/);
});

test("refresh credentials alone are a complete configuration", () => {
  const config = loadConfig({ REDDIT_ADS_REFRESH_TOKEN: secret, REDDIT_ADS_CLIENT_ID: "app", REDDIT_ADS_CLIENT_SECRET: "app-secret", REDDIT_ADS_ACCOUNT_IDS: "a2_abc" });
  assert.equal(config.accessToken, undefined);
  assert.equal(config.refreshToken, secret);
});
