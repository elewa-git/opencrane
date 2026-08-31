# Database schema 0.9.0 to the 0.10.0 prerequisite

This reviewed prerequisite carries tagged 0.9.2's 0.9.0 schema into the Principal,
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

The deployment migration Job supplies this SQL file's manifest-bound digest, the silo, and the
issuer. It records the 0.10.0 prerequisite only after the whole cutover commits. If it fails, repair the database
forward; deployment does not create a backup, inspect the source schema, pause writes, or restore a
previous release. Those safeguards are deferred to issue #699.

The same prerequisite also adds MCP bundle validation records. Each record pins one immutable
artifact revision and stores only its manifest and trusted-signature decision. Absurd keeps the job
attempts and checkpoints in its own tables; these MCP rows hold the result shown to administrators.
