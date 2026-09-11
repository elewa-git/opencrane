import type { ConversationComputerTurnAuthority } from "../conversation-computer-turn.types";
import type { ConversationComputerTurnWorkflowReceiptBinder } from "./conversation-computer-turn-workflow-receipt.types";
import type { ConversationApprovalNotificationPort } from "../approval-notifications/conversation-approval-notification.types";

/** Carries only durable routing and lease fences into one server-owned conversation turn. */
export interface ConversationComputerTurnTaskInput
{
	/** Identifies the silo that owns the conversation computer. */
	readonly siloId: string;
	/** Identifies the durable conversation computer whose saved progress selects the next step. */
	readonly computerId: string;
	/** Fences this workflow to the active Agent Sandbox lease. */
	readonly leaseId: string;
	/** Fences this workflow to the active Agent Sandbox generation. */
	readonly leaseGeneration: number;
	/** Identifies the activation delivery and supplies the workflow idempotency key. */
	readonly activationEventId: string;
	/** Identifies the conversation entry that caused this turn. */
	readonly causationId: string;
	/** Records the causing entry's immutable position so competing activations preserve order. */
	readonly causationPosition: string;
}

/** Closed result saved by Absurd when one activation workflow stops progressing. */
export type ConversationComputerTurnWorkflowResult =
	| { readonly outcome: "completed" | "response_unavailable" | "authority_ended" | "superseded" | "idle"; readonly turnId?: string };

/** Dependencies that keep orchestration separate from turn effects and receipt persistence. */
export interface ConversationComputerTurnWorkflowDependencies
{
	/** Publishes one safe requested fact before the workflow begins its approval wait. */
	readonly approvalNotifications: ConversationApprovalNotificationPort;
	readonly authority: Pick<ConversationComputerTurnAuthority, "start" | "advance">;
	readonly receipts: ConversationComputerTurnWorkflowReceiptBinder;
	readonly siloId: string;
}
