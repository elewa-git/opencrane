# Review activity

OpenCrane records **governance decisions and durable run evidence** so operators can explain
who requested work, which revision ran, what was authorised and how it ended.

## What to inspect

- agent service and immutable revision;
- organisation and delegated subject;
- run state, attempt and terminal reason;
- frozen input and capability digests;
- approval requests and action receipts;
- token use, cost and cancellation evidence; and
- ordered conversation events where the caller is authorised to replay them.

Use the authenticated `/api/v1/audit` surface. Retrieve current filters and pagination from
the [API reference](/reference/api); the current UI does not expose an audit view.

::: tip
Search by run id first. Pod names are replaceable execution details and do not identify the
durable product record.
:::
