import { usePreview } from "../features/preview/preview-context";
import type { Components } from "streamdown";
import { useState } from "react";
import { describeApiError, downloadWorkspaceFile, workspaceApiBase } from "../features/workspace/api";
import { artifactDownloadFilename, resolveArtifactUrl } from "../features/chat/ai-elements-adapter";

async function downloadRunArtifact(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download this file (${response.status}).`);
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = artifactDownloadFilename(response.headers.get("Content-Disposition"));
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

const ArtifactAwareLink: NonNullable<Components["a"]> = ({ node: _node, href, children, ...props }) => {
  const preview = usePreview();
  const [error, setError] = useState("");
  let downloadName: string | undefined;
  let runArtifactUrl: string | undefined;
  try {
    const url = new URL(href ?? "", window.location.href);
    if (resolveArtifactUrl(href, workspaceApiBase) && (url.pathname === "/api/files/download" || /^\/api\/runs\/[^/]+\/files\/[^/]+$/.test(url.pathname))) {
      if (url.pathname === "/api/files/download") downloadName = url.searchParams.get("path")?.split("/").at(-1) || "artifact";
      else runArtifactUrl = resolveArtifactUrl(href, workspaceApiBase);
    }
  } catch { /* Normal Markdown links retain their original behavior. */ }
  return <><a {...props} href={href} target={downloadName || runArtifactUrl ? undefined : "_blank"} rel="noreferrer" onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (href && preview?.openHref(href, event.currentTarget.textContent ?? undefined)) { event.preventDefault(); return; }
    if (!downloadName && !runArtifactUrl) return;
    event.preventDefault();
    setError("");
    const request = runArtifactUrl ? downloadRunArtifact(runArtifactUrl) : downloadWorkspaceFile(href!, downloadName!);
    void request.catch((cause: unknown) => setError(describeApiError(cause)));
  }}>{children}</a>{error ? <span role="alert" className="run-request-error">{error}</span> : null}</>;
};

export const streamdownComponents: Components = {
  a: ArtifactAwareLink
};
