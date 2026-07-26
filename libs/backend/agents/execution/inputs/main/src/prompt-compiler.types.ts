import type { CompiledMessage, CompiledModelRoute, CompiledToolDefinition } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

/**
 * Control-plane read ports the deterministic compiler dereferences a snapshot through.
 *
 * The compiler owns no database. The app injects an adapter over the control-plane Prisma
 * transaction (or repositories) that resolves the snapshot's immutable ID references into literal
 * records. Every method reads immutable revisions only, so a resolved value never changes for a
 * given identifier and the compiled output stays byte-identical across restarts.
 */
export interface PromptCompilerRepositories
{
	/** Resolve the approved persona revision's compiled instruction text, or empty when non-personal. */
	loadPersonaInstructions(personaRevisionId: string | null): Promise<string>;
	/** Resolve ordered conversation turns for the exact message references, preserving snapshot order. */
	loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]>;
	/**
	 * Resolve the tool schemas exposed by the immutable tool grants for the executed revision.
	 *
	 * The returned order is not significant: the compiler re-sorts tool definitions by name before
	 * sealing the compiled output, so grant/repository iteration order can never change the compiled
	 * payload or its digest.
	 */
	loadToolDefinitions(toolGrantIds: readonly string[]): Promise<readonly CompiledToolDefinition[]>;
	/** Resolve durable memory-fact statements included in the prompt for the given references. */
	loadMemoryFactStatements(memoryFactIds: readonly string[]): Promise<readonly string[]>;
	/** Resolve one-line availability summaries for the immutable artifact revisions offered to the run. */
	loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]>;
	/** Resolve one-line availability summaries for the immutable skill revisions offered to the run. */
	loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]>;
	/** Resolve the model route without provider credentials for the snapshot's server-selected route. */
	resolveModelRoute(modelRoute: JsonValue): Promise<CompiledModelRoute>;
}
