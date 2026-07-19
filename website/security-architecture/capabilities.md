# Capabilities & proofs

How OpenCrane authorises a single action. This page introduces the vocabulary the
rest of the chapter depends on: capabilities, proofs, digests, and grants.

## The problem being solved

An AI agent is a program that decides at runtime what it wants to do. You cannot
review its next move in advance, so the platform must make every move
individually checkable. Classic approaches fall short here:

- A **session token** proves who started the work, but then authorises *anything*
  that identity may do, for as long as the token lives.
- A **role** grants a standing bundle of rights that exists whether or not any
  run needs it right now.

OpenCrane instead authorises **one action at a time**. The unit of authority is a
*capability*: permission for one named action, on one exact resource, with one
exact set of arguments, by one specific workload, inside one time window. If an
agent needs to do three things, that is three capabilities.

Three platform nouns before we start: an **agent revision** is one immutable
published version of an agent; a **run** is one execution of it; and each retry
of a run is a numbered **attempt**.

## Capabilities

An `ActionCapability` is a small, immutable record the server issues after
deciding an action is allowed. Its fields fall into four groups — together they
pin the capability to a single moment of a single run:

| Group | Fields | What it pins |
|---|---|---|
| **Who** | `siloId`, `subjectId`, `serviceAccountName`, `namespace`, `workloadKind`, `workloadUid`, `podUid` | The exact workload (down to the Kubernetes Pod UID) acting for the exact user, in the exact silo |
| **Which run** | `agentServiceId`, `agentRevisionId`, `runId`, `attempt` | The exact agent revision and run attempt |
| **What** | `capability`, `resource`, `action`, `argumentsDigest` | One catalogued action on one exact resource with one exact argument set |
| **When & how proven** | `notBefore`, `expiresAt`, `jti`, `proofKeyThumbprint`, `effectiveAuthorizationDigest` | A hard time window, a unique id for replay tracking, and the key that must sign the proof |

Two of those fields deserve a closer look:

- **`argumentsDigest`** is a hash of the action's arguments. The capability doesn't
  authorise "send a message" — it authorises "send *exactly this* message".
  Change one byte of the arguments and the digest no longer matches.
- **`proofKeyThumbprint`** identifies a public key. The capability is useless to
  anyone who cannot sign with the matching private key — which is what the next
  section is about.

## Proof-of-possession

A bearer credential (like a cookie or API token) authorises whoever presents it —
steal it, and you are the user. OpenCrane's capabilities are **proof-bound**
instead: exercising one requires a fresh digital signature from a private key that
only the legitimate workload holds. Stealing the capability alone gets an attacker
nothing.

The mechanism follows the DPoP pattern (RFC 9449, "Demonstrating
Proof-of-Possession"). With every request that exercises a capability, the
workload sends a short-lived signed statement — the **proof** — produced with its
ES256 (elliptic-curve) private key:

```
proof = signed {
  htm:  the exact HTTP method              ── this request only
  htu:  the exact target URI               ── this endpoint only
  iat:  when the proof was signed          ── fresh, not reusable later
  aud:  who should accept it               ── this verifier only
  …plus the capability's pinning fields from the table above
   (run, attempt, workload, action, argument digest, …),
   each repeated and signed
}
```

The verifier checks, in order and refusing at the first failure: the signature
itself, the key (it must match the capability's `proofKeyThumbprint`), the time
window, the method and URI, and then **every** signed field against the
capability it claims to exercise. There are around thirty distinct failure
reasons — `proof_too_old`, `workload_uid_mismatch`, `arguments_mismatch`, and so
on — and each one is a refusal. A proof is never "partially valid".

Where does the private key come from? Each run attempt generates its own keypair,
and the workload registers the **public** half with the server exactly once,
during a one-time bootstrap exchange. The server stores only the public key. There
is no reusable runtime secret to leak: the private key never leaves the workload,
and it dies with the run attempt.

## Digests: exact-match by construction

Several checks above compare *digests* — SHA-256 hashes written as
`sha256:<64 hex characters>`. For a hash comparison to be meaningful, both sides
must serialise the data identically, so every digest in the platform is computed
over **canonical JSON** (RFC 8785): keys sorted, numbers in one canonical form,
and anything that cannot be canonically represented (cycles, class instances,
non-finite numbers) rejected outright. Two semantically equal argument sets always
produce the same digest; two different ones never do.

One digest gets special treatment: **`effectiveAuthorizationDigest`** records the
authorisation evidence — the policy and grant set — that justified issuing the
capability. It is fixed at issuance and signed into every proof, so the decision
behind a capability stays auditable, and a proof can never present a capability
as if it rested on different evidence. (Capabilities are also short-lived, so
revoking a grant stops new issuance within moments.)

## Replay protection

Each capability carries a unique id (`jti`). Before the server performs the
action, it durably **reserves** that id in Postgres — inside the same transaction
that writes the audit record, and *before* any external side effect starts. A
second request with the same id finds the reservation and is refused
(`jti_replay`), with one deliberate exception: an action declared *idempotent*
(safe to repeat — it produces the same result) may be answered with its
previously recorded result — the recorded outcome, not a re-execution.

Reserving before acting means even a crash mid-action leaves durable evidence
that the attempt happened, so a retry cannot silently double-execute. The
freshness of the proof itself is enforced by its signed timestamp: too old is
refused (`proof_too_old`), from the future is refused (`proof_from_future`).

## Grants: where a "yes" comes from

Capabilities are the *output* of authorisation. The *input* is **grants** —
durable, immutable records that say a subject may (or may not) use a capability
on a resource at some **scope** (how widely it applies: one resource, a project,
a whole silo). Evaluation is deliberately boring:

1. Collect the grants that match the subject, capability, resource, and scope
   exactly. **No matching grant → deny.** There is no fallback, no inheritance
   surprise, no "probably fine".
2. Drop grants that are not yet valid, expired, or revoked.
3. Among the survivors, only the **highest numeric priority** decides (larger
   number wins).
4. At that priority, **deny beats allow**.

Grants are never edited in place — changing access means writing a new grant or
revoking an old one — so the evidence trail behind any decision stays intact.

## Effective access: two parties, one intersection

When a *user* asks an *agent* to act, whose permissions apply? Both. The server
computes **effective access** as the intersection of what the human actor may do
and what the agent service may do — each evaluated independently, so neither can
widen the other — further clipped by two ceilings fixed when the run started: the
agent revision's declared capability set and the run's own capability set.

Before any of that, one gate must pass: **fleet membership**. Silos are
provisioned and administered by a central operator plane called the **fleet**,
and the fleet — not the silo — is the authority on *who belongs to which silo*.
It asserts that with signed, version-numbered membership documents. A silo
trusts only the most recent signed membership revision for a subject, and only
within a configured freshness bound: missing, stale, replayed, or
lower-than-last-seen revisions fail closed. An empty intersection or a stale
membership yields *no* capabilities, not reduced ones.

## Approvals

Some actions additionally require a human decision — the capability catalogue
marks which (for example, deleting an artifact always does). An approval is not a
loose "the user said OK": it is a database record bound to the **exact** subject,
run, attempt, agent revision, proof key, workload identity, action, and argument
digest, with an expiry. The uniqueness rule is one approval per exact action
digest per run attempt — so approving "delete artifact X" approves deleting
exactly X with exactly those arguments, not the next deletion that comes along.
A run waiting on approval pauses and resumes only when a non-expired, exactly
matching approval exists.

## Fitting it together

```
 grants ──▶ effective access ──▶ capability issued ──▶ proof signed per request
 (may X?)    (user ∩ agent,        (one action, one       (this workload, this
  deny wins)  membership fresh)     argument set, expiry)  request, right now)
                                          │
                                          ▼
                            verify → reserve jti → audit → act
                                     (all fail closed)
```

> **See also:** [Workload identity](/security-architecture/workload-identity) for
> how the *workload* fields in a capability are verified against Kubernetes, and
> [Run lifecycle](/security-architecture/run-lifecycle) for where capability
> issuance sits in a run.
