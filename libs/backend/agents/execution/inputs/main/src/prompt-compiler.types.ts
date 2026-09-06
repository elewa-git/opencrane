import type { CompiledMessage, CompiledModelRoute, CompiledToolDefinition, RunInputSnapshotMcpTool } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * Control-plane read ports the deterministic compiler dereferences a snapshot through.
 *
 * The compiler owns no database. The app injects an adapter over the control-plane Prisma
 * transaction (or repositories) that resolves the snapshot's immutable ID references into literal
 * records. Every method reads immutable revisions only, so a resolved value never changes for a
 * given identifier and the compiled output stays byte-identical across restarts.
 */
/**
 * Supplies canonical decrypted conversation messages without exposing history or cipher mechanics.
 *
 * Called by: `__CompileRunInput` through `PromptCompilerRepositories`.
 * @see VerifiedConversationPromptMessageRepository for exact-set enforcement.
 */
export interface ConversationPromptMessageRepository
{
	/**
	 * Resolve every snapshot identifier through canonical Kurrent order and encrypted private payload storage.
	 * Implementations must reject a missing, repeated, reordered, foreign, or undecryptable message rather than
	 * returning partial prompt context.
	 */
	loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]>;
}

/**
 * Pairs one canonical decrypted message with the immutable history identifier that selected it.
 *
 * Called by: `ConversationPromptMessageSource` implementations and their exact-set verifier.
 * @see ConversationPromptMessageRepository for the narrower compiler-facing projection.
 */
export interface ConversationPromptMessageRead
{
	/** Immutable message identifier read from durable conversation history. */
	readonly messageId: string;
	/** Canonical role and decrypted literal content supplied to the prompt compiler. */
	readonly message: CompiledMessage;
}

/**
 * Lets the conversation owner resolve encrypted history entries without granting it prompt-order authority.
 *
 * Called by: `VerifiedConversationPromptMessageRepository` in application composition.
 * @see ConversationPromptMessageRead for the identity-preserving source result.
 */
export interface ConversationPromptMessageSource
{
	/** Resolve the requested identifiers or throw when history or private payload authority is unavailable. */
	load(messageIds: readonly string[]): Promise<readonly ConversationPromptMessageRead[]>;
}

/** Control-plane repositories that resolve every immutable reference named by one run snapshot. */
export interface PromptCompilerRepositories extends ConversationPromptMessageRepository
{
	/** Resolve the approved persona revision's compiled instruction text, or empty when non-personal. */
	loadPersonaInstructions(personaRevisionId: string | null): Promise<string>;
	/**
	 * Resolve the tool schemas from the MCP tool revisions selected by the saved agent revision.
	 *
	 * The returned order is not significant: the compiler re-sorts tool definitions by name before
	 * sealing the compiled output, so grant/repository iteration order can never change the compiled
	 * payload or its digest.
	 */
	loadToolDefinitions(mcpTools: readonly RunInputSnapshotMcpTool[]): Promise<readonly CompiledToolDefinition[]>;
	/** Resolve one-line availability summaries for the immutable artifact revisions offered to the run. */
	loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]>;
	/** Resolve one-line availability summaries for the immutable skill revisions offered to the run. */
	loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]>;
	/** Resolve the exact frozen model definition within the snapshot's trusted silo. */
	resolveModelRoute(siloId: string, modelRoute: JsonValue): Promise<CompiledModelRoute>;
}
