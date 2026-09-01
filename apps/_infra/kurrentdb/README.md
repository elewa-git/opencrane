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

The first bootstrap run creates exactly one unprivileged `opencrane-history` user, records one
default access control list (ACL), and creates the durable
`opencrane-conversation-computer-activation` subscription on the release's
`computer-activations-<silo>` stream. The subscription starts at revision zero, allows one server
consumer, and dispatches each activation command to that consumer. The service user and
administrators can read/write user streams, while only administrators can delete streams or
read/write metadata. A retry reads back the ACL and subscription configuration and fails if either
differs; it never resets a user, changes a password, widens an ACL, or updates a subscription.

## Public surface

`helm/templates/_resources.tpl` — exports `opencrane.kurrentdb.resources`, the named template that
the silo umbrella renders.

`tests/helm-contract.sh` — renders the target contract and rejects omitted KurrentDB credentials or
either unpinned image.

## Boundary

The chart creates no credentials. An installer supplies immutable, release-local Secrets: TLS
(`tls.crt`, `tls.key`, `ca.crt`), an administrator password, an operations password, and the
`opencrane-history` username/password. KurrentDB mounts TLS and receives its administrator and
operations credentials; the bootstrap Job receives TLS, administrator, and service inputs; the application server
must receive only the CA and service username/password through its separate app chart.

The bootstrap image is an operator-supplied, digest-pinned purpose-built artifact. It must contain
`/bin/sh`, `curl`, `jq`, `mktemp`, `tr`, and `grep`; it has no Kubernetes API permission and may
egress only to DNS and this KurrentDB instance. The chart refuses missing digests rather than
assuming that the KurrentDB image contains administration tools.

KurrentDB runs with TLS, internal authentication, both default passwords supplied, anonymous stream
and endpoint access disabled, and trusted authentication disabled. Its NetworkPolicy admits only
the release-local server and its bootstrap Job on port 2113 and permits no KurrentDB egress.

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

## See also

- Parent index: [_infra](../README.md)
- Release composition: [deploy-k8s](../deploy-k8s/README.md)
- Runtime adapter: [HistoryStore](../../../libs/backend/server/infra/history-store/README.md)
