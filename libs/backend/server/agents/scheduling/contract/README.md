# @opencrane/backend/server/agents/scheduling/contract — routine occurrence hand-off

> [backend](../../../../README.md) › [server](../../../README.md) › [agents](../../README.md) › [scheduling](../README.md) › contract

## What it owns

This package defines the hand-off from routine scheduling to the conversation, computer and root-run
owners that carry out one occurrence. Scheduling supplies content-free immutable facts to every
owner and adds plaintext only for preparation; each owner returns restart-safe evidence.

```text
 scheduling workflow
        │ content-free occurrence facts
        ▼
 ┌───────────────────────────────────────┐
 │ scheduling contract  ◄── HERE         │
 │ preparation · activation · admission │
 └───────────────────────────────────────┘
        │ validated receipts
        ▼
 conversation history · computer · root AgentRun
```

**In this flow:** [scheduling](../main/README.md) owns lifecycle and fresh authority checks ·
[conversations](../../../conversations/main/README.md) owns occurrence history and computer
activation · [root-run admission](../../../../agents/execution/runs/main/README.md) owns the admitted
AgentRun.

The receipt parsers preserve every saved field and reject blank references, malformed SHA-256
digests and unknown fields. A malformed checkpoint result therefore stops before scheduling binds a
run identifier or advances the firing.

## Public surface

- `RoutineFiringIdentity` binds work to its silo, routine revision, firing and workflow task.
- `RoutineOccurrenceCommand` carries immutable execution facts without instruction content.
- `PrepareRoutineOccurrenceCommand` adds plaintext only for conversation-history preparation.
- `RoutineOccurrencePreparationPort` and `RoutineOccurrencePreparationReceipt` cover conversation
  history creation or recovery.
- `RoutineOccurrencePreparationRepository` and its factory let the conversation owner reuse the
  scheduling authority inside the transaction that publishes prepared history and audience grants.
- `RoutineComputerActivationPort` and `RoutineComputerActivationReceipt` cover computer activation
  or recovery without receiving instruction content.
- `RoutineRunAdmissionPort`, `RoutineRunAdmissionInput` and `RoutineRunAdmissionReceipt` cover the
  content-free root AgentRun hand-off after both earlier receipts are saved.
- `___ParseRoutineOccurrencePreparationReceipt`, `___ParseRoutineComputerActivationReceipt` and
  `___ParseRoutineRunAdmissionReceipt` restore checkpoint evidence without normalising it.

## Boundary

These declarations grant no permission and perform no I/O. Scheduling rechecks current authority
before each port call; each implementation must repeat the relevant check at its authoritative
write. A saved preparation marker means publication already committed and must be recovered without
recreating removed grants. A fresh publication records that marker in the same transaction as its
audience grants. The package contains no lifecycle rules, encrypted instruction envelope, database adapter,
workflow handler or application wiring. Activation and run admission cannot receive plaintext or an
encrypted instruction through this contract. Any later prompt compilation must reread checked,
service-attested history through the dedicated routine path; activation uses only content-free facts
and the saved preparation receipt.

## Dependency direction

This `scope:scheduling-contract` library depends only on agent models and the public workflow
contract. Scheduling and conversation implementations may depend on it; it never imports either
implementation package.

## See also

- Parent index: [scheduling](../README.md)
- Lifecycle and workflow owner: [scheduling main](../main/README.md)
- Workflow engine contract: [workflows](../../../infra/workflows/contract/README.md)
