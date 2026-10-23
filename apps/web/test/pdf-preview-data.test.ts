import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PDF_PREVIEW_BYTES, readPdfPreviewBytes } from "../src/features/preview/pdf-preview-data";

test("PDF preview preserves bytes across streamed chunks and forwards cancellation", async (t) => {
  const controller = new AbortController();
  const bytes = new TextEncoder().encode("%PDF-1.7\nexample PDF bytes");
  const stream = new ReadableStream<Uint8Array>({ start(output) {
    output.enqueue(bytes.slice(0, 2)); output.enqueue(bytes.slice(2)); output.close();
  } });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/verified-preview");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.credentials, "same-origin");
    return new Response(stream);
  });
  assert.deepEqual(await readPdfPreviewBytes("/verified-preview", controller.signal), bytes);
});

test("PDF preview rejects an oversized Content-Length before reading the body", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { headers: { "Content-Length": String(MAX_PDF_PREVIEW_BYTES + 1) } }));
  await assert.rejects(readPdfPreviewBytes("/large", new AbortController().signal), /32 MB preview limit/);
  assert.equal(cancelled, true);
});

test("PDF preview enforces the byte limit when the server omits Content-Length", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(output) { output.enqueue(new Uint8Array(MAX_PDF_PREVIEW_BYTES)); output.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; }
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream));
  await assert.rejects(readPdfPreviewBytes("/stream", new AbortController().signal), /32 MB preview limit/);
  assert.equal(cancelled, true);
});

test("PDF preview rejects an HTML or JSON error body returned with HTTP 200", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<!doctype html><title>Not a PDF</title>"));
  await assert.rejects(readPdfPreviewBytes("/not-pdf", new AbortController().signal), /does not contain a readable PDF/);
});

test("PDF preview does not return bytes after file selection is cancelled", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); return new Response("%PDF-1.7\nlate result"); });
  await assert.rejects(readPdfPreviewBytes("/cancelled", controller.signal), { name: "AbortError" });
});

test("PDF preview rejects an unsuccessful response without exposing its body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("private server details", { status: 403 }));
  await assert.rejects(readPdfPreviewBytes("/denied", new AbortController().signal), /^Error: The PDF could not be loaded/);
});
