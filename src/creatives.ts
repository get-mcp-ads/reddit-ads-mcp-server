/**
 * reddit-ads-mcp-server: an open-source MCP server for the Reddit Ads API.
 * Copyright 2026 GetMCPAds. https://www.getmcpads.com
 * SPDX-License-Identifier: Apache-2.0
 *
 * Resolves the media behind ads for reddit_list_ad_creatives: structured post
 * components, catalog product images and asset-library media. Every lookup
 * goes through an account-checked entity read. Media URLs are returned as
 * data and never fetched by this server.
 */
import { RedditClient, row, type Row } from "./client.js";

export async function redditAssets(api: RedditClient, account: string, ads: Row[]) {
  const assets: Row[] = [];
  const warnings: string[] = [];
  for (const ad of ads.slice(0, 20)) {
    try {
      if (ad.ad_account_id !== account) throw new Error("Ad outside selected account.");
      if (Array.isArray(ad.products) && ad.products.length) {
        const group = await api.entity("ad_groups", String(ad.ad_group_id), account);
        const set = await api.entity("product_sets", String(group.product_set_id), account);
        const catalogId = String(set.catalog_id ?? set.product_catalog_id);
        const products = await api.all(`/product_catalogs/${catalogId}/products`);
        for (const reference of ad.products.slice(0, 40)) {
          const product = products.find(p => p.id === row(reference).product_id);
          const url = row(product?.reddit).image_link ?? product?.image_link;
          if (!product || typeof url !== "string") {
            warnings.push(`Ad ${ad.id}: product ${row(reference).product_id} image unavailable.`);
            continue;
          }
          assets.push({ id: `${ad.id}/product/${product.id}`, platform: "reddit_ads", nativeAssetId: String(product.id), kind: "image", name: ad.name, nameSource: "ad", assetName: product.title, relatedAds: [{ id: String(ad.id), name: String(ad.name ?? "") }], thumbnail: url, link: url, assetUrl: url, landingPageUrl: product.link });
        }
        if (ad.products.length > 40) warnings.push(`Ad ${ad.id}: product images limited to 40.`);
        continue;
      }
      if (!ad.post_id) {
        const identifiers = Array.isArray(ad.asset_identifiers) ? ad.asset_identifiers : [];
        if (!identifiers.length) {
          warnings.push(`Ad ${ad.id}: no structured post or resolvable asset identifiers; native catalog configuration remains available.`);
          continue;
        }
        for (const identifier of identifiers.slice(0, 40)) {
          const asset = await api.entity("creative_assets", String(row(identifier).id), account);
          if (asset.type === "HEADLINE") continue;
          const url = row(asset.media).url;
          if (typeof url !== "string" || !["IMAGE", "VIDEO"].includes(String(asset.type))) {
            warnings.push(`Ad ${ad.id} asset ${asset.id}: media URL unavailable.`);
            continue;
          }
          assets.push({ id: `${ad.id}/${asset.id}`, platform: "reddit_ads", nativeAssetId: String(asset.id), kind: asset.type === "VIDEO" ? "video" : "image", name: ad.name, nameSource: "ad", assetName: asset.name, relatedAds: [{ id: String(ad.id), name: String(ad.name ?? "") }], thumbnail: asset.type === "IMAGE" ? url : row(asset.poster).url ?? null, link: url, assetUrl: url, ...(asset.type === "VIDEO" ? { video: url } : {}), landingPageUrl: row(ad.destination).url });
        }
        if (identifiers.length > 40) warnings.push(`Ad ${ad.id}: asset list limited to 40 components.`);
        continue;
      }
      const post = await api.entity("structured_posts", String(ad.post_id), account);
      const creative = row(post.creative);
      const components = Array.isArray(creative.carousel) ? creative.carousel : [creative];
      for (const [i, c] of components.slice(0, 40).entries()) {
        const part = row(c);
        const video = row(part.video);
        const image = row(part.image);
        const thumb = row(part.thumbnail ?? creative.thumbnail);
        const videoUrl = row(video.media).url;
        const imageUrl = row(image.media).url;
        const thumbnail = row(thumb.media).url ?? imageUrl;
        const url = typeof videoUrl === "string" ? videoUrl : typeof imageUrl === "string" ? imageUrl : null;
        if (!url) {
          warnings.push(`Ad ${ad.id} component ${i}: ${part.type ?? creative.type} has no resolved image/video URL.`);
          continue;
        }
        assets.push({ id: `${ad.id}/${post.id}/${i}`, platform: "reddit_ads", nativeAssetId: String(post.id), kind: videoUrl ? "video" : "image", name: ad.name, nameSource: "ad", assetName: creative.headline, relatedAds: [{ id: String(ad.id), name: String(ad.name ?? "") }], thumbnail: thumbnail ?? null, link: url, assetUrl: url, ...(videoUrl ? { video: videoUrl } : {}), landingPageUrl: row(part.destination).url });
      }
    } catch (e) {
      warnings.push(`Ad ${ad.id}: ${e instanceof Error ? e.message : "creative read failed"}`);
    }
  }
  return {
    assets,
    warnings,
    coverage: {
      requestedAds: ads.length,
      returnedAssets: assets.length,
      partial: warnings.length > 0 || ads.length > 20,
      scope: "Ad-linked image/video/carousel, selected catalog product images and Max media; whole-ad metrics are shared by their components, not asset-level attribution. Text and unresolved catalog formats are explicit gaps.",
    },
  };
}
