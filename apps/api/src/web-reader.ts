import { lookup } from "node:dns/promises";
import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { Readability } from "@mozilla/readability";
import { DOMParser } from "linkedom";
import { ApiError } from "./workspace-files.js";

export const WEB_READER_LIMIT = 2 * 1024 * 1024;
const TEXT_LIMIT = 160_000;
const TIMEOUT_MS = 12_000;
const REDIRECT_LIMIT = 4;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export type WebReaderErrorCode = "URL_INVALID" | "URL_BLOCKED" | "PAGE_TOO_LARGE" | "CONTENT_UNSUPPORTED" | "CONTENT_EMPTY" | "UPSTREAM_ACCESS_REQUIRED" | "REDIRECT_LIMIT" | "FETCH_FAILED" | "FETCH_TIMEOUT";

export class WebReaderError extends ApiError {
  public readonly code: WebReaderErrorCode;
  public constructor(statusCode: number, message: string, code?: WebReaderErrorCode) {
    super(statusCode, message);
    const codes: Partial<Record<number, WebReaderErrorCode>> = { 400: "URL_INVALID", 403: "URL_BLOCKED", 413: "PAGE_TOO_LARGE", 415: "CONTENT_UNSUPPORTED", 422: "CONTENT_EMPTY", 504: "FETCH_TIMEOUT" };
    this.code = code ?? codes[statusCode] ?? "FETCH_FAILED";
  }
}

export interface WebReaderPage {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  /** Plain text only. Render as text, never as HTML or executable Markdown. */
  text: string;
  contentType: string;
  fetchedAt: string;
  truncated: boolean;
}

/** Reject special-use addresses, including IPv4-mapped IPv6 and transition networks. */
export function isPublicWebAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || address === "168.63.129.16"
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (version !== 6) return false;
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  const first = Number.parseInt(normalized.split(":")[0] ?? "0", 16);
  const second = Number.parseInt(normalized.split(":")[1] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}

export function validateWebUrl(input: string): URL {
  if (!input || input.length > 8192 || /[\u0000-\u0020\u007f]/.test(input)) throw new WebReaderError(400, "Enter a valid public HTTP or HTTPS URL.");
  let url: URL;
  try { url = new URL(input); } catch { throw new WebReaderError(400, "Enter a valid public HTTP or HTTPS URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) throw new WebReaderError(403, "Only public HTTP or HTTPS pages on standard ports can be read.");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || !host.includes(".") && !isIP(host) || /\.(?:localhost|local|internal|invalid|test|example)$/.test(host)) throw new WebReaderError(403, "Private or local addresses cannot be read.");
  if (isIP(host) && !isPublicWebAddress(host)) throw new WebReaderError(403, "Private or reserved addresses cannot be read.");
  for (const key of url.searchParams.keys()) {
    if (/(?:token|api[-_]?key|authorization|password|passwd|secret|credential|signature|session|cookie|^auth$|^key$|^code$|^sig$)/i.test(key)) throw new WebReaderError(403, "URLs containing credentials or session parameters cannot be read.");
  }
  url.hash = "";
  return url;
}

export interface WebPageResponse { status: number; headers: Record<string, string | undefined>; bytes: Buffer }
interface WebAddress { address: string; family: number }
export interface WebReaderDependencies {
  lookup: (hostname: string) => Promise<WebAddress[]>;
  request: (url: URL, address: WebAddress, signal: AbortSignal) => Promise<WebPageResponse>;
  timeoutMs?: number;
}

/** Connect to the validated address directly; preserve the logical Host and TLS name. */
export function pinnedWebRequestOptions(url: URL, address: WebAddress): RequestOptions & { servername?: string } {
  return { protocol: url.protocol, hostname: address.address, family: address.family, port: url.protocol === "https:" ? 443 : 80,
    ...(url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) ? { servername: url.hostname } : {}),
    method: "GET", path: `${url.pathname}${url.search}`, agent: false, maxHeaderSize: 16 * 1024,
    headers: { Host: url.host, Accept: "text/html, application/xhtml+xml, text/plain;q=0.8", "Accept-Encoding": "identity", "User-Agent": "OpenRigor-Reader/0.1" } };
}

export async function requestPinnedWebPage(url: URL, address: WebAddress, signal: AbortSignal): Promise<WebPageResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({ ...pinnedWebRequestOptions(url, address), signal }, (response) => {
      const headers: Record<string, string | undefined> = {};
      for (const key of ["location", "content-type", "content-encoding", "content-length"]) {
        const value = response.headers[key]; headers[key] = Array.isArray(value) ? value[0] : value;
      }
      const status = response.statusCode ?? 502;
      if (REDIRECT_CODES.has(status) || status < 200 || status >= 300) {
        response.destroy(); resolve({ status, headers, bytes: Buffer.alloc(0) }); return;
      }
      const length = Number(headers["content-length"] ?? 0);
      if (length > WEB_READER_LIMIT) { reject(new WebReaderError(413, "This page exceeds the 2 MiB reading limit.")); response.destroy(); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > WEB_READER_LIMIT) { reject(new WebReaderError(413, "This page exceeds the 2 MiB reading limit.")); response.destroy(); return; }
        chunks.push(chunk);
      });
      response.once("end", () => resolve({ status, headers, bytes: Buffer.concat(chunks) }));
      response.once("error", reject);
      response.once("aborted", () => reject(new WebReaderError(502, "The page connection ended before the content was received.")));
    });
    request.once("error", reject); request.end();
  });
}

function cleanText(input: string): string {
  return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractReadablePage(bytes: Buffer, contentType: string, url: URL): { title: string; text: string; truncated: boolean } {
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1] ?? "utf-8";
  let source: string;
  try { source = new TextDecoder(charset, { fatal: true }).decode(bytes); } catch { throw new WebReaderError(415, "This page uses an unsupported text encoding. Open the original page to read it."); }
  if (contentType.split(";")[0]?.trim().toLowerCase() === "text/plain") {
    const text = cleanText(source);
    if (!text) throw new WebReaderError(422, "This page contains no readable text.");
    return { title: url.hostname, text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
  }
  const document = new DOMParser().parseFromString(source, "text/html");
  if (document.querySelectorAll("*").length > 20_000) throw new WebReaderError(413, "This page is too complex for reading view. Open the original page.");
  const title = cleanText(document.querySelector("title")?.textContent ?? "").slice(0, 300);
  const accessGate = /(?:sign[ -]?in|log[ -]?in|access denied|just a moment|verify (?:that )?you are human|captcha|登录|登入|访问受限)/i.test(title);
  const paidContent = [...document.querySelectorAll('script[type="application/ld+json"]')].some((node) => /["']isAccessibleForFree["']\s*:\s*(?:false|["']false["'])/i.test(node.textContent ?? ""));
  if (accessGate || paidContent) throw new WebReaderError(422, "This page requires login, subscription, or browser verification. Open the original page.", "UPSTREAM_ACCESS_REQUIRED");
  const hasPassword = Boolean(document.querySelector('input[type="password"]'));
  for (const node of document.querySelectorAll("script,style,noscript,template,iframe,object,embed,svg,canvas,form,[hidden],[aria-hidden='true'],[inert]")) node.remove();
  for (const node of document.querySelectorAll("[style]")) if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(node.getAttribute("style") ?? "")) node.remove();
  let parsed: ReturnType<Readability["parse"]>;
  try { parsed = new Readability(document as unknown as Document, { maxElemsToParse: 20_000, charThreshold: 80, disableJSONLD: true }).parse(); } catch { throw new WebReaderError(422, "This page could not be extracted. Open the original page to read it."); }
  if (!parsed?.content) throw new WebReaderError(422, "No readable page text was found. This page may require JavaScript or sign-in.");
  const article = new DOMParser().parseFromString(`<html><body>${parsed.content}</body></html>`, "text/html");
  for (const node of article.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,section,article,tr,br")) node.appendChild(article.createTextNode("\n\n"));
  const text = cleanText(article.body.textContent ?? "");
  if (text.length < 60 || hasPassword && text.length < 700 || /^(?:enable javascript|please (?:sign in|log in)|sign in to continue|subscribe to (?:continue|read)|请先登录|登录后查看)/i.test(text)) throw new WebReaderError(422, "No accessible article text was found. The page may require JavaScript, login, or a subscription.");
  return { title: cleanText(parsed.title ?? title).slice(0, 300) || url.hostname, text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
}

const defaultDependencies: WebReaderDependencies = { lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }), request: requestPinnedWebPage };

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new WebReaderError(504, "The page took too long to respond. Open the original page or try again.");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new WebReaderError(504, "The page took too long to respond. Open the original page or try again."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function readPublicWebPage(input: string, dependencies: WebReaderDependencies = defaultDependencies): Promise<WebReaderPage> {
  const requested = validateWebUrl(input);
  let current = requested; const visited = new Set<string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= REDIRECT_LIMIT; redirects += 1) {
      if (visited.has(current.href)) throw new WebReaderError(502, "This page redirects in a loop. Open the original page.", "REDIRECT_LIMIT");
      visited.add(current.href);
      const hostname = current.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await bounded(dependencies.lookup(hostname), controller.signal);
      if (!addresses.length || addresses.some(({ address, family }) => !isPublicWebAddress(address) || isIP(address) !== family)) throw new WebReaderError(403, "This address resolves to a private or reserved network and cannot be read.");
      const response = await bounded(dependencies.request(current, addresses[0]!, controller.signal), controller.signal);
      if (REDIRECT_CODES.has(response.status)) {
        if (!response.headers.location || redirects === REDIRECT_LIMIT) throw new WebReaderError(502, "This page has too many or invalid redirects. Open the original page.", "REDIRECT_LIMIT");
        let target: string; try { target = new URL(response.headers.location, current).href; } catch { throw new WebReaderError(502, "This page returned an invalid redirect."); }
        current = validateWebUrl(target); continue;
      }
      if ([401, 402, 403, 429].includes(response.status)) throw new WebReaderError(422, "This page restricts automated reading or requires login or a subscription. Open the original page.", "UPSTREAM_ACCESS_REQUIRED");
      if (response.status < 200 || response.status >= 300) throw new WebReaderError(502, `The original site returned HTTP ${response.status}. Open the original page or try again.`);
      if (response.bytes.length > WEB_READER_LIMIT) throw new WebReaderError(413, "This page exceeds the 2 MiB reading limit.");
      const contentType = response.headers["content-type"] ?? "";
      if (!["text/html", "application/xhtml+xml", "text/plain"].includes(contentType.split(";")[0]?.trim().toLowerCase() ?? "")) throw new WebReaderError(415, "Reading view supports HTML and text pages. Open the original page for this file type.");
      let bytes = response.bytes;
      const encoding = response.headers["content-encoding"]?.trim().toLowerCase();
      if (encoding && encoding !== "identity") {
        const decompress = { gzip: gunzipSync, br: brotliDecompressSync, deflate: inflateSync }[encoding];
        if (!decompress) throw new WebReaderError(415, "This page uses an unsupported content encoding.");
        try { bytes = decompress(bytes, { maxOutputLength: WEB_READER_LIMIT }); } catch { throw new WebReaderError(413, "The compressed page is invalid or exceeds the reading limit."); }
      }
      const { title, text, truncated } = extractReadablePage(bytes, contentType, current);
      return { requestedUrl: requested.href, finalUrl: current.href, title, text, truncated, contentType: contentType.split(";")[0]!.trim().toLowerCase(), fetchedAt: new Date().toISOString() };
    }
    throw new WebReaderError(502, "This page could not be read.");
  } catch (error) {
    if (error instanceof WebReaderError) throw error;
    if (error instanceof ApiError) throw new WebReaderError(error.statusCode, error.message);
    if (controller.signal.aborted) throw new WebReaderError(504, "The page took too long to respond. Open the original page or try again.");
    throw new WebReaderError(502, "The page could not be reached. Open the original page or try again.");
  } finally { clearTimeout(timer); controller.abort(); }
}
