# @opencrane/<import-alias> — <four-to-six word essence>

> <area> › <group> › <this package>   ← link each ancestor to its index README

<!--
Fill every placeholder against the package's real source (src/index.ts, project.json,
eslint.config.mjs depConstraint). Write for a junior developer new to the platform: explain every
acronym and repo concept in plain terms, in this file. Delete the optional sections and any bracketed
guidance that does not apply, and delete this comment. Keep the section order. See
docs/agents/package-docs.md for the standard, the voice rules, and worked examples.
-->

## What it owns

<(a) Place in the architecture: which plane/flow this belongs to and its nearest neighbours.>

<(b) Its role in the process — pick ONE:
  - a step in a larger flow: what runs before/after, what it consumes, what it hands off; or
  - a full process: an ordered list of the stages it runs.>

<(c) A fenced ASCII diagram of that flow, with THIS package highlighted (◄── HERE / a box) and
labelled arrows. Then the "In this flow:" legend below. Pure type/util packages skip the diagram.>

```
 upstream step .......... what it produces
        │
        ▼
 ┌───────────────────────┐
 │   <this pkg>  ◄── HERE │
 └───────────────────────┘
        │  <what it hands off>
        ▼
 downstream step
```

**In this flow:** [<other package>](../<path>/README.md) · [<other package>](../<path>/README.md)

<(d) Invariant & failure: what it guarantees, and what breaks if it is wrong.>

## Public surface

<The load-bearing exports from `src/index.ts`, each with a one-liner. For an app, `Entrypoint: …`.>

## Boundary

<Who consumes it, what it deliberately does not do, and any fail-closed behaviour.>

## Dependency direction

Tagged `scope:<tag>`: it may depend only on <…> — never on apps or sibling domains.

<!-- Optional — include only when it applies: -->
## Data & persistence

<Prisma models/tables owned; target baseline owner and clean-database setup boundary.>

## Runtime & config

<Required env/config and defaults. Apps and infra only.>

## Status

<Banner for blue-frozen / deletion-boundary packages. Delete otherwise.>

## See also

- Parent index: [<group>](../README.md)
- Siblings: [<sibling>](../<sibling>/README.md)
