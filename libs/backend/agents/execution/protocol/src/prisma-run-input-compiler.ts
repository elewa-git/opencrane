import type { Prisma } from "@prisma/client";

import { GeneratedOutputCapability, type CompiledMessage, type CompiledModelRoute, type CompiledRunInput, type CompiledToolDefinition, type RunInputSnapshot, type RunInputSnapshotIntegrationAssignment } from "@opencrane/contracts";
import { __AreReviewedIntegrationToolDefinitionsValid, type ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";
import { __CompileRunInput } from "@opencrane/backend/agents/execution/inputs";
import type { PromptCompilerRepositories } from "@opencrane/backend/agents/execution/inputs";

import { ExternalActionRevisionKinds } from "./external-action-executor.types.js";
import type { RunInputCompiler } from "./prisma-runtime-dispatch-authority.types.js";

/** Maps stored message roles to the lowercase roles the compiled input uses. */
const _MESSAGE_ROLE: Record<string, CompiledMessage["role"]> = { User: "user", Assistant: "assistant", Tool: "tool", System: "system" };

/**
 * Build the {@link RunInputCompiler} the dispatch authority calls when it creates `start_attempt`.
 *
 * It binds the deterministic prompt compiler to control-plane read ports backed by the same locked
 * Prisma transaction that loaded the snapshot, so every read is of an immutable record and the
 * compiled output stays byte-identical across restarts and idempotent redeliveries. Personal-memory
 * query coordinates remain outside the compiled payload; recall can begin only through the declared
 * memory tool after its exact elicitation receipt is accepted.
 * @returns A compiler bound only to per-attempt transaction reads.
 */
export function __CreatePrismaRunInputCompiler(): RunInputCompiler
{
	return function _compile(snapshot: RunInputSnapshot, attempt: number, transaction: Prisma.TransactionClient): Promise<CompiledRunInput>
	{
		return __CompileRunInput(snapshot, attempt, _repositories(transaction));
	};
}

/** Assemble the control-plane read ports over one locked transaction client. */
function _repositories(transaction: Prisma.TransactionClient): PromptCompilerRepositories
{
	return {
		loadPersonaInstructions(personaRevisionId: string | null): Promise<string> { return _loadPersonaInstructions(transaction, personaRevisionId); },
		loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]> { return _loadMessages(transaction, messageIds); },
		loadToolDefinitions(integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[]): Promise<readonly CompiledToolDefinition[]> { return _loadToolDefinitions(integrationAssignments); },
		loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadArtifactSummaries(transaction, artifactRevisionIds); },
		loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadSkillSummaries(transaction, skillRevisionIds); },
		resolveModelRoute(modelRoute: JsonValue): Promise<CompiledModelRoute> { return _resolveModelRoute(transaction, modelRoute); },
	};
}

/** Resolve the approved persona revision's compiled instruction text, or empty when non-personal. */
async function _loadPersonaInstructions(transaction: Prisma.TransactionClient, personaRevisionId: string | null): Promise<string>
{
	if (personaRevisionId === null) return "";
	const revision = await transaction.personaRevision.findUnique({ where: { id: personaRevisionId } });
	return revision?.compiledInstructions ?? "";
}

/** Load the conversation messages, keeping the order the snapshot lists them in. */
async function _loadMessages(transaction: Prisma.TransactionClient, messageIds: readonly string[]): Promise<readonly CompiledMessage[]>
{
	if (messageIds.length === 0) return [];
	const rows = await transaction.conversationMessage.findMany({ where: { id: { in: [...messageIds] } } });
	const byId = new Map(rows.map(function _entry(row) { return [row.id, row] as const; }));
	const compiled: CompiledMessage[] = [];
	for (const id of messageIds)
	{
		const row = byId.get(id);
		if (row) compiled.push({ role: _MESSAGE_ROLE[row.role] ?? "user", content: _messageContent(row.blocks) });
	}
	return compiled;
}

/** Flatten a message's block payload into deterministic plain text for the compiled prompt. */
function _messageContent(blocks: Prisma.JsonValue): string
{
	if (typeof blocks === "string") return blocks;
	if (!Array.isArray(blocks)) return "";
	const parts: string[] = [];
	for (const block of blocks)
	{
		if (typeof block === "string") parts.push(block);
		else if (block && typeof block === "object" && !Array.isArray(block) && typeof block["text"] === "string") parts.push(block["text"]);
	}
	return parts.join("\n");
}

/**
 * Resolve immutable integration allowances into compiled tool definitions the bounded loop may propose.
 *
 * Each tool keeps an `integration:<id>:<tool>` revision id while receiving a provider-safe,
 * collision-resistant model-visible name. The exact revision id reaches the external-action boundary, which independently rechecks its
 * live custody reference and the revision's allow-list. Third-party actions require an approval
 * until an explicit per-tool approval policy exists. Schema and digest come only from the admitted
 * snapshot; compilation never consults a mutable catalogue or synthesises a permissive fallback.
 */
async function _loadToolDefinitions(integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[]): Promise<readonly CompiledToolDefinition[]>
{
	const tools: CompiledToolDefinition[] = [];
	for (const assignment of integrationAssignments)
	{
		if (!__AreReviewedIntegrationToolDefinitionsValid(assignment.toolDefinitions as readonly ReviewedIntegrationToolDefinition[])) throw new Error("snapshot integration tool definitions are invalid");
		for (const tool of assignment.toolDefinitions)
		{
			// One definition per allowed tool. How to reach the provider is decided later, on the server.
			const toolRevisionId = `${ExternalActionRevisionKinds.Integration}:${assignment.integrationId}:${tool.name}`;
			tools.push({ name: _modelToolName(toolRevisionId), toolRevisionId, description: tool.description, requiresApproval: true, parametersSchema: ___CloneCanonicalJson(tool.parametersSchema), parametersSchemaDigest: tool.parametersSchemaDigest });
		}
	}
	if (new Set(tools.map(function _Name(tool): string { return tool.name; })).size !== tools.length) throw new Error("compiled model-visible tool names collide");
	return tools;
}

/** Derive a readable provider-safe name while retaining a digest suffix for collision resistance. */
function _modelToolName(toolRevisionId: string): string
{
	const digestSuffix = ___DigestCanonicalJson(toolRevisionId).slice("sha256:".length, "sha256:".length + 12);
	const readable = toolRevisionId.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
	return `${readable.slice(0, 51)}_${digestSuffix}`;
}

/** Resolve one-line availability summaries for the immutable artifact revisions offered to the run. */
async function _loadArtifactSummaries(transaction: Prisma.TransactionClient, artifactRevisionIds: readonly string[]): Promise<readonly string[]>
{
	if (artifactRevisionIds.length === 0) return [];
	const rows = await transaction.artifactRevision.findMany({ where: { id: { in: [...artifactRevisionIds] } } });
	return rows.map(function _summary(row) { return `${row.mediaType} artifact ${row.id}`; }).sort();
}

/** Build a one-line summary for each skill revision offered to the run. */
async function _loadSkillSummaries(transaction: Prisma.TransactionClient, skillRevisionIds: readonly string[]): Promise<readonly string[]>
{
	if (skillRevisionIds.length === 0) return [];
	const rows = await transaction.skillRevision.findMany({ where: { id: { in: [...skillRevisionIds] } } });
	return rows.map(function _summary(row) { return `skill ${row.skillId} revision ${row.id}`; }).sort();
}

/** Turn the snapshot's model route into a model name and an output-token limit; never a credential. */
async function _resolveModelRoute(transaction: Prisma.TransactionClient, modelRoute: JsonValue): Promise<CompiledModelRoute>
{
	const route: { readonly [key: string]: JsonValue } = modelRoute && typeof modelRoute === "object" && !Array.isArray(modelRoute) ? modelRoute as { readonly [key: string]: JsonValue } : {};
	const publicModelName = typeof route["publicModelName"] === "string" ? route["publicModelName"] : "";
	const requested = typeof route["alias"] === "string" ? route["alias"] : publicModelName;
	const maxOutputTokens = typeof route["maxOutputTokens"] === "number" && Number.isSafeInteger(route["maxOutputTokens"]) && route["maxOutputTokens"] > 0 ? route["maxOutputTokens"] : null;
	const definition = requested.length > 0 ? await transaction.modelDefinition.findFirst({ where: { publicModelName: requested } }) : null;
	const generatedOutputCapabilities = definition?.generatedOutputCapabilities.filter(function _SupportedCapability(capability): capability is GeneratedOutputCapability { return capability === GeneratedOutputCapability.ImagePng || capability === GeneratedOutputCapability.CodeExecutionFiles; }) ?? [];
	return { modelAlias: definition?.publicModelName ?? requested, maxOutputTokens, generatedOutputCapabilities };
}
