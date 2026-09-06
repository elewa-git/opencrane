import type { Request } from "express";
import type { Logger } from "@opencrane/backend/observability";

/** Authenticated operator coordinates resolved from the request, never from its body. */
export interface ConversationComputerOperatorCaller
{
	/** Stable local principal checked by central product authorization. */
	readonly principalId: string;
	/** Silo selected from the trusted public request host. */
	readonly siloId: string;
}

/**
 * Admits one operator action against the silo's Organization/Administer grant.
 *
 * The app composition binds this to the existing product authorization authority. The router never
 * decides authorization itself and never accepts a caller-selected silo or group name.
 *
 * Called by: `_CreateConversationComputerOperatorRouter`.
 */
export interface ConversationComputerOperatorAuthorization
{
	/** Returns true only when the caller currently holds Organization/Administer for the silo. */
	admitReplayParkedActivations(caller: ConversationComputerOperatorCaller): Promise<boolean>;
}

/** Replays the parked activation queue of the caller's silo. */
export interface ConversationComputerActivationReplayer
{
	/** Moves every parked activation delivery of the silo's consumer group back into live delivery. */
	replayParked(siloId: string): Promise<void>;
}

/** Server-owned authorities the operator router needs. */
export interface ConversationComputerOperatorRouterOptions
{
	/** Admits operator actions through central product authorization. */
	readonly authorization: ConversationComputerOperatorAuthorization;
	/** Replays the silo-scoped parked activation queue. */
	readonly activations: ConversationComputerActivationReplayer;
	/** Records failures without request bodies. */
	readonly logger: Pick<Logger, "warn">;
}

/** Resolves operator identity from the authenticated Express request, or null without a trusted principal. */
export type ConversationComputerOperatorPrincipalResolver = (request: Request) => { readonly principalId: string; readonly siloId: string } | null;
