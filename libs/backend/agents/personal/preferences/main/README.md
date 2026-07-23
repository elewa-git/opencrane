# @opencrane/backend/agents/personal/preferences — user-controlled prompt preferences

> [backend](../../../../README.md) › [agents](../../../README.md) › [personal](../../README.md) › preferences

## What it owns

This package owns the durable preferences that personalise a person's agent after onboarding. A
preference is a short instruction such as “give the conclusion first”, not a recalled memory and not
a mutable persona file. It records why the fact exists, whether the person consented, how confident
the system is, and whether the fact is still eligible for future runs.

```
 explicit statement / low-risk candidate
          │ provenance · consent · confidence
          ▼
 ┌──────────────────────────────────────┐
 │ preferences  ◄── HERE                 │  accept · correct · forget
 └──────────────────────────────────────┘
          │ accepted IDs only
          ▼
 next RunInputSnapshot → deterministic prompt compiler
```

**In this flow:** [personas](../../personas/main/README.md) owns the user's approved assistant
identity; [execution inputs](../../../execution/inputs/main/README.md) freezes the selected IDs.

An inferred sensitive trait is always refused. Candidates require confirmation before they enter a
future prompt; corrections create a successor and preserve the old record; forgetting removes a fact
from later admissions without deleting evidence referenced by an earlier immutable snapshot.

## Public surface

- `__RecordPreferenceFact` records an explicit fact, candidate, or correction successor after input validation.
- `__AcceptPreferenceFact` records an owner's explicit confirmation before a candidate may enter a
  later run snapshot.
- `__ForgetPreferenceFact` makes one owner fact unavailable to later admissions without deleting it.
- `PrismaPreferenceFactRepository` owns the transaction-backed durable lifecycle.
- `PrismaPreferenceFactSource` selects accepted, consented same-owner IDs through session assembly's
  existing admission transaction.

## Boundary

The package is not an API or UI and does not generate a persona. It stores prompt-personalisation
authority directly in OpenCrane, unlike the separate memory catalog whose durable content belongs in
Cognee. The compiler dereferences retained snapshot IDs; this package only decides what a future
snapshot may include.

## Dependency direction

Tagged `scope:personal-preferences`, it may use the execution input and run contracts plus shared
types. It cannot import an app, UI, the Cognee memory authority, or a server control-plane domain.

## Data & persistence

Owns the `PreferenceFact` target model and its baseline lifecycle fence: owner/profile and source
provenance must agree, sensitive facts cannot be inferred, and facts are retained through correction
or forget transitions for historical snapshot explanation.

## See also

- Parent index: [personal](../../README.md)
- Related state: [personas](../../personas/main/README.md) · [memory](../../memory/main/README.md)
