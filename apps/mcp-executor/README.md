# @opencrane/mcp-executor — OCI MCP companion

> [apps](../README.md) › mcp-executor

## What it owns

This app is the thin process and image owner for the OpenCrane companion beside one uploaded MCP
(Model Context Protocol) server. The controller creates the Job; this app starts with tracing active,
validates fixed endpoints and mounted identity, composes the reusable companion, then exits.

```text
runtime-created two-container Job
        │ uploaded MCP server has no OpenCrane credentials
        ▼
┌────────────────────────────────┐
│ mcp-executor app ◄── HERE       │ projected token · one claim · one report
└────────────────────────────────┘
        │ loopback MCP + cluster-local OpenCrane only
        ▼
checked discovery or one tool result
```

**In this flow:** [companion library](../../libs/backend/agents/runtime/mcp-executor/companion/README.md) · [Job launcher](../../libs/backend/agents/runtime/mcp-executor/k8s-launcher/README.md)

The app guarantees a one-shot outbound lifecycle. It never opens a listener, polls for more work,
or gives the uploaded image a token, execution reference, Kubernetes permission, or shared scratch.

## Public surface

Entrypoint: `src/index.ts` composes one companion run and flushes telemetry before exit.

## Boundary

The OpenCrane server remains the durable command and terminal-state authority. The app cannot select
an image, silo, tool, invocation, permission, retry, or result interpretation.

## Dependency direction

Tagged `scope:mcp-runtime` and `layer:entrypoint`, this app consumes the reusable companion and
observability packages. No library imports this app.

## Runtime & config

The launcher supplies the fixed `/api/internal/mcp-executor` URL, loopback `/mcp` URL, projected
token and reference paths, and `POD_UID`. Optional bounded timeout and byte-limit variables retain
hard ceilings. The app-owned Helm chart creates only the restricted namespace, zero-RBAC identity,
quota, and DNS/server egress policies; the controller creates every Job.

## See also

- [Apps index](../README.md)
- [MCP executor runtime](../../libs/backend/agents/runtime/mcp-executor/README.md)
