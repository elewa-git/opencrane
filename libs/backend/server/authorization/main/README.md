# @opencrane/backend/server/authorization — capability-proof authorization authority

Owns the control plane's runtime authorization decisions: whether a workload's possession proof,
its issued capability, and the independently observed runtime all agree, and which capabilities an
actor and an AgentService are jointly allowed to exercise. Everything fails closed with a typed
reason; no partial claims escape a failed verification. The load-bearing exports:

- `__VerifyCapabilityProof` — verifies an ES256 compact DPoP-style proof (RFC 9449 shape, RFC 7638
  key thumbprints) against one exact action capability: it first cross-checks the issued
  capability against independently observed runtime bindings (silo, subject, KSA, namespace,
  workload/pod UID, agent service/revision, run attempt, resource, action, argument digests), and
  only then parses the attacker-controlled proof — signature before claims, strict base64url and
  UTF-8, 16 KiB cap, bounded proof age and clock skew.
- `__ResolveEffectiveAccess` — deterministic intersection authority: current signed fleet
  membership is a mandatory first gate (never inferred from grants), then requested capabilities
  are clipped to the immutable AgentRevision ceiling and run capability set, and only capabilities
  independently allowed to both the actor and the AgentService survive. An empty intersection is a
  denial with retained per-principal evidence.
- `__ConsumeRuntimeBootstrap` / `__ExecuteCapabilityAction` — the runtime `jti` authority. Bootstrap
  claims are validated then consumed atomically (replays denied); actions reserve the verified JTI
  durably before external I/O, honour `one_shot` versus `idempotent` replay modes, and treat any
  post-I/O persistence conflict as ambiguous, never retried.
- `__DigestCanonicalJson` — RFC 8785 canonical-JSON SHA-256 digests (`sha256:<hex>`) that every
  other authority binds against.

Pure decision logic plus the Prisma adapters (`PrismaRuntimeAuthorityRepository`,
`PrismaAuthorizationGrantRepository`, both appending audit evidence); no transport. The OpenCrane
server composes it; PEPs supply the trusted expectations — this library never derives trust from
request bytes. Tagged `scope:authorization`: it may depend only on `scope:audit`,
`scope:authorization` (the models package) and `scope:shared` — never on apps or sibling domains.
