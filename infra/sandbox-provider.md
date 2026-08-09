# Sandbox provider contract (planned)

The worker should depend on an interface, not on a container runtime. A provider implementation must be able to create a workspace, execute a bounded tool call, stream stdout/stderr, upload artifacts, and destroy the workspace.

Minimum contract:

```ts
interface SandboxProvider {
  create(input: { workspaceId: string; policy: ToolPolicy }): Promise<SandboxHandle>;
  exec(handle: SandboxHandle, command: string, options: ExecOptions): AsyncIterable<ExecChunk>;
  readFile(handle: SandboxHandle, path: string): Promise<Uint8Array>;
  writeFile(handle: SandboxHandle, path: string, content: Uint8Array): Promise<void>;
  destroy(handle: SandboxHandle): Promise<void>;
}
```

The fake provider used in tests must enforce the same path and resource rules as the real provider. A “works on Docker” demo is not evidence of isolation.
