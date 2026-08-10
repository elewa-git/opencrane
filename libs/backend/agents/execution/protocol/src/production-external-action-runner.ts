import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { __DigestCanonicalJson } from "@opencrane/backend/server/iam/authorization";
import type { CompiledToolDefinition, RunInputSnapshot, RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import { __ExecuteExternalAction } from "./external-action-authority.js";
import type { ExternalActionExecutor } from "./external-action-authority.types.js";
import { __CreateExternalActionExecutor, __PersonalMemoryDatasetId } from "./external-action-executor.js";
import type { RuntimeExternalActionRunner, RuntimeExternalActionRunnerResult } from "./prisma-runtime-dispatch-authority.types.js";
import type { ProductionExternalActionRunnerDependencies } from "./production-external-action-runner.types.js";

/** Bounded lifetime of a pending deferred-tool approval before it is no longer actionable. */
const _DEFERRED_APPROVAL_TTL_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Build a production-equivalent runner over explicit authorities for focused orchestration tests. */
export function _CreateProductionExternalActionRunnerWithDependencies(dependencies: ProductionExternalActionRunnerDependencies): RuntimeExternalActionRunner
{
	return {
		async run(candidate, snapshot, compiledTools): Promise<RuntimeExternalActionRunnerResult>
		{
			return _runExternalAction(candidate, snapshot, compiledTools, dependencies);
		},
	};
}

/** Reserve, execute, and complete one candidate without letting transport state become authority. */
async function _runExternalAction(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, compiledTools: readonly CompiledToolDefinition[], dependencies: ProductionExternalActionRunnerDependencies): Promise<RuntimeExternalActionRunnerResult>
{
	// 1. Select an executor only from the compiler-issued revision and admitted identity.
	let executor: ExternalActionExecutor<JsonValue> | null;
	try
	{
		executor = _createCandidateExecutor(candidate, snapshot, dependencies);
	}
	catch (error)
	{
		return { outcome: "retryable", error };
	}
	if (executor === null) return { outcome: "denied" };

	// 2. Reserve before I/O; only proven terminal post-reservation outcomes become denials.
	const approvalRequired = _approvalRequired(candidate, compiledTools);
	const result = await __ExecuteExternalAction(dependencies.invocations, { candidate, snapshot, compiledTools, approvalRequired }, executor, dependencies.log);
	if (result.outcome === "denied") return { outcome: "denied" };

	// 3. Open approval only for the exact deferred reservation; every other success is complete.
	if (result.outcome !== "deferred") return { outcome: "completed" };
	return _openDeferredApproval(candidate, snapshot, compiledTools, result.reservationId, dependencies);
}

/** Select the first-party upgrade executor or the transport router admitted by the snapshot. */
function _createCandidateExecutor(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, dependencies: ProductionExternalActionRunnerDependencies): ExternalActionExecutor<JsonValue> | null
{
	if (candidate.toolRevisionId === UPGRADE_SESSION_TOOL_REVISION)
	{
		if (snapshot.identitySnapshot.kind !== "user") return null;
		return {
			execute(): Promise<JsonValue>
			{
				return dependencies.personalConfiguration.proposeUpgradeSession(candidate, snapshot, dependencies.clock.now().toISOString());
			},
		};
	}
	return __CreateExternalActionExecutor(candidate, {
		siloId: snapshot.siloId,
		subjectId: snapshot.identitySnapshot.executionSubjectId,
		cogneeDatasetId: __PersonalMemoryDatasetId(snapshot),
		agentRevisionId: snapshot.agentRevisionId,
		...dependencies.transports,
	});
}

/** Derive approval policy only from the exact compiler-issued tool descriptor. */
function _approvalRequired(candidate: RuntimeExternalActionCandidate, compiledTools: readonly CompiledToolDefinition[]): boolean
{
	return compiledTools.find(function _match(definition) { return definition.toolRevisionId === candidate.toolRevisionId; })?.requiresApproval ?? false;
}

/** Open the deferred approval with one trusted instant shared by creation and expiry. */
async function _openDeferredApproval(candidate: RuntimeExternalActionCandidate, snapshot: RunInputSnapshot, compiledTools: readonly CompiledToolDefinition[], reservationId: string, dependencies: ProductionExternalActionRunnerDependencies): Promise<RuntimeExternalActionRunnerResult>
{
	const now = dependencies.clock.now();
	const tool = compiledTools.find(function _Match(definition) { return definition.toolRevisionId === candidate.toolRevisionId; });
	if (tool === undefined) return { outcome: "denied" };
	const opened = await dependencies.approvals.open({
		interruptId: __DigestCanonicalJson({ runId: candidate.runId, attempt: candidate.attempt, candidateId: candidate.candidateId, toolInvocationId: candidate.toolInvocationId }),
		runId: candidate.runId,
		attempt: candidate.attempt,
		toolInvocationId: candidate.toolInvocationId,
		toolRevisionId: candidate.toolRevisionId,
		arguments: candidate.arguments,
		argumentsDigest: candidate.argumentsDigest,
		parametersSchema: tool.parametersSchema,
		capabilitySetDigest: snapshot.capabilitySetDigest,
		reservationId,
		now,
		expiresAt: new Date(now.getTime() + _DEFERRED_APPROVAL_TTL_MILLISECONDS),
	});
	return { outcome: opened ? "completed" : "denied" };
}
