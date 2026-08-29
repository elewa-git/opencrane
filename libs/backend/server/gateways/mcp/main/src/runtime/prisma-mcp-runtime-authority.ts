import { Prisma, type PrismaClient } from "@prisma/client";

import type { McpCompanionClaimResponse, McpCompanionCompletionRequest, McpCompanionFailureRequest } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import type { RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { PrismaAuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";

import { PrismaMcpTaskToolInvocationLifecycleRepository } from "../mcp-tasks/prisma-mcp-task-tool-invocation-lifecycle";
import { PrismaMcpTaskWorkflowExhaustionRepository } from "../mcp-tasks/prisma-mcp-task-workflow-exhaustion-repository";
import type { McpTaskWorkflowInput, McpTaskWorkflowResult, McpTaskWorkflowRuntime } from "../mcp-tasks/mcp-task.types";
import { PrismaMcpRuntimeCompanionRepository } from "./prisma-mcp-runtime-companion-repository";
import { PrismaMcpRuntimeControllerRepository } from "./prisma-mcp-runtime-controller-repository";
import { PrismaMcpOciServerPromotionRepository } from "./prisma-mcp-oci-server-promotion-repository";
import { PrismaMcpToolInvocationAdmissionRepository } from "./prisma-mcp-tool-invocation-admission-repository";
import { McpRuntimeCompanionClaimOutcomes, type McpOciServerPromotionCaller, type McpOciServerPromotionCommand, type McpOciServerPromotionRepository, type McpOciServerPromotionResult, type McpRuntimeAuthority, type McpRuntimeCleanupCommand, type McpRuntimeControllerClaim, type McpRuntimeControllerCleanupClaim, type McpRuntimeControllerReleaseClaim, type McpRuntimeControllerWriteOutcome, type McpRuntimePodRegistrationCommand, type McpRuntimeReleaseCommand, type McpToolInvocationAdmissionRepository, type PrismaMcpRuntimeAuthorityDependencies } from "./mcp-runtime.types";

/** Maximum serializable retries when concurrent controller or companion writes collide. */
const _SERIALIZABLE_ATTEMPTS = 3;

/** Owns every database transaction that moves an OCI-backed MCP execution. */
export class PrismaMcpRuntimeUnitOfWork implements McpRuntimeAuthority, McpTaskWorkflowRuntime
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
		return this._run<McpOciServerPromotionResult>("mcp.runtime.promote", { outcome: "conflict" }, async function _Promote(repositories): Promise<McpOciServerPromotionResult> { return repositories.ociPromotion.promoteImportedValidation(caller, validationId, command); });
	}

	/** Admit one ready authorization-owned ToolInvocation as MCP runtime work. */
	admitInvocation(toolInvocationRowId: string): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp">
	{
		return this._run("mcp.runtime.admit_invocation", "not_ready", async function _Admit(repositories): Promise<"admitted" | "idempotent" | "not_ready" | "not_mcp"> { return repositories.invocationAdmission.admitInvocation(toolInvocationRowId); });
	}

	/** Close every row owned by a public task after its final workflow attempt. */
	recordWorkflowExhaustion(input: McpTaskWorkflowInput): Promise<McpTaskWorkflowResult | null>
	{
		return this._run("mcp.runtime.task.workflow_exhaustion", null, async function _RecordExhaustion(repositories): Promise<McpTaskWorkflowResult | null> { return repositories.workflowExhaustion.record(input); });
	}

	/** Claim one pending MCP workload for the controller. */
	claimNextController(): Promise<McpRuntimeControllerClaim | null>
	{
		return this._run("mcp.runtime.controller.claim", null, async function _Claim(repositories): Promise<McpRuntimeControllerClaim | null> { return repositories.controller.claimNext(); });
	}

	/** Bind one exact Kubernetes Job UID to the controller claim. */
	commitAssignment(binding: RuntimeWorkloadBinding): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.assign", "conflict", async function _Assign(repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.commitAssignment(binding); });
	}

	/** Claim one assigned Job for a fenced unsuspend. */
	claimNextRelease(): Promise<McpRuntimeControllerReleaseClaim | null>
	{
		return this._run("mcp.runtime.controller.claim_release", null, async function _ClaimRelease(repositories): Promise<McpRuntimeControllerReleaseClaim | null> { return repositories.controller.claimNextRelease(); });
	}

	/** Claim one terminal execution whose exact Kubernetes Job still needs deletion. */
	claimNextCleanup(): Promise<McpRuntimeControllerCleanupClaim | null>
	{
		return this._run("mcp.runtime.controller.claim_cleanup", null, async function _ClaimCleanup(repositories): Promise<McpRuntimeControllerCleanupClaim | null> { return repositories.controller.claimNextCleanup(); });
	}

	/** Commit the exact Kubernetes unsuspend under its release fence. */
	commitRelease(claimId: string, command: McpRuntimeReleaseCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.release", "conflict", async function _Release(repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.commitRelease(claimId, command); });
	}

	/** Record exact Job cleanup after a terminal execution closes. */
	commitCleanup(claimId: string, command: McpRuntimeCleanupCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.cleanup", "conflict", async function _Cleanup(repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.commitCleanup(claimId, command); });
	}

	/** Register the first Pod only under the matching release fence. */
	registerFirstPod(claimId: string, command: McpRuntimePodRegistrationCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		return this._run("mcp.runtime.controller.register_pod", "conflict", async function _Register(repositories): Promise<McpRuntimeControllerWriteOutcome> { return repositories.controller.registerFirstPod(claimId, command); });
	}

	/** Recover one expired invocation without waiting for its terminated companion Pod. */
	recoverExpiredInvocation(): Promise<boolean>
	{
		return this._run("mcp.runtime.controller.recover_expired_invocation", false, async function _Recover(repositories): Promise<boolean> { return repositories.companion.recoverNextExpiredInvocation(); });
	}

	/** Claim one command for the exact TokenReview-confirmed companion Pod. */
	claimCompanion(identity: RuntimeWorkloadIdentity, executionReference: string): Promise<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>
	{
		return this._run<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>("mcp.runtime.companion.claim", null, async function _ClaimCompanion(repositories) { return repositories.companion.claim(identity, executionReference); });
	}

	/** Save one checked companion result and all paired authority state. */
	completeCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionCompletionRequest): Promise<"completed" | "idempotent" | "conflict">
	{
		return this._run("mcp.runtime.companion.complete", "conflict", async function _Complete(repositories): Promise<"completed" | "idempotent" | "conflict"> { return repositories.companion.complete(identity, request); });
	}

	/** Save one definite discovery failure or ambiguous invocation result. */
	failCompanion(identity: RuntimeWorkloadIdentity, request: McpCompanionFailureRequest): Promise<"failed" | "idempotent" | "conflict">
	{
		return this._run("mcp.runtime.companion.fail", "conflict", async function _Fail(repositories): Promise<"failed" | "idempotent" | "conflict"> { return repositories.companion.fail(identity, request); });
	}

	/** Run one bounded serializable transaction and turn exhausted collisions into a safe outcome. */
	private async _run<Result>(spanName: string, conflict: Result, work: (repositories: { readonly ociPromotion: McpOciServerPromotionRepository; readonly invocationAdmission: McpToolInvocationAdmissionRepository; readonly controller: PrismaMcpRuntimeControllerRepository; readonly companion: PrismaMcpRuntimeCompanionRepository; readonly workflowExhaustion: PrismaMcpTaskWorkflowExhaustionRepository }) => Promise<Result>): Promise<Result>
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
						const authorization = new PrismaAuthorizationAuthority(transaction);
						const repositories = {
							ociPromotion: new PrismaMcpOciServerPromotionRepository(transaction, authorization, dependencies.options),
							invocationAdmission: new PrismaMcpToolInvocationAdmissionRepository(transaction, toolInvocations, dependencies.options),
							controller: new PrismaMcpRuntimeControllerRepository(transaction, dependencies.options),
							companion: new PrismaMcpRuntimeCompanionRepository(transaction, toolInvocations, dependencies.options),
							workflowExhaustion: new PrismaMcpTaskWorkflowExhaustionRepository(transaction, toolInvocations),
						};

						// 2. Keep only database work in this callback; routers and controllers perform network I/O after commit.
						return work(repositories);
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
