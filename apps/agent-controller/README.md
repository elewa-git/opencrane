# agent-controller — governed job projection

> [apps](../README.md) › agent-controller

## What it owns

The agent controller projects three server-approved workload classes into restricted Kubernetes
namespaces: skill-authoring validation Jobs, artifact-preprocessing Jobs, and Open Container
Initiative (OCI) Model Context Protocol (MCP) executor Jobs. It has no inbound listener and does not
run conversation computers. Conversation execution is owned by the Agent Sandbox controller and the
OpenCrane conversation-computer lifecycle.

The server commits each decision before this process mutates Kubernetes. Fixed profiles determine
the image digest, ServiceAccount, namespace, deadline, resources, projected-token audience, and
network destination. The controller records the exact Job and Pod identities through same-silo
internal authorities. It cannot choose worker credentials, create policy, or read application
Secrets.

```text
OpenCrane server -> durable workflow task -> agent-controller -> fixed Kubernetes Job
```

## Public surface

`src/index.ts` validates configuration, creates least-privilege Kubernetes clients, registers the
skill and optional artifact workflow handlers, runs OCI MCP reconciliation, and drains workflows and
telemetry on termination.

## Boundary

The process uses the release-local OpenCrane database credential only to claim durable workflow
tasks. Its Kubernetes roles are scoped to the named worker namespaces and governed Job operations.
Fail-closed admission policies constrain each created Job to its configured workload shape. The app
never receives the LiteLLM master key and exposes no Service, Ingress, or public route.

## Runtime configuration

- `OPENCRANE_INTERNAL_URL`, `OPENCRANE_SILO_ID`, `OPENCRANE_SERVER_SERVICE_NAME`, and
  `POD_NAMESPACE` bind every callback to this silo.
- `DATABASE_URL` and the bounded `OPENCRANE_WORKFLOW_*` settings configure durable task polling.
- `OPENCRANE_CONTROLLER_TOKEN_PATH` supplies the rotating controller audience token.
- `AGENT_CONTROLLER_POLL_INTERVAL_MS` and `AGENT_CONTROLLER_REQUEST_TIMEOUT_MS` bound retries and
  external calls.
- `AGENT_CONTROLLER_SKILL_AUTHORING_PROFILE_JSON` fixes skill validation Jobs.
- `AGENT_CONTROLLER_MCP_EXECUTOR_PROFILE_JSON` fixes OCI MCP executor Jobs.
- `AGENT_CONTROLLER_ARTIFACT_PREPROCESSOR_PROFILE_JSON` optionally fixes artifact conversion Jobs.

The image runs as an unprivileged numeric user with a read-only root filesystem. Structured logs and
OpenTelemetry spans cover HTTP and Kubernetes input/output calls.

## Dependency direction

Tagged `type:app`, `layer:entrypoint`, and `scope:agent-controller`. The app composes governed Job
controllers, workflow infrastructure, and observability; reusable policy remains in libraries.

## See also

- Parent index: [apps](../README.md)
- Skill controller: [skills/controller](../../libs/backend/agents/skills/controller/README.md)
- MCP executor controller: [runtime/mcp-executor/controller](../../libs/backend/agents/runtime/mcp-executor/controller/README.md)
- Artifact preprocessor: [artifacts/preprocessor](../../libs/backend/artifacts/preprocessor/README.md)
