# @opencrane/server/_infra/api — Kubernetes API plumbing

> [server](../../README.md) › [_infra](../README.md) › api

## What it owns

This is the OpenCrane server's low-level **plumbing for talking to Kubernetes**. Kubernetes is the
cluster platform the server runs on. This library holds the ClusterTenant CRD coordinates and
normalizes Kubernetes status errors for the authentication boundary.

It sits between the server's authentication boundary and the Kubernetes API server:

```
 authentication boundary  (resolves one ClusterTenant)
          │
          ▼
 ┌────────────────────────────┐
 │   _infra/api  ◄── HERE      │  CRD constants · normalized errors
 └────────────────────────────┘
          │  typed request
          ▼
 Kubernetes API server  (stores and serves the custom resources)
```

**In this flow:** `_infra/auth` *(caller)* · the Kubernetes API server *(substrate)*

It owns the CRD identity constants (API group `opencrane.io`, version, plural name) and normalized
status checks such as "not found". Keeping them here prevents authentication code from inventing
its own Kubernetes coordinates or error parsing.

## Public surface

- `OPENCRANE_API_GROUP`, `OPENCRANE_API_VERSION`, `*_CRD_PLURAL` — CRD identity constants.
- `k8s-errors` — normalized Kubernetes status checks.

## Boundary

Consumed by the server authentication boundary. It is pure plumbing and must not import backend
business domains or app entrypoints.

## Dependency direction

Tagged `scope:k8s-api` (`layer:infra`): it may depend only on `scope:k8s-api` and `scope:shared`
packages — never on backend domains, the frontend, or app entrypoints.

## See also

- Parent index: [_infra](../README.md) · [server libraries](../../README.md)
- Siblings: [auth](../auth/README.md) · [http](../http/README.md) · [obot-custody](../obot-custody/README.md)
