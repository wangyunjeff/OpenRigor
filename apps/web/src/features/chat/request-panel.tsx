import { useEffect, useState, type ReactElement } from "react";
import type { RunSnapshot } from "@openrigor/protocol";
import { Check, CircleAlert, MessageCircleQuestion, ShieldCheck, X } from "lucide-react";
import { workspaceRequest, describeApiError } from "../workspace/api";
import "./request-panel.css";

interface InputQuestion {
  id: string;
  header: string;
  question: string;
  options?: { label: string; description?: string }[];
}

interface PendingRequest {
  id: string;
  kind: "approval" | "question";
  title: string;
  description?: string;
  questions?: InputQuestion[];
}

function RequestCard({ request, runId, onResolved }: { request: PendingRequest; runId: string; onResolved: (id: string) => void }): ReactElement {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isQuestion = request.kind === "question";

  async function resolve(body: { decision: "accept" | "decline" } | { answers: Record<string, string> }): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await workspaceRequest(`/api/runs/${encodeURIComponent(runId)}/requests/${encodeURIComponent(request.id)}`, { method: "POST", body });
      onResolved(request.id);
    } catch (cause) {
      setError(describeApiError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <form className="run-request-card" onSubmit={(event) => {
    event.preventDefault();
    void resolve(isQuestion ? { answers } : { decision: "accept" });
  }}>
    <div className="run-request-heading">{isQuestion ? <MessageCircleQuestion aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}<strong>{request.title}</strong><span>Waiting for you</span></div>
    {request.description ? <pre className="run-request-description">{request.description}</pre> : null}
    {isQuestion ? request.questions?.map((question) => <fieldset key={question.id} disabled={busy}>
      <legend>{question.header ? <small>{question.header}</small> : null}{question.question}</legend>
      {question.options?.length ? <div className="run-request-options">{question.options.map((option) => <label key={option.label} className={answers[question.id] === option.label ? "selected" : ""}>
        <input type="radio" name={`${request.id}-${question.id}`} value={option.label} checked={answers[question.id] === option.label} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))} />
        <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
      </label>)}</div> : null}
      <textarea aria-label={question.options?.length ? `Custom answer: ${question.header || question.question}` : question.header || question.question} placeholder={question.options?.length ? "Or write your own answer…" : "Your answer…"} value={question.options?.some((option) => option.label === answers[question.id]) ? "" : answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} rows={2} />
    </fieldset>) : null}
    {error ? <p className="run-request-error" role="alert"><CircleAlert aria-hidden="true" />{error}</p> : null}
    <div className="run-request-actions">
      <button type="button" disabled={busy} onClick={() => void resolve({ decision: "decline" })}><X aria-hidden="true" />{isQuestion ? "Skip" : "Decline"}</button>
      <button type="submit" className="primary" disabled={busy || (isQuestion && Boolean(request.questions?.some((question) => !answers[question.id]?.trim())))}><Check aria-hidden="true" />{busy ? "Sending…" : isQuestion ? "Continue" : "Allow once"}</button>
    </div>
  </form>;
}

export function RunRequestPanel({ runId, status }: { runId: string; status: RunSnapshot["status"] }): ReactElement | null {
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRequests([]);
    setError("");
    if (status !== "waiting_user") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh(): Promise<void> {
      try {
        const result = await workspaceRequest<{ requests: PendingRequest[] }>(`/api/runs/${encodeURIComponent(runId)}/requests`, { signal: controller.signal });
        if (!stopped) {
          setRequests(result.requests);
          setError("");
        }
      } catch (cause) {
        if (!stopped) setError(describeApiError(cause));
      } finally {
        if (!stopped) timer = setTimeout(() => void refresh(), 2500);
      }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [runId, status, retry]);
  if (status !== "waiting_user") return null;
  return <div className="run-request-panel" aria-live="polite">
    {requests.map((request) => <RequestCard key={request.id} request={request} runId={runId} onResolved={(id) => setRequests((current) => current.filter((item) => item.id !== id))} />)}
    {error ? <div className="run-request-error" role="alert"><CircleAlert aria-hidden="true" /><span>{error}</span><button type="button" onClick={() => setRetry((current) => current + 1)}>Retry</button></div> : null}
  </div>;
}
