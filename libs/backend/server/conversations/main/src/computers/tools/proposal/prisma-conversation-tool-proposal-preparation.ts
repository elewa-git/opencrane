import type { Prisma } from "@prisma/client";

import { __AdmitPreparingToolInvocationInTransaction, PrismaAuthorizationAuthority, TOOL_INVOCATION_PREPARATION_POLICY, ToolInvocationAdmissionOutcomes, type ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import { ConversationToolProposalRefusal } from "./conversation-tool-proposal-refusal";
import { ConversationToolProposalRefusals, type PreparedConversationToolProposal } from "./conversation-tool-proposal.types";
import { _CreateConversationToolProposalIntent } from "./conversation-tool-proposal-intent";
import type { AdmittedConversationToolProposal, ConversationToolProposalPreparation, ConversationToolProposalRun } from "./conversation-tool-proposal-run.types";

/** Records tool permission and creates or recovers its invocation in the caller's transaction. */
export class PrismaConversationToolProposalPreparationAuthority implements ConversationToolProposalPreparation
{
	/** Share the transaction used for run checks and executor admission. */
	public constructor(private readonly transaction: Prisma.TransactionClient) {}

	/**
	 * Require current permission even when the proposal already has a saved invocation.
	 * A conflicting retry throws so the enclosing transaction also rolls back its permission record.
	 */
	public async admit(turn: FrozenConversationComputerTurn, run: ConversationToolProposalRun, proposal: PreparedConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<AdmittedConversationToolProposal>
	{
		const coordinate = {
			resource: { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: proposal.tool.toolRevisionId },
			action: ProductAuthorizationActions.Invoke,
		} as const;
		const command = {
			siloId: turn.siloId,
			principalId: run.subject.principalId,
			actorKind: "workload" as const,
			actorId: workload.podUid,
			workload,
			run: {
				runId: turn.compile.runId,
				attempt: turn.compile.attempt,
				agentServiceId: turn.binding.agentServiceId,
				agentRevisionId: run.agentRevisionId,
			},
			...coordinate,
			argumentsDigest: proposal.argumentsDigest,
			nowEpochMs: Date.now(),
		};
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const decision = await authorization.admitPrincipal(command);
		if (decision.outcome !== AuthorizationDecisionOutcomes.Allow || decision.evidence === null)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Denied);
		const intent = _CreateConversationToolProposalIntent(turn, run, proposal, coordinate, decision.evidence.decisionDigest);
		const result = await __AdmitPreparingToolInvocationInTransaction(this.transaction, intent, new Date(), TOOL_INVOCATION_PREPARATION_POLICY);
		if (result.outcome === ToolInvocationAdmissionOutcomes.Conflict)
			throw new ConversationToolProposalRefusal(ConversationToolProposalRefusals.Conflict);
		return result;
	}
}
