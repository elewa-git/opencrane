import { MemoryGatewayErrorCodes, MemoryMutationDeliveryStates } from "@opencrane/contracts";

/** Read failure translated without retaining provider response content. */
export class MemoryGatewayProviderReadError extends Error
{
	/** Failure class returned through the stable gateway contract. */
	readonly error: MemoryGatewayErrorCodes;

	/** Create a read failure that carries no provider response or thrown cause. */
	constructor(error: MemoryGatewayErrorCodes)
	{
		super(`Memory provider read failed: ${error}`);
		this.name = "MemoryGatewayProviderReadError";
		this.error = error;
	}
}

/** Mutation failure that records whether the provider may have received the request. */
export class MemoryGatewayProviderMutationError extends Error
{
	/** Failure class returned through the stable gateway contract. */
	readonly error: MemoryGatewayErrorCodes;
	/** Evidence that decides whether the caller must reconcile before retrying. */
	readonly deliveryState: MemoryMutationDeliveryStates;

	/** Create a mutation failure without retaining provider response details. */
	constructor(error: MemoryGatewayErrorCodes, deliveryState: MemoryMutationDeliveryStates)
	{
		super(`Memory provider mutation failed: ${error} (${deliveryState})`);
		this.name = "MemoryGatewayProviderMutationError";
		this.error = error;
		this.deliveryState = deliveryState;
	}
}
