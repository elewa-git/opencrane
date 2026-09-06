# Runbook

Use this runbook to diagnose the **OpenCrane server, KurrentDB history and Agent Sandbox
conversation computers** without bypassing their authority boundaries.

> See also: [Hosting and deployment](/operators/hosting) (release shape),
> [Networking and isolation](/operators/networking) (allowed paths), and
> [Telemetry and logging](/operators/telemetry-logging) (signals and trace fields).

## First response

```bash
helm status <release> -n <server-namespace>
kubectl get pods,jobs -n <server-namespace>
kubectl get sandboxclaims,sandboxes,sandboxtemplates,sandboxwarmpools -n <server-namespace>
```

Then inspect OpenCrane and the external Agent Sandbox controller logs:

```bash
kubectl logs -n <server-namespace> deployment/<release>-opencrane --tail 100
kubectl logs -n agent-sandbox-system deployment/agent-sandbox-controller --tail 100
```

Correlate by conversation id, computer id and lease generation. Do not use a Pod name as the
product incident key.

## Health checklist

| Check | Healthy signal | Failure meaning |
|---|---|---|
| OpenCrane liveness | `/healthz` succeeds | process or database dependency unavailable |
| KurrentDB | authenticated TLS connection and persistent subscription stay healthy | conversation history or activation consumption is unavailable |
| Computer history | cold computer advances to claim-pending with one lease generation | activation command or checked claim creation stalled |
| Agent Sandbox claim | claim resolves to the release-owned template and exact Pod | external controller, CRD or admission policy failed |
| Computer readiness | `/readyz` succeeds on the claimed Pod | required lease coordinates or process health failed |
| Bootstrap | Pod-bound request returns one frozen pending turn | token, lease, membership or model admission failed |
| Output | assistant entry appears at the next KurrentDB stream revision | output fence, payload custody or history append failed |

## Computer stuck before activation

1. Inspect the conversation stream and `conversation-computer-{id}` history in KurrentDB.
2. Check the OpenCrane activation subscription is connected.
3. Check the resolved profile revision, computer generation and lease have matching coordinates.
4. Check the OpenCrane server can create and get `SandboxClaim` resources in the silo namespace.
5. Check admission-policy, RuntimeClass and quota events in that namespace.

Do not create, edit or replace a claim manually. A Pod without the recorded lease cannot bootstrap,
and a changed claim is denied by admission policy.

## Parked activations

The activation consumer waits with bounded backoff while Agent Sandbox assigns a Pod, and KurrentDB
parks a delivery only after sixty retries (more than nine minutes) or on a terminal authority
outcome such as a profile the release does not admit. A parked activation is never replayed on its
own, so the conversation stays cold until an operator replays the queue.

1. Read the parked queue: `GET /subscriptions/computer-activations-<silo>/conversation-computer-activation/parked`
   on the KurrentDB HTTP port with the bootstrap admin credential, and fix the recorded cause
   (profile revision, claim admission, controller health).
2. Replay the queue through the OpenCrane API as a Principal holding the current
   Organization/Administer grant:

   ```bash
   curl --request POST --cookie "$SESSION" https://<silo-host>/api/v1/conversation-computers/activations/parked:replay
   ```

   A `202 {"outcome":"replay_requested"}` means every parked delivery re-enters live delivery with the
   ordinary at-least-once contract. `403` means the caller lacks the grant; `503` means the queue is
   unreachable.

Do not edit the consumer group or acknowledge parked messages in the KurrentDB UI; the replay
route keeps the group's checkpoint and retry accounting intact.

## Lost and renewed leases

Every thirty seconds the lifecycle worker inspects each active lease. It renews a lease (claim
`shutdownTime`, KurrentDB lease, PostgreSQL projection) once less than half of the lease lifetime
remains, and it records the lease as `lost` and the computer as `cold` when the lease expired or the
`SandboxClaim` is gone. The next message with activation opens generation + 1 from either `released`
or `lost`. A `lost` lease captured no checkpoint, so the workspace restores from the previous one.

## Claim cannot activate

```bash
kubectl describe sandboxclaim -n <server-namespace> <claim-name>
kubectl describe pod -n <server-namespace> <pod-name>
kubectl get events -n <server-namespace> --sort-by=.lastTimestamp
```

Confirm that the claim selects the release-owned zero-replica pool and carries only the recorded
computer id, lease id and generation. Confirm the resulting Pod uses the digest-pinned template,
expected ServiceAccount and `gvisor` RuntimeClass. The external controller realises the claim; it
does not grant conversation or model authority.

## Runtime cannot connect

Check, in order:

1. DNS from the conversation-computer Pod to the same-silo OpenCrane Service.
2. NetworkPolicy egress to the internal API port.
3. projected-token file presence and audience;
4. current lease expiry and generation;
5. recorded claim and Pod UID;
6. pending conversation entry and current membership.

All failures should leave the runtime unable to execute work.

## Cancellation

Conversation-computer cleanup is complete only when the lease is no longer current and Agent
Sandbox has foreground-deleted its resources. AgentRun cancellation remains a separate durable
run-worker lifecycle; do not infer it from a conversation claim.

::: warning
Never delete arbitrary Pods by label during cancellation. Cleanup authority identifies one
exact namespace, resource name and immutable Kubernetes UID.
:::

## Rolling restart

Restart trusted long-lived deployments with the app-owned deploy script or a normal release
upgrade. A conversation computer has ephemeral `/workspace` scratch; its durable recovery input is
the KurrentDB history plus a separately verified ArtifactStore checkpoint when one exists.

Source: [`apps/conversation-computer`](https://github.com/elewa-git/opencrane/blob/main/apps/conversation-computer/README.md),
[`apps/_infra/agent-sandbox`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/agent-sandbox/README.md),
and [`libs/backend/server/conversations`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/server/conversations/main/README.md).

## KurrentDB backup and restore

KurrentDB holds every conversation entry and conversation-computer state. PostgreSQL only holds the
leases and credentials that point at that history, so a lost KurrentDB volume without a backup
leaves the silo unrecoverable. The silo release therefore runs a backup CronJob,
`<release>-kurrentdb-backup`, in the server namespace.

| Setting | Default | Meaning |
|---|---|---|
| `historyStore.kurrentdb.backup.schedule` | `0 2 * * *` | one backup per night (UTC) |
| `historyStore.kurrentdb.backup.retention.keepLast` | `7` | scheduled backups kept; older ones are pruned after each successful run |
| `historyStore.kurrentdb.backup.mode` | `fileCopy` | `fileCopy` writes into the `<release>-kurrentdb-backups` PVC; `volumeSnapshot` creates CSI `VolumeSnapshot` objects |

**Where backups live.** In `fileCopy` mode each backup is a directory named by its UTC timestamp
(for example `20260906T020000Z`) inside the `<release>-kurrentdb-backups` PVC; a directory counts
only once it carries `manifest.json`. In `volumeSnapshot` mode each backup is a `VolumeSnapshot`
named `<release>-kurrentdb-<timestamp>` with the label
`opencrane.ai/kurrentdb-backup-kind=scheduled`.

**Recovery objectives.** RPO is one schedule interval plus the run time: with the default schedule
up to 24 hours of conversation history and computer state is lost on restore. RTO is the copy or
snapshot-restore time of the data volume plus the node restart and the bootstrap verification Job,
expected to be minutes for the default 20Gi volume; the live testv5 drill has not measured it yet.
The ledger runs as one node, so a node loss means downtime until the restore completes.

**Consistency.** KurrentDB documents volume snapshots as the consistent method while the node runs.
The `fileCopy` order (index checkpoints, index, database checkpoints, chunks) is the documented
online procedure for the log and default index, but KurrentDB warns that the secondary-index files
it rewrites in place can be inconsistent during an online copy. Prefer `volumeSnapshot` wherever a
`VolumeSnapshotClass` exists.

```bash
kubectl get cronjob,jobs -n <server-namespace> -l app.kubernetes.io/component=kurrentdb-backup
kubectl logs -n <server-namespace> job/<latest-backup-job>
```

**Restore.** Restores run only through the deploy entrypoint with the same silo flags as a deploy:

```bash
apps/_infra/deploy-k8s/deploy.sh <silo flags> --kurrentdb-restore-list
apps/_infra/deploy-k8s/deploy.sh <silo flags> --kurrentdb-restore latest
apps/_infra/deploy-k8s/deploy.sh <silo flags> --kurrentdb-restore <backup-id> --kurrentdb-restore-confirm-serving
```

The engine refuses while KurrentDB is serving traffic unless `--kurrentdb-restore-confirm-serving`
is passed, because everything written after the backup is discarded. It then scales the StatefulSet
to zero, keeps a pre-restore safety copy (a `<timestamp>-prerestore` archive directory, or a
`VolumeSnapshot` labelled `opencrane.ai/kurrentdb-backup-kind=pre-restore` that pruning never
touches), restores the chosen backup into the data volume, scales the node back up, and re-runs the
bootstrap Job so the service user, ACL, and activation subscription are verified against the
restored ledger. Afterwards expect conversation computers whose leases postdate the backup to be
recorded as `lost`; their next message opens a new generation.

::: warning
Never `kubectl cp` files into the KurrentDB volume, edit the data PVC by hand, or delete the
pre-restore safety copy before the restored silo has served traffic correctly.
:::

Source: [`apps/_infra/kurrentdb`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/kurrentdb/README.md)
and [`apps/_infra/deploy-k8s/platform`](https://github.com/elewa-git/opencrane/blob/main/apps/_infra/deploy-k8s/platform/README.md).
