# @opencrane/server/_infra/api — server-owned Kubernetes plumbing

Typed Kubernetes API mechanics for the OpenCrane server process. It is the single local
authority for CRD identity (`opencrane.io`/`v1alpha1` and the `tenants`, `accesspolicies`,
`clustertenants` plurals), and exports normalised client errors, create-or-replace and
server-side-apply helpers (`__K8sApplyResource`, custom-object apply), the generic watch-loop
runner, the `ClusterTenant` CR shape, the per-ClusterTenant Namespace builder (stamped with
PSA `baseline` enforce/warn/audit labels — the silo isolation boundary), and the Linkerd
mesh-injection constants so every namespace builder and reconciler writes one identical value.

It carries no policy: callers decide what to apply and watch; this package only makes those
calls uniform and their failures classifiable. Consumers are the backend domains that
reconcile Kubernetes resources (`cluster-tenants`, `policies`, `projection`, `tenants`), the
frozen `feat-openclaw-tenant` boundary, and `_infra/auth` (which reads the ClusterTenant CR
for per-org login).

Tagged `type:lib`, `layer:infra`, `scope:k8s-api`: it may depend only on `scope:k8s-api` and
`scope:shared` — never on backend domains, apps, or sibling `_infra` packages.
