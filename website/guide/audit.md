# Review activity

Every run — your personal assistant's or a managed agent's — leaves a full trail: who or what
triggered it, exactly what it was allowed to use, every action it took along the way, and how it
ended. You can always answer "what did this agent do, and who let it" without guessing.

## What to inspect

- agent service and immutable revision;
- organisation and delegated subject;
- run state, attempt and terminal reason;
- frozen input and capability digests;
- approval requests, authorization decision evidence and ToolInvocations;
- token use, cost and cancellation evidence; and
- ordered conversation events where the caller is authorised to replay them.

Use the authenticated `/api/v1/audit` surface. Retrieve current filters and pagination from
the [API reference](/reference/api); the current UI does not expose an audit view.

::: tip
Search by run id first. Pod names are replaceable execution details and do not identify the
durable product record.
:::
