import { ExecutionSubjectMembershipKinds } from "@opencrane/models/agents";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { __DigestRunInputSnapshot, RunAdmissionMessageInputModes, RunExecutionPersonalMemoryPolicies, RunExecutionPersonaPolicies, type RunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import { ___DigestCanonicalJson } from "@opencrane/util";
import { describe, expect, it, vi } from "vitest";

import { __AssembleRunInputSnapshot } from "../session-assembly";
import { TransactionBoundProductResourceAuthorizationSource } from "../../sources/product-resource-authorization-source";
import type { SessionAssemblyAuthorities } from "../session-assembly.types";

/** Builds one command whose subject is pre-verified by the injected authority. */
function _command(): RunAdmissionCommand
{
	return { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", trigger: "interactive", requestIdempotencyKey: "request-1", messageInput: { mode: RunAdmissionMessageInputModes.PrePersistedHistory, messageId: "message-1", historyRevision: "7", orderedMessageIds: ["message-1"], author: { principalId: "principal-1", issuer: "https://issuer.example", subjectId: "requester-subject-1", authenticatedAt: "2026-09-01T00:00:00.000Z" } }, requester: { subjectId: "requester-subject-1", issuer: "https://issuer.example", authenticatedAt: "2026-09-01T00:00:00.000Z" } };
}

/** Builds the fully fenced subject required before any identity-scoped input can load. */
function _subject(): RunInputSnapshot["executionSubject"]
{
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "principal-1", identity: { agentIdentityId: "identity-1", principalId: "principal-1", siloId: "silo-1", headRevision: "0", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision-1", verifiedAt: "2026-07-20T00:00:00.000Z" }, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-08-20T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"c".repeat(64)}`, effectiveContractDigest: `sha256:${"d".repeat(64)}`, decisionEvidenceId: "capability-decision-1", decidedAt: "2026-07-20T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "principal-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-07-20T00:00:00.000Z", membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "principal-1", siloId: "silo-1", revision: 1, assertionId: "membership-1", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "membership-decision-1", trustedUntil: "2026-08-20T00:00:00.000Z" } }, admission: { authorizingPrincipalId: "principal-1", decisionEvidenceId: "admission-decision-1", admittedAt: "2026-07-20T00:00:00.000Z" } };
}

/** Builds a complete target authority set whose sources use the one injected subject. */
function _authorities(): SessionAssemblyAuthorities
{
	return {
		admission: { admit: async function _admit(_command, _verifyExisting, build) { const compiled = await build({ prisma: {} as never, admittedAt: "2026-07-20T00:00:00.000Z", admittedAtEpochMs: 1 }); return compiled.outcome === "denied" ? { outcome: "denied", reason: compiled.reason } : { outcome: "accepted", snapshot: compiled.value.snapshot }; } },
		runAuthority: { load: async function _load() { return { outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory: RunExecutionPersonalMemoryPolicies.None }, promptCompilerVersion: "v1", trigger: "interactive" } } as const; } },
		executionSubject: { load: async function _load() { return { outcome: "loaded", value: _subject() } as const; } },
		approvedPersona: { load: async function _load() { return { outcome: "loaded", value: { personaRevisionId: "persona-1", personaId: "persona-1" } } as const; } },
		conversationContext: { load: async function _load() { return { outcome: "loaded", value: { messageIds: ["message-1"] } } as const; } },
		preferenceFacts: { load: async function _load() { return { outcome: "loaded", value: [] } as const; } },
		memoryScope: { load: async function _load() { return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "none" }, datasetId: null } } as const; } },
		toolPolicy: { load: async function _load() { const schema = { type: "object" } as const; return { outcome: "loaded", value: { modelDefinitionId: "model-1", modelRoute: {}, mcpTools: [{ toolRevisionId: "tool-1", name: "search", description: null, inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) }], skillRevisionIds: [], artifactRevisionIds: [] } } as const; } },
		skillEligibility: { load: async function _load() { return { outcome: "loaded", value: null } as const; } },
		productAuthorization: { load: async function _load() { return { outcome: "loaded", value: null } as const; }, verifyExisting: async function _VerifyExisting() { return { outcome: "loaded", value: null } as const; } },
		budgetPolicy: { load: async function _load() { return { outcome: "loaded", value: { budgetPolicy: {} } } as const; } },
	};
}

/** Replays a frozen snapshot through the real duplicate checks without recompiling its inputs. */
async function _DuplicateFixture(memoryQueryPolicy: RunInputSnapshot["memoryQueryPolicy"], preferenceFactIds: readonly string[] = [])
{
	const admitted = await __AssembleRunInputSnapshot(_command(), _authorities());
	if (admitted.outcome === "denied")
		throw new Error("The fixture must assemble its initial snapshot");
	const snapshot = { ...admitted.snapshot, memoryQueryPolicy, preferenceFactIds };
	snapshot.digest = __DigestRunInputSnapshot(snapshot);
	const authorities = _authorities();
	const executionSubject = vi.fn().mockResolvedValue({ outcome: "loaded", value: _subject() });
	authorities.executionSubject = { load: executionSubject };
	authorities.admission = { admit: async function _Replay(_command, verifyExisting)
	{
		const verified = await verifyExisting(snapshot, { prisma: {} as never, admittedAt: "2026-07-20T00:00:00.000Z", admittedAtEpochMs: 1 });
		return verified.outcome === "denied" ? verified : { outcome: "idempotent", snapshot };
	} };
	return { authorities, executionSubject, snapshot };
}

describe("__AssembleRunInputSnapshot", function _DescribeSessionAssembly()
{
	it("seals the verified execution subject into an admitted snapshot", async function _SealsExecutionSubject()
	{
		const result = await __AssembleRunInputSnapshot(_command(), _authorities());
		expect(result.outcome).toBe("assembled");
		if (result.outcome === "assembled")
		{
			expect(result.snapshot.executionSubject).toEqual(_subject());
			expect(result.snapshot.attempt).toBe(1);
		}
	});

	it("freezes the deployment-selected standalone witness in the first snapshot", async function _FreezesLocal()
	{
		const membership = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId: "principal-1", siloId: "silo-1", issuer: "https://issuer.example", subjectId: "requester-subject-1", membershipId: "local-1", membershipUpdatedAt: "2026-09-01T00:00:00.000Z", observedAt: "2026-09-01T00:01:00.000Z", trustedUntil: "2026-09-01T00:06:00.000Z" } as const;
		const subject = { ..._subject(), membership, requester: { ..._subject().requester, membership } };
		const authorities = _authorities();
		authorities.executionSubject = { load: async function _LocalSubject() { return { outcome: "loaded", value: subject }; } };
		const result = await __AssembleRunInputSnapshot(_command(), authorities);
		expect(result).toMatchObject({ outcome: "assembled", snapshot: { executionSubject: { membership, requester: { membership } } } });
	});

	it("refuses a subject whose computer lease does not match its capability evidence", async function _RefusesWrongComputer()
	{
		const authorities = _authorities();
		authorities.executionSubject = { load: async function _load() { return { outcome: "loaded", value: { ..._subject(), computerScope: { ..._subject().computerScope, computerId: "computer-other" } } } as const; } };
		await expect(__AssembleRunInputSnapshot(_command(), authorities)).resolves.toEqual({ outcome: "denied", reason: "identity_unavailable" });
	});

	it("returns a source refusal without accepting a partial snapshot", async function _RefusesPartialSnapshot()
	{
		const authorities = _authorities();
		authorities.memoryScope = { load: async function _load() { return { outcome: "denied", reason: "memory_scope_unavailable" } as const; } };
		await expect(__AssembleRunInputSnapshot(_command(), authorities)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
	});

	it("does not persist when final-transaction Conversation Use is denied", async function _RefusesRevokedConversationUse()
	{
		let persisted = false;
		const authorities = _authorities();
		authorities.productAuthorization = new TransactionBoundProductResourceAuthorizationSource();
		authorities.admission = { admit: async function _Admit(_command, _verifyExisting, build)
		{
			const compiled = await build({ prisma: {} as never, authorization: { admitPrincipal: async function _Deny() { return { outcome: "deny", evidence: null } as never; }, admitPrincipalBatch: async function _Unexpected() { throw new Error("resource batch must not run"); } }, admittedAt: "2026-07-20T00:00:00.000Z", admittedAtEpochMs: 1 } as never);
			if (compiled.outcome === "denied")
				return { outcome: "denied", reason: compiled.reason };
			persisted = true;
			return { outcome: "accepted", snapshot: compiled.value.snapshot };
		} };
		await expect(__AssembleRunInputSnapshot(_command(), authorities)).resolves.toEqual({ outcome: "denied", reason: "product_authorization_unavailable" });
		expect(persisted).toBe(false);
	});

	it("rejects reordered or repeated pre-persisted message provenance before authority reads", async function _RejectsInvalidHistoryBoundary()
	{
		const command = { ..._command(), messageInput: { ..._command().messageInput!, orderedMessageIds: ["message-1", "message-1"] } };
		await expect(__AssembleRunInputSnapshot(command, _authorities())).resolves.toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it.each([
		{ memoryQueryPolicy: { scope: "none" }, personalMemory: RunExecutionPersonalMemoryPolicies.None },
		{ memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "gateway-dataset-1" }, personalMemory: RunExecutionPersonalMemoryPolicies.Allowed },
	] as const)("rechecks a duplicate using its frozen $personalMemory memory policy", async function _RestoresFrozenPolicy({ memoryQueryPolicy, personalMemory })
	{
		const fixture = await _DuplicateFixture(memoryQueryPolicy as RunInputSnapshot["memoryQueryPolicy"]);
		const result = await __AssembleRunInputSnapshot(_command(), fixture.authorities);
		expect(result).toMatchObject({ outcome: "assembled", admissionOutcome: "idempotent", snapshot: fixture.snapshot });
		expect(fixture.executionSubject).toHaveBeenCalledWith(_command(), expect.objectContaining({ executionPolicy: { persona: RunExecutionPersonaPolicies.Required, personalMemory } }), expect.anything());
	});

	it.each([
		{ policy: null },
		{ policy: [] },
		{ policy: {} },
		{ policy: "none" },
		{ policy: { scope: "unknown" } },
		{ policy: { scope: "none", datasetId: "dataset-1" } },
		{ policy: { scope: "personal" } },
		{ policy: { scope: "personal", datasetId: "", cogneeDatasetId: "gateway-dataset-1" } },
		{ policy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "  " } },
		{ policy: { scope: "personal", datasetId: 42, cogneeDatasetId: "gateway-dataset-1" } },
		{ policy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "gateway-dataset-1", unexpected: true } },
	] as const)("refuses malformed frozen memory before rechecking identity: $policy", async function _RefusesMalformedPolicy({ policy })
	{
		const fixture = await _DuplicateFixture(policy as RunInputSnapshot["memoryQueryPolicy"]);
		await expect(__AssembleRunInputSnapshot(_command(), fixture.authorities)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(fixture.executionSubject).not.toHaveBeenCalled();
	});

	it("refuses a frozen no-memory scope that carries preference facts", async function _RefusesConflictingPreferences()
	{
		const fixture = await _DuplicateFixture({ scope: "none" }, ["preference-1"]);
		await expect(__AssembleRunInputSnapshot(_command(), fixture.authorities)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(fixture.executionSubject).not.toHaveBeenCalled();
	});
});
