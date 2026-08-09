import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { RunEvent, RunSnapshot } from "@openrigor/protocol";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8787";
const eventTypes: RunEvent["type"][] = [
  "snapshot",
  "status",
  "part",
  "part-delta",
  "tool",
  "file",
  "subagent",
  "run-finished",
  "error"
];

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function eventLabel(event: RunEvent): string {
  if (event.type === "status") return `${event.status}${event.currentStep ? ` · ${event.currentStep}` : ""}`;
  if (event.type === "part-delta") return `text delta: ${event.delta}`;
  if (event.type === "part") return `${event.part.kind}: ${event.part.text}`;
  if (event.type === "tool") return `${event.tool.name} · ${event.tool.phase}`;
  if (event.type === "run-finished") return `finished: ${event.status}`;
  if (event.type === "error") return `${event.code}: ${event.message}`;
  if (event.type === "file") return `file: ${event.file.name}`;
  if (event.type === "subagent") return `subagent: ${event.subagent.label} · ${event.subagent.status}`;
  return "snapshot";
}

export function App(): ReactElement {
  const [prompt, setPrompt] = useState("Inspect the OpenRigor architecture and suggest the next implementation step.");
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [error, setError] = useState<string | null>(null);
  const eventSource = useRef<EventSource | null>(null);

  useEffect(() => () => eventSource.current?.close(), []);

  const answer = useMemo(() => {
    let text = "";
    for (const event of events) {
      if (event.type === "part-delta" && event.partId === "answer") text += event.delta;
    }
    return text;
  }, [events]);

  function closeStream(): void {
    eventSource.current?.close();
    eventSource.current = null;
    setConnection("closed");
  }

  function consumeEvent(event: RunEvent): void {
    setEvents((previous) => {
      if (previous.some((item) => item.eventId === event.eventId)) return previous;
      return [...previous, event];
    });
    if (event.type === "snapshot") setSnapshot(event.snapshot);
    if (event.type === "status") {
      setSnapshot((previous) => {
        if (!previous) return previous;
        const next: RunSnapshot = { ...previous, status: event.status, progress: event.progress ?? previous.progress, updatedAt: event.ts };
        if (event.currentStep !== undefined) next.currentStep = event.currentStep;
        return next;
      });
    }
    if (event.type === "run-finished") {
      setSnapshot((previous) => previous ? { ...previous, status: event.status, progress: event.status === "completed" ? 100 : previous.progress, currentStep: event.status === "completed" ? "Completed" : event.status === "cancelled" ? "Cancelled" : "Failed", updatedAt: event.ts } : previous);
      closeStream();
    }
  }

  function subscribe(runId: string): void {
    closeStream();
    setConnection("connecting");
    const source = new EventSource(`${apiBase}/api/runs/${runId}/events`);
    eventSource.current = source;
    source.onopen = () => setConnection("open");
    source.onerror = () => setConnection("closed");
    for (const type of eventTypes) {
      source.addEventListener(type, (raw) => {
        try {
          consumeEvent(JSON.parse((raw as MessageEvent<string>).data) as RunEvent);
        } catch {
          setError("Received an invalid event payload");
        }
      });
    }
  }

  async function startRun(): Promise<void> {
    setError(null);
    closeStream();
    setSnapshot(null);
    setEvents([]);
    try {
      const response = await fetch(`${apiBase}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: "auto", mode: "standard", effort: "balanced" })
      });
      const body = (await response.json()) as { runId?: string; error?: string };
      if (!response.ok || !body.runId) throw new Error(body.error ?? "Could not start run");
      subscribe(body.runId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start run");
    }
  }

  async function cancelRun(): Promise<void> {
    if (!snapshot) return;
    await fetch(`${apiBase}/api/runs/${snapshot.runId}/cancel`, { method: "POST" });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">OPENRIGOR / PHASE 0</p>
          <h1>Run console</h1>
        </div>
        <div className={`connection connection-${connection}`}><span className="dot" /> {connection}</div>
      </header>

      <section className="workspace">
        <div className="composer panel">
          <label htmlFor="prompt">Task prompt</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} />
          <div className="composer-footer">
            <span className="muted">Demo executor · no user code is executed</span>
            <div className="actions">
              <button className="secondary" type="button" onClick={cancelRun} disabled={!snapshot || snapshot.status === "completed" || snapshot.status === "cancelled" || snapshot.status === "failed"}>Cancel</button>
              <button className="primary" type="button" onClick={() => void startRun()} disabled={!prompt.trim()}>Start run</button>
            </div>
          </div>
        </div>

        <div className="run-grid">
          <section className="panel status-panel">
            <div className="panel-heading"><h2>Run state</h2><span className="run-id">{snapshot?.runId ?? "No run"}</span></div>
            {snapshot ? <>
              <div className="status-line"><strong>{snapshot.status}</strong><span>{snapshot.progress}%</span></div>
              <div className="progress"><span style={{ width: `${snapshot.progress}%` }} /></div>
              <p className="step">{snapshot.currentStep ?? "Waiting for worker"}</p>
            </> : <p className="empty">Start a task to open a durable run stream.</p>}
            <div className="answer"><h3>Answer stream</h3><p>{answer || "Waiting for text events..."}</p></div>
          </section>

          <section className="panel timeline-panel">
            <div className="panel-heading"><h2>Event log</h2><span className="run-id">{events.length} events</span></div>
            <div className="timeline">
              {events.length === 0 ? <p className="empty">Typed events will appear here and can be replayed after reconnect.</p> : events.map((event) => <div className={`event event-${event.type}`} key={event.eventId}>
                <div className="event-meta"><span>#{event.sequence} · {event.type}</span><time>{formatTime(event.ts)}</time></div>
                <p>{eventLabel(event)}</p>
              </div>)}
            </div>
          </section>
        </div>
      </section>

      {error ? <div className="toast" role="alert">{error}</div> : null}
    </main>
  );
}
