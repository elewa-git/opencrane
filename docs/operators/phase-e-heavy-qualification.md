# Phase E heavy qualification

> Status: ready to run after the dependent Phase E PR stack is merged. Passing offline tests is a
> prerequisite, not evidence that the live product is qualified.

## Purpose

This runbook turns the completed offline Phase E runtime and managed-agent implementation into live
evidence. It starts at the first boundary this workstation could not exercise without PostgreSQL,
Docker, Kubernetes, and the pinned third-party services.

The run is clean-green. Provision a fresh environment from the target charts and baseline. Do not
seed, import, bridge, or preserve data from an older OpenCrane environment.

## Required environment

- A fresh Kubernetes cluster with an enforcing CNI and the app-owned deployment chart.
- Docker and `psql`, or `POSTGRES_TEST_CONTAINER` pointing at a disposable PostgreSQL authority.
- The existing fleet-membership verification Secret containing the Ed25519 public key.
- A matching test signer that can issue a current membership assertion for a user and for
  `agent-service:<service-id>`. The private key never enters the OpenCrane server Pod.
- Live, same-silo LiteLLM, Obot, Cognee, ArtifactStore, agent-controller, personal runtime, and
  managed runtime planes.
- Immutable image digests and exact Kubernetes API CIDRs required by the chart.

## Gate 1 — repository and PostgreSQL authority

Run the deterministic gates first:

```sh
npm run lint:boundaries
scripts/agent-style-check.sh --diff own-personal-ai-agent-setup
npx nx run-many -t test -p contracts,backend-server-membership,backend-server-grants,backend-server-authorization,backend-server-agent-services,backend-agents-execution-inputs,backend-agents-execution-runs,backend-agents-execution-protocol,backend-agents-runtime-controller,server-infra-agent-runtime-stream,opencrane,agent-controller,agent-runtime,managed-agent-runtime,deploy-k8s
bash scripts/run-postgres-authority-tests.sh \
  apps/opencrane/prisma/tests/phase-d-authority-integration.sql \
  apps/opencrane/prisma/tests/run-dispatch-terminalization.sql \
  apps/opencrane/prisma/tests/run-input-snapshot-admission.sql \
  apps/opencrane/prisma/tests/skill-workload-authority.sql
```

The SQL gate must prove atomic snapshot admission, lock ordering, idempotency, membership expiry,
outbox delivery, first-Pod registration, cancellation, and recovery against real PostgreSQL.

## Gate 2 — fresh cluster

Render and install only the target chart. Confirm:

- personal and managed runtime namespaces are distinct from each other and from the server;
- the controller has namespaced Job, Pod, and attempt-key authority in exactly those two planes;
- personal and managed projected tokens have different audiences and ServiceAccount grammars;
- all runtime namespaces are default-deny and have no mutation RBAC;
- the fleet verification mount contains only the public key and is read-only;
- every canonical store uses a mounted, expandable volume; runtime scratch is non-authoritative.

Run the cluster smoke:

```sh
npm run test:e2e:k3d
```

## Gate 3 — identity and admission journeys

Create one personal AgentService and one managed AgentService with an active immutable revision.
Give the managed service one exact non-personal scope attachment and a matching grant.

For both run-now and a due schedule, prove:

1. the managed principal is derived as `agent-service:<service-id>`;
2. the same signed membership, revision, grants, model route, budget, and exact attachments produce
   the same capability digest regardless of the administrator or scheduler that initiated the run;
3. a missing, stale, wrongly signed, cross-silo, personal, or ungranted attachment denies before a
   run/outbox record is committed;
4. an idempotent replay returns the existing run and creates no second Job;
5. the controller creates the Job in the managed namespace with the managed audience and SA;
6. crossing a personal token, namespace, or SA into the managed plane is rejected, and vice versa;
7. the runtime receives no personal memory facts or `upgrade_session` tool.

## Gate 4 — live runtime and third-party boundaries

Run the pinned driver against the real same-silo LiteLLM proxy:

```sh
OPENCRANE_RUNTIME_LIVE_CONFORMANCE=1 npx nx run agent-runtime:test
```

Then exercise:

- model success, provider timeout, malformed response, budget exhaustion, and usage accounting;
- one allowed Obot-custodied integration call, revocation before dispatch, and approval deferral;
- managed Cognee read/write restricted to the admitted scope with provenance and no personal dataset;
- ArtifactStore read/write through leases and receipts, with runtime scratch deleted after completion;
- steering, deferred approval resume, cancellation races, stream reconnect, and exactly-once terminal
  reporting;
- server/controller restart after claim, Job creation, assignment, release, and first-Pod discovery.

Record the driver and image evidence in
[agent-runtime-adoption-evidence.md](../design/agent-runtime-adoption-evidence.md). Do not mark the
candidate adopted until every live leg passes.

## Gate 5 — load, recovery, and deletion

Measure at least:

- admission latency and throughput for personal, managed run-now, and scheduled work;
- TokenReview, capability verification, PostgreSQL transaction, SSE, and model round-trip costs;
- capacity limits, queue behavior, idle polling, and retry pressure;
- fleet-membership staleness at the configured five-minute default and at expiry;
- controller recovery and future application rollout to ready Pods in under five minutes.

After the live Obot proof passes, execute the #337 deletion gate for the replaced OpenClaw loop,
bespoke harvester, Slack connector, and `HarvestingCursor`. Re-run forbidden-reference, boundary,
full test, and fresh-cluster gates after deletion.

## Exit record

Phase E live qualification is complete only when:

- every gate above has dated evidence and an operator;
- named personal and managed journeys pass from API admission through terminal event;
- no Critical or High correctness, security, isolation, or residue finding remains;
- the exact driver/image/model matrix is recorded as adopted;
- the clean target deploy contains no replaced OpenClaw or harvester execution path.
