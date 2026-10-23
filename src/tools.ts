/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Native Reddit Ads tools, ported from the getmcpads gateway with the same
 * names, schemas and ownership checks. Reads are always registered; writes
 * only when REDDIT_ADS_ENABLE_WRITES is true, and each one previews until
 * confirm is true.
 */
import { z } from "zod";
import { RedditClient, RedditError, row, nativeId, jobReceipt, verifyJobReceipt, type Row } from "./client.js";
import { REDDIT_SCHEMA, WRITE_OPERATIONS, validateNative } from "./validation.js";
import { redditAssets } from "./creatives.js";
import { RENAMING, renamePreview } from "./rename.js";
import { NATIVE_ID } from "./config.js";
import { REDDIT_API_ORIGIN } from "./hosts.js";
import type { ToolShape } from "./tool-quality.js";

export type Collector = { tool(name: string, description: string, shape: ToolShape, handler: (args: Row) => Promise<unknown>): void };

const idOf = (description: string) => z.string().regex(NATIVE_ID).refine(s => !s.includes(".."), "Invalid Reddit identifier.").describe(description);
const adAccountId = idOf("Reddit ad account ID (a2_...) listed in REDDIT_ADS_ACCOUNT_IDS, not the business ID.");
const account = { adAccountId };
const limit = z.number().int().min(1).max(100).default(50).describe("Items per page, 1 to 100. Defaults to 50.");
const cursor = z.string().max(3000).optional().describe("Opaque next_cursor returned by the previous page. Omit it for the first page.");
const page = { limit, cursor };
const confirm = z.boolean().default(false).describe("False previews locally and sends nothing to Reddit. True applies only this exact change, after the user approved it.");
const native = z.record(z.unknown()).describe("Native Reddit fields. Read reddit_get_write_schema first. Budgets and bids are microcurrency; a partial nested object replaces that whole object.");

// Advertise native names to clients, while accepting their lowercase spelling.
// Unknown names must still fail locally rather than silently dropping metrics.
const reportingName = (names: string[]) => z.preprocess(value => (typeof value === "string" ? value.toUpperCase() : value), z.enum(names as [string, ...string[]]));
const reportingFields = z.array(reportingName(REDDIT_SCHEMA.metrics)).min(1).max(100)
  .describe("Native Reddit field names, e.g. IMPRESSIONS, CLICKS, SPEND, CONVERSION_SIGN_UP_CLICKS, CONVERSION_SIGN_UP_VIEWS. Use reddit_get_reporting_schema for supported fields; never guess names. Lowercase spellings are accepted.");
const reportingBreakdowns = z.array(reportingName(REDDIT_SCHEMA.breakdowns)).max(3).default([])
  .describe("Native breakdowns, e.g. CAMPAIGN_ID, AD_GROUP_ID or AD_ID. At most three. Lowercase spellings are accepted. API compatibility constraints still apply.");
const utcHour = (description: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/).describe(description);

export const GUIDE = {
  state: "live",
  documentation: REDDIT_SCHEMA.source,
  schemaCheckedAt: REDDIT_SCHEMA.checkedAt,
  discovery: "tools/list returns every tool this server exposes. Write tools are listed only when REDDIT_ADS_ENABLE_WRITES is true. The resources reddit-ads://guide and reddit-ads://reporting-catalog hold this guide and the full metric and dimension catalog.",
  accounts: "Only the ad accounts listed in REDDIT_ADS_ACCOUNT_IDS are reachable. adAccountId is checked before any request, and every entity read is checked against it, directly or through its profile, business or catalog.",
  writes: "All writes preview unless confirm:true. Campaigns/ad groups/ads are created PAUSED. Updates can pause/reactivate with explicit confirmation; activation can spend budget, so never activate in a no-spend test. No billing or deletion tools. Nested object updates replace that object: read current targeting first. A write whose outcome is uncertain is never retried automatically: read the account first.",
  scope: "Campaigns, ad groups, ads, configured targeting, creative asset import, structured image/video/carousel/text posts, lead form configuration reads, saved/custom audience configuration, catalogs/products/product sets and reporting. Provider permissions, asset requirements and account eligibility still apply.",
  units: "SPEND, budgets and bids are microcurrency: one millionth of the account currency. Other reporting fields keep their native Reddit units.",
  prerequisites: {
    apps: "Own app/store ID and attribution setup",
    catalogs: "Own product catalog, products and event sources",
    max: "AUTOMATED campaign/group and DYNAMIC_CREATIVE_AD_TEMPLATE ad; at least 3 headlines and 2 media, plus objective requirements",
    conversions: "Accessible pixel and eligible events",
    audiences: "Empty list creation does not establish matching, lookalike or targetability; real consented seed/activity required",
  },
  renaming: RENAMING,
  rateLimits: "Reddit applies endpoint-specific quotas to the Ads API and answers HTTP 429 with Retry-After. Errors report Retry-After; this server never retries automatically.",
  limitations: "No genuine sandbox identified. Customer-list member uploads, event injection, lead/person downloads, product feeds, billing and destructive deletes are intentionally not exposed. Onsite lead-form creation is not exposed: Reddit ended it on 2026-09-21 and paused ads using onsite forms on 2026-09-30, so use website forms with Pixel/CAPI for lead campaigns; existing forms remain readable. Reddit began an objective migration on 2026-09-21: read reddit_get_write_schema and the current campaign before creating or editing. APIs and objectives may evolve.",
};

export const redditOutput = (api: RedditClient, data: unknown, isError = false) => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text" as const, text: api.redact(JSON.stringify(data, null, 2)) }],
});

function errorMessage(name: string, error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.slice(0, 8).map(issue => {
      const where = issue.path.join(".") || "arguments";
      if (name === "reddit_get_insights" && issue.code === "invalid_enum_value") {
        return `${where}: Unknown value ${JSON.stringify(issue.received)}. Read reddit_get_reporting_schema for supported metric and breakdown names.`;
      }
      return `${where}: ${issue.message}`;
    }).join("; ");
  }
  return error instanceof Error ? error.message : "Reddit request failed";
}

function register(collector: Collector, api: RedditClient, name: string, description: string, shape: ToolShape, fn: (args: Row) => Promise<unknown>) {
  const schema = z.object(shape).strict();
  collector.tool(name, description, shape, async raw => {
    try {
      const args = schema.parse(raw ?? {});
      if (Object.hasOwn(shape, "adAccountId")) api.assertAccount(String(args.adAccountId));
      return redditOutput(api, await fn(args));
    } catch (error) {
      return redditOutput(api, { error: errorMessage(name, error), noAutomaticRetry: "Reconcile uncertain writes before retrying. A successful preview is not provider validation." }, true);
    }
  });
}

const readKinds = {
  campaigns: "campaign",
  ad_groups: "ad_group",
  ads: "ad",
  saved_audiences: "saved_audience",
  custom_audiences: "custom_audience",
  lead_gen_forms: "lead_form",
} as const;

export function registerRedditReads(collector: Collector, api: RedditClient): void {
  const add = (name: string, description: string, shape: ToolShape, fn: (args: Row) => Promise<unknown>) => register(collector, api, `reddit_${name}`, description, shape, fn);

  add("get_setup_guide", "Reddit connector coverage, prerequisites, units, renaming and known limits. Read it before planning writes or answering what this server cannot do.", {}, async () => GUIDE);

  add("get_write_schema", "Exact pinned native schemas for Reddit creation and edits, including targeting and all implemented campaign/ad formats. Provider acceptance is separate from local schema validation.", {
    operation: z.enum(WRITE_OPERATIONS).describe("Native write operation whose pinned schema to return, such as campaign_create or ad_group_update."),
  }, async args => ({
    ...REDDIT_SCHEMA.operations[String(args.operation)],
    source: REDDIT_SCHEMA.source,
    checkedAt: REDDIT_SCHEMA.checkedAt,
    blockedFields: ["funding_instrument_id", "effective_status"],
    createStatus: "PAUSED",
    nestedEdits: "Read first; nested objects are replaced.",
  }));

  add("get_reporting_schema", "Reddit metric and dimension inventory; configured targeting is read with reddit_get_targeting, not inferred from reporting.", {}, async () => ({
    metrics: REDDIT_SCHEMA.metrics,
    breakdowns: REDDIT_SCHEMA.breakdowns,
    source: REDDIT_SCHEMA.source,
    notes: "SPEND is microcurrency; do not assume other monetary fields use the same scale. Metric/breakdown combinations remain subject to API compatibility and privacy thresholds. reddit-ads://reporting-catalog adds categories and unit notes.",
  }));

  add("health_check", "Read the allowed Reddit ad account, its business, currency and timezone. API access is not proof of delivery or full objective eligibility.", account, async args => ({
    account: await api.account(String(args.adAccountId)),
    mode: "real account unless provider explicitly marks it test",
    guide: GUIDE,
  }));

  for (const [plural, singular] of Object.entries(readKinds)) {
    const label = plural.replaceAll("_", " ");
    const one = singular.replace("_", " ");
    const leadNote = plural === "lead_gen_forms" ? " Form configuration only; lead submissions are never returned." : "";
    add(`get_${plural}`, `Read Reddit ${label}, including native configuration and configured/effective status.${leadNote} Pagination returns an opaque cursor; every further page needs an explicit call.`, { ...account, ...page }, async args =>
      api.list(`/ad_accounts/${args.adAccountId}/${plural}`, Number(args.limit), args.cursor as string | undefined));
    add(`get_${singular}`, `Read one Reddit ${one} and verify that it belongs to the ad account.${leadNote}`, { ...account, id: idOf(`ID of the Reddit ${one} to read. It must belong to adAccountId.`) }, async args =>
      api.entity(plural, String(args.id), String(args.adAccountId)));
  }

  add("get_targeting", "Read actual ad-group targeting: inclusions, exclusions, geo, age/gender, languages, interests, communities, keywords, devices and audience IDs. This is configuration, not delivery demographics.", {
    ...account,
    adGroupId: idOf("Ad group ID whose targeting to read. It must belong to adAccountId."),
  }, async args => {
    const group = await api.entity("ad_groups", String(args.adGroupId), String(args.adAccountId));
    return { ad_group_id: group.id, targeting: group.targeting, saved_audience_id: group.saved_audience_id, configured_status: group.configured_status };
  });

  add("get_targeting_options", "Discover valid native targeting values. Communities can be searched; large lists are paginated or explicitly marked partial.", {
    ...account,
    kind: z.enum(["geolocations", "languages", "interests", "devices", "carriers", "communities"]).describe("Targeting dimension whose valid values to list."),
    query: z.string().max(100).optional().describe("Search text for communities. Ignored for the other kinds."),
    country: z.string().regex(/^[A-Z]{2}$/).optional().describe("Two-letter uppercase country code, such as US, for kinds that accept a country."),
    ...page,
  }, async args => {
    if (args.kind === "communities") return api.list(`/targeting/communities/search?query=${encodeURIComponent(String(args.query ?? ""))}`, Number(args.limit), args.cursor as string | undefined);
    return api.request(`/targeting/${args.kind}${args.country ? `?country=${args.country}` : ""}`);
  });

  for (const kind of ["profiles", "pixels"] as const) {
    add(`get_${kind}`, `List ${kind} accessible to the allowed Reddit ad account.`, { ...account, ...page }, async args =>
      api.list(`/ad_accounts/${args.adAccountId}/${kind}`, Number(args.limit), args.cursor as string | undefined));
  }

  add("get_insights", "Native Reddit reporting with metrics and entity/audience breakdowns, explicit UTC dates and pagination. Empty results validate transport only. Reported audience demographics differ from configured targeting.", {
    ...account,
    startsAt: utcHour("Report start in UTC on the hour, such as 2026-10-01T00:00:00Z."),
    endsAt: utcHour("Report end in UTC on the hour, after startsAt. Hourly breakdowns cover at most seven days."),
    fields: reportingFields,
    breakdowns: reportingBreakdowns,
    filter: z.string().max(1000).optional().describe("Optional native Reddit report filter expression, passed unchanged."),
    ...page,
  }, async args => {
    const start = Date.parse(String(args.startsAt));
    const end = Date.parse(String(args.endsAt));
    const exact = (time: number, text: unknown) => new Date(time).toISOString().replace(".000Z", "Z") === text;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || !exact(start, args.startsAt) || !exact(end, args.endsAt)) throw new Error("Use a valid ascending UTC date range.");
    const fields = args.fields as string[];
    const breakdowns = args.breakdowns as string[];
    if (fields.some(f => !REDDIT_SCHEMA.metrics.includes(f)) || breakdowns.some(f => !REDDIT_SCHEMA.breakdowns.includes(f))) throw new Error("Unknown metric or breakdown; read reddit_get_reporting_schema.");
    if (breakdowns.includes("HOUR") && end - start > 7 * 86_400_000) throw new Error("Hourly reports are limited to 7 days.");
    const query = new URLSearchParams({ page_size: String(args.limit), ...(args.cursor ? { page_token: String(args.cursor) } : {}) });
    const report = await api.request(`/ad_accounts/${args.adAccountId}/reports?${query}`, "POST", {
      starts_at: args.startsAt, ends_at: args.endsAt, fields, breakdowns, ...(args.filter ? { filter: args.filter } : {}),
    });
    const metrics = row(report.data).metrics;
    if (!Array.isArray(metrics)) throw new Error("Invalid Reddit report response.");
    const next = row(report.pagination).next_url;
    let nextCursor: string | null = null;
    if (next) {
      const u = new URL(String(next));
      if (u.origin !== REDDIT_API_ORIGIN || u.pathname !== `/api/v3/ad_accounts/${args.adAccountId}/reports` || u.username || u.password || u.hash) throw new Error("Unsafe report pagination.");
      nextCursor = u.searchParams.get("page_token");
      if (!nextCursor) throw new Error("Missing report cursor.");
    }
    return {
      rows: metrics,
      next_cursor: nextCursor,
      truncated: Boolean(next),
      units: "SPEND is microcurrency. Other fields retain native Reddit units; consult their schema before conversion.",
      range: { starts_at: args.startsAt, ends_at: args.endsAt },
      metrics_updated_at: row(report.data).metrics_updated_at,
    };
  });

  const profileId = idOf("Reddit profile ID (t2_...) attached to adAccountId. List them with reddit_get_profiles.");
  add("get_creative_assets", "List the asset library of a profile attached to the ad account; unused files are not necessarily ads.", { ...account, profileId, ...page }, async args => {
    await api.profile(String(args.profileId), String(args.adAccountId));
    return api.list(`/profiles/${args.profileId}/creative_assets`, Number(args.limit), args.cursor as string | undefined);
  });
  add("get_posts", "List advertising structured posts for a profile attached to this account. Returns native image/video/carousel/text configuration.", { ...account, profileId, ...page }, async args => {
    await api.profile(String(args.profileId), String(args.adAccountId));
    return api.list(`/profiles/${args.profileId}/structured_posts`, Number(args.limit), args.cursor as string | undefined);
  });
  add("get_post", "Read an ad structured post after profile ownership verification.", { ...account, id: idOf("Structured post ID to read. Its profile must be attached to adAccountId.") }, async args =>
    api.entity("structured_posts", String(args.id), String(args.adAccountId)));
  add("get_asset_uploads", "Poll processing of creative imports through the profile; ACTIVE is media-ready, not advertising delivery.", {
    ...account,
    profileId,
    uploadIds: z.array(idOf("Upload ID returned by reddit_upload_creative_assets.")).min(1).max(50).describe("Upload IDs returned by reddit_upload_creative_assets, 1 to 50."),
  }, async args => {
    await api.profile(String(args.profileId), String(args.adAccountId));
    return api.request(`/profiles/${args.profileId}/creative_assets/uploads?id=${encodeURIComponent((args.uploadIds as string[]).join(","))}`);
  });
  add("get_post_job", "Poll a previously created structured post using its signed job receipt. Does not accept arbitrary job IDs from another account.", {
    ...account,
    receipt: z.string().max(3000).describe("Receipt returned by a confirmed reddit_create_post in this server process. Valid for seven days."),
  }, async args => {
    const scope = await verifyJobReceipt(api.config.jobSigningKey, String(args.receipt), String(args.adAccountId));
    await api.profile(String(scope.profile), String(args.adAccountId));
    const job = row((await api.request(`/structured_posts/jobs/${nativeId(scope.job)}`)).data);
    if (job.post_id) await api.entity("structured_posts", String(job.post_id), String(args.adAccountId));
    return job;
  });

  add("list_ad_creatives", "Resolve ad-linked image/video/carousel assets with explicit coverage. A video cover does not establish its motion/audio; use full media when available. Media URLs are returned, never downloaded.", {
    ...account,
    adIds: z.array(idOf("Ad ID that belongs to adAccountId.")).min(1).max(20).optional().describe("Specific ad IDs to resolve, 1 to 20. When omitted, the account's ads are read page by page."),
    limit: limit.describe("Ads to read when adIds is omitted. At most 20 are resolved per call; larger values are capped at 20."),
    cursor,
  }, async args => {
    const listed = args.adIds ? null : await api.list(`/ad_accounts/${args.adAccountId}/ads`, Math.min(Number(args.limit), 20), args.cursor as string | undefined);
    const ads = args.adIds ? await Promise.all((args.adIds as string[]).map(x => api.entity("ads", x, String(args.adAccountId)))) : listed!.data;
    const result = await redditAssets(api, String(args.adAccountId), ads);
    if (listed?.truncated) result.warnings.push("More ads available; continue with next_cursor. This list is not the complete account.");
    return { ...result, next_cursor: listed?.next_cursor ?? null, coverage: { ...result.coverage, partial: result.coverage.partial || Boolean(listed?.truncated) } };
  });

  add("get_catalogs", "Read product catalogs of the business owning the ad account.", { ...account, ...page }, async args => {
    const owner = await api.account(String(args.adAccountId));
    return api.list(`/businesses/${nativeId(owner.business_id)}/product_catalogs`, Number(args.limit), args.cursor as string | undefined);
  });
  for (const child of ["products", "product_sets", "catalog_imports"] as const) {
    add(`get_${child}`, `Read ${child.replace("_", " ")} from a catalog owned by the ad account's business.`, {
      ...account,
      catalogId: idOf("Product catalog ID. List them with reddit_get_catalogs."),
      ...page,
    }, async args => {
      await api.entity("product_catalogs", String(args.catalogId), String(args.adAccountId));
      return api.list(`/product_catalogs/${args.catalogId}/${child}`, Number(args.limit), args.cursor as string | undefined);
    });
  }
}

/** Verifies every ID a write payload references against the ad account before it is sent. */
async function references(api: RedditClient, value: unknown, accountId: string): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) await references(api, item, accountId);
    return;
  }
  if (!value || typeof value !== "object") return;
  const kinds: Record<string, string> = { campaign_id: "campaigns", ad_group_id: "ad_groups", post_id: "structured_posts", saved_audience_id: "saved_audiences", product_set_id: "product_sets", lead_gen_form_id: "lead_gen_forms" };
  for (const [key, v] of Object.entries(row(value))) {
    if (kinds[key] && v) await api.entity(kinds[key], String(v), accountId);
    if (key === "profile_id" && v) await api.profile(String(v), accountId);
    if (["custom_audience_ids", "excluded_custom_audience_ids"].includes(key) && Array.isArray(v)) for (const audience of v) await api.entity("custom_audiences", String(audience), accountId);
    if (key === "campaign_ids" && Array.isArray(v)) for (const campaign of v) await api.entity("campaigns", String(campaign), accountId);
    if (key === "pixel_ids" && Array.isArray(v)) {
      const pixels = await api.all(`/ad_accounts/${accountId}/pixels`);
      if (v.some(pixel => !pixels.some(p => p.id === pixel))) throw new RedditError("Pixel is not available to this Reddit account.");
    }
    if (["conversion_pixel_id", "pixel_id"].includes(key) && v && !(await api.all(`/ad_accounts/${accountId}/pixels`)).some(p => p.id === v)) throw new RedditError("Pixel is not available to this Reddit account.");
    if ((key === "asset_identifiers" || key === "thumbnail_asset_identifiers") && Array.isArray(v)) {
      for (const asset of v) {
        const assetId = typeof asset === "string" ? asset : row(asset).id;
        if (assetId) await api.entity("creative_assets", String(assetId), accountId);
      }
    }
    await references(api, v, accountId);
  }
}

const PREVIEW_MESSAGE = "Preview only; nothing was sent to Reddit. Show the user this exact change and repeat the call with confirm: true once they approve it.";

export function registerRedditWrites(collector: Collector, api: RedditClient): void {
  const add = (name: string, description: string, shape: ToolShape, fn: (args: Row) => Promise<unknown>) => register(collector, api, `reddit_${name}`, description, shape, fn);

  const objects = [
    ["campaign", "campaigns"],
    ["ad_group", "ad_groups"],
    ["ad", "ads"],
    ["saved_audience", "saved_audiences"],
    ["custom_audience", "custom_audiences"],
  ] as const;
  for (const [kind, plural] of objects) {
    for (const action of ["create", "update"] as const) {
      const operation = `${kind}_${action}`;
      if (!WRITE_OPERATIONS.includes(operation)) continue;
      const delivery = ["campaign", "ad_group", "ad"].includes(kind);
      const label = kind.replace("_", " ");
      const statusRule = !delivery ? "" : action === "create" ? " Campaigns, ad groups and ads are always created PAUSED." : " configured_status accepts PAUSED or ACTIVE only; ACTIVE can spend budget.";
      add(`${action}_${kind}`, `${action === "create" ? "Create" : "Update"} a Reddit ${label} with native fields, including supported objectives and formats. Previews by default.${statusRule} Read reddit_get_write_schema(operation=${operation}) and the current configuration before edits.`, {
        ...account,
        ...(action === "update" ? { id: idOf(`ID of the Reddit ${label} to update. It must belong to adAccountId.`) } : {}),
        data: native,
        confirm,
      }, async args => {
        const payload = { ...row(args.data) };
        if (delivery) {
          if (action === "create") {
            if (payload.configured_status && payload.configured_status !== "PAUSED") throw new Error("Create Reddit advertising objects PAUSED only.");
            payload.configured_status = "PAUSED";
          } else if (payload.configured_status && !["PAUSED", "ACTIVE"].includes(String(payload.configured_status))) {
            throw new Error("Only PAUSED/ACTIVE status updates are exposed; no deletion or archiving.");
          }
        }
        if (kind === "saved_audience" && payload.status === "DELETED") throw new Error("Deleting a saved audience is not exposed.");
        const data = validateNative(operation, payload);
        const path = action === "create" ? `/ad_accounts/${args.adAccountId}/${plural}` : `/${plural}/${args.id}`;
        const method = action === "create" ? "POST" : "PATCH";
        if (!args.confirm) {
          return { preview: true, applied: false, method, path, data, activationMaySpend: payload.configured_status === "ACTIVE", ownership: "Checked only when confirmed; this preview made no provider request", providerValidation: false, message: PREVIEW_MESSAGE };
        }
        if (action === "update") await api.entity(plural, String(args.id), String(args.adAccountId));
        await references(api, data, String(args.adAccountId));
        return api.request(path, method, data);
      });
    }
  }

  const parents = [
    ["upload_creative_assets", "asset_upload", "profile", "creative_assets/uploads"],
    ["create_post", "post_create", "profile", "structured_posts/jobs"],
    ["create_catalog", "catalog_create", "business", "product_catalogs"],
    ["create_product_set", "product_set_create", "catalog", "product_sets"],
    ["upsert_products", "products_upsert", "catalog", "products/batch_upsert"],
  ] as const;
  const parentDescriptions = {
    profile: "Reddit profile ID (t2_...) attached to adAccountId. List them with reddit_get_profiles.",
    business: "Reddit business ID that owns adAccountId; reddit_health_check returns it as business_id.",
    catalog: "Product catalog ID owned by the business of adAccountId. List them with reddit_get_catalogs.",
  };
  for (const [name, operation, parent, collection] of parents) {
    const list = operation === "asset_upload" || operation === "products_upsert";
    add(name, `Reddit ${name.replaceAll("_", " ")} using the native schema ${operation}. Preview first. Imports are asynchronous; poll the returned handles. Does not activate ads.`, {
      ...account,
      parentId: idOf(parentDescriptions[parent]),
      data: list ? z.array(native).min(1).max(operation === "asset_upload" ? 50 : 100).describe("Native item records; read the matching Reddit write schema before previewing.") : native,
      confirm,
    }, async args => {
      const data = validateNative(operation, args.data);
      const parentPath = parent === "profile" ? "profiles" : parent === "business" ? "businesses" : "product_catalogs";
      const path = `/${parentPath}/${args.parentId}/${collection}`;
      if (!args.confirm) return { preview: true, applied: false, method: "POST", path, data, providerValidation: false, message: PREVIEW_MESSAGE };
      if (parent === "profile") await api.profile(String(args.parentId), String(args.adAccountId));
      else if (parent === "business") await api.business(String(args.parentId), String(args.adAccountId));
      else await api.entity("product_catalogs", String(args.parentId), String(args.adAccountId));
      await references(api, data, String(args.adAccountId));
      const result = await api.request(path, "POST", data);
      if (operation === "post_create") {
        const receipt = await jobReceipt(api.config.jobSigningKey, { account: args.adAccountId, profile: args.parentId, job: nativeId(row(result.data).id), expires: Date.now() + 7 * 86_400_000 });
        return { ...result, receipt };
      }
      return result;
    });
  }

  // Name-only PATCHes: Reddit updates are partial, so nothing else moves. Its names run 3 to 500 characters.
  const name = z.string().trim().min(3).max(500).describe("New name, 3 to 500 characters. This is the only thing the call changes.");
  for (const [level, plural, param] of [["campaign", "campaigns", "campaignId"], ["ad_group", "ad_groups", "adGroupId"], ["ad", "ads", "adId"]] as const) {
    const label = level.replace("_", " ");
    add(`rename_${level}`, `Rename one Reddit ${label}. The name is the only thing that changes. Previews by default.`, {
      ...account,
      [param]: idOf(`ID of the Reddit ${label} to rename. It must belong to adAccountId.`),
      name,
      confirm,
    }, async args => {
      if (!args.confirm) return renamePreview(`reddit_rename_${level}`, String(args[param]), String(args.name));
      await api.entity(plural, String(args[param]), String(args.adAccountId));
      return api.request(`/${plural}/${args[param]}`, "PATCH", { name: args.name });
    });
  }
  add("rename_ad_account", "Rename the allowed Reddit ad account. The name is the only thing that changes. Previews by default.", { ...account, name, confirm }, async args => {
    if (!args.confirm) return renamePreview("reddit_rename_ad_account", String(args.adAccountId), String(args.name));
    await api.account(String(args.adAccountId));
    return api.request(`/ad_accounts/${nativeId(String(args.adAccountId))}`, "PATCH", { name: args.name });
  });

  for (const [kind, collection] of [["post", "structured_posts"], ["asset", "creative_assets"], ["catalog", "product_catalogs"], ["product_set", "product_sets"]] as const) {
    const label = kind.replace("_", " ");
    add(`update_${kind}`, `Update supported Reddit ${label} fields; preview by default. Read reddit_get_write_schema(operation=${kind}_update).`, {
      ...account,
      id: idOf(`ID of the Reddit ${label} to update. It must belong to adAccountId, directly or through its profile or business.`),
      data: native,
      confirm,
    }, async args => {
      const data = validateNative(`${kind}_update`, args.data);
      const path = `/${collection}/${args.id}`;
      if (!args.confirm) return { preview: true, applied: false, method: "PATCH", path, data, providerValidation: false, message: PREVIEW_MESSAGE };
      await api.entity(collection, String(args.id), String(args.adAccountId));
      await references(api, data, String(args.adAccountId));
      return api.request(path, "PATCH", data);
    });
  }
}
