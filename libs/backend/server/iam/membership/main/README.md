# @opencrane/backend/server/iam/membership — current human membership

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › membership

## What it owns

This Identity and Access Management (IAM) package answers whether a human still belongs to a silo,
which is one isolated customer workspace. Identity establishes the Principal first. Membership
checks the deployment-selected authority, then central authorization decides what that person may do.
A membership witness is evidence for that check, never a permission or a browser claim.

```
 verified Principal + deployment mode
                │
                ▼
 membership ◄── HERE
    Fleet signature / local PostgreSQL row
                │
                ▼
 central authorization → admitted run snapshot
```

**In this flow:** [identity](../../identity/main/README.md) · [authorization](../../authorization/main/README.md) · [run inputs](../../../../agents/execution/inputs/main/README.md)

Fleet mode selects and verifies the newest signed assertion and advances its accepted revision
atomically. Signatures, issuer and silo bindings, expiry, staleness and rollback prevention all
remain required. A missing or invalid Fleet proof never falls back to local membership.

Standalone mode checks the configured silo, the external Principal's trusted OpenID Connect (OIDC)
issuer and subject, and an active local `OrgMembership`. Its witness freezes the membership row ID,
`updatedAt`, identity coordinates, observation time and a deployment-bounded trust deadline. It has
no signature or Fleet revision. Login updates to Principal email or display name do not change this
version. Membership authority changes must advance `OrgMembership.updatedAt`; replacing the row or
suspending membership also invalidates the witness. The reader never writes either identity table.

## Public surface

- `_CreateHumanMembershipEvidenceConfig(environment?)` selects explicit Fleet or Standalone policy
  at startup. No request may supply the mode, trusted issuer, silo or lifetime.
- `PrismaHumanMembershipEvidenceRepository` reads the selected human authority using the caller's
  transaction. Personal admission, company discovery and company requester checks share this owner.
- `__SameMembershipBinding` compares frozen and current authority, requiring the same mode and local
  row version. Callers must also enforce current eligibility and the original trust deadline.
- `__DigestHumanMembershipEvidence` binds the whole verified witness into admission arguments and
  capability evidence. `__HumanMembershipRevision` returns a revision for Fleet alone.
- `PrismaRuntimeMembershipEligibilityAuthority` rechecks the frozen human witness in an effect
  transaction. Managed execution also needs its separate current service/revision check.
- `__SelectCurrentFleetMembershipAssertion`, `__VerifyCurrentFleetMembershipEvidence` and
  `PrismaFleetMembershipAuthorityRepository` own signed selection, verification and monotonic acceptance.
- `Ed25519FleetMembershipSignatureVerifier` recomputes the signed payload digest and verifies the
  signature with its supplied keys. The configuration factory's wrapper reloads the mounted key
  before verification. `__DigestFleetMembershipSignedPayload` owns the payload digest.
- Types include `HumanMembershipEvidenceConfig`, `HumanMembershipEvidenceRepository`,
  `FleetMembershipEvidenceConfig`, `TrustedFleetMembershipEvidence` and the signed verification ports.

## Boundary

The reader uses the caller's transaction, so Fleet acceptance and its audit record commit with the
admission they supported. Standalone reads share that transaction without creating grants or members.
Expected absence, revocation or failed verification returns no evidence; storage failures propagate.

The active conversation computer path re-enters run admission before issuing a model credential or
accepting output. Saved-run recovery checks the same local row version before compiling the stored
snapshot again. Credential lifetime is the minimum of original and current evidence, budget and
lease deadlines. A later observation cannot extend an existing run. Already issued provider keys
retain their short expiry; this package does not claim instantaneous provider-side revocation.
The reusable runtime eligibility port has no current production caller and is not the active
computer path's enforcement mechanism.

## Dependency direction

Tagged `scope:membership`: it uses allowed identity, authorization, audit and shared/model contracts.
It never depends on an app or on personal/managed agent policy.

## Data & persistence

Owns `VerifiedFleetMembershipRevision`, `VerifiedFleetMembershipAssertion` and
`HighestAcceptedFleetMembership` in `apps/opencrane/prisma/schema/membership.prisma`.
It reads `Principal` and `OrgMembership`; identity and organization-members retain their write rules.
The existing JSON execution-subject storage accepts the new evidence kind without a schema change.

## Runtime & config

`OPENCRANE_MEMBERSHIP_MODE` must be `fleet` or `standalone`.
`OPENCRANE_MEMBERSHIP_MAX_STALENESS_MS` must be positive and no more than 24 hours.
Fleet requires `OPENCRANE_MEMBERSHIP_ISSUER_ID`, `OPENCRANE_MEMBERSHIP_KEY_ID` and
`OPENCRANE_MEMBERSHIP_PUBLIC_KEY_FILE`. Standalone requires `OPENCRANE_SILO_ID` and `OIDC_ISSUER_URL`.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [authorization](../../authorization/main/README.md) · [identity](../../identity/main/README.md) · [organization members](../../organization-members/main/README.md)
