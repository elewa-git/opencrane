import { describe, expect, it, vi } from "vitest";

import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { AGENT_RUNTIME_PROTOCOL_VERSION, RunInputSnapshotIdentityKinds, RuntimeCandidateKinds, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import type { RuntimeDispatchContext } from "../prisma-runtime-dispatch-authority.types";
import { RuntimeExternalActionAuthorizationService } from "../prisma-runtime-external-action-authorization";
import type { RuntimeExternalActionEligibilityPorts } from "../runtime-external-action-authorization.types";

/** Frozen runtime context whose full snapshot retains the local Principal coordinate. */
function _Context(overrides: Partial<RuntimeDispatchContext> = {}): RuntimeDispatchContext
{
	const snapshot = {
		runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1,
		conversationId: "conversation-1", messageIds: [], personaRevisionId: "persona-revision-1", preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [],
		memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-1" }, mcpTools: [], modelRoute: {}, budgetPolicy: {},
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionIssuer: "issuer", executionSubjectId: "user-1", principalId: "principal-1", fleetMembershipRevision: 7, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: "sha256:membership", fleetMembershipTrustedUntil: "2026-08-30T00:00:00.000Z" },
		capabilitySetDigest: "sha256:capabilities", effectiveContractDigest: "sha256:contract", promptCompilerVersion: "v1", digest: "sha256:snapshot", compiledAt: "2026-08-29T00:00:00.000Z",
	} as const;
	return {
		runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1", siloId: "silo-1", runState: "Running", terminalReason: null,
		assignmentDigest: `sha256:${"a".repeat(64)}`, inputSnapshotDigest: "sha256:snapshot", snapshot, conversationId: "conversation-1", personaRevisionId: "persona-revision-1",
		identity: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", fleetMembershipRevision: 7 }, capabilitySetDigest: "sha256:capabilities",
		serviceAccountName: "runtime", workloadKind: "Deployment", podUid: "pod-1", leaseExpiresAtEpochMs: Date.parse("2026-08-29T01:00:00.000Z"), assignmentIssuedAt: "2026-08-29T00:00:00.000Z", assignmentExpiresAt: "2026-08-29T01:00:00.000Z",
		...overrides,
	} as RuntimeDispatchContext;
}

/** Exact external-action proposal used by the product-authorization adapter. */
function _Candidate(toolRevisionId: string): RuntimeExternalActionCandidate
{
	const argumentsValue = { query: "approved input" };
	return { protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION, runtimeInstanceId: "runtime-1", commandId: "command-1", candidateId: "candidate-1", runId: "run-1", attempt: 1, fence: 1, kind: RuntimeCandidateKinds.ExternalAction, toolRevisionId, toolInvocationId: "invocation-1", arguments: argumentsValue, argumentsDigest: ___DigestCanonicalJson(argumentsValue) };
}

/** Central authority double that records exact resource-action coordinates. */
function _Authority(entitled: readonly ProductAuthorizationResourceLocator[] = [])
{
	return {
		admitPrincipal: vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"b".repeat(64)}` } }),
		listPrincipalEntitled: vi.fn().mockResolvedValue(entitled),
	};
}

/** Domain-owned lifecycle adapters whose decisions can be changed per focused test. */
function _Eligibility(overrides: Partial<RuntimeExternalActionEligibilityPorts> = {}): RuntimeExternalActionEligibilityPorts
{
	return {
		agentService: { isEligible: vi.fn().mockResolvedValue(true) },
		membership: { isEligible: vi.fn().mockResolvedValue(true) },
		mcp: { isEligible: vi.fn().mockResolvedValue(true) },
		personalMemory: { isEligible: vi.fn().mockResolvedValue(true) },
		persona: { findEligibleProfileId: vi.fn().mockResolvedValue("persona-profile-1") },
		...overrides,
	};
}

/** Bind domain and central fakes through the production coordinator seam. */
function _Service(eligibility: RuntimeExternalActionEligibilityPorts, authority: ReturnType<typeof _Authority>): RuntimeExternalActionAuthorizationService
{
	return new RuntimeExternalActionAuthorizationService({ bind: vi.fn().mockReturnValue(eligibility) }, function _Create() { return authority as never; });
}

describe("RuntimeExternalActionAuthorizationService", function _DescribeRuntimeAuthorization()
{
	it("admits only a still-published MCP revision through current Invoke authority", async function _AdmitsMcp()
	{
		const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "mcp-tool-1" } as const;
		const authority = _Authority([resource]);
		const adapter = _Service(_Eligibility(), authority);
		const candidate = _Candidate("mcp-tool-1");

		await expect(adapter.admitInTransaction({} as never, _Context(), candidate, new Date("2026-08-29T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ principalId: "principal-1", agentRevisionId: "revision-1", runId: "run-1", attempt: 1, argumentsDigest: candidate.argumentsDigest, assignmentDigest: `sha256:${"a".repeat(64)}` }));
		expect(authority.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "principal-1", actorKind: "user", membershipRevision: 7, resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "mcp-tool-1" }, action: ProductAuthorizationActions.Invoke, argumentsDigest: candidate.argumentsDigest }));
	});

	it("refuses an MCP action whose current publication lifecycle is unavailable", async function _RefusesUnpublishedMcp()
	{
		const authority = _Authority([{ kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "mcp-tool-1" }]);
		const adapter = _Service(_Eligibility({ mcp: { isEligible: vi.fn().mockResolvedValue(false) } }), authority);

		await expect(adapter.admitInTransaction({} as never, _Context(), _Candidate("mcp-tool-1"), new Date())).resolves.toBeNull();
		expect(authority.admitPrincipal).not.toHaveBeenCalled();
	});

	it("requires Dataset Use and MemoryScope Use before personal recall", async function _AdmitsMemory()
	{
		const resources = [{ kind: ProductAuthorizationResourceKinds.Dataset, id: "dataset-1" }, { kind: ProductAuthorizationResourceKinds.MemoryScope, id: "dataset-1" }] as const;
		const authority = _Authority(resources);
		const adapter = _Service(_Eligibility(), authority);

		await expect(adapter.admitInTransaction({} as never, _Context(), _Candidate(PERSONAL_MEMORY_RECALL_TOOL_REVISION), new Date("2026-08-29T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ coordinates: resources.map(resource => ({ resource, action: ProductAuthorizationActions.Use })) }));
		expect(authority.listPrincipalEntitled).toHaveBeenCalledWith(expect.objectContaining({ action: ProductAuthorizationActions.Use, resources }));
		expect(authority.admitPrincipal).toHaveBeenCalledTimes(2);
		expect(authority.admitPrincipal).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: resources[0], action: ProductAuthorizationActions.Use }));
		expect(authority.admitPrincipal).toHaveBeenNthCalledWith(2, expect.objectContaining({ resource: resources[1], action: ProductAuthorizationActions.Use }));
	});

	it("authorizes the exact Persona profile behind a built-in upgrade proposal", async function _AdmitsUpgrade()
	{
		const resource = { kind: ProductAuthorizationResourceKinds.Persona, id: "persona-profile-1" } as const;
		const authority = _Authority([resource]);
		const adapter = _Service(_Eligibility(), authority);

		await expect(adapter.admitInTransaction({} as never, _Context(), _Candidate(UPGRADE_SESSION_TOOL_REVISION), new Date("2026-08-29T00:01:00.000Z"))).resolves.toEqual(expect.objectContaining({ coordinates: [{ resource, action: ProductAuthorizationActions.Use }] }));
		expect(authority.admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ resource: { kind: ProductAuthorizationResourceKinds.Persona, id: "persona-profile-1" }, action: ProductAuthorizationActions.Use }));
	});

	it.each([
		["retired agent revision", { agentService: { isEligible: vi.fn().mockResolvedValue(false) } }],
		["revoked membership", { membership: { isEligible: vi.fn().mockResolvedValue(false) } }],
	] as const)("refuses an effect after %s", async function _RefusesStaleLifecycle(_label, override)
	{
		const resource = { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: "mcp-tool-1" } as const;
		const authority = _Authority([resource]);
		const adapter = _Service(_Eligibility(override), authority);
		await expect(adapter.admitInTransaction({} as never, _Context(), _Candidate("mcp-tool-1"), new Date("2026-08-29T00:01:00.000Z"))).resolves.toBeNull();
		expect(authority.admitPrincipal).not.toHaveBeenCalled();
	});

	it("refuses an effect after its central grant is revoked", async function _RefusesRevokedGrant()
	{
		const authority = _Authority([]);
		const adapter = _Service(_Eligibility(), authority);
		await expect(adapter.admitInTransaction({} as never, _Context(), _Candidate("mcp-tool-1"), new Date("2026-08-29T00:01:00.000Z"))).resolves.toBeNull();
		expect(authority.admitPrincipal).not.toHaveBeenCalled();
	});
});
