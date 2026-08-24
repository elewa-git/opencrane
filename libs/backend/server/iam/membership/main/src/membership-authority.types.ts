import type { FleetMembershipTrustReason, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/**
 * One membership question: is this subject still a member of this silo right now?
 *
 * A fleet issuer signs a numbered revision that lists every membership assertion for a silo. This
 * command names the single assertion the caller wants proved, plus how stale a revision it will
 * accept. Take `assertionId` from the stored revision itself, never from a value that arrived with
 * a request — {@link SignedFleetMembershipAssertionVerifier} exists to do that selection. Pass the
 * admission transaction's start time as `nowEpochMs` so every check inside one admission judges
 * freshness against the same instant.
 *
 * @see __VerifyCurrentFleetMembershipEvidence
 * @see FleetMembershipAcceptance
 */
export interface VerifyFleetMembershipCommand
{
	/** Fleet issuer trusted for membership facts. */
	readonly trustedIssuerId: string;
	/** Silo in which membership is required. */
	readonly siloId: string;
	/** Subject whose membership is required. */
	readonly subjectId: string;
	/** Identifier of the one signed assertion to prove; read it from the stored revision, not from a request. */
	readonly assertionId: string;
	/** Current time in epoch milliseconds, supplied by the caller so one admission uses one instant. */
	readonly nowEpochMs: number;
	/** Maximum permitted signed-revision age in milliseconds. */
	readonly maximumStalenessMs: number;
}

/**
 * Asks the store to record that this silo has now accepted revision N from this issuer.
 *
 * Each issuer-and-silo pair keeps one number: the newest revision it has ever accepted. Every
 * successful membership check moves that number forward, so a later request carrying an older
 * signed revision is refused as a rollback instead of being trusted again. `payloadDigest` must be
 * the digest of the exact revision that was verified, so accepting revision N twice with different
 * content is refused rather than silently overwritten.
 *
 * @see FleetMembershipAcceptanceResult
 * @see FleetMembershipAuthorityRepository
 */
export interface FleetMembershipAcceptance
{
	/** Issuer that signed the revision; each issuer has its own revision numbering per silo. */
	readonly issuerId: string;
	/** Silo whose accepted revision high-watermark changes. */
	readonly siloId: string;
	/** Positive verified fleet revision. */
	readonly revision: number;
	/** Digest of the exact verified signed payload. */
	readonly payloadDigest: string;
}

/**
 * What happened when the store tried to record the newest accepted revision.
 *
 * `accepted` — the number moved forward to this revision. `already_accepted` — this revision and
 * digest was already recorded, so a retry is safe and changes nothing. `conflict` — a newer
 * revision is already recorded, or this revision number is recorded with a different digest; the
 * caller must then treat membership as unproven and deny, never fall back to the older accepted
 * revision. `highestAcceptedRevision` always reports the number the store now holds.
 */
export type FleetMembershipAcceptanceResult =
	| { readonly status: "accepted" | "already_accepted"; readonly highestAcceptedRevision: number }
	| { readonly status: "conflict"; readonly highestAcceptedRevision: number };

/**
 * Stores the signed membership revisions a silo has received, plus the newest one it has accepted.
 *
 * Two kinds of state sit behind this port. The revisions are rows copied from the issuer, signature
 * and all. Separately, each issuer-and-silo pair keeps a single number: the highest revision ever
 * accepted here. That number only ever moves up. If an implementation lets it move down — or lets a
 * caller keep using an older accepted revision after a newer one landed — then anyone who replays a
 * stale signed revision gets membership the issuer has already withdrawn, because the old signature
 * is still perfectly valid.
 *
 * Called by: __VerifyCurrentFleetMembershipEvidence and SignedFleetMembershipAssertionVerifier in
 * this package. The live implementation is {@link PrismaFleetMembershipAuthorityRepository}, built by
 * libs/backend/agents/execution/inputs (personal runs),
 * libs/backend/server/agents/agent-services (managed runs), and
 * apps/opencrane/src/app/channel-target-composition.ts.
 *
 * @see FleetMembershipAcceptanceResult
 */
export interface FleetMembershipAuthorityRepository
{
	/**
	 * Loads the highest-numbered signed revision this silo has stored for that issuer.
	 *
	 * @param trustedIssuerId - Issuer the deployment trusts; revisions from anyone else are ignored.
	 * @param siloId - Silo whose membership is being checked.
	 * @returns The newest stored revision, or null when none has ever arrived — which callers must
	 *          treat as "not a member", never as "nothing to check".
	 */
	getLatestSignedRevision(trustedIssuerId: string, siloId: string): Promise<SignedFleetMembershipRevision | null>;
	/**
	 * Reads the highest revision number this silo has ever accepted from that issuer.
	 *
	 * @param trustedIssuerId - Issuer the deployment trusts.
	 * @param siloId - Silo whose membership is being checked.
	 * @returns The accepted revision number, or 0 when this silo has accepted none yet.
	 */
	getHighestAcceptedRevision(trustedIssuerId: string, siloId: string): Promise<number>;
	/**
	 * Records a newly verified revision as the newest accepted one for its issuer and silo.
	 *
	 * The `Atomically` suffix is a promise to callers: reading the current number and writing the new
	 * one happen under one lock, so two concurrent admissions cannot both believe they won. An older
	 * revision, or the same number with a different payload digest, is refused.
	 *
	 * @param acceptance - Issuer, silo, revision number, and digest of the revision just verified.
	 * @returns `accepted` or `already_accepted` when membership may be trusted; `conflict` when the
	 *          caller must deny.
	 */
	acceptRevisionAtomically(acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>;
}

/**
 * Checks the issuer's signature over a stored revision.
 *
 * An implementation holds the issuer's public key and nothing else — it answers "did this issuer
 * sign exactly these bytes?" and leaves every ordering and freshness rule to the caller. A
 * silo with no fleet key still gets an implementation: the standalone one answers `verified: false`
 * for everything, so a missing key can never read as "membership is fine".
 *
 * Called by: __VerifyCurrentFleetMembershipEvidence and SignedFleetMembershipAssertionVerifier;
 * supplied through {@link FleetMembershipEvidenceConfig} and implemented by
 * {@link Ed25519FleetMembershipSignatureVerifier}.
 */
export interface FleetMembershipSignatureVerifier
{
	/**
	 * Recomputes the payload digest, checks the signature over it, and reports what it found.
	 *
	 * @param revision - Stored signed revision, including its claimed digest and signature.
	 * @returns Evidence repeating the issuer, key, revision, silo, digest, and signature actually
	 *          seen, with `verified` false when the signature does not hold. Return false rather than
	 *          throwing: __VerifyCurrentFleetMembershipEvidence treats a thrown error as a broken
	 *          verifier and denies with `signature_verifier_failed`.
	 */
	verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>;
}

/**
 * The three deployment-owned values every membership check needs: who to trust, how stale is too
 * stale, and the key to check signatures with.
 *
 * Built once at startup from environment variables by {@link _CreateFleetMembershipEvidenceConfig}
 * and then passed down, so no request can pick its own issuer or widen its own staleness limit.
 *
 * Called by: apps/opencrane/src/index.ts and apps/opencrane/src/app/channel-target-composition.ts
 * build it; libs/backend/agents/execution/admission, libs/backend/agents/execution/inputs, and
 * libs/backend/server/agents/agent-services consume it.
 */
export interface FleetMembershipEvidenceConfig
{
	/** The single issuer id this silo will accept signed revisions from; all others are ignored. */
	readonly trustedIssuerId: string;
	/** Maximum permitted age of a signed revision at admission. */
	readonly maximumStalenessMs: number;
	/** Verifier holding the issuer's public key, re-read from its mounted file on every check. */
	readonly verifier: FleetMembershipSignatureVerifier;
}

/**
 * Explicit deployment model for the membership issuer consumed by one silo.
 *
 * The value is deployment configuration, not a request claim: `Fleet` retains the independent
 * Fleet signer boundary, while `Standalone` lets a silo start without pretending that an absent
 * Fleet key establishes membership. Standalone admission remains denied until a local issuer is
 * implemented and has issued a signed revision.
 */
export enum FleetMembershipDeploymentModes
{
	/** Requires the independently managed Fleet public verification key. */
	Fleet = "fleet",
	/** Starts a silo without Fleet trust; no unsigned membership is ever accepted. */
	Standalone = "standalone",
}

/**
 * The two answers a membership check can give, as the exact string values that appear in `outcome`.
 *
 * Compare against these instead of typing the strings —
 * libs/backend/agents/execution/inputs/main/src/personal-execution-identity-envelope-source.ts does
 * exactly that when it turns `Denied` into a refused run. `Trusted` carries signer-produced
 * evidence; `Denied` carries only a reason code and the revision number that was looked at, because
 * a denial must never leak identity taken from an unproven assertion.
 *
 * @see VerifyFleetMembershipEvidenceResult
 */
export enum FleetMembershipEvidenceOutcomes
{
	/** The exact signed assertion is current and accepted for admission. */
	Trusted = "trusted",
	/** Membership evidence failed closed and grants no admission authority. */
	Denied = "denied",
}

/**
 * The membership facts a successful check produces, every one of them taken from the signed revision.
 *
 * Nothing here is copied from the request being admitted, and that is the point: a run stores this
 * block and can later be checked against the issuer's own signature. Callers freeze it inside the
 * admission transaction, so a run's recorded membership cannot change afterwards.
 * `trustedUntilEpochMs` is the earlier of the revision's own expiry and the configured staleness
 * limit — past that instant the membership must be checked again, not trusted on.
 *
 * @see VerifyFleetMembershipEvidenceResult
 */
export interface TrustedFleetMembershipEvidence
{
	/** Fleet issuer that signed and owns the accepted revision. */
	readonly issuerId: string;
	/** Fleet signing key that cryptographically verified the accepted revision. */
	readonly issuerKeyId: string;
	/** Accepted monotonic signed revision. */
	readonly revision: number;
	/** Identifier of the assertion inside the revision that covered this subject. */
	readonly assertionId: string;
	/** Subject whose membership was verified. */
	readonly subjectId: string;
	/** Digest of the exact signed membership payload. */
	readonly payloadDigest: string;
	/** UTC epoch-millisecond limit on trust for this verified evidence. */
	readonly trustedUntilEpochMs: number;
}

/**
 * Answer of a membership check that reports only the trust window, not the membership facts.
 *
 * `trusted` gives the accepted revision number and the instant trust runs out. `denied` gives a
 * reason — `missing_revision` (nothing stored for this issuer and silo),
 * `signature_verifier_failed` (the verifier threw), `acceptance_conflict` (a newer revision was
 * accepted concurrently), or any {@link FleetMembershipTrustReason} from the signature, scope,
 * expiry, and ordering rules — plus the revision looked at, which is 0 when nothing was stored.
 *
 * @see VerifyFleetMembershipEvidenceResult for the variant that also returns the signed facts.
 */
export type VerifyFleetMembershipResult =
	| { readonly outcome: "trusted"; readonly revision: number; readonly trustedUntilEpochMs: number }
	| { readonly outcome: "denied"; readonly reason: FleetMembershipTrustReason | "missing_revision" | "signature_verifier_failed" | "acceptance_conflict"; readonly revision: number };

/**
 * Answers "is this subject an active member of this silo?" for callers that hold no assertion id.
 *
 * The implementation finds the matching assertion itself, so a request never gets to name the
 * assertion that proves its own membership.
 *
 * Called by: libs/backend/server/agents/channel-targets declares it as a dependency
 * (channel-target-resolution.types.ts); apps/opencrane/src/app/channel-target-composition.ts
 * supplies {@link SignedFleetMembershipAssertionVerifier} as the implementation.
 */
export interface SignedFleetMembershipAssertionAuthority
{
	/**
	 * Finds the single assertion matching this subject and silo, then runs the full check.
	 *
	 * @param subjectId - Subject whose membership is in question.
	 * @param siloId - Silo the request is happening in.
	 * @param nowEpochMs - Current time in epoch milliseconds, from the caller.
	 * @returns `trusted` with the trust window, or `denied` — including `assertion_mismatch` when the
	 *          stored revision holds no matching assertion, or more than one.
	 */
	verifyCurrentMembership(subjectId: string, siloId: string, nowEpochMs: number): Promise<VerifyFleetMembershipResult>;
}

/**
 * Answer of a membership check that also hands back the signed facts on success.
 *
 * On `trusted`, `evidence` is safe to store on the run: every field came from the signed revision.
 * On `denied` there is deliberately no evidence — only a reason code and the revision number looked
 * at — so a caller cannot pick identity out of an assertion that failed verification.
 *
 * @see TrustedFleetMembershipEvidence
 */
export type VerifyFleetMembershipEvidenceResult =
	| { readonly outcome: "trusted"; readonly evidence: TrustedFleetMembershipEvidence }
	| { readonly outcome: "denied"; readonly reason: FleetMembershipTrustReason | "missing_revision" | "signature_verifier_failed" | "acceptance_conflict"; readonly revision: number };
