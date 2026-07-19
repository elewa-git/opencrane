# @opencrane/server/_infra/tenant-hosting — hosting substrate adapters

The `HostingAdapter` contract and its two implementations, so tenant lifecycle code never
branches on a cloud provider. An adapter answers four substrate questions per tenant:
provision and deprovision external storage, the ServiceAccount identity annotations, and the
pod state volume. `OnPremHostingAdapter` is the default — vanilla Kubernetes, no external
storage, a PVC-backed state volume (`openclaw-<tenant>-state` mounted at `/data/openclaw`).
`GcpHostingAdapter` provisions a per-tenant GCS bucket, Workload Identity annotations, and a
GCS Fuse CSI volume. The `HostingProvider` enum reserves `azure`/`aws`, but no adapter
exists for either yet.

The adapter only describes and provisions substrate: it does not create PVCs (the operator
does, guided by `requiresPvc`), does not decide when a tenant is created or deleted, and
holds no tenant state. Consumers are the `apps/opencrane` hosting factory, which selects the
adapter from configuration, and the frozen `feat-openclaw-tenant` boundary.

Tagged `type:lib`, `layer:infra`, `scope:tenant-hosting`: it may depend only on
`scope:tenant-hosting` and `scope:shared` — never on backend domains or apps.
