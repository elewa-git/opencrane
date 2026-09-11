import type { ExecutionSubject } from "@opencrane/models/agents";
import type { ProductAuthorizationWorkloadContext, ToolInvocationAdmissionOutcomes, ToolInvocationAdmissionResult } from "@opencrane/backend/server/iam/authorization";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "../../turns/conversation-computer-turn.types";
import type { PreparedConversationToolProposal } from "./conversation-tool-proposal.types";

/** Run facts checked against the saved input before a tool proposal can be admitted. */
export interface ConversationToolProposalRun
{
	/** Identifies the revision stored on the running attempt. */
	readonly agentRevisionId: string;
	/** Retains the execution identity that also appears in the saved input. */
	readonly subject: ExecutionSubject;
	/** Human-readable tool and system metadata frozen into an approval request, when approval is required. */
	readonly approvalDisclosure: ConversationToolApprovalDisclosure | null;
}

/** Stored tool metadata safe to disclose for one exact approval-gated revision. */
export interface ConversationToolApprovalDisclosure
{
	/** Tool name frozen in the admitted run snapshot. */
	readonly toolName: string;
	/** Provider-authored description frozen in the admitted run snapshot. */
	readonly toolDescription: string | null;
	/** Operator-authored name of the server that owns the selected tool revision. */
	readonly serverName: string;
}

/** Reads proposal prerequisites without recording permission or starting invocation preparation. */
export interface ConversationToolProposalRunReader
{
	/** Return run facts after checking the saved input and available call slot, or throw a refusal. */
	load(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal): Promise<ConversationToolProposalRun>;
}

/** Reports whether preparation created the invocation or reused the same saved request. */
export type AdmittedConversationToolProposal = Exclude<ToolInvocationAdmissionResult, { outcome: ToolInvocationAdmissionOutcomes.Conflict }>;

/** Records tool permission and asks IAM to create or recover the proposal's invocation. */
export interface ConversationToolProposalPreparation
{
	/** Refuse denied or conflicting work by throwing, so the caller rolls back its transaction. */
	admit(turn: FrozenConversationComputerTurn, run: ConversationToolProposalRun, proposal: PreparedConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<AdmittedConversationToolProposal>;
}
