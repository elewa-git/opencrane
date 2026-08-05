import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import type { CompiledMessage, CompiledModelRoute, CompiledRunInput, CompiledToolDefinition, MemoryFactReference, RunInputSnapshot, RunInputSnapshotIntegrationAssignment } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";
import { __CompileRunInput } from "@opencrane/backend/agents/execution/inputs";
import type { PromptCompilerRepositories } from "@opencrane/backend/agents/execution/inputs";
import type { MemoryGatewayClient } from "@opencrane/backend/_server/memory-gateway-client";
import type { IntegrationAuthorityRepository } from "@opencrane/backend/server/gateways/integrations";

import { ExternalActionRevisionKinds } from "./external-action-executor.types.js";
import type { RunInputCompiler } from "./prisma-runtime-dispatch-authority.types.js";

/** Canonical lowercase turn roles the compiled input uses. */
const _MESSAGE_ROLE: Record<string, CompiledMessage["role"]> = { User: "user", Assistant: "assistant", Tool: "tool", System: "system" };

/** Smallest gateway recall window used when re-resolving frozen fact references. */
const _MINIMUM_STATEMENT_RECALL_RESULTS = 32;

/**
 * Build the {@link RunInputCompiler} the dispatch authority calls when minting `start_attempt`.
 *
 * It binds the deterministic prompt compiler to control-plane read ports backed by the same locked
 * Prisma transaction that loaded the snapshot, so every read is of an immutable record and the
 * compiled output stays byte-identical across restarts and idempotent redeliveries. Memory-fact
 * statements are the one network read: they resolve through the injected memory gateway and every
 * statement is verified against the digest frozen in the snapshot, so a redelivered frame either
 * carries byte-identical memory text or the compile fails closed.
 * Integration addressing is the other live read: the injected authority resolves each assignment's
 * current custody reference without broadening the snapshot's frozen tool allow-list.
 *
 * @param memoryGateway - Authenticated read-only memory-gateway client shared with the action runner.
 * @param integrationAuthority - Optional live custody resolver; null omits Obot addressing entirely.
 * @returns A compiler bound to per-attempt transaction reads and digest-verified gateway recall.
 */
export function __CreatePrismaRunInputCompiler(memoryGateway: MemoryGatewayClient, integrationAuthority: IntegrationAuthorityRepository | null = null): RunInputCompiler
{
	return function _compile(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient): Promise<CompiledRunInput>
	{
		return __CompileRunInput(snapshot, _repositories(memoryGateway, snapshot, transaction, integrationAuthority));
	};
}

/** Assemble the control-plane read ports over one locked transaction client and the snapshot's frozen policy. */
function _repositories(memoryGateway: MemoryGatewayClient, snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient, integrationAuthority: IntegrationAuthorityRepository | null): PromptCompilerRepositories
{
	return {
		loadPersonaInstructions(personaRevisionId: string | null): Promise<string> { return _loadPersonaInstructions(transaction, personaRevisionId); },
		loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]> { return _loadMessages(transaction, messageIds); },
		loadToolDefinitions(integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[]): Promise<readonly CompiledToolDefinition[]> { return _loadToolDefinitions(integrationAssignments, snapshot, integrationAuthority); },
		loadMemoryFactStatements(memoryFacts: readonly MemoryFactReference[]): Promise<readonly string[]> { return _loadMemoryFactStatements(memoryGateway, snapshot, memoryFacts); },
		loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadArtifactSummaries(transaction, artifactRevisionIds); },
		loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadSkillSummaries(transaction, skillRevisionIds); },
		resolveModelRoute(modelRoute: JsonValue): Promise<CompiledModelRoute> { return _resolveModelRoute(transaction, modelRoute); },
	};
}

/**
 * Resolve frozen memory-fact references to digest-verified statements through the memory gateway.
 *
 * Every reference must resolve to content whose `sha256:` digest equals the frozen `contentDigest`;
 * any missing fact or drifted content throws, so a `start_attempt` frame is never minted with a
 * partial or altered memory section. Fact text is returned only for prompt compilation and is
 * never persisted.
 */
async function _loadMemoryFactStatements(memoryGateway: MemoryGatewayClient, snapshot: RunInputSnapshot, memoryFacts: readonly MemoryFactReference[]): Promise<readonly string[]>
{
	// 1. Compile deterministically with no network read when the snapshot froze no fact references.
	if (memoryFacts.length === 0) return [];

	// 2. Fail closed unless the frozen policy names the exact personal recall coordinates; dataset
	//    selection only ever comes from the snapshot, never a subject id or argument.
	const policy = _personalMemoryPolicy(snapshot.memoryQueryPolicy);

	// 3. Re-run the frozen recall with a widened window so ranking drift cannot hide a frozen fact.
	const result = await memoryGateway.query({ siloId: snapshot.siloId, cogneeDatasetId: policy.cogneeDatasetId, subjectId: snapshot.identitySnapshot.executionSubjectId, query: policy.queryText, maxResults: Math.max(memoryFacts.length * 4, _MINIMUM_STATEMENT_RECALL_RESULTS) });
	const contentByFactId = new Map(result.facts.map(function _entry(fact) { return [fact.factId, fact.content] as const; }));

	// 4. Verify every reference against its frozen digest; one mismatch fails the whole compile.
	return memoryFacts.map(function _statement(reference): string
	{
		const content = contentByFactId.get(reference.factId);
		if (content === undefined || `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}` !== reference.contentDigest)
		{
			throw new Error("memory fact statement failed digest verification");
		}
		return content;
	});
}

/** Extract the frozen personal recall coordinates from the snapshot's opaque memory policy, failing closed. */
function _personalMemoryPolicy(memoryQueryPolicy: JsonValue): { cogneeDatasetId: string; queryText: string }
{
	const policy: { readonly [key: string]: JsonValue } = memoryQueryPolicy && typeof memoryQueryPolicy === "object" && !Array.isArray(memoryQueryPolicy) ? memoryQueryPolicy as { readonly [key: string]: JsonValue } : {};
	const cogneeDatasetId = typeof policy["cogneeDatasetId"] === "string" ? policy["cogneeDatasetId"].trim() : "";
	const queryText = typeof policy["queryText"] === "string" ? policy["queryText"].trim() : "";
	if (policy["scope"] !== "personal" || cogneeDatasetId.length === 0 || queryText.length === 0)
	{
		throw new Error("snapshot memory policy cannot resolve frozen fact references");
	}
	return { cogneeDatasetId, queryText };
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
 * Resolve immutable integration allowances into compiled tool definitions the bounded loop may propose.
 *
 * Each tool is named with its integration and becomes an `integration:<id>:<tool>` revision id.
 * That exact revision id reaches the external-action boundary, which independently rechecks its
 * live custody reference and the revision's allow-list. Third-party actions require an approval
 * until an explicit per-tool approval policy exists. Per-argument JSON schemas are not modelled
 * server-side yet, so the compiled schema is a permissive object the adapter still validates.
 *
 * When the injected integration authority is present, each assignment additionally resolves its
 * live custody reference into non-secret `obotMcpServerId` ADDRESSING for the runtime's direct
 * approved-invocation data plane. An unavailable assignment simply omits the id — the tool remains
 * proposable, and an approved invocation then fails closed at execution rather than at compile.
 */
async function _loadToolDefinitions(integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[], snapshot: RunInputSnapshot, integrationAuthority: IntegrationAuthorityRepository | null): Promise<readonly CompiledToolDefinition[]>
{
	const tools: CompiledToolDefinition[] = [];
	for (const assignment of integrationAssignments)
	{
		// 1. Resolve addressing once per assignment; the id is Obot's MCP server id, not a credential.
		const obotMcpServerId = await _resolveObotMcpServerId(assignment.integrationId, snapshot, integrationAuthority);
		for (const tool of assignment.allowedTools)
		{
			// 2. Compile one definition per allowed tool with the frozen revision id and addressing.
			tools.push({ name: `${ExternalActionRevisionKinds.Integration}:${assignment.integrationId}:${tool}`, toolRevisionId: `${ExternalActionRevisionKinds.Integration}:${assignment.integrationId}:${tool}`, description: `Tool ${tool} from integration ${assignment.integrationId}`, requiresApproval: true, parametersSchema: { type: "object" }, ...(obotMcpServerId === null ? {} : { obotMcpServerId }) });
		}
	}
	return tools;
}

/** Resolve one assignment's live custody reference into Obot MCP addressing, or null fail-open-free. */
async function _resolveObotMcpServerId(integrationId: string, snapshot: RunInputSnapshot, integrationAuthority: IntegrationAuthorityRepository | null): Promise<string | null>
{
	if (integrationAuthority === null) return null;
	const resolved = await integrationAuthority.resolveAssignment({ siloId: snapshot.siloId, agentRevisionId: snapshot.agentRevisionId, integrationId });
	return resolved.outcome === "resolved" ? resolved.assignment.obotCustodyReference : null;
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
