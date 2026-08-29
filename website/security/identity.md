# Identity and runtime authentication

OpenCrane uses **OIDC sessions for people** and **audience-bound projected identities for
workloads**. Neither is interchangeable with run authority.

## Human identity

People sign in through the configured OIDC provider. The server derives their subject and
organisation context from the authenticated session; request bodies cannot override either.
Management UI calls use the same-origin session cookie.

Current organisation membership is checked before a run is admitted. Accepted membership,
delegated subject and scope evidence are frozen into the run input snapshot.

A **personal** run always resolves to that one authenticated person — it can never be admitted as
someone else. It may inherit grants through Groups that current product membership places that
Principal in, but it can never pick up another person's direct grants. A **managed** agent
never resolves to a human at all: it runs as its own `agent-service:<id>` principal, verified
against a separately signed fleet-membership assertion, with no path back to the administrator who
published or triggered it. See
[the personal/managed distinction](/guide/introduction#two-kinds-of-agent-and-why-the-difference-matters).

## Workload identity

```text
admitted run attempt
       │
       ▼
exact claimed Pod + ServiceAccount + namespace
       │  projected token
       ▼
Kubernetes TokenReview
       │  one-use bootstrap
       ▼
proof key bound to Pod UID + run + attempt
```

The runtime initiates the connection. OpenCrane checks the exact projected-token audience and
Kubernetes subject, then compares the reviewed workload with the durable assignment. A valid
token from another workload does not inherit the assignment.

## Credential classes

| Credential | Holder | Purpose |
|---|---|---|
| OIDC session cookie | Browser | Public UI and API calls |
| Controller projected token | Agent controller | Claim and report authorised workload assignments |
| Runtime projected token | One claimed runtime Pod | Bootstrap and open its outbound stream |
| Runtime proof key | One run attempt | Bind candidates to the reserved Pod |
| Attempt-scoped model key | One run attempt | Reach the allowed model alias within its budget |

Provider master keys, tool credentials and durable artifact credentials never enter the runtime.

::: warning
Do not use a Kubernetes token as evidence that a run is allowed. It proves workload identity;
the database assignment proves which exact work that identity may perform.
:::

Product permission is decided separately through the
[central authorization authority](/integrators/authorization-authority). NetworkPolicy and
Kubernetes RBAC constrain infrastructure reachability; neither grants access to a skill, MCP tool,
artifact, conversation, model, dataset, or channel target.

## Revocation and cancellation

Session revocation stops new human requests. Membership or grant revocation also blocks the next
external action admission even when a run has an older frozen ceiling. Run cancellation is a durable state transition:
OpenCrane fences the exact attempt, sends a positive cancel command when possible and authorises
cleanup of only the claimed Pod. Late candidates are rejected.

Source: [`libs/backend/server/iam/authorization/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/iam/authorization/main/README.md)
and [`apps/opencrane/prisma/schema/runs.prisma`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/prisma/schema/runs.prisma).
