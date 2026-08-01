---
aside: false
outline: false
title: API reference
---

# API reference

This interactive reference is generated from the control plane's OpenAPI 3.1 specification —
the same document served at runtime from `GET /api/v1/openapi.json` and attached to each
release. CI re-emits the spec and fails on drift, so this page cannot fall behind the routers
it documents.

Read the [API overview](/reference/api-overview) first for authentication, error envelopes,
and pagination conventions. For the maintained TypeScript package, see the
[Contracts SDK](/integrators/contracts-sdk).

::: tip Generating a client
Generate against the instance you intend to integrate with, not against this page. Download
`/api/v1/openapi.json` from that deployment, check its server URL and authentication
requirements, then run a contract test against it before you ship — a deployment can run an
older release than this site documents.
:::

::: warning Request samples omit the base path
Every path below is relative to the `/api/v1` prefix. Because OpenCrane declares a relative
server URL — it is self-hosted and has no canonical host — the generated samples fall back to
a bare host and drop that prefix. Prepend your own base URL: `GET /mcp-servers` is really
`GET https://<your-host>/api/v1/mcp-servers`.
:::

<OASpec />
