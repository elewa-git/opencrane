# @opencrane/backend/agents/personal/memory — memory fact catalog

> [backend](../../../../README.md) › [agents](../../../README.md) › personal › memory

## What it owns

This package is part of the **personal-agent product**. As a user's agent works, it learns durable
**memory facts** — things worth remembering across conversations ("the user prefers UK spelling").
The full text of those facts is not stored here: it lives in **Cognee**, a separate memory service
that OpenCrane runs. This package owns the **catalog** — the index of *metadata and provenance* about
each fact: which dataset it belongs to, its Cognee identifier, a digest of its content, how sensitive
it is, whether the user consented, and exactly where it came from.

The reason for the split is a newcomer's first question: *why keep only metadata?* Because Cognee is
the durable home for content, and copying that content into OpenCrane's own database would duplicate
it and risk the two drifting apart. So this catalog records a **content digest** — a short fingerprint
of the fact (CAS-style: content-addressed storage, where a value is named by the hash of its bytes) —
never the fact text itself.

```
 Cognee accepts durable fact content
          │  external id · content digest · source · consent · sensitivity
          ▼
 ┌──────────────────────────────┐
 │    memory  ◄── HERE           │  one explainable source? valid digest? consented?
 └──────────────────────────────┘
          │  recorded (catalog row + outbox intent) / denied (+ reason)
          ▼
 OpenCrane catalog  ── later explained, corrected, or superseded
```

**In this flow:** Cognee memory service *(durable content store, external)* ·
[artifacts/store](../../../../artifacts/store/main/README.md) *(one allowed fact source is an artifact revision)*

The use case requires exactly **one** provenance source per fact — an artifact revision, a
conversation message, or an explicit user statement — plus a valid SHA-256 content digest, before it
persists anything. Invariant: a catalog row and its downstream event (the "outbox intent" that tells
the rest of the system a fact was recorded) commit together in one transaction, so the catalog can
never claim a fact Cognee does not have. Repeat deliveries are treated as success (idempotent) via the
idempotency key, while a retired dataset or a conflicting correction fails closed.

## Public surface

- `__RecordMemoryFact(repository, command)` — the single use case: validate provenance, then record catalog metadata atomically.
- `RecordMemoryFactCommand` / `RecordMemoryFactResult` — the request and the stable allow/deny outcome.
- `MemoryFactSource` — the one-of-three provenance reference (artifact revision · message · explicit statement).
- `AtomicRecordMemoryFactResult` — the raw persistence outcome the repository returns.
- `MemoryCatalogRepository` — the persistence port a caller must implement (or inject).
- `PrismaMemoryScopeSource` — the admission-time adapter that freezes only active, consented facts
  recorded by the personal-run owner. Its policy is explicitly `pinned-only`: this slice never gives
  the runtime a broad dataset search capability.

## Boundary

Consumed by the personal-agent memory-writing path. It never stores durable fact content — that stays
in Cognee — and it never accepts a fact without an explainable source. Storage is injected through
`MemoryCatalogRepository`, keeping the use case pure.

## Dependency direction

Tagged `scope:personal-memory`: it may depend only on `scope:artifacts` (to reference an artifact
revision as a source), `scope:personal-memory`, and `scope:shared` — never on apps or sibling domains.

## Data & persistence

Persists catalog metadata and a Cognee-outbox intent in one transaction through the injected
repository. Postgres-level behaviour is exercised by the `test:sql` target (`tests/memory-authority.sql`).

## See also

- Parent index: [agents](../../../README.md)
- Siblings: [conversations](../../conversations/main/README.md) · [runs](../../runs/main/README.md) · [personas](../../personas/main/README.md)
