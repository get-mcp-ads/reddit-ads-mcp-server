/**
 * Ported from the getmcpads gateway (apps/mcp/test/reddit.test.ts at 3e1c2c8),
 * adapted to the standalone server: no hosted registry, an explicit account
 * allowlist, and token renewal kept in memory.
 */
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { RedditClient, jobReceipt, verifyJobReceipt } from "../../src/client.js";
import { validateNative } from "../../src/validation.js";
import { ACCOUNT as account, call as callTool, collect, makeConfig } from "./catalogue";

const config = makeConfig();
const { tools } = collect(config);
const call = (name: string, args: Record<string, unknown> = {}) => callTool(tools, name, args);
afterEach(() => vi.unstubAllGlobals());

async function listedTools() {
  const server = createServer({ accessToken: "TEST_TOKEN", allowedAccountIds: [account], enableWrites: true });
  const client = new Client({ name: "unit", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const listed = (await client.listTools()).tools;
  await client.close();
  await server.close();
  return listed;
}

it("advertises exact report names including SIGN_UP and canonicalizes lowercase fields", async () => {
  const schema = (await listedTools()).find(t => t.name === "reddit_get_insights")!.inputSchema as any;
  expect(schema.properties.fields.items.enum).toContain("CONVERSION_SIGN_UP_CLICKS");
  expect(schema.properties.fields.items.enum).not.toContain("CONVERSION_SIGNUP_CLICKS");
  expect(schema.properties.breakdowns.items.enum).toContain("AD_GROUP_ID");
  const f = vi.fn().mockResolvedValue(Response.json({ data: { metrics: [{ impressions: 123, clicks: 4, spend: 1230000 }] } }));
  vi.stubGlobal("fetch", f);
  const r = await call("reddit_get_insights", { startsAt: "2026-09-27T22:00:00Z", endsAt: "2026-09-28T13:00:00Z", fields: ["impressions", "clicks", "spend", "conversion_sign_up_clicks"], breakdowns: ["ad_group_id", "ad_id"] });
  expect(r.error).toBeUndefined();
  expect(JSON.parse(f.mock.calls[0][1].body).data).toMatchObject({ fields: ["IMPRESSIONS", "CLICKS", "SPEND", "CONVERSION_SIGN_UP_CLICKS"], breakdowns: ["AD_GROUP_ID", "AD_ID"] });
  expect(r.data.rows[0].spend).toBe(1230000);
});

it("rejects guessed report names without querying Reddit", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const r = await call("reddit_get_insights", { startsAt: "2026-09-27T22:00:00Z", endsAt: "2026-09-28T13:00:00Z", fields: ["conversion_signup_clicks"] });
  expect(r.error).toBe(true);
  expect(r.data.error).toContain("CONVERSION_SIGNUP_CLICKS");
  expect(r.data.error).toContain("reddit_get_reporting_schema");
  expect(r.data.error.length).toBeLessThan(500);
  expect(f).not.toHaveBeenCalled();
});

it("previews create with PAUSED and makes no provider request", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  const r = await call("reddit_create_campaign", { data: { name: "QA test", objective: "CLICKS" } });
  expect(r.error).toBeUndefined();
  expect(r.data.preview).toBe(true);
  expect(r.data.applied).toBe(false);
  expect(r.data.data.configured_status).toBe("PAUSED");
  expect(f).not.toHaveBeenCalled();
});

it("rejects account overrides, billing, active creation, invalid budgets and unknown nested fields", async () => {
  vi.stubGlobal("fetch", vi.fn());
  for (const data of [
    { name: "QA test", objective: "CLICKS", ad_account_id: "other" },
    { name: "QA test", objective: "CLICKS", funding_instrument_id: "billing" },
    { name: "QA test", objective: "CLICKS", configured_status: "ACTIVE" },
    { name: "QA test", objective: "CLICKS", spend_cap: 0.4 },
  ]) expect((await call("reddit_create_campaign", { data })).error).toBe(true);
  expect(() => validateNative("ad_group_update", { targeting: { password: "secret" } })).toThrow();
});

it("checks parent ownership before creating a group", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ data: { id: "1", ad_account_id: "other" } }));
  vi.stubGlobal("fetch", f);
  const r = await call("reddit_create_ad_group", { data: { campaign_id: "1", name: "QA test", bid_strategy: "MANUAL_BIDDING", bid_type: "CPC" }, confirm: true });
  expect(r.error).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1].method).toBe("GET");
});

it("validates known live native payloads", () => {
  expect(() => validateNative("ad_group_create", { campaign_id: "1", name: "QA test", configured_status: "PAUSED", bid_strategy: "MANUAL_BIDDING", bid_type: "CPC", bid_value: 1000000, goal_type: "DAILY_SPEND", goal_value: 12000000, start_time: "2026-09-20T00:00:00+00:00", targeting: { geolocations: ["FR"], platforms: ["DESKTOP"], languages: ["FR"], expand_targeting: false } })).not.toThrow();
  expect(() => validateNative("custom_audience_create", { name: "QA test", type: "CUSTOMER_LIST" })).not.toThrow();
  expect(() => validateNative("post_create", { allow_comments: false, creative: { type: "IMAGE", headline: "QA", destination: { type: "URL", url: "https://www.getmcpads.com/" }, image: { media: { type: "URL", url: "https://www.getmcpads.com/opengraph-image" } } } })).not.toThrow();
});

it("marks native writes and keeps reads free of confirm", () => {
  const writes = tools.filter(t => t.write).map(t => t.name);
  for (const name of ["reddit_create_ad_group", "reddit_create_ad", "reddit_upload_creative_assets", "reddit_create_post", "reddit_create_catalog", "reddit_upsert_products", "reddit_update_saved_audience"]) expect(writes).toContain(name);
  expect(tools.filter(t => !t.write).every(t => !Object.hasOwn(t.shape, "confirm"))).toBe(true);
  expect(tools.map(t => t.name)).not.toContain("reddit_create_lead_form");
});

it("rejects foreign pagination origins", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [], pagination: { next_url: "https://evil.test/api/v3/ad_accounts/a2_qa/ads?page_token=x" } })));
  await expect(new RedditClient(config).list(`/ad_accounts/${account}/ads`)).rejects.toThrow("Unsafe");
});

it("binds job receipts to account and rejects tampering", async () => {
  const receipt = await jobReceipt(config.jobSigningKey, { account, profile: "t2_qa", job: "j1", expires: Date.now() + 10000 });
  expect((await verifyJobReceipt(config.jobSigningKey, receipt, account)).job).toBe("j1");
  await expect(verifyJobReceipt(config.jobSigningKey, receipt, "a2_other")).rejects.toThrow();
  await expect(verifyJobReceipt(config.jobSigningKey, receipt + "x", account)).rejects.toThrow();
  await expect(verifyJobReceipt("another-process-key", receipt, account)).rejects.toThrow();
});

it("renews the token in memory before the single retry", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ access_token: "new-token", expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json({ data: [] }));
  vi.stubGlobal("fetch", f);
  await new RedditClient({ ...config, refreshToken: "refresh", clientId: "app", clientSecret: "secret" }).request(`/ad_accounts/${account}/ads`);
  expect(f).toHaveBeenCalledTimes(3);
  expect(String(f.mock.calls[1][0])).toBe("https://www.reddit.com/api/v1/access_token");
  expect(f.mock.calls[2][1].headers.authorization).toBe("Bearer new-token");
});

it("rejects redirects without forwarding the bearer token", async () => {
  const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
  vi.stubGlobal("fetch", f);
  await expect(new RedditClient(config).request("/ad_accounts/a2_qa")).rejects.toThrow("redirect");
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1].redirect).toBe("error");
});

it("resolves creative ownership through authorized profile libraries", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ id: "t2_ours" }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ result: { id: "asset1", type: "IMAGE", status: "ACTIVE" } }] }));
  vi.stubGlobal("fetch", f);
  expect(await new RedditClient(config).entity("creative_assets", "asset1", account)).toMatchObject({ id: "asset1", profile_id: "t2_ours" });
  expect(String(f.mock.calls[1][0])).toContain("/profiles/t2_ours/creative_assets");
  f.mockImplementation(async () => Response.json({ data: [] }));
  await expect(new RedditClient(config).entity("creative_assets", "foreign", account)).rejects.toThrow("authorized account");
});

it("reports the matching VIDEO schema error instead of a misleading IMAGE discriminator", () => {
  expect(() => validateNative("asset_upload", [{ type: "VIDEO", name: "Test", media: { type: "URL", url: "https://www.getmcpads.com/film.mp4" } }])).toThrow("poster");
});

it("refuses another returned identity even in the same account", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { id: "2", ad_account_id: account } })));
  await expect(new RedditClient(config).entity("ads", "1", account)).rejects.toThrow("identity mismatch");
});

it("uses the documented id query when polling uploads", async () => {
  const f = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ id: "t2_ours" }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "upload1", status: "ACTIVE", result: { id: "asset1", type: "IMAGE" } }] }));
  vi.stubGlobal("fetch", f);
  const result = await call("reddit_get_asset_uploads", { profileId: "t2_ours", uploadIds: ["upload1"] });
  expect(result.error).toBeUndefined();
  expect(new URL(String(f.mock.calls[1][0])).searchParams.get("id")).toBe("upload1");
  expect(result.data.data[0].result.id).toBe("asset1");
});

it("checks retargeting pixel ownership before any audience creation", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "our-pixel" }] }));
  vi.stubGlobal("fetch", f);
  expect((await call("reddit_create_custom_audience", { data: { name: "QA audience", type: "PIXEL_RETARGETING", pixel_audience_config: { pixel_ids: ["foreign"], targetings: ["PAGE_VISIT"], lookback_window_days: 30 } }, confirm: true })).error).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][1].method).toBe("GET");
});

it("rejects impossible calendar dates before reporting", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect((await call("reddit_get_insights", { startsAt: "2026-02-30T00:00:00Z", endsAt: "2026-03-04T00:00:00Z", fields: ["SPEND"] })).error).toBe(true);
  expect(f).not.toHaveBeenCalled();
});
