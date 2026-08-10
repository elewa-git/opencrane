# 0.7.0 to 0.8.0 database transition

This transition is conditionally automatic. The 0.8 persona redesign replaces 0.7 free-text
interview answers and JSON selection rules with governed choice identifiers, weighted scoring,
tie-resolution evidence, colour pairs, openness modifiers, and interpolation-map provenance.
Those values cannot be derived truthfully from arbitrary existing text or selection-rule JSON.

`migration.sql` still performs the complete fail-closed preflight: it takes the shared migration
advisory lock, requires the exact protected 0.7 bootstrap envelope digest, rejects partial/repeated
states, verifies the old enum/table/catalog shape, locks every table that could gain persona data,
and reports the row counts that a manual mapping must address. If any legacy runtime persona data
exists it aborts with `OC708` before changing schema or data. When those tables are empty, it replaces
only the governed 0.7 source catalog, applies the generated schema delta plus reviewed authority
functions, triggers, constraints, and 0.8 seeds, and records the transition in schema history.
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
`OC708` guard. `verify-postgres.sh` proves the supported tagged-empty path converges to the fresh 0.8
application schema and governed seeds, the exact completed path is retryable, and a populated legacy
fixture rolls back untouched.
