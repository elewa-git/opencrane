# Language-neutral maintainability

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

## Purpose

OpenCrane uses several implementation languages, but the same architectural failure can occur in
all of them: one source file gradually becomes the owner of unrelated responsibilities while every
individual change still looks locally reasonable.

The maintainability gate catches that growth early. It applies across the implementation languages
listed in the committed policy, including deployment shell, Terraform, and Prisma schema modules.
Language-specific guides may add stricter conventions, but they cannot weaken these shared
ownership rules. SQL baselines, YAML manifests, and data artifacts stay under their owning
schema/configuration review because raw line growth is not a useful module-boundary signal for
those declarative artifacts.

## What the mechanical gate means

Run:

```bash
npm run check:module-growth
npm run check:module-growth -- --diff <base-ref>
```

The checker emits review candidates when a changed production file:

- grows beyond 350 lines;
- adds more than 150 lines in one change; or
- grows beyond the 500-line maximum.

Crossing or increasing beyond 500 lines is an error unless an active, exact-path exception exists in
[`module-growth-policy.json`](module-growth-policy.json). Existing oversized files are not
grandfathered for further growth: reducing them is allowed, increasing them is not.

These numbers are deliberately language-neutral and diff-scoped. They are an early-warning system,
not proof of bad architecture. Generated code, dependencies, build output, migrations, fixtures, and
tests are excluded.

## What the architecture review must prove

When the checker reports a candidate, inventory the module's independently changing
responsibilities. Useful categories include:

1. configuration and identity loading;
2. external transport or provider I/O;
3. process or request orchestration;
4. domain validation and policy decisions;
5. protocol or DTO translation;
6. persistence and transaction ownership;
7. retry, cancellation, and terminal-state handling;
8. observability and lifecycle management.

Split the module when the inventory demonstrates several cohesive owners, a hidden dependency
direction, coordinated edits across unrelated concerns, or a core path that cannot be tested without
constructing the whole process. Do not split a cohesive algorithm merely to satisfy a line target,
and do not move code into generic `shared`, `common`, `helpers`, or `utils` dumping grounds.

Each extracted component must name:

- what it consumes and produces;
- which authority or invariant it owns;
- what it must never own;
- its dependency direction;
- its failure, retry, and concurrency semantics; and
- the public test seam that proves the boundary.

## Agent flow

### Before implementation

Run the module-growth checker against the intended base. If it reports a candidate, write the
responsibility inventory and proposed file/folder map before adding code. Invoke the architecture
gate when the module already crosses a threshold or the proposed change adds a new responsibility.

### During implementation

Keep composition roots declarative. Put domain behaviour, persistence authority, external adapters,
and protocol translation under their cohesive functional owners. A helper extraction is not a split
when the original module still coordinates every detail and remains the only testable entrypoint.

### Before commit

Run the checker again, then run the maintainability review dimension. Reviewers must verify a
concrete ownership bypass, duplicated invariant, hidden ordering dependency, coordinated-edit
hazard, or core-path test gap. File or function length alone is never a finding.

## Exceptions

An exception is a temporary architectural debt record, not a permanent ignore. It must:

- match one exact repository-relative path;
- name an accountable owner;
- explain why the module is currently cohesive or why the split is blocked; and
- expire on an ISO `YYYY-MM-DD` date.

Broad globs and non-expiring exceptions are not supported. The checker fails closed on malformed or
expired entries.
