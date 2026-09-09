# Identity and runtime authentication

OpenCrane uses **OIDC sessions for people** and **audience-bound projected identities for
workloads**. Neither is interchangeable with run authority.

## Human identity

People sign in through the configured OIDC provider. The server derives their subject and
organisation context from the authenticated session; request bodies cannot override either.
Management UI calls use the same-origin session cookie.

The persistent-session follow-up stores encrypted identity and login-flow data in PostgreSQL,
with only a signed random identifier and fixed expiry in the browser cookie. Server replacement
can then preserve login. Logout blocks delayed saves, and each read still passes the current
issuer, host, identity-expiry and membership checks. See the
[installation settings](/operators/deployment-configuration#preserve-browser-login-during-server-replacement)
and [qualification status](/guide/status).

Current organisation membership is checked before a run is admitted. The resulting
`ExecutionSubject` records the resolved AgentIdentity and Principal, current membership and
capability evidence, current computer lease, and requester provenance.

An agent acts through its resolved **AgentIdentity** and current Principal, never as the person
who clicked run. A proxied identity is constrained by its current delegation ceiling; a constructed
managed identity has its own Principal and grants. Neither may pick up a different Principal's
direct grants or derive execution authority from the requester. See
[the product concepts](/guide/introduction#the-five-parts-of-the-product).

## Workload identity

```text
active conversation-computer lease
       │
       ▼
exact claimed Pod + ServiceAccount + namespace
       │  projected token
       ▼
Kubernetes TokenReview
       │  bootstrap or model-step request
       ▼
computer id + lease generation + Pod UID rechecked
```

The conversation computer initiates bootstrap and model-step calls. OpenCrane checks the exact
projected-token audience and Kubernetes subject, resolves the claim to the Pod, then compares the
computer id, lease id, generation, AgentIdentity and current membership with durable authority. A
valid token from another workload does not inherit the lease.

## Credential classes

| Credential | Holder | Purpose |
|---|---|---|
| OIDC session cookie | Browser | Public UI and API calls |
| Controller projected token | Agent controller | Claim and report authorised workload assignments |
| Computer projected token | One claimed conversation-computer Pod | Read bootstrap status and request its server-owned model step |
| Attempt-scoped model key | OpenCrane server, bound to one computer turn | Reach the allowed model alias within the original attempt budget and actual key expiry |

Provider master keys, tool credentials and durable artifact credentials never enter the runtime.
The server model-step path also keeps the LiteLLM attempt key and compiled prompt out of the
conversation Pod. The Pod receives status, and the server owns tool selection and answer admission.
The continuation implementation reuses the first key only when its saved digest, expiry and current
authority still match. It cannot replace expired, missing or uncertain custody; cleanup retains a
non-secret spent marker. Each model request remains within 25 seconds and the current key/authority
window. The text checkpoint has passed full CI, while the continuation implementation in PR #830
awaits CI and live qualification. Neither replacement has been deployed on testv5. See [development status](/guide/status).

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
