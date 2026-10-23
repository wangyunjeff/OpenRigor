import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUpRight, Check, CheckCircle2, CircleAlert, Clock3, Folder, LoaderCircle, MoreHorizontal, Pencil, Pin, RefreshCw, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { conversationTitle, describeApiError, formatRelativeTime, workspaceRequest, type WorkspaceConversation, type WorkspaceProject } from "./api";
import { patchTaskList, selectTasks, standaloneTaskScope, taskCollectionCounts, taskPromptExcerpt, taskSearchPath, taskStatusLabel, type TaskSort, type TaskStatusFilter, type TaskView } from "./task-surface-model";
import "./task-surface.css";

export interface TaskSurfaceProps {
  conversations: WorkspaceConversation[];
  projects?: Pick<WorkspaceProject, "id" | "name">[];
  projectId?: string;
  onOpenRun: (runId: string) => void | Promise<void>;
  onChanged?: () => void;
  compact?: boolean;
}

interface TaskResult { key: string; rows: WorkspaceConversation[] }

/** The server owns full-text matching; local filters never pretend to search answer text. */
export function TaskSurface({ conversations, projects = [], projectId, onOpenRun, onChanged, compact = false }: TaskSurfaceProps): ReactElement {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TaskView>("tasks");
  const [status, setStatus] = useState<TaskStatusFilter>("all");
  const [scope, setScope] = useState("");
  const [sort, setSort] = useState<TaskSort>("recent");
  const [result, setResult] = useState<TaskResult>({ key: "", rows: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [opening, setOpening] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<WorkspaceConversation | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const requestRef = useRef(0);
  const fetchAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const normalizedQuery = query.trim();
  const requestKey = `${projectId ?? ""}\u0000${normalizedQuery}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestRef.current += 1; fetchAbort.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchAbort.current?.abort();
    fetchAbort.current = controller;
    const requestId = ++requestRef.current;
    setLoading(true); setError("");
    const timeout = window.setTimeout(() => {
      void workspaceRequest<{ conversations: WorkspaceConversation[] }>(taskSearchPath(normalizedQuery, projectId), { signal: controller.signal }).then((response) => {
        if (controller.signal.aborted || requestId !== requestRef.current) return;
        if (!Array.isArray(response.conversations)) throw new Error("The task list could not be read. Please retry.");
        setResult({ key: requestKey, rows: response.conversations });
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted && requestId === requestRef.current) setError(describeApiError(cause));
      }).finally(() => {
        if (!controller.signal.aborted && requestId === requestRef.current) setLoading(false);
      });
    }, normalizedQuery ? 180 : 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [normalizedQuery, projectId, requestKey, version, conversations]);

  const hasCurrentResult = result.key === requestKey;
  const ready = hasCurrentResult && !loading && !error;
  const visible = useMemo(() => selectTasks(result.rows, { view, status, scope: projectId ?? scope, sort }), [result.rows, view, status, projectId, scope, sort]);
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const hasFilters = status !== "all" || Boolean(scope) || normalizedQuery !== "";
  const counts = useMemo(() => taskCollectionCounts(result.rows, { status, scope: projectId ?? scope }), [result.rows, status, projectId, scope]);

  function resetFilters(): void { setQuery(""); setStatus("all"); setScope(""); searchRef.current?.focus(); }

  async function patch(item: WorkspaceConversation, value: { title?: string; pinned?: boolean; archived?: boolean }): Promise<void> {
    if (pendingRef.current.has(item.rootRunId)) return;
    pendingRef.current.add(item.rootRunId); setPending([...pendingRef.current]); setOperationError("");
    // A pre-mutation search response must never overwrite a confirmed metadata change.
    requestRef.current += 1; fetchAbort.current?.abort();
    try {
      const response = await workspaceRequest<{ conversation?: Partial<WorkspaceConversation> }>(`/api/conversations/${encodeURIComponent(item.rootRunId)}`, { method: "PATCH", body: value });
      if (!mounted.current) return;
      setResult((current) => ({ ...current, rows: patchTaskList(current.rows, item.rootRunId, { ...response.conversation, ...value }) }));
      setAnnouncement(value.archived === true ? "Task moved to Archived. You can restore it there." : value.archived === false ? "Task restored." : value.title ? "Task renamed." : value.pinned ? "Task pinned." : "Task unpinned.");
      if (value.title) setRenaming(null);
      onChanged?.();
    } catch (cause: unknown) {
      if (mounted.current) setOperationError(describeApiError(cause));
    } finally {
      pendingRef.current.delete(item.rootRunId);
      if (mounted.current) { setPending([...pendingRef.current]); setVersion((value) => value + 1); }
    }
  }

  async function open(item: WorkspaceConversation): Promise<void> {
    if (opening) return;
    setOpening(item.rootRunId); setOperationError("");
    try { await onOpenRun(item.latestRunId); }
    catch (cause: unknown) { if (mounted.current) setOperationError(describeApiError(cause)); }
    finally { if (mounted.current) setOpening(null); }
  }

  return <section className={`task-surface${compact ? " is-compact" : ""}`} aria-label={projectId ? "Project tasks" : "Task library"}>
    {!compact ? <div className="task-surface-heading"><div><span className="task-surface-eyebrow">YOUR RESEARCH, WITHIN REACH</span><h2>Find your next thread.</h2><p>Search task names, prompts, and saved answers.</p></div><span className="task-surface-heading-icon" aria-hidden="true"><Search /></span></div> : null}
    <div className="task-surface-search-row"><label className="task-surface-search"><Search aria-hidden="true" /><input ref={searchRef} autoFocus={!compact} aria-label={projectId ? "Search project tasks" : "Search all tasks"} placeholder={projectId ? "Search this project's tasks…" : "Search tasks and answers…"} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); }
      if (event.key === "ArrowDown" && ready && visible.length) { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>(".task-surface-open")?.focus(); }
    }} />{query ? <button type="button" aria-label="Clear task search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X aria-hidden="true" /></button> : <span className="task-surface-search-hint" aria-hidden="true"><ArrowDown /></span>}</label><button type="button" className="task-surface-refresh" aria-label="Refresh tasks" title="Refresh tasks" disabled={loading} onClick={() => setVersion((value) => value + 1)}><RefreshCw className={loading ? "task-surface-spin" : ""} aria-hidden="true" /></button></div>
    <div className="task-surface-tools"><div className="task-surface-views" role="group" aria-label="Task collection">{([ ["tasks", "Tasks", counts.tasks], ["pinned", "Pinned", counts.pinned], ["archived", "Archived", counts.archived] ] as const).map(([id, label, count]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{id === "pinned" ? <Pin aria-hidden="true" /> : id === "archived" ? <Archive aria-hidden="true" /> : null}{label}{ready ? <span>{count}</span> : null}</button>)}</div><div className="task-surface-filters"><label><span className="sr-only">Task status</span><select aria-label="Task status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatusFilter)}><option value="all">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="attention">Needs attention</option></select></label>{!projectId && projects.length ? <label><span className="sr-only">Task project</span><select aria-label="Task project" value={scope} onChange={(event) => setScope(event.target.value)}><option value="">All projects</option><option value={standaloneTaskScope}>Standalone</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label> : null}<label><span className="sr-only">Sort tasks</span><select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}><option value="recent">Recent first</option><option value="oldest">Oldest first</option><option value="title">Name A–Z</option></select></label></div></div>
    <div className="task-surface-result-meta" role="status" aria-live="polite"><span>{loading ? hasCurrentResult ? "Updating your saved work…" : "Searching your saved work…" : error ? "Task list unavailable" : result.key !== requestKey ? "Searching your saved work…" : `${visible.length} ${visible.length === 1 ? "task" : "tasks"}${normalizedQuery ? " found" : ""}`}</span>{ready && hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : <span className="task-surface-result-note">{view === "archived" ? "Archived tasks can be restored" : sort === "recent" ? "Pinned tasks stay on top" : sort === "oldest" ? "Ordered by oldest update" : "Ordered by task name"}</span>}</div>
    {operationError ? <div className="task-surface-error" role="alert"><CircleAlert aria-hidden="true" /><span>{operationError}</span><button type="button" aria-label="Dismiss task error" onClick={() => setOperationError("")}><X /></button></div> : null}
    <div className="task-surface-results" aria-busy={loading}>
      {loading && !hasCurrentResult ? <div className="task-surface-loading" role="status"><LoaderCircle className="task-surface-spin" aria-hidden="true" /><span>Searching saved tasks</span></div> : error ? <div className="task-surface-empty"><CircleAlert aria-hidden="true" /><h3>We couldn't load your tasks</h3><p>{error}</p><button type="button" onClick={() => setVersion((value) => value + 1)}><RefreshCw />Retry search</button></div> : result.key !== requestKey ? <div className="task-surface-loading" role="status"><LoaderCircle className="task-surface-spin" aria-hidden="true" /><span>Preparing task search</span></div> : visible.length ? <ul ref={listRef} className="task-surface-list">{visible.map((item) => {
        const title = conversationTitle(item); const isPending = pending.includes(item.rootRunId); const isOpening = opening === item.rootRunId;
        const active = ["running", "waiting_tool"].includes(item.status);
        return <li key={item.rootRunId} className="task-surface-item" data-state={item.status}><button type="button" className="task-surface-open" disabled={Boolean(opening)} onClick={() => { void open(item); }} aria-label={`Open task: ${title}`}><span className={`task-surface-state-icon${active ? " is-active" : ""}`}>{isOpening || active ? <LoaderCircle className={isOpening || active ? "task-surface-spin" : ""} /> : item.status === "completed" ? <CheckCircle2 /> : item.status === "failed" || item.status === "waiting_user" ? <CircleAlert /> : <Clock3 />}</span><span className="task-surface-copy"><span className="task-surface-title">{item.pinned ? <Pin aria-label="Pinned" /> : null}<strong>{title}</strong></span><span className="task-surface-excerpt">{taskPromptExcerpt(item.prompt)}</span><span className="task-surface-row-meta"><span className="task-surface-status">{taskStatusLabel(item.status)}</span><span aria-hidden="true">·</span><time dateTime={item.updatedAt} title={new Date(item.updatedAt).toLocaleString()}>{formatRelativeTime(item.updatedAt)}</time>{!projectId ? <><span aria-hidden="true">·</span><span className="task-surface-project"><Folder />{item.projectId ? projectNames.get(item.projectId) ?? "Project" : "Standalone"}</span></> : null}</span></span><ArrowUpRight className="task-surface-open-arrow" aria-hidden="true" /></button><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="task-surface-more" disabled={isPending} aria-label={`Task actions: ${title}`}>{isPending ? <LoaderCircle className="task-surface-spin" /> : <MoreHorizontal />}</button></DropdownMenuTrigger><DropdownMenuContent className="task-surface-menu" align="end" sideOffset={6}><DropdownMenuItem onSelect={() => { setRenaming(item); setRenameTitle(title); setOperationError(""); }}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem onSelect={() => { void patch(item, { pinned: !item.pinned }); }}><Pin />{item.pinned ? "Unpin task" : "Pin task"}</DropdownMenuItem><DropdownMenuItem onSelect={() => { void patch(item, { archived: !item.archived }); }}>{item.archived ? <ArchiveRestore /> : <Archive />}{item.archived ? "Restore task" : "Archive task"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></li>;
      })}</ul> : <div className="task-surface-empty">{view === "archived" ? <Archive /> : view === "pinned" ? <Pin /> : <Search />}<h3>{normalizedQuery || hasFilters ? "No matching tasks" : view === "archived" ? "Nothing archived" : view === "pinned" ? "Keep useful work close" : "Your work starts here"}</h3><p>{normalizedQuery || hasFilters ? "Try a different phrase or clear a filter. Search includes saved answers." : view === "archived" ? "Tasks you archive will appear here. Their conversation and files are preserved." : view === "pinned" ? "Pin a task from its actions menu to find it again quickly." : "New conversations will appear here as you work."}</p>{hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : null}</div>}
    </div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    <Dialog open={Boolean(renaming)} onOpenChange={(open) => { if (!open && !pending.includes(renaming?.rootRunId ?? "")) { setRenaming(null); setOperationError(""); } }}><DialogContent className="task-surface-rename-dialog"><DialogTitle>Rename task</DialogTitle><DialogDescription>Choose a name that helps you return to this work.</DialogDescription><form onSubmit={(event) => { event.preventDefault(); if (renaming && renameTitle.trim()) void patch(renaming, { title: renameTitle.trim() }); }}><label>Task name<input autoFocus required maxLength={200} value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} disabled={pending.includes(renaming?.rootRunId ?? "")} /></label>{operationError ? <p className="task-surface-rename-error" role="alert">{operationError}</p> : null}<div><button type="button" disabled={pending.includes(renaming?.rootRunId ?? "")} onClick={() => setRenaming(null)}>Cancel</button><button type="submit" disabled={!renameTitle.trim() || pending.includes(renaming?.rootRunId ?? "")} className="is-primary">{pending.includes(renaming?.rootRunId ?? "") ? <LoaderCircle className="task-surface-spin" /> : <Check />}Save name</button></div></form></DialogContent></Dialog>
  </section>;
}
