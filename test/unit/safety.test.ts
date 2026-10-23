/**
 * Standalone safety contract: account allowlist, preview versus confirm,
 * no automatic write retry, provider error mapping, pagination, redaction,
 * bounded responses and the fixed host list. Every response is synthetic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { RedditClient, MAX_API_BYTES } from "../../src/client.js";
import { ALLOWED_HOSTS } from "../../src/hosts.js";
import { ACCOUNT, call, collect, makeConfig } from "./catalogue";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const json = (value: unknown, init?: ResponseInit) => Response.json(value, init);

describe("account allowlist", () => {
  it("refuses an account outside REDDIT_ADS_ACCOUNT_IDS before any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    for (const name of ["reddit_health_check", "reddit_get_campaigns", "reddit_get_insights", "reddit_create_campaign", "reddit_rename_ad_account"]) {
      const args: Record<string, unknown> = { adAccountId: "a2_other", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z", fields: ["SPEND"], data: { name: "QA test", objective: "CLICKS" }, name: "QA name" };
      const shape = tools.find(t => t.name === name)!.shape;
      const r = await call(tools, name, Object.fromEntries(Object.entries(args).filter(([key]) => Object.hasOwn(shape, key))));
      expect(r.error, name).toBe(true);
      expect(r.data.error, name).toContain("REDDIT_ADS_ACCOUNT_IDS");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("enforces the allowlist in the client too, for any account-scoped path", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(new RedditClient(makeConfig()).request("/ad_accounts/a2_other/campaigns")).rejects.toThrow("REDDIT_ADS_ACCOUNT_IDS");
    expect(f).not.toHaveBeenCalled();
  });
});

describe("requests", () => {
  it("only reach the official hosts, never follow redirects and always carry a timeout", async () => {
    const f = vi.fn(async (url: string | URL) => String(url).includes("access_token") ? json({ access_token: "fresh", expires_in: 3600 }) : json({ data: { id: ACCOUNT } }));
    vi.stubGlobal("fetch", f);
    const api = new RedditClient(makeConfig({ accessToken: undefined, refreshToken: "refresh", clientId: "app", clientSecret: "app-secret" }));
    await api.account(ACCOUNT);
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url, init] of f.mock.calls as unknown as [string | URL, RequestInit][]) {
      expect(ALLOWED_HOSTS).toContain(new URL(String(url)).hostname);
      expect(new URL(String(url)).protocol).toBe("https:");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect((init.headers as Record<string, string>)["user-agent"]).toBe("node:reddit-ads-test:v0");
    }
    const [tokenUrl, tokenInit] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://www.reddit.com/api/v1/access_token");
    expect((tokenInit.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("app:app-secret")}`);
    const [, apiInit] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect((apiInit.headers as Record<string, string>).authorization).toBe("Bearer fresh");
    expect(JSON.stringify(apiInit)).not.toContain("refresh");
  });

  it("refuses invalid paths and identifiers before any request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const api = new RedditClient(makeConfig());
    for (const path of ["//evil.test/x", "/../oauth", "https://evil.test/", "/a\\b"]) await expect(api.request(path)).rejects.toThrow();
    await expect(api.entity("ads", "../1", ACCOUNT)).rejects.toThrow("Invalid Reddit identifier");
    expect(f).not.toHaveBeenCalled();
  });

  it("bounds the response size, declared or streamed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-length": String(MAX_API_BYTES + 1) } })));
    await expect(new RedditClient(makeConfig()).request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("exceeds");
    const chunk = new Uint8Array(1_000_000).fill(32);
    const stream = new ReadableStream({ start(controller) { for (let i = 0; i < 9; i++) controller.enqueue(chunk); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)));
    await expect(new RedditClient(makeConfig()).request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("exceeds");
  });
});

describe("writes", () => {
  it("preview sends nothing, flags activation and confirm sends exactly one PATCH after the ownership read", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ data: { id: "c1", ad_account_id: ACCOUNT } })).mockResolvedValueOnce(json({ data: { id: "c1", configured_status: "ACTIVE" } }));
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    const preview = await call(tools, "reddit_update_campaign", { id: "c1", data: { configured_status: "ACTIVE" } });
    expect(preview.data).toMatchObject({ preview: true, applied: false, method: "PATCH", path: "/campaigns/c1", activationMaySpend: true, providerValidation: false });
    expect(f).not.toHaveBeenCalled();
    const applied = await call(tools, "reddit_update_campaign", { id: "c1", data: { configured_status: "ACTIVE" }, confirm: true });
    expect(applied.error).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][1].method).toBe("GET");
    expect(f.mock.calls[1][1].method).toBe("PATCH");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ data: { configured_status: "ACTIVE" } });
  });

  it("refuses deletion and archiving through status fields", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    expect((await call(tools, "reddit_update_ad", { id: "1", data: { configured_status: "DELETED" } })).error).toBe(true);
    expect((await call(tools, "reddit_update_ad_group", { id: "1", data: { configured_status: "ARCHIVED" } })).error).toBe(true);
    expect((await call(tools, "reddit_update_saved_audience", { id: "1", data: { status: "DELETED" } })).error).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("renames send the name only, after a preview", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ data: { id: "g1", ad_account_id: ACCOUNT } })).mockResolvedValueOnce(json({ data: { id: "g1", name: "New name" } }));
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    expect((await call(tools, "reddit_rename_ad_group", { adGroupId: "g1", name: "New name" })).data).toMatchObject({ applied: false, action: "reddit_rename_ad_group", change: { target: "g1", newName: "New name" } });
    expect(f).not.toHaveBeenCalled();
    await call(tools, "reddit_rename_ad_group", { adGroupId: "g1", name: "New name", confirm: true });
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ data: { name: "New name" } });
  });

  it("never retries a write whose outcome is uncertain", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({ data: { id: "a1", ad_account_id: ACCOUNT } })).mockRejectedValueOnce(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    const r = await call(tools, "reddit_rename_ad", { adId: "a1", name: "Renamed ad", confirm: true });
    expect(r.error).toBe(true);
    expect(r.data.error).toContain("may or may not have been applied");
    expect(f).toHaveBeenCalledTimes(2);
    const g = vi.fn().mockResolvedValueOnce(json({ data: { id: "a1", ad_account_id: ACCOUNT } })).mockResolvedValueOnce(json({ error: { message: "internal" } }, { status: 503 }));
    vi.stubGlobal("fetch", g);
    const s = await call(tools, "reddit_rename_ad", { adId: "a1", name: "Renamed ad", confirm: true });
    expect(s.data.error).toContain("may or may not have been applied");
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("returns a job receipt that only this account can poll", async () => {
    const profiles = () => json({ data: [{ id: "t2_ours" }] });
    const f = vi.fn()
      .mockResolvedValueOnce(profiles())
      .mockResolvedValueOnce(json({ data: { id: "job1", status: "PENDING" } }))
      .mockResolvedValueOnce(profiles())
      .mockResolvedValueOnce(json({ data: { id: "job1", status: "PENDING" } }));
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    const post = { allow_comments: false, creative: { type: "IMAGE", headline: "QA", destination: { type: "URL", url: "https://www.getmcpads.com/" }, image: { media: { type: "URL", url: "https://www.getmcpads.com/opengraph-image" } } } };
    const created = await call(tools, "reddit_create_post", { parentId: "t2_ours", data: post, confirm: true });
    expect(created.error).toBeUndefined();
    expect(typeof created.data.receipt).toBe("string");
    const polled = await call(tools, "reddit_get_post_job", { receipt: created.data.receipt });
    expect(polled.data).toMatchObject({ id: "job1" });
    expect(String(f.mock.calls[3][0])).toContain("/structured_posts/jobs/job1");
    const { tools: otherProcess } = collect(makeConfig({ jobSigningKey: "another-process" }));
    expect((await call(otherProcess, "reddit_get_post_job", { receipt: created.data.receipt })).error).toBe(true);
  });
});

describe("provider errors", () => {
  it("map native error fields, rate limits and 403 hints", async () => {
    const api = new RedditClient(makeConfig());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: { message: "Invalid input", fields: [{ field: "name", message: "too short" }] } }, { status: 400 })));
    await expect(api.request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("Reddit API 400: Invalid input name: too short");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "30" } })));
    await expect(api.request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("Retry-After=30");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ error: { message: "forbidden" } }, { status: 403 })));
    await expect(api.request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("adsread");
  });

  it("treat an error body inside HTTP 200 as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "account suspended" } })));
    const { tools } = collect();
    const r = await call(tools, "reddit_health_check");
    expect(r.error).toBe(true);
    expect(r.data.error).toContain("account suspended");
    expect(r.data.error).toContain("successful HTTP response");
  });

  it("explain a 401 when no refresh credentials are configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ message: "Unauthorized" }, { status: 401 })));
    await expect(new RedditClient(makeConfig()).request(`/ad_accounts/${ACCOUNT}`)).rejects.toThrow("REDDIT_ADS_ACCESS_TOKEN");
  });

  it("redact every credential from errors and results", async () => {
    const config = makeConfig({ refreshToken: "REFRESH_SECRET", clientId: "app", clientSecret: "CLIENT_SECRET" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: { message: "bad TEST_TOKEN REFRESH_SECRET CLIENT_SECRET test-signing-key" } }, { status: 400 })));
    const { tools } = collect(config);
    const r = await call(tools, "reddit_health_check");
    for (const secret of ["TEST_TOKEN", "REFRESH_SECRET", "CLIENT_SECRET", "test-signing-key"]) expect(r.text).not.toContain(secret);
    expect(r.text).toContain("[redacted]");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { id: ACCOUNT, name: "echo TEST_TOKEN" } })));
    expect((await call(tools, "reddit_health_check")).text).not.toContain("TEST_TOKEN");
  });

  it("report a failed token renewal without its secrets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "invalid_grant" }, { status: 400 })));
    const api = new RedditClient(makeConfig({ accessToken: undefined, refreshToken: "REFRESH_SECRET", clientId: "app", clientSecret: "CLIENT_SECRET" }));
    const error = await api.request(`/ad_accounts/${ACCOUNT}`).catch(e => e as Error);
    expect(error.message).toContain("invalid_grant");
    expect(error.message).not.toContain("REFRESH_SECRET");
    expect(error.message).not.toContain("CLIENT_SECRET");
  });
});

describe("pagination", () => {
  it("returns Reddit's page token as the opaque cursor and sends it back", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ id: "c1" }], pagination: { next_url: "https://ads-api.reddit.com/api/v3/ad_accounts/a2_qa/campaigns?page_size=2&page_token=tok2" } }))
      .mockResolvedValueOnce(json({ data: [{ id: "c2" }], pagination: {} }));
    vi.stubGlobal("fetch", f);
    const { tools } = collect();
    const first = await call(tools, "reddit_get_campaigns", { limit: 2 });
    expect(first.data).toMatchObject({ next_cursor: "tok2", truncated: true });
    const second = await call(tools, "reddit_get_campaigns", { limit: 2, cursor: "tok2" });
    expect(second.data).toMatchObject({ next_cursor: null, truncated: false });
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get("page_token")).toBe("tok2");
  });

  it("refuses a repeated cursor during ownership lookups", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: [], pagination: { next_url: "https://ads-api.reddit.com/api/v3/ad_accounts/a2_qa/profiles?page_token=loop" } })));
    await expect(new RedditClient(makeConfig()).all(`/ad_accounts/${ACCOUNT}/profiles`)).rejects.toThrow("incomplete");
  });

  it("keeps report pagination on the same report path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ data: { metrics: [] }, pagination: { next_url: "https://ads-api.reddit.com/api/v3/ad_accounts/a2_other/reports?page_token=x" } })));
    const { tools } = collect();
    const r = await call(tools, "reddit_get_insights", { startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z", fields: ["SPEND"] });
    expect(r.error).toBe(true);
    expect(r.data.error).toContain("Unsafe report pagination");
  });
});
