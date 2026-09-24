# @opencrane/backend/agents/personal/memory — verified personal-memory selection

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › memory

## What it owns

This package owns personal-memory dataset selection, consented fact metadata, and the durable
operation state for Remember, Correct, and Forget. Existing run-input reads receive the caller's
admission transaction. The operation repository receives the composite command transaction and
stores only encrypted source coordinates, provider identifiers, fixed failure evidence, workflow
receipt, and digests.

```
 verified user identity + RunAdmissionTransaction
          │ silo · organisation · subject
          ▼
 ┌──────────────────────────────────┐
 │  personal memory  ◄── HERE        │  exact dataset + explicit preference ids
 └──────────────────────────────────┘
          │ catalog id + Cognee dataset id / fact coordinates
          ▼
 execution input snapshot ── later recall through memory gateway
```

**In this flow:** [execution inputs](../../../execution/inputs/main/README.md) freezes the selected
coordinates, and the [memory gateway](../../../../server/infra/memory-gateway-client/README.md)
is the only fact-content boundary.

The invariant is identity-bound selection and secret-free persistence: neither a request nor a tool
argument can choose another person's dataset, and no memory table stores remembered text, search
chunks, provider payloads, URLs, file paths, or credentials. The operation row retains the exact
encrypted message coordinates and full digests needed to reread and verify content through the
future gateway workflow. `cogneeExternalId` remains the existing catalog coordinate; this slice does
not reinterpret old values.

## Public surface

- `__ResolvePersonalMemoryDataset(repository, unitOfWork, command)` — fail-closed selection of one
  active personal dataset from verified coordinates.
- `__SelectPersonalPreferenceFactIds(repository, unitOfWork, command)` — selects explicit,
  consented personal-preference metadata for the same coordinates.
- `PrismaPersonalMemoryAdmissionRepository` — transaction-scoped Prisma adapter for both reads.
- `PrismaRuntimePersonalMemoryEffectEligibilityAuthority` — rechecks that a frozen personal dataset
  remains active on the same local Principal boundary before a recall effect is admitted.
- `PersonalMemoryAdmissionRepository` / `PersonalMemoryAdmissionUnitOfWork` — ports that preserve
  the caller-owned admission transaction without exposing Prisma delegates to execution inputs.
- `PersonalMemoryDatasetResolutionOutcomes` / `PersonalMemoryDatasetResolutionDenialReasons` — the
  stable, serialized allow/deny vocabulary for proof-bound dataset selection.
- `__CreatePersonalMemoryOperationLifecycle` / `__PlanPersonalMemoryOperationLifecycle` — strict
  command creation and State-by-Event planning with no I/O.
- `PersonalMemoryOperationKinds` / `PersonalMemoryOperationPhases` /
  `PersonalMemoryOperationEvents` / `PersonalMemoryOperationFailureCodes` — stable lifecycle
  vocabulary, transition outcomes, denial reasons, and their public command and event types.
- `PersonalMemoryOperationAdmissionOutcomes` / `PersonalMemoryOperationPersistenceOutcomes` —
  stable replay and persistence results, errors, records, repository ports, and lifecycle UnitOfWork
  ports. Task coordinates omit an engine ID until the transaction-bound callback returns the actual
  workflow receipt.
- `PrismaPersonalMemoryOperationRepository` — transaction-scoped replay, locking, validation, and
  lifecycle CAS for the product command owner. Its scoped replay-key read returns validated immutable
  evidence without claiming authority; admission reacquires every lock before deciding replay.
- `PrismaPersonalMemoryOperationUnitOfWork` — serializable lifecycle wrapper. Admission stays in the
  composite conversation transaction that also creates or selects the dataset, records authority,
  and admits the workflow task.
- `PrismaPersonalMemoryCommandContextRepository` — selects the exact personal dataset and its
  target fact inside the caller's transaction. It returns domain states without exposing Prisma
  enums. Creation requires prior collection Create authority and returns a Provisioning dataset
  with no provider UUID; the caller must grant access and admit the command in the same transaction.
- `__PersonalMemoryProviderDatasetName` — derives the opaque provider name from an immutable local
  dataset ID without storing a user or tenant coordinate in that name.

The `operations/` module owns the reviewed lifecycle, persistence validator,
transaction-scoped `PrismaPersonalMemoryOperationRepository`, and
`PrismaPersonalMemoryOperationUnitOfWork`. The repository locks the local dataset, referenced facts
in sorted ID order, and then the operation. Exact command replays return the first row and its saved
task without calling task admission. For a new command, the repository calls the transaction-bound
task admission once after those locks, validates the returned UUID/name/key, and inserts that exact
receipt. Conflicting command or task evidence fails. Accepted events use the shared lifecycle planner
and a revision compare-and-set. Accepted catalog events first write the exact catalog evidence in
the same transaction: Remember and Correct create one deterministic Active fact, while Forget
finalizes only its revision-fenced hidden target. A lost compare-and-set after either catalog write
throws so the caller rolls back the catalog mutation with the operation advance.

## Boundary

The current production conversation path does not consume the operation persistence. The intended entry is
[conversations](../../../../server/conversations/main/README.md): `POST /api/v1/me/conversations/:conversationId/messages` accepts
only a `conversationId` and `requestIdempotencyKey`; the authenticated session supplies the subject, the
trusted host supplies the silo, and the server re-resolves the participant-bound conversation and personal
agent service. Inside the final admission transaction, execution inputs verify the exact signed fleet
membership and current grants, load the approved persona, and use the dedicated personal-session
factory to select the dataset and preference coordinates owned here.

The managed admission path remains separate and deliberately freezes no personal-memory scope. A
managed service therefore cannot inherit a person's dataset merely because it has delegated access.
Live end-to-end Cognee qualification is still pending; admitting and freezing coordinates does not
claim that later gateway recall has been qualified in a running environment.

This package must not write fact content, derive a dataset from a caller-supplied subject, call
Cognee, or compose a runtime. A new dataset row must be created explicitly as `Provisioning` with a
null provider UUID; existing creators retain the `Active` default only when they supply an adopted
UUID. The future dataset owner derives the provider name as
`opencrane-memory-${sha256(dataset.id)}` through `__PersonalMemoryProviderDatasetName`; the name is
not stored.

The command supplies only the expected workflow task name and idempotency key. A new operation is
inserted only after a callback bound to the same transaction returns the actual task receipt. The
repository does not itself prove current product authority; the composite conversation owner must
compose dataset creation, authorization audit, this transaction-scoped repository, and workflow
admission. Only lifecycle-accepted catalog completion events write the exact catalog mutation in
that transaction. Catalog completion persists content-free Message provenance from the immutable
source coordinates, Explicit consent, server-selected `personal` sensitivity, and the operation UUID
as the fact ID. Correct relies on PostgreSQL to mark its exact predecessor Corrected. Forget admission
hides its exact Active or Corrected target as `ForgetPending`, and finalization advances that same
target to Forgotten. The database owns every fact revision increment.

## Dependency direction

Tagged `scope:personal-memory`, this backend package may depend only on its own scope and
`scope:shared`. It has no dependency on a gateway transport or an app composition root.

## Data & persistence

Owns `MemoryDataset`, `MemoryFactCatalog`, and `PersonalMemoryOperation` in `memory.prisma`.
`MemoryDataset` distinguishes explicit `Provisioning` from `Active` and `Retired`, and its provider
UUID is nullable only until the exact DatasetEnsured event adopts it. `MemoryFactCatalog.revision`
fences target commands. Remember and Correct catalog rows retain only their provider coordinate,
content digest, fixed consent and sensitivity, and content-free Message provenance; no remembered
text is copied into PostgreSQL. The operation stores immutable replay, source, target, and actual
workflow receipt evidence plus write-once provider receipts and current lifecycle recovery fields.
No memory outbox, queue, scheduler, route, provider call, or plaintext store is introduced.

## See also

- Parent group: [personal-agent domains](../../README.md)
- Intended admission entry: [conversations](../../../../server/conversations/main/README.md)
- Snapshot assembly: [execution inputs](../../../execution/inputs/main/README.md)
