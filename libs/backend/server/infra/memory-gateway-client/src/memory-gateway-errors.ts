import { MemoryGatewayErrorCodes } from "@opencrane/contracts";
import type { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import type { MemoryGatewayTransportFailureCode } from "./http-cognee-memory-gateway-client.types";

/** Fixed transport failure carrying delivery evidence only for a mutation request. */
export class MemoryGatewayTransportError extends Error
{
	/** Stable shared failure class for an unavailable private gateway exchange. */
	readonly error = MemoryGatewayErrorCodes.ProviderUnavailable;
	/** Bounded transport stage that failed without retaining the underlying error. */
	readonly transportCode: MemoryGatewayTransportFailureCode;
	/** Present for mutation requests and absent from read failures. */
	declare readonly deliveryState?: MemoryMutationDeliveryStates;

	/** Creates a content-free transport failure. */
	constructor(code: MemoryGatewayTransportFailureCode, deliveryState?: MemoryMutationDeliveryStates)
	{
		super(`Memory gateway transport failed: ${code}`);
		this.name = "MemoryGatewayTransportError";
		this.transportCode = code;
		if (deliveryState !== undefined)
			this.deliveryState = deliveryState;
	}
}

/** Gateway-declared read failure after its status and strict error body agree. */
export class MemoryGatewayReadFailure extends Error
{
	/** Stable shared gateway error class. */
	readonly error: MemoryGatewayErrorCodes;

	/** Creates a content-free read failure. */
	constructor(code: MemoryGatewayErrorCodes)
	{
		super(`Memory gateway read failed: ${code}`);
		this.name = "MemoryGatewayReadFailure";
		this.error = code;
	}
}

/** Gateway-declared mutation failure carrying the gateway's delivery evidence. */
export class MemoryGatewayMutationFailure extends Error
{
	/** Stable shared gateway error class. */
	readonly error: MemoryGatewayErrorCodes;
	/** Whether the provider mutation may have been dispatched. */
	readonly deliveryState: MemoryMutationDeliveryStates;

	/** Creates a content-free mutation failure. */
	constructor(code: MemoryGatewayErrorCodes, deliveryState: MemoryMutationDeliveryStates)
	{
		super(`Memory gateway mutation failed: ${code}`);
		this.name = "MemoryGatewayMutationFailure";
		this.error = code;
		this.deliveryState = deliveryState;
	}
}

/** Stable request or response mismatch that cannot be mistaken for an empty read or accepted write. */
export class MemoryGatewayProtocolError extends Error
{
	/** Shared protocol class distinguishing invalid local input from an invalid gateway response. */
	readonly error: MemoryGatewayErrorCodes;
	/** Present for mutation requests and absent from read failures. */
	declare readonly deliveryState?: MemoryMutationDeliveryStates;

	/** Creates a content-free protocol failure. */
	constructor(error: MemoryGatewayErrorCodes, deliveryState?: MemoryMutationDeliveryStates)
	{
		super("Memory gateway violated its stable protocol");
		this.name = "MemoryGatewayProtocolError";
		this.error = error;
		if (deliveryState !== undefined)
			this.deliveryState = deliveryState;
	}
}
