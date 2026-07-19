# Workload identity

How OpenCrane's machines prove who they are to each other. The
[previous page](/security-architecture/capabilities) covered how a single *action*
is authorised; this page covers the layer underneath — how a *workload* (a running
process in the cluster) is identified at all, and why only one workload is allowed
to change anything in Kubernetes.

## The problem being solved

Inside a cluster, processes talk to each other constantly. The naive approach —
shared API keys in environment variables — fails in familiar ways: keys leak, keys
get copied, a key works from anywhere, and rotating one is an outage. OpenCrane
instead builds machine identity on what Kubernetes already guarantees, and adds
nothing a workload could steal from another.

Three rules define the model:

1. Every workload has exactly one **ServiceAccount** — its Kubernetes-issued
   identity — and proves it with short-lived, **audience-bound** tokens.
2. **Runtimes hold no ambient rights.** The workload that executes agent code has
   zero Kubernetes permissions and no standing credentials.
3. **One mutator.** Only the agent controller may create or change agent
   workloads in Kubernetes — nothing else, including the server itself.

## ServiceAccounts and audience-bound tokens

A **Kubernetes ServiceAccount** (KSA) is an identity the cluster itself manages.
Kubernetes can *project* a token for it into a Pod: a short-lived credential,
automatically rotated by Kubernetes, that names the ServiceAccount and — the
important part — an **audience**: the one verifier the token is meant for.

OpenCrane disables the default token automount on every workload (a Pod gets no
Kubernetes credential unless one is deliberately projected) and gives each
workload only the tokens its job requires, each with a distinct audience:

| Workload | Token audience | Used for |
|---|---|---|
| channel-proxy | `opencrane` | Calling the server's internal target-resolution API |
| agent-controller | `agent-controller` | Calling the server's controller-authority API |
| agent-controller | `https://kubernetes.default.svc` | Calling the Kubernetes API itself |
| agent-runtime | `opencrane` | Reserved for the proof-bound bootstrap listener — designed, not yet reachable: today the runtime has no network path to the server at all |

Audience-binding is what makes a stolen token boring: a token minted for the
`agent-controller` audience is rejected by every other verifier, so possession of
one credential never becomes access to a different door.

## TokenReview: verifying the caller

When a workload calls one of the server's internal APIs, it presents its projected
token as a bearer credential. The server does not decode the token itself — it
asks Kubernetes, via the **TokenReview** API: *is this token valid, for this
audience, and who is it?* The server then accepts the call only when all three
answers are exact:

- the token is authenticated,
- the expected audience is present,
- the identity is exactly the expected
  `system:serviceaccount:<namespace>:<name>` — not merely "some authenticated
  caller".

Anything else is refused (`401`), and if Kubernetes itself cannot be reached the
route answers `503` and refuses — identity verification is never skipped or
cached past its bound. This is the pattern on the controller-authority API and
the channel-target resolution API alike.

::: info One deliberate exception
The artifact service does not use TokenReview. Writes to it are authorised by an
OpenCrane-**signed write lease** carried with the upload, verified against the
server's public key — see
[Trust boundaries](/security-architecture/trust-boundaries#artifact-service-leased-writes).
The trust still originates with the server; only the proof format differs.
:::

## No ambient RBAC for runtimes

**RBAC** (role-based access control) is how Kubernetes grants API permissions to
identities. OpenCrane's rule: the workloads that execute agent code get **none**.

The agent-runtime identity has no Role (a granted permission bundle), no
ClusterRole (the cluster-wide variant), no automounted token, and a network
policy that allows no incoming connections and outgoing ones only to DNS and the
telemetry collector. If an agent's code is tricked or compromised, the blast
radius is a process that cannot call the Kubernetes API, cannot reach the
database, and cannot even open a connection to the server. This is not
aspiration — it is contract-tested: negative tests render the deployment
templates and assert the ServiceAccount has no RBAC (directly or via inherited
groups), and live tests run `kubectl auth can-i` against a real cluster
expecting `no` across the board.

## The controller: one mutator, no judgement

If runtimes cannot create their own workloads, someone must. That someone —
the **only** someone — is the agent controller. Its Kubernetes Role is a
namespaced allowlist: create/patch/delete on `Jobs` (the run-to-completion
workloads runs execute in), read on `Pods`, and nothing else. No Secrets access,
no other resource types, no ClusterRole.

Just as important: the controller executes decisions but never makes them.

```
     server (authority)                     controller (executor)
────────────────────────────────────────────────────────────────────
 1.  derives desired run     ──claim──▶     validates it against its
     from canonical rows                    own pinned policy
 2.                                         creates the Job SUSPENDED
 3.  records Job UID         ◀─ack────      (it cannot start yet)
     issues bootstrap
 4.  confirms readiness      ──ready──▶     unsuspends the Job
 5.  records first Pod UID   ◀─ack────
```

Every workload the controller creates starts **suspended** and is unsuspended
only after the server has durably recorded the exact Job identity (its
Kubernetes UID) and confirmed the **bootstrap** is ready — the one-time exchange
from the [previous page](/security-architecture/capabilities#proof-of-possession)
in which the new run registers its proof key. "Pinned policy" in step 1 means
the values baked into the controller's own deployment configuration — the exact
namespace, ServiceAccount, and image runtime Jobs are allowed to use; a desired
run that names anything else is rejected before any Job is created, so even a
compromised server cannot use the controller to schedule an arbitrary image.

The controller reports observations — Job UID, first Pod UID — but the server
treats them as coordinates to verify, never as authority: a mismatched name, a
changed runtime profile, or a stale attempt is rejected at the API and the work
is re-derived from the database. A controller crash therefore loses nothing
(unacknowledged claims become reclaimable), and a repeated sync pass — a
*reconcile*, in controller jargon — double-runs nothing (acknowledgements are
idempotent per run attempt).

## How this composes with capabilities

Workload identity and capabilities are two halves of one check. A capability
names the workload that may exercise it — ServiceAccount, namespace, workload
UID, Pod UID. Those values are trustworthy precisely because of this page:
Kubernetes issued the identity, TokenReview verified it, the controller recorded
the UIDs at creation, and the server persisted them before the workload ever
acted. When a proof arrives, the verifier compares the signed workload fields
against those recorded facts — identity checked twice, from two independent
directions.

## Advanced: the route that refuses to exist

One last fail-closed detail, for readers who operate the platform. The
controller-authority API is powerful enough that the server refuses to mount it
at all unless its configuration is complete and safe. At startup,
`_LoadControllerAuthorityConfig` requires every one of:

- the controller's exact namespace and ServiceAccount name — the TokenReview
  identity of the only permitted caller;
- the **runtime profile** — the server-owned bundle naming the namespace,
  (zero-RBAC) ServiceAccount, and image that runtime Jobs use;
- that image **pinned by digest** (`…@sha256:<64 hex>`) — a floating tag (one
  whose content can silently change) never validates;
- an assignment lifetime between 60 and 300 seconds.

If anything is missing or invalid, the loader returns nothing and the route is
**never mounted** — the run plane simply does not exist in that process. There
are deliberately no defaults: a guessed controller identity would make
TokenReview authenticate the wrong workload, and an unpinned image would let the
controller schedule unreviewed code. A visibly absent route is diagnosable; a
route mounted with invented authority is not.

> **See also:** [Trust boundaries & the network](/security-architecture/trust-boundaries)
> for the network layer that backs these identities, and
> [Run lifecycle](/security-architecture/run-lifecycle) for the bootstrap and
> proof-key exchange in context.
