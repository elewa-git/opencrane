import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { ActionCapability, CapabilityProofExpectation, Es256PublicJwk } from "@opencrane/models/authorization";
import { ___CanonicalizeJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";
import { describe, expect, it } from "vitest";

import { __ComputeEs256JwkThumbprint, __NormalizeDpopTargetUri, __VerifyCapabilityProof } from "../capability-proof.js";
import { __DigestCanonicalJson } from "../canonical-json-digest.js";

/** Fixed trusted clock used by proof fixtures. */
const NOW = 1_750_000_000;

/** Primary ES256 fixture key pair. */
const KEY_PAIR = generateKeyPairSync("ec", { namedCurve: "P-256" });

/** Distinct key pair used to prove signature and thumbprint mismatches fail. */
const OTHER_KEY_PAIR = generateKeyPairSync("ec", { namedCurve: "P-256" });

/** Public P-256 JWK embedded in valid proof headers. */
const PUBLIC_JWK = KEY_PAIR.publicKey.export({ format: "jwk" }) as Es256PublicJwk;

/** Different public P-256 JWK used for key-binding mismatch tests. */
const OTHER_PUBLIC_JWK = OTHER_KEY_PAIR.publicKey.export({ format: "jwk" }) as Es256PublicJwk;

/** Canonical digest of the exact action arguments. */
const ARGUMENTS_DIGEST = __DigestCanonicalJson({ filename: "brief.pdf", overwrite: false });

/** Valid short-lived action capability bound to the primary proof key. */
const CAPABILITY: ActionCapability = {
	jti: "capability-7",
	audience: "artifact-service",
	siloId: "silo-a",
	subjectId: "user-a",
	serviceAccountName: "agent-runtime",
	namespace: "silo-a-runtime",
	workloadKind: "job",
	workloadUid: "job-uid-7",
	podUid: "pod-uid-7",
	agentServiceId: "agent-service-7",
	agentRevisionId: "agent-revision-7",
	runId: "run-7",
	attempt: 2,
	capability: { catalog: { catalogId: "core", revision: 5, digest: __DigestCanonicalJson({ catalog: "core", revision: 5 }) }, capabilityId: "artifact.write" },
	resource: { kind: "artifact", id: "artifact-7" },
	action: "artifact.write",
	argumentsDigest: ARGUMENTS_DIGEST,
	proofKeyThumbprint: __ComputeEs256JwkThumbprint(PUBLIC_JWK),
	effectiveAuthorizationDigest: __DigestCanonicalJson({ grants: ["grant-7"], policy: "v5" }),
	notBefore: NOW - 60,
	expiresAt: NOW + 60,
};

/** Valid verifier-side request and capability facts. */
const EXPECTATION: CapabilityProofExpectation = {
	capability: CAPABILITY,
	binding: {
		audience: CAPABILITY.audience,
		siloId: CAPABILITY.siloId,
		subjectId: CAPABILITY.subjectId,
		serviceAccountName: CAPABILITY.serviceAccountName,
		namespace: CAPABILITY.namespace,
		workloadKind: CAPABILITY.workloadKind,
		workloadUid: CAPABILITY.workloadUid,
		podUid: CAPABILITY.podUid,
		agentServiceId: CAPABILITY.agentServiceId,
		agentRevisionId: CAPABILITY.agentRevisionId,
		runId: CAPABILITY.runId,
		attempt: CAPABILITY.attempt,
		proofKeyThumbprint: CAPABILITY.proofKeyThumbprint,
		capability: CAPABILITY.capability,
		resource: CAPABILITY.resource,
		action: CAPABILITY.action,
		argumentsDigest: CAPABILITY.argumentsDigest,
		effectiveAuthorizationDigest: CAPABILITY.effectiveAuthorizationDigest,
	},
	httpMethod: "post",
	targetUri: "https://api.opencrane.test/v1/artifacts/artifact-7?trace=ignored#fragment",
	nowEpochSeconds: NOW,
	maximumProofAgeSeconds: 5,
	clockSkewSeconds: 2,
};

/** Valid protected JOSE header. */
const HEADER: JsonValue = { typ: "dpop+jwt", alg: "ES256", jwk: PUBLIC_JWK as unknown as JsonValue };

/** Valid proof claims carrying every exact action binding. */
const CLAIMS: JsonValue = {
	aud: CAPABILITY.audience,
	jti: CAPABILITY.jti,
	htm: "POST",
	htu: "https://api.opencrane.test/v1/artifacts/artifact-7",
	iat: NOW,
	nbf: CAPABILITY.notBefore,
	exp: CAPABILITY.expiresAt,
	silo_id: CAPABILITY.siloId,
	subject_id: CAPABILITY.subjectId,
	service_account_name: CAPABILITY.serviceAccountName,
	namespace: CAPABILITY.namespace,
	workload_kind: CAPABILITY.workloadKind,
	workload_uid: CAPABILITY.workloadUid,
	pod_uid: CAPABILITY.podUid,
	agent_service_id: CAPABILITY.agentServiceId,
	agent_revision_id: CAPABILITY.agentRevisionId,
	run_id: CAPABILITY.runId,
	attempt: CAPABILITY.attempt,
	proof_key_thumbprint: CAPABILITY.proofKeyThumbprint,
	capability: CAPABILITY.capability as unknown as JsonValue,
	resource: { kind: CAPABILITY.resource.kind, id: CAPABILITY.resource.id },
	action: CAPABILITY.action,
	arguments_digest: CAPABILITY.argumentsDigest,
	effective_authorization_digest: CAPABILITY.effectiveAuthorizationDigest,
};

/** Encodes one JSON value as an unpadded protected JWS part. */
function _encode(value: JsonValue): string
{
	return Buffer.from(___CanonicalizeJson(value), "utf8").toString("base64url");
}

/** Signs one compact ES256 capability proof with a P1363 JOSE signature. */
function _signProof(header: JsonValue, claims: JsonValue, signingKey: KeyObject = KEY_PAIR.privateKey): string
{
	const protectedHeader = _encode(header);
	const protectedClaims = _encode(claims);
	const signingInput = Buffer.from(`${protectedHeader}.${protectedClaims}`, "ascii");
	const signature = sign("sha256", signingInput, { key: signingKey, dsaEncoding: "ieee-p1363" });
	return `${protectedHeader}.${protectedClaims}.${signature.toString("base64url")}`;
}

/** Replaces fields in the valid protected claim fixture. */
function _claims(overrides: Record<string, JsonValue> = {}): JsonValue
{
	return { ...(CLAIMS as Record<string, JsonValue>), ...overrides };
}

/** Replaces fields in the valid verifier expectation. */
function _expectation(overrides: Partial<CapabilityProofExpectation> = {}): CapabilityProofExpectation
{
	return { ...EXPECTATION, ...overrides };
}

describe("ES256 capability proof", function _suite()
{
	it("verifies a correctly signed proof and returns its RFC 7638 key thumbprint", function _valid()
	{
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), EXPECTATION)).toEqual({ valid: true, proofKeyThumbprint: CAPABILITY.proofKeyThumbprint, claims: CLAIMS });
	});

	it("verifies the long-lived personal Deployment workload class without a Job sentinel", function _deploymentWorkload()
	{
		const capability = { ...CAPABILITY, workloadKind: "deployment" as const, workloadUid: "deployment-uid-7" };
		const expectation = _expectation({ capability, binding: { ...EXPECTATION.binding, workloadKind: "deployment", workloadUid: "deployment-uid-7" } });
		const claims = _claims({ workload_kind: "deployment", workload_uid: "deployment-uid-7" });

		expect(__VerifyCapabilityProof(_signProof(HEADER, claims), expectation).valid).toBe(true);
	});

	it("computes the thumbprint from only the RFC 7638 required key members", function _thumbprint()
	{
		const canonicalJwk = ___CanonicalizeJson({ crv: "P-256", kty: "EC", x: PUBLIC_JWK.x, y: PUBLIC_JWK.y });
		const expectedThumbprint = createHash("sha256").update(canonicalJwk, "utf8").digest("base64url");

		expect(__ComputeEs256JwkThumbprint(PUBLIC_JWK)).toBe(expectedThumbprint);
	});

	it("normalizes DPoP targets while rejecting credentials and relative targets", function _targetNormalization()
	{
		expect(__NormalizeDpopTargetUri("HTTPS://API.OPENCRANE.TEST:443/a/../v1/action?x=1#part")).toBe("https://api.opencrane.test/v1/action");
		expect(function _credentials(): string { return __NormalizeDpopTargetUri("https://user:secret@api.opencrane.test/action"); }).toThrow(/without credentials/);
		expect(function _relative(): string { return __NormalizeDpopTargetUri("/v1/action"); }).toThrow(/absolute HTTP/);
	});

	it("rejects malformed compact framing, JSON, and JOSE headers", function _malformedHeader()
	{
		const validParts = _signProof(HEADER, CLAIMS).split(".");
		const malformedJson = Buffer.from("{", "utf8").toString("base64url");

		expect(__VerifyCapabilityProof("one.two", EXPECTATION)).toEqual({ valid: false, reason: "malformed_compact_proof" });
		expect(__VerifyCapabilityProof(`${malformedJson}.${validParts[1]}.${validParts[2]}`, EXPECTATION)).toEqual({ valid: false, reason: "malformed_header" });
		expect(__VerifyCapabilityProof(_signProof({ typ: "JWT", alg: "ES256", jwk: PUBLIC_JWK as unknown as JsonValue }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_header" });
		expect(__VerifyCapabilityProof(_signProof({ typ: "dpop+jwt", alg: "none", jwk: PUBLIC_JWK as unknown as JsonValue }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_header" });
	});

	it("rejects private, wrong-curve, malformed-coordinate, and invalid-point keys", function _malformedKeys()
	{
		const privateJwk = KEY_PAIR.privateKey.export({ format: "jwk" }) as unknown as JsonValue;
		const wrongCurve = { ...PUBLIC_JWK, crv: "P-384" } as unknown as JsonValue;
		const shortCoordinate = { ...PUBLIC_JWK, x: "AA" } as unknown as JsonValue;
		const invalidPoint = { ...PUBLIC_JWK, x: Buffer.alloc(32).toString("base64url"), y: Buffer.alloc(32).toString("base64url") } as unknown as JsonValue;

		expect(__VerifyCapabilityProof(_signProof({ typ: "dpop+jwt", alg: "ES256", jwk: privateJwk }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_public_key" });
		expect(__VerifyCapabilityProof(_signProof({ typ: "dpop+jwt", alg: "ES256", jwk: wrongCurve }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_public_key" });
		expect(__VerifyCapabilityProof(_signProof({ typ: "dpop+jwt", alg: "ES256", jwk: shortCoordinate }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_public_key" });
		expect(__VerifyCapabilityProof(_signProof({ typ: "dpop+jwt", alg: "ES256", jwk: invalidPoint }, CLAIMS), EXPECTATION)).toEqual({ valid: false, reason: "malformed_public_key" });
		expect(function _badThumbprint(): string { return __ComputeEs256JwkThumbprint({ ...PUBLIC_JWK, x: "AA" }); }).toThrow(/valid public P-256/);
	});

	it("rejects invalid signatures and malformed JOSE signature lengths", function _invalidSignature()
	{
		const parts = _signProof(HEADER, CLAIMS).split(".");
		const shortSignature = Buffer.alloc(63).toString("base64url");

		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS, OTHER_KEY_PAIR.privateKey), EXPECTATION)).toEqual({ valid: false, reason: "invalid_signature" });
		expect(__VerifyCapabilityProof(`${parts[0]}.${parts[1]}.${shortSignature}`, EXPECTATION)).toEqual({ valid: false, reason: "invalid_signature" });
	});

	it("rejects missing and malformed required claims", function _malformedClaims()
	{
		const missingJti = { ...(CLAIMS as Record<string, JsonValue>) };
		delete missingJti.jti;

		expect(__VerifyCapabilityProof(_signProof(HEADER, missingJti), EXPECTATION)).toEqual({ valid: false, reason: "malformed_claims" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ iat: "now" })), EXPECTATION)).toEqual({ valid: false, reason: "malformed_claims" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ resource: "artifact-7" })), EXPECTATION)).toEqual({ valid: false, reason: "malformed_claims" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ arguments_digest: "sha256:not-a-digest" })), EXPECTATION)).toEqual({ valid: false, reason: "malformed_claims" });
	});

	it("enforces proof age, future skew, and the capability window", function _timeBounds()
	{
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ iat: NOW - 6 })), EXPECTATION)).toEqual({ valid: false, reason: "proof_too_old" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ iat: NOW + 3 })), EXPECTATION)).toEqual({ valid: false, reason: "proof_from_future" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ iat: NOW - 5 })), EXPECTATION).valid).toBe(true);
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ iat: NOW + 2 })), EXPECTATION).valid).toBe(true);
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ capability: { ...CAPABILITY, notBefore: NOW - 120, expiresAt: NOW - 6 } }))).toEqual({ valid: false, reason: "capability_not_active" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ maximumProofAgeSeconds: 0 }))).toEqual({ valid: false, reason: "invalid_expectation" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ clockSkewSeconds: -1 }))).toEqual({ valid: false, reason: "invalid_expectation" });
	});

	it("uses clock skew alone for capability not-before and expiry tolerance", function _capabilitySkew()
	{
		const futureBoundary = { ...CAPABILITY, notBefore: NOW + 2 };
		const recentExpiry = { ...CAPABILITY, expiresAt: NOW - 1 };
		const futureOutsideSkew = { ...CAPABILITY, notBefore: NOW + 3 };
		const expiryOutsideSkew = { ...CAPABILITY, expiresAt: NOW - 2 };

		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ nbf: NOW + 2 })), _expectation({ capability: futureBoundary })).valid).toBe(true);
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ exp: NOW - 1 })), _expectation({ capability: recentExpiry })).valid).toBe(true);
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ nbf: NOW + 3 })), _expectation({ capability: futureOutsideSkew }))).toEqual({ valid: false, reason: "capability_not_active" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ exp: NOW - 2 })), _expectation({ capability: expiryOutsideSkew }))).toEqual({ valid: false, reason: "capability_not_active" });
	});

	it("rejects malformed trusted capability and request expectations", function _invalidExpectation()
	{
		const invalidCatalog = { ...CAPABILITY, capability: { ...CAPABILITY.capability, catalog: { ...CAPABILITY.capability.catalog, revision: 0 } } };

		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ capability: invalidCatalog }))).toEqual({ valid: false, reason: "invalid_expectation" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ capability: { ...CAPABILITY, proofKeyThumbprint: "not-a-thumbprint" } }))).toEqual({ valid: false, reason: "invalid_expectation" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ httpMethod: "POST /" }))).toEqual({ valid: false, reason: "invalid_expectation" });
	});

	it("rejects proof-key, method, and normalized target mismatches", function _requestBindings()
	{
		const otherKeyCapability = { ...CAPABILITY, proofKeyThumbprint: __ComputeEs256JwkThumbprint(OTHER_PUBLIC_JWK) };

		expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), _expectation({ capability: otherKeyCapability }))).toEqual({ valid: false, reason: "proof_key_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ htm: "GET" })), EXPECTATION)).toEqual({ valid: false, reason: "method_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ htu: "https://api.opencrane.test/v1/artifacts/artifact-8" })), EXPECTATION)).toEqual({ valid: false, reason: "target_uri_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ htu: "https://api.opencrane.test/v1/artifacts/artifact-7?redirect=true" })), EXPECTATION)).toEqual({ valid: false, reason: "target_uri_mismatch" });
	});

	it("rejects every exact capability and authority binding mismatch", function _authorityBindings()
	{
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ aud: "other-service" })), EXPECTATION)).toEqual({ valid: false, reason: "audience_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ jti: "capability-8" })), EXPECTATION)).toEqual({ valid: false, reason: "capability_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ nbf: CAPABILITY.notBefore + 1 })), EXPECTATION)).toEqual({ valid: false, reason: "capability_window_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ silo_id: "silo-b" })), EXPECTATION)).toEqual({ valid: false, reason: "silo_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ subject_id: "user-b" })), EXPECTATION)).toEqual({ valid: false, reason: "subject_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ service_account_name: "wrong-ksa" })), EXPECTATION)).toEqual({ valid: false, reason: "service_account_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ namespace: "wrong-namespace" })), EXPECTATION)).toEqual({ valid: false, reason: "namespace_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ workload_kind: "deployment" })), EXPECTATION)).toEqual({ valid: false, reason: "workload_kind_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ workload_uid: "wrong-workload-uid" })), EXPECTATION)).toEqual({ valid: false, reason: "workload_uid_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ pod_uid: "wrong-pod-uid" })), EXPECTATION)).toEqual({ valid: false, reason: "pod_uid_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ agent_service_id: "agent-service-8" })), EXPECTATION)).toEqual({ valid: false, reason: "agent_service_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ agent_revision_id: "agent-revision-8" })), EXPECTATION)).toEqual({ valid: false, reason: "agent_revision_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ run_id: "run-8" })), EXPECTATION)).toEqual({ valid: false, reason: "run_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ attempt: 3 })), EXPECTATION)).toEqual({ valid: false, reason: "attempt_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ proof_key_thumbprint: __ComputeEs256JwkThumbprint(OTHER_PUBLIC_JWK) })), EXPECTATION)).toEqual({ valid: false, reason: "proof_key_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ capability: { ...CAPABILITY.capability, capabilityId: "artifact.delete" } as unknown as JsonValue })), EXPECTATION)).toEqual({ valid: false, reason: "capability_reference_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ resource: { kind: "thread", id: "artifact-7" } })), EXPECTATION)).toEqual({ valid: false, reason: "resource_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ resource: { kind: "artifact", id: "artifact-8" } })), EXPECTATION)).toEqual({ valid: false, reason: "resource_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ action: "artifact.delete" })), EXPECTATION)).toEqual({ valid: false, reason: "action_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ arguments_digest: __DigestCanonicalJson({ filename: "brief.pdf", overwrite: true }) })), EXPECTATION)).toEqual({ valid: false, reason: "arguments_mismatch" });
		expect(__VerifyCapabilityProof(_signProof(HEADER, _claims({ effective_authorization_digest: __DigestCanonicalJson({ grants: ["grant-8"] }) })), EXPECTATION)).toEqual({ valid: false, reason: "authorization_digest_mismatch" });
	});

	it("rejects issued capabilities that disagree with independently observed bindings", function _bindingMismatches()
	{
		const cases: Array<[Partial<CapabilityProofExpectation["binding"]>, string]> = [
			[{ audience: "other-service" }, "audience_mismatch"],
			[{ siloId: "silo-b" }, "silo_mismatch"],
			[{ subjectId: "user-b" }, "subject_mismatch"],
			[{ serviceAccountName: "wrong-ksa" }, "service_account_mismatch"],
			[{ namespace: "wrong-namespace" }, "namespace_mismatch"],
			[{ workloadKind: "deployment" }, "workload_kind_mismatch"],
			[{ workloadUid: "wrong-workload-uid" }, "workload_uid_mismatch"],
			[{ podUid: "wrong-pod-uid" }, "pod_uid_mismatch"],
			[{ agentServiceId: "agent-service-8" }, "agent_service_mismatch"],
			[{ agentRevisionId: "agent-revision-8" }, "agent_revision_mismatch"],
			[{ runId: "run-8" }, "run_mismatch"],
			[{ attempt: 3 }, "attempt_mismatch"],
			[{ proofKeyThumbprint: __ComputeEs256JwkThumbprint(OTHER_PUBLIC_JWK) }, "proof_key_mismatch"],
			[{ capability: { ...CAPABILITY.capability, capabilityId: "artifact.delete" } }, "capability_reference_mismatch"],
			[{ resource: { kind: "artifact", id: "artifact-8" } }, "resource_mismatch"],
			[{ action: "artifact.delete" }, "action_mismatch"],
			[{ argumentsDigest: __DigestCanonicalJson({ filename: "other.pdf" }) }, "arguments_mismatch"],
			[{ effectiveAuthorizationDigest: __DigestCanonicalJson({ grants: ["grant-8"] }) }, "authorization_digest_mismatch"],
		];

		for (const [change, reason] of cases)
		{
			const expectation = _expectation({ binding: { ...EXPECTATION.binding, ...change } });
			expect(__VerifyCapabilityProof(_signProof(HEADER, CLAIMS), expectation)).toEqual({ valid: false, reason });
		}
	});
});
