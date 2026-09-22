import { PROMPT_COMPILER_VERSION, RUN_INPUT_SNAPSHOT_VERSION } from "@opencrane/contracts";
import { ___ParseRunBudgetPolicy, type CompiledRunInput, type CompiledToolDefinition, type RunInputSnapshot } from "@opencrane/contracts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _IsModelToolNameValid } from "./mcp-model-tool-name";
import type { PromptCompilerRepositories } from "./prompt-compiler.types";

/**
 * Turn an immutable {@link RunInputSnapshot} into the {@link CompiledRunInput} the runtime consumes
 * as opaque data.
 *
 * The compiler is a pure, side-effect-free function of the snapshot and the injected read ports: it
 * dereferences persona, message, tool, artifact, and skill records, resolves the model route
 * and literal budget, orders every collection canonically, stamps {@link PROMPT_COMPILER_VERSION},
 * and seals the result with a SHA-256 digest over the canonical payload. Because every referenced
 * record is immutable, the same snapshot and live-attempt pair always compiles to byte-identical
 * output across restarts. Both the prompt compiler and snapshot schema versions are dispatch
 * prerequisites; neither is inferred or upgraded during recovery.
 *
 * @param snapshot - The immutable input snapshot whose `promptCompilerVersion` must equal this compiler's.
 * @param attempt - Authoritative live attempt supplied by the fenced dispatch context.
 * @param repositories - Injected control-plane read ports; the compiler itself holds no database.
 * Bind them to the transaction that loaded the snapshot, or the reads may not be of the same rows.
 * @returns The compiled input, with `promptCompilerVersion` stamped and `digest` set over its
 * canonical JSON.
 * @throws When `snapshot.promptCompilerVersion` is not this compiler's version. The snapshot was
 * minted by a different compiler and must not be compiled here — a version mismatch means the
 * prompt shape has changed, so the run has to be re-admitted rather than compiled.
 * @throws Whatever an immutable-record read port raises.
 * @see PromptCompilerRepositories
 * @see https://www.rfc-editor.org/rfc/rfc8785 - JSON Canonicalization Scheme, the serialisation the
 * output digest is taken over. It is why sorting the lists above is required rather than tidy: the
 * scheme fixes object key order, but array order is the caller's job.
 */
export async function __CompileRunInput(snapshot: RunInputSnapshot, attempt: number, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	return ___DoWithTrace("prompt_compiler.compile", { runId: snapshot.runId, attempt, snapshotDigest: snapshot.digest }, function _compile(): Promise<CompiledRunInput>
	{
		return _compileVerified(snapshot, attempt, repositories);
	});
}

/**
 * Add one first-party tool to an already compiled input and recompute its digest.
 *
 * Used for tools OpenCrane itself offers, which the saved agent revision does not select and so are
 * not in the snapshot. The digest is recomputed so the returned input stays self-consistent —
 * appending without resealing would leave a digest that no longer matches the payload.
 *
 * Called by: production run-input composition, which appends the upgrade-session tool after proving
 * in the same transaction that the run belongs to a personal AgentService.
 *
 * @param input - An already compiled run input. Not modified; a new object is returned.
 * @param tool - The first-party tool to add.
 * @returns A new compiled input with the tool included, tools re-sorted by model name, and a fresh digest.
 * @throws When `input` already contains the same revision or provider-facing model name.
 * @see __CompileRunInput
 */
export function __AppendCompiledTool(input: CompiledRunInput, tool: CompiledToolDefinition): CompiledRunInput
{
	if (input.tools.some(function _sameTool(existing): boolean { return existing.toolRevisionId === tool.toolRevisionId || existing.modelName === tool.modelName; }))
		throw new Error(`compiled input already contains model tool ${tool.modelName} or revision ${tool.toolRevisionId}`);
	const unsealed = { ...input, tools: _orderTools([...input.tools, tool]) };
	return { ...unsealed, digest: _digest(unsealed) };
}

/** Verify the snapshot's compiler version, then assemble and seal the compiled input. */
async function _compileVerified(snapshot: RunInputSnapshot, attempt: number, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	// 1. Fail closed unless the snapshot was minted for exactly this compiler version.
	if (snapshot.promptCompilerVersion !== PROMPT_COMPILER_VERSION)
	{
		throw new Error(`prompt compiler ${PROMPT_COMPILER_VERSION} cannot compile snapshot version ${snapshot.promptCompilerVersion}`);
	}
	if (snapshot.snapshotVersion !== RUN_INPUT_SNAPSHOT_VERSION)
	{
		throw new Error(`prompt compiler ${PROMPT_COMPILER_VERSION} cannot compile run-input snapshot schema ${snapshot.snapshotVersion}`);
	}
	if (!Number.isSafeInteger(snapshot.attempt) || snapshot.attempt < 1)
	{
		throw new Error("prompt compiler requires a positive snapshot attempt");
	}
	if (attempt !== snapshot.attempt)
	{
		throw new Error("prompt compiler requires the live attempt to match the immutable snapshot attempt");
	}

	// 2. Look up every record the compiled input needs.
	const personaInstructions = await repositories.loadPersonaInstructions(snapshot.personaRevisionId);
	const messages = await repositories.loadMessages(snapshot.messageIds);
	const tools = _orderTools(await repositories.loadToolDefinitions(snapshot.mcpTools));
	const artifactSummaries = await repositories.loadArtifactSummaries([...snapshot.artifactRevisionIds].sort());
	const skillSummaries = await repositories.loadSkillSummaries([...snapshot.skillRevisionIds].sort());
	const model = await repositories.resolveModelRoute(snapshot.siloId, snapshot.modelRoute);

	// 3. Assemble instructions and budget deterministically, then seal the payload with its digest.
	const instructions = _assembleInstructions(personaInstructions, artifactSummaries, skillSummaries);
	const budget = ___ParseRunBudgetPolicy(snapshot.budgetPolicy);
	const unsealed = { promptCompilerVersion: PROMPT_COMPILER_VERSION, runId: snapshot.runId, attempt: snapshot.attempt, instructions, messages, tools, model, budget };
	return { ...unsealed, digest: _digest(unsealed) };
}

/**
 * Validate and order tool definitions by model name so the compiled set never depends on grant iteration order.
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
	const revisionIds = new Set<string>();
	const modelNames = new Set<string>();
	for (const tool of tools)
	{
		if (!_IsModelToolNameValid(tool.modelName) || tool.toolRevisionId.trim().length === 0 || revisionIds.has(tool.toolRevisionId) || modelNames.has(tool.modelName))
			throw new Error("compiled tool definitions require valid unique model names and revision identifiers");
		revisionIds.add(tool.toolRevisionId);
		modelNames.add(tool.modelName);
	}
	return [...tools].sort(function _byModelName(left, right): number { return _compareText(left.modelName, right.modelName); });
}

/** Compare two canonical text identifiers without locale-dependent ordering. */
function _compareText(left: string, right: string): number
{
	if (left < right)
		return -1;
	if (left > right)
		return 1;
	return 0;
}

/** Build the single instructions block from persona text and canonically ordered context sections. */
function _assembleInstructions(personaInstructions: string, artifactSummaries: readonly string[], skillSummaries: readonly string[]): string
{
	const sections: string[] = [];
	if (personaInstructions.trim().length > 0)
		sections.push(personaInstructions.trim());
	if (artifactSummaries.length > 0)
		sections.push(`Artifacts available for this run:\n${_bullets(artifactSummaries)}`);
	if (skillSummaries.length > 0)
		sections.push(`Skills available for this run:\n${_bullets(skillSummaries)}`);
	return sections.join("\n\n");
}

/** Render one canonical bulleted list from already-ordered lines. */
function _bullets(lines: readonly string[]): string
{
	return lines.map(function _bullet(line): string { return `- ${line}`; }).join("\n");
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
