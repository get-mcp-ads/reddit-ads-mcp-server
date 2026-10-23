/**
 * Ported from the getmcpads gateway (apps/mcp/test/reddit-creatives.test.ts at
 * 3e1c2c8). Only the native asset resolution is ported; the hosted creative
 * performance and trend adapters stay in the hosted product.
 */
import { afterEach, expect, it, vi } from "vitest";
import { RedditClient } from "../../src/client.js";
import { redditAssets } from "../../src/creatives.js";
import { call, collect, makeConfig } from "./catalogue";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("resolves Max media through the scoped library and preserves whole-ad attribution", async () => {
  const api = new RedditClient(makeConfig());
  vi.spyOn(api, "entity").mockImplementation(async (_kind, id) => ({ id, type: id === "headline" ? "HEADLINE" : "VIDEO", media: { url: "https://v.redd.it/demo/DASH_720.mp4" }, poster: { url: "https://i.redd.it/demo.png" } }));
  const result = await redditAssets(api, "a2_qa", [{ id: "1", ad_account_id: "a2_qa", asset_identifiers: [{ id: "video" }, { id: "headline" }] }]);
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0]).toMatchObject({ kind: "video", video: "https://v.redd.it/demo/DASH_720.mp4", relatedAds: [{ id: "1", name: "" }] });
  expect(result.coverage.scope).toContain("not asset-level attribution");
});

it("joins only selected catalog products through the account-checked group and set", async () => {
  const api = new RedditClient(makeConfig());
  const entity = vi.spyOn(api, "entity").mockImplementation(async kind => (kind === "ad_groups" ? { product_set_id: "set" } : { catalog_id: "catalog" }));
  const list = vi.spyOn(api, "all").mockResolvedValue([{ id: "selected", title: "QA", reddit: { image_link: "https://i.redd.it/selected.png" } }, { id: "other", image_link: "https://i.redd.it/other.png" }]);
  const result = await redditAssets(api, "a2_qa", [{ id: "1", ad_account_id: "a2_qa", ad_group_id: "group", products: [{ product_id: "selected" }] }]);
  expect(entity).toHaveBeenNthCalledWith(1, "ad_groups", "group", "a2_qa");
  expect(entity).toHaveBeenNthCalledWith(2, "product_sets", "set", "a2_qa");
  expect(list).toHaveBeenCalledWith("/product_catalogs/catalog/products");
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0].thumbnail).toBe("https://i.redd.it/selected.png");
  expect(result.coverage.partial).toBe(false);
});

it("drops ads from another account and marks paged results partial", async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ data: [{ id: "foreign", ad_account_id: "a2_other" }], pagination: { next_url: "https://ads-api.reddit.com/api/v3/ad_accounts/a2_qa/ads?page_token=next" } }));
  vi.stubGlobal("fetch", f);
  const { tools } = collect(makeConfig(), false);
  const result = await call(tools, "reddit_list_ad_creatives", { limit: 50 });
  expect(result.error).toBeUndefined();
  expect(new URL(String(f.mock.calls[0][0])).searchParams.get("page_size")).toBe("20");
  expect(result.data.assets).toEqual([]);
  expect(result.data.warnings.join(" ")).toContain("outside selected account");
  expect(result.data.next_cursor).toBe("next");
  expect(result.data.coverage.partial).toBe(true);
  expect(f).toHaveBeenCalledTimes(1);
});
