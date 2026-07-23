# managed-agent-runtime — the managed (central) agent runtime plane

> [apps](../README.md) › managed-agent-runtime

<!-- No import alias: this is a chart/deploy-only app, not an importable package. -->

## What it owns

This app owns the **deployment surface for managed (central) agents** — the agents an organisation
runs on a schedule, distinct from a person's personal agent. It is **chart/deploy-only**: a
dedicated Kubernetes namespace, one bounded connector-scoped ServiceAccount, and the
default-deny + explicit-egress NetworkPolicies that fence that namespace. It ships no application
source and builds no image of its own.

Managed runtime Pods run the **same image as the personal runtime** (built by
[`agent-runtime`](../agent-runtime/README.md) — one shared build artifact, never duplicated Python).
The two planes differ only in identity and reach: the launcher projects a *managed* identity profile
(the `managed-agent-runtime-*` ServiceAccount class and the distinct
`opencrane-managed-agent-runtime` projected-token audience), and this namespace's NetworkPolicies
allow egress only to the control-plane stream and the channel-proxy / artifact / memory-gateway /
LiteLLM / Obot services a central agent needs — everything else is denied.

```text
 managed AgentService + schedule (control API)
        │  scheduler admits a due run; launcher builds a managed-profile Job
        ▼
 ┌────────────────────────────────────┐
 │  managed-agent-runtime  ◄── HERE    │  namespace · connector-scoped SA · default-deny + egress NP
 └────────────────────────────────────┘
        │  runs the shared agent-runtime image under the managed identity
        ▼
 channel-proxy · artifact · memory-gateway · LiteLLM · Obot   (the only permitted egress)
```

Invariant: the managed identity is never the personal `agent-runtime-*` class and vice versa — the
chart rejects a personal ServiceAccount name at render time, and the namespace must differ from the
server namespace. `automountServiceAccountToken` is `false`; the launcher projects a managed-audience
token explicitly per attempt.

## Layout

- `helm/` — the standalone chart (`Chart.yaml`, `values.yaml`, `templates/managed-agent-runtime.yaml`).
- `tests/helm-contract.sh` — renders the chart and asserts the distinct SA, default-deny + egress
  policies, restricted namespace, and the identity-class fences.
- `deploy/README.md` — image provenance: this plane reuses the `agent-runtime` image.

## Boundary

Deployment-only. It creates no Pods on its own; the control-plane launcher creates managed-runtime
Jobs into this namespace under the managed identity profile. The live-Obot end-to-end proof of a
managed agent (and the subsequent deletion of the bespoke `apps/feat-central-agents` harvester) is a
NAMED LATER GATE tracked under [#337](https://github.com/elewa-git/opencrane/issues/337).

## See also

- Siblings: [agent-runtime](../agent-runtime/README.md) *(shared image + personal plane)* · [agent-controller](../agent-controller/README.md)
