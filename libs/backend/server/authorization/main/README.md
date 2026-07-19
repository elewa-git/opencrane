# @opencrane/backend/server/authorization — Authorization

Owns effective access decisions and proof-bound runtime actions. It evaluates the grants and
membership evidence required for an action, verifies its proof, and records a one-time outcome
through an explicit persistence boundary.

The public surface is `src/index.ts`; Prisma repositories implement the durable authorization and
runtime authorities. See [`../../README.md`](../../README.md) for the control-plane map.
