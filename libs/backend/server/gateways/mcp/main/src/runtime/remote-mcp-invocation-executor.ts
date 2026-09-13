import { McpConnectionCredentialKinds, type McpToolCallResult } from "@opencrane/contracts";
import { WorkflowTaskRetryableError } from "@opencrane/backend/server/infra/workflows/contract";
import { McpRemoteDeliveryStates, McpRemoteAuthorizationKinds } from "@opencrane/backend/server/infra/mcp-remote-client";
import { ___CloneCanonicalJson, type JsonValue } from "@opencrane/util";

import { McpConnectionCredentialReadOutcomes, type McpConnectionCredentialReadCommand, type McpConnectionCredentialReadResult, type McpConnectionCredentialReader } from "../connections/mcp-connection-credential-reader.types";
import { McpInvocationDispatchOutcomes, RemoteMcpDispatchClaimOutcomes, type McpInvocationDispatchTarget, type McpInvocationExecutor, type RemoteMcpDispatchClaim, type RemoteMcpInvocationExecutorDependencies } from "./remote-mcp-invocation.types";

/** Maximum local Secret lookup time reserved inside one remote effect claim. */
const _REMOTE_CREDENTIAL_READ_TIMEOUT_MILLISECONDS = 10_000;

/** Three bounded completion transactions may each consume at most ten seconds. */
const _REMOTE_COMPLETION_ALLOWANCE_MILLISECONDS = 30_000;

/** Stable failure saved when exact connection material cannot be read before dispatch. */
const _REMOTE_CREDENTIAL_UNAVAILABLE = "mcp_remote_credential_unavailable";

/** Stable failure saved when the remote client refuses input before request dispatch. */
const _REMOTE_REQUEST_REJECTED = "mcp_remote_request_rejected";

/** Stable recovery reason saved when the remote server may have received the request. */
const _REMOTE_RESULT_UNCERTAIN = "mcp_remote_result_uncertain";

/** Executes one server-mediated remote call after both provider-effect claims commit. */
export class RemoteMcpInvocationExecutor implements McpInvocationExecutor
{
	/** Bind current server identity, credential custody, transport, and terminal authority. */
	constructor(private readonly dependencies: RemoteMcpInvocationExecutorDependencies)
	{
		_RemoteMcpClaimLeaseMilliseconds(dependencies.timeoutMilliseconds);
	}

	/** Dispatch one new remote claim, or return the saved OCI or terminal winner. */
	async execute(target: McpInvocationDispatchTarget): Promise<McpInvocationDispatchOutcomes>
	{
		let claimStartedAt = performance.now();
		let result = await this._Claim({ target });
		if (result.outcome === RemoteMcpDispatchClaimOutcomes.IdentityRequired)
		{
			const workload = await this._ServerIdentity();
			claimStartedAt = performance.now();
			result = await this._Claim({ target, workload });
		}
		if (result.outcome === RemoteMcpDispatchClaimOutcomes.NotRemote)
			return McpInvocationDispatchOutcomes.AwaitingOciCompanion;
		if (result.outcome === RemoteMcpDispatchClaimOutcomes.Denied || result.outcome === RemoteMcpDispatchClaimOutcomes.Terminal)
			return McpInvocationDispatchOutcomes.Terminal;
		if (result.outcome === RemoteMcpDispatchClaimOutcomes.IdentityRequired || result.outcome === RemoteMcpDispatchClaimOutcomes.Unavailable || result.claim === undefined)
			throw new WorkflowTaskRetryableError("Remote MCP dispatch authority is temporarily unavailable");

		const claim = result.claim;
		const claimDeadline = claimStartedAt + claim.remainingClaimMilliseconds;
		const providerDeadline = claimDeadline - _REMOTE_COMPLETION_ALLOWANCE_MILLISECONDS;
		const credentialCommand = {
			siloId: claim.binding.siloId,
			connectionId: claim.binding.connectionId,
			generation: claim.binding.connectionGeneration,
			ownerPrincipalId: claim.binding.connectionOwnerPrincipalId,
			serverId: claim.binding.mcpServerId,
			serverRevisionId: claim.binding.serverRevisionId,
		};
		let credential: McpConnectionCredentialReadResult | null;
		const credentialController = new AbortController();
		try
		{
			const credentialDeadline = Math.min(providerDeadline, performance.now() + _REMOTE_CREDENTIAL_READ_TIMEOUT_MILLISECONDS);
			credential = await _ReadCredentialBefore(this.dependencies.credentials, credentialCommand, credentialDeadline, credentialController);
		}
		catch
		{
			return this._CompleteFailed(claim, _REMOTE_CREDENTIAL_UNAVAILABLE);
		}
		finally
		{
			credentialController.abort();
		}
		if (credential === null || credential.outcome !== McpConnectionCredentialReadOutcomes.Ready)
			return this._CompleteFailed(claim, _REMOTE_CREDENTIAL_UNAVAILABLE);

		if (credential.credential.kind === McpConnectionCredentialKinds.Bearer && credential.credential.token.length === 0)
			return this._CompleteFailed(claim, _REMOTE_CREDENTIAL_UNAVAILABLE);
		const remainingRequestMilliseconds = Math.min(this.dependencies.timeoutMilliseconds, Math.floor(providerDeadline - performance.now()));
		if (!Number.isSafeInteger(remainingRequestMilliseconds) || remainingRequestMilliseconds < 1)
			return this._CompleteFailed(claim, _REMOTE_CREDENTIAL_UNAVAILABLE);
		const requestController = new AbortController();
		const command = {
			endpoint: claim.endpoint,
			signal: requestController.signal,
			invocationId: claim.toolInvocationClaim.invocationId,
			toolName: claim.toolName,
			arguments: claim.arguments,
			inputSchema: claim.inputSchema,
		};
		let providerResult;
		try
		{
			const providerCall = credential.credential.kind === McpConnectionCredentialKinds.Bearer
				? this.dependencies.client.callTool({ ...command, authorization: { kind: McpRemoteAuthorizationKinds.Bearer, token: credential.credential.token } })
				: this.dependencies.client.callTool(command);
			providerResult = await _ResolveProviderBefore(providerCall, requestController, remainingRequestMilliseconds);
		}
		catch (error)
		{
			if (_ProvenNotDispatched(error))
				return this._CompleteFailed(claim, _REMOTE_REQUEST_REJECTED);
			return this._CompleteAmbiguous(claim);
		}
		if (providerResult === null || performance.now() >= providerDeadline)
			return this._CompleteAmbiguous(claim);
		const durableResult = ___CloneCanonicalJson(providerResult as unknown as JsonValue) as unknown as McpToolCallResult;
		try
		{
			if (!await this.dependencies.authority.completeSucceeded(claim, durableResult))
				throw new WorkflowTaskRetryableError("Remote MCP result could not be saved");
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskRetryableError)
				throw error;
			throw new WorkflowTaskRetryableError("Remote MCP result could not be saved");
		}
		return McpInvocationDispatchOutcomes.Completed;
	}

	/** Close unused work or preserve a claimed effect after the final workflow retry. */
	async settleExhausted(target: McpInvocationDispatchTarget): Promise<boolean>
	{
		try
		{
			return await this.dependencies.authority.settleExhausted(target);
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskRetryableError)
				throw error;
			throw new WorkflowTaskRetryableError("Remote MCP exhaustion could not be saved");
		}
	}

	/** Normalize authority failures so workflow exhaustion can close any durable winner. */
	private async _Claim(command: Parameters<RemoteMcpInvocationExecutorDependencies["authority"]["claim"]>[0])
	{
		try
		{
			return await this.dependencies.authority.claim(command);
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskRetryableError)
				throw error;
			throw new WorkflowTaskRetryableError("Remote MCP dispatch authority is temporarily unavailable");
		}
	}

	/** Normalize TokenReview failures before a provider claim exists. */
	private async _ServerIdentity()
	{
		try
		{
			return await this.dependencies.serverIdentity.read();
		}
		catch
		{
			throw new WorkflowTaskRetryableError("Remote MCP server identity is temporarily unavailable");
		}
	}

	/** Persist a definite failure and refuse to claim completion when that write loses. */
	private async _CompleteFailed(claim: RemoteMcpDispatchClaim, failureCode: string): Promise<McpInvocationDispatchOutcomes>
	{
		try
		{
			if (!await this.dependencies.authority.completeFailed(claim, failureCode))
				throw new WorkflowTaskRetryableError("Remote MCP failure could not be saved");
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskRetryableError)
				throw error;
			throw new WorkflowTaskRetryableError("Remote MCP failure could not be saved");
		}
		return McpInvocationDispatchOutcomes.Terminal;
	}

	/** Persist manual recovery after the provider may have received the request. */
	private async _CompleteAmbiguous(claim: RemoteMcpDispatchClaim): Promise<McpInvocationDispatchOutcomes>
	{
		try
		{
			if (!await this.dependencies.authority.completeAmbiguous(claim, _REMOTE_RESULT_UNCERTAIN))
				throw new WorkflowTaskRetryableError("Remote MCP recovery state could not be saved");
		}
		catch (error)
		{
			if (error instanceof WorkflowTaskRetryableError)
				throw error;
			throw new WorkflowTaskRetryableError("Remote MCP recovery state could not be saved");
		}
		return McpInvocationDispatchOutcomes.Terminal;
	}
}

/** Derive one remote effect lease from its credential, transport, and completion allowances. */
export function _RemoteMcpClaimLeaseMilliseconds(requestTimeoutMilliseconds: number): number
{
	if (!Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1_000 || requestTimeoutMilliseconds > 60_000)
		throw new Error("remote MCP execution requires a bounded request timeout");
	return _REMOTE_CREDENTIAL_READ_TIMEOUT_MILLISECONDS + requestTimeoutMilliseconds + _REMOTE_COMPLETION_ALLOWANCE_MILLISECONDS;
}

/** Resolve or end one local credential read before its monotonic claim allowance is spent. */
async function _ReadCredentialBefore(reader: McpConnectionCredentialReader, command: McpConnectionCredentialReadCommand, deadline: number, controller: AbortController): Promise<McpConnectionCredentialReadResult | null>
{
	const remainingMilliseconds = Math.floor(deadline - performance.now());
	if (!Number.isSafeInteger(remainingMilliseconds) || remainingMilliseconds < 1)
	{
		controller.abort();
		return null;
	}
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<null>(function _Expire(resolve)
	{
		timeout = setTimeout(function _FinishExpiredCredentialRead()
		{
			resolve(null);
			controller.abort();
		}, remainingMilliseconds);
	});
	try
	{
		return await Promise.race([reader.readExact(command, controller.signal), expired]);
	}
	finally
	{
		if (timeout !== undefined)
			clearTimeout(timeout);
	}
}

/** Stop waiting for a remote call at its original allowance even if a client ignores abort. */
async function _ResolveProviderBefore<T>(operation: Promise<T>, controller: AbortController, remainingMilliseconds: number): Promise<T | null>
{
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<null>(function _Expire(resolve)
	{
		timeout = setTimeout(function _FinishExpiredProviderCall()
		{
			controller.abort();
			resolve(null);
		}, remainingMilliseconds);
	});
	try
	{
		return await Promise.race([operation, expired]);
	}
	finally
	{
		if (timeout !== undefined)
			clearTimeout(timeout);
	}
}

/** Trust only the remote client's closed delivery category; unknown errors remain ambiguous. */
function _ProvenNotDispatched(error: unknown): boolean
{
	return typeof error === "object" && error !== null && "delivery" in error && error.delivery === McpRemoteDeliveryStates.ProvenNotDispatched;
}
