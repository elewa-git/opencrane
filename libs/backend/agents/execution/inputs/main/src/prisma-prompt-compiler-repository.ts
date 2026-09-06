import { Prisma, type PrismaClient } from "@prisma/client";

import { GeneratedOutputCapability, type CompiledModelRoute, type CompiledRunInput, type CompiledToolDefinition, type RunInputSnapshotMcpTool } from "@opencrane/contracts";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import type { ConversationPromptMessageRepository, PromptCompilerRepositories } from "./prompt-compiler.types";
import { __CompileRunInput } from "./prompt-compiler";
import type { PromptCompilerUnitOfWork } from "./prompt-compiler-unit-of-work.types";

/** Creates the canonical message repository inside the compiler's exact Prisma read transaction. */
type _ConversationPromptMessageRepositoryFactory = (transaction: Prisma.TransactionClient) => ConversationPromptMessageRepository;

/**
 * Owns the read transaction that dereferences one admitted snapshot into compiled runtime input.
 *
 * Called by: application run-admission composition for idempotent admission recovery.
 * @implements PromptCompilerUnitOfWork
 * @see PrismaPromptCompilerRepository for the exact transaction-bound reads.
 */
export class PrismaPromptCompilerUnitOfWork implements PromptCompilerUnitOfWork
{
	/** Bind compilation to the control-plane client and command-bound canonical message factory. */
	constructor(private readonly _prisma: PrismaClient, private readonly _messages: _ConversationPromptMessageRepositoryFactory) {}

	/** Compile every immutable reference exactly once inside one Prisma transaction snapshot. */
	compile(snapshot: Parameters<PromptCompilerUnitOfWork["compile"]>[0], attempt: number): Promise<CompiledRunInput>
	{
		const unitOfWork = this;
		return this._prisma.$transaction(async function _CompileInReadSnapshot(transaction)
		{
			const repository = new PrismaPromptCompilerRepository(transaction, unitOfWork._messages(transaction), snapshot.siloId);
			return __CompileRunInput(snapshot, attempt, repository);
		});
	}
}

/**
 * Resolves every immutable non-message prompt reference through one Prisma transaction snapshot.
 *
 * Called by: accepted run admission before commit and `PrismaPromptCompilerUnitOfWork` during recovery.
 * @implements PromptCompilerRepositories
 * @see ConversationPromptMessageRepository for the separately owned Kurrent message boundary.
 */
export class PrismaPromptCompilerRepository implements PromptCompilerRepositories
{
	/** Bind immutable control-plane reads to the supplied transaction and canonical message repository. */
	constructor(private readonly _prisma: Prisma.TransactionClient, private readonly _messages: ConversationPromptMessageRepository, private readonly _siloId: string) {}

	/** Resolve the exact admitted persona revision without consulting its profile's later publication state. */
	async loadPersonaInstructions(personaRevisionId: string | null): Promise<string>
	{
		if (personaRevisionId === null)
			return "";
		const revision = await this._prisma.personaRevision.findFirst({ where: { id: personaRevisionId, profile: { is: { siloId: this._siloId } } }, select: { compiledInstructions: true } });
		if (revision === null || revision.compiledInstructions.trim().length === 0)
			throw new Error("Prompt persona revision is unavailable");
		return revision.compiledInstructions;
	}

	/** Delegate canonical message order and decryption to the Kurrent-backed exact-set verifier. */
	loadMessages(messageIds: readonly string[])
	{
		return this._messages.loadMessages(messageIds);
	}

	/** Verify every frozen MCP tool literal against its exact immutable database revision. */
	async loadToolDefinitions(mcpTools: readonly RunInputSnapshotMcpTool[]): Promise<readonly CompiledToolDefinition[]>
	{
		_RequireUniqueIds(mcpTools.map(tool => tool.toolRevisionId), "MCP tool");
		if (mcpTools.length === 0)
			return [];
		const rows = await this._prisma.mcpToolRevision.findMany({ where: { id: { in: mcpTools.map(tool => tool.toolRevisionId) }, siloId: this._siloId }, include: { serverRevision: { include: { server: true } } } });
		if (rows.length !== mcpTools.length)
			throw new Error("Prompt MCP tool revision set is incomplete");
		const rowsById = new Map(rows.map(row => [row.id, row]));
		return mcpTools.map(function _CompileTool(tool): CompiledToolDefinition
		{
			const row = rowsById.get(tool.toolRevisionId);
			if (row === undefined || row.name !== tool.name || row.description !== tool.description || row.inputSchemaDigest !== tool.inputSchemaDigest
				|| ___DigestCanonicalJson(row.inputSchema as JsonValue) !== tool.inputSchemaDigest || ___DigestCanonicalJson(tool.inputSchema) !== tool.inputSchemaDigest
				|| row.siloId !== row.serverRevision.siloId || row.siloId !== row.serverRevision.server.siloId)
				throw new Error("Prompt MCP tool revision does not match the admitted snapshot");
			return { name: tool.name, toolRevisionId: tool.toolRevisionId, description: tool.description ?? "", requiresApproval: row.serverRevision.server.requiresApproval, parametersSchema: tool.inputSchema, parametersSchemaDigest: tool.inputSchemaDigest };
		});
	}

	/** Resolve every exact artifact revision without consulting the artifact's later lifecycle state. */
	async loadArtifactSummaries(artifactRevisionIds: readonly string[]): Promise<readonly string[]>
	{
		_RequireUniqueIds(artifactRevisionIds, "artifact revision");
		if (artifactRevisionIds.length === 0)
			return [];
		const rows = await this._prisma.artifactRevision.findMany({ where: { id: { in: [...artifactRevisionIds] }, artifact: { is: { siloId: this._siloId } } }, select: { id: true, mediaType: true } });
		return _ExactOrdered(artifactRevisionIds, rows, "artifact revision").map(row => `${row.mediaType} artifact ${row.id}`);
	}

	/** Resolve every exact skill revision without consulting the skill's later lifecycle state. */
	async loadSkillSummaries(skillRevisionIds: readonly string[]): Promise<readonly string[]>
	{
		_RequireUniqueIds(skillRevisionIds, "skill revision");
		if (skillRevisionIds.length === 0)
			return [];
		const rows = await this._prisma.skillRevision.findMany({ where: { id: { in: [...skillRevisionIds] }, skill: { is: { siloId: this._siloId } } }, select: { id: true, skillId: true } });
		return _ExactOrdered(skillRevisionIds, rows, "skill revision").map(row => `skill ${row.skillId} revision ${row.id}`);
	}

	/** Confirm the exact admitted model definition still exists, then return only its frozen route literals. */
	async resolveModelRoute(siloId: string, modelRoute: JsonValue): Promise<CompiledModelRoute>
	{
		if (siloId !== this._siloId)
			throw new Error("Prompt model route uses another compiler silo");
		const route = _JsonObject(modelRoute);
		const modelDefinitionId = _RequiredString(route, "modelDefinitionId");
		const alias = _RequiredString(route, "alias");
		_RequiredString(route, "litellmModelId");
		const admittedCapabilities = _GeneratedOutputCapabilities(route["generatedOutputCapabilities"]);
		const maxOutputTokens = _OptionalPositiveCount(route["maxOutputTokens"], "maxOutputTokens");
		const row = await this._prisma.modelDefinition.findFirst({ where: { id: modelDefinitionId, siloId }, select: { id: true, siloId: true } });
		if (row === null)
			throw new Error("Prompt model definition is unavailable");
		return { modelAlias: alias, maxOutputTokens, generatedOutputCapabilities: admittedCapabilities.map(_GeneratedOutputCapability) };
	}
}

/** Require non-empty unique immutable identifiers before issuing a set query. */
function _RequireUniqueIds(ids: readonly string[], label: string): void
{
	if (ids.some(id => id.trim().length === 0) || new Set(ids).size !== ids.length)
		throw new Error(`Prompt ${label} identifiers must be unique and non-empty`);
}

/** Restore requested order and reject any incomplete or duplicate database result. */
function _ExactOrdered<T extends { readonly id: string }>(ids: readonly string[], rows: readonly T[], label: string): readonly T[]
{
	if (rows.length !== ids.length)
		throw new Error(`Prompt ${label} set is incomplete`);
	const byId = new Map(rows.map(row => [row.id, row]));
	if (byId.size !== ids.length)
		throw new Error(`Prompt ${label} set is ambiguous`);
	return ids.map(function _RequiredRow(id): T
	{
		const row = byId.get(id);
		if (row === undefined)
			throw new Error(`Prompt ${label} set is incomplete`);
		return row;
	});
}

/** Narrow a JSON value to a record or reject an unstructured route. */
function _JsonObject(value: JsonValue): Readonly<Record<string, JsonValue>>
{
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Prompt model route must be an object");
	return value as Readonly<Record<string, JsonValue>>;
}

/** Read one required non-empty string from an admitted route. */
function _RequiredString(route: Readonly<Record<string, JsonValue>>, key: string): string
{
	const value = route[key];
	if (typeof value !== "string" || value.trim().length === 0)
		throw new Error(`Prompt model route requires ${key}`);
	return value;
}

/** Read one optional positive integer frozen into an admitted model route. */
function _OptionalPositiveCount(value: JsonValue | undefined, key: string): number | null
{
	if (value === undefined || value === null)
		return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
		throw new Error(`Prompt model route requires a positive ${key}`);
	return value;
}

/** Reject provider-native capabilities outside the compiled runtime contract. */
function _GeneratedOutputCapability(value: string): typeof GeneratedOutputCapability[keyof typeof GeneratedOutputCapability]
{
	if (value === GeneratedOutputCapability.ImagePng || value === GeneratedOutputCapability.CodeExecutionFiles)
		return value;
	throw new Error("Prompt model route contains an unsupported generated-output capability");
}

/** Read the sorted unique capability list frozen into the admitted model route. */
function _GeneratedOutputCapabilities(value: JsonValue | undefined): readonly string[]
{
	if (!Array.isArray(value) || value.some(capability => typeof capability !== "string"))
		throw new Error("Prompt model route requires generatedOutputCapabilities");
	const capabilities = [...value] as string[];
	if (new Set(capabilities).size !== capabilities.length || capabilities.some(function _Unknown(capability): boolean { return capability !== GeneratedOutputCapability.ImagePng && capability !== GeneratedOutputCapability.CodeExecutionFiles; }))
		throw new Error("Prompt model route contains an unsupported generated-output capability");
	return capabilities.sort();
}
