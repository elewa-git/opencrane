import { createHash } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { GeneratedOutputCapability, type CompiledMessage, type CompiledModelRoute, type CompiledRunInput, type CompiledToolDefinition, type MemoryFactReference, type RunInputSnapshot, type RunInputSnapshotIntegrationAssignment } from "@opencrane/contracts";
import { __AreReviewedIntegrationToolDefinitionsValid, type ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";
import { __CompileRunInput } from "@opencrane/backend/agents/execution/inputs";
import type { PromptCompilerRepositories } from "@opencrane/backend/agents/execution/inputs";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";

import { ExternalActionRevisionKinds } from "./external-action-executor.types.js";
import type { RunInputCompiler } from "./prisma-runtime-dispatch-authority.types.js";

/** Maps stored message roles to the lowercase roles the compiled input uses. */
const _MESSAGE_ROLE: Record<string, CompiledMessage["role"]> = { User: "user", Assistant: "assistant", Tool: "tool", System: "system" };

/** Fewest results to ask the memory gateway for when looking up frozen facts again. */
const _MINIMUM_STATEMENT_RECALL_RESULTS = 32;

/**
 * Build the {@link RunInputCompiler} the dispatch authority calls when it creates `start_attempt`.
 *
 * It gives the prompt compiler read functions that run on the same locked Prisma transaction that
 * loaded the snapshot, so every read is of a record that cannot change and the compiled output stays
 * byte-for-byte the same across restarts and re-sent commands. Memory-fact statements are the one
 * network read: they come from the injected memory gateway, and every statement is checked against
 * the digest frozen in the snapshot, so a re-sent command either carries exactly the same memory
 * text or the compile fails.
 *
 * Called by: `_CreateProductionRunInputCompiler` in production-runtime-dispatch.ts, which appends
 * the built-in upgrade-session tool on top of the result.
 *
 * @param memoryGateway - Read-only memory-gateway client, shared with the action worker.
 * @returns A compiler that reads inside the attempt's transaction and digest-checks gateway recall.
 * @throws From the returned compiler: when a frozen memory fact is missing or its text no longer
 * matches its digest, or the snapshot's memory policy names no dataset. No command is created.
 * @see RunInputCompiler for the byte-for-byte rule every implementation must meet.
 */
export function __CreatePrismaRunInputCompiler(memoryGateway: MemoryGatewayClient): RunInputCompiler
{
	return function _compile(snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient): Promise<CompiledRunInput>
	{
		return __CompileRunInput(snapshot, _repositories(memoryGateway, snapshot, transaction));
	};
}

/** Build the read functions the prompt compiler calls, over one locked transaction and the snapshot's frozen policy. */
function _repositories(memoryGateway: MemoryGatewayClient, snapshot: RunInputSnapshot, transaction: Prisma.TransactionClient): PromptCompilerRepositories
{
	return {
		loadPersonaInstructions(personaRevisionId: string | null): Promise<string> { return _loadPersonaInstructions(transaction, personaRevisionId); },
		loadMessages(messageIds: readonly string[]): Promise<readonly CompiledMessage[]> { return _loadMessages(transaction, messageIds); },
		loadToolDefinitions(integrationAssignments: readonly RunInputSnapshotIntegrationAssignment[]): Promise<readonly CompiledToolDefinition[]> { return _loadToolDefinitions(integrationAssignments); },
		loadMemoryFactStatements(memoryFacts: readonly MemoryFactReference[]): Promise<readonly string[]> { return _loadMemoryFactStatements(memoryGateway, snapshot, memoryFacts); },
		loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadArtifactSummaries(transaction, artifactRevisionIds); },
		loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]> { return _loadSkillSummaries(transaction, skillRevisionIds); },
		resolveModelRoute(modelRoute: JsonValue): Promise<CompiledModelRoute> { return _resolveModelRoute(transaction, modelRoute); },
	};
}

/**
 * Look up the facts frozen in the snapshot, and check each one's text against its stored digest.
 *
 * Every reference must resolve to text whose `sha256:` digest equals the frozen `contentDigest`. A
 * missing fact or changed text throws, so a `start_attempt` command is never created with a partial
 * or altered memory section. The text is used only to compile the prompt and is never saved.
 */
async function _loadMemoryFactStatements(memoryGateway: MemoryGatewayClient, snapshot: RunInputSnapshot, memoryFacts: readonly MemoryFactReference[]): Promise<readonly string[]>
{
	// 1. No frozen facts means no network read at all.
	if (memoryFacts.length === 0) return [];

	// 2. Refuse unless the snapshot's policy gives the dataset and the query text. The dataset always
	//    comes from the snapshot, never from a subject id or a tool argument.
	const policy = _personalMemoryPolicy(snapshot.memoryQueryPolicy);

	// 3. Re-run the same query but ask for more results, so a change in ranking cannot hide a frozen fact.
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

/** Read the dataset id and query text out of the snapshot's memory policy, throwing when either is missing. */
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

/** Return the persona revision's instruction text, or an empty string when the run has no persona. */
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
 * Turn the integrations the snapshot allows into the tool definitions the agent may call.
 *
 * Each tool is named with its integration, giving an `integration:<id>:<tool>` revision id. That
 * revision id reaches the external-action code, which checks the integration's live custody
 * reference and its allow-list again on its own. Third-party actions always require an approval,
 * until there is a per-tool approval policy. Schema and digest come only from the admitted
 * snapshot; compiling never reads a catalogue that can change, and never invents a permissive
 * fallback.
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
			tools.push({ name: toolRevisionId, toolRevisionId, description: tool.description, requiresApproval: true, parametersSchema: ___CloneCanonicalJson(tool.parametersSchema), parametersSchemaDigest: tool.parametersSchemaDigest });
		}
	}
	return tools;
}

/** Build a one-line summary for each artifact revision offered to the run. */
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
