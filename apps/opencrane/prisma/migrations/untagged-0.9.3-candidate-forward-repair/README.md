# Untagged 0.9.3 candidate forward repair

This development-only repair lets the supported 0.9.2 to 0.10.0 upgrade continue when a database
already ran the exact untagged 0.9.3 candidate. It does not make 0.9.3 a release boundary and does
not rename or delete either migration ledger.

The repair checks the candidate schema history, the no-op Prisma baseline, the successful workflow
cutover, and its two rolled-back attempts by exact checksum. It then installs the MCP database clock,
locked selectors, lifecycle triggers, and revision-completion authority that were added after that
candidate ran.

Legacy invitation audit rows are retained only when their existing resource references prove they
belong to the migration silo. Any other action or unresolved invitation stops the repair. A durable
`opencrane_migrations.forward_repairs` row records the source checksums, repair digest, silo, and time
without pretending that the candidate was a tagged release.

The deployment-owned Prisma migrator runs this file before the normal 0.10.0 prerequisite. Databases
without the candidate marker pass through unchanged. A different candidate shape needs its own
reviewed forward repair or an explicitly authorized development reset.
