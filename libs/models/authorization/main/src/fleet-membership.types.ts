import type { AuthorizationScope } from "./authorization-scope.types.js";

/** A claim that one subject belongs to one silo and one scope. It only means anything inside a signed {@link SignedFleetMembershipRevision}; on its own it is unverified data. */
export interface FleetMembershipAssertion
{
	/** Stable assertion identifier referenced by authorization evaluation. */
	assertionId: string;
	/** Stable silo identifier asserted for the subject. */
	siloId: string;
	/** Stable subject identifier whose membership is asserted. */
	subjectId: string;
	/** Exact independent authorization scope asserted for the subject. */
	scope: AuthorizationScope;
}

/** A signed set of membership claims for one silo. Evaluate it with {@link __EvaluateFleetMembershipRevision} rather than reading `assertions` directly — the signature, expiry, and revision ordering all have to be checked first. */
export interface SignedFleetMembershipRevision
{
	/** Positive, monotonically increasing revision issued by the fleet. */
	revision: number;
	/** Stable identity of the fleet issuer. */
	issuerId: string;
	/** Stable identifier of the issuer key used for verification. */
	issuerKeyId: string;
	/** Stable silo identifier covered by this revision. */
	siloId: string;
	/** Epoch-millisecond time at which this revision was issued. */
	issuedAtEpochMs: number;
	/** Epoch-millisecond time after which this revision is invalid. */
	expiresAtEpochMs: number;
	/** Digest of the exact signed revision payload. */
	payloadDigest: string;
	/** Opaque signature bound to the signed revision payload. */
	signature: string;
	/** Membership assertions covered by the signed payload. */
	assertions: readonly FleetMembershipAssertion[];
}

/** What a signature verifier reported. Passing it in keeps {@link __EvaluateFleetMembershipRevision} free of cryptography, so a caller must not fabricate these fields from the revision itself. */
export interface FleetSignatureVerificationEvidence
{
	/** Whether cryptographic signature verification succeeded. */
	verified: boolean;
	/** Issuer identity that the verifier bound to the signature. */
	issuerId: string;
	/** Issuer key identity that the verifier used. */
	issuerKeyId: string;
	/** Revision number bound by the verified payload. */
	revision: number;
	/** Silo identifier bound by the verified payload. */
	siloId: string;
	/** Payload digest bound by the verified signature. */
	payloadDigest: string;
	/** Opaque signature value checked by the verifier. */
	signature: string;
}

/** What the caller requires before trusting a revision: the issuer, silo, subject, assertion and scope it must contain, the highest revision already accepted, the current time, and the staleness limit. */
export interface FleetMembershipTrustExpectation
{
	/** Fleet issuer that is trusted for this evaluation. */
	trustedIssuerId: string;
	/** Silo in which the subject is expected to be a member. */
	siloId: string;
	/** Subject expected in the required assertion. */
	subjectId: string;
	/** Stable identifier of the required signed assertion. */
	assertionId: string;
	/** Exact scope expected in the required assertion. */
	scope: AuthorizationScope;
	/** Current epoch-millisecond time supplied by the caller. */
	nowEpochMs: number;
	/** Highest revision already accepted for this silo. Anything lower is rejected, which is what stops an old signed snapshot being replayed. */
	lastAcceptedRevision: number;
	/** Maximum permitted age of a signed revision in milliseconds. */
	maximumStalenessMs: number;
}

/** Stable reason for accepting or rejecting fleet membership evidence. */
export type FleetMembershipTrustReason =
	"trusted"
	| "invalid_time_policy"
	| "invalid_revision"
	| "revision_rollback"
	| "untrusted_issuer"
	| "signature_not_verified"
	| "verification_evidence_mismatch"
	| "silo_mismatch"
	| "invalid_issued_at"
	| "invalid_expiry"
	| "not_yet_valid"
	| "expired"
	| "stale"
	| "assertion_mismatch";

/** A trusted result. `trustedUntil` is a hard stop: the caller must stop relying on this decision at that time, not merely refresh it eventually. */
export interface TrustedFleetMembershipDecision
{
	/** Signals that every signed-envelope, time, and assertion check succeeded. */
	readonly outcome: "trusted";
	/** Stable successful trust reason. */
	readonly reason: "trusted";
	/** Revision evaluated at the trust boundary. */
	readonly revision: number;
	/** Organization from the exact signed assertion that matched this decision. */
	readonly organizationId: string;
	/** Earliest epoch-millisecond boundary after which trust must fail closed. */
	readonly trustedUntilEpochMs: number;
}

/** A denial. It carries the revision and a reason only — no organization, subject, or scope — so a caller cannot read identity out of a failed check. */
export interface DeniedFleetMembershipDecision
{
	/** Signals that the signed membership revision cannot be trusted. */
	readonly outcome: "denied";
	/** Stable rejection reason. */
	readonly reason: Exclude<FleetMembershipTrustReason, "trusted">;
	/** Revision evaluated at the trust boundary. */
	readonly revision: number;
}

/** Result of evaluating one signed fleet-membership revision. */
export type FleetMembershipTrustDecision = TrustedFleetMembershipDecision | DeniedFleetMembershipDecision;
