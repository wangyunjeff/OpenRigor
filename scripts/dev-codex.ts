import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

const workspace = resolve(process.env.OPENRIGOR_CODEX_CWD ?? process.argv[2] ?? process.cwd());
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const sharedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  OPENRIGOR_EXECUTOR: "codex-app-server",
  OPENRIGOR_CODEX_CWD: workspace,
  OPENRIGOR_CODEX_SANDBOX: process.env.OPENRIGOR_CODEX_SANDBOX ?? "workspace-write",
  OPENRIGOR_CODEX_APPROVAL_POLICY: process.env.OPENRIGOR_CODEX_APPROVAL_POLICY ?? "on-request"
};

const children = new Set<ChildProcess>();
let stopping = false;

function launch(script: "build:protocol" | "dev:api" | "dev:web"): ChildProcess {
  const args = script === "build:protocol"
    ? ["--filter", "@openrigor/protocol", "build"]
    : script === "dev:api"
      ? ["--filter", "@openrigor/api", "exec", "tsx", "watch", "src/server.ts"]
      : ["--filter", "@openrigor/web", "exec", "vite", "--host", "127.0.0.1", "--port", "5173"];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: sharedEnv,
    stdio: "inherit",
    windowsHide: false,
    // Own the whole pnpm -> shell -> watcher process tree on Unix so a
    // restart releases both ports and the durable-store lock.
    detached: process.platform !== "win32",
    // Recent Node.js releases require Windows batch launchers such as
    // pnpm.cmd to be resolved through the command shell.
    ...(process.platform === "win32" ? { shell: true } : {})
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    if (script === "build:protocol" && code === 0 && !signal) {
      launch("dev:api");
      launch("dev:web");
      return;
    }
    stopping = true;
    for (const sibling of children) stopChild(sibling);
    if (signal) console.error(`${script} stopped by ${signal}`);
    process.exitCode = code ?? 1;
  });
  return child;
}

function stopChild(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    killer.once("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGTERM");
  }
}

console.log(`OpenRigor Codex workspace: ${workspace}`);
console.log(`Sandbox: ${sharedEnv.OPENRIGOR_CODEX_SANDBOX}`);
console.log("Starting API and web UI at http://127.0.0.1:5173");

// Both individual dev scripts build the protocol. Doing that concurrently
// rewrites the same files after the API watcher has started and can interrupt
// the first request. Build once before starting either watcher instead.
launch("build:protocol");

function shutdown(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopChild(child);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
