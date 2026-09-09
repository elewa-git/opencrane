import { AgentRunState, type Prisma } from "@prisma/client";

import { ___ExecutionSubjectSchema, type RunInputSnapshotMcpTool } from "@opencrane/contracts";
import { __AreRunInputSnapshotMcpToolsValid } from "@opencrane/backend/agents/execution/inputs";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../../conversation-computer-turn.types";
import { ConversationToolProposalRefusal } from "../../../conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals, type PreparedConversationToolProposal } from "../../../conversation-tool-proposal.types";
import type { ConversationToolProposalRun, ConversationToolProposalRunReader } from "./conversation-tool-proposal-run.types";

/**
 * Checks the running attempt, its saved input and the proposal slot without writing anything.
 *
 * The caller must keep these reads and admission in the same Serializable transaction. Counting
 * existing calls before the insert lets PostgreSQL reject concurrent attempts to claim another slot.
 * An identical saved proposal can continue even when that slot is already counted.
 */
export class PrismaConversationToolProposalRunRepository implements ConversationToolProposalRunReader
{
	/** Read through the transaction that will admit the invocation and its executor work. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/** Return the checked run identity or refuse before any permission or invocation write. */
	public async load(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal): Promise<ConversationToolProposalRun>
	{
		const query = {
			where: {
				id: turn.compile.runId,
				attempt: turn.compile.attempt,
				siloId: turn.siloId,
				state: AgentRunState.Running,
				conversationId: turn.binding.conversationId,
				agentIdentityId: turn.binding.agentIdentityId,
				agentServiceId: turn.binding.agentServiceId,
			},
			select: { executionSubject: true, inputSnapshotDigest: true, agentRevisionId: true },
		} as const;
		const run = await this.transaction.agentRun.findFirst(query);
		const parsed = ___ExecutionSubjectSchema.safeParse(run?.executionSubject);
		if (run === null || !parsed.success)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const checked = { subject: parsed.data, agentRevisionId: run.agentRevisionId };
		await this._checkSnapshot(turn, candidate, proposal, checked, run.inputSnapshotDigest);
		await this._checkSlot(turn, candidate, proposal);
		return checked;
	}

	/** Require the proposal's tool and budget to agree with the input saved for this attempt. */
	private async _checkSnapshot(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal, run: ConversationToolProposalRun, inputSnapshotDigest: string): Promise<void>
	{
		const query = {
			where: {
				runId: turn.compile.runId,
				attempt: turn.compile.attempt,
				digest: inputSnapshotDigest,
				siloId: turn.siloId,
				agentRevisionId: run.agentRevisionId,
				agentIdentityId: turn.binding.agentIdentityId,
				principalId: run.subject.principalId,
				conversationId: turn.binding.conversationId,
			},
			select: { budgetPolicy: true, mcpTools: true, executionSubject: true },
		} as const;
		const snapshot = await this.transaction.runInputSnapshot.findFirst(query);
		const budget = snapshot?.budgetPolicy;
		const tools = snapshot?.mcpTools;
		if (snapshot === null || budget === undefined || budget === null || typeof budget !== "object" || Array.isArray(budget)
			|| budget.wallClockDeadlineEpochMs !== candidate.compiledInput.budget.wallClockDeadlineEpochMs
			|| (budget.maxToolInvocations ?? null) !== candidate.compiledInput.budget.maxToolInvocations
			|| ___DigestCanonicalJson(snapshot.executionSubject as JsonValue) !== ___DigestCanonicalJson(run.subject as unknown as JsonValue)
			|| !Array.isArray(tools) || !__AreRunInputSnapshotMcpToolsValid(tools as unknown as RunInputSnapshotMcpTool[]))
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const frozenTool = (tools as unknown as RunInputSnapshotMcpTool[]).find(tool => tool.toolRevisionId === proposal.tool.toolRevisionId);
		if (frozenTool === undefined || frozenTool.inputSchemaDigest !== proposal.tool.parametersSchemaDigest || frozenTool.name !== proposal.tool.name)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Invalid);
	}

	/** Reject a changed retry and prevent a new proposal from taking an occupied call slot. */
	private async _checkSlot(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal): Promise<void>
	{
		const query = {
			where: { runId_attempt_candidateId: { runId: turn.compile.runId, attempt: turn.compile.attempt, candidateId: proposal.proposalId } },
			select: { id: true, requestFingerprint: true },
		} as const;
		const existing = await this.transaction.toolInvocation.findUnique(query);
		if (existing !== null && existing.requestFingerprint !== proposal.requestFingerprint)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Conflict);
		const countQuery = { where: { runId: turn.compile.runId, attempt: turn.compile.attempt } };
		const count = await this.transaction.toolInvocation.count(countQuery);
		if (existing === null && count >= Math.min(1, candidate.compiledInput.budget.maxToolInvocations ?? 1))
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
	}
}
