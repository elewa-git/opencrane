import { McpConnectionCredentialKinds, McpConnectionFailureCodes, McpInstallStates, type McpConnectionCredential } from "@opencrane/contracts";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError, ___RetryWorkflowDependency, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { AuthorizationDecisionOutcomes, ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { McpAuthenticatedConnectionDiscoveryOutcomes, type McpAuthenticatedConnectionDiscovery, type McpAuthenticatedConnectionDiscoveryResult } from "./discovery/mcp-authenticated-connection-discovery.types";
import { __ProjectMcpConnection } from "./mcp-connection-projection";
import { McpConnectionSecretDeleteOutcomes, McpConnectionSecretReadOutcomes, McpConnectionStates, type McpConnectionActivationTaskInput, type McpConnectionAdmissionUnitOfWork, type McpConnectionCredentialSecretStore, type McpConnectionExecutionSettlement, type McpConnectionRecord, type McpConnectionRevocationTaskInput, type McpConnectionSecretIdentity, type McpConnectionSecretTarget, type McpConnectionWorkflowController } from "./mcp-connection.types";

const _ACTIVATION_ATTEMPTS = 5;
const _REVOCATION_ATTEMPTS = 8;

/** Continues saved activation and cleanup tasks without receiving request credentials. */
export class __McpConnectionWorkflowController implements McpConnectionWorkflowController
{
	constructor(private readonly _unitOfWork: McpConnectionAdmissionUnitOfWork, private readonly _secrets: McpConnectionCredentialSecretStore, private readonly _discovery: McpAuthenticatedConnectionDiscovery, private readonly _settlement: McpConnectionExecutionSettlement) {}

	async activate(context: IWorkflowTaskContext, input: McpConnectionActivationTaskInput): Promise<void>
	{
		const saved = await this._unitOfWork.execute(transaction => transaction.connections.loadActivationRecord(input, context.task));
		if (!saved || saved.state === McpConnectionStates.Active || saved.state === McpConnectionStates.Failed || saved.state === McpConnectionStates.RecoveryRequired || saved.state === McpConnectionStates.Revoked)
			return;
		if (saved.state === McpConnectionStates.AwaitingMaterial)
		{
			let recovered: "ready" | "retry" | "recovery" | "uncertain";
			try
			{
				recovered = await ___RetryWorkflowDependency(() => this._RecoverAwaitingMaterial(saved), "MCP connection credential custody is temporarily unavailable.");
			}
			catch (error)
			{
				if (!(error instanceof WorkflowTaskRetryableError))
					throw error;
				await this._RetryOrExhaustActivation(input, context, true);
				return;
			}
			if (recovered === "retry")
			{
				await this._RetryOrExhaustActivation(input, context, true);
				return;
			}
			if (recovered === "uncertain")
			{
				if (context.attempt < _ACTIVATION_ATTEMPTS)
					throw new WorkflowTaskRetryableError("MCP connection credential custody is temporarily unavailable.");
				await this._RecordActivationFailure(input, context, McpConnectionFailureCodes.CredentialUnavailable, true);
				return;
			}
			if (recovered === "recovery")
			{
				await this._RecordActivationFailure(input, context, McpConnectionFailureCodes.CredentialConflict, true);
				return;
			}
		}
		const target = await this._unitOfWork.execute(async function _Load(transaction)
		{
			const current = await transaction.connections.loadActivationTarget(input, context.task);
			if (!current)
				return null;
			const authorization = await transaction.authorization.decidePrincipal({ siloId: current.record.siloId, principalId: current.record.ownerPrincipalId, resource: { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: current.record.id }, action: ProductAuthorizationActions.Use, nowEpochMs: Date.now() });
			return authorization.outcome === AuthorizationDecisionOutcomes.Allow ? current : null;
		});
		if (!target)
		{
			await this._RecordActivationFailure(input, context, McpConnectionFailureCodes.AuthorityEnded, false);
			return;
		}

		let credential: McpConnectionCredential | "retry" | "recovery";
		try
		{
			credential = await ___RetryWorkflowDependency(() => this._ReadCredential(target.record), "MCP connection credential read is temporarily unavailable.");
		}
		catch (error)
		{
			if (!(error instanceof WorkflowTaskRetryableError))
				throw error;
			await this._RetryOrExhaustActivation(input, context, false);
			return;
		}
		if (credential === "retry")
		{
			await this._RetryOrExhaustActivation(input, context, false);
			return;
		}
		if (credential === "recovery")
		{
			await this._RecordActivationFailure(input, context, McpConnectionFailureCodes.CredentialConflict, true);
			return;
		}
		let result: McpAuthenticatedConnectionDiscoveryResult;
		try
		{
			result = await ___RetryWorkflowDependency(() => this._discovery.activate({ record: target.record, endpoint: target.endpoint, credential, task: context.task, signal: AbortSignal.timeout(30_000) }), "MCP connection discovery is temporarily unavailable.");
		}
		catch (error)
		{
			if (!(error instanceof WorkflowTaskRetryableError))
				throw error;
			await this._RetryOrExhaustActivation(input, context, false);
			return;
		}
		if (result.outcome === McpAuthenticatedConnectionDiscoveryOutcomes.Completed)
			return;
		if (result.outcome === McpAuthenticatedConnectionDiscoveryOutcomes.Retryable)
		{
			await this._RetryOrExhaustActivation(input, context, false);
			return;
		}
		if (result.outcome === McpAuthenticatedConnectionDiscoveryOutcomes.Uncertain)
		{
			await this._RecordActivationFailure(input, context, result.failureCode ?? McpConnectionFailureCodes.CredentialUnavailable, true);
			return;
		}
		await this._RecordActivationFailure(input, context, result.failureCode ?? McpConnectionFailureCodes.DiscoveryRejected, false);
	}

	private async _RecoverAwaitingMaterial(record: McpConnectionRecord): Promise<"ready" | "retry" | "recovery" | "uncertain">
	{
		if (record.credentialKind === McpConnectionCredentialKinds.None)
			return await this._BindRecoveredCustody(record, null) ? "ready" : "recovery";
		const target = _SecretRecoveryTarget(record);
		if (!target)
			return "recovery";
		const recovered = await this._secrets.recoverIdentity(target);
		if (recovered.outcome === McpConnectionSecretReadOutcomes.Found)
			return await this._BindRecoveredCustody(record, recovered.identity) ? "ready" : "recovery";
		if (recovered.outcome === McpConnectionSecretReadOutcomes.NotFound)
			return "retry";
		if (recovered.outcome === McpConnectionSecretReadOutcomes.Uncertain)
			return "uncertain";
		if (recovered.outcome === McpConnectionSecretReadOutcomes.Conflict)
			return "recovery";
		return "recovery";
	}

	private async _BindRecoveredCustody(record: McpConnectionRecord, identity: McpConnectionSecretIdentity | null): Promise<boolean>
	{
		const saved = await this._unitOfWork.execute(async function _Bind(transaction)
		{
			const current = await transaction.connections.bindCustody(record, identity, new Date());
			if (current)
				await transaction.connections.setInstallProjection(current.installId, __ProjectMcpConnection(current));
			return current;
		});
		return saved !== null;
	}

	async revoke(context: IWorkflowTaskContext, input: McpConnectionRevocationTaskInput): Promise<void>
	{
		const record = await this._unitOfWork.execute(transaction => transaction.connections.loadRevocationTarget(input, context.task));
		if (!record || record.cleanupCompletedAt)
			return;
		let settled: boolean;
		try
		{
			settled = await ___RetryWorkflowDependency(() => this._settlement.isSettled(record), "MCP connection execution settlement is temporarily unavailable.");
		}
		catch (error)
		{
			if (!(error instanceof WorkflowTaskRetryableError))
				throw error;
			await this._RetryOrExhaustCleanup(record, context);
			return;
		}
		if (!settled)
		{
			await this._RetryOrExhaustCleanup(record, context);
			return;
		}
		if (record.credentialKind === McpConnectionCredentialKinds.None)
		{
			await this._CompleteCleanup(record);
			return;
		}
		let secretTarget = _SecretTarget(record);
		if (secretTarget === null)
		{
			let recovered: McpConnectionSecretTarget | "retry" | "recovery";
			try
			{
				recovered = await ___RetryWorkflowDependency(() => this._RecoverCleanupTarget(record), "MCP connection credential cleanup is temporarily unavailable.");
			}
			catch (error)
			{
				if (!(error instanceof WorkflowTaskRetryableError))
					throw error;
				await this._RetryOrExhaustCleanup(record, context);
				return;
			}
			if (recovered === "retry")
			{
				await this._RetryOrExhaustCleanup(record, context);
				return;
			}
			if (recovered === "recovery")
			{
				await this._FailCleanup(record, McpConnectionFailureCodes.CredentialConflict);
				throw new WorkflowTaskTerminalError("MCP connection cleanup has inconsistent Secret evidence.");
			}
			secretTarget = recovered;
		}
		let result: Awaited<ReturnType<McpConnectionCredentialSecretStore["deleteExact"]>>;
		try
		{
			result = await ___RetryWorkflowDependency(() => this._secrets.deleteExact(secretTarget), "MCP connection credential cleanup is temporarily unavailable.");
		}
		catch (error)
		{
			if (!(error instanceof WorkflowTaskRetryableError))
				throw error;
			await this._RetryOrExhaustCleanup(record, context);
			return;
		}
		if (result.outcome === McpConnectionSecretDeleteOutcomes.Deleted || result.outcome === McpConnectionSecretDeleteOutcomes.NotFound)
		{
			await this._CompleteCleanup(record);
			return;
		}
		if (result.outcome === McpConnectionSecretDeleteOutcomes.Conflict)
		{
			await this._FailCleanup(record, McpConnectionFailureCodes.CredentialConflict);
			throw new WorkflowTaskTerminalError("MCP connection cleanup found conflicting Secret evidence.");
		}
		await this._RetryOrExhaustCleanup(record, context);
	}

	private async _RecoverCleanupTarget(record: McpConnectionRecord): Promise<McpConnectionSecretTarget | "retry" | "recovery">
	{
		const target = _SecretRecoveryTarget(record);
		if (!target)
			return "recovery";
		const recovered = await this._secrets.recoverIdentity(target);
		if (recovered.outcome === McpConnectionSecretReadOutcomes.Found)
			return { ...target, expectedIdentity: recovered.identity };
		if (recovered.outcome === McpConnectionSecretReadOutcomes.Conflict)
			return "recovery";
		return "retry";
	}

	private async _ReadCredential(record: McpConnectionRecord)
	{
		if (record.credentialKind === McpConnectionCredentialKinds.None)
			return { kind: McpConnectionCredentialKinds.None } as const;
		const target = _SecretTarget(record);
		if (!target)
			return "recovery" as const;
		const result = await this._secrets.readExact(target);
		if (result.outcome === McpConnectionSecretReadOutcomes.Found)
			return { kind: McpConnectionCredentialKinds.Bearer, token: result.bearerToken } as const;
		return result.outcome === McpConnectionSecretReadOutcomes.Uncertain ? "retry" as const : "recovery" as const;
	}

	private async _RecordActivationFailure(input: McpConnectionActivationTaskInput, context: IWorkflowTaskContext, failureCode: McpConnectionFailureCodes, recovery: boolean): Promise<void>
	{
		const saved = await this._unitOfWork.execute(async function _Save(transaction)
		{
			const current = await transaction.connections.loadActivationRecord(input, context.task);
			if (!current)
				return null;
			const result = recovery
				? await transaction.connections.markRecoveryRequired(current, failureCode, new Date())
				: await transaction.connections.markActivationFailed(current, failureCode, new Date());
			if (result)
				await transaction.connections.setInstallProjection(result.installId, __ProjectMcpConnection(result));
			return result;
		});
		if (!saved)
			throw new WorkflowTaskRetryableError("MCP connection activation result could not be saved.");
	}

	private async _RetryOrExhaustActivation(input: McpConnectionActivationTaskInput, context: IWorkflowTaskContext, custodyUncertain: boolean): Promise<void>
	{
		if (context.attempt < _ACTIVATION_ATTEMPTS)
			throw new WorkflowTaskRetryableError("MCP connection activation dependency is temporarily unavailable.");
		await this._RecordActivationFailure(input, context, McpConnectionFailureCodes.WorkflowExhausted, custodyUncertain);
	}

	private async _CompleteCleanup(record: McpConnectionRecord): Promise<void>
	{
		const saved = await this._unitOfWork.execute(async function _Complete(transaction)
		{
			const installState = await transaction.installRemoval.lockForCleanup(record.installId);
			if (!installState)
				return null;
			const current = await transaction.connections.markCleanupComplete(record, new Date());
			if (current && installState === McpInstallStates.Removing)
				await transaction.installRemoval.markRemovedIfSettled(current.installId);
			return current;
		});
		if (!saved)
			throw new WorkflowTaskRetryableError("MCP connection cleanup result could not be saved.");
	}

	private async _FailCleanup(record: McpConnectionRecord, failureCode: McpConnectionFailureCodes): Promise<void>
	{
		const saved = await this._unitOfWork.execute(transaction => transaction.connections.markCleanupFailed(record, failureCode, new Date()));
		if (!saved)
			throw new WorkflowTaskRetryableError("MCP connection cleanup failure could not be saved.");
	}

	private async _RetryOrExhaustCleanup(record: McpConnectionRecord, context: IWorkflowTaskContext): Promise<void>
	{
		if (context.attempt < _REVOCATION_ATTEMPTS)
			throw new WorkflowTaskRetryableError("MCP connection cleanup dependency is temporarily unavailable.");
		await this._FailCleanup(record, McpConnectionFailureCodes.WorkflowExhausted);
		throw new WorkflowTaskTerminalError("MCP connection cleanup exhausted its retry allowance.");
	}
}

function _SecretTarget(record: McpConnectionRecord): McpConnectionSecretTarget | null
{
	if (!record.materialVerifier || !record.materialVerifierKeyId || !record.secretRef || !record.secretUid || !record.secretResourceVersion)
		return null;
	return { connectionId: record.id, siloId: record.siloId, ownerPrincipalId: record.ownerPrincipalId, generation: record.generation, endpointDigest: record.endpointDigest, materialVerifier: record.materialVerifier, materialVerifierKeyId: record.materialVerifierKeyId, expectedIdentity: { secretRef: record.secretRef, secretUid: record.secretUid, secretResourceVersion: record.secretResourceVersion } };
}

function _SecretRecoveryTarget(record: McpConnectionRecord): McpConnectionSecretTarget | null
{
	if (!record.materialVerifier || !record.materialVerifierKeyId)
		return null;
	return { connectionId: record.id, siloId: record.siloId, ownerPrincipalId: record.ownerPrincipalId, generation: record.generation, endpointDigest: record.endpointDigest, materialVerifier: record.materialVerifier, materialVerifierKeyId: record.materialVerifierKeyId };
}
