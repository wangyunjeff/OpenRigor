/**
 * A browser can retain a completed conversation after the in-memory API has
 * restarted. The next continuation then receives this one specific response.
 * Keep the fallback narrow so unrelated 404s still surface to the user.
 */
export function isStaleContinuationResponse(status: number, error: unknown): boolean {
  return status === 404
    && typeof error === "string"
    && error.trim().toLowerCase() === "continuefromrunid was not found";
}

export interface RunStartResponse {
  runId?: string;
  status?: "queued" | "running";
  conversationId?: string;
  rootRunId?: string;
  parentRunId?: string;
  error?: string;
}

export interface RunStartRequestResult {
  response: Response;
  body: RunStartResponse;
  continuationExpired: boolean;
}

interface RequestRunStartOptions {
  endpoint: string;
  body: Record<string, unknown>;
  continueFromRunId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function requestRunStart({
  endpoint,
  body,
  continueFromRunId,
  signal,
  fetchImpl = fetch
}: RequestRunStartOptions): Promise<RunStartRequestResult> {
  const post = async (continueConversation: boolean): Promise<Omit<RunStartRequestResult, "continuationExpired">> => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        ...(continueConversation && continueFromRunId !== undefined ? { continueFromRunId } : {})
      }),
      ...(signal === undefined ? {} : { signal })
    });
    return { response, body: await response.json() as RunStartResponse };
  };

  const first = await post(true);
  const continuationExpired = continueFromRunId !== undefined
    && isStaleContinuationResponse(first.response.status, first.body.error);
  if (!continuationExpired) return { ...first, continuationExpired: false };
  return { ...await post(false), continuationExpired: true };
}
