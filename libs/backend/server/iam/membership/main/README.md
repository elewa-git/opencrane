# @opencrane/backend/server/iam/membership — is this person still a signed member of the fleet?

> [backend](../../../../README.md) › [server](../../../README.md) › [iam](../../README.md) › membership

## What it owns

This package is part of **IAM** — *identity and access management*, the side of OpenCrane that
answers **who is making this request, and are they allowed to do this?** Membership owns one narrow,
load-bearing question in the middle of that flow: **right now, is this person still a member of this
fleet, and can we prove it?**

A **fleet** is the set of silos (isolated customer workspaces) managed together; a central authority
signs a statement — a **membership revision** — saying "this subject belongs to this silo, until
this time". This package verifies that signed statement before any access decision trusts it. It does
not decide *what* the person may do (that is authorization's job); it only confirms the membership
itself is genuine, current, and the newest one seen.

```
 identity has established WHO the person is
        │
        ▼
 ┌───────────────────────────────┐
 │   membership   ◄── HERE        │  newest signed revision? signature valid?
 └───────────────────────────────┘  in scope? not expired? not rolled back?
        │  trusted (with an expiry window)  /  denied (+ plain reason)
        ▼
  authorization ......... uses this as its mandatory first gate before deciding
```

**In this flow:** [identity](../../identity/main/README.md) · [authorization](../../authorization/main/README.md) · [audit](../../audit/main/README.md)

**Its role:** it runs *after* identity has said who the person is and *before* authorization decides.
It consumes the freshest locally stored signed revision plus a fresh cryptographic check of the
signature, and hands off either a trusted window or the complete signed evidence needed to freeze
identity into a run snapshot. That evidence names the issuer, signing key, revision, assertion,
subject, payload digest and trust expiry; callers cannot assemble it from request claims.

It is strict in three ways worth knowing. Absence is never membership — no stored revision means
denied, not trusted. A cached revision is trusted only until the earlier of its own signed expiry or
a configured staleness limit, so stale trust cannot linger. And acceptance advances a **high-water
mark** atomically: once revision N is accepted, an older revision can never be replayed to roll
membership back, even under concurrent logins.

Invariant: it only ever returns "trusted" for a signature that verified, is in scope, has not
expired, is not stale, and is the newest accepted. If any check is uncertain, the answer is "denied".

## Public surface

- `__VerifyCurrentFleetMembership` — verifies the newest signed membership revision and, on success,
  atomically records its acceptance; returns a trusted window or a denial with a reason.
- `__VerifyCurrentFleetMembershipEvidence` — performs the same verification but returns the exact
  signed issuer, key, assertion, subject, payload digest, revision, and trust window that a run may
  freeze into its input snapshot.
- `PrismaFleetMembershipAuthorityRepository` — the database-backed store of signed revisions and the
  highest-accepted high-water mark. It can own a transaction or join the run-admission transaction,
  so the snapshot and membership high-water mark cannot commit separately.
- `Ed25519FleetMembershipSignatureVerifier` — verifies the detached base64url signature over the
  recomputed canonical membership payload digest using only exact issuer-key IDs from mounted
  public-key files. A stored assertion cannot change independently of its signature.
- `__DigestFleetMembershipSignedPayload` — the shared issuer/verifier contract that canonicalizes
  every issuer, time, silo, subject, assertion, and scope field before signing.
- `_CreateFleetMembershipEvidenceConfig(environment?)` — reads the bounded, mounted-key trust
  configuration once for app composition and returns a verifier that reloads its projected Ed25519
  public key before every membership decision. It is neutral to personal and managed agents.
- Contract types: `VerifyFleetMembershipCommand`/`Result`, `FleetMembershipAuthorityRepository`,
  `FleetMembershipSignatureVerifier`, `FleetMembershipAcceptance`/`Result`,
  `FleetMembershipEvidenceConfig`, and `TrustedFleetMembershipEvidence`.

## Boundary

Consumed by [authorization](../../authorization/main/README.md) as its `AuthorizationMembershipAuthority`
first gate. The signature verifier itself is a port supplied by the caller — this package orchestrates
the decision but does not own the cryptography. Fail-closed: a missing revision, a verifier that
throws, a failed check, or a concurrent-acceptance conflict all return "denied". A caller such as the
personal-session assembler may supply its existing Prisma transaction. In that mode the repository
must not open a nested transaction: membership acceptance, its audit decision, and the resulting run
snapshot share one commit or rollback together.

## Dependency direction

Tagged `scope:membership`: it may depend only on `scope:audit`, `scope:auth`, `scope:authorization`,
`scope:membership`, and `scope:shared` — never on apps or other sibling domains.

## Data & persistence

Owns `VerifiedFleetMembershipRevision`, `VerifiedFleetMembershipAssertion`, and
`HighestAcceptedFleetMembership` in `apps/opencrane/prisma/schema/membership.prisma`.

## See also

- Parent index: [iam](../../README.md)
- Siblings: [authorization](../../authorization/main/README.md) · [identity](../../identity/main/README.md) · [audit](../../audit/main/README.md)
