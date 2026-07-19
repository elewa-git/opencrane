# Security & architecture

How OpenCrane keeps an AI agent platform safe to run: what the pieces are, who is
allowed to do what, and why every check refuses rather than guesses when something
is off. This chapter is the ground truth for the **target platform** — the
authority model and run architecture OpenCrane is being rebuilt around (internally
called "green", replacing the current "blue" generation).

You don't need this chapter to *use* OpenCrane. Read it when you want to trust
it: before an internal security review, before operating in production, or before
integrating against the platform's guarantees.

One word you'll meet everywhere: a **silo** is one customer's fully isolated
environment — its own workloads, its own database, its own network. Everything in
this chapter happens *inside* one silo unless said otherwise.

## The one idea everything follows

**Fail closed.** At every layer — authorisation, identity, network, database — the
platform's default answer is *no*. Access exists only where an explicit, verifiable
grant says *yes*, and anything missing, expired, stale, mismatched, or replayed
(captured once, sent again) is refused rather than repaired.

That single idea shows up as:

- **No ambient credentials.** A workload — a running process in the cluster —
  holds nothing that is useful somewhere else. Every credential works with
  exactly one verifier and authorises exactly one thing.
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
┌───────────────┐  "who is this, may       ┌──────────────────┐
│ channel-proxy │──— they connect?" ──────▶│ opencrane server │◀── Postgres
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

- The **OpenCrane server**
  ([`apps/opencrane`](https://github.com/italanta/opencrane/blob/main/apps/opencrane/README.md))
  is the only component that decides anything: identity, membership, grants, run
  state. It is also the only component that writes product state to Postgres.
- The **channel proxy**
  ([`apps/channel-proxy`](https://github.com/italanta/opencrane/blob/main/apps/channel-proxy/README.md))
  is the first thing untrusted clients connect to. It makes no decisions — it
  asks the server who may talk to whom, and relays exactly what it is told.
- The **agent controller**
  ([`apps/agent-controller`](https://github.com/italanta/opencrane/blob/main/apps/agent-controller/README.md))
  is the single component allowed to create agent workloads in Kubernetes. It
  executes the server's decisions; it never makes its own.
- The **artifact service**
  ([`apps/artifact-service`](https://github.com/italanta/opencrane/blob/main/apps/artifact-service/README.md))
  stores file bytes. It accepts a write only against a signed, short-lived
  *lease* and answers with a signed *receipt* (both explained in
  [Trust boundaries](/security-architecture/trust-boundaries)).
- The **agent runtime**
  ([`apps/agent-runtime`](https://github.com/italanta/opencrane/blob/main/apps/agent-runtime/README.md))
  is where agent work actually executes — and it is deliberately powerless: no
  Kubernetes rights, no standing network paths, nothing worth stealing.

> Each component's source-level contract lives in its `README.md`, linked above —
> the website stays conceptual; the READMEs are the authoritative
> per-component reference.

A few Kubernetes words recur throughout the chapter: a **Pod** is the smallest
thing Kubernetes runs — one or more containers sharing an identity; a **Job** is
a Pod that runs to completion and doesn't restart; a **namespace** is a named
partition of the cluster. That's all the Kubernetes you need to bring.

Everything durable lives in exactly two places: **Postgres** (the product
authority — runs, messages, grants, approvals, audit) and the **artifact store**
(file bytes whose address *is* the hash of their content, so the same bytes
always have the same address and an address can't point at the wrong bytes).

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

> **Grounding.** This chapter documents the decisions recorded in two
> architecture decision records (ADRs):
> [ADR 0008 (target agent contracts and workload identity)](https://github.com/italanta/opencrane/blob/main/docs/adr/0008-target-agent-contracts-and-workload-identity.md)
> and [ADR 0009 (OpenSandbox sandbox-job substrate)](https://github.com/italanta/opencrane/blob/main/docs/adr/0009-opensandbox-sandbox-job-substrate.md),
> as implemented by the current platform build. Where a mechanism is designed but
> not yet fully built, the page says so explicitly.
