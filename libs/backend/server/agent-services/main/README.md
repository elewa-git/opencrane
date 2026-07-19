# @opencrane/backend/server/agent-services — Agent-service publication

Owns publication of an immutable agent revision as the active revision for an agent service. It
keeps the service, revision, and audit evidence aligned when a draft becomes available to run.

The public surface is `src/index.ts`; `PrismaAgentServicePublicationRepository` provides the
durable authority implementation. See [`../../README.md`](../../README.md) for the control-plane
map.
