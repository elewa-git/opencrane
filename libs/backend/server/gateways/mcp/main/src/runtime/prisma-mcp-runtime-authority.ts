import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpCompanionClaimResponse, McpCompanionCompletionRequest, McpCompanionFailureRequest } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import { PrismaMcpRuntimeCatalogRepository } from "./prisma-mcp-runtime-catalog-repository";
import { PrismaMcpRuntimeCompanionRepository } from "./prisma-mcp-runtime-companion-repository";
import { PrismaMcpRuntimeControllerRepository } from "./prisma-mcp-runtime-controller-repository";
import { McpRuntimeCompanionClaimOutcomes, type McpOciServerPromotionCaller, type McpOciServerPromotionCommand, type McpOciServerPromotionResult, type McpRuntimeAuthority, type McpRuntimeControllerClaim, type McpRuntimeControllerReleaseClaim, type McpRuntimeControllerWriteOutcome, type McpRuntimePodRegistrationCommand, type McpRuntimeReleaseCommand, type PrismaMcpRuntimeAuthorityDependencies } from "./mcp-runtime.types";

/** Maximum serializable retries when concurrent controller or companion writes collide. */
const _SERIALIZABLE_ATTEMPTS = 3;

/** Owns every database transaction that moves an OCI-backed MCP execution. */
export class PrismaMcpRuntimeUnitOfWork implements McpRuntimeAuthority
{
	/** Root client used only to open serializable transactions. */
	private readonly _prisma: PrismaClient;
	/** Authorization participant factory and fixed deployment policy. */
	private readonly _dependencies: PrismaMcpRuntimeAuthorityDependencies;

	/** Validate deployment policy before the server begins accepting runtime work. */
	constructor(prisma: PrismaClient, dependencies: PrismaMcpRuntimeAuthorityDependencies)
	{
		_AssertOptions(dependencies);
		this._prisma = prisma;
		this._dependencies = dependencies;
	}

	/** Promote one imported image and its discovery execution atomically. */
	promoteImportedValidation(caller: McpOciServerPromotionCaller, validationId: string, command: McpOciServerPromotionCommand): Promise<McpOciServerPromotionResult>
	{
		return this._run<McpOciServerPromotionResult>("mcp.runtime.promote", { outcome: "conflict" }, async function _Promote(transaction, repositories): Promise<McpOciServerPromotionResult> { return repositories.catalog.promoteImportedValidation(caller, validationId, command); });
	}

	/** Admit one ready authorization-owned ToolInvocation as MCP runtime work. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		return this._run("mcp.runtime.admit_invocation", "not_ready", async function _Admit(transaction, repositories): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp"> { return repositories.catalog.admitInvocation(toolInvocationRowId); });
	}

	/** Claim one pending MCP workload for the controller. */
	claimNextController(): Promise<McpRuntimeControllerClaim | null>
	{
		return this._run("mcp.runtime.controller.claim", null, async function _Claim(transaction, repositories): Promise<McpRuntimeControllerClaim | null> { return repositories.controller.claimNext(); });
	}

	/** Bind one exact Kubernetes Job UID to the controller claim. */
	commitAssignment(binding: RuntimeWorkloadBinding): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.assign", "conflict", async function _Assign(transaction, repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.commitAssignment(binding); });
	}

	/** Claim one assigned Job for a fenced unsuspend. */
	claimNextRelease(): Promise<McpRuntimeControllerReleaseClaim | null>
	{
		return this._run("mcp.runtime.controller.claim_release", null, async function _ClaimRelease(transaction, repositories): Promise<McpRuntimeControllerReleaseClaim | null> { return repositories.controller.claimNextRelease(); });
	}

	/** Commit the exact Kubernetes unsuspend under its release fence. */
	commitRelease(claimId: string, command: McpRuntimeReleaseCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.release", "conflict", async function _Release(transaction, repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.commitRelease(claimId, command); });
	}

	/** Register the first Pod only under the matching release fence. */
	registerFirstPod(claimId: string, command: McpRuntimePodRegistrationCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.register_pod", "conflict", async function _Register(transaction, repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.registerFirstPod(claimId, command); });
	}

	/** Recover one expired invocation without waiting for its terminated companion Pod. */
	recoverExpiredInvocation(): Promise<boolean>
	{
		return this._run("mcp.runtime.controller.recover_expired_invocation", false, async function _Recover(transaction, repositories): Promise<boolean> { return repositories.companion.recoverNextExpiredInvocation(); });
	}

	/** Claim one command for the exact TokenReview-confirmed companion Pod. */
	claimCompanion(identity: RuntimeWorkloadIdentity, executionReference: string): Promise<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>
	{
		return this._run<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>("mcp.runtime.companion.claim", null, async function _ClaimCompanion(transaction, repositories) { return repositories.companion.claim(identity, executionReference); });
	}

	/** Save one checked companion result and all paired authority state. */
	completeCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionCompletionRequest): Promise<"completed" | "idempotent" | "conflict">
	{
		return this._run("mcp.runtime.companion.complete", "conflict", async function _Complete(transaction, repositories): Promise<"completed" | "idempotent" | "conflict"> { return repositories.companion.complete(identity, request); });
	}

	/** Save one definite discovery failure or ambiguous invocation result. */
	failCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionFailureRequest): Promise<"failed" | "idempotent" | "conflict">
	{
		return this._run("mcp.runtime.companion.fail", "conflict", async function _Fail(transaction, repositories): Promise<"failed" | "idempotent" | "conflict"> { return repositories.companion.fail(identity, request); });
	}

	/** Run one bounded serializable transaction and turn exhausted collisions into a safe outcome. */
	private async _run<Result>(spanName: string, conflict: Result, work: (transaction: Prisma.TransactionClient, repositories: { readonly catalog: PrismaMcpRuntimeCatalogRepository; readonly controller: PrismaMcpRuntimeControllerRepository; readonly companion: PrismaMcpRuntimeCompanionRepository }) => Promise<Result>): Promise<Result>
	{
		const dependencies = this._dependencies;
		const prisma = this._prisma;
		return ___DoWithTrace(spanName, {}, async function _TraceTransaction(): Promise<Result>
		{
			for (let attempt = 1; attempt <= _SERIALIZABLE_ATTEMPTS; attempt += 1)
			{
				try
				{
					return await prisma.$transaction(async function _Transaction(transaction): Promise<Result>
					{
						// 1. Bind authorization and every MCP repository to the same transaction.
						const mcpTasks = new PrismaMcpTaskToolInvocationLifecycleRepository(transaction);
						const toolInvocations = dependencies.toolInvocations.__ForTransaction(transaction, mcpTasks);
						const repositories = {
							catalog: new PrismaMcpRuntimeCatalogRepository(transaction, toolInvocations, dependencies.options),
							controller: new PrismaMcpRuntimeControllerRepository(transaction, dependencies.options),
							companion: new PrismaMcpRuntimeCompanionRepository(transaction, toolInvocations, dependencies.options),
						};

						// 2. Keep only database work in this callback; routers and controllers perform network I/O after commit.
						return work(transaction, repositories);
					}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
				}
				catch (error)
				{
					if (!(error instanceof Prisma.PrismaClientKnownRequestError) || (error.code !== "P2002" && error.code !== "P2034"))
						throw error;
				}
			}
			return conflict;
		});
	}
}

/** Reject unsafe identity, profile, and lease settings at process startup. */
function _AssertOptions(dependencies: PrismaMcpRuntimeAuthorityDependencies): void
{
	const options = dependencies.options;
	const dns = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u;
	if (!dns.test(options.executorNamespace) || options.executorNamespace.length > 63 || !dns.test(options.executorServiceAccountName) || options.executorServiceAccountName.length > 63 || options.profileName.length === 0 || options.profileName.length > 128 || options.siloId.length === 0 || !Number.isSafeInteger(options.controllerClaimLeaseMilliseconds) || options.controllerClaimLeaseMilliseconds < 1_000 || options.controllerClaimLeaseMilliseconds > 300_000 || !Number.isSafeInteger(options.companionClaimLeaseMilliseconds) || options.companionClaimLeaseMilliseconds < 1_000 || options.companionClaimLeaseMilliseconds > 300_000)
		throw new Error("MCP runtime authority requires fixed identities, profile, silo, and bounded leases");
}
