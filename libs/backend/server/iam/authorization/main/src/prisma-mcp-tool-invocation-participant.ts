import { type Prisma } from "@prisma/client";

import type { JsonValue } from "@opencrane/util";

import { _AppendMcpToolInvocationCompleted, _AppendMcpToolInvocationFailed, _EnterMcpToolInvocationRecovery, _MCP_AMBIGUOUS_FAILURE_CODE } from "./mcp-tool-invocation-lifecycle-events";
import type { McpToolInvocationTransactionParticipant, McpToolInvocationTransactionParticipantFactory } from "./mcp-tool-invocation-participant.types";
import { PrismaToolInvocationRepository } from "./prisma-tool-invocation-repository";
import { ExternalActionClaimKinds, ToolInvocationStates } from "./tool-invocation-lifecycle.types";
import { ToolInvocationCompletionOutcomes } from "./tool-invocation.types";
import type { ToolInvocationClaim, ToolInvocationClaimResult, ToolInvocationCompletionResult, ToolInvocationLifecycleEventSink, ToolInvocationRecord, ToolInvocationRecoveryEventSink, ToolInvocationRunRecoveryAuthority, ToolResultDeliveryPayload } from "./tool-invocation.types";

/**
 * Applies authorization-owned MCP state changes inside the transaction supplied by the MCP runtime.
 *
 * This unit of work owns ToolInvocation persistence but delegates matching timeline and recovery
 * writes through existing runs-owned ports. It never opens a transaction.
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

	/** Binds every authorization writer to the transaction already opened by the MCP authority. */
	constructor(transaction: Prisma.TransactionClient, lifecycleEvents: ToolInvocationLifecycleEventSink, recoveryEvents: ToolInvocationRecoveryEventSink, runRecovery: ToolInvocationRunRecoveryAuthority)
	{
		this._transaction = transaction;
		this._repository = new PrismaToolInvocationRepository(this._transaction);
		this._lifecycleEvents = lifecycleEvents;
		this._recoveryEvents = recoveryEvents;
		this._runRecovery = runRecovery;
	}

	/** Returns the invocation row owned by the authorization package. */
	async findById(invocationId: string): Promise<ToolInvocationRecord | null>
	{
		return this._repository.findById(invocationId);
	}

	/** Claims dispatch because the companion is about to call the uploaded MCP server. */
	async claim(invocationId: string, now: Date, leaseMilliseconds: number): Promise<ToolInvocationClaimResult>
	{
		return this._repository.claim(invocationId, ExternalActionClaimKinds.Dispatch, now, leaseMilliseconds);
	}

	/** Saves a checked success and its timeline event without leaving the caller's transaction. */
	async completeSucceeded(claim: ToolInvocationClaim, result: JsonValue, now: Date): Promise<ToolInvocationCompletionResult>
	{
		const invocation = await this._repository.findById(claim.invocationId);
		if (invocation === null)
			return { outcome: ToolInvocationCompletionOutcomes.Missing };
		const payload: ToolResultDeliveryPayload = { toolInvocationId: invocation.toolInvocationId, outcome: "succeeded", result };
		const completed = await this._repository.complete(claim, payload, now);
		if (completed.outcome === ToolInvocationCompletionOutcomes.Completed)
			await _AppendMcpToolInvocationCompleted(this._lifecycleEvents, this._transaction, completed.invocation);
		return completed;
	}

	/** Saves a definite failure and its timeline event without leaving the caller's transaction. */
	async completeFailed(claim: ToolInvocationClaim, failureCode: string, now: Date): Promise<ToolInvocationCompletionResult>
	{
		const invocation = await this._repository.findById(claim.invocationId);
		if (invocation === null)
			return { outcome: ToolInvocationCompletionOutcomes.Missing };
		const payload: ToolResultDeliveryPayload = { toolInvocationId: invocation.toolInvocationId, outcome: "failed", failureCode };
		const completed = await this._repository.complete(claim, payload, now);
		if (completed.outcome === ToolInvocationCompletionOutcomes.Completed)
			await _AppendMcpToolInvocationFailed(this._lifecycleEvents, this._transaction, completed.invocation, completed.invocation.failureCode ?? "external_action_failed", false);
		return completed;
	}

	/** Saves an uncertain outcome before it enters the existing run-owned recovery flow. */
	async completeAmbiguous(claim: ToolInvocationClaim, now: Date): Promise<ToolInvocationRecord | null>
	{
		const transition = await this._repository.completeAmbiguous(claim, now);
		if (!transition.changed || transition.invocation === null)
			return transition.invocation;
		const invocation = transition.invocation;
		const retrying = invocation.state === ToolInvocationStates.Ready || invocation.state === ToolInvocationStates.Reconciling;
		await _AppendMcpToolInvocationFailed(this._lifecycleEvents, this._transaction, invocation, _MCP_AMBIGUOUS_FAILURE_CODE, retrying);
		if (invocation.state === ToolInvocationStates.RecoveryRequired)
			await _EnterMcpToolInvocationRecovery(this._runRecovery, this._recoveryEvents, this._transaction, invocation);
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
		__ForTransaction(transaction: unknown): McpToolInvocationTransactionParticipant
		{
			return new PrismaMcpToolInvocationParticipantUnitOfWork(transaction as Prisma.TransactionClient, lifecycleEvents, recoveryEvents, runRecovery);
		},
	};
}
