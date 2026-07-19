# Cilium

This deployment-only app owns OpenCrane's exact-pinned upstream Cilium substrate. It is installed
once into `kube-system` before any OpenCrane product release; it is deliberately not a dependency
of a silo chart because it enforces every namespace in the cluster.

`deploy.sh` installs Cilium chart `1.19.6` from its OCI source and waits atomically for its agent
and operator. `scripts/probe-network-policy.sh` proves one CiliumNetworkPolicy allows an explicitly
labelled client and denies an otherwise identical client, then removes its temporary namespace.

The values contract is supplied by the operator for the target cluster's CNI mode. There is no
legacy CNI fallback, CNI chaining, or mesh compatibility path.
