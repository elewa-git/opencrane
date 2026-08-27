import { createHash } from "node:crypto";

import { __DigestCanonicalJson, __OpenDeferredToolApproval, type OpenDeferredToolApprovalCommand } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshotMcpTool } from "@opencrane/contracts";

import type { ExternalActionApprovalOpener, ExternalActionExecutionContext, ExternalActionWorkerInvocation } from "./external-action-worker.types";

/** Schema fields the approval authority needs, independent of the tool's execution class. */
interface FrozenApprovalTool
{
	/** Exact input schema presented to the approver and used to validate an approved call. */
	readonly parametersSchema: RunInputSnapshotMcpTool["inputSchema"];
	/** Digest proving the schema matches the admitted immutable tool revision. */
	readonly parametersSchemaDigest: string;
}

/** How long someone has to decide a tool approval. */
const _APPROVAL_EXPIRY_MILLISECONDS = 15 * 60 * 1_000;

/** The Prisma client type `__OpenDeferredToolApproval` already requires. */
type DeferredToolApprovalPrisma = Parameters<typeof __OpenDeferredToolApproval>[0];

/** Find the one tool definition in the snapshot that this invocation's revision id came from. */
function _frozenTool(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): FrozenApprovalTool
{
	const mcpMatches = context.snapshot.mcpTools.filter(function _ExactMcpRevision(tool): boolean { return tool.toolRevisionId === invocation.toolRevisionId; });
	if (mcpMatches.length > 1)
		throw new Error("approval-required external action has duplicate frozen MCP tool revisions");
	if (mcpMatches.length === 1)
	{
		const mcpTool = mcpMatches[0]!;
		if (__DigestCanonicalJson(mcpTool.inputSchema) !== mcpTool.inputSchemaDigest)
			throw new Error("approval-required external action schema digest is invalid");
		return { parametersSchema: mcpTool.inputSchema, parametersSchemaDigest: mcpTool.inputSchemaDigest };
	}
	throw new Error("approval-required external action has no frozen MCP tool revision");
}

/** Build a stable interrupt id that reveals neither the arguments nor any database id. */
function _interruptId(invocation: ExternalActionWorkerInvocation): string
{
	const digest = createHash("sha256").update(JSON.stringify(["opencrane-tool-approval-interrupt-v1", invocation.requestFingerprint]), "utf8").digest("hex");
	return `tool-approval-${digest}`;
}

/** Build the command `__OpenDeferredToolApproval` takes. */
function _openCommand(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext, definition: FrozenApprovalTool, now: Date): OpenDeferredToolApprovalCommand
{
	return {
		interruptId: _interruptId(invocation),
		runId: invocation.runId,
		attempt: invocation.attempt,
		toolInvocationId: invocation.toolInvocationId,
		toolRevisionId: invocation.toolRevisionId,
		arguments: invocation.arguments,
		argumentsDigest: invocation.argumentsDigest,
		parametersSchema: definition.parametersSchema,
		parametersSchemaDigest: definition.parametersSchemaDigest,
		capabilitySetDigest: context.snapshot.capabilitySetDigest,
		invocationId: invocation.id,
		now,
		expiresAt: new Date(now.getTime() + _APPROVAL_EXPIRY_MILLISECONDS),
	};
}

/** Passes the invocation and its snapshot to `__OpenDeferredToolApproval`. */
class _ProductionExternalActionApprovalOpener implements ExternalActionApprovalOpener
{
	/** Database client that runs the approval transaction. */
	private readonly prisma: DeferredToolApprovalPrisma;
	/** Logger for the opener's own messages. Nothing secret goes into it. */
	private readonly logger: Logger;

	/** Store the database client and logger this opener uses. */
	constructor(prisma: DeferredToolApprovalPrisma, logger: Logger)
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Find the frozen tool definition, then open one approval through `__OpenDeferredToolApproval`. */
	async open(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext, now: Date): Promise<boolean>
	{
		const definition = _frozenTool(invocation, context);
		return __OpenDeferredToolApproval(this.prisma, _openCommand(invocation, context, definition, now), this.logger);
	}
}

/**
 * Create the approval opener the external-action worker uses.
 *
 * Called by: `_CreateExternalActionWorker` in apps/opencrane/src/app/external-action-composition.ts.
 *
 * @param prisma - Database client that will own the approval transaction.
 * @param logger - Logger for the opener's own messages; nothing secret goes into it.
 * @returns An opener that pauses the run and creates, or finds, the approval request.
 * @see ExternalActionApprovalOpener for what its boolean result obliges the caller to do.
 */
export function __CreateProductionExternalActionApprovalOpener(prisma: DeferredToolApprovalPrisma, logger: Logger): ExternalActionApprovalOpener
{
	return new _ProductionExternalActionApprovalOpener(prisma, logger);
}
