import type { ActionCapability, CanonicalJsonSha256Digest, CapabilityReference } from "./capability.types.js";
import type { AuthorizationResourceLocator } from "./resource-locator.types.js";

/** Public P-256 JSON Web Key accepted for ES256 proof verification. */
export interface Es256PublicJwk
{
	/** JSON Web Key type; ES256 requires an elliptic-curve key. */
	readonly kty: "EC";
	/** Named curve; ES256 requires P-256. */
	readonly crv: "P-256";
	/** Base64url-encoded 32-byte affine x-coordinate. */
	readonly x: string;
	/** Base64url-encoded 32-byte affine y-coordinate. */
	readonly y: string;
}

/** The signed JOSE header of a capability proof. It carries the public proof key, so a verifier reads the key from here and then checks it against the thumbprint registered for the workload. @see https://www.rfc-editor.org/rfc/rfc9449 */
export interface CapabilityProofHeader
{
	/** Proof type required by RFC 9449. */
	readonly typ: "dpop+jwt";
	/** JOSE signature algorithm; proof keys are P-256 only. */
	readonly alg: "ES256";
	/** Public proof key carried by the protected header. */
	readonly jwk: Es256PublicJwk;
}

/** The signed body of a capability proof. Every field must match the independently observed fact in {@link CapabilityProofBindingExpectation}; a proof that verifies cryptographically but disagrees on any binding is still rejected. */
export interface CapabilityProofClaims
{
	/** Exact policy-enforcement audience receiving the proof. */
	readonly aud: string;
	/** Capability-instance identifier used for replay handling. */
	readonly jti: string;
	/** Uppercase HTTP method from the DPoP request binding. */
	readonly htm: string;
	/** Normalized request URI without query or fragment. */
	readonly htu: string;
	/** NumericDate at which the proof was created. */
	readonly iat: number;
	/** Capability NumericDate lower validity boundary. */
	readonly nbf: number;
	/** Capability NumericDate hard expiry boundary. */
	readonly exp: number;
	/** Silo in which the capability and proof are valid. */
	readonly silo_id: string;
	/** Subject exercising the capability. */
	readonly subject_id: string;
	/** Exact projected Kubernetes service account of the exercising workload. */
	readonly service_account_name: string;
	/** Exact Kubernetes namespace containing the exercising workload. */
	readonly namespace: string;
	/** Controller-managed Kubernetes workload kind exercising the capability. */
	readonly workload_kind: "job" | "deployment";
	/** Immutable Kubernetes Job or Deployment UID assigned by the controller. */
	readonly workload_uid: string;
	/** Immutable Kubernetes Pod UID registered for the run attempt. */
	readonly pod_uid: string;
	/** Stable AgentService being executed. */
	readonly agent_service_id: string;
	/** Immutable AgentRevision being executed. */
	readonly agent_revision_id: string;
	/** Logical AgentRun receiving the action. */
	readonly run_id: string;
	/** Positive attempt number within the single logical AgentRun. */
	readonly attempt: number;
	/** RFC 7638 thumbprint of the public proof key carried by the JOSE header. */
	readonly proof_key_thumbprint: string;
	/** Immutable capability catalog reference authorizing the action. */
	readonly capability: CapabilityReference;
	/** Exact resource receiving the action. */
	readonly resource: AuthorizationResourceLocator;
	/** Exact action name being exercised. */
	readonly action: string;
	/** SHA-256 digest of the RFC 8785 canonical request arguments. */
	readonly arguments_digest: CanonicalJsonSha256Digest;
	/** Digest of the exact effective policy and grant set used for issuance. */
	readonly effective_authorization_digest: CanonicalJsonSha256Digest;
}

/** What the enforcement point independently knows to be true about the caller. Each field is compared against the matching signed claim, so these must never be read out of the proof itself. */
export interface CapabilityProofBindingExpectation
{
	/** Expected policy-enforcement audience. */
	readonly audience: string;
	/** Expected silo containing the authority state. */
	readonly siloId: string;
	/** Expected human or service authorization subject. */
	readonly subjectId: string;
	/** Expected projected Kubernetes service account. */
	readonly serviceAccountName: string;
	/** Expected Kubernetes namespace. */
	readonly namespace: string;
	/** Expected controller-managed Kubernetes workload kind. */
	readonly workloadKind: "job" | "deployment";
	/** Expected immutable Kubernetes Job or Deployment UID. */
	readonly workloadUid: string;
	/** Expected immutable Kubernetes Pod UID. */
	readonly podUid: string;
	/** Expected stable AgentService identifier. */
	readonly agentServiceId: string;
	/** Expected immutable AgentRevision identifier. */
	readonly agentRevisionId: string;
	/** Expected logical AgentRun identifier. */
	readonly runId: string;
	/** Expected positive attempt within the single logical AgentRun. */
	readonly attempt: number;
	/** Expected RFC 7638 proof-key thumbprint registered for the workload. */
	readonly proofKeyThumbprint: string;
	/** Expected immutable capability catalog reference. */
	readonly capability: CapabilityReference;
	/** Expected exact action resource. */
	readonly resource: AuthorizationResourceLocator;
	/** Expected exact capability action. */
	readonly action: string;
	/** Expected digest of the observed RFC 8785 canonical request arguments. */
	readonly argumentsDigest: CanonicalJsonSha256Digest;
	/** Expected digest of the effective policy and grant set. */
	readonly effectiveAuthorizationDigest: CanonicalJsonSha256Digest;
}

/** Everything a verifier needs to check one capability proof: the proof, the independently observed bindings, the live request method and URI, the current time, and the tolerances. */
export interface CapabilityProofExpectation
{
	/** Short-lived action capability presented at the policy-enforcement point. */
	readonly capability: ActionCapability;
	/** Independently trusted workload, run, policy, and request bindings. */
	readonly binding: CapabilityProofBindingExpectation;
	/** HTTP request method observed by the policy-enforcement point. */
	readonly httpMethod: string;
	/** Absolute request URI observed by the policy-enforcement point. */
	readonly targetUri: string;
	/** Trusted current NumericDate supplied by the verifier. */
	readonly nowEpochSeconds: number;
	/** Maximum accepted age of a signed proof in whole seconds. */
	readonly maximumProofAgeSeconds: number;
	/** Clock tolerance for future issuance and capability validity boundaries. */
	readonly clockSkewSeconds: number;
}

/**
 * Why a capability proof was rejected.
 *
 * Every value means the same thing to a caller: deny. The distinctions exist for audit and
 * debugging, so a caller must not branch on them to allow anything or to retry — the reason is
 * safe to log but is not a signal that the request could succeed if repeated.
 */
export type CapabilityProofFailureReason =
	"malformed_compact_proof"
	| "malformed_header"
	| "malformed_public_key"
	| "invalid_signature"
	| "malformed_claims"
	| "invalid_expectation"
	| "capability_not_active"
	| "proof_too_old"
	| "proof_from_future"
	| "audience_mismatch"
	| "proof_key_mismatch"
	| "method_mismatch"
	| "target_uri_mismatch"
	| "capability_mismatch"
	| "silo_mismatch"
	| "subject_mismatch"
	| "service_account_mismatch"
	| "namespace_mismatch"
	| "workload_kind_mismatch"
	| "workload_uid_mismatch"
	| "pod_uid_mismatch"
	| "agent_service_mismatch"
	| "agent_revision_mismatch"
	| "run_mismatch"
	| "attempt_mismatch"
	| "capability_reference_mismatch"
	| "resource_mismatch"
	| "action_mismatch"
	| "arguments_mismatch"
	| "authorization_digest_mismatch"
	| "capability_window_mismatch";

/** A proof whose signature verified AND whose every claim matched the independently observed binding. Both had to pass; neither alone produces this result. */
export interface ValidCapabilityProof
{
	/** Positive verification discriminator. */
	readonly valid: true;
	/** Verified RFC 7638 thumbprint of the public proof key. */
	readonly proofKeyThumbprint: string;
	/** Signed claims after strict shape and binding validation. */
	readonly claims: CapabilityProofClaims;
}

/** A rejected proof. It deliberately carries no claims at all, so a caller cannot accidentally read identity out of a failed verification. */
export interface InvalidCapabilityProof
{
	/** Negative verification discriminator. */
	readonly valid: false;
	/** Stable reason at the first failed verification boundary. */
	readonly reason: CapabilityProofFailureReason;
}

/** Fail-closed result of capability-proof verification. */
export type CapabilityProofVerification = ValidCapabilityProof | InvalidCapabilityProof;
