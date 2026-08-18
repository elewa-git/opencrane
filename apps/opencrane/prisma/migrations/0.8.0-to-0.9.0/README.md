# Database schema 0.8.0 to 0.9.0

This adjacent transition adds standalone organisation invitations, request idempotency, verified
member profile fields, and a database guard that prevents removal, suspension, demotion, or movement
of the active owner. Fleet mode does not write these tables, but the same server release keeps one
schema for a deployment that may be installed in either mode.

The migration takes the shared advisory lock, verifies the exact 0.8.0 schema and protected baseline
origin, runs in one transaction, and records its SQL and target-baseline digests only after every
change commits. A retry succeeds only when that exact history row and all target objects already
exist. Rollback is backup restore or a reviewed forward repair.
