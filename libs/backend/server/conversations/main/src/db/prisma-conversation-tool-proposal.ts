import { AgentRunState, Prisma, type PrismaClient } from "@prisma/client";

import { ___ExecutionSubjectSchema, ConversationToolProposalOutcomes, type ConversationToolProposal, type ConversationToolProposalReceipt, type RunInputSnapshotMcpTool } from "@opencrane/contracts";
import { __AreRunInputSnapshotMcpToolsValid } from "@opencrane/backend/agents/execution/inputs";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { __AdmitPreparingToolInvocationInTransaction, ExternalActionRecoveryModes, PrismaAuthorizationAuthority, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationAdmissionOutcomes, type ToolInvocationAuthorizationEvidence } from "@opencrane/backend/server/iam/authorization";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../conversation-computer-turn.types";
import type { ConversationToolDispatchDependencies } from "../conversation-tool-dispatch.types";
import { ConversationToolProposalRefusal } from "../conversation-tool-proposal-refusal";
import { _PrepareConversationToolProposal } from "../conversation-tool-proposal";
import { ConversationToolProposalRefusals, type ConversationToolProposalAdmission, type PreparedConversationToolProposal, type ConversationToolProposalRepository } from "../conversation-tool-proposal.types";
import { PrismaConversationToolDispatchAuthority } from "./prisma-conversation-tool-dispatch-authority";

/**
 * Saves one proposal using the existing invocation owner and the same transaction's current access.
 *
 * A refusal throws before commit, including after tentative admission. The deterministic slot and
 * Serializable predicate read protect the one-call limit across concurrent processes. This owner
 * never marks work Ready, opens provider work, or supplies an approval on the caller's behalf.
 * Called by: PrismaConversationToolProposalUnitOfWork.admit.
 */
export class PrismaConversationToolProposalRepository implements ConversationToolProposalRepository
{
	/** Bind all invocation writes and permission decisions to this transaction. */
	public constructor(private readonly transaction: Prisma.TransactionClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Recover the exact admitted winner or atomically save its Preparing row and fresh effect evidence. */
	public async admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal): Promise<ConversationToolProposalReceipt>
	{
		const run = await this.transaction.agentRun.findFirst({ where: { id: turn.compile.runId, attempt: turn.compile.attempt, siloId: turn.siloId, state: AgentRunState.Running, conversationId: turn.binding.conversationId, agentIdentityId: turn.binding.agentIdentityId, agentServiceId: turn.binding.agentServiceId }, select: { executionSubject: true, inputSnapshotDigest: true, agentRevisionId: true } });
		const parsed = ___ExecutionSubjectSchema.safeParse(run?.executionSubject);
		if (run === null || !parsed.success)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const subject = parsed.data;
		const snapshot = await this.transaction.runInputSnapshot.findFirst({ where: { runId: turn.compile.runId, attempt: turn.compile.attempt, digest: run.inputSnapshotDigest, siloId: turn.siloId, agentRevisionId: run.agentRevisionId, agentIdentityId: turn.binding.agentIdentityId, principalId: subject.principalId, conversationId: turn.binding.conversationId }, select: { budgetPolicy: true, mcpTools: true, executionSubject: true } });
		const budget = snapshot?.budgetPolicy;
		const tools = snapshot?.mcpTools;
		if (snapshot === null || budget === undefined || budget === null || typeof budget !== "object" || Array.isArray(budget)
			|| budget.wallClockDeadlineEpochMs !== candidate.compiledInput.budget.wallClockDeadlineEpochMs
			|| (budget.maxToolInvocations ?? null) !== candidate.compiledInput.budget.maxToolInvocations
			|| ___DigestCanonicalJson(snapshot.executionSubject as JsonValue) !== ___DigestCanonicalJson(subject as unknown as JsonValue)
			|| !Array.isArray(tools) || !__AreRunInputSnapshotMcpToolsValid(tools as unknown as RunInputSnapshotMcpTool[]))
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const frozenTool = (tools as unknown as RunInputSnapshotMcpTool[]).find(tool => tool.toolRevisionId === proposal.tool.toolRevisionId);
		if (frozenTool === undefined || frozenTool.inputSchemaDigest !== proposal.tool.parametersSchemaDigest || frozenTool.name !== proposal.tool.name)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Invalid);
		const existing = await this.transaction.toolInvocation.findUnique({ where: { runId_attempt_candidateId: { runId: turn.compile.runId, attempt: turn.compile.attempt, candidateId: proposal.proposalId } }, select: { id: true, requestFingerprint: true } });
		if (existing !== null && existing.requestFingerprint !== proposal.requestFingerprint)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Conflict);
		const count = await this.transaction.toolInvocation.count({ where: { runId: turn.compile.runId, attempt: turn.compile.attempt } });
		if (existing === null && count >= Math.min(1, candidate.compiledInput.budget.maxToolInvocations ?? 1))
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const coordinate = { resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: proposal.tool.toolRevisionId }, action: ProductAuthorizationActions.Invoke } as const;
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const decision = await authorization.admitPrincipal({ siloId: turn.siloId, principalId: subject.principalId, actorKind: "workload", actorId: subject.agentIdentityId, ...coordinate, argumentsDigest: proposal.argumentsDigest, nowEpochMs: Date.now() });
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const binding = { actorKind: "workload" as const, executionSubject: subject, coordinates: [coordinate], decisionDigests: [decision.evidence.decisionDigest], assignmentDigest: proposal.assignmentDigest };
		const evidence: ToolInvocationAuthorizationEvidence = { ...binding, evidenceDigest: ___DigestCanonicalJson({ ...binding, agentRevisionId: run.agentRevisionId, runId: turn.compile.runId, attempt: turn.compile.attempt, argumentsDigest: proposal.argumentsDigest } as unknown as JsonValue) };
		const result = await __AdmitPreparingToolInvocationInTransaction(this.transaction, { siloId: turn.siloId, runId: turn.compile.runId, attempt: turn.compile.attempt, agentServiceId: turn.binding.agentServiceId, agentRevisionId: run.agentRevisionId, authorizationEvidence: evidence, requestIdentity: { runtimeInstanceId: turn.computerId, commandId: turn.bootstrapId, candidateId: proposal.proposalId }, toolRevisionId: proposal.tool.toolRevisionId, toolInvocationId: proposal.proposalId, arguments: proposal.arguments, argumentsDigest: proposal.argumentsDigest, requestFingerprint: proposal.requestFingerprint, approvalRequired: false, recoveryMode: ExternalActionRecoveryModes.Manual, recoveryKey: null }, new Date(), TOOL_INVOCATION_PREPARATION_POLICY);
		if (result.outcome === ToolInvocationAdmissionOutcomes.Conflict)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Conflict);
		const authority = new PrismaConversationToolDispatchAuthority(this.transaction, this.dependencies);
		if (!await authority.isCurrentlyEligible(result.invocation, new Date()) || candidate.compiledInput.budget.wallClockDeadlineEpochMs! <= Date.now() || Date.parse(candidate.credentialExpiresAt) <= Date.now())
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		return { proposalId: result.invocation.toolInvocationId, outcome: result.outcome === ToolInvocationAdmissionOutcomes.Admitted ? ConversationToolProposalOutcomes.Recorded : ConversationToolProposalOutcomes.Existing };
	}
}

/** Opens the bounded Serializable transaction for an already Pod-verified tool proposal. */
export class PrismaConversationToolProposalUnitOfWork implements ConversationToolProposalAdmission
{
	/** Retain current authority readers; no provider adapter is available to this admission owner. */
	public constructor(private readonly prisma: PrismaClient, private readonly dependencies: ConversationToolDispatchDependencies) {}

	/** Validate immutable input once, then retry only proven database rollbacks of the complete admission. */
	public admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: ConversationToolProposal): Promise<ConversationToolProposalReceipt>
	{
		const prepared = _PrepareConversationToolProposal(turn, candidate, proposal);
		const dependencies = this.dependencies;
		const prisma = this.prisma;
		return ___DoWithTrace("conversation.tool_proposal.admit", {}, async function _ProposalAdmission()
		{
			return ___RunInPrismaUnitOfWork(prisma, async function _Admit(transaction)
			{
				const repository = new PrismaConversationToolProposalRepository(transaction, dependencies);
				return repository.admit(turn, candidate, prepared);
			}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, operation: "conversation tool proposal", attemptLimit: 3, timeout: 10_000 });
		});
	}
}
