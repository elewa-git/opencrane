import { ExternalActionRecoveryModes, __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { MemoryGatewayUnavailableError } from "@opencrane/backend/server/infra/memory-gateway-client";
import { ObotMcpAuthenticationError, ObotMcpAuthorizationError, ObotMcpInvocationUnavailableError, ObotMcpToolNotAllowedError } from "@opencrane/backend/server/infra/obot-custody";
import { SandboxExecutionUnavailableError } from "@opencrane/backend/server/infra/sandbox-execution";
import type { JsonValue } from "@opencrane/util";

import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId, MemoryScopeUnavailableError, UnsupportedExternalActionError } from "./external-action-executor.js";
import type { DurableExternalActionCommand, ExternalActionExecutor } from "./external-action-executor.types.js";
import { IntegrationAssignmentUnavailableError, IntegrationToolReturnedError } from "./external-action-errors.js";
import { ExternalActionProviderOutcomeKinds, type ExternalActionAdapterFactory, type ExternalActionExecutionContext, type ExternalActionProviderOutcome, type ExternalActionWorkerInvocation, type PreparedExternalActionAdapter } from "./external-action-worker.types.js";
import type { ProductionExternalActionAdapterDependencies } from "./production-external-action-adapter.types.js";

/** Safe failure code for a live integration assignment that was revoked before provider dispatch. */
function _integrationFailureCode(error: IntegrationAssignmentUnavailableError): string
{
	return `integration_assignment_${error.reason}`;
}

/** Map only typed errors that prove no provider request began into a definite failure. */
function _provenPreDispatchFailure(error: unknown): string | null
{
	if (error instanceof IntegrationAssignmentUnavailableError) return _integrationFailureCode(error);
	if (error instanceof UnsupportedExternalActionError) return "external_action_unsupported";
	if (error instanceof MemoryScopeUnavailableError) return "memory_scope_unavailable";
	if (error instanceof ObotMcpToolNotAllowedError) return "integration_tool_not_allowed";
	if (error instanceof ObotMcpAuthenticationError) return "AuthenticationError";
	if (error instanceof ObotMcpAuthorizationError) return "PermissionError";
	if (error instanceof IntegrationToolReturnedError) return "RuntimeError";
	if (error instanceof ObotMcpInvocationUnavailableError) return "integration_provider_unavailable";
	if (error instanceof SandboxExecutionUnavailableError) return "sandbox_provider_unavailable";
	if (error instanceof MemoryGatewayUnavailableError) return "memory_provider_unavailable";
	return null;
}

/** Current server transports have no provider idempotency or readback contract, so they are manual. */
class _ManualPreparedExternalActionAdapter implements PreparedExternalActionAdapter
{
	/** Manual is fixed because current Obot, sandbox, and memory ports expose no recovery proof. */
	readonly recoveryMode = ExternalActionRecoveryModes.Manual;
	/** One durable-command executor selected from the frozen tool revision. */
	private readonly executor: ExternalActionExecutor<JsonValue>;
	/** Credential-free fields shared by provider operation spans. */
	private readonly traceFields: Readonly<Record<string, unknown>>;

	/** Create one manual adapter around an existing server-owned executor. */
	constructor(executor: ExternalActionExecutor<JsonValue>, invocation: ExternalActionWorkerInvocation)
	{
		this.executor = executor;
		this.traceFields = { runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, recoveryMode: invocation.recoveryMode };
	}

	/** Dispatch once; unknown exceptions stay ambiguous because a request may have left the process. */
	dispatch(_recoveryKey: string | null): Promise<ExternalActionProviderOutcome>
	{
		const self = this;
		return ___DoWithTrace("external_action.provider.dispatch", this.traceFields, async function _dispatch()
		{
			try
			{
				return { kind: ExternalActionProviderOutcomeKinds.Succeeded, result: await self.executor.execute() };
			}
			catch (error)
			{
				const failureCode = _provenPreDispatchFailure(error);
				return failureCode === null
					? { kind: ExternalActionProviderOutcomeKinds.Ambiguous }
					: { kind: ExternalActionProviderOutcomeKinds.Failed, failureCode };
			}
		});
	}

	/** Current manual adapters cannot perform provider readback. */
	async reconcile(_recoveryKey: string): Promise<ExternalActionProviderOutcome>
	{
		return { kind: ExternalActionProviderOutcomeKinds.Ambiguous };
	}
}

/** Build the durable command consumed by server-owned provider executors. */
function _command(invocation: ExternalActionWorkerInvocation): DurableExternalActionCommand
{
	return {
		runId: invocation.runId,
		attempt: invocation.attempt,
		toolRevisionId: invocation.toolRevisionId,
		toolInvocationId: invocation.toolInvocationId,
		argumentsDigest: invocation.effectiveArgumentsDigest,
		arguments: invocation.effectiveArguments,
	};
}

/** Provider-free factory that reuses the existing integration, memory, and sandbox executors. */
export class ProductionExternalActionAdapterFactory implements ExternalActionAdapterFactory
{
	/** Concrete control-plane transports never shared with the runtime process. */
	private readonly dependencies: ProductionExternalActionAdapterDependencies;

	/** Create the factory over process-owned transports. */
	constructor(dependencies: ProductionExternalActionAdapterDependencies)
	{
		this.dependencies = dependencies;
	}

	/** Select the existing executor from durable invocation authority without contacting a provider. */
	prepare(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): PreparedExternalActionAdapter
	{
		if (__DigestCanonicalJson(invocation.effectiveArguments) !== invocation.effectiveArgumentsDigest) throw new Error("external action effective arguments failed integrity validation");
		const snapshot = context.snapshot;
		if (invocation.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION)
		{
			const personalConfiguration = this.dependencies.personalConfiguration;
			const now = this.dependencies.now;
			const command = _command(invocation);
			const executor: ExternalActionExecutor<JsonValue> = {
				async execute(): Promise<JsonValue>
				{
					return personalConfiguration.proposeUpgradeSession(command, snapshot, now().toISOString());
				},
			};
			return new _ManualPreparedExternalActionAdapter(executor, invocation);
		}
		const executor = __CreateExternalActionExecutor(_command(invocation), {
			siloId: snapshot.siloId,
			subjectId: snapshot.identitySnapshot.executionSubjectId,
			cogneeDatasetId: __PersonalMemoryDatasetId(snapshot),
			agentRevisionId: snapshot.agentRevisionId,
			...this.dependencies.transports,
		});
		return new _ManualPreparedExternalActionAdapter(executor, invocation);
	}
}
