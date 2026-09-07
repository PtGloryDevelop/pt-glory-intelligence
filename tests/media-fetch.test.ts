import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PREVIEW_BYTES, fetchPreview, isAllowedHost, isPublicAddress,
  isTerminal, sniffImage, validateTarget,
} from "../lib/media/fetch.ts";

/**
 * The SSRF boundary. This is the only place the server dereferences a URL that
 * arrived in an uploaded file, so these are security tests, not unit trivia.
 */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1),
]);
const publicDns = async () => ["157.240.1.35"];

function respond(body: Buffer, init: { status?: number; type?: string; length?: string } = {}) {
  const headers = new Headers();
  if (init.type) headers.set("content-type", init.type);
  if (init.length) headers.set("content-length", init.length);
  return new Response(init.status && init.status >= 300 ? null : new Uint8Array(body), {
    status: init.status ?? 200,
    headers,
  });
}
const stub = (response: Response) => (async () => response) as unknown as typeof fetch;

test("host policy matches the domain, not a substring of it", () => {
  for (const good of ["fbcdn.net", "scontent.fphs2-1.fna.fbcdn.net", "video.xx.fbcdn.net", "FBCDN.NET"]) {
    assert.equal(isAllowedHost(good), true, good);
  }
  // Every one of these passes a naive includes() or a careless endsWith().
  for (const bad of [
    "evil-fbcdn.net", "fbcdn.net.attacker.example", "notfbcdn.net",
    "fbcdn.net.evil.com", "attacker.com/fbcdn.net", "xfbcdn.net", "localhost",
  ]) {
    assert.equal(isAllowedHost(bad), false, bad);
  }
});

test("private and loopback addresses are never public", () => {
  for (const bad of [
    "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12::3", "::ffff:127.0.0.1", "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(bad), false, bad);
  }
  for (const good of ["157.240.1.35", "8.8.8.8", "2606:4700::1111"]) {
    assert.equal(isPublicAddress(good), true, good);
  }
});

test("validateTarget refuses scheme, host and private resolution in that order", async () => {
  assert.equal(await validateTarget("http://scontent.fbcdn.net/a.jpg", publicDns), "scheme_rejected");
  assert.equal(await validateTarget("ftp://scontent.fbcdn.net/a.jpg", publicDns), "scheme_rejected");
  assert.equal(await validateTarget("https://evil.example/a.jpg", publicDns), "host_rejected");
  assert.equal(await validateTarget("https://x.fbcdn.net/a.jpg", async () => ["127.0.0.1"]), "dns_rejected");
  // One private answer among several is still a refusal — blunts rebinding.
  assert.equal(
    await validateTarget("https://x.fbcdn.net/a.jpg", async () => ["157.240.1.35", "10.0.0.1"]),
    "dns_rejected",
  );
  assert.equal(await validateTarget("https://x.fbcdn.net/a.jpg", publicDns), null);
});

test("magic bytes decide the type, not the header", () => {
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPxx")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<html><script>")), null);
  assert.equal(sniffImage(Buffer.from("<svg xmlns=")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test("a JPEG served honestly is accepted, hashed and sized", async () => {
  const result = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns, fetchImpl: stub(respond(JPEG, { type: "image/jpeg" })),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.mimeType, "image/jpeg");
  assert.equal(result.ok && result.byteSize, JPEG.length);
  assert.match(result.ok ? result.sha256 : "", /^[0-9a-f]{64}$/);
});

test("HTML wearing an image content-type is refused by its bytes", async () => {
  const html = Buffer.from("<html><body>gotcha</body></html>");
  const result = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns, fetchImpl: stub(respond(html, { type: "image/jpeg" })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "magic_rejected");
});

test("a video in the preview path is refused", async () => {
  const mp4 = Buffer.concat([Buffer.from("\0\0\0\x18ftypisom"), Buffer.alloc(32)]);
  const result = await fetchPreview("https://x.fbcdn.net/a.mp4", {
    resolve: publicDns, fetchImpl: stub(respond(mp4, { type: "video/mp4" })),
  });
  assert.equal(result.ok === false && result.reason, "mime_rejected");
});

test("the byte cap holds even when content-length lies", async () => {
  const big = Buffer.alloc(2048, 0xff);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  const result = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns, maxBytes: 512,
    // Header claims it is small; the stream is not.
    fetchImpl: stub(respond(big, { type: "image/jpeg", length: "10" })),
  });
  assert.equal(result.ok === false && result.reason, "too_large");
});

test("an oversized declaration is refused before the body is read", async () => {
  const result = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns,
    fetchImpl: stub(respond(JPEG, { type: "image/jpeg", length: String(MAX_PREVIEW_BYTES + 1) })),
  });
  assert.equal(result.ok === false && result.reason, "too_large");
});

test("redirects are refused rather than followed", async () => {
  const result = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns, fetchImpl: stub(respond(Buffer.alloc(0), { status: 302 })),
  });
  assert.equal(result.ok === false && result.reason, "redirect_rejected");
});

test("403 and a known-dead expiry are both recognised", async () => {
  const forbidden = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    resolve: publicDns, fetchImpl: stub(respond(Buffer.from("URL signature expired"), { status: 403 })),
  });
  assert.equal(forbidden.ok === false && forbidden.reason, "http_403");

  // Already expired: refused without spending a request at all.
  let called = false;
  const expired = await fetchPreview("https://x.fbcdn.net/a.jpg", {
    expiresAt: new Date(Date.now() - 1000),
    resolve: publicDns,
    fetchImpl: (async () => { called = true; return respond(JPEG); }) as unknown as typeof fetch,
  });
  assert.equal(expired.ok === false && expired.reason, "source_expired");
  assert.equal(called, false, "a dead source must not cost a request");
});

test("failures are classified terminal or retryable", () => {
  for (const terminal of [
    "source_expired", "http_403", "host_rejected", "scheme_rejected",
    "dns_rejected", "redirect_rejected", "mime_rejected", "magic_rejected", "too_large",
  ] as const) {
    assert.equal(isTerminal(terminal), true, terminal);
  }
  for (const retryable of ["timeout", "http_error", "empty_response", "unknown_fetch_failure"] as const) {
    assert.equal(isTerminal(retryable), false, retryable);
  }
});
