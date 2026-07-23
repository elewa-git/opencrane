# Agent delegation (child runs)

Your assistant does not have to do everything itself. It can delegate a task to another agent —
a specialist, a restricted sandbox, or a copy of itself working on a slice of a bigger job. In
OpenCrane every such delegation is a **child run**: a full agent run with its own identity, its
own budget, its own capability set, and its own audit trail, linked to the run that spawned it.

::: info Target design
Child runs build on the run authority that is already implemented (run trees, capability proofs,
input snapshots). The spawn tool and runtime behaviour land with the personal-agent runtime
(Phase E of the [platform architecture](https://github.com/elewa-git/opencrane/blob/main/docs/design/personal-agent-platform-architecture.md);
tracked in [#320](https://github.com/elewa-git/opencrane/issues/320)).
:::

## Two ways to "use another agent"

Not every sub-task deserves a child run. The platform distinguishes two flavours, and the
difference is a security boundary, not a style choice:

| | In-process specialist (agent-as-tool) | Governed child run |
| --- | --- | --- |
| What it is | A focused sub-context inside the **same** run | A **separate** `AgentRun` in the run tree |
| Identity & capabilities | The parent's, unchanged | Its own, always **smaller** than the parent's |
| Budget | The parent's | Carved from the parent's remaining budget |
| Lifetime | Dies with the parent's attempt | Independent; survives the parent's pod |
| Audit trail | Part of the parent's record | Its own runs, approvals, and receipts |
| Typical use | Lens switches, summaries, judging, clean-context skill execution | Different authority, real spend, long-running or untrusted work |

**Rule of thumb:** if the sub-task only changes *what's in context* (a prompt, a persona lens, a
slice of documents), keep it in-process. If it changes **who** (capabilities), **how much**
(budget), or **how long** (lifetime), it must be a child run. The in-process kind is a toolkit
convenience; the governed child run is the architecture feature.

A third case — the user consciously *entering* another agent — is a true handoff and is
deliberately rare: specialist agents are normally invoked as tools so the personal assistant
remains the manager and final voice.

## The run tree

Every run records its place in a tree: a required root and an optional parent. A child can spawn
its own children under the same rules, so delegation forks recursively — and the whole tree stays
accountable:

- **Cost rolls up.** Every node shares the root run's identity, so "what did this task cost,
  including everything it delegated" is one query. See [Manage cost](/guide/budgets).
- **Limits are enforced at spawn time**: depth cap, fan-out cap, and child budgets carved from
  the parent's remainder. A runaway delegation tree cannot drain the parent.
- **Audit sees the tree.** Each child's proposals, approvals, and execution receipts are recorded
  against *its* identity, not blurred into the parent's. See [Review activity](/guide/audit).

## The parent brokers all context

There is no agent-to-agent channel. The run tree is the protocol:

1. **Context in.** A child sees exactly what its parent puts in its immutable input snapshot —
   selected messages, memory facts, artifact and skill revisions. Nothing else. The snapshot
   digest makes that choice permanent and auditable.
2. **Context out.** The child's result — terminal state, output, artifact receipts — returns to
   the parent as the spawn tool's result. A child failure surfaces as a tool error, so a parent
   cannot silently ignore what it delegated. Fire-and-forget does not exist.
3. **Siblings are isolated.** One child's output reaches another child only if the parent
   explicitly includes it in the second child's snapshot. The parent brokers all context between
   its children.

Because a child can never *read* anything — it can only *be given* things — the question "which
agents can access context from which agent" is answered at spawn time: the parent may only share
what its own capabilities and the content's access rules allow it to read, and the grant is
recorded in the snapshot.

## Capabilities only shrink

Delegation is monotonic. The effective rights of any run are:

```text
agent revision ceiling
  intersect triggering-user delegation, when interactive
  intersect current resource grants
  intersect immutable short-lived run capability
```

A child receives a capability set no larger than its parent's — usually much smaller. Two
consequences worth designing around:

- **Least-privilege specialists.** The personal assistant does not need the accounting
  integration; the finance specialist it delegates to does — and only that.
- **Untrusted-input containment.** Process an inbound email or uploaded document in a child with
  near-zero capabilities. If the content carries injected instructions, there is nothing for them
  to act with; the parent receives only the sanitised result.

The personal/managed boundary stays one-way: a personal assistant may invoke a managed agent
through an authorised tool contract, but that managed agent cannot inspect the personal
workspace, thread, memory, or files. It receives only explicitly shared artifact versions and
declared input fields.

## When agents reach for a child run

- **A different capability profile** — the task needs an integration or scope the parent
  deliberately does not hold.
- **Untrusted input** — containment, as above.
- **Long-running or scheduled work** — research jobs and batch processing that outlive the
  conversation and survive restarts, because a child has its own fenced attempts.
- **Budget isolation** — give a speculative task a fixed allowance.
- **Fan-out** — split a large job across parallel children, each seeing only its slice, then
  merge; recursively if needed.
- **Separate accountability** — high-stakes actions whose approvals should bind to the child's
  identity and be independently auditable.

Skills interact with all of this — a skill picks its execution tier by what it demands. See
[Agent skills](/guide/skills#how-skills-execute).

> See also: [Control access](/guide/permissions) · [Manage cost](/guide/budgets) ·
> [Review activity](/guide/audit) · [Architecture](/advanced/architecture)
