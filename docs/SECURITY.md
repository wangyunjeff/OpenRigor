# Security and clean-room boundary

## Product boundary

OpenRigor accepts untrusted prompts and, eventually, untrusted files and code. The API process is a control-plane component and must never execute arbitrary user commands. All tool execution belongs in a separately managed sandbox.

## Required controls before production

- Tenant and workspace authorization on every read and write.
- Short-lived, scoped worker capabilities; no long-lived provider keys in a workspace.
- SSRF protection for browser/search tools and blocked cloud metadata endpoints.
- CPU, memory, process-count, disk, wall-clock, and output-size limits.
- Egress allow-list or audited proxy; no host socket or control-plane network path.
- MIME sniffing, size limits, malware-scan hook, and isolated artifact preview origin.
- Append-only audit records for prompts, tool calls, policy decisions, and provider request IDs.
- Secret redaction in events, logs, traces, downloads, and error messages.
- Retention, export, deletion, and backup-restore procedures per region.

## Clean-room implementation rules

1. Treat public behavior as requirements, not as source code to copy.
2. Write original implementation, naming, copy, design tokens, and assets.
3. Keep research URLs and observations in docs, separate from production code.
4. Review third-party package licenses before shipping; preserve notices.
5. Do not ship ClawsGO/AICSS marks or imply affiliation.

This is engineering guidance, not legal advice. A counsel review is required before commercial launch.
