# Sandbox jobs

OpenSandbox is scheduled as the execution substrate for non-MCP code, document and tenant-authored
skill work. It replaces home-grown sandbox execution plumbing—not OpenCrane's control plane,
`ArtifactStore`, Obot, or the agent loop.

> See also: [Agents overview](/integrators/agents/),
> [Runs & streaming](/integrators/agents/runs-streaming), and
> [Networking & isolation](/operators/networking).

::: info Implementation status
The role is accepted in ADR 0009. Phase D lands the adapter, app boundary, identity, RBAC,
admission and network profile; Phase E pins and qualifies the OpenSandbox deployment and SDK. It is
🔶 planned, not yet a shipped execution path.
:::

## What OpenSandbox adds

A plain Kubernetes Job stops a process, but it does not give the agent platform a standard command,
file and code API, streamed output, TTL handling, endpoint resolution, egress sidecar or execution
diagnostics. OpenSandbox supplies those pieces behind a protocol and SDK while retaining Kubernetes
as the actual workload substrate. Its `execd` component streams command and code output, which the
OpenCrane adapter can turn into live tool progress.

OpenCrane adopts only that bounded execution role. See the upstream
[architecture](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/architecture.md) and
[secure runtime guide](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/secure-container.md)
for the source component model.

## Ownership stays split

| Owner | Responsibility |
|---|---|
| OpenCrane | Authorisation, approval, immutable assignment, attempt/retry, cancellation, audit, RunEvents and ArtifactVersions |
| `apps/agent-controller` | Only OpenCrane caller of the private lifecycle API; maps one approved attempt to one sandbox |
| OpenSandbox | Confined sandbox creation, `execd`, egress component, TTL/resource enforcement and execution diagnostics |
| `apps/tool-runner` | Approved images and execution profiles; zero Kubernetes RBAC and scratch-only workspace |
| Obot | MCP integration execution and credential custody |

The OpenSandbox API key authenticates one internal controller hop. It is not tenant identity or
authorisation, and the lifecycle API has no tenant or agent ingress.

## Inherited rights are attenuated

The sandbox inherits the spawning agent's relevant rights, but never its credential or all of its
ambient authority. OpenCrane derives the attempt capability as:

```text
spawning actor and AgentService rights
∩ immutable Run and AgentRevision
∩ exact approved action and arguments
∩ ArtifactVersion and egress grants
∩ sandbox profile ceiling
```

The result is short-lived and proof-bound to one silo, run, attempt, sandbox workload identity,
expiry and replay record. If the agent cannot read an ArtifactVersion or reach a destination, the
sandbox cannot do so even when its base profile would allow it. A sandbox also cannot turn an
allowed read into a write, reuse a capability for another attempt, or expand its own policy.

OpenCrane passes narrow ArtifactStore and action capabilities. It does not copy agent workload
tokens, provider keys, Obot keys or other ambient credentials into the workload. Revocation-sensitive
access is checked online before capability issue or use.

Retry or resume creates a new attempt and capability. Old-attempt, cross-silo and wrong-workload
proofs fail. Cancellation, expiry or relevant authorization revocation blocks further ArtifactStore
or action use and triggers bounded sandbox and egress cleanup. The assignment is immutable while it
runs: a steering message can request explicit cancellation or a later attempt, but cannot rewrite the
action, arguments, artifacts, egress, resources or capability of the running sandbox.

## One sandbox attempt

1. OpenCrane records a canonical tool attempt before dispatch.
2. The controller sends an immutable image digest, command, resource/deadline limits, fixed egress
   profile, attenuated attempt capability, input ArtifactVersion capabilities and output lease
   through the adapter.
3. OpenSandbox creates the confined workload in its sandbox namespace.
4. `execd` streams bounded output. The controller treats it as untrusted, derives stable candidate
   IDs, and relays it to the OpenCrane run-ingest API. Only OpenCrane persists canonical tool
   progress; the UI never consumes an upstream stream directly.
5. Durable output is scanned and finalised through `ArtifactStore`.
6. Completion, cancellation, expiry or crash reconciliation verifies that the sandbox and scratch
   data are deleted. Retry creates a new recorded attempt.

## Initial security profile

- No public lifecycle ingress and no access from agent or tool-runner workloads.
- Kubernetes rights limited to named sandbox workload types in the sandbox namespace.
- No service-account token automount or Kubernetes RBAC inside the sandbox.
- Default-deny Cilium policy and an immutable allow-list rendered from the action capability.
- A qualified gVisor or Kata RuntimeClass. Production refuses untrusted sandbox work when it is
  unavailable; `runc` is local-test-only with no tenant input or production credential.
- Pinned image digests, CPU/memory quotas, deadline, TTL, dropped capabilities, seccomp and a
  read-only root where possible.
- Proof-bound attempt rights cannot exceed the spawning agent, run/revision, approved action, or
  sandbox-profile ceiling; privilege expansion and credential copying fail closed.
- Scratch-only volumes; host mounts, durable PVCs, pause/resume and reusable snapshots disabled.
- OpenSandbox MCP, CLI and vault surfaces disabled; Obot remains the only MCP credential custodian.

The upstream server can run without authentication in an explicitly acknowledged insecure mode, or
with a shared API key. OpenCrane requires the authenticated private mode and adds its own
workload/capability authorisation in front; the upstream key alone is insufficient. See the
[OpenSandbox server authentication documentation](https://github.com/opensandbox-group/OpenSandbox/blob/main/server/README.md).

## What this does not replace

OpenSandbox does not replace Boto, an object store, or OpenCrane's `ArtifactStore` abstraction. It
provides somewhere isolated to execute untrusted work. Storage SDKs remain implementation details of
authorised tools, and durable bytes still cross the ArtifactStore lease/finalise boundary.
