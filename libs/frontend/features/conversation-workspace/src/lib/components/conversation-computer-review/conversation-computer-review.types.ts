/**
 * Carries participant-selected localhost inputs from the review component to its store-backed owner.
 *
 * The server validates both fields against its release allowlist and path policy; this browser value
 * contains no sandbox address or lease credential.
 */
export interface ConversationComputerLocalhostIntent
{
	/** Release-allowlisted localhost port. */
	readonly port: number;
	/** Relative page path. */
	readonly path: string;
}
