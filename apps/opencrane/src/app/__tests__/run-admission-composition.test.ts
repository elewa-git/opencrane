import { afterEach, describe, expect, it, vi } from "vitest";

import { PrismaRunAdmissionUnitOfWork, type RunAdmissionCommand, type RunAdmissionExistingVerifier, type RunAdmissionResult, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { ExecutionSubjectAuthority } from "@opencrane/backend/agents/execution/inputs";
import type { ConversationComputerRunAdmissionCommand } from "@opencrane/backend/server/conversations";
import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";
import { ExecutionSubjectMembershipKinds, type ExecutionSubject } from "@opencrane/models/agents";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { _CreateConversationRunAdmission } from "../run-admission-composition";

afterEach(function _RestoreAdmission() { vi.restoreAllMocks(); });

/** Keeps the managed execution Principal distinct from the human who requested this saved run. */
function _subject(): ExecutionSubject
{
	const digest = `sha256:${"a".repeat(64)}`;
	const authenticatedAt = "2026-09-07T00:00:00.000Z";
	const trustedUntil = "2026-09-07T00:10:00.000Z";
	return {
		schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "company-principal",
		identity: { siloId: "silo-1", agentIdentityId: "identity-1", principalId: "company-principal", headRevision: "0", headDigest: digest, decisionEvidenceId: "identity-decision", verifiedAt: authenticatedAt },
		membership: { kind: ExecutionSubjectMembershipKinds.Managed, siloId: "silo-1", principalId: "company-principal", agentServiceId: "service-1", agentRevisionId: "revision-1", agentRevisionDigest: digest, decisionEvidenceId: "company-decision", trustedUntil },
		capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: digest, effectiveContractDigest: digest, decisionEvidenceId: "capability-decision", decidedAt: authenticatedAt },
		runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" },
		computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 },
		requester: { siloId: "silo-1", requesterPrincipalId: "human-principal", requestIdempotencyKey: "message-1", authenticatedAt, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, siloId: "silo-1", principalId: "human-principal", revision: 1, assertionId: "membership-1", payloadDigest: digest, decisionEvidenceId: "human-decision", trustedUntil } },
		admission: { authorizingPrincipalId: "human-principal", decisionEvidenceId: "invocation-decision", admittedAt: authenticatedAt },
	};
}

/** Supplies the stored snapshot and its compiled input without refreshing either original deadline. */
function _savedRun(): { snapshot: RunInputSnapshot; compiled: CompiledRunInput }
{
	const budget = { maxModelTurns: 1, maxCompletionTokens: 4_096, maxCostUsdMicros: 10_000, maxToolInvocations: 0, wallClockDeadlineEpochMs: Date.parse("2026-09-07T00:20:00.000Z") };
	const snapshot: RunInputSnapshot = { runId: "run-1", attempt: 1, siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "child-1", messageIds: ["message-1"], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [], modelRoute: {}, budgetPolicy: budget, executionSubject: _subject(), promptCompilerVersion: "v1", digest: `sha256:${"b".repeat(64)}`, compiledAt: "2026-09-07T00:00:00.000Z" };
	const compiled: CompiledRunInput = { runId: snapshot.runId, attempt: 1, promptCompilerVersion: "v1", instructions: "", messages: [{ role: "user", content: "Group request" }], tools: [], model: { modelAlias: "company-model", maxOutputTokens: 4_096, generatedOutputCapabilities: [] }, budget, digest: `sha256:${"c".repeat(64)}` };
	return { snapshot, compiled };
}

/** Supplies the same claimed computer and immutable message coordinates as the accepted request. */
function _command(): ConversationComputerRunAdmissionCommand
{
	return { runId: "run-1", computer: { siloId: "silo-1", computerId: "computer-1", conversationId: "child-1", agentIdentityId: "identity-1" }, agent: { agentServiceId: "service-1", agentRevisionId: "revision-1", profileRevisionId: "profile-1" }, lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "claim-1" }, requesterPrincipalId: "human-principal", requesterSubjectId: "human-subject", requesterIssuer: "https://issuer.test", requesterAuthenticatedAt: "2026-09-07T00:00:00.000Z", requestIdempotencyKey: "message-1", messageInput: { mode: "pre_persisted_history", messageId: "message-1", historyRevision: "1", orderedMessageIds: ["message-1"] } };
}

describe("conversation run admission composition", function _ConversationRunAdmissionCompositionSuite()
{
	it("rejects an invalid process capacity before constructing usable admission", function _RejectInvalidCapacity()
	{
		expect(function _ComposeWithoutActiveCapacity()
		{
			_CreateConversationRunAdmission({} as never, {} as never, {} as never, {} as never, { maxConcurrentAdmissions: 0, maxQueuedAdmissions: 1 });
		}).toThrow(/maxConcurrentAdmissions must be a positive integer/);
	});

	it.each([
		["execution", "2026-09-07T00:02:00.000Z", "2026-09-07T00:09:00.000Z"],
		["requester", "2026-09-07T00:09:00.000Z", "2026-09-07T00:02:00.000Z"],
	])("caps duplicate admission at the shorter current %s membership expiry", async function _ShorterCurrentEvidence(_kind, executionExpiry, requesterExpiry)
	{
		const { snapshot, compiled } = _savedRun();
		const original = structuredClone(snapshot);
		const subject = snapshot.executionSubject;
		const current: ExecutionSubject = { ...subject, membership: { ...subject.membership, trustedUntil: executionExpiry }, requester: { ...subject.requester, membership: { ...subject.requester.membership, revision: 2, trustedUntil: requesterExpiry } } };
		const load = vi.fn<ExecutionSubjectAuthority["load"]>().mockResolvedValue({ outcome: "loaded", value: current });
		const admitPrincipal = vi.fn().mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: `sha256:${"d".repeat(64)}` } });
		const transaction: RunAdmissionTransaction = { prisma: {}, authorization: { admitPrincipal } as never, admittedAt: "2026-09-07T00:01:00.000Z", admittedAtEpochMs: Date.parse("2026-09-07T00:01:00.000Z") };
		// The persistence boundary supplies the saved row; the real assembler must verify it again.
		const persistence = vi.spyOn(PrismaRunAdmissionUnitOfWork.prototype, "admit").mockImplementation(async function _Duplicate<TDenial>(_admission: RunAdmissionCommand, verifyExisting: RunAdmissionExistingVerifier<TDenial>): Promise<RunAdmissionResult<TDenial>>
		{
			const verified = await verifyExisting(snapshot, transaction);
			if (verified.outcome === "denied")
				return { outcome: "denied", reason: verified.reason };
			return { outcome: "idempotent", snapshot };
		});
		const compilers = { create: vi.fn(), compile: vi.fn().mockResolvedValue(compiled) };
		const port = _CreateConversationRunAdmission({} as never, { create: function _ExecutionSubject() { return { load }; } }, { create: vi.fn() }, compilers, { maxConcurrentAdmissions: 1, maxQueuedAdmissions: 1 });
		const command = _command();

		const result = await port.admit(command);

		expect(result).toEqual({ compiledInput: compiled, authorityExpiresAt: "2026-09-07T00:02:00.000Z" });
		expect(persistence).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith(expect.objectContaining({ runId: command.runId, requestIdempotencyKey: command.requestIdempotencyKey }), expect.objectContaining({ agentRevisionId: snapshot.agentRevisionId }), transaction);
		expect(admitPrincipal).toHaveBeenCalledWith(expect.objectContaining({ principalId: "human-principal", membershipRevision: 2, action: ProductAuthorizationActions.Use, resource: { kind: ProductAuthorizationResourceKinds.Conversation, id: "child-1" } }));
		expect(compilers.create).not.toHaveBeenCalled();
		expect(compilers.compile).toHaveBeenCalledWith(command, snapshot);
		expect(snapshot).toEqual(original);
	});
});
