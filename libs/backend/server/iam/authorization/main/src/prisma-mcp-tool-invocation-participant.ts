import { type Prisma } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import { TOOL_INVOCATION_PREPARATION_POLICY, ExternalActionClaimKinds, ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import { ToolInvocationClaimOutcomes, ToolInvocationCompletionOutcomes, ToolInvocationEventTypes, ToolInvocationRunRecoveryEnterResults } from "./tool-invocation.types";
import type { McpTaskToolInvocationLifecycleParticipant, McpToolInvocationTransactionParticipant, McpToolInvocationTransactionParticipantFactory } from "./mcp-tool-invocation-participant.types";
import type { ToolInvocationClaim, ToolInvocationClaimResult, ToolInvocationCompletionResult, ToolInvocationLifecycleEvent, ToolInvocationLifecycleEventSink, ToolInvocationRecord, ToolInvocationRecoveryEvent, ToolInvocationRecoveryEventSink, ToolInvocationRunRecoveryAuthority, ToolInvocationRunRecoveryEnterResult, ToolResultDeliveryPayload } from "./tool-invocation.types";

/** Failure code stored when the companion cannot prove what the MCP server did. */
const _AMBIGUOUS_FAILURE_CODE = "external_action_provider_outcome_ambiguous";

/** Return true only for a persisted MCP task owner. */
function _IsMcpTaskOwned(invocation: ToolInvocationRecord): boolean
{
	return typeof invocation.mcpTaskId === "string";
}

/** Build the timeline event written after a checked MCP tool result succeeds. */
function _CompletedEvent(invocation: ToolInvocationRecord): ToolInvocationLifecycleEvent
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool completion requires a run owner");
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Completed, payload: { toolInvocationId: invocation.toolInvocationId } };
}

/** Build the timeline event written after a definite or uncertain MCP tool failure. */
function _FailedEvent(invocation: ToolInvocationRecord, reason: string, retrying: boolean): ToolInvocationLifecycleEvent
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool failure requires a run owner");
	return { runId: invocation.runId, attempt: invocation.attempt, eventType: ToolInvocationEventTypes.Failed, payload: { toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, reason, retryCount: invocation.preparationAttempt, retryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, retrying } };
}

/** Append the timeline event or abort the transaction when the owning run refuses it. */
async function _AppendLifecycleEvent(sink: ToolInvocationLifecycleEventSink, transaction: Prisma.TransactionClient, event: ToolInvocationLifecycleEvent): Promise<void>
{
	if (!await sink.appendInTransaction(transaction, event))
		throw new Error("tool invocation transition requires its canonical lifecycle event");
}

/** Append the manual-recovery event or abort the transaction when the owning run refuses it. */
async function _AppendRecoveryEvent(sink: ToolInvocationRecoveryEventSink, transaction: Prisma.TransactionClient, invocation: ToolInvocationRecord): Promise<void>
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool recovery event requires a run owner");
	const event: ToolInvocationRecoveryEvent = { runId: invocation.runId, expectedAttempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, preparationRetryCount: invocation.preparationAttempt, preparationRetryLimit: TOOL_INVOCATION_PREPARATION_POLICY.attemptLimit, providerOutcome: "unknown_after_dispatch" };
	if (!await sink.appendInTransaction(transaction, event))
		throw new Error("tool recovery state requires its canonical recovery event");
}

/** Move the run into recovery and write the matching event inside the same transaction. */
async function _EnterRecoveryRequired(authority: ToolInvocationRunRecoveryAuthority, sink: ToolInvocationRecoveryEventSink, transaction: Prisma.TransactionClient, invocation: ToolInvocationRecord): Promise<void>
{
	if (invocation.runId === null || invocation.attempt === null)
		throw new Error("AgentRun tool recovery requires a run owner");
	const outcome: ToolInvocationRunRecoveryEnterResult = await authority.enterRecoveryRequiredInTransaction(transaction, { runId: invocation.runId, attempt: invocation.attempt });
	if (outcome === ToolInvocationRunRecoveryEnterResults.Entered || outcome === ToolInvocationRunRecoveryEnterResults.AlreadyRecoveryRequired)
	{
		await _AppendRecoveryEvent(sink, transaction, invocation);
		return;
	}
	if (outcome === ToolInvocationRunRecoveryEnterResults.Cancelling)
		return;
	throw new Error("tool recovery state conflicts with its owning run attempt");
}

/**
 * Applies the authorization half of an MCP unit of work inside the transaction the MCP package owns.
 *
 * This adapter is a unit-of-work participant rather than a repository because it coordinates the
 * ToolInvocation row, result delivery, lifecycle event, and run recovery writers. It never opens a
 * transaction; the caller must create a new instance for each transaction callback.
 */
export class PrismaMcpToolInvocationParticipantUnitOfWork implements McpToolInvocationTransactionParticipant
{
	/** Writes ToolInvocation rows inside the caller's transaction. */
	private readonly _repository: PrismaToolInvocationRepository;
	/** Writes run timeline entries inside the caller's transaction. */
	private readonly _lifecycleEvents: ToolInvocationLifecycleEventSink;
	/** Writes recovery entries inside the caller's transaction. */
	private readonly _recoveryEvents: ToolInvocationRecoveryEventSink;
	/** Moves the owning run into recovery inside the caller's transaction. */
	private readonly _runRecovery: ToolInvocationRunRecoveryAuthority;
	/** Transaction shared with the MCP runtime write. */
	private readonly _transaction: Prisma.TransactionClient;
	/** MCP-owned terminal projection used only for task-owned invocations. */
	private readonly _mcpTasks: McpTaskToolInvocationLifecycleParticipant | null;

	/** Bind every authorization writer to the transaction already opened by the MCP authority. */
	constructor(transaction: Prisma.TransactionClient, lifecycleEvents: ToolInvocationLifecycleEventSink, recoveryEvents: ToolInvocationRecoveryEventSink, runRecovery: ToolInvocationRunRecoveryAuthority, mcpTasks: McpTaskToolInvocationLifecycleParticipant | null)
	{
		this._transaction = transaction;
		this._repository = new PrismaToolInvocationRepository(this._transaction);
		this._lifecycleEvents = lifecycleEvents;
		this._recoveryEvents = recoveryEvents;
		this._runRecovery = runRecovery;
		this._mcpTasks = mcpTasks;
	}

	/** Return the invocation row owned by the authorization package. */
	async findById(invocationId: string): Promise<ToolInvocationRecord | null>
	{
		return this._repository.findById(invocationId);
	}

	/** Claim dispatch, because the companion is about to call the uploaded MCP server. */
	async claim(invocationId: string, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>
	{
		const claimed = await this._repository.claim(invocationId, ExternalActionClaimKinds.Dispatch, now, leaseMilliseconds);
		if (claimed.outcome === ToolInvocationClaimOutcomes.Claimed && _IsMcpTaskOwned(claimed.invocation))
		{
			if (this._mcpTasks === null || !await this._mcpTasks.markClaimed(claimed.invocation, now))
				throw new Error("MCP task claim requires its durable task projection");
		}
		return claimed;
	}

	/** Save a checked success and its event without leaving the caller's transaction. */
	async completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>
	{
		const invocation = await this._repository.findById(claim.invocationId);
		if (invocation === null)
			return { outcome: ToolInvocationCompletionOutcomes.Missing };
		const payload: ToolResultDeliveryPayload = { toolInvocationId: invocation.toolInvocationId, outcome: "succeeded", result };
		const completed = await this._repository.complete(claim, payload, now);
		if (completed.outcome === ToolInvocationCompletionOutcomes.Completed)
		{
			if (_IsMcpTaskOwned(completed.invocation))
			{
				if (this._mcpTasks === null || !await this._mcpTasks.completeSucceeded(completed.invocation, result, now))
					throw new Error("MCP task success requires its durable task projection");
			}
			else await _AppendLifecycleEvent(this._lifecycleEvents, this._transaction, _CompletedEvent(completed.invocation));
		}
		return completed;
	}

	/** Save a definite failure and its event without leaving the caller's transaction. */
	async completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>
	{
		const invocation = await this._repository.findById(claim.invocationId);
		if (invocation === null)
			return { outcome: ToolInvocationCompletionOutcomes.Missing };
		const payload: ToolResultDeliveryPayload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode };
		const completed = await this._repository.complete(claim, payload, now);
		if (completed.outcome === ToolInvocationCompletionOutcomes.Completed)
		{
			if (_IsMcpTaskOwned(completed.invocation))
			{
				if (this._mcpTasks === null || !await this._mcpTasks.completeFailed(completed.invocation, completed.invocation.failureCode ?? "external_action_failed", now))
					throw new Error("MCP task failure requires its durable task projection");
			}
			else await _AppendLifecycleEvent(this._lifecycleEvents, this._transaction, _FailedEvent(completed.invocation, completed.invocation.failureCode ?? "external_action_failed", false));
		}
		return completed;
	}

	/** Save an uncertain outcome and enter the existing run recovery flow. */
	async completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>
	{
		const transition = await this._repository.completeAmbiguous(claim, now);
		if (!transition.changed || transition.invocation === null)
			return transition.invocation;
		const invocation = transition.invocation;
		if (_IsMcpTaskOwned(invocation))
		{
			if (this._mcpTasks === null || !await this._mcpTasks.completeAmbiguous(invocation, now))
				throw new Error("MCP task recovery requires its durable task projection");
			return invocation;
		}
		const retrying = invocation.state === ToolInvocationStates.Ready || invocation.state === ToolInvocationStates.Reconciling;
		await _AppendLifecycleEvent(this._lifecycleEvents, this._transaction, _FailedEvent(invocation, _AMBIGUOUS_FAILURE_CODE, retrying));
		if (invocation.state === ToolInvocationStates.RecoveryRequired)
			await _EnterRecoveryRequired(this._runRecovery, this._recoveryEvents, this._transaction, invocation);
		return invocation;
	}
}

/**
 * Builds the authorization-owned participant factory used by the OCI MCP runtime unit of work.
 *
 * The factory receives no Prisma client because it must never open a nested transaction. Every
 * participant writes through the transaction supplied by the MCP authority, while these three
 * ports keep run events and recovery changes owned by their existing packages.
 *
 * Called by: apps/opencrane/src/app/mcp-runtime-composition.ts.
 * @param lifecycleEvents - Runs-owned timeline writer used in the caller's transaction.
 * @param recoveryEvents - Runs-owned recovery-event writer used in the caller's transaction.
 * @param runRecovery - Runs-owned state authority used in the caller's transaction.
 * @returns A factory that binds authorization operations to one open Prisma transaction.
 */
export function __CreatePrismaMcpToolInvocationParticipantFactory(lifecycleEvents: ToolInvocationLifecycleEventSink, recoveryEvents: ToolInvocationRecoveryEventSink, runRecovery: ToolInvocationRunRecoveryAuthority): McpToolInvocationTransactionParticipantFactory
{
	return {
		__ForTransaction(transaction: unknown, mcpTasks?: McpTaskToolInvocationLifecycleParticipant): McpToolInvocationTransactionParticipant
		{
			return new PrismaMcpToolInvocationParticipantUnitOfWork(transaction as Prisma.TransactionClient, lifecycleEvents, recoveryEvents, runRecovery, mcpTasks ?? null);
		},
	};
}
