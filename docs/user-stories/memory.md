# Memory user stories

## Feature intent

Give users transparent control over durable personal memory while preserving the authority boundary:
every read and write goes through OpenCrane's memory gateway, and every admitted recall names the
exact gateway-native dataset frozen into the run snapshot.

Current status: `API blocked`, `UI missing`, `Needs decision` for lifecycle and recovery details.
There is no public memory API. Internal admission-time recall does not authorize a memory-management
screen.

## MEM-01 — Understand whether memory is available

**As a** user, **I want** to know whether personal memory is enabled and healthy **so that** I
understand whether the agent can recall durable facts.

Acceptance criteria:

- The UI distinguishes disabled, unavailable, ready, indexing, and degraded states.
- It never infers readiness from the existence of a deployment or dataset identifier alone.
- No internal dataset UUID, gateway token, or Cognee credential is exposed.

Status: `API blocked`; no public capability/readiness projection exists.

## MEM-02 — Review remembered facts and provenance

**As a** user, **I want** to see durable facts, their source, consent, sensitivity, and last use **so
that** memory is transparent rather than hidden prompt context.

Acceptance criteria:

- OpenCrane-projected metadata is clearly separated from fact content held by the memory service.
- Each fact has a stable reference, provenance, consent and sensitivity presentation.
- Cross-user, cross-silo, and non-consented content fail closed without existence disclosure.

Status: `API blocked`; no public list/detail endpoint exists.

## MEM-03 — Record an intentional fact

**As a** user, **I want** to explicitly save a fact with consent and sensitivity **so that** useful
information becomes durable through a recoverable write lifecycle.

Acceptance criteria:

- Pending persistence, indexing, ready, failed, retrying, and duplicate states are durable.
- Success is not reported before the fact and its required index state are recoverably recorded.

Status: `API blocked`; production record currently fails closed.

## MEM-04 — Correct a remembered fact

**As a** user, **I want** to correct a fact without erasing its audit history **so that** future
recall uses the reviewed replacement.

Status: `API blocked`; production correction currently fails closed.

## MEM-05 — Forget a remembered fact

**As a** user, **I want** to forget a fact and reconcile its indexes **so that** revoked memory is not
returned to future runs.

Acceptance criteria:

- Confirmation explains content, index, provenance, audit, and recoverability consequences.
- Removal-pending is distinct from removed.
- Future run admission revalidates revocation rather than relying on stale recall.

Status: `API blocked`; production forget currently fails closed.

## MEM-06 — Inspect memory used by a run

**As a** user, **I want** a safe explanation of which remembered facts influenced a run **so that** I
can understand, challenge, or correct the result.

Acceptance criteria:

- The run references only gateway-minted safe fact references/digests frozen at admission.
- The UI does not expose raw internal snapshot, dataset, or authorization coordinates.

Status: `API blocked`; no public run-memory explanation endpoint exists.
