# Create your first agent

An **agent service** is the governed definition OpenCrane uses to admit managed work.
The current product surface is the authenticated management API.

## Create and publish the service

Use `POST /api/v1/agent-services` as an organisation administrator. Supply the name,
workload profile, change message and revision content defined by the deployed OpenAPI contract.
The response contains the new service and its first immutable revision.

Review that revision, then publish it with
`POST /api/v1/agent-services/{serviceId}/publish`. Publishing uses an expected active-revision
fence so a concurrent change cannot be overwritten silently. Enable the published service
through its state action before requesting work.

::: info
The OpenCrane UI does not yet expose agent-service management. Retrieve request and response
schemas through the [API reference](/reference/api) and use an authenticated client.
:::

## Start a run

Call `POST /api/v1/agent-services/{serviceId}/run-now` with a unique
`requestIdempotencyKey`. OpenCrane returns `202` for a newly accepted run or the existing run
for an exact replay.

The control plane then:

1. verifies the caller, organisation membership, grants and budget;
2. freezes accepted inputs in a `RunInputSnapshot`;
3. assigns one bounded Kubernetes `Job` for the run attempt; and
4. persists events and action decisions as the run progresses.

The runtime cannot select a different user, revision, tool set or organisation. A retry
increments the attempt on the same logical run and receives a fresh workload identity.

::: tip
A run is the durable unit to inspect, cancel and audit. Kubernetes Pods are replaceable
execution details and are never the product record.
:::

## What to configure next

- [Give the agent skills](/guide/skills).
- [Connect tools through MCP](/guide/tools).
- [Add organisational knowledge](/guide/knowledge).
- [Control access](/guide/permissions).
- [Set budget limits](/guide/budgets).
