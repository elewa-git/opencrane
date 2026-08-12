import type { AgentThreadDeliveryKinds, AgentThreadParentDelivery } from "@opencrane/backend/conversations/agent-threads";

/** Runtime-derived exact authority for one display-safe child-to-parent delivery. */
export interface AgentThreadParentDeliveryCommand
{
	readonly siloId: string;
	readonly childConversationId: string;
	readonly runId: string;
	readonly agentServiceId: string;
	readonly idempotencyKey: string;
	readonly kind: AgentThreadDeliveryKinds;
	readonly label: string;
	readonly detail: string;
	readonly assetId: string | null;
}

/** Stable internal delivery outcomes; only accepted/idempotent results may be projected. */
export type DeliverAgentThreadParentResult =
	| { readonly outcome: "accepted" | "idempotent"; readonly delivery: AgentThreadParentDelivery }
	| { readonly outcome: "denied"; readonly reason: "authority_unavailable" | "idempotency_conflict" | "invalid_display_content" | "persistence_unavailable" };

/** Internal-only runtime port. It is deliberately absent from browser routers. */
export interface AgentThreadParentDeliveryUnitOfWork
{
	deliver(command: AgentThreadParentDeliveryCommand): Promise<DeliverAgentThreadParentResult>;
}
