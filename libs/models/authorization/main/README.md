# @opencrane/models/authorization — capabilities, proofs, and the pure allow/deny function

> [models](../../README.md) › authorization

## What it owns

A **model** package is shared TypeScript types plus pure decision functions — no database, no
network. This one is the heart of **authorization**: deciding whether an action is allowed. It owns
the vocabulary and the one deterministic function that says **allow** or **deny**, so every part of
the platform decides the same way.

Three ideas run through it:

- A **capability** is a named permission drawn from an immutable, versioned catalogue (for example
  "write this file"). References pin the exact catalogue revision by digest, so nobody can quietly
  redefine what a capability means.
- A **grant** hands one subject a capability, on one exact resource, within one **scope** (a slice
  of the org — organisation, department, team, project, personal, or direct-user), with an effect
  (allow/deny), a priority, and validity times.
- A **proof of possession** is how a running workload proves it is the one entitled to act. The
  types describe a short-lived, signed request-binding envelope (DPoP-style: a signature that ties
  the request to a key the workload holds) carrying the exact silo, service account, pod, run, and
  argument digest the policy-enforcement point (the component that checks the proof and enforces the decision) must independently match.

The load-bearing function is `__DecideAuthorization(request, grants)`. It is **fail-closed and
deterministic**: it filters grants to those that structurally match the request, rejects any with
malformed validity or priority, drops future/expired/revoked grants, then lets only the highest-
priority survivors decide — and **deny always wins** a tie. No matching grant means deny. Helpers
`__AuthorizationScopeCovers`, `__AuthorizationResourcesEqual` (exact, never wildcard or hierarchical)
and `fleet-membership` (trust of a signed membership revision) enforce the same strictness.

Used by the authorization/grants/membership backends and re-exported through `@opencrane/contracts`.
A mistake here can only ever refuse a legitimate request — never grant access it should not.

## Public surface

- `__DecideAuthorization` and `AuthorizationRequest`, `AuthorizationGrant`, `AuthorizationDecision`.
- Capability types: `CapabilityReference`, `CapabilityCatalogReference`, `ActionCapability`.
- Proof types: `CapabilityProof*`, `Es256PublicJwk`, `ValidCapabilityProof`/`InvalidCapabilityProof`.
- Scope/resource: `AuthorizationScope`, `AuthorizationResourceLocator`, `__AuthorizationScopeCovers`,
  `__AuthorizationResourcesEqual`, `__IsAuthorizationResourceLocator`.
- Fleet membership: `SignedFleetMembershipRevision`, `FleetMembershipTrustDecision`, and its evaluator.

## Boundary

Pure and I/O-free: it decides from inputs the caller supplies (grants, trusted time, verified
evidence). It performs no cryptography, no clock reads, and no I/O — a policy-enforcement point wires
the actual signature checks and current time, then calls these functions.

## Dependency direction

Tagged `scope:authorization` (`layer:model`): it may depend only on `scope:authorization`,
`scope:audit`, and `scope:shared` packages — never on apps, backend domains, or other model domains.

## See also

- Parent index: [models](../../README.md)
- Siblings: [agents](../../agents/main/README.md) · [artifacts](../../artifacts/main/README.md)
