import { __AssertMemoryProvenanceComplete } from "./memory-provenance.js";
import type { MemoryCorrectionCommand, MemoryForgetCommand, MemoryGatewayClient, MemoryQueryCommand, MemoryQueryResult, PersonalMemoryRecordCommand, PersonalMemoryRecordResult, ScopedMemoryInjectionCommand, ScopedMemoryRecallCommand, ScopedMemoryRecallResult } from "./memory-gateway-client.types.js";

/** Typed failure emitted when no authenticated memory-gateway transport is configured. */
export class MemoryGatewayUnavailableError extends Error
{
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
	async recordPersonalFact(_command: PersonalMemoryRecordCommand): Promise<PersonalMemoryRecordResult>
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
