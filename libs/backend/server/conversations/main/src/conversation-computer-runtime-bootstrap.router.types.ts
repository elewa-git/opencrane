/**
 * Returns the execution coordinates released to a Sandbox after its reviewed Pod identity matches
 * the active lease.
 *
 * The response contains server-derived identifiers and the lease generation that later commands
 * must fence against. It contains neither identity credentials nor a caller-selected execution.
 */
export interface ConversationComputerRuntimeBootstrapResponse
{
	/** Names the computer that owns this active execution. */
	readonly computerId: string;
	/** Names the conversation whose computer execution was admitted. */
	readonly conversationId: string;
	/** Names the server-created execution the Sandbox may bootstrap. */
	readonly executionId: string;
	/** Carries the generation that fences commands from an earlier Sandbox lease. */
	readonly leaseGeneration: number;
}
