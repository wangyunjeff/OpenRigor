# Infrastructure notes

`docker-compose.dev.yml` provides local PostgreSQL, Redis, and MinIO for the M1 migration. The current API does not require them; start the stack when implementing persistence.

Production should be deployed as separate control-plane and worker planes. A managed PostgreSQL/Redis/object store is acceptable for the first region. Sandbox workers need a separately reviewed gVisor/Kubernetes or Firecracker boundary, network policy, resource quota, image provenance, and patch process. Do not expose the local MinIO credentials or bind a production sandbox to the Docker socket.

Suggested first-region topology:

```text
TLS edge -> web CDN
        -> API replicas -> PostgreSQL primary + read replica
                        -> queue / event bus
                        -> object storage
queue -> worker pool -> sandbox pool -> egress proxy
```
