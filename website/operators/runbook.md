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
