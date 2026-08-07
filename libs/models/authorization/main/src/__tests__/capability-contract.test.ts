import { describe, expect, it } from "vitest";
import type { CapabilityProofBindingExpectation, CapabilityProofClaims, CapabilityProofExpectation } from "../capability-proof.types.js";
import type { ActionCapability, CanonicalJsonSha256Digest } from "../capability.types.js";

/** Valid canonical digest shared by the exact capability fixtures. */
const DIGEST = `sha256:${"a".repeat(64)}` as CanonicalJsonSha256Digest;

/** Generic action capability for a managed-runtime Deployment run attempt. */
const CAPABILITY: ActionCapability = {
	jti: "action-capability-1",
	audience: "artifact-service",
	siloId: "silo-a",
	subjectId: "user-a",
	serviceAccountName: "managed-agent-runtime",
	namespace: "silo-a-runtimes",
	workloadKind: "deployment",
	workloadUid: "deployment-uid-1",
	podUid: "pod-uid-1",
	agentServiceId: "agent-service-1",
	agentRevisionId: "agent-revision-4",
	runId: "agent-run-9",
	attempt: 2,
	capability: {
		catalog: { catalogId: "target-capabilities", revision: 3, digest: DIGEST },
		capabilityId: "artifact.write",
	},
	resource: { kind: "artifact", id: "artifact-7" },
	action: "artifact.write",
	argumentsDigest: DIGEST,
	proofKeyThumbprint: "proof-key-thumbprint",
	effectiveAuthorizationDigest: DIGEST,
	notBefore: 1_750_000_000,
	expiresAt: 1_750_000_060,
};

/** Independently trusted runtime and request facts expected by the proof verifier. */
const BINDING: CapabilityProofBindingExpectation = {
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
};

/** Signed proof claims carrying every exact workload, run, and authority binding. */
const CLAIMS: CapabilityProofClaims = {
	aud: CAPABILITY.audience,
	jti: CAPABILITY.jti,
	htm: "POST",
	htu: "https://artifact-service.opencrane.test/v1/artifacts/artifact-7",
	iat: 1_750_000_001,
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
	capability: CAPABILITY.capability,
	resource: CAPABILITY.resource,
	action: CAPABILITY.action,
	arguments_digest: CAPABILITY.argumentsDigest,
	effective_authorization_digest: CAPABILITY.effectiveAuthorizationDigest,
};

/** Complete verifier input with separately supplied trusted bindings. */
const EXPECTATION: CapabilityProofExpectation = {
	capability: CAPABILITY,
	binding: BINDING,
	httpMethod: "POST",
	targetUri: CLAIMS.htu,
	nowEpochSeconds: CLAIMS.iat,
	maximumProofAgeSeconds: 30,
	clockSkewSeconds: 5,
};

describe("exact action capability contract", function _suite()
{
	it("represents a managed-runtime Deployment and its exact registered Pod", function _deployment()
	{
		expect(EXPECTATION.capability.workloadKind).toBe("deployment");
		expect(EXPECTATION.capability.workloadUid).toBe("deployment-uid-1");
		expect(EXPECTATION.capability.podUid).toBe("pod-uid-1");
	});

	it("represents a one-attempt Job with the same immutable workload binding", function _job()
	{
		const jobCapability: ActionCapability = { ...CAPABILITY, workloadKind: "job", workloadUid: "job-uid-1" };

		expect(jobCapability.workloadKind).toBe("job");
		expect(jobCapability.workloadUid).toBe("job-uid-1");
		expect(jobCapability.attempt).toBe(2);
	});

	it("carries every authority and validity boundary in signed claims", function _claims()
	{
		expect(CLAIMS).toMatchObject({
			aud: BINDING.audience,
			workload_kind: BINDING.workloadKind,
			workload_uid: BINDING.workloadUid,
			agent_service_id: BINDING.agentServiceId,
			agent_revision_id: BINDING.agentRevisionId,
			run_id: BINDING.runId,
			attempt: BINDING.attempt,
			capability: BINDING.capability,
			effective_authorization_digest: BINDING.effectiveAuthorizationDigest,
			nbf: CAPABILITY.notBefore,
			exp: CAPABILITY.expiresAt,
		});
	});

	it("keeps maximum proof age independent from clock-skew tolerance", function _timeBoundaries()
	{
		expect(EXPECTATION.maximumProofAgeSeconds).toBe(30);
		expect(EXPECTATION.clockSkewSeconds).toBe(5);
	});
});
