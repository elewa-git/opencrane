# _infra — the server's runtime seams

> [server](../README.md) › _infra

These libraries are the machinery the `apps/opencrane` server process wraps around its business
domains: how requests arrive, who is let in, how it talks to Kubernetes, and how it reaches external
runtime services. They are kept apart from `libs/backend/server` on purpose so that transport and plumbing
never look like a business capability. Each is owned by the server and by nothing else.

## Map

| Package | What it owns |
| --- | --- |
| [`api`](./api/README.md) | Kubernetes API plumbing. |
| [`auth`](./auth/README.md) | OIDC login and authorization substrate. |
| [`agent-runtime-stream`](./agent-runtime-stream/README.md) | Projected-token runtime-initiated HTTP/SSE framing; never run state. |
| [`workload-identity`](./workload-identity/README.md) | Kubernetes TokenReview and bounded projected workload identity parsing. |
| [`http`](./http/README.md) | Express transport plumbing. |
| [`memory-gateway-client`](./memory-gateway-client/README.md) | The personal-memory gateway port. |
| [`obot-custody`](./obot-custody/README.md) | The Obot credential-custody port. |
| [`sandbox-execution`](./sandbox-execution/README.md) | The sandboxed tool-execution port. |

```
   inbound request
        │
      http ──► auth ──► (server routes + backend domains)
                          │
   api (Kubernetes) ◄─────┤
   obot-custody ◄─────────┤
   memory-gateway-client ◄┤
   sandbox-execution ◄────┘
   workload-identity ──► agent-runtime-stream ◄── outbound runtime Job
```

## Dependency rule for this tier

These carry `layer:infra`. They may use models, contracts, utilities, observability, and other
`_infra` peers — but must **not** import a backend business domain (`libs/backend/server/*`), a
frontend package, or an application entrypoint. Public imports use
`@opencrane/server/_infra/<library>`.

## See also

- Parent index: [`libs/server`](../README.md)
- Business capabilities that consume these seams: [`libs/backend/server`](../../backend/server/README.md)
