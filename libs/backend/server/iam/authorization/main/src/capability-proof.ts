import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { TextDecoder } from "node:util";

import type { CapabilityProofClaims, CapabilityProofExpectation, CapabilityProofFailureReason, CapabilityProofVerification, CapabilityReference, Es256PublicJwk, InvalidCapabilityProof } from "@opencrane/models/authorization";
import { __AuthorizationResourcesEqual, __IsAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___CanonicalizeJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

/** Maximum compact proof size accepted before parsing. */
const MAX_COMPACT_PROOF_BYTES = 16_384;

/** Exact lowercase-hex canonical JSON SHA-256 digest format. */
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** Exact unpadded base64url encoding accepted by JOSE. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/** RFC 9110 HTTP method token syntax used by DPoP request binding. */
const HTTP_METHOD_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/** Strict UTF-8 decoder used for protected JSON parts. */
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Produces a failed verification result without partially trusted claims. */
function _failure(reason: InvalidCapabilityProof["reason"]): InvalidCapabilityProof
{
	return { valid: false, reason };
}

/** Determines whether an unknown value is a non-array object. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decodes canonical, unpadded base64url bytes. */
function _decodeBase64Url(value: string): Buffer | null
{
	if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1)
	{
		return null;
	}
	const decoded = Buffer.from(value, "base64url");
	return decoded.toString("base64url") === value ? decoded : null;
}

/** Parses one protected JOSE JSON object with strict UTF-8. */
function _parseProtectedObject(encodedValue: string): Record<string, unknown> | null
{
	const decoded = _decodeBase64Url(encodedValue);
	if (decoded === null) return null;
	try
	{
		const parsed = JSON.parse(UTF8_DECODER.decode(decoded)) as unknown;
		return _isRecord(parsed) ? parsed : null;
	}
	catch
	{
		return null;
	}
}

/** Verifies that an unknown value is a non-empty string. */
function _isNonEmptyString(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0;
}

/** Verifies one accepted controller workload-kind discriminator. */
function _isWorkloadKind(value: unknown): value is "job" | "deployment"
{
	return value === "job" || value === "deployment";
}

/** Validates one unpadded base64url P-256 coordinate. */
function _isP256Coordinate(value: unknown): value is string
{
	if (typeof value !== "string") return false;
	const decoded = _decodeBase64Url(value);
	return decoded?.length === 32;
}

/** Validates one unpadded base64url SHA-256 thumbprint. */
function _isSha256Thumbprint(value: unknown): value is string
{
	if (typeof value !== "string") return false;
	const decoded = _decodeBase64Url(value);
	return decoded?.length === 32;
}

/** Reads one public-only P-256 JWK from an untrusted protected header. */
function _readEs256PublicJwk(value: unknown): Es256PublicJwk | null
{
	if (!_isRecord(value) || value.kty !== "EC" || value.crv !== "P-256" || !_isP256Coordinate(value.x) || !_isP256Coordinate(value.y) || Object.hasOwn(value, "d"))
	{
		return null;
	}
	return { kty: "EC", crv: "P-256", x: value.x, y: value.y };
}

/** Imports a validated public key and confirms that its point lies on P-256. */
function _importPublicKey(jwk: Es256PublicJwk): ReturnType<typeof createPublicKey> | null
{
	try
	{
		return createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
	}
	catch
	{
		return null;
	}
}

/** Reads one exact immutable capability catalog reference from signed claims. */
function _readCapabilityReference(value: unknown): CapabilityReference | null
{
	if (!_isRecord(value) || !_isRecord(value.catalog)) return null;
	const keys = Reflect.ownKeys(value);
	const catalogKeys = Reflect.ownKeys(value.catalog);
	if (keys.length !== 2
		|| !keys.every(key => key === "catalog" || key === "capabilityId")
		|| catalogKeys.length !== 3
		|| !catalogKeys.every(key => key === "catalogId" || key === "revision" || key === "digest")
		|| !_isNonEmptyString(value.capabilityId)
		|| !_isNonEmptyString(value.catalog.catalogId)
		|| !Number.isSafeInteger(value.catalog.revision)
		|| (value.catalog.revision as number) < 1
		|| !_isNonEmptyString(value.catalog.digest)
		|| !SHA256_DIGEST_PATTERN.test(value.catalog.digest))
	{
		return null;
	}
	return { catalog: { catalogId: value.catalog.catalogId, revision: value.catalog.revision as number, digest: value.catalog.digest as CapabilityReference["catalog"]["digest"] }, capabilityId: value.capabilityId };
}

/** Returns whether two immutable capability catalog references are byte-for-byte equal. */
function _capabilityReferencesEqual(first: CapabilityReference, second: CapabilityReference): boolean
{
	return first.capabilityId === second.capabilityId
		&& first.catalog.catalogId === second.catalog.catalogId
		&& first.catalog.revision === second.catalog.revision
		&& first.catalog.digest === second.catalog.digest;
}

/** Reads the exact signed claim shape used for action-capability possession. */
function _readClaims(value: Record<string, unknown>): CapabilityProofClaims | null
{
	const resource = value.resource;
	const capability = _readCapabilityReference(value.capability);
	if (!_isNonEmptyString(value.aud)
		|| !_isNonEmptyString(value.jti)
		|| !_isNonEmptyString(value.htm)
		|| !_isNonEmptyString(value.htu)
		|| !Number.isSafeInteger(value.iat)
		|| (value.iat as number) < 0
		|| !Number.isSafeInteger(value.nbf)
		|| (value.nbf as number) < 0
		|| !Number.isSafeInteger(value.exp)
		|| (value.exp as number) <= (value.nbf as number)
		|| !_isNonEmptyString(value.silo_id)
		|| !_isNonEmptyString(value.subject_id)
		|| !_isNonEmptyString(value.service_account_name)
		|| !_isNonEmptyString(value.namespace)
		|| !_isWorkloadKind(value.workload_kind)
		|| !_isNonEmptyString(value.workload_uid)
		|| !_isNonEmptyString(value.pod_uid)
		|| !_isNonEmptyString(value.agent_service_id)
		|| !_isNonEmptyString(value.agent_revision_id)
		|| !_isNonEmptyString(value.run_id)
		|| !Number.isSafeInteger(value.attempt)
		|| (value.attempt as number) < 1
		|| !_isSha256Thumbprint(value.proof_key_thumbprint)
		|| capability === null
		|| !__IsAuthorizationResourceLocator(resource)
		|| !_isNonEmptyString(value.action)
		|| typeof value.arguments_digest !== "string"
		|| !SHA256_DIGEST_PATTERN.test(value.arguments_digest)
		|| typeof value.effective_authorization_digest !== "string"
		|| !SHA256_DIGEST_PATTERN.test(value.effective_authorization_digest))
	{
		return null;
	}
	return {
		aud: value.aud,
		jti: value.jti,
		htm: value.htm,
		htu: value.htu,
		iat: value.iat as number,
		nbf: value.nbf as number,
		exp: value.exp as number,
		silo_id: value.silo_id,
		subject_id: value.subject_id,
		service_account_name: value.service_account_name,
		namespace: value.namespace,
		workload_kind: value.workload_kind,
		workload_uid: value.workload_uid,
		pod_uid: value.pod_uid,
		agent_service_id: value.agent_service_id,
		agent_revision_id: value.agent_revision_id,
		run_id: value.run_id,
		attempt: value.attempt as number,
		proof_key_thumbprint: value.proof_key_thumbprint,
		capability,
		resource,
		action: value.action,
		arguments_digest: value.arguments_digest as CapabilityProofClaims["arguments_digest"],
		effective_authorization_digest: value.effective_authorization_digest as CapabilityProofClaims["effective_authorization_digest"],
	};
}

/** Normalizes a DPoP target URI while excluding query and fragment components. */
function _normalizeDpopTargetUri(targetUri: string): string | null
{
	try
	{
		const target = new URL(targetUri);
		if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username.length > 0 || target.password.length > 0) return null;
		return `${target.origin}${target.pathname}`;
	}
	catch
	{
		return null;
	}
}

/** Validates trusted verifier inputs before they influence a proof decision. */
function _expectationIsValid(expectation: CapabilityProofExpectation): boolean
{
	const capability = expectation.capability;
	const binding = expectation.binding;
	return HTTP_METHOD_PATTERN.test(expectation.httpMethod)
		&& _normalizeDpopTargetUri(expectation.targetUri) !== null
		&& Number.isSafeInteger(expectation.nowEpochSeconds)
		&& expectation.nowEpochSeconds >= 0
		&& Number.isSafeInteger(expectation.maximumProofAgeSeconds)
		&& expectation.maximumProofAgeSeconds > 0
		&& Number.isSafeInteger(expectation.clockSkewSeconds)
		&& expectation.clockSkewSeconds >= 0
		&& _isNonEmptyString(capability.jti)
		&& _isNonEmptyString(capability.audience)
		&& _isNonEmptyString(capability.siloId)
		&& _isNonEmptyString(capability.subjectId)
		&& _isNonEmptyString(capability.serviceAccountName)
		&& _isNonEmptyString(capability.namespace)
		&& _isWorkloadKind(capability.workloadKind)
		&& _isNonEmptyString(capability.workloadUid)
		&& _isNonEmptyString(capability.podUid)
		&& _isNonEmptyString(capability.agentServiceId)
		&& _isNonEmptyString(capability.agentRevisionId)
		&& _isNonEmptyString(capability.runId)
		&& Number.isSafeInteger(capability.attempt)
		&& capability.attempt > 0
		&& _readCapabilityReference(capability.capability) !== null
		&& __IsAuthorizationResourceLocator(capability.resource)
		&& _isNonEmptyString(capability.action)
		&& SHA256_DIGEST_PATTERN.test(capability.argumentsDigest)
		&& _isSha256Thumbprint(capability.proofKeyThumbprint)
		&& SHA256_DIGEST_PATTERN.test(capability.effectiveAuthorizationDigest)
		&& Number.isSafeInteger(capability.notBefore)
		&& capability.notBefore >= 0
		&& Number.isSafeInteger(capability.expiresAt)
		&& capability.expiresAt > capability.notBefore
		&& _isNonEmptyString(binding.audience)
		&& _isNonEmptyString(binding.siloId)
		&& _isNonEmptyString(binding.subjectId)
		&& _isNonEmptyString(binding.serviceAccountName)
		&& _isNonEmptyString(binding.namespace)
		&& _isWorkloadKind(binding.workloadKind)
		&& _isNonEmptyString(binding.workloadUid)
		&& _isNonEmptyString(binding.podUid)
		&& _isNonEmptyString(binding.agentServiceId)
		&& _isNonEmptyString(binding.agentRevisionId)
		&& _isNonEmptyString(binding.runId)
		&& Number.isSafeInteger(binding.attempt)
		&& binding.attempt > 0
		&& _isSha256Thumbprint(binding.proofKeyThumbprint)
		&& _readCapabilityReference(binding.capability) !== null
		&& __IsAuthorizationResourceLocator(binding.resource)
		&& _isNonEmptyString(binding.action)
		&& SHA256_DIGEST_PATTERN.test(binding.argumentsDigest)
		&& SHA256_DIGEST_PATTERN.test(binding.effectiveAuthorizationDigest);
}

/** Returns the first mismatch between issued capability authority and trusted observed bindings. */
function _capabilityBindingFailure(expectation: CapabilityProofExpectation): CapabilityProofFailureReason | null
{
	const capability = expectation.capability;
	const binding = expectation.binding;

	// 1. Principal and workload bindings prevent a capability crossing a runtime trust boundary.
	if (capability.audience !== binding.audience) return "audience_mismatch";
	if (capability.siloId !== binding.siloId) return "silo_mismatch";
	if (capability.subjectId !== binding.subjectId) return "subject_mismatch";
	if (capability.serviceAccountName !== binding.serviceAccountName) return "service_account_mismatch";
	if (capability.namespace !== binding.namespace) return "namespace_mismatch";
	if (capability.workloadKind !== binding.workloadKind) return "workload_kind_mismatch";
	if (capability.workloadUid !== binding.workloadUid) return "workload_uid_mismatch";
	if (capability.podUid !== binding.podUid) return "pod_uid_mismatch";

	// 2. Agent and run-attempt bindings keep one capability inside its immutable execution authority.
	if (capability.agentServiceId !== binding.agentServiceId) return "agent_service_mismatch";
	if (capability.agentRevisionId !== binding.agentRevisionId) return "agent_revision_mismatch";
	if (capability.runId !== binding.runId) return "run_mismatch";
	if (capability.attempt !== binding.attempt) return "attempt_mismatch";
	if (capability.proofKeyThumbprint !== binding.proofKeyThumbprint) return "proof_key_mismatch";

	// 3. Policy, resource, action, and argument bindings prevent redirecting valid proof possession.
	if (!_capabilityReferencesEqual(capability.capability, binding.capability)) return "capability_reference_mismatch";
	if (!__AuthorizationResourcesEqual(capability.resource, binding.resource)) return "resource_mismatch";
	if (capability.action !== binding.action) return "action_mismatch";
	if (capability.argumentsDigest !== binding.argumentsDigest) return "arguments_mismatch";
	if (capability.effectiveAuthorizationDigest !== binding.effectiveAuthorizationDigest) return "authorization_digest_mismatch";
	return null;
}

/**
 * Computes the RFC 7638 SHA-256 thumbprint for a public ES256 key.
 * @param jwk - Public P-256 JSON Web Key.
 * @returns Unpadded base64url thumbprint over required canonical JWK members.
 * @throws TypeError when the key is malformed, private, or not on P-256.
 */
export function __ComputeEs256JwkThumbprint(jwk: Es256PublicJwk): string
{
	const validatedJwk = _readEs256PublicJwk(jwk);
	if (validatedJwk === null || _importPublicKey(validatedJwk) === null)
	{
		throw new TypeError("RFC 7638 ES256 thumbprints require a valid public P-256 JWK");
	}
	const canonicalJwk = ___CanonicalizeJson({ crv: validatedJwk.crv, kty: validatedJwk.kty, x: validatedJwk.x, y: validatedJwk.y } as JsonValue);
	return createHash("sha256").update(canonicalJwk, "utf8").digest("base64url");
}

/**
 * Normalizes an observed target URI to the RFC 9449 `htu` representation.
 * @param targetUri - Absolute HTTP or HTTPS request URI.
 * @returns Normalized URI without query or fragment.
 * @throws TypeError when the URI is not a safe absolute HTTP target.
 */
export function __NormalizeDpopTargetUri(targetUri: string): string
{
	const normalized = _normalizeDpopTargetUri(targetUri);
	if (normalized === null)
	{
		throw new TypeError("DPoP target URI must be an absolute HTTP URI without credentials");
	}
	return normalized;
}

/**
 * Verifies an ES256 RFC 9449-style compact proof against one exact action capability.
 * @param compactProof - Compact JWS carried in the request's DPoP proof field.
 * @param expectation - Trusted request and action-capability facts from the PEP.
 * @returns Fail-closed verification with claims only after every binding succeeds.
 */
export function __VerifyCapabilityProof(compactProof: string, expectation: CapabilityProofExpectation): CapabilityProofVerification
{
	// 1. Validate trusted policy facts before parsing attacker-controlled proof bytes.
	if (!_expectationIsValid(expectation)) return _failure("invalid_expectation");
	const bindingFailure = _capabilityBindingFailure(expectation);
	if (bindingFailure !== null) return _failure(bindingFailure);

	// 2. Bound and parse the compact JWS framing and protected header after trusted facts agree.
	if (Buffer.byteLength(compactProof, "utf8") > MAX_COMPACT_PROOF_BYTES) return _failure("malformed_compact_proof");
	const parts = compactProof.split(".");
	if (parts.length !== 3 || parts.some(part => part.length === 0)) return _failure("malformed_compact_proof");
	const header = _parseProtectedObject(parts[0]);
	if (header === null || header.typ !== "dpop+jwt" || header.alg !== "ES256") return _failure("malformed_header");

	// 3. Reject private, wrong-curve, malformed, or invalid-point proof keys.
	const publicJwk = _readEs256PublicJwk(header.jwk);
	const publicKey = publicJwk === null ? null : _importPublicKey(publicJwk);
	if (publicJwk === null || publicKey === null) return _failure("malformed_public_key");

	// 4. Verify the JOSE P1363 signature before trusting any payload claim.
	const signature = _decodeBase64Url(parts[2]);
	if (signature === null || signature.length !== 64) return _failure("invalid_signature");
	const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
	if (!verify("sha256", signingInput, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)) return _failure("invalid_signature");

	// 5. Parse every required standard and OpenCrane claim after signature verification.
	const parsedClaims = _parseProtectedObject(parts[1]);
	const claims = parsedClaims === null ? null : _readClaims(parsedClaims);
	if (claims === null) return _failure("malformed_claims");

	// 6. Enforce the capability window and bounded proof age/future skew.
	const { capability, clockSkewSeconds, maximumProofAgeSeconds, nowEpochSeconds } = expectation;
	if (nowEpochSeconds + clockSkewSeconds < capability.notBefore || nowEpochSeconds - clockSkewSeconds >= capability.expiresAt) return _failure("capability_not_active");
	if (claims.iat < nowEpochSeconds - maximumProofAgeSeconds) return _failure("proof_too_old");
	if (claims.iat > nowEpochSeconds + clockSkewSeconds) return _failure("proof_from_future");

	// 7. Bind the proof key to the signed claim, issued capability, and independently observed runtime.
	const proofKeyThumbprint = __ComputeEs256JwkThumbprint(publicJwk);
	if (proofKeyThumbprint !== claims.proof_key_thumbprint || proofKeyThumbprint !== capability.proofKeyThumbprint || proofKeyThumbprint !== expectation.binding.proofKeyThumbprint) return _failure("proof_key_mismatch");

	// 8. Bind DPoP audience, HTTP method, and normalized target URI to observed request facts.
	if (claims.aud !== capability.audience) return _failure("audience_mismatch");
	if (claims.htm !== expectation.httpMethod.toUpperCase()) return _failure("method_mismatch");
	const normalizedClaimTarget = _normalizeDpopTargetUri(claims.htu);
	const normalizedExpectedTarget = _normalizeDpopTargetUri(expectation.targetUri);
	if (normalizedClaimTarget === null || claims.htu !== normalizedClaimTarget || normalizedClaimTarget !== normalizedExpectedTarget) return _failure("target_uri_mismatch");

	// 9. Bind every signed workload, run, policy, resource, action, and validity field.
	if (claims.jti !== capability.jti) return _failure("capability_mismatch");
	if (claims.nbf !== capability.notBefore || claims.exp !== capability.expiresAt) return _failure("capability_window_mismatch");
	if (claims.iat + clockSkewSeconds < claims.nbf || claims.iat - clockSkewSeconds >= claims.exp) return _failure("capability_window_mismatch");
	if (claims.silo_id !== capability.siloId) return _failure("silo_mismatch");
	if (claims.subject_id !== capability.subjectId) return _failure("subject_mismatch");
	if (claims.service_account_name !== capability.serviceAccountName) return _failure("service_account_mismatch");
	if (claims.namespace !== capability.namespace) return _failure("namespace_mismatch");
	if (claims.workload_kind !== capability.workloadKind) return _failure("workload_kind_mismatch");
	if (claims.workload_uid !== capability.workloadUid) return _failure("workload_uid_mismatch");
	if (claims.pod_uid !== capability.podUid) return _failure("pod_uid_mismatch");
	if (claims.agent_service_id !== capability.agentServiceId) return _failure("agent_service_mismatch");
	if (claims.agent_revision_id !== capability.agentRevisionId) return _failure("agent_revision_mismatch");
	if (claims.run_id !== capability.runId) return _failure("run_mismatch");
	if (claims.attempt !== capability.attempt) return _failure("attempt_mismatch");
	if (!_capabilityReferencesEqual(claims.capability, capability.capability)) return _failure("capability_reference_mismatch");
	if (!__AuthorizationResourcesEqual(claims.resource, capability.resource)) return _failure("resource_mismatch");
	if (claims.action !== capability.action) return _failure("action_mismatch");
	if (claims.arguments_digest !== capability.argumentsDigest) return _failure("arguments_mismatch");
	if (claims.effective_authorization_digest !== capability.effectiveAuthorizationDigest) return _failure("authorization_digest_mismatch");
	return { valid: true, proofKeyThumbprint, claims };
}
