# Runbook

Use this runbook to diagnose the **OpenCrane server, agent controller and per-attempt
runtime Jobs** without bypassing their authority boundaries.

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
| Job assignment | exact Job UID recorded for the attempt | controller projection did not commit |
| First-Pod registration | one Pod UID bound before bootstrap | Job has no valid executable identity |
| Runtime stream | outbound bootstrap and stream accepted | token, proof or network boundary rejected |

## Run stuck before assignment

1. Inspect the run state and latest run outbox event.
2. Check the controller can reach OpenCrane's internal API.
3. Check its projected token audience and ServiceAccount.
4. Check the selected runtime profile names the expected namespace.
5. Check admission policy and quota events in that runtime namespace.

Do not create a replacement Job manually. A Job without the durable assignment cannot
bootstrap and should remain denied.

## Job exists but does not run

```bash
kubectl describe job -n <runtime-namespace> <job-name>
kubectl get events -n <runtime-namespace> --sort-by=.lastTimestamp
```

Confirm that OpenCrane recorded the Job UID, issued the release fence and registered exactly
one Job-owned Pod. Admission permits only the controller's one conditional
`suspend: true` to `false` transition.

## Runtime cannot connect

Check, in order:

1. DNS from the runtime namespace to the same-silo OpenCrane Service.
2. NetworkPolicy egress to the internal API port.
3. projected-token file presence and audience;
4. bootstrap expiry and one-use status;
5. recorded Job UID and Pod UID;
6. proof-key binding.

All failures should leave the runtime unable to execute work.

## Cancellation

Cancellation is complete only when the durable run is terminal and any assigned Job cleanup
has been confirmed. If the runtime is unreachable, OpenCrane may fence the attempt and lease
cleanup to the authorised controller path.

::: warning
Never delete arbitrary Jobs by label during cancellation. Cleanup authority identifies one
exact namespace, resource name and immutable Kubernetes UID.
:::

## Rolling restart

Restart trusted long-lived deployments with the app-owned deploy script or a normal release
upgrade. Runtime Jobs are bounded attempts; do not convert them into Deployments or preserve
their local scratch between attempts.

Source: [`libs/backend/agents/execution/runs/main`](https://github.com/italanta/opencrane/blob/main/libs/backend/agents/execution/runs/main/README.md)
and [`apps/opencrane/src/index.ts`](https://github.com/italanta/opencrane/blob/main/apps/opencrane/src/index.ts).
