import type { ExecutionSubject } from "@opencrane/contracts";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import type { ToolInvocationAuthorizationEvidence } from "@opencrane/backend/server/iam/authorization";

/** Builds the canonical subject used by protocol fixtures for one admitted attempt. */
export function _ExecutionSubject(overrides: Partial<ExecutionSubject> = {}): ExecutionSubject
{
	const subject: ExecutionSubject = {
		schemaVersion: 1,
		siloId: "silo-1",
		agentIdentityId: "identity-1",
		principalId: "principal-1",
		identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-08-29T00:00:00.000Z" },
		membership: { principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2099-08-29T00:00:00.000Z" },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-08-29T00:00:00.000Z" },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-08-29T00:00:00.000Z" },
		admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-08-29T00:00:00.000Z" },
	};
	return { ...subject, ...overrides };
}

/** Builds the workload evidence that lets a fixture worker use an admitted invocation. */
export function _ToolInvocationAuthorizationEvidence(executionSubject = _ExecutionSubject()): ToolInvocationAuthorizationEvidence
{
	const evidence = {
		actorKind: "workload" as const,
		executionSubject,
		coordinates: [{ resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "tool-1" }, action: ProductAuthorizationActions.Invoke }],
		decisionDigests: [`sha256:${"e".repeat(64)}`] as const,
		assignmentDigest: `sha256:${"f".repeat(64)}` as const,
	};
	return { ...evidence, evidenceDigest: ___DigestCanonicalJson(evidence as unknown as JsonValue) as `sha256:${string}` };
}
