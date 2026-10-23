import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { ApiError } from "../src/workspace-files.js";
import { extractReadablePage, isPublicWebAddress, pinnedWebRequestOptions, readPublicWebPage, validateWebUrl, WebReaderError, WEB_READER_LIMIT, type WebPageResponse, type WebReaderDependencies } from "../src/web-reader.js";

const article = `<html><head><title>Research notes</title></head><body><nav>Navigation noise</nav><article><h1>Research notes</h1><p>${"Accessible experimental evidence and documented methods. ".repeat(15)}</p><p>Second paragraph with independent measurements and reproducible conclusions.</p></article><script>window.stolen = secret;</script><div hidden>HIDDEN_SECRET</div><div style="display:none">HIDDEN_STYLE</div></body></html>`;
const page = (body = article): WebPageResponse => ({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, bytes: Buffer.from(body) });
const dependencies = (request: WebReaderDependencies["request"]): WebReaderDependencies => ({ lookup: async () => [{ address: "93.184.215.14", family: 4 }], request });
const status = (code: number) => (error: unknown) => error instanceof ApiError && error.statusCode === code;

test("public web addresses reject private, reserved, mapped and transition networks", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "2001:db8::1", "2001::1", "2002:7f00:1::", "3fff::1"]) assert.equal(isPublicWebAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isPublicWebAddress(address), true, address);
});

test("URL validation rejects credential, local, alternate port and obfuscated hosts", () => {
  for (const input of ["file:///etc/passwd", "http://127.1", "http://2130706433", "http://0x7f000001", "http://[::ffff:7f00:1]", "http://localhost.", "http://printer.local", "https://example.com:8443", "https://user:password@example.com", "https://example.com/?api_key=private", "https://example.com/?access_token=private", "https://example.com/?sessionId=private", "https://example.com/?%74oken=private"]) assert.throws(() => validateWebUrl(input), status(403), input);
  assert.throws(() => validateWebUrl("https://exam\nple.com"), status(400));
  assert.equal(validateWebUrl("https://example.com:443/article?q=public#heading").href, "https://example.com/article?q=public");
});

test("pinned request connects to validated IP with original TLS and Host identity only", () => {
  const options = pinnedWebRequestOptions(new URL("https://example.com/article?q=research"), { address: "93.184.215.14", family: 4 });
  assert.equal(options.hostname, "93.184.215.14"); assert.equal(options.servername, "example.com");
  assert.equal(options.path, "/article?q=research"); assert.equal(options.agent, false);
  assert.deepEqual(options.headers, { Host: "example.com", Accept: "text/html, application/xhtml+xml, text/plain;q=0.8", "Accept-Encoding": "identity", "User-Agent": "OpenRigor-Reader/0.1" });
  assert.equal(pinnedWebRequestOptions(new URL("http://example.com"), { address: "93.184.215.14", family: 4 }).servername, undefined);
});

test("reader extracts actual text, title and fetch provenance without script or hidden content", async () => {
  const seen: Array<{ url: string; address: string }> = [];
  const result = await readPublicWebPage("https://example.com/article#section", dependencies(async (url, address) => { seen.push({ url: url.href, address: address.address }); return page(); }));
  assert.equal(result.requestedUrl, "https://example.com/article"); assert.equal(result.finalUrl, result.requestedUrl);
  assert.equal(result.title, "Research notes"); assert.equal(result.contentType, "text/html"); assert.equal(result.truncated, false);
  assert.equal("content" in result, false); assert.equal(typeof result.text, "string");
  assert.match(result.text, /Accessible experimental evidence/); assert.match(result.text, /\n\nSecond paragraph/);
  assert.doesNotMatch(result.text, /<script|window.stolen|HIDDEN_SECRET|HIDDEN_STYLE/);
  assert.equal(Number.isNaN(Date.parse(result.fetchedAt)), false); assert.deepEqual(seen, [{ url: "https://example.com/article", address: "93.184.215.14" }]);
});

test("reader validates each redirect and rejects mixed/private DNS before any connection", async () => {
  let requests = 0;
  await assert.rejects(readPublicWebPage("https://example.com", { lookup: async () => [{ address: "93.184.215.14", family: 4 }, { address: "127.0.0.1", family: 4 }], request: async () => { requests++; return page(); } }), status(403));
  assert.equal(requests, 0);
  for (const location of ["http://169.254.169.254/latest/meta-data", "http://[::1]/", "https://user:pass@example.com", "https://example.com/?token=secret"]) {
    requests = 0;
    await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => { requests++; return { status: 302, headers: { location }, bytes: Buffer.alloc(0) }; })), status(403));
    assert.equal(requests, 1);
  }
  requests = 0;
  await assert.rejects(readPublicWebPage("https://example.com", { lookup: async (host) => [{ address: host === "example.com" ? "93.184.215.14" : "10.1.1.1", family: 4 }], request: async () => { requests++; return { status: 302, headers: { location: "https://rebound.example.org/secret" }, bytes: Buffer.alloc(0) }; } }), status(403));
  assert.equal(requests, 1);
});

test("public redirects expose final address and remain bounded", async () => {
  const result = await readPublicWebPage("https://example.com/start", dependencies(async (url) => url.pathname === "/start" ? { status: 302, headers: { location: "/article" }, bytes: Buffer.alloc(0) } : page()));
  assert.equal(result.finalUrl, "https://example.com/article"); assert.equal(result.requestedUrl, "https://example.com/start");
  await assert.rejects(readPublicWebPage("https://example.com/start", dependencies(async () => ({ status: 302, headers: { location: "/start" }, bytes: Buffer.alloc(0) }))), status(502));
  let requests = 0;
  await assert.rejects(readPublicWebPage("https://example.com/0", dependencies(async () => ({ status: 302, headers: { location: `/${++requests}` }, bytes: Buffer.alloc(0) }))), status(502));
  assert.equal(requests, 5);
});

test("reader rejects inaccessible, unsupported, empty, oversized and compressed-bomb content", async () => {
  for (const httpStatus of [401, 402, 403, 429]) await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => ({ ...page(), status: httpStatus }))), status(422));
  await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => ({ ...page(), headers: { "content-type": "application/pdf" } }))), status(415));
  await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => ({ ...page(), bytes: Buffer.alloc(WEB_READER_LIMIT + 1) }))), status(413));
  await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => ({ ...page(), headers: { "content-type": "text/plain", "content-encoding": "gzip" }, bytes: gzipSync("a".repeat(WEB_READER_LIMIT + 1)) }))), status(413));
  for (const html of ["<title>Sign in</title><p>Account login page</p>", "<title>Just a moment</title><p>Verify you are human</p>", `<script type="application/ld+json">{"isAccessibleForFree":false}</script>${article}`, "<html><body><div id=app></div><script>Load app</script></body></html>"]) await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => page(html))), status(422));
  assert.throws(() => extractReadablePage(Buffer.from([0xff, 0xfe, 0xff]), "text/plain; charset=utf-8", new URL("https://example.com")), status(415));
});

test("DNS and response waits share one bounded timeout", async () => {
  await assert.rejects(readPublicWebPage("https://example.com", { ...dependencies(async () => page()), lookup: () => new Promise(() => {}), timeoutMs: 10 }), status(504));
  await assert.rejects(readPublicWebPage("https://example.com", { ...dependencies(() => new Promise(() => {})), timeoutMs: 10 }), status(504));
});

test("same-host redirects revalidate DNS and never retry a pinned connection against a new address", async () => {
  let lookups = 0; let requests = 0;
  await assert.rejects(readPublicWebPage("https://example.com/start", {
    lookup: async () => [{ address: ++lookups === 1 ? "93.184.215.14" : "127.0.0.1", family: 4 }],
    request: async (_url, address) => {
      requests++;
      assert.equal(address.address, "93.184.215.14");
      return { status: 302, headers: { location: "/next" }, bytes: Buffer.alloc(0) };
    }
  }), (error: unknown) => error instanceof WebReaderError && error.code === "URL_BLOCKED");
  assert.equal(lookups, 2); assert.equal(requests, 1);
  assert.equal(isPublicWebAddress("168.63.129.16"), false);
  await assert.rejects(readPublicWebPage("https://example.com", {
    lookup: async () => [{ address: "93.184.215.14", family: 6 }],
    request: async () => { assert.fail("mismatched address family must not connect"); }
  }), status(403));
});

test("successful compressed and plain text pages preserve content and report truncation", async () => {
  const compressed = await readPublicWebPage("https://example.com", dependencies(async () => ({ status: 200, headers: { "content-type": "text/html", "content-encoding": "gzip" }, bytes: gzipSync(article) })));
  assert.match(compressed.text, /independent measurements/);
  assert.equal("content" in compressed, false);
  const longText = await readPublicWebPage("https://example.com", dependencies(async () => ({ status: 200, headers: { "content-type": "text/plain" }, bytes: Buffer.from("x".repeat(170_000)) })));
  assert.equal(longText.text.length, 160_000); assert.equal(longText.truncated, true);
  await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => { throw new Error("PRIVATE_NETWORK_ERROR details"); })), (error: unknown) => error instanceof WebReaderError && error.code === "FETCH_FAILED" && !error.message.includes("PRIVATE_NETWORK_ERROR"));
  await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => ({ ...page(), status: 403 }))), (error: unknown) => error instanceof WebReaderError && error.code === "UPSTREAM_ACCESS_REQUIRED");
});

test("transport failures preserve status and typed reader error code", async () => {
  for (const [httpStatus, code] of [[413, "PAGE_TOO_LARGE"], [502, "FETCH_FAILED"], [504, "FETCH_TIMEOUT"]] as const) {
    await assert.rejects(readPublicWebPage("https://example.com", dependencies(async () => { throw new ApiError(httpStatus, "Transport rejected response"); })), (error) => error instanceof WebReaderError && error.statusCode === httpStatus && error.code === code);
  }
});

test("reader API uses the shared origin guard and exposes actionable errors without fetching private URLs", async () => {
  process.env.PORT = "0";
  process.env.OPENRIGOR_EXECUTOR = "demo";
  const { server } = await import("../src/server.js");
  if (!server.listening) await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [value, expectedStatus, expectedCode] of [["", 400, "URL_INVALID"], ["http://169.254.169.254/latest/meta-data", 403, "URL_BLOCKED"], ["https://user:password@example.com", 403, "URL_BLOCKED"]] as const) {
      const response = await fetch(`${base}/api/web/read?url=${encodeURIComponent(value)}`);
      assert.equal(response.status, expectedStatus);
      const body = await response.json() as { error: string; code: string };
      assert.equal(body.code, expectedCode); assert.equal(typeof body.error, "string");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    const forbidden = await fetch(`${base}/api/web/read?url=https://example.com`, { headers: { origin: "https://untrusted.example" } });
    assert.equal(forbidden.status, 403);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
