# OpenCrane server libraries

> [OpenCrane](../../README.md) › server libraries

`libs/server` contains implementation support owned specifically by the `apps/opencrane` server
process. Business capabilities stay under `libs/backend/server`; this root exists so transport,
authentication, Kubernetes access, and external-service ports do not look like business domains.

## Infrastructure libraries

| Library | Responsibility | Primary consumers |
|---|---|---|
| [`_infra/api`](./_infra/api/) | Typed Kubernetes API operations, CRD constants, watch loops, and apply/error helpers. | The OpenCrane server and backend domains that reconcile Kubernetes resources. |
| [`_infra/auth`](./_infra/auth/) | OIDC sessions, identity claims, organization membership, and server auth middleware. | The OpenCrane server and identity/access backend domains. |
| [`_infra/agent-runtime-stream`](./_infra/agent-runtime-stream/) | Projected-token HTTP/SSE framing initiated by runtime Jobs. | The personal-runtime process and controller authority. |
| [`_infra/http`](./_infra/http/) | Health, OpenAPI routing, transport security, trusted proxies, rate limiting, and error handling. | The OpenCrane server process. |
| [`_infra/obot-custody`](./_infra/obot-custody/) | The runtime-neutral port for delegating integration-credential custody to the external Obot authority; write-only, fail-closed by default. | The `integrations` backend gateway. |

These libraries may use models, contracts, utilities, observability, and other server-infrastructure
peers. They must not import backend business domains or application entrypoints. Public imports use
`@opencrane/server/_infra/<library>`; there are no aliases for the former locations.

## See also

- Parent front door: [OpenCrane](../../README.md)
- Runtime seams: [_infra](./_infra/README.md)
- Business capabilities: [backend/server](../backend/server/README.md)
