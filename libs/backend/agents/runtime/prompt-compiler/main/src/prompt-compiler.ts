import { createHash } from "node:crypto";

import type { CompiledBudget, CompiledRunInput, CompiledToolDefinition, RunInputSnapshot } from "@opencrane/contracts";
import { ___CanonicalizeJson } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";
import { ___DoWithTrace } from "@opencrane/observability";

import type { PromptCompilerRepositories } from "./prompt-compiler.types.js";

/**
 * Deterministic prompt-compiler version. Bump on any change to compiled-output assembly so a
 * snapshot compiled by one version is never silently consumed by another. Every snapshot declares
 * the version its compiler must match; a mismatch fails closed.
 */
export const PROMPT_COMPILER_VERSION = "opencrane.prompt-compiler/2026-07-21.1";

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
 * @param attempt - Positive AgentRun attempt the input is sealed for; it is not the snapshot schema version.
 * @param repositories - Injected control-plane read ports; the compiler itself holds no database.
 * @returns The literal compiled input, digest-sealed and version-stamped.
 */
export async function __CompileRunInput(snapshot: RunInputSnapshot, attempt: number, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	return ___DoWithTrace("prompt_compiler.compile", { runId: snapshot.runId, snapshotDigest: snapshot.digest }, function _compile(): Promise<CompiledRunInput>
	{
		return _compileVerified(snapshot, attempt, repositories);
	});
}

/** Add one first-party tool to an already compiled input and reseal its canonical payload. */
export function __AppendCompiledTool(input: CompiledRunInput, tool: CompiledToolDefinition): CompiledRunInput
{
	if (input.tools.some(function _sameTool(existing): boolean { return existing.toolRevisionId === tool.toolRevisionId || existing.name === tool.name; })) throw new Error(`compiled input already contains tool ${tool.name} or revision ${tool.toolRevisionId}`);
	const unsealed = { ...input, tools: _orderTools([...input.tools, tool]) };
	return { ...unsealed, digest: _digest(unsealed) };
}

/** Verify that an untrusted persisted value is a complete, digest-sealed compiled runtime input. */
export function __VerifyCompiledRunInput(value: unknown): CompiledRunInput | null
{
	if (!_isCompiledRunInput(value)) return null;
	const input = value as CompiledRunInput;
	const { digest, ...unsealed } = input;
	return _digest(unsealed) === digest ? input : null;
}

/** Verify the snapshot's compiler version, then assemble and seal the compiled input. */
async function _compileVerified(snapshot: RunInputSnapshot, attempt: number, repositories: PromptCompilerRepositories): Promise<CompiledRunInput>
{
	// 1. Fail closed unless the snapshot was minted for exactly this compiler version.
	if (snapshot.promptCompilerVersion !== PROMPT_COMPILER_VERSION || !Number.isSafeInteger(attempt) || attempt < 1)
	{
		throw new Error(`prompt compiler ${PROMPT_COMPILER_VERSION} requires its own snapshot version and a positive run attempt`);
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
	const unsealed = { promptCompilerVersion: PROMPT_COMPILER_VERSION, runId: snapshot.runId, attempt, instructions, messages, tools, model, budget };
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
		maxModelTurns: _optionalCount(policy["maxModelTurns"]),
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
	return `sha256:${createHash("sha256").update(___CanonicalizeJson(unsealed as unknown as JsonValue), "utf8").digest("hex")}`;
}

/** Return whether a value has every required compiled-input coordinate and nested wire shape. */
function _isCompiledRunInput(value: unknown): value is CompiledRunInput
{
	if (!_isRecord(value) || typeof value["promptCompilerVersion"] !== "string" || typeof value["runId"] !== "string" || !Number.isSafeInteger(value["attempt"]) || (value["attempt"] as number) < 1 || typeof value["instructions"] !== "string" || typeof value["digest"] !== "string") return false;
	return Array.isArray(value["messages"]) && value["messages"].every(_isCompiledMessage)
		&& Array.isArray(value["tools"]) && value["tools"].every(_isCompiledTool)
		&& _isCompiledModelRoute(value["model"])
		&& _isCompiledBudget(value["budget"]);
}

/** Return whether a value is the exact literal shape accepted for one compiled conversation turn. */
function _isCompiledMessage(value: unknown): boolean
{
	if (!_isRecord(value)) return false;
	return (value["role"] === "system" || value["role"] === "user" || value["role"] === "assistant" || value["role"] === "tool") && typeof value["content"] === "string";
}

/** Return whether a value is one complete resolved tool definition with JSON-safe parameters. */
function _isCompiledTool(value: unknown): boolean
{
	return _isRecord(value) && typeof value["name"] === "string" && typeof value["toolRevisionId"] === "string" && typeof value["description"] === "string" && typeof value["requiresApproval"] === "boolean" && _isJsonValue(value["parametersSchema"]);
}

/** Return whether a value is the credential-free resolved model route the runtime can consume. */
function _isCompiledModelRoute(value: unknown): boolean
{
	return _isRecord(value) && typeof value["modelAlias"] === "string" && _isOptionalCount(value["maxOutputTokens"]);
}

/** Return whether a value carries every bounded aggregate budget field. */
function _isCompiledBudget(value: unknown): boolean
{
	return _isRecord(value)
		&& _isOptionalCount(value["maxModelTurns"])
		&& _isOptionalCount(value["maxTotalTokens"])
		&& _isOptionalCount(value["maxCostUsdMicros"])
		&& _isOptionalCount(value["maxToolInvocations"])
		&& _isOptionalCount(value["wallClockDeadlineEpochMs"]);
}

/** Return whether a value is a nullable non-negative safe-integer budget or output limit. */
function _isOptionalCount(value: unknown): boolean
{
	return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** Return whether a value is a plain record rather than an array or primitive. */
function _isRecord(value: unknown): value is Record<string, unknown>
{
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Return whether a value can be persisted without executable or undefined JavaScript members. */
function _isJsonValue(value: unknown): value is JsonValue
{
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(_isJsonValue);
	if (!_isRecord(value)) return false;
	return Object.values(value).every(_isJsonValue);
}
