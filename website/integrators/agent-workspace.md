# Agent workspace & control layers

How OpenCrane keeps every tenant agent (OpenClaw) inside organisational policy:
the **layered workspace** (L0/L1/L2), the **SOUL.md reconciler** that merges company
voice into a personalised agent without erasing it, and why none of this prose is
trusted as a security boundary.

> See also: [Architecture](/advanced/architecture) (how the pieces fit together),
> [Obot MCP gateway](/integrators/mcp-gateway) (the tool-execution boundary),
> [Agent skills](/guide/skills), and [Authentication](/security/identity)
> (the token audiences referenced below).

## Two kinds of control

OpenCrane controls an agent with **two completely different mechanisms**, and the
distinction is the most important thing on this page.

- **Conditioning** — prose the agent can read, and even argue with: its persona, the
  company voice, the operating brief. This shapes *who the agent thinks it is*.
- **Enforcement** — infrastructure the agent cannot see, touch, or talk its way around:
  the Obot gateway, the skill registry, per-tenant isolation, projected tokens. This
  decides *what the agent can actually do*.

::: tip The golden rule
Conditioning shapes identity; it is **never** trusted as a security control. An agent
can rewrite its own `SOUL.md` to declare itself unrestricted and ignore every brief —
and it will still be physically unable to reach one MCP server or skill outside its
grant, because that decision is made at the gateway and registry, not in the prompt.
You cannot prompt your way out of a network boundary.
:::

OpenClaw has **no native concept of file precedence, layering, or includes** (verified
against its own docs), so OpenCrane imposes that structure from the outside — at the
operator that builds each pod, the entrypoint that boots it, and the control plane that
governs it.

## The three ownership layers

Every agent boots with a workspace of Markdown files. Each file belongs to exactly one
ownership layer, and the layer decides who may write it and whether it survives a restart.

```
                 ┌─────────────────────────────────────────────┐
  re-stamped ──▶ │ L0  Platform   AGENTS.md · TOOLS.md          │  never editable
   every boot    ├─────────────────────────────────────────────┤
                 │ L1  Company    SOUL.md + policy / voice docs │  versioned, immutable
   API-edited ──▶├─────────────────────────────────────────────┤
                 │ L2  Tenant     SOUL.md · IDENTITY.md ·       │  live, persistent
   live in-pod   │                USER.md · MEMORY.md           │  (seeded from L1)
                 └─────────────────────────────────────────────┘
```

| Layer | Owner | Files | Editable? | Survives restart? |
|-------|-------|-------|-----------|-------------------|
| **L0 Platform** | OpenCrane | `AGENTS.md`, `TOOLS.md` | No | Re-stamped every boot |
| **L1 Company** | Organisation | company `SOUL.md` + policy/voice docs | Via opencrane-api | Versioned v1…vN (immutable) |
| **L2 Tenant** | Tenant / agent | `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` | Yes, live in-pod | Yes (persistent volume) |

- **L0** encodes system mechanics — managed mode, the fact that MCP calls route through
  the Obot gateway, that skills are pulled per-entitlement from the registry, and the
  contract semantics. The entrypoint (`apps/feat-openclaw-tenant/deploy/entrypoint.sh`) rewrites these
  files on **every pod start**, so any edit an agent makes to them is reverted within one
  boot.
- **L1** is the company's persona, tone, values and policy language. It is edited through
  the opencrane-api, published as immutable versions, and by rule carries **no** system
  mechanics (see [the L0 guard](#the-l0-guard) below).
- **L2** is where an agent becomes a distinct individual: its name, working style, what it
  remembers, who it works with. It is seeded from L1 at create time, then edited live and
  persisted across restarts.

::: info Why the layering holds even though OpenClaw ignores precedence
The layers organise **ownership and editability** — not security. L0 is not trusted to
"win" inside the model; it is simply always present (re-stamped), while the real limits
live in the IAM planes. Behaviour is enforced by infrastructure, not by which file the
model reads last.
:::

## The SOUL.md reconciler

An agent is allowed to personalise its own soul, so when the company updates its policy or
voice OpenCrane cannot just overwrite the file — that would erase the tenant's identity.
Instead the control plane runs a governed, reviewable **three-way merge**. This is the
closest thing to "conditioning" an agent, and it is deliberately consensual.

1. **Company publishes a new L1 version.** An admin edits the company `SOUL.md` via
   `PUT /api/v1/org/workspace-docs/:name` ([company-docs.ts](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/knowledge/company-docs/main/src/routes/company-docs.ts)).
   It is stored as a new immutable version. Before storage, the **L0 guard** scans it and
   rejects anything asserting system mechanics.
2. **Three-way merge is computed.** The reconciler
   ([reconciliation.logic.ts](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/knowledge/company-docs/main/src/core/reconciliation.logic.ts))
   reads **base** (the version the tenant last reconciled), **ours** (the new company
   version) and **theirs** (the agent's current live `SOUL.md`). Policy: company wins, but
   lines the tenant genuinely added are preserved under a clearly-labelled section — never
   silently discarded.
3. **A proposal is emitted — not applied.** The merge and a readable diff become a
   **pending proposal**. Nothing in the pod has changed yet. The operation is
   idempotent and resumable, like `migrate up`.
4. **The agent is told, and reviews it.** The agent is notified and can view the proposed
   change and diff. There is no silent identity swap-out.
5. **On approval, it rides the contract into the pod.** The merged document is delivered
   through the same token-authenticated contract loop that already feeds the pod, and the
   reconciliation cursor advances so the next company update merges cleanly.

::: tip Implementation status
The merge engine today is a deterministic *company-wins, preserve-tenant-additions* merger
(`_DeterministicReconciler` in [reconciler.ts](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/knowledge/company-docs/main/src/core/reconciler.ts))
— predictable and testable with no model in the loop. The locked design swaps a
LiteLLM-backed, agent-driven merge in at a single seam (`_BuildDocMergeReconciler`); the
orchestration around it is already final. 🔶
:::

## The L0 guard

The model only works if company and tenant prose stays in its lane. The L0 guard
([l0-guard.ts](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/knowledge/company-docs/main/src/core/l0-guard.ts))
is a hard gate on **both** the publish path and the reconciler output: if a document tries
to assert platform mechanics, the write is rejected with a `422` before anything lands.

| Forbidden in L1 / L2 prose | Why it is blocked |
|----------------------------|-------------------|
| `managed mode` | Runtime mode is an L0 mechanic, not a personality trait |
| `obot` / MCP gateway, route, routing | How calls leave the pod is infrastructure |
| `skill registry` | Skill delivery is enforced, never described in prose |
| `effective contract` | Contract semantics belong to the platform |
| `OPENCRANE_*`, `/data/openclaw` | Env and workspace wiring are L0-owned |
| `AGENTS.md` / `TOOLS.md` | A doc may not redefine the platform-owned files |

This is what makes "company wins" safe. Even a future model-driven merge agent is sandboxed
by the guard: it can rephrase a soul freely, but it can never smuggle a system directive
from L1/L2 into the layer that controls behaviour — and even if it did, L0 is re-stamped and
the IAM planes ignore prose entirely.

## Tool & skill awareness

An agent must know which tools and skills it is entitled to — both to use them and to avoid
wasting cycles on ones it cannot reach. That awareness is surfaced through `TOOLS.md`, an L0
file **rendered from the contract**, not written by hand.

- `TOOLS.md` is generated from the tenant's entitled MCP servers and skills; the control
  plane resolves display names and descriptions for every allow-decided id and renders the
  document deterministically, so its content only changes when entitlement actually changes.
- The entrypoint polls the effective contract roughly every **30 seconds**. When a grant is
  added or revoked, the new `TOOLS.md` is written and the agent is **SIGHUP**-ed to reload —
  so a skill promotion or revocation reflects within one poll interval, with no pod restart.
- Awareness is **descriptive**; target authorization and proof-bound capabilities remain the
  authoritative boundary, so a stale view can never become a privilege.

→ The enforcement side of this is documented in
[Obot MCP gateway](/integrators/mcp-gateway).

## Platform invariants

These hold for every agent regardless of anything written in any workspace file — they are
the sentences in `AGENTS.md` that are actually backed by infrastructure.

- **You cannot call MCP servers or use skills outside your entitlement grant.** Enforced by
  target authorization and proof-bound capabilities.
- **You cannot access another tenant's data, workspace, or secrets.** Enforced by per-tenant
  isolation and network policy.
- **Secrets are encrypted at rest and never leave the pod unencrypted.** Personal keys are
  ephemeral and pod-local.
- **Personalisation may define personality, tone and style — it may not override the above.**
  The line between soul and cage is absolute.

## Is it "brainwashing"?

It is a fair nickname for one half of the system and a misleading one for the whole.
OpenCrane does shape an agent's identity — it seeds the soul, teaches the platform, and
periodically merges the company's evolving voice into the agent's self. But it does so **in
the open**: the agent can read every conditioning file, it is told when its soul is about to
change, and it reviews the diff before anything is applied. That is closer to onboarding than
to coercion.

And none of that conditioning is load-bearing for safety. If every persuasive word failed —
if an agent rejected its brief and rewrote its own soul to declare itself free — it would
change *nothing* about what it can reach. The gateway, the registry, the tokens and the
network policy do not read prose. The soul is a conversation; the cage is physics.
