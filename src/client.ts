/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reddit Ads API v3 client. Every request goes to the fixed API base, never
 * follows a redirect, has a timeout and a response size bound, and is scoped
 * to the configured ad accounts. Tokens live in memory only.
 */
import { REDDIT_API_BASE, REDDIT_API_ORIGIN, REDDIT_TOKEN_URL } from "./hosts.js";

export type Row = Record<string, unknown>;
export type RedditConfig = {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Ad accounts this process may reach. Checked before every request. */
  allowedAccountIds: string[];
  userAgent: string;
  /** In-memory key that signs structured post job receipts. */
  jobSigningKey: string;
};

export const row = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {});
export const nativeId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[\w.-]{1,128}$/.test(value) || value.includes("..")) throw new Error("Invalid Reddit identifier.");
  return value;
};

export class RedditError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "RedditError";
  }
}

const API_TIMEOUT_MS = 30_000;
const TOKEN_TIMEOUT_MS = 20_000;
export const MAX_API_BYTES = 8_000_000;
const MAX_TOKEN_BYTES = 64_000;
const UNKNOWN_OUTCOME = " This write may or may not have been applied: read the account before retrying.";

/** Reads a response body, refusing to buffer more than `limit` bytes. */
async function readBounded(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new RedditError(`Reddit response exceeds ${limit} bytes. Narrow the request.`);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new RedditError(`Reddit response exceeds ${limit} bytes. Narrow the request.`);
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/** Describes a request that never produced a response, without its URL or headers. */
function networkMessage(error: unknown, write: boolean): string {
  const outcome = write ? UNKNOWN_OUTCOME : "";
  const err = error instanceof Error ? error : undefined;
  const cause = err?.cause instanceof Error ? err.cause.message : "";
  if (/redirect/i.test(cause) || /redirect/i.test(err?.message ?? "")) {
    return `Reddit answered with a redirect. Redirects are never followed, so credentials stay on the official host.${outcome}`;
  }
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return `Reddit did not answer in time.${outcome}`;
  if (err instanceof RedditError) return err.message + outcome;
  return `The Reddit request did not complete.${outcome}`;
}

export class RedditClient {
  private accessToken?: string;
  private refreshToken?: string;
  private expiresAt = 0;
  private refreshing?: Promise<void>;
  private readonly secrets = new Set<string>();

  constructor(readonly config: RedditConfig) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    for (const value of [config.accessToken, config.refreshToken, config.clientSecret, config.jobSigningKey]) if (value) this.secrets.add(value);
    if (config.clientId && config.clientSecret) this.secrets.add(btoa(`${config.clientId}:${config.clientSecret}`));
  }

  private get canRefresh(): boolean {
    return Boolean(this.refreshToken && this.config.clientId && this.config.clientSecret);
  }

  /** Removes every credential this process knows from a string. */
  redact(value: string): string {
    for (const secret of this.secrets) if (secret.length >= 4) value = value.split(secret).join("[redacted]");
    return value;
  }

  assertAccount(id: string): void {
    if (!this.config.allowedAccountIds.includes(id)) {
      throw new RedditError("This Reddit ad account is not listed in REDDIT_ADS_ACCOUNT_IDS. Add it there and restart the server to allow it.");
    }
  }

  private async token(): Promise<string> {
    const fresh = this.accessToken && (!this.expiresAt || Date.now() < this.expiresAt - 60_000);
    if (fresh) return this.accessToken as string;
    if (this.canRefresh) {
      await this.refresh();
      return this.accessToken as string;
    }
    if (this.accessToken) return this.accessToken;
    throw new RedditError("No Reddit access token is available. Set REDDIT_ADS_ACCESS_TOKEN or the refresh credentials.");
  }

  /** Renews the access token in memory. Concurrent callers share one renewal. */
  private refresh(): Promise<void> {
    this.refreshing ??= this.renew().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async renew(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(REDDIT_TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        headers: {
          authorization: `Basic ${btoa(`${this.config.clientId}:${this.config.clientSecret}`)}`,
          "user-agent": this.config.userAgent,
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken as string }),
      });
    } catch (error) {
      throw new RedditError(`Reddit token renewal failed. ${networkMessage(error, false)}`);
    }
    let token: Row = {};
    try {
      token = row(JSON.parse(await readBounded(response, MAX_TOKEN_BYTES)));
    } catch {
      token = {};
    }
    if (response.status >= 300 && response.status < 400) throw new RedditError("Reddit token renewal answered with a redirect, which is never followed.");
    if (!response.ok || typeof token.access_token !== "string" || !token.access_token || typeof token.expires_in !== "number" || token.expires_in <= 0) {
      const code = typeof token.error === "string" ? ` (${token.error.slice(0, 60)})` : "";
      throw new RedditError(this.redact(`Reddit refused to renew the access token: HTTP ${response.status}${code}. Check REDDIT_ADS_REFRESH_TOKEN, REDDIT_ADS_CLIENT_ID and REDDIT_ADS_CLIENT_SECRET, or authorize the app again.`), response.status);
    }
    this.accessToken = token.access_token;
    this.secrets.add(token.access_token);
    if (typeof token.refresh_token === "string" && token.refresh_token) {
      this.refreshToken = token.refresh_token;
      this.secrets.add(token.refresh_token);
    }
    this.expiresAt = Date.now() + token.expires_in * 1000;
  }

  private providerError(status: number, body: Row, headers: Headers, write: boolean): RedditError {
    const error = row(body.error);
    const message = String(error.message ?? body.message ?? (typeof body.error === "string" ? body.error : "request_failed"));
    const fields = Array.isArray(error.fields) ? error.fields.slice(0, 6).map(f => `${row(f).field}: ${row(f).message}`).join("; ") : "";
    const hints: string[] = [];
    if (status >= 200 && status < 300) hints.push("Reddit reported this error inside a successful HTTP response.");
    if (status === 401) hints.push(this.canRefresh ? "Reddit refused the renewed token. Authorize the app again." : "Provide a renewed REDDIT_ADS_ACCESS_TOKEN, or the refresh credentials so the server can renew it.");
    if (status === 403) hints.push("Check that the token carries adsread (and adsedit for writes) and that the Reddit user has a role on this ad account.");
    if (status === 429) hints.push(`Rate limited; Retry-After=${headers.get("retry-after") ?? "unspecified"}.`);
    if (write && (status >= 500 || (status >= 200 && status < 300))) hints.push(UNKNOWN_OUTCOME.trim());
    const text = `Reddit API ${status}: ${message}${fields ? ` ${fields}` : ""}${hints.length ? `. ${hints.join(" ")}` : ""}`;
    return new RedditError(this.redact(text).slice(0, 1200), status);
  }

  /** One request to the Reddit Ads API. A 401 is retried once after a token renewal; nothing else is retried. */
  async request(path: string, method = "GET", data?: unknown, retry = true): Promise<Row> {
    if (!path.startsWith("/") || path.includes("..") || path.includes("://") || path.includes("\\") || path.split("?")[0].includes("//")) throw new RedditError("Invalid Reddit API path.");
    const url = new URL(REDDIT_API_BASE + path);
    if (url.origin !== REDDIT_API_ORIGIN || !url.pathname.startsWith("/api/v3/") || url.hash || url.username || url.password) throw new RedditError("Invalid Reddit API origin.");
    const scoped = url.pathname.match(/^\/api\/v3\/ad_accounts\/([^/]+)/);
    if (scoped) this.assertAccount(decodeURIComponent(scoped[1]));
    const write = method !== "GET";
    const token = await this.token();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, "user-agent": this.config.userAgent, "content-type": "application/json", accept: "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify({ data }) }),
      });
    } catch (error) {
      throw new RedditError(this.redact(networkMessage(error, write)));
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new RedditError(`Reddit answered with a redirect, which is never followed; credentials were not forwarded.${write ? UNKNOWN_OUTCOME : ""}`, response.status);
    }
    if (response.status === 401 && retry && this.canRefresh) {
      // A 401 means Reddit rejected the credentials before acting, so one retry after renewal is safe for writes too.
      await response.body?.cancel();
      await this.refresh();
      return this.request(path, method, data, false);
    }
    if (response.status === 204) return {};
    let text: string;
    try {
      text = await readBounded(response, MAX_API_BYTES);
    } catch (error) {
      throw new RedditError(networkMessage(error, write));
    }
    let body: Row = {};
    let parsed = true;
    try {
      body = text ? row(JSON.parse(text)) : {};
    } catch {
      parsed = false;
    }
    if (!response.ok || (body.error !== undefined && body.error !== null)) throw this.providerError(response.status, body, response.headers, write);
    if (!parsed) throw new RedditError(`Reddit returned a response that is not JSON.${write ? UNKNOWN_OUTCOME : ""}`);
    return body;
  }

  /** One page of a Reddit list. The cursor is only the page_token of Reddit's own next_url. */
  async list(path: string, limit = 100, cursor?: string): Promise<{ data: Row[]; next_cursor: string | null; truncated: boolean }> {
    const target = new URL(REDDIT_API_BASE + path);
    target.searchParams.set("page_size", String(limit));
    if (cursor) target.searchParams.set("page_token", cursor);
    const body = await this.request(target.pathname.slice("/api/v3".length) + target.search);
    if (!Array.isArray(body.data)) throw new RedditError("Reddit returned an invalid list.");
    const next = row(body.pagination).next_url;
    let nextCursor: string | null = null;
    if (next) {
      const u = new URL(String(next), REDDIT_API_BASE);
      if (u.origin !== target.origin || u.pathname !== target.pathname || u.username || u.password || u.hash) throw new RedditError("Unsafe Reddit pagination URL.");
      nextCursor = u.searchParams.get("page_token");
      if (!nextCursor) throw new RedditError("Reddit pagination cursor missing.");
    }
    return { data: body.data.map(row), next_cursor: nextCursor, truncated: Boolean(next) };
  }

  /** Every page, for ownership checks. Bounded to 30 pages and refuses a repeated cursor. */
  async all(path: string): Promise<Row[]> {
    const result: Row[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      if (seen.size >= 30 || (cursor && seen.has(cursor))) throw new RedditError("Reddit ownership lookup incomplete; narrow the scope.");
      if (cursor) seen.add(cursor);
      const page = await this.list(path, 100, cursor);
      result.push(...page.data);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return result;
  }

  async account(account: string): Promise<Row> {
    const entity = row((await this.request(`/ad_accounts/${nativeId(account)}`)).data);
    if (entity.id !== account) throw new RedditError("Reddit account not returned.");
    return entity;
  }

  async profile(profile: string, account: string): Promise<void> {
    if (!(await this.all(`/ad_accounts/${nativeId(account)}/profiles`)).some(p => p.id === profile)) throw new RedditError("Reddit profile is not attached to the selected account.");
  }

  async business(business: string, account: string): Promise<void> {
    if ((await this.account(account)).business_id !== business) throw new RedditError("Reddit business does not own the selected account.");
  }

  /** Reads one entity and verifies that it belongs to the ad account, directly or through its profile, business or catalog. */
  async entity(kind: string, id: string, account: string): Promise<Row> {
    if (kind === "creative_assets") {
      nativeId(id);
      for (const profile of await this.all(`/ad_accounts/${nativeId(account)}/profiles`)) {
        const assets = await this.all(`/profiles/${nativeId(profile.id)}/creative_assets?creative_asset_ids=${encodeURIComponent(id)}`);
        const found = assets.map(a => row(a.result ?? a)).find(a => a.id === id);
        if (found) return { ...found, profile_id: profile.id };
      }
      throw new RedditError("Creative asset is not in an authorized account profile library.");
    }
    const value = row((await this.request(`/${kind}/${nativeId(id)}`)).data);
    if (value.id !== id) throw new RedditError("Reddit entity identity mismatch.");
    if (kind === "product_catalogs") await this.business(String(value.business_id), account);
    else if (kind === "product_sets") await this.entity("product_catalogs", String(value.catalog_id ?? value.product_catalog_id), account);
    else if (kind === "structured_posts") await this.profile(String(value.profile_id), account);
    else if (value.ad_account_id !== account) throw new RedditError("Reddit entity does not belong to the selected ad account.");
    return value;
  }
}

/** Signs the account, profile and job of a structured post creation, so polling cannot reach another account's job. */
export async function jobReceipt(key: string, scope: Row): Promise<string> {
  const payload = btoa(JSON.stringify(scope));
  const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(payload)));
  return `${payload}.${btoa(String.fromCharCode(...signature))}`;
}

export async function verifyJobReceipt(key: string, receipt: string, account: string): Promise<Row> {
  try {
    const [payload, signature, extra] = receipt.split(".");
    if (extra !== undefined || !payload || !signature) throw new Error();
    const hmac = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", hmac, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), new TextEncoder().encode(payload));
    if (!valid) throw new Error();
    const scope = row(JSON.parse(atob(payload)));
    if (scope.account !== account || typeof scope.expires !== "number" || scope.expires < Date.now()) throw new Error();
    return scope;
  } catch {
    throw new RedditError("Invalid or expired Reddit job receipt for this account. Receipts are valid for seven days and only within the server process that created them.");
  }
}
