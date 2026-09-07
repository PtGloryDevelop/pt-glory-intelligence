import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Server-side fetch of one archival candidate.
 *
 * This is the only place in the product where the server dereferences a URL that
 * came out of an uploaded file, which makes it an SSRF surface by construction.
 * Every control below exists because of that, and the candidate must already
 * have come from lib/media/select.ts — advertiser-controlled fields never reach
 * here.
 *
 * Nothing in this module ever logs or returns a URL. Signed URLs are
 * credentials; a failure reason is a short machine-readable token instead.
 */

/** Measured max preview in a fresh 631-ad export was 736 KB. 8 MB is deliberate headroom. */
export const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20_000;

/** Preview path only. Video bytes are not archived in this phase. */
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FailureReason =
  | "source_expired" | "http_403" | "http_error" | "timeout"
  | "dns_rejected" | "host_rejected" | "scheme_rejected" | "redirect_rejected"
  | "mime_rejected" | "magic_rejected" | "too_large"
  | "empty_response" | "unknown_fetch_failure";

/**
 * Terminal failures will never succeed on a retry: the source is gone, or it was
 * never something we would accept. Everything else is worth another attempt.
 */
const TERMINAL: ReadonlySet<FailureReason> = new Set<FailureReason>([
  "source_expired", "http_403", "host_rejected", "scheme_rejected",
  "dns_rejected", "redirect_rejected", "mime_rejected", "magic_rejected", "too_large",
]);

export const isTerminal = (reason: FailureReason): boolean => TERMINAL.has(reason);

export type FetchOk = {
  ok: true;
  bytes: Buffer;
  mimeType: string;
  byteSize: number;
  sha256: string;
};
export type FetchFailure = { ok: false; reason: FailureReason };
export type FetchResult = FetchOk | FetchFailure;

const fail = (reason: FailureReason): FetchFailure => ({ ok: false, reason });

/**
 * Host policy: exactly `fbcdn.net` or a subdomain of it.
 *
 * Suffix matching by `includes` or a bare `endsWith("fbcdn.net")` would accept
 * `evil-fbcdn.net` and `fbcdn.net.attacker.example`. The leading dot is what
 * makes this a domain boundary rather than a string coincidence.
 */
export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
}

/**
 * Addresses the server must never be talked into contacting. Checked against
 * resolved addresses, not the hostname, because a name we allow can still point
 * at 127.0.0.1.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;          // link-local
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false;                         // multicast / reserved
    return true;
  }
  if (family === 6) {
    const ip = address.toLowerCase();
    if (ip === "::1" || ip === "::") return false;
    if (ip.startsWith("fe80")) return false;            // link-local
    if (/^f[cd]/.test(ip)) return false;                // unique local
    if (ip.startsWith("::ffff:")) return isPublicAddress(ip.slice(7)); // mapped v4
    return true;
  }
  return false;
}

/** Content sniffing. A Content-Type header is a claim by the far end, not a fact. */
export function sniffImage(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Scheme, host and resolved-address checks. Exported so tests can drive it alone. */
export async function validateTarget(
  url: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<FailureReason | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "scheme_rejected"; }

  // https only. The preview path has no reason to accept cleartext.
  if (parsed.protocol !== "https:") return "scheme_rejected";
  if (!isAllowedHost(parsed.hostname)) return "host_rejected";

  let addresses: string[];
  try { addresses = await resolve(parsed.hostname); } catch { return "dns_rejected"; }
  if (addresses.length === 0) return "dns_rejected";
  // Every resolved address must be public — one private answer is enough to
  // refuse, which also blunts DNS rebinding via multi-answer records.
  if (!addresses.every(isPublicAddress)) return "dns_rejected";

  return null;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

/**
 * Downloads one preview under every control above.
 *
 * Redirects are refused outright rather than followed and re-validated: the
 * fbcdn preview URLs in the measured exports never redirect, so accepting them
 * would add an attack surface for no observed benefit.
 */
export async function fetchPreview(
  url: string,
  options: {
    expiresAt?: Date | null;
    maxBytes?: number;
    timeoutMs?: number;
    resolve?: (host: string) => Promise<string[]>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<FetchResult> {
  const maxBytes = options.maxBytes ?? MAX_PREVIEW_BYTES;

  // Cheapest check first: a source we already know is dead is terminal, and
  // there is no point spending a request to be told so.
  if (options.expiresAt && options.expiresAt.getTime() <= Date.now()) return fail("source_expired");

  const rejection = await validateTarget(url, options.resolve);
  if (rejection) return fail(rejection);

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS);

  try {
    const response = await doFetch(url, { signal: controller.signal, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) return fail("redirect_rejected");
    if (response.status === 403 || response.status === 401) return fail("http_403");
    if (!response.ok) return fail("http_error");

    // Content-Length is a hint worth acting on early, but it is not trusted:
    // the streaming cap below is what actually holds.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) return fail("too_large");

    const bytes = await readCapped(response, maxBytes);
    if (bytes === "too_large") return fail("too_large");
    if (bytes.length === 0) return fail("empty_response");

    // Header first as a cheap filter, then the bytes themselves as the ruling.
    const declaredType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (declaredType && !ALLOWED_MIME.has(declaredType)) return fail("mime_rejected");

    const sniffed = sniffImage(bytes);
    if (!sniffed || !ALLOWED_MIME.has(sniffed)) return fail("magic_rejected");

    return {
      ok: true,
      bytes,
      mimeType: sniffed,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "AbortError" || name === "TimeoutError") return fail("timeout");
    return fail("unknown_fetch_failure");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads the body while counting, and stops the moment the cap is passed.
 *
 * Buffering first and checking afterwards would mean a hostile endpoint could
 * make the server hold an unbounded response in memory before being refused.
 */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer | "too_large"> {
  const body = response.body;
  if (!body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return "too_large";
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total);
}
