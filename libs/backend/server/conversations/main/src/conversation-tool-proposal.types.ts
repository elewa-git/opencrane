import type { CompiledToolDefinition, ConversationToolProposal, ConversationToolProposalReceipt } from "@opencrane/contracts";
import type { ProductAuthorizationWorkloadContext } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "./conversation-computer-turn.types";

/** Reviewed workload identity accompanies the untrusted tool selection only inside the server. */
export interface ConversationToolProposalCommand extends ConversationToolProposal
{
	/** Contains the identity obtained from the exact audience-bound TokenReview. */
	readonly workload: RuntimeWorkloadIdentity;
}

/** Owns atomic proposal preparation and executor admission after the turn authority verifies the bound Pod. */
export interface ConversationToolProposalAdmission
{
	/** Save one exact proposal or recover its winner; current authority is checked before commit. */
	admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: ConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>;
}

/** Create existing executor work in the proposal's transaction; never open another transaction or call a provider. */
export type ConversationToolProposalRuntimeAdmission = (transaction: unknown, invocationRowId: string) => Promise<boolean>;

/** Server-derived immutable facts passed into the proposal's transactional admission owner. */
export interface PreparedConversationToolProposal
{
	/** Identifies the sole allowed proposal slot for this run attempt. */
	readonly proposalId: string;
	/** Retains the validated frozen tool and exact schema. */
	readonly tool: CompiledToolDefinition;
	/** Retains the complete schema-validated arguments. */
	readonly arguments: ConversationToolProposal["arguments"];
	/** Binds authorization to those exact arguments. */
	readonly argumentsDigest: `sha256:${string}`;
	/** Binds the admitted turn, computer, lease and Sandbox claim. */
	readonly assignmentDigest: `sha256:${string}`;
	/** Detects a different body or authority binding reused for the same proposal slot. */
	readonly requestFingerprint: `sha256:${string}`;
}

/** Closed refusals that the private transport may disclose without request or credential data. */
export enum ConversationToolProposalRefusals
{
	/** The proposal does not match the frozen tool, schema or bounded turn contract. */
	Invalid = "conversation_tool_proposal_invalid",
	/** A previously recorded proposal owns the slot with different immutable content. */
	Conflict = "conversation_tool_proposal_conflict",
	/** Current ownership, permission, lease or frozen budget refuses admission. */
	Denied = "conversation_tool_proposal_denied",
}

/** Saves prepared immutable facts inside a caller-owned Serializable transaction. */
export interface ConversationToolProposalRepository
{
	/** Admit one stable slot, requiring its current authority before the transaction may commit. */
	admit(turn: FrozenConversationComputerTurn, candidate: ConversationComputerTurnCandidate, proposal: PreparedConversationToolProposal, workload: ProductAuthorizationWorkloadContext): Promise<ConversationToolProposalReceipt>;
}
