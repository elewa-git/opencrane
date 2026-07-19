# Agent authentication

OpenCrane keeps human login, workload identity, run identity and one action's authority separate.
No credential is allowed to quietly stand in for all four.

> See also: [Agents overview](/integrators/agents/),
> [Identity & connection auth](/security/identity), and
> [Identity & network isolation](/operators/cilium-spiffe-identity).

::: info Implementation status
OIDC sessions and projected workload identity foundations exist. The run bootstrap and proof-bound
action-capability flow below are 🔶 planned for Phase D.
:::

## The identity chain

| Layer | Proves | Does not grant |
|---|---|---|
| Human OIDC session | Which signed-in person sent the request | Kubernetes or downstream service access |
| Projected workload token | Which namespace, ServiceAccount and Pod is calling | User, team, tool or artifact permission |
| Run context | Which immutable agent revision, actor, grants, budgets and attempt the workload received | Direct access to a PEP |
| Action capability | One bounded read, upload, model, memory or tool action | Another action or broader resource access |
| Downstream PEP | The action is valid for this service | Product ownership or policy mutation |

```
OIDC request ──▶ recorded Run ──▶ controller assignment ──▶ Pod-bound bootstrap
                                                       │
                                                       ▼
                                             short-lived run context
                                                       │
                                                       ▼
                                           proof-bound action capability
                                                       │
                                 ┌─────────────┬──────────────┬─────────────┐
                                 ▼             ▼              ▼             ▼
                               Obot       ArtifactStore     LiteLLM     OpenSandbox
```

## Workload bootstrap

The controller creates a suspended one-attempt workload and records its Job UID and bootstrap
assignment before it runs. OpenCrane verifies the projected token's full namespace, ServiceAccount
and Pod UID, atomically consumes the bootstrap, and binds the run context to that workload. A
replacement pod cannot inherit the previous proof; a retry is a new recorded attempt.

Runtimes receive no Kubernetes mutation RBAC and no broad Obot, provider or Cognee credential. The
browser retains only its HTTP-only OIDC session cookie.

When an agent dispatches a sandbox action, OpenCrane attenuates the agent/run authority into one
attempt capability. It is the intersection of the spawning agent's rights, the triggering actor's
rights where applicable, immutable revision, approved action and arguments, allowed artifacts and
egress, and sandbox profile ceiling. The sandbox receives that proof-bound subset—not the agent's
workload token or downstream credentials. Retry, cancellation, expiry, revocation, silo, attempt, and
workload bindings are checked independently; an agent-level ceiling cannot bypass the actor.

## Internal upstream keys are not identity

Some pinned upstreams, including OpenSandbox, support an internal API key. OpenCrane may use that
key to authenticate the controller-to-upstream hop, but only after it has validated the workload and
proof-bound action. The shared key is never exposed to tenants and never decides which tenant may
run what. It is a scoped compatibility credential for an upstream that does not validate OpenCrane
projected identity; rotate it as an app-owned Secret and remove it once that hop can use workload
identity or mTLS directly.

## Fail-closed checks

Wrong silo, subject, namespace, ServiceAccount, Pod UID, run, revision, proof, action, arguments,
expiry or replay state rejects the request. Network reachability remains a separate Cilium boundary;
it cannot turn an invalid capability into an authorised call.

Human OIDC setup and current connection routing remain documented under
[Authentication](/security/identity). Browser transport threats are covered separately in
[Connection security](/security/connection-security).
