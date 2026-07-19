# Security & architecture

How OpenCrane keeps an AI agent platform safe to run: what the pieces are, who is
allowed to do what, and why every check refuses rather than guesses when something
is off. This chapter is the ground truth for the **target (green) platform** — the
authority model and run architecture the current engineering programme is building.

You don't need this chapter to *use* OpenCrane. Read it when you want to trust it:
before an internal security review, before operating a silo in production, or
before integrating against the platform's guarantees.

## The one idea everything follows

**Fail closed.** At every layer — authorisation, identity, network, database — the
platform's default answer is *no*. Access exists only where an explicit, verifiable
grant says *yes*, and anything missing, expired, stale, mismatched, or replayed is
refused rather than repaired.

That single idea shows up as:

- **No ambient credentials.** A workload holds nothing that is useful somewhere
  else. Tokens are bound to one audience; capabilities are bound to one action.
- **No implied trust.** Every hop re-verifies identity. The component in front of
  you being "inside the cluster" earns it nothing.
- **No silent defaults.** Incomplete configuration disables a feature visibly
  instead of running it with guessed values.

## The cast

Five workloads cooperate to run an agent, and each one is deliberately weak on its
own:

```
 outside world
      │
      ▼
┌───────────────┐   asks "who is this,     ┌──────────────────┐
│ channel-proxy │──— may they connect?" ──▶│ opencrane server │◀── Postgres
│  (the edge)   │◀── authorised target ────│  (the authority) │    (canonical state)
└───────────────┘                          └──────────────────┘
                                              │            ▲
                                 desired work │            │ signed lease /
                                 (claimed)    │            │ signed receipt
                                              ▼            │
                                    ┌──────────────────┐ ┌─┴───────────────┐
                                    │ agent-controller │ │ artifact-service │
                                    │ (sole mutator)   │ │ (byte store)     │
                                    └──────────────────┘ └──────────────────┘
                                              │ creates (suspended)
                                              ▼
                                    ┌──────────────────┐
                                    │  agent-runtime   │
                                    │  (inert worker)  │
                                    └──────────────────┘
```

- The **OpenCrane server** (`apps/opencrane`) is the only component that decides
  anything: identity, membership, grants, run state. It is also the only component
  that writes product state to Postgres.
- The **channel proxy** (`apps/channel-proxy`) terminates untrusted client
  connections at the edge. It makes no decisions — it asks the server who may talk
  to whom, and relays exactly what it is told.
- The **agent controller** (`apps/agent-controller`) is the single component
  allowed to create agent workloads in Kubernetes. It executes the server's
  decisions; it never makes its own.
- The **artifact service** (`apps/artifact-service`) stores file bytes. It accepts
  a write only against a signed, short-lived lease and answers with a signed
  receipt.
- The **agent runtime** (`apps/agent-runtime`) is where agent work actually
  executes — and it is deliberately powerless: no Kubernetes rights, no standing
  network paths, nothing worth stealing.

Everything durable lives in exactly two places: **Postgres** (the product
authority — runs, messages, grants, approvals, audit) and the **artifact store**
(canonical file bytes, addressed by content hash).

## How the chapter is organised

Read in order — each page builds on terms the previous one introduced:

1. **[Capabilities & proofs](/security-architecture/capabilities)** — how a single
   action gets authorised: single-action capabilities, proof-of-possession
   signatures, digests, replay protection, and grant evaluation.
2. **[Workload identity](/security-architecture/workload-identity)** — how
   machines prove who they are: ServiceAccounts, audience-bound tokens,
   TokenReview, and why the controller is the only workload mutator.
3. **[Trust boundaries & the network](/security-architecture/trust-boundaries)** —
   the four boundaries above in depth, plus the default-deny network that backs
   them.
4. **[Data authority](/security-architecture/data-authority)** — Postgres as the
   single source of truth, per-database credentials, the database triggers that
   make illegal states unrepresentable, and the content-addressed artifact store.
5. **[Run lifecycle](/security-architecture/run-lifecycle)** — how a run moves
   from accepted to completed, why every event is committed before it is
   streamed, how mid-run steering works, and where sandboxed execution fits.

> **Grounding.** This chapter documents the decisions recorded in
> [ADR 0008 (target agent contracts and workload identity)](https://github.com/italanta/opencrane/blob/main/docs/adr/0008-target-agent-contracts-and-workload-identity.md)
> and [ADR 0009 (OpenSandbox sandbox-job substrate)](https://github.com/italanta/opencrane/blob/main/docs/adr/0009-opensandbox-sandbox-job-substrate.md),
> as implemented by the Phase D platform slices. Where a mechanism is designed but
> not yet fully built, the page says so explicitly.
