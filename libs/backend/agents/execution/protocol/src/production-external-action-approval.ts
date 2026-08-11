import { createHash } from "node:crypto";

import { __DigestCanonicalJson, __OpenDeferredToolApproval, type OpenDeferredToolApprovalCommand } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";
import type { RunInputSnapshotToolDefinition } from "@opencrane/contracts";

import { ExternalActionRevisionKinds } from "./external-action-executor.types.js";
import type { ExternalActionApprovalOpener, ExternalActionExecutionContext, ExternalActionWorkerInvocation } from "./external-action-worker.types.js";

/** Fixed server-owned window in which one person may decide a tool approval. */
const _APPROVAL_EXPIRY_MILLISECONDS = 15 * 60 * 1_000;

/** Narrow production persistence input already required by the canonical approval opener. */
type DeferredToolApprovalPrisma = Parameters<typeof __OpenDeferredToolApproval>[0];

/** Parse the compiler-owned integration revision without accepting ambiguous extra segments. */
function _integrationTool(toolRevisionId: string): { readonly integrationId: string; readonly toolName: string } | null
{
	const parts = toolRevisionId.split(":");
	if (parts.length !== 3 || parts[0] !== ExternalActionRevisionKinds.Integration || !parts[1] || !parts[2]) return null;
	return { integrationId: parts[1], toolName: parts[2] };
}

/** Resolve exactly one frozen definition that produced the admitted compiler revision. */
function _frozenTool(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): RunInputSnapshotToolDefinition
{
	// 1. Parse the exact compiler-owned coordinate from the admitted invocation revision.
	const coordinate = _integrationTool(invocation.toolRevisionId);
	if (coordinate === null) throw new Error("approval-required external action has no frozen integration coordinate");

	// 2. Select one and only one matching definition from the immutable run snapshot.
	const matches: RunInputSnapshotToolDefinition[] = [];
	for (const assignment of context.snapshot.integrationAssignments)
	{
		if (assignment.integrationId !== coordinate.integrationId) continue;
		for (const definition of assignment.toolDefinitions)
		{
			if (definition.name === coordinate.toolName) matches.push(definition);
		}
	}
	if (matches.length !== 1) throw new Error("approval-required external action has no unique frozen tool schema");

	// 3. Recompute the canonical digest before allowing the definition into approval authority.
	const definition = matches[0]!;
	if (__DigestCanonicalJson(definition.parametersSchema) !== definition.parametersSchemaDigest) throw new Error("approval-required external action schema digest is invalid");
	return definition;
}

/** Derive an opaque stable interrupt id without embedding arguments or database coordinates. */
function _interruptId(invocation: ExternalActionWorkerInvocation): string
{
	const digest = createHash("sha256").update(JSON.stringify(["opencrane-tool-approval-interrupt-v1", invocation.requestFingerprint]), "utf8").digest("hex");
	return `tool-approval-${digest}`;
}

/** Build the exact bounded command accepted by the approval authority. */
function _openCommand(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext, definition: RunInputSnapshotToolDefinition, now: Date): OpenDeferredToolApprovalCommand
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

/** Production adapter that binds immutable execution input to the authorization-owned opener. */
class _ProductionExternalActionApprovalOpener implements ExternalActionApprovalOpener
{
	/** Canonical product-authority client that owns approval transactions. */
	private readonly prisma: DeferredToolApprovalPrisma;
	/** Structured logger used only by the opener's secret-free recovery evidence. */
	private readonly logger: Logger;

	/** Bind approval opening to process-owned persistence and logging. */
	constructor(prisma: DeferredToolApprovalPrisma, logger: Logger)
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Resolve immutable policy and open one bounded approval through its canonical authority. */
	async open(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext, now: Date): Promise<boolean>
	{
		const definition = _frozenTool(invocation, context);
		return __OpenDeferredToolApproval(this.prisma, _openCommand(invocation, context, definition, now), this.logger);
	}
}

/** Create the production approval adapter used by the process-owned external-action worker. */
export function __CreateProductionExternalActionApprovalOpener(prisma: DeferredToolApprovalPrisma, logger: Logger): ExternalActionApprovalOpener
{
	return new _ProductionExternalActionApprovalOpener(prisma, logger);
}
