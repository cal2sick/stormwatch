import { USER_AGENT } from "./config.js";

type Cached = { etag?: string; lastModified?: string; body: unknown };
const cache = new Map<string, Cached>();

export class HttpError extends Error {
  constructor(message: string, public status: number, public retryAfterSec: number | null) { super(message); }
}

/** Parse Retry-After (seconds or HTTP date) into seconds. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim());
  const t = Date.parse(v);
  return isNaN(t) ? null : Math.max(0, Math.round((t - now) / 1000));
}

/**
 * Every upstream request goes through here: User-Agent, ETag / If-Modified-Since,
 * a timeout, and Retry-After surfaced to the poller on 429/503.
 */
async function request<T>(url: string, accept: string, parse: (r: Response) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  const prev = cache.get(url);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: accept };
  if (prev?.etag) headers["If-None-Match"] = prev.etag;
  if (prev?.lastModified) headers["If-Modified-Since"] = prev.lastModified;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304 && prev) return prev.body as T;
  if (!res.ok) {
    throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, parseRetryAfter(res.headers.get("retry-after")));
  }
  const body = await parse(res);
  cache.set(url, { etag: res.headers.get("etag") ?? undefined, lastModified: res.headers.get("last-modified") ?? undefined, body });
  return body;
}

export const getJson = <T>(url: string, accept = "application/json") => request<T>(url, accept, (r) => r.json() as Promise<T>);
export const getText = (url: string, accept = "text/plain, text/html, */*") => request<string>(url, accept, (r) => r.text());
export const getBytes = (url: string) =>
  request<Uint8Array>(url, "*/*", async (r) => new Uint8Array(await r.arrayBuffer()), 60_000);
