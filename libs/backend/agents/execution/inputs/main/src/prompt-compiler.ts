import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import type { CompiledBudget, CompiledRunInput, CompiledToolDefinition, RunInputSnapshot } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { PromptCompilerRepositories } from "./prompt-compiler.types.js";

/**
 * Turn an immutable {@link RunInputSnapshot} into the {@link CompiledRunInput} the runtime consumes
 * as opaque data.
 *
 * The compiler has no side effects: its output depends only on the snapshot and the injected read
 * ports. It looks up the persona, message, tool, memory, artifact, and skill records, resolves the
 * model route and the budget numbers, sorts every list into a fixed order, stamps
 * {@link PROMPT_COMPILER_VERSION}, and hashes the result into a SHA-256 digest over the canonical
 * JSON. Because every record it reads is immutable, the same snapshot always compiles to
 * byte-identical output across restarts.
 *
 * That last property is what makes a re-delivered `start_attempt` frame safe: the runtime can be
 * sent the compiled input twice and get identical bytes both times.
 *
 * Called by: `__CreatePrismaRunInputCompiler` (execution/protocol/src/prisma-run-input-compiler.ts),
 * which is the only caller and reaches the runtime through
 * `_CreateProductionRunInputCompiler` in execution/protocol/src/production-runtime-dispatch.ts.
 *
 * @param snapshot - The immutable input snapshot whose `promptCompilerVersion` must equal this compiler's.
 * @param repositories - Injected control-plane read ports; the compiler itself holds no database.
 * Bind them to the transaction that loaded the snapshot, or the reads may not be of the same rows.
 * @returns The compiled input, with `promptCompilerVersion` stamped and `digest` set over its
 * canonical JSON.
 * @throws When `snapshot.promptCompilerVersion` is not this compiler's version. The snapshot was
 * minted by a different compiler and must not be compiled here — a version mismatch means the
 * prompt shape has changed, so the run has to be re-admitted rather than compiled.
 * @throws Whatever a read port throws, including the digest mismatch
 * {@link PromptCompilerRepositories.loadMemoryFactStatements} is required to raise.
 * @see PromptCompilerRepositories
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation the
 * output digest is taken over. It is why sorting the lists above is required rather than tidy: the
 * scheme fixes object key order, but array order is the caller's job.
 */
export async function __CompileRunInput(snapshot: RunInputSnapshot, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	return ___DoWithTrace("prompt_compiler.compile", { runId: snapshot.runId, snapshotDigest: snapshot.digest }, function _compile(): Promise<CompiledRunInput>
	{
		return _compileVerified(snapshot, repositories);
	});
}

/**
 * Add one first-party tool to an already compiled input and recompute its digest.
 *
 * Used for tools OpenCrane itself offers, which are not part of any integration assignment and so
 * are not in the snapshot. The digest is recomputed so the returned input stays self-consistent —
 * appending without resealing would leave a digest that no longer matches the payload.
 *
 * Called by: `_CreateProductionRunInputCompiler`
 * (execution/protocol/src/production-runtime-dispatch.ts), which appends the upgrade-session tool
 * after proving in the same transaction that the run belongs to a personal AgentService.
 *
 * @param input - An already compiled run input. Not modified; a new object is returned.
 * @param tool - The first-party tool to add.
 * @returns A new compiled input with the tool included, tools re-sorted by name, and a fresh digest.
 * @throws When `input` already contains a tool with the same `name` or the same `toolRevisionId`.
 * Duplicate tool names would make the runtime's tool selection ambiguous, so this fails loudly
 * rather than picking one.
 * @see __CompileRunInput
 */
export function __AppendCompiledTool(input: CompiledRunInput, tool: CompiledToolDefinition): CompiledRunInput
{
	if (input.tools.some(function _sameTool(existing): boolean { return existing.toolRevisionId === tool.toolRevisionId || existing.name === tool.name; })) throw new Error(`compiled input already contains tool ${tool.name} or revision ${tool.toolRevisionId}`);
	const unsealed = { ...input, tools: _orderTools([...input.tools, tool]) };
	return { ...unsealed, digest: _digest(unsealed) };
}

/** Checks the snapshot's compiler version, then builds the compiled input and digests it. */
async function _compileVerified(snapshot: RunInputSnapshot, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	// 1. Fail closed unless the snapshot was minted for exactly this compiler version.
	if (snapshot.promptCompilerVersion !== PROMPT_COMPILER_VERSION)
	{
		throw new Error(`prompt compiler ${PROMPT_COMPILER_VERSION} cannot compile snapshot version ${snapshot.promptCompilerVersion}`);
	}

	// 2. Look up every record the compiled input needs.
	const personaInstructions = await repositories.loadPersonaInstructions(snapshot.personaRevisionId);
	const messages = await repositories.loadMessages(snapshot.messageIds);
	const tools = _orderTools(await repositories.loadToolDefinitions(snapshot.integrationAssignments));
	const memoryStatements = await repositories.loadMemoryFactStatements(_orderedFacts(snapshot));
	const artifactSummaries = await repositories.loadArtifactSummaries([...snapshot.artifactRevisionIds].sort());
	const skillSummaries = await repositories.loadSkillSummaries([...snapshot.skillRevisionIds].sort());
	const model = await repositories.resolveModelRoute(snapshot.modelRoute);

	// 3. Build the instructions and budget the same way every time, then add the digest.
	const instructions = _assembleInstructions(personaInstructions, memoryStatements, artifactSummaries, skillSummaries);
	const budget = _resolveBudget(snapshot.budgetPolicy);
	const unsealed = { promptCompilerVersion: PROMPT_COMPILER_VERSION, runId: snapshot.runId, attempt: _attempt(snapshot), instructions, messages, tools, model, budget };
	return { ...unsealed, digest: _digest(unsealed) };
}

/**
 * Order tool definitions by name so the compiled set never depends on grant iteration order.
 *
 * Two callers rely on this: the initial compile, and `__AppendCompiledTool`, which re-sorts after adding
 * a first-party tool so an appended tool lands in the same place every time.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation the
 * compiled digest is taken over. It fixes object key order but not array order, so without this sort the
 * same tools arriving in a different order would digest differently.
 */
function _orderTools(tools: readonly CompiledToolDefinition[]): readonly CompiledToolDefinition[]
{
	return [...tools].sort(function _byName(left, right): number { return _compareText(left.name, right.name); });
}

/**
 * Returns the snapshot's memory-fact references sorted by factId, so lookups always run in the same
 * order.
 *
 * The order matters beyond tidiness: `loadMemoryFactStatements` is contractually given its references
 * sorted, and returns statements in that same order, so the prompt text depends on this sort.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation the
 * compiled digest is taken over. It fixes object key order but leaves array order to the caller, which
 * is why this sort exists rather than being implied.
 */
function _orderedFacts(snapshot: RunInputSnapshot): RunInputSnapshot["memoryFacts"]
{
	return [...snapshot.memoryFacts].sort(function _byFactId(left, right): number { return _compareText(left.factId, right.factId); });
}

/** Compare two canonical text identifiers without locale-dependent ordering. */
function _compareText(left: string, right: string): number
{
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

/** Returns the attempt number this snapshot compiles for, falling back to 1. */
function _attempt(snapshot: RunInputSnapshot): number
{
	return Number.isSafeInteger(snapshot.snapshotVersion) && snapshot.snapshotVersion > 0 ? snapshot.snapshotVersion : 1;
}

/** Builds the one instructions block from the persona text plus the already-sorted context sections. */
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

/** Reads the budget numbers out of the snapshot's JSON budget policy. */
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

/**
 * Returns the SHA-256 digest of the compiled payload's canonical JSON.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation
 * `___DigestCanonicalJson` hashes. It is what makes the digest reproducible across processes: the
 * same payload serialises to the same bytes regardless of the order its keys were inserted in.
 */
function _digest(unsealed: Omit<CompiledRunInput, "digest">): `sha256:${string}`
{
	return ___DigestCanonicalJson(unsealed as unknown as JsonValue);
}
