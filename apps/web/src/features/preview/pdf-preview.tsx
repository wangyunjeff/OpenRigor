import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowDownToLine, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Minus, Plus, RotateCcw } from "lucide-react";
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { readPdfPreviewBytes } from "./pdf-preview-data";
import "./pdf-preview.css";

// This entire module is lazy-loaded by FilePreview, including the library and worker URL.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
const MAX_CANVAS_SIDE = 8192;
const PDF_TIMEOUT_MS = 30_000;

// Let Vite retain and fingerprint PDF.js's own rendering resources. Resource names from
// a PDF can only select this build-time allowlist, never an arbitrary network URL.
const resourceUrls = import.meta.glob<string>([
  "/node_modules/pdfjs-dist/cmaps/*.bcmap",
  "/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  "/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm",
  "/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}_nowasm_fallback.js"
], { query: "?url", import: "default", eager: true });

function pdfBinaryDataFactory(signal: AbortSignal) {
  return class BundledPdfDataFactory {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const folder = kind === "cMapUrl" ? "cmaps" : kind === "standardFontDataUrl" ? "standard_fonts" : kind === "wasmUrl" ? "wasm" : undefined;
      const url = folder && resourceUrls[`/node_modules/pdfjs-dist/${folder}/${filename}`];
      if (!url) throw new Error("The PDF requires an unsupported rendering resource.");
      const response = await fetch(url, { signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("A PDF rendering resource could not be loaded.");
      return new Uint8Array(await response.arrayBuffer());
    }
  };
}

function pdfError(cause: unknown): string {
  if (cause instanceof Error && cause.name === "PasswordException") return "This PDF is password protected. Download the original to open it in your PDF app.";
  if (cause instanceof Error && cause.name === "InvalidPDFException") return "This PDF could not be read. Download the original to inspect it.";
  return cause instanceof Error ? cause.message : "The PDF could not be displayed. Download the original to inspect it.";
}

export default function PdfPreview({ url, name, downloadUrl }: { url: string; name: string; downloadUrl?: string }): ReactElement {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [rendering, setRendering] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const pageHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      void loadingTask?.destroy().catch(() => undefined);
      setError("The PDF took too long to load. Try reopening it, or download the original.");
    }, PDF_TIMEOUT_MS);
    setDocument(null); setPageNumber(1); setZoom(1); setError("");
    void readPdfPreviewBytes(url, controller.signal).then(async (data) => {
      if (controller.signal.aborted) return;
      // PDF.js >= 5.7 removed the eval compiler and isEvalSupported option.
      // Only page painting is used: no scripting manager, attachment or action execution.
      loadingTask = getDocument({
        data,
        enableXfa: false,
        useWorkerFetch: false,
        BinaryDataFactory: pdfBinaryDataFactory(controller.signal),
        maxImageSize: MAX_CANVAS_PIXELS,
        canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4
      });
      const loaded = await loadingTask.promise;
      if (!controller.signal.aborted) setDocument(loaded);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && !timedOut) {
        setError(pdfError(cause));
        void loadingTask?.destroy().catch(() => undefined);
      }
    }).finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
      void loadingTask?.destroy().catch(() => undefined);
    };
  }, [url]);

  useEffect(() => {
    const container = stage.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.floor(entry.contentRect.width)); });
    observer.observe(container);
    return () => observer.disconnect();
  }, [error]);

  useEffect(() => {
    const host = pageHost.current;
    if (!document || !host || width <= 0) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let canvas: HTMLCanvasElement | undefined;
    setRendering(true); setPageError("");
    void document.getPage(pageNumber).then(async (page) => {
      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      if (!(original.width > 0 && original.height > 0 && Number.isFinite(original.width) && Number.isFinite(original.height))) throw new Error("This PDF page has invalid dimensions.");
      const fitScale = Math.max(1, width - 36) / original.width;
      const viewport = page.getViewport({ scale: fitScale * zoom });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS_SIDE / viewport.width, MAX_CANVAS_SIDE / viewport.height, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${name}, page ${pageNumber} of ${document.numPages}`);
      renderTask = page.render({ canvas, viewport, transform: [outputScale, 0, 0, outputScale, 0, 0], annotationMode: AnnotationMode.ENABLE });
      await renderTask.promise;
      if (!cancelled) { host.replaceChildren(canvas); setRendering(false); }
    }).catch((cause: unknown) => {
      if (!cancelled) { setPageError(pdfError(cause)); setRendering(false); }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      // Each render owns a fresh canvas, so a cancelled page never overwrites its successor.
      if (canvas && canvas.parentNode !== host) { canvas.width = 0; canvas.height = 0; }
    };
  }, [document, pageNumber, zoom, width, name]);

  const download = downloadUrl ? <a className="file-preview-original" href={downloadUrl} download={name}><ArrowDownToLine aria-hidden="true" />Download original</a> : null;
  if (error) return <div className="file-preview-empty" role="alert"><CircleAlert aria-hidden="true" /><strong>Unable to preview this PDF</strong><span>{error}</span>{download}</div>;
  return <section className="file-pdf-reader" aria-label={`PDF preview: ${name}`}>
    <div className="file-pdf-toolbar" role="toolbar" aria-label="PDF controls">
      <div className="file-pdf-controls"><button type="button" aria-label="Previous PDF page" title="Previous page" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}><ChevronLeft aria-hidden="true" /></button><span className="file-pdf-page-number" aria-live="polite">{document ? `${pageNumber} / ${document.numPages}` : "— / —"}</span><button type="button" aria-label="Next PDF page" title="Next page" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber((page) => page + 1)}><ChevronRight aria-hidden="true" /></button></div>
      <div className="file-pdf-controls"><button type="button" aria-label="Zoom PDF out" title="Zoom out" disabled={!document || zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .25))}><Minus aria-hidden="true" /></button><button type="button" className="file-pdf-zoom" aria-label="Fit PDF page to width" title="Fit to width" disabled={!document} onClick={() => setZoom(1)}>{zoom === 1 ? <><RotateCcw aria-hidden="true" /><span>Fit</span></> : `${Math.round(zoom * 100)}%`}</button><button type="button" aria-label="Zoom PDF in" title="Zoom in" disabled={!document || zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + .25))}><Plus aria-hidden="true" /></button></div>
    </div>
    <div ref={stage} className="file-pdf-stage" aria-busy={!document || rendering}>
      <div ref={pageHost} className="file-pdf-page" data-loading={rendering || Boolean(pageError)} />
      {!document || rendering ? <div className="file-pdf-status" role="status"><LoaderCircle className="file-preview-spinner" aria-hidden="true" /><span>{document ? "Rendering page…" : "Loading PDF…"}</span></div> : null}
      {pageError ? <div className="file-preview-empty" role="alert"><CircleAlert aria-hidden="true" /><strong>Unable to display this page</strong><span>{pageError}</span>{download}</div> : null}
    </div>
  </section>;
}
