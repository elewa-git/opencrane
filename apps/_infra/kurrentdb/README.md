# kurrentdb — private HistoryStore ledger

> [OpenCrane](../../../README.md) › [apps](../../README.md) › [_infra](../README.md) › kurrentdb

## What it owns

This chart deploys the private KurrentDB event ledger behind the 0.11.0 HistoryStore. PostgreSQL
still decides who may act; KurrentDB only preserves the conversation history that the server has
already admitted.

```
 external immutable Secrets
       │ TLS · admin password · ops password · service identity
       ▼
 ┌─────────────────────┐        HTTPS on 2113       ┌────────────────────┐
 │ KurrentDB bootstrap  │ ────────────────────────► │ KurrentDB ◄── HERE │
 │ user + exact ACL     │                            └────────────────────┘
       │ validates service identity                         ▲
       └────────────────────────────────────────────────────┘
                          opencrane-server only
```

**In this flow:** the [silo release composer](../deploy-k8s/README.md) provides the values and the
[OpenCrane server](../../opencrane/README.md) is the only long-lived ledger client.

The first bootstrap run creates exactly one unprivileged `opencrane-history` user and records one
default access control list (ACL): that user and administrators can read/write user streams, while
only administrators can delete streams or read/write metadata. The bootstrap administrator also
creates the silo-scoped `conversation-computer-activation` persistent subscription. A retry observes
the existing group; it never gives the service identity administrator rights, resets a user, changes
a password, or widens an existing ACL.

## Public surface

`helm/templates/_resources.tpl` — exports `opencrane.kurrentdb.resources`, the named template that
the silo umbrella renders: StatefulSet, Service, bootstrap Job, PodDisruptionBudget, and network
policies.

`helm/templates/_backup.tpl` — exports `opencrane.kurrentdb.backup`, the scheduled backup CronJob
with its scripts, ServiceAccount, and (per mode) archive PVC or snapshot Role. `_resources.tpl`
includes it when `historyStore.kurrentdb.backup.enabled` is true.

`tests/helm-contract.sh` — renders the target contract and rejects omitted KurrentDB credentials,
either unpinned image, an unknown backup mode, or a snapshot backup without its class, image, or
exact API endpoints.

`deploy/Dockerfile` — builds the non-root bootstrap and file-copy backup image with `curl`, `jq`,
and the Alpine shell utilities. The chart supplies its scripts and read-only credentials at runtime.

## Boundary

The chart creates no credentials. An installer supplies immutable, release-local Secrets: TLS
(`tls.crt`, `tls.key`, `ca.crt`), an administrator password, an operations password, and the
`opencrane-history` username/password. KurrentDB mounts TLS and receives its administrator and
operations credentials; the bootstrap Job receives TLS, administrator, and service inputs; the application server
must receive only the CA and service username/password through its separate app chart.

The installer supplies the immutable digest of the bootstrap image built from `deploy/Dockerfile`.
It contains `/bin/sh`, `curl`, `jq`, `mktemp`, `tr`, and `grep`; it has no Kubernetes API permission and may
egress only to DNS and this KurrentDB instance. The chart refuses missing digests rather than
assuming that the KurrentDB image contains administration tools.

KurrentDB runs with TLS, internal authentication, both default passwords supplied, anonymous stream
and endpoint access disabled, and trusted authentication disabled. Its NetworkPolicy admits only
the release-local server and its bootstrap Job on port 2113 and permits no KurrentDB egress.

The backup Job holds no KurrentDB credential. In `fileCopy` mode it runs as the database identity
on the database node, reads the data volume read-only, writes the archive PVC, and has no network
at all. In `volumeSnapshot` mode it runs under its own ServiceAccount whose Role may only get,
list, watch, create, and delete `VolumeSnapshot` objects in the release namespace, and its egress
is limited to DNS and the exact Kubernetes API addresses the deploy engine supplies.

## Resilience, backup, and restore

The ledger is one KurrentDB node. Readiness and liveness probes call `GET /health/live` over the
node's TLS listener (the same unauthenticated check the official secure-cluster examples use), and a
PodDisruptionBudget with `minAvailable: 1` refuses voluntary evictions until an operator has a fresh
backup and allows the disruption. A three-node topology is not rendered: KurrentDB 26.x clustering
needs per-node advertised hostnames, gossip seeds, and a certificate that covers every node, none of
which this chart or its Secret provisioner produce yet, so recovery relies on the backup below.

`historyStore.kurrentdb.backup` renders a CronJob (`0 2 * * *` by default, `retention.keepLast: 7`):

- `fileCopy` (default) copies the data files into the release-local `<release>-kurrentdb-backups`
  PVC in the order the KurrentDB backup guide prescribes: index checkpoints, the rest of the index,
  database checkpoints, then chunk files. The PVC carries `helm.sh/resource-policy: keep`. KurrentDB
  documents this order as safe for the log and default index of a running node, but warns that the
  secondary-index (DuckDB) files it modifies in place may be inconsistent unless the node is
  stopped or a volume snapshot is used. Secondary indexing is on by default in 26.x.
- `volumeSnapshot` creates one CSI `VolumeSnapshot` of the data PVC per run, which KurrentDB
  documents as the consistent online method and which the official Kubernetes operator also uses.
  It needs `volumeSnapshot.className`, a digest-pinned kubectl image, and the API endpoint CIDRs
  that `k8s-deploy.sh` fills automatically.

The recovery point objective is one schedule interval (24 hours by default) plus the time of the
run itself; every conversation entry and computer state written after the last backup is lost on
restore. Restore runs only through the deploy engine:

```bash
apps/_infra/deploy-k8s/deploy.sh <usual silo flags> --kurrentdb-restore-list
apps/_infra/deploy-k8s/deploy.sh <usual silo flags> --kurrentdb-restore latest
apps/_infra/deploy-k8s/deploy.sh <usual silo flags> --kurrentdb-restore <backup-id> --kurrentdb-restore-confirm-serving
```

The engine refuses while KurrentDB is serving traffic unless the confirmation flag is present. It
then scales the StatefulSet to zero, keeps a pre-restore safety copy (an archive directory or a
`pre-restore` VolumeSnapshot that scheduled pruning never touches), restores the chosen backup, scales
back up, and re-runs the bootstrap Job so the service user, ACL, and activation subscription are
verified against the restored ledger. The recovery time objective is the copy or snapshot-restore
time of the data volume plus the node restart and bootstrap verification, expected in minutes for
the default 20Gi volume; a live drill on testv5 still has to confirm it.

## Dependency direction

This is a deployment-only `type:app` entrypoint. It renders Kubernetes resources for the HistoryStore
plane and imports no OpenCrane domain behaviour.

## Runtime & config

Set `historyStore.kurrentdb.enabled=true` only with these external secret references and immutable
image digests: `tls.existingSecret`, `bootstrapAdmin.existingSecret`,
`bootstrapOps.existingSecret`, `serviceCredential.existingSecret`, `image.digest`, and
`bootstrap.image.digest`. The bootstrap image repository and resource/deadline values are also
required by the named template. The deploy entrypoint verifies that the referenced Secrets exist,
are immutable, and contain their required keys before it renders this workload.

The bootstrap image also runs `fileCopy` backups and restores, so it must additionally contain
`cp`, `find`, `sed`, `sort`, `du`, `df`, `awk`, `date`, `wc`, `head`, `tail`, and `xargs` (any
BusyBox or Alpine base provides them). `backup.mode=volumeSnapshot` instead needs an
operator-supplied, digest-pinned image with `sh`, `kubectl`, `date`, `wc`, and `head`, plus a
`VolumeSnapshotClass` name; `k8s-deploy.sh` adds the Kubernetes API endpoint values for its
NetworkPolicy. `backup.archive.persistence.size` must hold `retention.keepLast` full copies of the
data volume plus one pre-restore safety copy.

The disposable k3d smoke builds this image and the conversation computer from the selected source
or exact validated baseline, then serves their digests from a loopback-bound registry. It installs
the real TLS ledger, runs bootstrap, and verifies a scoped service read plus anonymous-read refusal.
That check does not exercise scheduled backups, restoration, or a complete assistant turn.

## See also

- Parent index: [_infra](../README.md)
- Release composition: [deploy-k8s](../deploy-k8s/README.md)
- Runtime adapter: [HistoryStore](../../../libs/backend/server/infra/history-store/README.md)
