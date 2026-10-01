import { randomUUID } from "node:crypto";

import { McpApprovalStatus, McpExecutionTransport, McpExecutorCommandState, McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, type Prisma } from "@prisma/client";

import { MCP_PROTOCOL_VERSION, type McpToolCallResult } from "@opencrane/contracts";
import { ExternalActionClaimKinds, PrismaAuthorizationAuthority, ToolInvocationClaimOutcomes, ToolInvocationCompletionOutcomes, ToolInvocationStates, type McpToolInvocationTransactionParticipant, type ProductAuthorizationWorkloadContext, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __McpConnectionEndpointDigest } from "../connections/mcp-connection-digests";
import type { McpConnectionReadiness } from "../connections/mcp-connection-readiness.types";
import type { McpInvocationResultParticipant } from "./mcp-invocation-result.types";
import { PrismaMcpInvocationCompletionRepository } from "./prisma-mcp-invocation-completion-repository";
import { McpInvocationOwnerKinds, RemoteMcpDispatchClaimOutcomes, type McpInvocationDispatchTarget, type RemoteMcpDispatchClaim, type RemoteMcpDispatchClaimResult, type RemoteMcpDispatchRepository } from "./remote-mcp-invocation.types";

/** Definite failure saved when current remote connection authority ends before provider dispatch. */
const _REMOTE_AUTHORITY_ENDED = "mcp_remote_authority_ended";

/** Failure saved when the owning workflow reaches its final retry. */
const _WORKFLOW_ATTEMPTS_EXHAUSTED = "workflow_attempts_exhausted";

/** Transaction-scoped authority for one server-mediated remote MCP effect. */
export class PrismaRemoteMcpDispatchRepository implements RemoteMcpDispatchRepository
{
	/** Bind every connection, authorization, runtime, and ToolInvocation write to one transaction. */
	constructor(private readonly transaction: Prisma.TransactionClient, private readonly toolInvocations: McpToolInvocationTransactionParticipant, private readonly connectionReadiness: McpConnectionReadiness, private readonly invocationResults: McpInvocationResultParticipant, private readonly claimLeaseMilliseconds: number)
	{
		if (!Number.isSafeInteger(claimLeaseMilliseconds) || claimLeaseMilliseconds < 1_000 || claimLeaseMilliseconds > 300_000)
			throw new Error("remote MCP dispatch requires a bounded claim lease");
	}

	/**
	 * Claims one remote effect in the caller's serializable transaction.
	 * The procedure reads the runtime first, locks the installation and then its active connection
	 * through the shared readiness authority, records current permissions, claims the ToolInvocation,
	 * and finally saves the matching runtime fence. The runtime trigger rechecks the locked connection.
	 * A retry resumes an expired saved claim without calling the provider
	 * again. Any loss after the ToolInvocation changes throws so the transaction rolls back.
	 */
	async claim(target: McpInvocationDispatchTarget, workload?: ProductAuthorizationWorkloadContext): Promise<RemoteMcpDispatchClaimResult>
	{
		// 1. Select the runtime from public owner coordinates and resolve a durable earlier winner.
		const execution = await this.transaction.mcpRuntimeExecution.findFirst({
			where: { siloId: target.siloId, toolInvocation: { is: _InvocationOwner(target) } },
			select: _REMOTE_EXECUTION_SELECT,
		});
		if (execution === null)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		if (execution.transport === McpExecutionTransport.OciImage)
			return { outcome: RemoteMcpDispatchClaimOutcomes.NotRemote };
		if (execution.transport !== McpExecutionTransport.RemoteHttp || execution.kind !== McpRuntimeExecutionKind.Invocation)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		if (_CommandIsTerminal(execution.commandState))
			return { outcome: RemoteMcpDispatchClaimOutcomes.Terminal };
		if (execution.commandState === McpExecutorCommandState.Claimed)
			return this._RecoverPreviousClaim(execution);
		if (execution.commandState !== McpExecutorCommandState.Pending)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		if (workload === undefined)
			return { outcome: RemoteMcpDispatchClaimOutcomes.IdentityRequired };

		// 2. Load the ToolInvocation before the installation lock so every later check uses its saved revision.
		if (execution.toolInvocationId === null)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		const invocation = await this.toolInvocations.findById(execution.toolInvocationId);
		const now = await this._databaseNow();
		if (invocation === null)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		const currentTarget = await this._LoadCurrentTarget(execution, invocation);
		if (currentTarget === null || !await this._AdmitCurrentPermissions(execution, invocation, workload, now))
		{
			await this._CompleteDeniedBeforeDispatch(execution, invocation, now);
			return { outcome: RemoteMcpDispatchClaimOutcomes.Denied };
		}

		// 3. Claim the ToolInvocation only after connection and product authority are current.
		const claimResult = await this.toolInvocations.claim(invocation.id, now, this.claimLeaseMilliseconds, workload);
		if (claimResult.outcome === ToolInvocationClaimOutcomes.Missing)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		if (claimResult.outcome === ToolInvocationClaimOutcomes.Winner)
			return _InvocationIsTerminal(claimResult.invocation.state)
				? { outcome: RemoteMcpDispatchClaimOutcomes.Terminal }
				: { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		// 4. Save the paired runtime fence. A conflict here must roll back the ToolInvocation claim.
		const remoteClaimFence = randomUUID();
		const updated = await this.transaction.mcpRuntimeExecution.updateMany({
			where: { id: execution.id, transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null },
			data: _RemoteClaimUpdate(remoteClaimFence, this.claimLeaseMilliseconds, claimResult.claim),
		});
		if (updated.count !== 1)
			throw new Error("remote MCP dispatch lost its runtime claim fence");
		const savedClaim = await this.transaction.mcpRuntimeExecution.findFirst({
			where: {
				id: execution.id,
				commandState: McpExecutorCommandState.Claimed,
				remoteClaimFence,
				toolInvocationId: claimResult.claim.invocationId,
				toolInvocationClaimFence: claimResult.claim.fence,
				toolInvocationClaimRevision: claimResult.claim.revision,
			},
			select: { remoteClaimExpiresAt: true },
		});
		const invocationClaimExpiresAt = claimResult.invocation.claimExpiresAt;
		if (savedClaim?.remoteClaimExpiresAt === null || savedClaim?.remoteClaimExpiresAt === undefined || invocationClaimExpiresAt === null)
			throw new Error("remote MCP dispatch did not retain both claim deadlines");
		const notAfterEpochMs = Math.min(savedClaim.remoteClaimExpiresAt.getTime(), invocationClaimExpiresAt.getTime());
		const deadlineCheckedAt = await this._databaseNow();
		const remainingClaimMilliseconds = Math.floor(notAfterEpochMs - deadlineCheckedAt.getTime());
		if (!Number.isSafeInteger(notAfterEpochMs) || !Number.isSafeInteger(remainingClaimMilliseconds) || remainingClaimMilliseconds < 1)
			throw new Error("remote MCP dispatch claim deadline is not current");
		return {
			outcome: RemoteMcpDispatchClaimOutcomes.Claimed,
			claim: {
				executionId: execution.id,
				notAfterEpochMs,
				remainingClaimMilliseconds,
				remoteClaimFence,
				toolInvocationClaim: claimResult.claim,
				binding: _Binding(execution),
				endpoint: currentTarget.endpoint,
				toolName: currentTarget.toolName,
				arguments: invocation.effectiveArguments,
				inputSchema: currentTarget.inputSchema,
			},
		};
	}

	/** Save a checked remote result and both terminal projections. */
	async completeSucceeded(claim: RemoteMcpDispatchClaim, result: McpToolCallResult): Promise<boolean>
	{
		const now = await this._databaseNow();
		const remoteClaimExpiresAt = await this._LoadCurrentCompletion(claim, now);
		if (remoteClaimExpiresAt === null)
			return false;
		const completion = new PrismaMcpInvocationCompletionRepository(this.transaction, this.toolInvocations, this.invocationResults);
		const completionResult = await completion.completeResult({
			executionId: claim.executionId,
			remoteClaimFence: claim.remoteClaimFence,
			remoteNotAfterEpochMs: remoteClaimExpiresAt.getTime(),
			result,
			serverRevisionId: claim.binding.serverRevisionId,
			siloId: claim.binding.siloId,
			toolClaim: claim.toolInvocationClaim,
		}, now);
		if (completionResult === null)
			return false;
		if (!await this._CloseClaim(claim, McpExecutorCommandState.Succeeded, "succeeded", ___DigestCanonicalJson(completionResult.result as unknown as JsonValue), completionResult.completedAt))
			throw new Error("remote MCP success lost its runtime transition");
		return true;
	}

	/** Reload the exact remote effect fence and immutable binding before any result participant runs. */
	private async _LoadCurrentCompletion(claim: RemoteMcpDispatchClaim, now: Date): Promise<Date | null>
	{
		const binding = claim.binding;
		const execution = await this.transaction.mcpRuntimeExecution.findFirst({
			where: {
				id: claim.executionId,
				siloId: binding.siloId,
				kind: McpRuntimeExecutionKind.Invocation,
				transport: McpExecutionTransport.RemoteHttp,
				commandState: McpExecutorCommandState.Claimed,
				remoteClaimFence: claim.remoteClaimFence,
				remoteClaimExpiresAt: { gt: now },
				toolInvocationId: claim.toolInvocationClaim.invocationId,
				toolInvocationClaimFence: claim.toolInvocationClaim.fence,
				toolInvocationClaimRevision: claim.toolInvocationClaim.revision,
				serverRevisionId: binding.serverRevisionId,
				connectionId: binding.connectionId,
				connectionGeneration: binding.connectionGeneration,
				connectionOwnerPrincipalId: binding.connectionOwnerPrincipalId,
				endpointDigest: binding.endpointDigest,
				credentialSecretUid: binding.credentialSecretUid,
				credentialSecretResourceVersion: binding.credentialSecretResourceVersion,
				serverRevision: { is: { mcpServerId: binding.mcpServerId, protocolVersion: binding.protocolVersion } },
			},
			select: { remoteClaimExpiresAt: true },
		});
		if (execution?.remoteClaimExpiresAt === null || execution?.remoteClaimExpiresAt === undefined || execution.remoteClaimExpiresAt <= now)
			return null;
		return execution.remoteClaimExpiresAt;
	}

	/** Save a definite pre-dispatch failure and both terminal projections. */
	async completeFailed(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>
	{
		const now = await this._databaseNow();
		const completed = await this.toolInvocations.completeFailed(claim.toolInvocationClaim, failureCode, now);
		if (completed.outcome === ToolInvocationCompletionOutcomes.Missing)
			return false;
		if (completed.outcome === ToolInvocationCompletionOutcomes.Winner
			&& (completed.invocation.state !== ToolInvocationStates.Failed || completed.invocation.failureCode !== failureCode))
			return false;
		if (!await this._CloseClaim(claim, McpExecutorCommandState.Failed, failureCode, ___DigestCanonicalJson({ failureCode } as JsonValue), now))
			throw new Error("remote MCP failure lost its runtime transition");
		return true;
	}

	/** Save manual recovery after a request may have reached the remote provider. */
	async completeAmbiguous(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<boolean>
	{
		const now = await this._databaseNow();
		const recovered = await this.toolInvocations.completeAmbiguous(claim.toolInvocationClaim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			return false;
		if (!await this._CloseClaim(claim, McpExecutorCommandState.RecoveryRequired, failureCode, ___DigestCanonicalJson({ failureCode } as JsonValue), now))
			throw new Error("remote MCP recovery lost its runtime transition");
		return true;
	}

	/** Close one exact remote invocation when its owning workflow cannot retry again. */
	async settleExhausted(target: McpInvocationDispatchTarget): Promise<boolean>
	{
		const execution = await this.transaction.mcpRuntimeExecution.findFirst({
			where: { siloId: target.siloId, toolInvocation: { is: _InvocationOwner(target) } },
			select: _REMOTE_EXECUTION_SELECT,
		});
		if (execution === null || execution.transport !== McpExecutionTransport.RemoteHttp || execution.kind !== McpRuntimeExecutionKind.Invocation)
			return false;
		if (_CommandIsTerminal(execution.commandState))
			return true;
		if (execution.toolInvocationId === null)
			return false;
		const invocation = await this.toolInvocations.findById(execution.toolInvocationId);
		if (invocation === null)
			return false;
		const now = await this._databaseNow();
		if (execution.commandState === McpExecutorCommandState.Pending)
		{
			const completed = await this.toolInvocations.completeUnusedBeforeDispatch(invocation.id, invocation.revision, _WORKFLOW_ATTEMPTS_EXHAUSTED, now);
			if (!completed.changed || completed.invocation?.state !== ToolInvocationStates.Failed)
				return false;
			const digest = ___DigestCanonicalJson({ failureCode: _WORKFLOW_ATTEMPTS_EXHAUSTED } as JsonValue);
			const updated = await this.transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, remoteClaimExpiresAt: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null }, data: { commandState: McpExecutorCommandState.Failed, terminalOutcome: _WORKFLOW_ATTEMPTS_EXHAUSTED, terminalPayloadDigest: digest, completedAt: now } });
			if (updated.count !== 1)
				throw new Error("exhausted remote MCP work lost its runtime transition");
			return true;
		}
		if (execution.commandState !== McpExecutorCommandState.Claimed || execution.remoteClaimFence === null)
			return false;
		const claim = _SavedToolClaim(execution);
		if (claim === null)
			return false;
		const recovered = await this.toolInvocations.completeAmbiguous(claim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			return false;
		const digest = ___DigestCanonicalJson({ failureCode: _WORKFLOW_ATTEMPTS_EXHAUSTED } as JsonValue);
		if (!await this._CloseClaim({ executionId: execution.id, remoteClaimFence: execution.remoteClaimFence, toolInvocationClaim: claim }, McpExecutorCommandState.RecoveryRequired, _WORKFLOW_ATTEMPTS_EXHAUSTED, digest, now))
			throw new Error("exhausted remote MCP claim lost its runtime transition");
		return true;
	}

	/** Recheck the complete frozen target and acquire the connection row before provider dispatch. */
	private async _LoadCurrentTarget(execution: _RemoteExecution, invocation: ToolInvocationRecord): Promise<_RemoteTarget | null>
	{
		const binding = _Binding(execution);
		if (execution.serverRevision.transport !== McpExecutionTransport.RemoteHttp
			|| execution.serverRevision.connectionId !== binding.connectionId || execution.serverRevision.connectionGeneration !== binding.connectionGeneration
			|| execution.serverRevision.connectionOwnerPrincipalId !== binding.connectionOwnerPrincipalId || execution.serverRevision.endpointDigest !== binding.endpointDigest
			|| execution.serverRevision.state !== McpServerRevisionState.Ready || execution.serverRevision.protocolVersion !== MCP_PROTOCOL_VERSION
			|| execution.serverRevision.server.status !== McpServerStatus.Active || execution.serverRevision.server.approvalStatus !== McpApprovalStatus.Published
			|| __McpConnectionEndpointDigest(execution.serverRevision.server.endpoint) !== binding.endpointDigest)
			return null;
		const tool = execution.serverRevision.tools.find(value => value.id === invocation.toolRevisionId);
		if (tool === undefined || tool.siloId !== execution.siloId)
			return null;
		const locked = await this.connectionReadiness.lockForDispatch({ siloId: execution.siloId, toolRevisionId: invocation.toolRevisionId, ownerPrincipalId: binding.connectionOwnerPrincipalId });
		return locked ? { endpoint: execution.serverRevision.server.endpoint, toolName: tool.name, inputSchema: tool.inputSchema as JsonValue } : null;
	}

	/** Record current tool and provider-connection permission under the verified server identity. */
	private async _AdmitCurrentPermissions(execution: _RemoteExecution, invocation: ToolInvocationRecord, workload: ProductAuthorizationWorkloadContext, now: Date): Promise<boolean>
	{
		const binding = _Binding(execution);
		if (invocation.mcpTaskId !== null && !await this._AdmitPermission(binding.connectionOwnerPrincipalId, invocation, workload, ProductAuthorizationResourceKinds.McpToolRevision, invocation.toolRevisionId, ProductAuthorizationActions.Invoke, now))
			return false;
		return this._AdmitPermission(binding.connectionOwnerPrincipalId, invocation, workload, ProductAuthorizationResourceKinds.ProviderConnection, binding.connectionId, ProductAuthorizationActions.Use, now);
	}

	/** Record one current effect permission without letting external input select its resource. */
	private async _AdmitPermission(principalId: string, invocation: ToolInvocationRecord, workload: ProductAuthorizationWorkloadContext, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision | ProductAuthorizationResourceKinds.ProviderConnection, resourceId: string, action: ProductAuthorizationActions.Invoke | ProductAuthorizationActions.Use, now: Date): Promise<boolean>
	{
		const authorization = new PrismaAuthorizationAuthority(this.transaction);
		const decision = await authorization.admitPrincipal({
			siloId: invocation.siloId,
			principalId,
			actorKind: "workload",
			actorId: workload.podUid,
			workload,
			resource: { kind: resourceKind, id: resourceId },
			action,
			argumentsDigest: invocation.effectiveArgumentsDigest as `sha256:${string}`,
			nowEpochMs: now.getTime(),
		});
		return decision.outcome === AuthorizationDecisionOutcomes.Allow && decision.evidence !== null;
	}

	/** Close Ready work when current target or provider permission denies before dispatch. */
	private async _CompleteDeniedBeforeDispatch(execution: _RemoteExecution, invocation: ToolInvocationRecord, now: Date): Promise<void>
	{
		const completed = await this.toolInvocations.completeUnusedBeforeDispatch(invocation.id, invocation.revision, _REMOTE_AUTHORITY_ENDED, now);
		if (!completed.changed || completed.invocation?.state !== ToolInvocationStates.Failed)
			throw new Error("remote MCP denial lost its unused ToolInvocation transition");
		const terminalDigest = ___DigestCanonicalJson({ failureCode: _REMOTE_AUTHORITY_ENDED } as JsonValue);
		const updated = await this.transaction.mcpRuntimeExecution.updateMany({
			where: { id: execution.id, transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Pending, remoteClaimFence: null, toolInvocationClaimFence: null, toolInvocationClaimRevision: null },
			data: { commandState: McpExecutorCommandState.Failed, terminalOutcome: _REMOTE_AUTHORITY_ENDED, terminalPayloadDigest: terminalDigest, completedAt: now },
		});
		if (updated.count !== 1)
			throw new Error("remote MCP denial lost its runtime transition");
	}

	/** Convert a previous process's unresolved remote claim into manual recovery without another call. */
	private async _RecoverPreviousClaim(execution: _RemoteExecution): Promise<RemoteMcpDispatchClaimResult>
	{
		const claim = _SavedToolClaim(execution);
		if (claim === null || execution.remoteClaimFence === null || execution.remoteClaimExpiresAt === null)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		const now = await this._databaseNow();
		if (execution.remoteClaimExpiresAt.getTime() > now.getTime())
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		const recovered = await this.toolInvocations.completeAmbiguous(claim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			return { outcome: RemoteMcpDispatchClaimOutcomes.Unavailable };
		const digest = ___DigestCanonicalJson({ failureCode: "mcp_remote_dispatch_interrupted" } as JsonValue);
		const saved = await this._CloseClaim({ executionId: execution.id, remoteClaimFence: execution.remoteClaimFence, toolInvocationClaim: claim }, McpExecutorCommandState.RecoveryRequired, "mcp_remote_dispatch_interrupted", digest, now);
		if (!saved)
			throw new Error("interrupted remote MCP claim lost its runtime transition");
		return { outcome: RemoteMcpDispatchClaimOutcomes.Terminal };
	}

	/** Close one saved remote claim only after its matching ToolInvocation transition succeeds. */
	private async _CloseClaim(claim: _RemoteClaimFence, state: _RemoteTerminalCommandState, outcome: string, digest: string, now: Date): Promise<boolean>
	{
		const updated = await this.transaction.mcpRuntimeExecution.updateMany({
			where: { id: claim.executionId, transport: McpExecutionTransport.RemoteHttp, commandState: McpExecutorCommandState.Claimed, remoteClaimFence: claim.remoteClaimFence, toolInvocationClaimFence: claim.toolInvocationClaim.fence, toolInvocationClaimRevision: claim.toolInvocationClaim.revision },
			data: { commandState: state, terminalOutcome: outcome, terminalPayloadDigest: digest, completedAt: now },
		});
		return updated.count === 1;
	}

	/** Read database time so claim and terminal clocks cannot be supplied by a caller. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this.transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("remote MCP dispatch database clock is unavailable");
		return clock.now;
	}
}

/** Build the SQL-trigger proposal for one new remote claim. */
export function _RemoteClaimUpdate(remoteClaimFence: string, claimLeaseMilliseconds: number, claim: ToolInvocationClaim): Prisma.McpRuntimeExecutionUpdateManyMutationInput
{
	return {
		commandState: McpExecutorCommandState.Claimed,
		remoteClaimFence,
		remoteClaimExpiresAt: new Date(claimLeaseMilliseconds),
		toolInvocationClaimFence: claim.fence,
		toolInvocationClaimRevision: claim.revision,
	};
}

/** Prisma projection used by one remote claim transaction. */
const _REMOTE_EXECUTION_SELECT = {
	id: true,
	siloId: true,
	kind: true,
	transport: true,
	serverRevisionId: true,
	connectionId: true,
	connectionGeneration: true,
	connectionOwnerPrincipalId: true,
	endpointDigest: true,
	credentialSecretUid: true,
	credentialSecretResourceVersion: true,
	commandState: true,
	remoteClaimFence: true,
	remoteClaimExpiresAt: true,
	toolInvocationClaimFence: true,
	toolInvocationClaimRevision: true,
	toolInvocationId: true,
	toolInvocation: { select: { toolRevisionId: true } },
	serverRevision: {
		select: {
			transport: true,
			connectionId: true,
			connectionGeneration: true,
			connectionOwnerPrincipalId: true,
			endpointDigest: true,
			protocolVersion: true,
			state: true,
			server: { select: { id: true, endpoint: true, status: true, approvalStatus: true } },
			tools: { select: { id: true, siloId: true, name: true, inputSchema: true } },
		},
	},
} as const satisfies Prisma.McpRuntimeExecutionSelect;

/** Complete remote runtime evidence loaded for claim and recovery. */
type _RemoteExecution = Prisma.McpRuntimeExecutionGetPayload<{ select: typeof _REMOTE_EXECUTION_SELECT }>;

/** Minimal persisted fences required to settle a claimed remote runtime. */
type _RemoteClaimFence = Pick<RemoteMcpDispatchClaim, "executionId" | "remoteClaimFence" | "toolInvocationClaim">;

/** Terminal runtime states accepted by the remote completion update. */
type _RemoteTerminalCommandState = typeof McpExecutorCommandState.Succeeded | typeof McpExecutorCommandState.Failed | typeof McpExecutorCommandState.RecoveryRequired;

/** Provider command facts retained only between claim commit and the bounded client call. */
interface _RemoteTarget
{
	/** Registered endpoint whose digest matched the frozen connection. */
	readonly endpoint: string;
	/** Discovered tool name selected by the invocation. */
	readonly toolName: string;
	/** Frozen input schema used to build parameter headers. */
	readonly inputSchema: JsonValue;
}

/** Convert non-null remote columns into the executor's immutable binding. */
function _Binding(execution: _RemoteExecution): RemoteMcpDispatchClaim["binding"]
{
	if (execution.transport !== McpExecutionTransport.RemoteHttp || execution.connectionId === null || execution.connectionGeneration === null
		|| execution.connectionOwnerPrincipalId === null || execution.endpointDigest === null || execution.serverRevision.protocolVersion === null
		|| execution.toolInvocation === null)
		throw new Error("remote MCP execution has an incomplete immutable binding");
	return {
		siloId: execution.siloId,
		connectionId: execution.connectionId,
		connectionGeneration: execution.connectionGeneration,
		connectionOwnerPrincipalId: execution.connectionOwnerPrincipalId,
		endpointDigest: execution.endpointDigest,
		serverRevisionId: execution.serverRevisionId,
		mcpServerId: execution.serverRevision.server.id,
		toolRevisionId: execution.toolInvocation.toolRevisionId,
		protocolVersion: execution.serverRevision.protocolVersion,
		credentialSecretUid: execution.credentialSecretUid,
		credentialSecretResourceVersion: execution.credentialSecretResourceVersion,
	};
}

/** Convert public owner coordinates into the relation filter for one ToolInvocation row. */
function _InvocationOwner(target: McpInvocationDispatchTarget): Prisma.ToolInvocationWhereInput
{
	if (target.ownerKind === McpInvocationOwnerKinds.Run)
		return { siloId: target.siloId, runId: target.runId, attempt: target.attempt, toolInvocationId: target.toolInvocationId, mcpTaskId: null };
	return { siloId: target.siloId, mcpTaskId: target.mcpTaskId, toolInvocationId: target.toolInvocationId, runId: null };
}

/** Return the exact saved ToolInvocation claim after a process restart. */
function _SavedToolClaim(execution: _RemoteExecution): ToolInvocationClaim | null
{
	if (execution.toolInvocationClaimFence === null || execution.toolInvocationClaimRevision === null)
		return null;
	if (execution.toolInvocationId === null)
		return null;
	return { invocationId: execution.toolInvocationId, kind: ExternalActionClaimKinds.Dispatch, fence: execution.toolInvocationClaimFence, revision: execution.toolInvocationClaimRevision };
}

/** Identify runtime command states that cannot issue another provider request. */
function _CommandIsTerminal(state: McpExecutorCommandState): boolean
{
	return state === McpExecutorCommandState.Succeeded || state === McpExecutorCommandState.Failed || state === McpExecutorCommandState.RecoveryRequired;
}

/** Identify ToolInvocation states that cannot issue another provider request. */
function _InvocationIsTerminal(state: ToolInvocationStates): boolean
{
	return state === ToolInvocationStates.Succeeded || state === ToolInvocationStates.Failed || state === ToolInvocationStates.RecoveryRequired;
}
