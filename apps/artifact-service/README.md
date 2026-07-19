# Artifact service

`apps/artifact-service` owns the guarded write path to OpenCrane's artifact store. It is the only
process that admits bytes into the content-addressed store, and it admits them only against a signed,
time-limited write lease that OpenCrane issues for one specific artifact. There is no unauthenticated
upload path and no ambient write credential.

An upload is accepted only when its lease verifies, stays within the declared size cap, and completes
before the lease deadline; the service then stages the bytes, promotes them to their content address,
and returns a signed promotion receipt that OpenCrane records. The store itself is a single
content-addressed CAS rooted on one mounted volume per silo, deduplicated by digest — one shared
store with logical partitioning, never a volume per authority or per agent. Store mechanics, lease
verification, and promotion live in `libs/backend/artifacts/{store,filesystem,authorization}`; this
app is the deployable shell and HTTP surface.

The workload holds no Kubernetes RBAC and no auto-mounted API token. Its NetworkPolicy admits only
the OpenCrane server as a client and restricts egress accordingly. Artifact data is durable: the
volume is retained across releases and grows by expanding its request, never by adding parallel
stores.
