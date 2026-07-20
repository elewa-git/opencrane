import type { AuthorizationScope, FleetMembershipTrustReason, FleetSignatureVerificationEvidence, SignedFleetMembershipRevision } from "@opencrane/models/authorization";

/** Command for trusting the freshest signed fleet-membership revision available to one silo. */
export interface VerifyFleetMembershipCommand
{
	/** Fleet issuer trusted for membership facts. */
	readonly trustedIssuerId: string;
	/** Silo in which membership is required. */
	readonly siloId: string;
	/** Subject whose membership is required. */
	readonly subjectId: string;
	/** Stable signed assertion identifier required by the authorization request. */
	readonly assertionId: string;
	/** Exact independent scope required by the authorization request. */
	readonly scope: AuthorizationScope;
	/** Trusted current epoch-millisecond time. */
	readonly nowEpochMs: number;
	/** Maximum permitted signed-revision age in milliseconds. */
	readonly maximumStalenessMs: number;
}

/** Atomic high-watermark acceptance request after membership verification. */
export interface FleetMembershipAcceptance
{
	/** Fleet issuer whose independently ordered revision is being accepted. */
	readonly issuerId: string;
	/** Silo whose accepted revision high-watermark changes. */
	readonly siloId: string;
	/** Positive verified fleet revision. */
	readonly revision: number;
	/** Digest of the exact verified signed payload. */
	readonly payloadDigest: string;
}

/** Result of atomically advancing one issuer-and-silo membership high-watermark. */
export type FleetMembershipAcceptanceResult =
	| { readonly status: "accepted" | "already_accepted"; readonly highestAcceptedRevision: number }
	| { readonly status: "conflict"; readonly highestAcceptedRevision: number };

/** Persistence boundary for signed revisions and monotonic acceptance state. */
export interface FleetMembershipAuthorityRepository
{
	/** Loads the newest locally available signed revision for the exact trusted issuer and silo. */
	getLatestSignedRevision(trustedIssuerId: string, siloId: string): Promise<SignedFleetMembershipRevision | null>;
	/** Loads the highest revision previously accepted for the exact trusted issuer and silo. */
	getHighestAcceptedRevision(trustedIssuerId: string, siloId: string): Promise<number>;
	/** Atomically advances the exact issuer-and-silo high-watermark, rejecting rollback and digest changes. */
	acceptRevisionAtomically(acceptance: FleetMembershipAcceptance): Promise<FleetMembershipAcceptanceResult>;
}

/** Cryptographic verification boundary for fleet-issued signed revisions. */
export interface FleetMembershipSignatureVerifier
{
	/** Verifies the exact envelope and returns evidence bound to every signed field. */
	verify(revision: SignedFleetMembershipRevision): Promise<FleetSignatureVerificationEvidence>;
}

/** Stable domain result for current fleet-membership trust. */
export type VerifyFleetMembershipResult =
	| { readonly outcome: "trusted"; readonly revision: number; readonly trustedUntilEpochMs: number }
	| { readonly outcome: "denied"; readonly reason: FleetMembershipTrustReason | "missing_revision" | "signature_verifier_failed" | "acceptance_conflict"; readonly revision: number };
