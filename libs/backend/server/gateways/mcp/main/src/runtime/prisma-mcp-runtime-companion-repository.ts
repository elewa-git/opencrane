import { randomUUID } from "node:crypto";

import { McpExecutorCommandState, McpExecutorWorkloadState, McpRuntimeExecutionKind, McpServerRevisionState, McpServerStatus, Prisma } from "@prisma/client";

import { McpCompanionCommandKinds, type McpCompanionClaimResponse, type McpCompanionCompletionRequest, type McpCompanionFailureRequest } from "@opencrane/backend/agents/runtime/mcp-executor/companion";
import { ExternalActionClaimKinds, ToolInvocationClaimOutcomes, ToolInvocationCompletionOutcomes, ToolInvocationStates, type McpToolInvocationTransactionParticipant, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { RuntimeWorkloadIdentity } from "@opencrane/backend/server/infra/workload-identity";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _McpRuntimeLeaseExpiryProposal, _McpRuntimeTimestampProposal } from "./mcp-runtime-timestamps";
import { McpRuntimeCompanionClaimOutcomes, type McpRuntimeAuthorityOptions, type McpRuntimeCompanionRepository } from "./mcp-runtime.types";

/** Claims companion commands and closes their MCP and ToolInvocation state atomically. */
export class PrismaMcpRuntimeCompanionRepository implements McpRuntimeCompanionRepository
{
	/** Prisma client for this open transaction. */
	private readonly _transaction: Prisma.TransactionClient;
	/** Authorization-owned ToolInvocation operations in the same transaction. */
	private readonly _toolInvocations: McpToolInvocationTransactionParticipant;
	/** Fixed identity and lease policy for the MCP executor class. */
	private readonly _options: McpRuntimeAuthorityOptions;

	/** Bind MCP and ToolInvocation changes to one serializable transaction. */
	constructor(transaction: Prisma.TransactionClient, toolInvocations: McpToolInvocationTransactionParticipant, options: McpRuntimeAuthorityOptions)
	{
		this._transaction = transaction;
		this._toolInvocations = toolInvocations;
		this._options = options;
	}

	/** Claim at most one command for the exact TokenReview-confirmed Pod. */
	async claim(identity: RuntimeWorkloadIdentity, executionReference: string): Promise<McpCompanionClaimResponse | McpRuntimeCompanionClaimOutcomes.Terminal | null>
	{
		// 1. Match every authenticated workload coordinate before revealing whether work exists.
		if (!_IdentityMatchesOptions(identity, this._options))
			return null;
		let execution = await this._transaction.mcpRuntimeExecution.findFirst({ where: { siloId: this._options.siloId, executionReference, workloadState: McpExecutorWorkloadState.Registered, podUid: identity.podUid }, include: { serverRevision: { include: { tools: { select: { id: true, name: true } } } } } });
		if (execution === null || execution.commandState === McpExecutorCommandState.Succeeded || execution.commandState === McpExecutorCommandState.Failed || execution.commandState === McpExecutorCommandState.RecoveryRequired)
			return null;
		const now = await this._databaseNow();

		// 2. Never repeat an invocation whose earlier claim may already have reached the uploaded server.
		if (execution.commandState === McpExecutorCommandState.Claimed)
		{
			if (execution.companionClaimExpiresAt !== null && execution.companionClaimExpiresAt > now)
				return null;
			if (execution.kind === McpRuntimeExecutionKind.Invocation)
			{
				await this._RecoverExpiredInvocation(execution, now);
				return null;
			}
			await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, commandState: McpExecutorCommandState.Claimed, companionClaimFence: execution.companionClaimFence, companionClaimExpiresAt: execution.companionClaimExpiresAt }, data: { commandState: McpExecutorCommandState.Pending, companionClaimFence: null, companionClaimExpiresAt: null } });
			execution = await this._transaction.mcpRuntimeExecution.findUniqueOrThrow({ where: { id: execution.id }, include: { serverRevision: { include: { tools: { select: { id: true, name: true } } } } } });
		}

		// 3. Claim authorization before the MCP row so a tool call and its effect fence are inseparable.
		const claimFence = randomUUID();
		let toolClaim: ToolInvocationClaim | null = null;
		let invocation: ToolInvocationRecord | null = null;
		if (execution.kind === McpRuntimeExecutionKind.Invocation)
		{
			if (execution.toolInvocationId === null)
				return null;
			const claimed = await this._toolInvocations.claim(execution.toolInvocationId, now, this._options.companionClaimLeaseMilliseconds);
			if (claimed.outcome === ToolInvocationClaimOutcomes.Missing)
			{
				await this._CloseBeforeDispatch(execution, null);
				return McpRuntimeCompanionClaimOutcomes.Terminal;
			}
			if (claimed.outcome === ToolInvocationClaimOutcomes.Winner)
			{
				if (_InvocationIsTerminal(claimed.invocation.state))
				{
					await this._CloseBeforeDispatch(execution, claimed.invocation.state);
					return McpRuntimeCompanionClaimOutcomes.Terminal;
				}
				return null;
			}
			toolClaim = claimed.claim;
			invocation = claimed.invocation;
		}
		const claimedRows = await this._transaction.mcpRuntimeExecution.updateManyAndReturn({
			where: { id: execution.id, siloId: this._options.siloId, workloadState: McpExecutorWorkloadState.Registered, podUid: identity.podUid, commandState: McpExecutorCommandState.Pending, companionClaimFence: null },
			data: { commandState: McpExecutorCommandState.Claimed, companionClaimFence: claimFence, companionClaimExpiresAt: _McpRuntimeLeaseExpiryProposal(this._options.companionClaimLeaseMilliseconds), toolInvocationClaimFence: toolClaim?.fence ?? null, toolInvocationClaimRevision: toolClaim?.revision ?? null },
			select: { companionClaimExpiresAt: true },
		});
		const claimedExecution = claimedRows[0];
		if (claimedExecution === undefined || claimedExecution.companionClaimExpiresAt === null)
			throw new Error("MCP companion command lost its database fence");
		const lease = { executionId: execution.id, claimFence, expiresAt: claimedExecution.companionClaimExpiresAt.toISOString() };
		if (execution.kind === McpRuntimeExecutionKind.Discovery)
			return { kind: McpCompanionCommandKinds.Discovery, ...lease };
		if (invocation === null)
			throw new Error("MCP invocation claim lost its authorization record");
		const tool = execution.serverRevision.tools.find(function _SelectedTool(candidate) { return candidate.id === invocation.toolRevisionId; });
		if (tool === undefined)
			throw new Error("MCP invocation no longer matches its immutable tool revision");
		return { kind: McpCompanionCommandKinds.Invocation, ...lease, invocationId: invocation.toolInvocationId, toolName: tool.name, arguments: invocation.effectiveArguments };
	}

	/** Save one checked discovery or invocation result through the current companion fence. */
	async complete(identity: RuntimeWorkloadIdentity, request: McpCompanionCompletionRequest): Promise<"completed" | "idempotent" | "conflict">
	{
		const digest = _TerminalDigest(request);
		const execution = await this._LoadTerminalExecution(identity, request.executionReference, request.executionId);
		if (execution === null)
			return "conflict";
		if (execution.commandState === McpExecutorCommandState.Succeeded)
			return execution.terminalPayloadDigest === digest ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (!_CurrentCommandFence(execution, request.claimFence, now))
			return "conflict";

		// 1. Discovery freezes the protocol and tool schemas before the server becomes ready.
		if (execution.kind === McpRuntimeExecutionKind.Discovery && request.completion.kind === McpCompanionCommandKinds.Discovery)
		{
			for (const tool of request.completion.tools)
			{
				await this._transaction.mcpToolRevision.create({ data: { siloId: execution.siloId, serverRevisionId: execution.serverRevisionId, name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Prisma.InputJsonValue, inputSchemaDigest: ___DigestCanonicalJson(tool.inputSchema as JsonValue) }, select: { id: true } });
			}
			await this._transaction.mcpServerRevision.update({ where: { id: execution.serverRevisionId }, data: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", completedAt: _McpRuntimeTimestampProposal }, select: { id: true } });
			await this._transaction.mcpServer.update({ where: { id: execution.serverRevision.mcpServerId }, data: { status: McpServerStatus.Active }, select: { id: true } });
			await this._CloseSucceeded(execution.id, request.claimFence, digest);
			return "completed";
		}

		// 2. Invocation completion moves the authorization-owned result and MCP command together.
		if (execution.kind === McpRuntimeExecutionKind.Invocation && request.completion.kind === McpCompanionCommandKinds.Invocation)
		{
			const claim = _ToolClaim(execution);
			if (claim === null)
				return "conflict";
			const result = request.completion.result as unknown as JsonValue;
			const completed = await this._toolInvocations.completeSucceeded(claim, result, now);
			if (completed.outcome === ToolInvocationCompletionOutcomes.Missing)
				return "conflict";
			if (completed.outcome === ToolInvocationCompletionOutcomes.Winner && (completed.invocation.state !== ToolInvocationStates.Succeeded || completed.invocation.result === null || ___DigestCanonicalJson(completed.invocation.result) !== ___DigestCanonicalJson(result)))
				return "conflict";
			await this._CloseSucceeded(execution.id, request.claimFence, digest);
			return "completed";
		}
		return "conflict";
	}

	/** Save a definite discovery failure or an ambiguous invocation outcome. */
	async fail(identity: RuntimeWorkloadIdentity, request: McpCompanionFailureRequest): Promise<"failed" | "idempotent" | "conflict">
	{
		const digest = _TerminalDigest(request);
		const execution = await this._LoadTerminalExecution(identity, request.executionReference, request.executionId);
		if (execution === null)
			return "conflict";
		if (execution.commandState === McpExecutorCommandState.Failed || execution.commandState === McpExecutorCommandState.RecoveryRequired)
			return execution.terminalPayloadDigest === digest ? "idempotent" : "conflict";
		const now = await this._databaseNow();
		if (!_CurrentCommandFence(execution, request.claimFence, now))
			return "conflict";

		// 1. Discovery has no external effect, so its bounded failure is terminal and definite.
		if (execution.kind === McpRuntimeExecutionKind.Discovery)
		{
			await this._transaction.mcpServerRevision.update({ where: { id: execution.serverRevisionId }, data: { state: McpServerRevisionState.Rejected, completedAt: _McpRuntimeTimestampProposal }, select: { id: true } });
			await this._transaction.mcpRuntimeExecution.update({ where: { id: execution.id }, data: { commandState: McpExecutorCommandState.Failed, workloadState: McpExecutorWorkloadState.Closed, terminalOutcome: request.failureCode, terminalPayloadDigest: digest, completedAt: _McpRuntimeTimestampProposal }, select: { id: true } });
			return "failed";
		}

		// 2. A failed response cannot prove whether the uploaded server already performed a tool effect.
		const claim = _ToolClaim(execution);
		if (claim === null)
			return "conflict";
		const recovered = await this._toolInvocations.completeAmbiguous(claim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			return "conflict";
		await this._transaction.mcpRuntimeExecution.update({ where: { id: execution.id }, data: { commandState: McpExecutorCommandState.RecoveryRequired, workloadState: McpExecutorWorkloadState.Closed, terminalOutcome: request.failureCode, terminalPayloadDigest: digest, completedAt: _McpRuntimeTimestampProposal }, select: { id: true } });
		return "failed";
	}

	/** Recover one expired invocation even when its one-shot companion Pod has exited. */
	async recoverNextExpiredInvocation(): Promise<boolean>
	{
		const now = await this._databaseNow();
		const execution = await this._transaction.mcpRuntimeExecution.findFirst({
			where: { siloId: this._options.siloId, profileName: this._options.profileName, kind: McpRuntimeExecutionKind.Invocation, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Claimed, companionClaimExpiresAt: { lte: now } },
			orderBy: [{ companionClaimExpiresAt: "asc" }, { id: "asc" }],
			include: { serverRevision: { select: { mcpServerId: true } } },
		});
		if (execution === null)
			return false;
		await this._RecoverExpiredInvocation(execution, now);
		return true;
	}

	/** Close MCP work when authorization ended the ToolInvocation before provider dispatch. */
	private async _CloseBeforeDispatch(execution: _TerminalExecution, invocationState: ToolInvocationStates | null): Promise<void>
	{
		let commandState: McpExecutorCommandState = McpExecutorCommandState.Failed;
		if (invocationState === ToolInvocationStates.RecoveryRequired)
			commandState = McpExecutorCommandState.RecoveryRequired;
		else if (invocationState === ToolInvocationStates.Succeeded)
			commandState = McpExecutorCommandState.Succeeded;
		const terminalOutcome = invocationState === null ? "tool_invocation_missing_before_dispatch" : `tool_invocation_${invocationState}_before_dispatch`;
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: execution.id, workloadState: McpExecutorWorkloadState.Registered, commandState: McpExecutorCommandState.Pending }, data: { workloadState: McpExecutorWorkloadState.Closed, commandState, terminalOutcome, completedAt: _McpRuntimeTimestampProposal } });
		if (updated.count !== 1)
			throw new Error("MCP execution changed while its finished ToolInvocation was being closed");
	}

	/** Move an expired invocation claim into manual recovery without calling the server again. */
	private async _RecoverExpiredInvocation(execution: _TerminalExecution, now: Date): Promise<void>
	{
		const claim = _ToolClaim(execution);
		if (claim === null)
			throw new Error("expired MCP invocation lost its ToolInvocation fence");
		const recovered = await this._toolInvocations.completeAmbiguous(claim, now);
		if (recovered === null || recovered.state !== ToolInvocationStates.RecoveryRequired)
			throw new Error("expired MCP invocation could not enter manual recovery");
		await this._transaction.mcpRuntimeExecution.update({ where: { id: execution.id }, data: { commandState: McpExecutorCommandState.RecoveryRequired, workloadState: McpExecutorWorkloadState.Closed, terminalOutcome: "claim_expired_after_dispatch", completedAt: _McpRuntimeTimestampProposal }, select: { id: true } });
	}

	/** Load one execution only when TokenReview and the request name the same registered Pod. */
	private async _LoadTerminalExecution(identity: RuntimeWorkloadIdentity, executionReference: string, executionId: string): Promise<_TerminalExecution | null>
	{
		if (!_IdentityMatchesOptions(identity, this._options))
			return null;
		return this._transaction.mcpRuntimeExecution.findFirst({ where: { id: executionId, siloId: this._options.siloId, executionReference, podUid: identity.podUid }, include: { serverRevision: { select: { mcpServerId: true } } } });
	}

	/** Mark one current command and its workload terminal after all paired writes succeeded. */
	private async _CloseSucceeded(executionId: string, claimFence: string, terminalPayloadDigest: string): Promise<void>
	{
		const updated = await this._transaction.mcpRuntimeExecution.updateMany({ where: { id: executionId, commandState: McpExecutorCommandState.Claimed, companionClaimFence: claimFence }, data: { commandState: McpExecutorCommandState.Succeeded, workloadState: McpExecutorWorkloadState.Closed, terminalOutcome: "succeeded", terminalPayloadDigest, completedAt: _McpRuntimeTimestampProposal } });
		if (updated.count !== 1)
			throw new Error("MCP companion completion lost its command fence");
	}

	/** Read millisecond database time through the fixed MCP authority view. */
	private async _databaseNow(): Promise<Date>
	{
		const clock = await this._transaction.mcpRuntimeClock.findUnique({ where: { singleton: 1 } });
		if (clock === null || Number.isNaN(clock.now.getTime()))
			throw new Error("MCP runtime database clock unavailable");
		return clock.now;
	}
}

/** Prisma projection used by terminal writes and expired-claim recovery. */
type _TerminalExecution = Prisma.McpRuntimeExecutionGetPayload<{ include: { serverRevision: { select: { mcpServerId: true } } } }>;

/** Require TokenReview to confirm the one executor namespace and ServiceAccount. */
function _IdentityMatchesOptions(identity: RuntimeWorkloadIdentity, options: McpRuntimeAuthorityOptions): boolean
{
	return identity.namespace === options.executorNamespace && identity.serviceAccountName === options.executorServiceAccountName && identity.podUid.length > 0;
}

/** Convert the persisted ToolInvocation fence into the authorization-owned claim contract. */
function _ToolClaim(execution: Pick<_TerminalExecution, "toolInvocationId" | "toolInvocationClaimFence" | "toolInvocationClaimRevision">): ToolInvocationClaim | null
{
	if (execution.toolInvocationId === null || execution.toolInvocationClaimFence === null || execution.toolInvocationClaimRevision === null)
		return null;
	return { invocationId: execution.toolInvocationId, kind: ExternalActionClaimKinds.Dispatch, fence: execution.toolInvocationClaimFence, revision: execution.toolInvocationClaimRevision };
}

/** Check the exact companion claim and its unexpired database-time lease. */
function _CurrentCommandFence(execution: Pick<_TerminalExecution, "commandState" | "companionClaimFence" | "companionClaimExpiresAt">, claimFence: string, now: Date): boolean
{
	return execution.commandState === McpExecutorCommandState.Claimed && execution.companionClaimFence === claimFence && execution.companionClaimExpiresAt !== null && execution.companionClaimExpiresAt > now;
}

/** Return true when authorization will never allow provider dispatch for this invocation again. */
function _InvocationIsTerminal(state: ToolInvocationStates): boolean
{
	return state === ToolInvocationStates.Succeeded || state === ToolInvocationStates.Failed || state === ToolInvocationStates.RecoveryRequired;
}

/** Hash a checked terminal request so only its exact retry is idempotent. */
function _TerminalDigest(request: McpCompanionCompletionRequest | McpCompanionFailureRequest): string
{
	return ___DigestCanonicalJson(request as unknown as JsonValue);
}
