# OpenCrane server capabilities and infrastructure

> [backend](../README.md) › server

The OpenCrane server composes these backend capabilities and its process-specific infrastructure.
Directories group related packages without changing any NX project, scope tag, or dependency
contract.

| Group | Shared concern | Members |
| --- | --- | --- |
| [`iam`](./iam/) | Who may act, and evidence of those decisions. | identity, membership, authorization, grants, groups, audit |
| [`agents`](./agents/) | Agent publication, onboarding, scheduling, channel admission, and artifacts. | agent-services, onboarding, scheduling, skills, artifacts, channel-targets |
| [`conversations`](./conversations/main/) | Conversation membership, canonical timeline, mode-correct admission, authorised readers and HTTP stream routes. | conversations |
| [`conversation-assets`](./conversation-assets/main/) | Participant uploads, quarantine, Files projection, and transaction-bound message attachments. | conversation-assets |
| [`gateways`](./gateways/) | Governance of external model and tool planes. | mcp, integrations, providers, model-routing |
| [`knowledge`](./knowledge/) | Organisational retrieval and memory access. | retrieval |
| [`tenancy`](./tenancy/) | The organisation boundary used by server capabilities. | cluster-tenants |
| [`reporting`](./reporting/) | Agent and model economics. | spend |
| [`utils`](./utils/) | Server-only helpers shared across capability boundaries. | ZIP package parsing |
| [`infra`](./infra/) | Process-specific transport, identity, and external-I/O seams. | api, auth, agent-runtime-stream, workload-identity, http, memory-gateway-client, obot-custody, sandbox-execution |

[`api-spec`](./api-spec/main/) remains flat because it aggregates public paths from every group;
placing it in one group would imply ownership of those capabilities.

## Dependency direction

The grouping is a navigational map, not a new `scope:<group>` policy. Existing per-domain NX
scope constraints remain authoritative. This directory map does not impose group-level dependency
direction: current cross-group edges include IAM ↔ tenancy, tenancy → reporting, and reporting →
tenancy. New cross-group imports require an explicit domain-level decision.

Every package continues to expose only its public barrel at
`@opencrane/backend/server/<group>/<domain>`. Apps compose packages; packages never import apps.

## See also

- Parent index: [backend](../README.md)
- App composition root: [opencrane server](../../../apps/opencrane/README.md)
