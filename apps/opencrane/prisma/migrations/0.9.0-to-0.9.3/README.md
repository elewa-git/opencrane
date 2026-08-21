# Database schema 0.9.0 to 0.9.3

This manually approved patch transition adds a nullable parent relation to groups. Existing groups remain roots,
while new and updated groups can form a hierarchy. PostgreSQL serialises parent changes and rejects
cycles, and the foreign key refuses to delete a parent that still has children.

The deployment migration job supplies the protected 0.9.0 baseline digest and this SQL file's
manifest-bound digest. The migration rejects every other source shape and records 0.9.3 only after
the schema change commits.

The generic deploy resolver continues to reject patch-schema transitions. An operator upgrading the
exact `0.9.2` release must invoke the normal app-owned deploy command with
`--release-version 0.9.3 --from-release-version 0.9.2` and the explicit
`--approve-0.9.2-to-0.9.3-database-transition` flag. That version-specific flag retains the normal
backup, server fence, digest-bound migration Job, convergence check, and recovery sequence; it is
invalid for every other release pair.
