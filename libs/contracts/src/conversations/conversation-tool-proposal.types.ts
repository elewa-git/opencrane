import type { JsonValue } from "@opencrane/util";

/** Untrusted model-selected tool call admitted against one server-owned conversation turn. */
export interface ConversationToolProposal
{
	/** Identifies the frozen turn; the server derives its run, principal and lease. */
	readonly bootstrapId: string;
	/** Selects one exact tool revision present in that turn's compiled input. */
	readonly toolRevisionId: string;
	/** Contains the complete arguments that must match the frozen tool schema. */
	readonly arguments: { readonly [key: string]: JsonValue };
}

/** Records whether this request created its proposal or recovered an identical durable proposal. */
export enum ConversationToolProposalOutcomes
{
	/** The server saved the proposed call without claiming a provider effect. */
	Recorded = "recorded",
	/** The same proposal was already saved; its lifecycle was not reset. */
	Existing = "existing",
}

/** Receipt for provider-free proposal admission; it does not claim execution or a result. */
export interface ConversationToolProposalReceipt
{
	/** Opaque server-derived identity retained through retries and process replacement. */
	readonly proposalId: string;
	/** Distinguishes a new durable proposal from recovery of the same proposal. */
	readonly outcome: ConversationToolProposalOutcomes;
}
