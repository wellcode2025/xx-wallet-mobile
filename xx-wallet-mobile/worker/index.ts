/**
 * Cloudflare Worker entry for xx-wallet-mobile (Workers Static Assets).
 *
 * Serves the built SPA from the static-assets binding (env.ASSETS — with the
 * SPA deep-link fallback configured in wrangler.toml) for every route EXCEPT
 * /xxdk-wasm/*, which it proxies to elixxir's CDN server-side.
 *
 * Why: the xxdk cMix wasm is ~45MB — over Cloudflare's 25 MiB static-asset cap,
 * so it can't ship in dist/. Proxying keeps the browser talking only to this
 * origin (connect-src stays 'self'; the user's device never contacts a
 * third-party CDN) while Cloudflare's edge fetches + caches the immutable,
 * version-pinned asset, so elixxir is hit rarely.
 *
 * This file lives outside src/ so the app's `tsc` (include: ["src"]) doesn't
 * type-check it; wrangler bundles it on deploy.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// Pinned to the installed xxdk-wasm version — bump alongside package.json.
const XXDK_UPSTREAM = 'https://elixxir-bins.s3-us-west-1.amazonaws.com/wasm/xxdk-wasm-0.3.22';
const PREFIX = '/xxdk-wasm/';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(PREFIX)) {
      return proxyXxdkAsset(url.pathname.slice(PREFIX.length));
    }
    return env.ASSETS.fetch(request);
  },
};

async function proxyXxdkAsset(assetPath: string): Promise<Response> {
  const upstream = `${XXDK_UPSTREAM}/${assetPath}`;
  // Edge-cache the immutable, version-pinned asset so elixxir is hit rarely.
  const resp = await fetch(upstream, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
  if (!resp.ok) {
    return new Response('xxdk asset unavailable', { status: 502 });
  }
  const headers = new Headers(resp.headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(resp.body, { status: resp.status, headers });
}
