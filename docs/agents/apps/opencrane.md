# OpenCrane server app

The canonical package overview is [`apps/opencrane/README.md`](../../../apps/opencrane/README.md).
Read it together with [`architecture.md`](../architecture.md) before changing server composition.

## App boundary

`apps/opencrane` owns process bootstrap, public and workload-facing listeners, Prisma schema
composition, and the server Helm unit. Product behaviour belongs in `libs/backend/*`; server-specific
transport and external-service seams belong in `libs/backend/server/infra/*`.

The public API is mounted only on the public listener. Workload routes are mounted only on the
internal listener and must verify the expected workload identity and durable assignment.

## Composition rules

- Mount a capability from its public library barrel.
- Inject database, Kubernetes, storage, and external-service ports at the app root.
- Keep route handlers and business logic in the owning library.
- Start and stop background workers explicitly with bounded shutdown.
- Never let a runtime, browser, or channel request supply authoritative organisation or assignment
  coordinates.

## Data boundary

The app owns `prisma/schema/*.prisma` and `prisma/bootstrap/target-baseline.sql`. A clean database is
created from that reviewed baseline. Server startup validates and uses the schema; it does not
invent a separate data authority.
