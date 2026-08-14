import { ExternalActionRecoveryModes, __DigestCanonicalJson, type ToolInvocationClaim, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import { PersonalMemoryPermissionVerificationOutcomes } from "@opencrane/backend/agents/execution/elicitation";
import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { ___DoWithTrace, ___MarkActiveSpanFailed } from "@opencrane/backend/observability";
import { ObotMcpAuthenticationError, ObotMcpAuthorizationError, ObotMcpInvocationUnavailableError, ObotMcpToolNotAllowedError } from "@opencrane/backend/server/infra/obot-custody";
import { SandboxExecutionUnavailableError } from "@opencrane/backend/server/infra/sandbox-execution";
import { PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId, UnsupportedExternalActionError } from "./external-action-executor";
import { type DurableExternalActionCommand, type ExternalActionExecutor } from "./external-action-executor.types";
import { IntegrationAssignmentUnavailableError, IntegrationToolReturnedError, PersonalMemoryPermissionUnavailableError, PersonalMemorySafeDeliveryRequiredError } from "./external-action-errors";
import { ExternalActionProviderOutcomeKinds, type ExternalActionAdapterFactory, type ExternalActionExecutionContext, type ExternalActionProviderOutcome, type ExternalActionWorkerInvocation, type PreparedExternalActionAdapter } from "./external-action-worker.types";
import type { ProductionExternalActionAdapterDependencies } from "./production-external-action-adapter.types";

/** Failure code for an integration assignment that was revoked before anything reached the provider. */
function _integrationFailureCode(error: IntegrationAssignmentUnavailableError): string
{
	return `integration_assignment_${error.reason}`;
}

/** Return a definite failure code, but only for errors that prove no request reached the provider. Anything else returns null. */
function _provenPreDispatchFailure(error: unknown): string | null
{
	if (error instanceof IntegrationAssignmentUnavailableError) return _integrationFailureCode(error);
	if (error instanceof UnsupportedExternalActionError) return "external_action_unsupported";
	if (error instanceof PersonalMemoryPermissionUnavailableError) return "memory_permission_unavailable";
	if (error instanceof PersonalMemorySafeDeliveryRequiredError) return "safe_delivery_required";
	if (error instanceof ObotMcpToolNotAllowedError) return "integration_tool_not_allowed";
	if (error instanceof ObotMcpAuthenticationError) return "AuthenticationError";
	if (error instanceof ObotMcpAuthorizationError) return "PermissionError";
	if (error instanceof IntegrationToolReturnedError) return "RuntimeError";
	if (error instanceof ObotMcpInvocationUnavailableError) return "integration_provider_unavailable";
	if (error instanceof SandboxExecutionUnavailableError) return "sandbox_provider_unavailable";
	return null;
}

/** Provider executor that receives the exact claimed row and monotonic claim fence. */
interface ClaimBoundExternalActionExecutor
{
	/** Execute only under the claim acquired immediately before this call. */
	execute(invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<JsonValue>;
}

/** Current server transports have no provider idempotency or readback contract, so they are manual. */
class _ManualPreparedExternalActionAdapter implements PreparedExternalActionAdapter
{
	/** Always Manual: the Obot, sandbox, and memory ports cannot prove what happened after a failure. */
	readonly recoveryMode = ExternalActionRecoveryModes.Manual;
	/** One durable-command executor selected from the frozen tool revision. */
	private readonly executor: ClaimBoundExternalActionExecutor;
	/** Credential-free fields shared by provider operation spans. */
	private readonly traceFields: Readonly<Record<string, unknown>>;

	/** Create one manual adapter around an existing server-owned executor. */
	constructor(executor: ClaimBoundExternalActionExecutor, invocation: ExternalActionWorkerInvocation)
	{
		this.executor = executor;
		this.traceFields = { runId: invocation.runId, attempt: invocation.attempt, toolInvocationId: invocation.toolInvocationId, toolRevisionId: invocation.toolRevisionId, recoveryMode: invocation.recoveryMode };
	}

	/** Dispatch once; unknown exceptions stay ambiguous because a request may have left the process. */
	dispatch(_recoveryKey: string | null, invocation: ToolInvocationRecord, claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		const self = this;
		return ___DoWithTrace("external_action.provider.dispatch", this.traceFields, async function _dispatch()
		{
			try
			{
				return { kind: ExternalActionProviderOutcomeKinds.Succeeded, result: await self.executor.execute(invocation, claim) };
			}
			catch (error)
			{
				const failureCode = _provenPreDispatchFailure(error);
				___MarkActiveSpanFailed();
				return failureCode === null
					? { kind: ExternalActionProviderOutcomeKinds.Ambiguous }
					: { kind: ExternalActionProviderOutcomeKinds.Failed, failureCode };
			}
		});
	}

	/** Current manual adapters cannot perform provider readback. */
	async reconcile(_recoveryKey: string, _invocation: ToolInvocationRecord, _claim: ToolInvocationClaim): Promise<ExternalActionProviderOutcome>
	{
		return { kind: ExternalActionProviderOutcomeKinds.Ambiguous };
	}
}

/** Build the command the server-side executors take. */
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

/**
 * Builds adapters over the integration, memory, and sandbox executors, without contacting a provider.
 *
 * Every adapter it returns reports Manual recovery, because none of the current transports offers a
 * repeat-safe key or a way to read an outcome back. That is a deliberate, visible limitation: an
 * unclear outcome from any of them needs a person, and the worker enforces it by refusing to run an
 * invocation whose saved recovery mode does not match.
 *
 * Called by: `__CreateProductionExternalActionWorker` (production-external-action-worker.ts).
 *
 * @implements ExternalActionAdapterFactory
 */
export class ProductionExternalActionAdapterFactory implements ExternalActionAdapterFactory
{
	/** Server-side transports. The runtime process never gets these. */
	private readonly dependencies: ProductionExternalActionAdapterDependencies;

	/** Create the factory over process-owned transports. */
	constructor(dependencies: ProductionExternalActionAdapterDependencies)
	{
		this.dependencies = dependencies;
	}

	/**
	 * Pick the executor for this saved invocation, without contacting a provider.
	 *
	 * @param invocation - The saved invocation, whose tool revision selects the transport.
	 * @param context - The frozen snapshot supplying silo, subject, dataset, and revision.
	 * @returns An adapter that will make exactly one provider call when dispatched.
	 * @throws {Error} When the invocation's effective arguments do not hash to their saved digest.
	 * Refusing here means tampered or corrupted arguments can never reach a provider.
	 * @see https://www.rfc-editor.org/rfc/rfc8785 - RFC 8785, the canonical JSON form
	 * `__DigestCanonicalJson` hashes, for exactly which bytes that check compares.
	 */
	prepare(invocation: ExternalActionWorkerInvocation, context: ExternalActionExecutionContext): PreparedExternalActionAdapter
	{
		if (__DigestCanonicalJson(invocation.effectiveArguments) !== invocation.effectiveArgumentsDigest) throw new Error("external action effective arguments failed integrity validation");
		const snapshot = context.snapshot;
		if (invocation.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION)
		{
			const personalConfiguration = this.dependencies.personalConfiguration;
			const now = this.dependencies.now;
			const command = _command(invocation);
			const executor: ClaimBoundExternalActionExecutor = {
				async execute(_claimedInvocation, _claim): Promise<JsonValue>
				{
					return personalConfiguration.proposeUpgradeSession(command, snapshot, now().toISOString());
				},
			};
			return new _ManualPreparedExternalActionAdapter(executor, invocation);
		}
		if (invocation.toolRevisionId === PERSONAL_MEMORY_RECALL_TOOL_REVISION)
		{
			const permissions = this.dependencies.personalMemoryPermissions;
			const now = this.dependencies.now;
			const executor: ClaimBoundExternalActionExecutor = {
				async execute(claimedInvocation, claim): Promise<JsonValue>
				{
					const verified = await permissions.verifyMemoryPermission(claimedInvocation, claim, snapshot, now());
					if (verified.outcome !== PersonalMemoryPermissionVerificationOutcomes.Authorized) throw new PersonalMemoryPermissionUnavailableError();
					throw new PersonalMemorySafeDeliveryRequiredError();
				},
			};
			return new _ManualPreparedExternalActionAdapter(executor, invocation);
		}
		const executor: ExternalActionExecutor<JsonValue> = __CreateExternalActionExecutor(_command(invocation), {
			siloId: snapshot.siloId,
			subjectId: snapshot.identitySnapshot.executionSubjectId,
			cogneeDatasetId: __PersonalMemoryDatasetId(snapshot),
			agentRevisionId: snapshot.agentRevisionId,
			...this.dependencies.transports,
		});
		return new _ManualPreparedExternalActionAdapter({ execute: function _Execute() { return executor.execute(); } }, invocation);
	}
}
