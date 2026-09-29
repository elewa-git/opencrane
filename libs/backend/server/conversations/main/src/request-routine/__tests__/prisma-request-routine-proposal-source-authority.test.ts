import { AgentRunState, AgentRunTrigger } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUEST_ROUTINE_TOOL } from "@opencrane/backend/server/agents/scheduling/contract";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";
import { ExecutionSubjectMembershipKinds, FirstPartyToolCapabilities, RUN_INPUT_SNAPSHOT_VERSION } from "@opencrane/contracts";

import { PrismaRequestRoutineProposalSourceAuthority } from "../prisma-request-routine-proposal-source-authority";
import { PrismaConversationRequestRoutineSourceUnitOfWork } from "../prisma-conversation-request-routine-source";
import { PrismaConversationRoutineProposalRecipientUnitOfWork } from "../prisma-conversation-routine-proposal-recipient";

const _SOURCE = { siloId: "silo-1", sourceConversationId: "conversation-1", runId: "run-1", attempt: 1, ordinal: 1, requesterPrincipalId: "requester-1" };

function _Subject()
{
	const requesterMembership = { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "requester-1", siloId: "silo-1", revision: 1, assertionId: "requester-assertion", payloadDigest: `sha256:${"b".repeat(64)}`, decisionEvidenceId: "requester-membership", trustedUntil: "2099-01-01T00:00:00.000Z" } as const;
	return { schemaVersion: 1, siloId: "silo-1", agentIdentityId: "identity-1", principalId: "agent-1", identity: { agentIdentityId: "identity-1", principalId: "agent-1", siloId: "silo-1", headRevision: "1", headDigest: `sha256:${"a".repeat(64)}`, decisionEvidenceId: "identity-decision", verifiedAt: "2026-09-01T00:00:00.000Z" }, membership: { kind: ExecutionSubjectMembershipKinds.Fleet, principalId: "agent-1", siloId: "silo-1", revision: 1, assertionId: "agent-assertion", payloadDigest: `sha256:${"c".repeat(64)}`, decisionEvidenceId: "agent-membership", trustedUntil: "2099-01-01T00:00:00.000Z" }, capability: { agentIdentityId: "identity-1", computerId: "computer-1", capabilitySetDigest: `sha256:${"d".repeat(64)}`, effectiveContractDigest: `sha256:${"e".repeat(64)}`, decisionEvidenceId: "capability-decision", decidedAt: "2026-09-01T00:00:00.000Z" }, runScope: { siloId: "silo-1", runId: "run-1", attempt: 1, agentServiceId: "service-1", agentRevisionId: "revision-1" }, computerScope: { siloId: "silo-1", computerId: "computer-1", leaseId: "lease-1", leaseGeneration: 1 }, requester: { siloId: "silo-1", requesterPrincipalId: "requester-1", requestIdempotencyKey: "request-1", authenticatedAt: "2026-09-01T00:00:00.000Z", membership: requesterMembership }, admission: { authorizingPrincipalId: "requester-1", decisionEvidenceId: "admission-decision", admittedAt: "2026-09-01T00:00:00.000Z" } };
}

function _Transaction(trigger: AgentRunTrigger = AgentRunTrigger.Interactive, state: AgentRunState = AgentRunState.Running)
{
	const run = { principalId: "agent-1", executionSubject: _Subject(), inputSnapshotDigest: `sha256:${"f".repeat(64)}`, trigger, state };
	return {
		agentRunAuthorityClock: { findUniqueOrThrow: vi.fn().mockResolvedValue({ now: new Date("2026-09-10T00:00:00.000Z") }) },
		agentRun: { findFirst: vi.fn(async function _Run({ where }: { readonly where: { readonly trigger: AgentRunTrigger; readonly state: AgentRunState } }) { return where.trigger === run.trigger && where.state === run.state ? run : null; }) },
		runInputSnapshot: { findFirst: vi.fn().mockResolvedValue({ snapshotVersion: RUN_INPUT_SNAPSHOT_VERSION, firstPartyCapabilities: [{ capability: FirstPartyToolCapabilities.RequestRoutine, capabilityRevision: REQUEST_ROUTINE_TOOL.capabilityRevision, parametersSchemaDigest: REQUEST_ROUTINE_TOOL.parametersSchemaDigest }], budgetPolicy: { maxModelTurns: 2, maxCompletionTokens: 100, maxCostUsdMicros: null, maxToolInvocations: 1, maxLoopIterations: 1, wallClockDeadlineEpochMs: Date.parse("2099-01-01T00:00:00.000Z") } }) },
		principal: { findFirst: vi.fn().mockResolvedValue({ subject: "user-1" }) },
		orgMembership: { findFirst: vi.fn().mockResolvedValue({ id: "membership-1" }) },
		conversation: { findFirst: vi.fn().mockResolvedValue({ id: "conversation-1" }) },
	};
}

describe("Prisma request_routine proposal source authority", function _SourceAuthoritySuite()
{
	afterEach(function _Restore() { vi.restoreAllMocks(); });

	it("derives the human requester from managed execution evidence rather than the agent principal", async function _ManagedRequesterSource()
	{
		const transaction = { agentRun: { findFirst: vi.fn().mockResolvedValue({ executionSubject: _Subject() }) } };
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => unknown) { return work(transaction); }) };
		const resolver = new PrismaConversationRequestRoutineSourceUnitOfWork(prisma as never);
		const turn = { siloId: "silo-1", binding: { conversationId: "conversation-1" }, compile: { runId: "run-1", attempt: 1 } };
		await expect(resolver.resolve(turn as never, 2)).resolves.toEqual({ siloId: "silo-1", sourceConversationId: "conversation-1", runId: "run-1", attempt: 1, ordinal: 2, requesterPrincipalId: "requester-1" });
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", maxWait: undefined, timeout: undefined });
	});

	it("reads the current proposal recipient in one serializable authorization snapshot", async function _CurrentRecipient()
	{
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "decidePrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow } as never);
		const transaction = _Transaction();
		const prisma = { $transaction: vi.fn(async function _Transaction(work: (value: typeof transaction) => unknown) { return work(transaction); }) };
		const reader = new PrismaConversationRoutineProposalRecipientUnitOfWork(prisma as never);
		const command = { ..._SOURCE, bootstrapId: "bootstrap-1", proposalRef: "proposal-1", expiresAt: "2026-09-11T00:00:00.000Z" };
		await expect(reader.readCurrent(command)).resolves.toEqual({ participantId: "user-1" });
		expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", maxWait: undefined, timeout: undefined });
	});

	it("accepts only the active interactive snapshot with the exact frozen capability and current requester read", async function _AuthorizedCreation()
	{
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "decidePrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow } as never);
		const authority = new PrismaRequestRoutineProposalSourceAuthority(_Transaction() as never);
		await expect(authority.authorizeCreation(_SOURCE)).resolves.toEqual(_SOURCE);
	});

	it.each([[AgentRunTrigger.Scheduled, AgentRunState.Running], [AgentRunTrigger.Interactive, AgentRunState.Cancelled]])("refuses a scheduled or inactive source: %s %s", async function _RefusedRun(trigger, state)
	{
		vi.spyOn(PrismaAuthorizationAuthority.prototype, "decidePrincipal").mockResolvedValue({ outcome: AuthorizationDecisionOutcomes.Allow } as never);
		const authority = new PrismaRequestRoutineProposalSourceAuthority(_Transaction(trigger, state) as never);
		await expect(authority.authorizeCreation(_SOURCE)).resolves.toBeNull();
	});

	it("refuses changed requester coordinates before proposal persistence", async function _WrongRequester()
	{
		const authority = new PrismaRequestRoutineProposalSourceAuthority(_Transaction() as never);
		await expect(authority.authorizeCreation({ ..._SOURCE, requesterPrincipalId: "other-requester" })).resolves.toBeNull();
	});
});
