# Package documentation standard

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

Every package and every grouping directory carries a `README.md`, and together they form one
navigable tree: the root front door → area/group index maps → leaf package READMEs. A reader (or an
agent) can start anywhere and walk **up** for context or **down** for detail without ever hitting a
dead end. This file is the contract for that tree. Read it before writing or editing any `README.md`
under `libs/**` or `apps/**`.

## Who you are writing for

**A junior developer, new to OpenCrane and curious about it.** That single choice drives everything
below. Three rules are non-negotiable:

1. **Explain, don't assume.** If a reader would have to look a term up to follow a sentence, gloss it
   inline in one clause. Spell out every acronym on first use in the file — IAM (identity and access
   management), MCP (the Model Context Protocol for connecting tools), CAS (content-addressed
   storage), and so on.
2. **Self-contained.** Every README must make sense on its own. Explain the repo concepts it leans on
   — plane, silo, tenant, capability, reconciler — in plain terms *in that file*. Links to other
   docs are a bonus, never a substitute for a one-line explanation.
3. **Function over mechanism.** Lead with what the package *does*, in plain language. Precise
   mechanism and algorithm names (ES256, DPoP, RFC numbers, wire formats) belong in code comments and
   deep-dive docs — name them only when essential, and gloss them when you do.

House voice: UK English, sentence-case headings, active voice. No emoji, no marketing, no "simply".
State the constraint the code cannot show — never narrate line by line what the code already says.

## The three tiers

1. **Root [`README.md`](../../README.md)** — the project front door (what OpenCrane is, the vision,
   the top-level map). Owned by the `readme` agent; deep mechanism stays out of it.
2. **Area / group index READMEs** — one per grouping directory (`libs/frontend/`,
   `libs/backend/server/` and each group under it, `libs/models/`, `apps/_infra/`, …). Each is a
   **map**, not prose: a breadcrumb, a one-row-per-child table, the dependency rule for that tier, and
   a small diagram of the children.
3. **Leaf package READMEs** — one per package (the directory that holds `project.json`; for domain
   libs that is the `main/` directory). Most of this standard governs these.

Every tier-2 and tier-3 file **opens with a breadcrumb** and **closes with a See-also**. That
up/down linking is what makes the repo navigable — treat it as mandatory, not decorative.

- Breadcrumb (first line after the H1): `> backend › server › iam › authorization`, each ancestor
  linked to its index README, the current node in plain text.
- See-also (last section): link the parent index and the closest siblings, with relative repo paths.

## Leaf package README — fixed section order

Use these headings, in this order, in every leaf README. Omit an optional section only when it does
not apply; never reorder.

1. **Title** — `# @opencrane/<import-alias> — <short essence>`. Find the alias in `tsconfig.json`
   paths / `project.json` name. If a package has no alias, title it by its `project.json` name and
   say so.
2. **Breadcrumb** — see above.
3. **What it owns** — the heart of the document. See the next section.
4. **Public surface** — the load-bearing exports from `src/index.ts`, each with a one-liner (or
   `Entrypoint: …` for an app). Answer *what a caller imports*. Ground every name in the real barrel.
5. **Boundary** — who consumes it, what it deliberately does **not** do, and any fail-closed
   behaviour. Answer *how to use it correctly and where it stops*.
6. **Dependency direction** — the `project.json` scope tag and what it may / may-not import, from the
   matching `depConstraint` in `eslint.config.mjs`. One or two sentences.
7. *(optional)* **Data & persistence** — Prisma models/tables owned, target baseline owner and clean-database setup boundary. Include for
   any package with a Prisma adapter.
8. *(optional)* **Runtime & config** — required env/config and defaults. Include for apps and infra.
9. *(optional)* **Status** — a banner for blue-frozen / deletion-boundary packages, stated first.
10. **See also** — parent index + siblings.

**Bare minimum** (even the smallest stub): the titled purpose line (1), the breadcrumb (2), the
public surface (4), a boundary/dependency one-liner (5–6), and See-also (10).

## Section 3, "What it owns" — process-aware, plain, visual

This is where a newcomer decides whether they understand the package. Build it in four beats:

**(a) Place in the architecture** — one or two sentences: which plane or flow it belongs to, and its
nearest neighbours. The zoom-out that lets a reader locate the package before reading detail.

**(b) Its role in the process** — pick the mode that fits:
- *One step in a larger flow* → name the flow, then say what runs **before** it, what runs **after**,
  what it **consumes**, and what it **hands off**. The reader should be able to place it on a timeline.
- *A full end-to-end process* → document the process as an **ordered list of stages** the package
  runs, so this README becomes the flow reference for it.

**(c) A diagram** — a fenced ASCII box-and-arrow drawing of that flow, with **this** package
highlighted (`◄── HERE`, or drawn as a box). Label arrows with what flows along them. Keep it under
~12 lines and legible as plain text. Directly beneath the fence, add an **"In this flow:"** line that
links every *other* package appearing in the drawing to its README (relative paths) — markdown links
are inert inside a code fence, so this legend is what makes the diagram a cross-navigable graph.
(A README whose primary home is GitHub may instead use a `mermaid` diagram with clickable `click`
nodes.) The diagram is an anchor *inside* the prose, never a replacement: the words alone tell the
whole story; the drawing just makes the shape fast to grasp. Pure model/util/type packages, which
own no runtime flow, skip the diagram or use a one-line "used by" sketch.

**(d) Invariant & failure** — what the package guarantees, and what breaks if it is wrong.

### Worked example — a step in a process (`iam/authorization`)

> ## What it owns
>
> This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
> answers two questions: **who is making this request, and are they allowed to do this?** IAM keeps
> track of the people, the automated agents working on their behalf, and the rules for what each may
> touch.
>
> Authorization is the final yes-or-no step. Whenever an agent tries to do something that changes
> real data — save a file, call an outside tool, read from memory — the request stops here first, and
> this package decides whether to allow it. By this point another part of IAM has worked out *who*
> the agent is and handed this package a signed permission slip ("this agent may write this file");
> this package checks the slip is genuine and still valid, then answers allow or deny with a plain
> reason.
>
> ```
>  an agent wants to act  (write a file · call a tool · read memory)
>           │
>           ▼
>    channel-targets ......... works out WHO the agent is, issues a permission slip
>           │
>           ▼
>  ┌────────────────────────────┐
>  │   authorization  ◄── HERE   │  slip genuine? still allowed? not reused?
>  └────────────────────────────┘
>           │  allow / deny  (+ plain reason)
>           ▼
>    action router ........... carries out the effect, or refuses
> ```
>
> **In this flow:** `channel-targets` · the runtime action path
> *(in a real README each other-package name is a relative link to its own README, e.g.*
> `[channel-targets](../../agents/channel-targets/main/README.md)`*)*
>
> To decide, it confirms three things line up: the proof the agent gives that it really is who it
> claims, the permission slip issued earlier, and what the system can independently see about the
> agent right now. It then checks the action is within what both the person behind the agent and the
> agent's assigned role are allowed to do, and it remembers every slip it has accepted so the same one
> cannot be replayed to run an action twice. It is deliberately strict: anything missing, altered, or
> out of date is a "no". A mistake here can only ever refuse a legitimate request — never hand out
> access it should not.

### Worked example — a full process (`agents/personal/personas`)

> ## What it owns
>
> A **persona** is the saved personality and instructions an agent runs with. This package owns the
> **approval process** that turns a draft persona into the live one, end to end:
>
> ```
>  draft persona
>      │ 1. interview          capture the onboarding Q&A
>      ▼
>      │ 2. snapshot           gather the approval evidence
>      ▼                       (owner · 3–5 insights · the exact template used)
>      │ 3. validate ─────────► evidence incomplete?  →  denied
>      ▼
>      │ 4. approve + activate atomically swap in the new persona
>      ▼
>  active persona
> ```
>
> Invariant: only a fully evidenced draft becomes active, and the swap is atomic — a crash leaves the
> previous active persona intact, never a half-approved one.

## Depth profiles by package type

Right-size the README to the package — do not pad a pure-type package to look like an authority.
**Judge size by prose density, not total lines:** aim for 1–4 lines of prose per section, and let the
total fall where it falls once the mandatory structure (breadcrumb, the fixed section order, and — for
a package in a runtime flow — the ~10-line diagram + "In this flow:" legend) is in place. The
physical-line ranges below are the realistic totals *including* that structure, not a budget to trim
to; a backend authority with a diagram lands near the top of its range and that is correct.

| Type | Where | Emphasise | Realistic total |
|------|-------|-----------|-----------------|
| Backend domain authority | `libs/backend/server/*`, `libs/backend/agents/personal/*`, `libs/backend/artifacts/*` | the invariant it enforces, its persistence boundary, fail-closed reasons | 55–85 lines |
| Pure model / util | `libs/models/*`, `libs/util`, `libs/observability` | "pure, no I/O", the types/helpers it defines, who depends on it | 15–35 lines |
| Frontend feature / element | `libs/frontend/features/*`, `libs/frontend/elements/*` | the route/UI slice it owns, its store dependencies, `scope:web` rule, consumer | 30–55 lines |
| Frontend state (port/adapter) | `libs/frontend/state/*` | the gateway port it defines/implements, the HTTP surface it adapts, write-only invariants, consumer | 30–50 lines |
| Frontend core / platform | `libs/frontend/{core,platform}` | the cross-cutting primitives it holds, FORK-shared status | 30–55 lines |
| Deployable app | `apps/opencrane`, `apps/opencrane-ui`, `apps/channel-proxy`, `apps/artifact-service` | what it composes, trust/runtime posture, entrypoint, deploy unit | 45–100 lines |
| Vendored infra app | `apps/_infra/{cognee,litellm,obot,langfuse}`, `apps/postgres` | upstream link, **why we run it**, pinned image/version, config knobs, what OpenCrane owns vs the vendor | 30–55 lines |
| Server infra lib | `libs/server/_infra/*` | the runtime seam it owns, its sole consumer, what it must not import | 30–50 lines |
| Group / area index | grouping dirs | the child map table + the tier dependency rule + a child diagram | 25–45 lines |

If a README runs well past the top of its range, the fix is tighter prose per section (and dropping
optional sections that do not apply), never dropping a mandatory section or the diagram.

## Template

Copy [`README-TEMPLATE.md`](./README-TEMPLATE.md) into a new package and fill every placeholder.
Delete the optional sections that do not apply.

## Maintenance — this is part of the agent loop

Package docs drift the moment a contract changes, so upkeep is a definition-of-done item, not a
separate chore. Whenever you (a Claude Code lane or a Codex agent) change a package:

- **Change its exports, boundary, invariant, owned Prisma models, or config** → update that
  package's `README.md` in the **same** change. A diff that alters the public surface without touching
  the README is incomplete.
- **Add a package** → create its `README.md` from the template and add a row to the parent index.
- **Move or rename a package** → move its README, fix the breadcrumb/See-also, and update every index
  that lists it (and the central map in [`app-specific.md`](./app-specific.md)).
- **Delete a package** → the `reaper` gate removes its README and its index/map rows with it.

The review gate ([`workflow.md`](./workflow.md)) treats a contract change with a stale or missing
README as a finding. The `architecture` gate checks that a newly added package ships a README; the
`reaper` gate checks that a removed one takes its docs with it.
