# @opencrane/models/platform-policy — adopted platform policy invariants

Pure domain model for the adopted platform policy: the single frozen `___PLATFORM_POLICY`
constant and the predicates that recognise a conforming policy (`___IsPlatformPolicy`,
`___IsDurableStatePolicy`, `___IsRuntimeFilesystemPolicy`, `___IsSiloUpdatePolicy`,
`___IsSiloUpdateDurationAllowed`).

The invariants it fixes: durable state is persistent, retained until authorised deletion,
online-expandable, and always backed up; runtime filesystems are non-authoritative scratch —
lease-scoped, never backed up, cleared on replacement, scale-zero, and lease expiry
(`___RUNTIME_WORKSPACE_CLEAR_EVENTS`); and a silo update must remount existing volumes,
resume canonical state, forbid any predecessor runtime or data transformation, and finish
strictly within five minutes (`___MAXIMUM_SILO_UPDATE_DURATION_MS`). The predicates accept
exactly the adopted values, so a drifted policy fails validation rather than degrading.

Consumed by the API contracts; deployment and lifecycle machinery must honour these bounds
but this package enforces nothing at runtime — it only states the policy in checkable form.

Tagged `type:lib`, `layer:model`, `scope:shared`: as a `layer:model` package it may never
import backend, contract, frontend, infra, or entrypoint code.
