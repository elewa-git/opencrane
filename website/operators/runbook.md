# Runbook

Use this runbook to diagnose the **OpenCrane server, agent controller and claimed warm
runtime Pods** without bypassing their authority boundaries.

> See also: [Hosting and deployment](/operators/hosting) (release shape),
> [Networking and isolation](/operators/networking) (allowed paths), and
> [Telemetry and logging](/operators/telemetry-logging) (signals and trace fields).

## First response

```bash
helm status <release> -n <server-namespace>
kubectl get pods,jobs -n <server-namespace>
kubectl get pods,jobs -n <personal-runtime-namespace>
kubectl get pods,jobs -n <managed-runtime-namespace>
```

Then inspect OpenCrane and controller logs:

```bash
kubectl logs -n <server-namespace> deployment/<release>-opencrane --tail 100
kubectl logs -n <server-namespace> deployment/<release>-agent-controller --tail 100
```

Correlate by run id and attempt. Do not use a Pod name as the product incident key.

## Health checklist

| Check | Healthy signal | Failure meaning |
|---|---|---|
| OpenCrane liveness | `/healthz` succeeds | process or database dependency unavailable |
| Controller polling | claims continue without repeated refusal | internal API, TokenReview or Kubernetes API path failed |
| Run state | progresses through accepted, queued, assigned and running | durable admission or dispatch is stalled |
| Warm Pod reservation | exact Pod UID recorded for the attempt | controller reservation did not commit |
| Profile activation | reserved Pod reports the fixed claimed profile and readiness | controller activation or readiness check failed |
| One-use binding | runtime Pod binds its proof key after readiness | runtime identity or private binding failed |
| Runtime stream | outbound bootstrap and stream accepted | token, proof or network boundary rejected |

## Run stuck before assignment

1. Inspect the run state, its bound AgentRun workflow task, and the task's saved Absurd events.
2. Check the controller can reach OpenCrane's internal API.
3. Check its projected token audience and ServiceAccount.
4. Check the selected runtime profile names the expected namespace.
5. Check admission policy and quota events in that runtime namespace.

Do not activate, bind or replace a warm Pod manually. A Pod without the durable reservation cannot
activate, and a Pod without the later one-use binding cannot receive execution material.

## Warm Pod cannot activate

```bash
kubectl describe pod -n <runtime-namespace> <pod-name>
kubectl get events -n <runtime-namespace> --sort-by=.lastTimestamp
```

Confirm that OpenCrane reserved the exact Pod UID and that the Pod belongs to the expected warm-pool
Deployment. The controller may activate only that reserved Pod for the recorded run and attempt,
then it must record matching readiness evidence. After that, the runtime Pod initiates its one-use
binding with OpenCrane; the controller does not bind on its behalf.

## Runtime cannot connect

Check, in order:

1. DNS from the runtime namespace to the same-silo OpenCrane Service.
2. NetworkPolicy egress to the internal API port.
3. projected-token file presence and audience;
4. bootstrap expiry and one-use status;
5. recorded reservation and Pod UID;
6. proof-key binding.

All failures should leave the runtime unable to execute work.

## Cancellation

Cancellation is complete only when the durable run is terminal and any claimed Pod cleanup
has been confirmed. If the runtime is unreachable, OpenCrane may fence the attempt and lease
cleanup to the authorised controller path.

::: warning
Never delete arbitrary Pods by label during cancellation. Cleanup authority identifies one
exact namespace, resource name and immutable Kubernetes UID.
:::

## Rolling restart

Restart trusted long-lived deployments with the app-owned deploy script or a normal release
upgrade. Warm runtime Pods are one-use: a Pod is deleted after an attempt and the Deployment
replenishes the pool. Do not preserve local scratch between attempts.

Source: [`libs/backend/agents/execution/runs/main`](https://github.com/elewa-git/opencrane/blob/main/libs/backend/agents/execution/runs/main/README.md)
and [`apps/opencrane/src/index.ts`](https://github.com/elewa-git/opencrane/blob/main/apps/opencrane/src/index.ts).
