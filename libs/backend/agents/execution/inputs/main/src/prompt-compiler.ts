import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import type { CompiledBudget, CompiledRunInput, CompiledToolDefinition, RunInputSnapshot } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { PromptCompilerRepositories } from "./prompt-compiler.types.js";

/**
 * Hydrate an immutable {@link RunInputSnapshot} into the literal {@link CompiledRunInput} the runtime
 * consumes as opaque data.
 *
 * The compiler is a pure, side-effect-free function of the snapshot and the injected read ports: it
 * dereferences persona, message, tool, memory, artifact, and skill records, resolves the model route
 * and literal budget, orders every collection canonically, stamps {@link PROMPT_COMPILER_VERSION},
 * and seals the result with a SHA-256 digest over the canonical payload. Because every referenced
 * record is immutable, the same snapshot always compiles to byte-identical output across restarts.
 *
 * @param snapshot - The immutable input snapshot whose `promptCompilerVersion` must equal this compiler's.
 * @param repositories - Injected control-plane read ports; the compiler itself holds no database.
 * @returns The literal compiled input, digest-sealed and version-stamped.
 */
export async function __CompileRunInput(snapshot: RunInputSnapshot, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	return ___DoWithTrace("prompt_compiler.compile", { runId: snapshot.runId, snapshotDigest: snapshot.digest }, function _compile(): Promise<CompiledRunInput>
	{
		return _compileVerified(snapshot, repositories);
	});
}

/** Add one first-party tool to an already compiled input and reseal its canonical payload. */
export function __AppendCompiledTool(input: CompiledRunInput, tool: CompiledToolDefinition): CompiledRunInput
{
	if (input.tools.some(function _sameTool(existing): boolean { return existing.toolRevisionId === tool.toolRevisionId || existing.name === tool.name; })) throw new Error(`compiled input already contains tool ${tool.name} or revision ${tool.toolRevisionId}`);
	const unsealed = { ...input, tools: _orderTools([...input.tools, tool]) };
	return { ...unsealed, digest: _digest(unsealed) };
}

/** Verify the snapshot's compiler version, then assemble and seal the compiled input. */
async function _compileVerified(snapshot: RunInputSnapshot, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	// 1. Fail closed unless the snapshot was minted for exactly this compiler version.
	if (snapshot.promptCompilerVersion !== PROMPT_COMPILER_VERSION)
	{
		throw new Error(`prompt compiler ${PROMPT_COMPILER_VERSION} cannot compile snapshot version ${snapshot.promptCompilerVersion}`);
	}

	// 2. Dereference every immutable record the literal input needs.
	const personaInstructions = await repositories.loadPersonaInstructions(snapshot.personaRevisionId);
	const messages = await repositories.loadMessages(snapshot.messageIds);
	const tools = _orderTools(await repositories.loadToolDefinitions(snapshot.integrationAssignments));
	const memoryStatements = await repositories.loadMemoryFactStatements(_orderedFactIds(snapshot));
	const artifactSummaries = await repositories.loadArtifactSummaries([...snapshot.artifactRevisionIds].sort());
	const skillSummaries = await repositories.loadSkillSummaries([...snapshot.skillRevisionIds].sort());
	const model = await repositories.resolveModelRoute(snapshot.modelRoute);

	// 3. Assemble instructions and budget deterministically, then seal the payload with its digest.
	const instructions = _assembleInstructions(personaInstructions, memoryStatements, artifactSummaries, skillSummaries);
	const budget = _resolveBudget(snapshot.budgetPolicy);
	const unsealed = { promptCompilerVersion: PROMPT_COMPILER_VERSION, runId: snapshot.runId, attempt: _attempt(snapshot), instructions, messages, tools, model, budget };
	return { ...unsealed, digest: _digest(unsealed) };
}

/** Order tool definitions by name so the compiled set never depends on grant iteration order. */
function _orderTools(tools: readonly CompiledToolDefinition[]): readonly CompiledToolDefinition[]
{
	return [...tools].sort(function _byName(left, right): number { return left.name < right.name ? -1 : left.name > right.name ? 1 : 0; });
}

/** Return the snapshot's memory-fact identifiers ordered canonically for stable statement resolution. */
function _orderedFactIds(snapshot: RunInputSnapshot): readonly string[]
{
	return snapshot.memoryFacts.map(function _factId(reference): string { return reference.factId; }).sort();
}

/** Derive the positive attempt the snapshot compiles for, defaulting to the first attempt. */
function _attempt(snapshot: RunInputSnapshot): number
{
	return Number.isSafeInteger(snapshot.snapshotVersion) && snapshot.snapshotVersion > 0 ? snapshot.snapshotVersion : 1;
}

/** Build the single instructions block from persona text and canonically ordered context sections. */
function _assembleInstructions(personaInstructions: string, memoryStatements: readonly string[], artifactSummaries: readonly string[], skillSummaries: readonly string[]): string
{
	const sections: string[] = [];
	if (personaInstructions.trim().length > 0) sections.push(personaInstructions.trim());
	if (memoryStatements.length > 0) sections.push(`Durable memory available for this run:\n${_bullets(memoryStatements)}`);
	if (artifactSummaries.length > 0) sections.push(`Artifacts available for this run:\n${_bullets(artifactSummaries)}`);
	if (skillSummaries.length > 0) sections.push(`Skills available for this run:\n${_bullets(skillSummaries)}`);
	return sections.join("\n\n");
}

/** Render one canonical bulleted list from already-ordered lines. */
function _bullets(lines: readonly string[]): string
{
	return lines.map(function _bullet(line): string { return `- ${line}`; }).join("\n");
}

/** Resolve the literal aggregate budget from the snapshot's opaque budget policy. */
function _resolveBudget(budgetPolicy: JsonValue): CompiledBudget
{
	const policy: { readonly [key: string]: JsonValue } = budgetPolicy && typeof budgetPolicy === "object" && !Array.isArray(budgetPolicy) ? budgetPolicy as { readonly [key: string]: JsonValue } : {};
	return {
		maxTotalTokens: _optionalCount(policy["maxTotalTokens"]),
		maxCostUsdMicros: _optionalCount(policy["maxCostUsdMicros"]),
		maxToolInvocations: _optionalCount(policy["maxToolInvocations"]),
		wallClockDeadlineEpochMs: _optionalCount(policy["wallClockDeadlineEpochMs"]),
	};
}

/** Read one non-negative safe-integer limit, or null when absent or malformed. */
function _optionalCount(value: JsonValue | undefined): number | null
{
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Seal the compiled payload with a SHA-256 digest over its canonical serialization. */
function _digest(unsealed: Omit<CompiledRunInput, "digest">): `sha256:${string}`
{
	return ___DigestCanonicalJson(unsealed as unknown as JsonValue);
}
