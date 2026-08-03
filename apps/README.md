# Apps — the deployables

> [OpenCrane](../README.md) › apps

Everything here is a **deployable**: a thing that ships and runs — a server, a single-page app, a
worker, a database. Apps are thin. They compose libraries, wire up clients, and manage process
lifecycle; the actual product logic lives in [`libs`](../libs/backend/README.md). The rule is
**one `apps/<name>` per deployable, and logic lives in libs** — if you are writing behaviour worth
testing on its own, it belongs in a library, not here.

## Map

| Deployable | What it owns |
| --- | --- |
| [`opencrane`](./opencrane/README.md) | The organisation control plane and authenticated REST API. |
| [`opencrane-ui`](./opencrane-ui/README.md) | The org-admin single-page app. |
| [`channel-proxy`](./channel-proxy/README.md) | The inbound-channel edge trust boundary. |
| [`memory-gateway`](./memory-gateway/README.md) | The private authenticated boundary in front of Cognee. |
| [`artifact-service`](./artifact-service/README.md) | The artifact promote-and-receipt service. |
| [`artifact-preprocessor`](./artifact-preprocessor/README.md) | Outbound-only PDF-to-text worker behind the OpenCrane artifact broker. |
| [`agent-runtime`](./agent-runtime/README.md) | Outbound-only personal-agent process prepared as one suspended Job per run attempt. |
| [`managed-agent-runtime`](./managed-agent-runtime/README.md) | Chart/deploy-only plane for scheduled and triggered managed agents. |
| [`agent-controller`](./agent-controller/README.md) | Sole Kubernetes mutator for personal-runtime attempt resources. |
| [`skill-authoring`](./skill-authoring/README.md) | Chart-only isolated candidate-skill Job plane with no standing worker. |
| [`tool-runner`](./tool-runner/README.md) | Chart-only isolated tenant-tool Job plane with no standing worker. |
| [`postgres`](./postgres/README.md) | The durable PostgreSQL deployable. |

Vendored third-party infrastructure (Cognee, LiteLLM, Obot, and the Kubernetes release
composer) lives one level down under [`apps/_infra`](./_infra/README.md) — see that index for the
service map.

```
   opencrane (control plane) ──serves──► opencrane-ui (SPA)
        │                                  channel-proxy (edge)
        ├── memory-gateway · artifact-service · artifact-preprocessor
        ├── agent-controller · agent-runtime · managed-agent-runtime
        ├── skill-authoring · tool-runner
        └── postgres (durable DB)
   apps/_infra/ ── vendored infra + release composer
```

## Dependency rule for this tier

Apps carry `type:app` / `scope:app`. An app may compose any library, but it must **not** import
another app — deployables never depend on each other's source.

## See also

- Parent front door: [OpenCrane](../README.md)
- Vendored infra index: [`apps/_infra`](./_infra/README.md) · library capabilities: [`libs/backend`](../libs/backend/README.md)
