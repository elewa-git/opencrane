import { type Prisma, type PrismaClient } from "@prisma/client";

import { __AppendCompiledTool } from "@opencrane/backend/agents/execution/inputs";
import { PrismaRuntimeElicitationUnitOfWork } from "@opencrane/backend/agents/execution/elicitation";
import { PrismaRuntimeEventReporter, PrismaToolInvocationRunRecoveryAuthority } from "@opencrane/backend/agents/execution/runs";
import { __IsUpgradeSessionAvailable, UPGRADE_SESSION_TOOL } from "@opencrane/backend/agents/personal/configuration";
import { __ExpireDeferredToolApprovalBatch } from "@opencrane/backend/server/iam/authorization";
import { type CompiledToolDefinition, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_NAME, PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __CreatePrismaRunInputCompiler } from "./prisma-run-input-compiler";
import { PrismaRuntimeDispatchAuthorityUnitOfWork } from "./prisma-runtime-dispatch-authority";
import type { RunInputCompiler, RuntimeApprovalExpiry, RuntimeDispatchAuthorityConfig, RuntimeElicitationUnitOfWorkFactory, RuntimeExternalActionAuthorization } from "./prisma-runtime-dispatch-authority.types";
import type { RuntimeContinuationAuthority } from "./runtime-continuation.types";

/** Reviewed arguments for one model-proposed personal-memory recall. */
const _PERSONAL_MEMORY_RECALL_PARAMETERS_SCHEMA = {
	type: "object",
	properties: { query: { type: "string", minLength: 1, maxLength: 2_000, pattern: "\\S" } },
	required: ["query"],
	additionalProperties: false,
} as const;

/** Declared memory tool; execution always pauses for the exact user permission receipt. */
export const PERSONAL_MEMORY_RECALL_TOOL: CompiledToolDefinition = {
	name: PERSONAL_MEMORY_RECALL_TOOL_NAME,
	toolRevisionId: PERSONAL_MEMORY_RECALL_TOOL_REVISION,
	description: "Ask the execution user for permission to recall personal memory relevant to this answer.",
	requiresApproval: true,
	parametersSchema: _PERSONAL_MEMORY_RECALL_PARAMETERS_SCHEMA,
	parametersSchemaDigest: ___DigestCanonicalJson(_PERSONAL_MEMORY_RECALL_PARAMETERS_SCHEMA),
};

/** Compile ordinary grants, then append first-party tools only to snapshots with their required frozen resources. */
export function __CreateProductionRunInputCompiler(): RunInputCompiler
{
	const compile = __CreatePrismaRunInputCompiler();
	return async function _compileRunInput(snapshot: RunInputSnapshot, attempt: number, transaction: Prisma.TransactionClient)
	{
		// 1. Compile the immutable snapshot before considering any first-party descriptor.
		const input = await compile(snapshot, attempt, transaction);

		// 2. Skip snapshots that have no conversation or no persona, without guessing the service kind.
		if (!__IsUpgradeSessionAvailable(snapshot)) return input;

		// 3. Expose memory only as a declared approval-required action; no compile-time gateway exists.
		const withMemory = __AppendCompiledTool(input, PERSONAL_MEMORY_RECALL_TOOL);
		return __AppendCompiledTool(withMemory, UPGRADE_SESSION_TOOL);
	};
}

/** Wire command polling to `__ExpireDeferredToolApprovalBatch`. */
function _CreateProductionApprovalExpiry(): RuntimeApprovalExpiry
{
	return { expireInTransaction: __ExpireDeferredToolApprovalBatch };
}

/** Bind elicitation work to the dispatch transaction so it cannot commit apart from the decision. */
function _CreateProductionRuntimeElicitationUnitOfWorkFactory(): RuntimeElicitationUnitOfWorkFactory
{
	return { bind(transaction) { return new PrismaRuntimeElicitationUnitOfWork(transaction); } };
}

/**
 * Construct the production runtime dispatch authority behind the workload stream.
 *
 * This factory is the sole concrete policy composition for compiled input, durable external-action
 * admission, deferred approvals, and canonical runtime event reporting. Provider execution belongs
 * to the separate server worker and never enters runtime-stream composition.
 *
 * @param prisma - Canonical product-authority persistence client.
 * @param config - Deployment-fixed namespaces, command lifetime, and retry bounds.
 * @returns One production dispatch authority ready for the runtime stream transport.
 */
export function __CreateProductionRuntimeDispatchAuthority(prisma: PrismaClient, config: RuntimeDispatchAuthorityConfig, continuationAuthority: RuntimeContinuationAuthority, externalActionAuthorization: RuntimeExternalActionAuthorization): PrismaRuntimeDispatchAuthorityUnitOfWork
{
	return new PrismaRuntimeDispatchAuthorityUnitOfWork(prisma, config, __CreateProductionRunInputCompiler(), new PrismaRuntimeEventReporter(), undefined, _CreateProductionApprovalExpiry(), _CreateProductionRuntimeElicitationUnitOfWorkFactory(), continuationAuthority, new PrismaToolInvocationRunRecoveryAuthority(), externalActionAuthorization);
}
