import { MemoryMutationDeliveryStates } from "@opencrane/contracts";

import { __AssertMemoryProvenanceComplete } from "./memory-provenance";
import type { MemoryCorrectionCommand, MemoryForgetCommand, MemoryGatewayClient, MemoryQueryCommand, MemoryQueryResult, PersonalMemoryRecordCommand, PersonalMemoryRecordReceipt, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types";

/** Typed failure emitted when no authenticated memory-gateway transport is configured. */
export class MemoryGatewayUnavailableError extends Error
{
	/** Proves that an unavailable client did not hand mutation bytes to any transport. */
	readonly deliveryState = MemoryMutationDeliveryStates.ProvenNotSent;

	/** Creates a failure that cannot be mistaken for a successful recall or write. */
	constructor()
	{
		super("Memory gateway is unavailable");
		this.name = "MemoryGatewayUnavailableError";
	}
}

/** Fail-closed adapter used until an authenticated memory-gateway contract is verified. */
export class __UnavailableMemoryGatewayClient implements MemoryGatewayClient
{
	/** Rejects recall rather than returning an empty or fabricated result. */
	async query(_command: MemoryQueryCommand): Promise<MemoryQueryResult>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects personal-memory retention rather than inventing an external identifier or digest. */
	async recordPersonalFact(_command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordReceipt>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects correction because no remote gateway can be contacted. */
	async correct(_command: MemoryCorrectionCommand): Promise<void>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects forgetting because no remote gateway can be contacted. */
	async forget(_command: MemoryForgetCommand): Promise<void>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Rejects scoped recall rather than returning an empty or fabricated result. */
	async recallScoped(_command: ScopedMemoryRecallCommand): Promise<ScopedMemoryRecallResult>
	{
		throw new MemoryGatewayUnavailableError();
	}

	/** Enforces complete provenance first, then rejects the scoped write (no gateway configured). */
	async injectScoped(command: ScopedMemoryInjectionCommand): Promise<void>
	{
		__AssertMemoryProvenanceComplete(command.provenance);
		throw new MemoryGatewayUnavailableError();
	}
}
