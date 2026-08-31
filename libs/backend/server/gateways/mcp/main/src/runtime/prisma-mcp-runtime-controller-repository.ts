import { McpExecutorWorkloadState, type Prisma } from "@prisma/client";

import { RuntimeWorkloadClaimClasses, type RuntimeWorkloadBinding } from "@opencrane/backend/agents/runtime/workloads/contract";

import { _McpRuntimeLeaseExpiryProposal, _McpRuntimeTimestampProposal } from "./mcp-runtime-timestamps";
import type { McpRuntimeAuthorityOptions, McpRuntimeControllerClaim, McpRuntimeControllerReleaseClaim, McpRuntimeControllerRepository, McpRuntimeControllerWriteOutcome, McpRuntimePodRegistrationCommand, McpRuntimeReleaseCommand } from "./mcp-runtime.types";

/** Claims MCP executions and records their Kubernetes Job identity inside one transaction. */
export class PrismaMcpRuntimeControllerRepository implements McpRuntimeControllerRepository
{
	/** Prisma client for this open transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Deployment-owned profile, silo, and lease duration. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Bind controller writes to one transaction and fixed deployment policy. */
	constructor(transaction: Prisma.TransactionClient, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._options = options;
	}

	/** Claim one pending execution using the database clock and monotonic delivery count. */
	async claimNext(): Promise<McpRuntimeControllerClaim | null>
	{
		// 1. Let the database function lock one eligible row without blocking another controller.
		const candidate = await this._transaction.mcpRuntimeClaimCandidate.findFirst({ where: { siloId: this._options.siloId, profileName: this._options.profileName } });
		if (candidate === null)
			return null;
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { id: candidate.id, siloId: this._options.siloId }, include: { serverRevision: { select: { registryReference: true } } } });
		if (execution === null || execution.workloadState !== McpExecutorWorkloadState.Pending || execution.profileName !== this._options.profileName)
			return null;

		// 2. Propose only the lease length; the trigger replaces both timestamps with database time.
		const deliveryCount = execution.deliveryCount + 1;
		const claimed = await this._transaction.mcpRuntimeExecution.updateManyAndReturn({
			where: { id: execution.id, siloId: this._options.siloId, workloadState: McpExecutorWorkloadState.Pending, claimedAt: execution.claimedAt, claimExpiresAt: execution.claimExpiresAt, deliveryCount: execution.deliveryCount },
			data: { claimedAt: _McpRuntimeTimestampProposal, claimExpiresAt: _McpRuntimeLeaseExpiryProposal(this._options.controllerClaimLeaseMilliseconds), deliveryCount },
			select: { claimedAt: true, claimExpiresAt: true },
		});
		const lease = claimed[0];
		if (lease === undefined || lease.claimedAt === null || lease.claimExpiresAt === null)
			throw new Error("MCP runtime controller claim lost its database fence");

		// 3. Return only the class-neutral lease plus the immutable image needed by the MCP executor.
		return {
			claim: {
				claimId: execution.id,
				siloId: execution.siloId,
				workloadClass: RuntimeWorkloadClaimClasses.McpExecutor,
				profileName: execution.profileName,
				idempotencyKey: execution.idempotencyKey,
				claimedAt: lease.claimedAt.toISOString(),
				deliveryCount,
				expiresAt: lease.claimExpiresAt.toISOString(),
				executionReference: execution.executionReference,
			},
			registryReference: execution.serverRevision.registryReference,
		};
	}

	/** Bind the exact Kubernetes Job UID while the current controller lease is valid. */
	async commitAssignment(binding: RuntimeWorkloadBinding): Promise<McpRuntimeControllerWriteOutcome>
	{
		if (!_AssignmentIsValid(binding, this._options.profileName))
			return "conflict";
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { id: binding.claimId, siloId: this._options.siloId } });
		if (execution === null)
			return "conflict";
		if (execution.workloadState !== McpExecutorWorkloadState.Pending)
			return execution.workloadUid === binding.workloadUid && _SameControllerFence(execution, binding) ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (!_SameControllerFence(execution, binding) || execution.claimExpiresAt === null || now >= execution.claimExpiresAt)
			return "conflict";
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, siloId: this._options.siloId, workloadState: McpExecutorWorkloadState.Pending, claimedAt: execution.claimedAt, claimExpiresAt: execution.claimExpiresAt, deliveryCount: execution.deliveryCount, workloadUid: null }, data: { workloadState: McpExecutorWorkloadState.Assigned, workloadUid: binding.workloadUid, assignedAt: _McpRuntimeTimestampProposal } });
		return updated.count === 1 ? "assigned" : "conflict";
	}

	/** Claim one assigned or released Job for release and first-Pod registration. */
	async claimNextRelease(): Promise<McpRuntimeControllerReleaseClaim | null>
	{
		const candidate = await this._transaction.mcpRuntimeReleaseClaimCandidate.findFirst({ where: { siloId: this._options.siloId, profileName: this._options.profileName } });
		if (candidate === null)
			return null;
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { id: candidate.id, siloId: this._options.siloId }, include: { serverRevision: { select: { registryReference: true } } } });
		if (execution === null || (execution.workloadState !== McpExecutorWorkloadState.Assigned && execution.workloadState !== McpExecutorWorkloadState.Released) || execution.workloadUid === null || execution.claimedAt === null || execution.claimExpiresAt === null || execution.podUid !== null)
			return null;
		const releaseDeliveryCount = execution.releaseDeliveryCount + 1;
		const claimed = await this._transaction.mcpRuntimeExecution.updateManyAndReturn({
			where: { id: execution.id, siloId: this._options.siloId, workloadState: execution.workloadState, podUid: null, releaseClaimedAt: execution.releaseClaimedAt, releaseExpiresAt: execution.releaseExpiresAt, releaseDeliveryCount: execution.releaseDeliveryCount },
			data: { releaseClaimedAt: _McpRuntimeTimestampProposal, releaseExpiresAt: _McpRuntimeLeaseExpiryProposal(this._options.controllerClaimLeaseMilliseconds), releaseDeliveryCount },
			select: { releaseClaimedAt: true, releaseExpiresAt: true },
		});
		const lease = claimed[0];
		if (lease === undefined || lease.releaseClaimedAt === null || lease.releaseExpiresAt === null)
			throw new Error("MCP runtime release claim lost its database fence");
		return {
			claim: {
				claimId: execution.id,
				siloId: execution.siloId,
				workloadClass: RuntimeWorkloadClaimClasses.McpExecutor,
				profileName: execution.profileName,
				idempotencyKey: execution.idempotencyKey,
				claimedAt: execution.claimedAt.toISOString(),
				deliveryCount: execution.deliveryCount,
				expiresAt: execution.claimExpiresAt.toISOString(),
				executionReference: execution.executionReference,
			},
			registryReference: execution.serverRevision.registryReference,
			workloadUid: execution.workloadUid,
			releaseClaimedAt: lease.releaseClaimedAt.toISOString(),
			releaseDeliveryCount,
			releaseExpiresAt: lease.releaseExpiresAt.toISOString(),
		};
	}

	/** Record the exact successful unsuspend operation under its current release fence. */
	async commitRelease(claimId: string, command: McpRuntimeReleaseCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		if (!_ReleaseIsValid(claimId, command))
			return "conflict";
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { id: claimId, siloId: this._options.siloId } });
		if (execution === null)
			return "conflict";
		if (execution.workloadState === McpExecutorWorkloadState.Released || execution.workloadState === McpExecutorWorkloadState.Registered || execution.workloadState === McpExecutorWorkloadState.Closed)
			return _SameReleaseFence(execution, command) ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (execution.workloadState !== McpExecutorWorkloadState.Assigned || !_SameReleaseFence(execution, command) || execution.releaseExpiresAt === null || now >= execution.releaseExpiresAt)
			return "conflict";
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, siloId: this._options.siloId, workloadState: McpExecutorWorkloadState.Assigned, workloadUid: command.workloadUid, releaseClaimedAt: execution.releaseClaimedAt, releaseExpiresAt: execution.releaseExpiresAt, releaseDeliveryCount: execution.releaseDeliveryCount }, data: { workloadState: McpExecutorWorkloadState.Released, releasedAt: _McpRuntimeTimestampProposal } });
		return updated.count === 1 ? "released" : "conflict";
	}

	/** Record the first Pod only after the matching Job was released under the same fence. */
	async registerFirstPod(claimId: string, command: McpRuntimePodRegistrationCommand): Promise<McpRuntimeControllerWriteOutcome>
	{
		if (!_ReleaseIsValid(claimId, command) || command.podUid.length === 0)
			return "conflict";
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { id: claimId, siloId: this._options.siloId } });
		if (execution === null)
			return "conflict";
		if (execution.podUid !== null)
			return execution.podUid === command.podUid && _SameReleaseFence(execution, command) ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (execution.workloadState !== McpExecutorWorkloadState.Released || execution.releasedAt === null || !_SameReleaseFence(execution, command) || execution.releaseExpiresAt === null || now >= execution.releaseExpiresAt)
			return "conflict";
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, siloId: this._options.siloId, workloadState: McpExecutorWorkloadState.Released, workloadUid: command.workloadUid, podUid: null, releaseClaimedAt: execution.releaseClaimedAt, releaseExpiresAt: execution.releaseExpiresAt, releaseDeliveryCount: execution.releaseDeliveryCount }, data: { workloadState: McpExecutorWorkloadState.Registered, podUid: command.podUid } });
		return updated.count === 1 ? "registered" : "conflict";
	}

	/** Read millisecond database time through the fixed view used by every fence check. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("MCP runtime database clock unavailable");
		return clock.now;
	}
}

/** Validate the controller binding before reading a durable execution. */
function _AssignmentIsValid(binding: RuntimeWorkloadBinding, expectedProfileName: string): boolean
{
	return binding.claimId.length > 0 && binding.workloadUid.length > 0 && binding.profileName === expectedProfileName && Number.isSafeInteger(binding.deliveryCount) && binding.deliveryCount >= 1 && Number.isFinite(Date.parse(binding.claimedAt));
}

/** Compare one saved controller fence with the returned Job binding. */
function _SameControllerFence(execution: { readonly claimedAt: Date | null; readonly deliveryCount: number; readonly profileName: string }, binding: RuntimeWorkloadBinding): boolean
{
	return execution.claimedAt?.getTime() === Date.parse(binding.claimedAt) && execution.deliveryCount === binding.deliveryCount && execution.profileName === binding.profileName;
}

/** Validate the release coordinates before loading the execution. */
function _ReleaseIsValid(claimId: string, command: McpRuntimeReleaseCommand): boolean
{
	return claimId.length > 0 && command.workloadUid.length > 0 && Number.isSafeInteger(command.releaseDeliveryCount) && command.releaseDeliveryCount >= 1 && Number.isFinite(Date.parse(command.releaseClaimedAt));
}

/** Compare a controller release command with the saved Job and release fence. */
function _SameReleaseFence(execution: { readonly workloadUid: string | null; readonly releaseClaimedAt: Date | null; readonly releaseDeliveryCount: number }, command: McpRuntimeReleaseCommand): boolean
{
	return execution.workloadUid === command.workloadUid && execution.releaseClaimedAt?.getTime() === Date.parse(command.releaseClaimedAt) && execution.releaseDeliveryCount === command.releaseDeliveryCount;
}
