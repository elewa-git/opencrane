# Data authority

Where truth lives, and how it defends itself. Previous pages covered who may act
([capabilities](/security-architecture/capabilities)) and who is talking
([workload identity](/security-architecture/workload-identity)); this page covers
what they ultimately protect: the platform's durable state.

## One authority, one byte store

OpenCrane keeps durable state in exactly two places, each with one job:

- **Postgres** is the *product authority* — the single source of truth for every
  product record: agents and their revisions, runs and their events, messages,
  grants, approvals, personas, artifact and skill catalogues, membership, audit.
  If Postgres doesn't say it happened, it didn't happen.
- The **artifact store** holds *canonical bytes* — file content, addressed by its
  own SHA-256 hash — behind the artifact service's leased write path. Postgres
  keeps the catalogue (which artifacts exist, their lifecycle and provenance);
  the store keeps only the bytes.

Nothing else is authoritative. Runtime workspaces are disposable scratch, caches
are hints, and event streams are projections of committed rows — never the other
way round.

## One database server per silo, one credential per database

Each silo (one customer's isolated environment) runs **one Postgres server** —
a single CNPG-managed cluster — hosting a separate **logical database per
platform component**: the OpenCrane product authority, the integration gateway
(Obot), the model gateway (LiteLLM), and observability (Langfuse), with the
fleet registry alongside where deployed.

Sharing the server is an efficiency decision; sharing *access* is not allowed:

- every database has its **own owner role** with rights over that database only —
  no cross-database grants, no shared owner account;
- every database publishes its **own credential Secret**, whose connection URI
  reaches only that database as only that role.

A leaked or rotated credential therefore has a blast radius of exactly one
database. Isolation between components comes from roles and credentials (plus
the network policies of the previous page) — not from paying for idle database
servers per component.

::: info Decision status
This topology is decision **D1** (2026-07-19), reaffirming the one-server-per-silo
model in ADR 0002 and adding per-database roles and credentials. The deploy path
is being realigned to it; interim builds may still show one CNPG cluster per
component.
:::

## Triggers: the schema defends itself

Application code enforces the rules of the previous pages — but application code
has bugs, and a future migration or an operator with `psql` bypasses it entirely.
So the most safety-critical invariants are enforced a layer lower, as
**database triggers**: functions Postgres itself runs on every write, refusing
illegal changes no matter who makes them.

Around forty such guards ship with the schema. They fall into four families:

**Immutability.** Facts, once recorded, cannot be edited or deleted — only
superseded by new rows. Published agent revisions, run input snapshots,
conversation messages and run events, capability catalogue revisions, verified
membership assertions, artifact lineage: all reject `UPDATE`/`DELETE` at the
database. The audit ledger is append-only by trigger, not by convention.

**Closed lifecycles.** Records that change state may only move along their
declared state machine. A run may go `accepted → queued → assigned → running →
completed/failed/cancelled` — and a trigger rejects any other transition, makes
`started_at` write-once, and freezes terminal coordinates. Services, revisions,
personas, skills, artifacts, and memory facts each have the same treatment.

**Fencing.** The guards that make stale actors harmless. A workload assignment
must target the *current queued* attempt; a bootstrap may be consumed exactly
once, and only by the current *assigned* attempt — so a delayed or replayed
bootstrap from attempt 1 can never start attempt 2. A run's execution subject is
immutable after admission. Run events must arrive with contiguous sequence
numbers, and nothing can be appended after a terminal event. These are the
database's half of the run-integrity story the
[run lifecycle page](/security-architecture/run-lifecycle) tells from the top.

**Cross-record consistency.** Constraint triggers hold multi-row invariants: an
agent service's active revision must be a *published* revision of that service; a
skill assigned to a revision must remain published; persona approval requires a
completed interview, the exact reviewed template, and three-to-five insights;
artifact lineage may never cross a silo.

The practical consequence: even a compromised server process, writing to
Postgres with valid credentials, cannot rewrite history, skip a state, resurrect
a stale attempt, or forge an approval trail. Illegal states are unrepresentable.

## The outbox: state change and side effect, atomically

When a state change must trigger work elsewhere (a new run attempt must reach
the controller, a finalised artifact must be indexed), OpenCrane uses the
**transactional outbox** pattern: the state change and an *outbox event row*
commit in the same database transaction. A dispatcher then claims and publishes
outbox rows with bounded, lease-based retries.

Because the pair is atomic, there is no window where a run exists but its
request to the controller was lost, or vice versa. The outbox rows are
themselves trigger-guarded — delivery evidence is append-only, claims advance a
delivery counter by exactly one, and an event for a stale attempt is rejected.

## The artifact store: content addressing

The byte store is a **CAS** — a content-addressed store. An artifact's address
*is* the SHA-256 hash of its bytes, so an address can never point at the wrong
content: fetch it, hash it, and you have verified it.

Writes follow the leased protocol of the
[trust boundaries page](/security-architecture/trust-boundaries#2-artifact-service-leased-writes),
with crash-safe mechanics underneath: bytes are staged privately and fsynced,
then *hard-linked* into place — an operation the filesystem makes atomic and
that fails rather than overwrites, so a concurrent identical upload succeeds
idempotently and a crash at any moment leaves either the complete verified
object or nothing. One store per silo, deduplicated by digest, on one expandable
volume.

## Fresh provisioning

The platform is built to be provisioned **fresh from its target artifacts** — no
imported estate, no data transformed from a predecessor system. A schema
reconciliation Job applies the full migration history (including every trigger
above) before the server rolls out, and blocks the rollout if it fails. A
dedicated silo-provisioner Job — designed, not yet built — will own deterministic
creation of the fresh stores and their per-database credentials.

Durable stores live on explicitly mounted volumes that support online expansion,
grow before exhaustion, and retain data until explicit authorised deletion.
Application updates remount the same volumes and resume canonical state — they
never migrate or transform it.

> **See also:** [Run lifecycle](/security-architecture/run-lifecycle) — the
> run-event, steering, and snapshot machinery these guarantees exist to protect.
