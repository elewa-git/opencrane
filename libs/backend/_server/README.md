# _server — OpenCrane server runtime seams

> [OpenCrane](../../../README.md) › [backend](../README.md) › _server

These libraries provide the OpenCrane API process with transport and external-I/O seams. They keep
HTTP, OIDC, Kubernetes identity, and remote-custody mechanics outside durable backend domains while
remaining grouped with the server code that composes them.

## Map

| Package | What it owns |
| --- | --- |
| [`api`](./api/README.md) | Kubernetes API constants and error normalisation. |
| [`auth`](./auth/README.md) | OIDC login, sessions, and request-principal resolution. |
| [`agent-runtime-stream`](./agent-runtime-stream/README.md) | Projected-token runtime HTTP/SSE framing. |
| [`workload-identity`](./workload-identity/README.md) | Kubernetes TokenReview and bounded workload identities. |
| [`http`](./http/README.md) | Express transport plumbing. |
| [`memory-gateway-client`](./memory-gateway-client/README.md) | Fail-closed memory-gateway port. |
| [`obot-custody`](./obot-custody/README.md) | Fail-closed Obot custody and MCP invocation ports. |
| [`sandbox-execution`](./sandbox-execution/README.md) | Fail-closed sandboxed tool-execution port. |

```text
 inbound request ──► http ──► auth ──► backend domain route
                                  │
                  api ───────────┤
 workload identity ─► runtime stream ◄── runtime Pod
 external-action ports ───────────┘
```

## Dependency rule for this tier

These packages carry `type:lib`, `layer:infra`, and a bounded `scope:*` tag. They may use models,
contracts, utilities, observability, and explicitly allowed `_server` peers, but never import a
backend domain or app entrypoint. Public imports use `@opencrane/backend/_server/<library>`.

## See also

- Parent index: [backend](../README.md)
- Cross-cutting telemetry: [observability](../observability/README.md)
- Server business capabilities: [backend/server](../server/README.md)
