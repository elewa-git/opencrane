# @opencrane/backend/server/membership — verified fleet-membership projection

Owns the silo's trusted view of fleet membership. `__VerifyCurrentFleetMembership` accepts only
the freshest locally stored signed revision for a trusted issuer and silo, demands explicit
cryptographic evidence from the injected `FleetMembershipSignatureVerifier` (verifier failures
never fall back to cached trust), and evaluates issuer, monotonic revision ordering, signature
binding, assertion scope, signed expiry, and the caller's staleness bound via the shared
`__EvaluateFleetMembershipRevision` model. Acceptance advances a per-issuer high-watermark
atomically so a concurrent newer acceptance defeats rollback to an older revision. The result is
either a bounded trust window (`trustedUntilEpochMs`) or a typed fail-closed denial — absence of a
revision can never imply membership.

`PrismaFleetMembershipAuthorityRepository` is the durable revision and high-watermark store,
digesting payloads with the authorization package's canonical-JSON digest and appending audit
evidence. The library does not fetch or sync revisions from the fleet and holds no transport;
authorization flows (for example `__ResolveEffectiveAccess`) consume it as their mandatory first
gate through the membership-authority port.

Tagged `scope:membership`: it may depend only on `scope:audit`, `scope:authorization`, and
`scope:shared` — never on apps or sibling domains.

See [`../../README.md`](../../README.md) for the control-plane capability map.
