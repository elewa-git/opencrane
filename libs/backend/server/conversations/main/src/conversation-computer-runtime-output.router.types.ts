import type { ConversationComputerRuntimeOutputCommand, ConversationComputerRuntimeOutputResult } from "./conversation-computers/conversation-computer-runtime-output-authority.types";
import type { ConversationComputerRuntimeAdmissionDependencies } from "./conversation-computer-runtime-admission.types";

/**
 * Records one admitted Sandbox output against server-derived computer execution coordinates.
 *
 * An implementation may reject stale, foreign, completed, or changed commands. The route maps
 * every rejection to its uniform denial response rather than exposing the durable command state.
 */
export interface ConversationComputerRuntimeOutputAuthorityPort
{
	/** Stores and publishes one command-owned output, or rejects every stale or foreign command. */
	record(command: ConversationComputerRuntimeOutputCommand): Promise<ConversationComputerRuntimeOutputResult>;
}

/**
 * Binds the Sandbox output route to shared admission and its atomic output authority.
 *
 * The inherited admission dependencies authenticate the Pod and derive the active execution;
 * `authority` receives those values instead of caller-supplied author, conversation, or lease data.
 */
export interface ConversationComputerRuntimeOutputRouterDependencies extends ConversationComputerRuntimeAdmissionDependencies
{
	/** Writes one validated runtime output through its durable command and conversation authority. */
	readonly authority: ConversationComputerRuntimeOutputAuthorityPort;
}
