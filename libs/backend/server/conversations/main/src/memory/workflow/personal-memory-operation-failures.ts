import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import type { PersonalMemoryOperationFailureCodes } from "@opencrane/backend/agents/personal/memory";
import { MemoryGatewayMutationFailure, MemoryGatewayProtocolError, MemoryGatewayTransportError } from "@opencrane/backend/server/infra/memory-gateway-client";

/** Carries one content-free guard failure into the lifecycle owner. */
export class _PersonalMemoryOperationBlocked extends Error
{
	/** Fixed lifecycle reason that may be saved without private operation content. */
	readonly failureCode: PersonalMemoryOperationFailureCodes;

	/** Creates a blocked outcome without retaining its lower-level cause. */
	constructor(failureCode: PersonalMemoryOperationFailureCodes)
	{
		super("Personal-memory operation guard is unavailable");
		this.name = "PersonalMemoryOperationBlocked";
		this.failureCode = failureCode;
	}
}

/** Carries delivery evidence from one failed mutation checkpoint into the lifecycle owner. */
export class _PersonalMemoryOperationMutationFailed extends Error
{
	/** Fixed phase-specific reason for the failed mutation. */
	readonly failureCode: PersonalMemoryOperationFailureCodes;
	/** Whether the failed request is proven absent from the provider transport. */
	readonly deliveryState: MemoryMutationDeliveryStates;

	/** Creates content-free mutation evidence without retaining its lower-level cause. */
	constructor(failureCode: PersonalMemoryOperationFailureCodes, deliveryState: MemoryMutationDeliveryStates)
	{
		super("Personal-memory provider mutation did not complete");
		this.name = "PersonalMemoryOperationMutationFailed";
		this.failureCode = failureCode;
		this.deliveryState = deliveryState;
	}
}

/** Maps only explicit gateway delivery evidence; every other post-dispatch failure stays ambiguous. */
export function _MutationDeliveryState(error: unknown): MemoryMutationDeliveryStates
{
	if ((error instanceof MemoryGatewayMutationFailure || error instanceof MemoryGatewayProtocolError || error instanceof MemoryGatewayTransportError)
		&& error.deliveryState === MemoryMutationDeliveryStates.ProvenNotSent)
		return MemoryMutationDeliveryStates.ProvenNotSent;
	return MemoryMutationDeliveryStates.Ambiguous;
}
