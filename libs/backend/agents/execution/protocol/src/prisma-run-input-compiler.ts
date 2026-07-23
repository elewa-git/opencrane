import type { Prisma } from "@prisma/client";

import type { CompiledMessage, CompiledModelRoute, CompiledRunInput, CompiledToolDefinition, RunInputSnapshot } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { __CompileRunInput } from "@opencrane/backend/agents/runtime/prompt-compiler";
import type { PromptCompilerRepositories } from "@opencrane/backend/agents/runtime/prompt-compiler";

import type { RunInputCompiler } from "./prisma-runtime-dispatch-authority.types.js";

/** Canonical lowercase turn roles the compiled input uses. */
const _MESSAGE_ROLE: Record<string, CompiledMessage["role"]> = { User: "user", Assistant: "assistant", Tool: "tool", System: "system" };

/**
 * Build the {@link RunInputCompiler} the dispatch authority calls when minting `start_attempt`.
 *
 * It binds the deterministic prompt compiler to control-plane read ports backed by the same locked
 * Prisma transaction that loaded the snapshot, so every read is of an immutable record and the
 * compiled output stays byte-identical across restarts and idempotent redeliveries.
 *
 * @returns A compiler bound to per-attempt transaction reads.
 */
export function __CreatePrismaRunInputCompiler(): RunInputCompiler
{
	return function _compile(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient): Promise<CompiledRunInput>
	{
		return __CompileRunInput(snapshot, _repositories(transaction));
	};
}

/** Assemble the control-plane read ports over one locked transaction client. */
function _repositories(transaction: Prisma.TransactionClient): PromptCompilerRepositories
{
	return {
		loadPersonaInstructions(personaRevisionId: string | null): Promise<string> { return _loadPersonaInstructions(transaction, personaRevisionId); },
		loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]> { return _loadMessages(transaction, messageIds); },
		loadToolDefinitions(toolGrantIds: readonly string[]): Promise<readonly CompiledToolDefinition[]> { return _loadToolDefinitions(transaction, toolGrantIds); },
		// Durable fact text lives in Cognee behind the memory gateway (a network read); the immutable
		// fact references stay on the snapshot and are not inlined by this offline compile step.
		loadMemoryFactStatements(): Promise<readonly string[]> { return Promise.resolve([]); },
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

/** Resolve ordered conversation turns for the exact message references, preserving snapshot order. */
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
 * Resolve the snapshot's tool grants into the compiled tool definitions the bounded loop may propose.
 *
 * Each `toolGrantId` is an {@link McpServerGrant}; a grant resolves to its granted MCP server, which
 * becomes one callable tool the model may select. The revision id is derived from the immutable
 * server id so an external-action proposal can be fixed to (and later revalidated against) the exact
 * granted tool. Per-argument JSON schemas are not modelled server-side yet, so the compiled schema is
 * a permissive object the adapter still validates; tightening it is a later enrichment. Ordering is
 * left to the prompt compiler, which sorts tools canonically by name.
 */
async function _loadToolDefinitions(transaction: Prisma.TransactionClient, toolGrantIds: readonly string[]): Promise<readonly CompiledToolDefinition[]>
{
	if (toolGrantIds.length === 0) return [];
	const grants = await transaction.mcpServerGrant.findMany({ where: { id: { in: [...toolGrantIds] } }, include: { mcpServer: true } });
	const byServerId = new Map<string, CompiledToolDefinition>();
	for (const grant of grants)
	{
		const server = grant.mcpServer;
		if (!byServerId.has(server.id)) byServerId.set(server.id, { name: server.name, toolRevisionId: `mcp-server:${server.id}`, description: server.description, requiresApproval: server.requiresApproval, parametersSchema: { type: "object" } });
	}
	return [...byServerId.values()];
}

/** Resolve one-line availability summaries for the immutable artifact revisions offered to the run. */
async function _loadArtifactSummaries(transaction: Prisma.TransactionClient, artifactRevisionIds: readonly string[]): Promise<readonly string[]>
{
	if (artifactRevisionIds.length === 0) return [];
	const rows = await transaction.artifactRevision.findMany({ where: { id: { in: [...artifactRevisionIds] } } });
	return rows.map(function _summary(row) { return `${row.mediaType} artifact ${row.id}`; }).sort();
}

/** Resolve one-line availability summaries for the immutable skill revisions offered to the run. */
async function _loadSkillSummaries(transaction: Prisma.TransactionClient, skillRevisionIds: readonly string[]): Promise<readonly string[]>
{
	if (skillRevisionIds.length === 0) return [];
	const rows = await transaction.skillRevision.findMany({ where: { id: { in: [...skillRevisionIds] } } });
	return rows.map(function _summary(row) { return `skill ${row.skillId} revision ${row.id}`; }).sort();
}

/** Resolve the server-selected model route to a literal alias and output ceiling, never a credential. */
async function _resolveModelRoute(transaction: Prisma.TransactionClient, modelRoute: JsonValue): Promise<CompiledModelRoute>
{
	const route: { readonly [key: string]: JsonValue } = modelRoute && typeof modelRoute === "object" && !Array.isArray(modelRoute) ? modelRoute as { readonly [key: string]: JsonValue } : {};
	const requested = typeof route["alias"] === "string" ? route["alias"] : typeof route["publicModelName"] === "string" ? route["publicModelName"] : "";
	const maxOutputTokens = typeof route["maxOutputTokens"] === "number" && Number.isSafeInteger(route["maxOutputTokens"]) && route["maxOutputTokens"] > 0 ? route["maxOutputTokens"] : null;
	const definition = requested.length > 0 ? await transaction.modelDefinition.findFirst({ where: { publicModelName: requested } }) : null;
	return { modelAlias: definition?.publicModelName ?? requested, maxOutputTokens };
}
