# @opencrane/models/authorization — fail-closed authorization contract

Pure domain model for OpenCrane authorization. It owns the `ActionCapability` and
`CapabilityReference` shapes, the DPoP-style capability-proof contract
(`CapabilityProofClaims`, `CapabilityProofExpectation`, and the exhaustive
`CapabilityProofFailureReason` union — one stable reason per verification boundary), the
grant model, the six-level `AuthorizationScope` hierarchy with `__AuthorizationScopeCovers`,
resource-locator equality, and the signed fleet-membership types with
`__EvaluateFleetMembershipRevision`.

The load-bearing invariant is `__DecideAuthorization`: a deterministic, fail-closed grant
decision. No matching active grant means deny; malformed validity windows, priorities, or
request time deny the whole request; only the highest-priority active grants determine the
effect, and deny wins on any conflict at that priority. Every decision returns the winning
grant ids as evidence.

Consumed by the authorization, membership, and channel-targets backend domains, the
personal-agent runs domain, and the API contracts. It performs no cryptography, no I/O, and
no persistence — signature verification and grant storage live with the enforcing services;
this package defines what they must agree on.

Tagged `type:lib`, `layer:model`, `scope:authorization`: it may depend only on
`scope:authorization`, `scope:audit`, and `scope:shared` packages, and as a `layer:model`
package it may never import backend, contract, frontend, infra, or entrypoint code.
