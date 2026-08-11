# 0.7.0 to 0.8.0 database transition

This transition is conditionally automatic. The 0.8 persona redesign replaces 0.7 free-text
interview answers and JSON selection rules with governed choice identifiers, weighted scoring,
tie-resolution evidence, colour pairs, openness modifiers, and interpolation-map provenance.
The 0.8 Conversation authority also replaces the agent-only `ConversationThread` aggregate with
immutable `agent_session`, `direct`, and `group` modes, participant visibility coordinates, an
explicit lifecycle, and one canonical position across messages, run events, membership events,
system events, and parent deliveries. Those meanings cannot be derived truthfully from arbitrary
legacy persona content or existing transcript rows.

The 0.8 deferred-tool approval authority also replaces synthetic deferred result bodies with frozen
reviewed arguments and parameter schemas, actor-safe projections, and the complete validated
replacement arguments that the runtime executes. Those semantics cannot be reconstructed from an
existing 0.7 approval row, so the automatic path requires `approval_requests` to be empty and fails
with `OC711` otherwise.

The 0.8 revision contract replaces integration tool-name arrays with complete reviewed tool
definitions containing a description, object JSON Schema, and canonical schema digest. An old name
cannot establish that authority, so the automatic path also requires
`agent_revision_integration_assignments` to be empty and fails with `OC712` otherwise.

`migration.sql` still performs the complete fail-closed preflight: it takes the shared migration
advisory lock, requires the exact protected 0.7 bootstrap envelope digest, rejects partial/repeated
states, verifies the old enum/table/catalog shape, locks every table that could gain persona data,
and reports the row counts that a manual mapping must address. If any legacy runtime persona data
exists it aborts with `OC708`; if any legacy Conversation aggregate, invocation context, active
conversation-bound run, or retired `command.forward` route exists it aborts with `OC710`. Both
guards run before changing schema or data. Existing `events.read` route rows are not discarded: the
migration preserves their ids, endpoints, registration times, and former expiry as nullable
`legacy_expires_at` evidence, assigns the deterministic `legacy-route-v0:<route-id>` receiver, and
retires every previously unrevoked row at one migration timestamp while preserving any earlier
revocation evidence. The reserved receiver namespace and evidence trigger
keep those rows immutable and prevent runtime code from manufacturing more. When the guarded
sources are empty, the migration replaces the governed 0.7 persona catalog and legacy conversation
tables, preserves unrelated rows and unbound runs, applies the reviewed authority functions,
triggers, constraints, and 0.8 seeds, and records the transition in schema history.
An exact completed history row plus the current governed catalog makes a deploy retry a successful
no-op. Any history/catalog mismatch is ambiguous and fails closed instead of replaying DDL.
Retry detection runs under the same session advisory lock as the transition and also binds the
manifest-supplied migration SQL digest, so two deploy Jobs cannot race or accept different bytes.
The automatic path is bound to the default `opencrane` database owner and its protected envelope
digest. A differently named owner produces a different protected digest and therefore requires a
reviewed manual transition rather than weakening source provenance.

The deployment Job supplies exactly two psql variables: `source_baseline_sha256` from
`sourceProtectedBaselineSha256`, and `migration_sql_sha256` from `sqlSha256` in this transition's
manifest. The SQL digest is supplied rather than embedded because a file cannot contain its own
SHA-256 without changing that digest.

For a populated source, clone it and approve a deterministic manual mapping before replacing the
`OC708`, `OC710`, `OC711`, or `OC712` guard. `verify-postgres.sh` proves the supported tagged-empty path converges to the
fresh 0.8 application schema and governed seeds, preserved event-route evidence is retired without
identity loss, the exact completed path is retryable, and populated legacy persona, Conversation,
and invocation-context fixtures each roll back untouched.
