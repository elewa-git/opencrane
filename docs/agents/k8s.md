# Kubernetes and cluster security

> Part of the OpenCrane agent guidance. See [`AGENTS.md`](../../AGENTS.md) for the index.

These rules implement the identity boundaries in [`architecture.md`](./architecture.md). The
workload and namespace map is in [`cluster-architecture.md`](./cluster-architecture.md).

## Defaults

- Give every deployable and Job class a dedicated Kubernetes service account.
- Set `automountServiceAccountToken: false` unless the workload explicitly needs a token.
- Project only the exact audience-bound token required by the receiving service.
- Grant the smallest namespaced role that satisfies the workload.
- Use a restricted pod-security profile for OpenCrane-owned Job namespaces.
- Apply default-deny ingress and egress before adding named service paths.
- Bound Jobs with quotas, deadlines, immutable images, read-only roots, and ephemeral scratch.

Runtime, authoring, tool, and preprocessing Jobs must not receive general Kubernetes mutation rights.
The agent controller is the only general creator and releaser of runtime Jobs.

## Workload identity

An internal route authenticates a workload by reviewing its projected service-account token for the
exact audience, then binding the returned namespace and service account to the current durable
assignment. A service-account name, namespace, Job label, or network source is never sufficient on
its own.

Projected tokens must be:

- mounted read-only;
- audience-specific;
- short-lived;
- unavailable through default token automount; and
- accepted only by the route and workload class they were issued for.

## Internal routes

The OpenCrane server uses a separate internal listener for workload traffic. Public ingress must
never route to it.

Every sensitive internal route must state and test:

1. the accepted token audience;
2. the accepted namespace and service-account class;
3. the durable assignment or workload record it binds;
4. the request body and byte limits; and
5. the NetworkPolicy that permits the caller to reach the listener.

Network reachability is only a transport gate. Identity, assignment, authorization, expiry, and
replay checks remain application requirements.

## NetworkPolicy

OpenCrane-owned workload namespaces start with default-deny. Add egress only for the named path a
workload needs, such as:

- Domain Name System resolution;
- the OpenCrane internal listener;
- LiteLLM model access;
- the memory gateway;
- the artifact byte service; or
- the configured telemetry collector.

Do not use a broad namespace selector when a service-account or workload label can name the caller.
Do not add public ingress to a runtime Job.

## Resource ownership

Each resource template belongs to the app that owns the workload. The
`apps/_infra/deploy-k8s` chart may compose those templates but must not duplicate them. The
workload-ownership and app-composition boundary guard renders every supported profile and checks
that each rendered workload and runtime-created Job has one exact app owner.

Cluster-wide ingress, certificate, DNS, CloudNativePG, and policy controllers are external
prerequisites. An organisation release creates only its own namespaced resources plus explicitly
named release-scoped policy objects.

## Review checklist

When changing Kubernetes resources, verify:

- the workload owner is registered in `docs/agents/workload-ownership.json`, then run
  `npm run check:workload-ownership-app-composition`;
- service-account token automount and projected audiences are explicit;
- RBAC contains only required verbs, API groups, and resource names;
- default-deny remains effective;
- cross-namespace routes name both source and destination;
- secrets are not mounted into workloads that can use brokered access; and
- rendered Helm tests cover the allow path and at least one denial.
