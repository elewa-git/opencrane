# Database schema 0.9.0 to 0.9.3

This manually approved patch transition replaces categorical IAM scopes with the 0.9.3 Principal,
hierarchical Group, normalized membership, generic grant-boundary, MCP entitlement, and explicit
resource-share authorities. It preserves stable Group identifiers, records the exact OIDC claim
rewrite from each externally managed legacy group to `group:<Group.id>`, and binds every mapping row
to the manifest-reviewed migration SQL digest.

Every existing managed AgentService also receives a deterministic local Principal whose id is
`agent-service:<AgentService.id>`, whose issuer is `urn:opencrane:agent-service`, and whose internal
provenance prevents OIDC reconciliation from claiming it. The service stores that Principal id
directly, so signed fleet membership and generic grants use one durable database identity rather
than reconstructing an unaudited subject at admission time.

The migration requires the exact `migration_silo_id` and `migration_oidc_issuer`. It stops before
destructive changes when a legacy member, grant subject, grant scope, AgentRevision attachment,
memory dataset, MCP user, or MCP group cannot resolve to exactly one stored Principal or Group. It
also rejects populated v1 signed fleet-membership revisions because a database migration cannot
re-sign their payloads, and rejects `everyoneInOrg` MCP policies because they have no deterministic
least-privilege grant projection. Existing resource pseudo-groups are deterministically projected
to `ResourceShare`, recipient, and manager-owned grant rows; malformed pseudo-groups stop the cutover.

Only after those projections succeed does the transaction drop the old attachment and MCP policy
tables, categorical scope columns and indexes, JSON member storage, and retired enums. Existing
groups remain hierarchy roots because 0.9.0 stored no defensible parent relation. PostgreSQL
serialises later parent changes per silo and rejects cycles.

The deployment migration job supplies the protected 0.9.0 baseline digest, this SQL file's
manifest-bound digest, the silo, and the issuer. The migration rejects every other source shape and
records 0.9.3 only after the whole cutover commits. A physical backup is required; rollback is
backup restore or a reviewed forward repair, never a legacy parser or dual-write compatibility path.

The generic deploy resolver continues to reject patch-schema transitions. An operator upgrading the
exact `0.9.2` release must invoke the normal app-owned deploy command with
`--release-version 0.9.3 --from-release-version 0.9.2` and the explicit
`--approve-0.9.2-to-0.9.3-database-transition` flag. That version-specific flag retains the normal
backup, server fence, digest-bound migration Job, convergence check, and recovery sequence; it is
invalid for every other release pair.
