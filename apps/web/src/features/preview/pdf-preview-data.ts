export const MAX_PDF_PREVIEW_BYTES = 32 * 1024 * 1024;

/** Read a bounded response before handing bytes to PDF.js's parser worker. */
export async function readPdfPreviewBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal, headers: { Accept: "application/pdf" }, credentials: "same-origin" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("The PDF could not be loaded. Download the original to inspect it.");
  }
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_PDF_PREVIEW_BYTES) {
    await response.body?.cancel();
    throw new Error("This PDF exceeds the 32 MB preview limit. Download the original to view it.");
  }
  if (!response.body) throw new Error("The PDF response did not include readable content.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_PREVIEW_BYTES) {
        await reader.cancel();
        throw new Error("This PDF exceeds the 32 MB preview limit. Download the original to view it.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  if (!new TextDecoder("ascii").decode(data.subarray(0, 1024)).includes("%PDF-")) throw new Error("This file does not contain a readable PDF document.");
  return data;
}
