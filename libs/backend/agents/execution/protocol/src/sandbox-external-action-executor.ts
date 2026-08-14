import type { JsonValue } from "@opencrane/util";

import type { DurableExternalActionCommand, ExternalActionExecutorDependencies } from "./external-action-executor.types";

/**
 * Submit one admitted sandbox action through the isolated Job execution port.
 *
 * This function forwards the complete immutable candidate correlation tuple. It never chooses a
 * sandbox image, changes an argument digest, or converts an unavailable transport into a result.
 *
 * @param candidate - Admitted candidate bound to its run attempt and invocation receipt.
 * @param dependencies - Concrete sandbox execution port and silo correlation identity.
 * @returns The sandbox job's bounded output.
 */
export async function _ExecuteSandboxExternalAction(candidate: DurableExternalActionCommand, dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	const result = await dependencies.sandboxExecutor.runJob({ siloId: dependencies.siloId, runId: candidate.runId, attempt: candidate.attempt, toolRevisionId: candidate.toolRevisionId, toolInvocationId: candidate.toolInvocationId, argumentsDigest: candidate.argumentsDigest, arguments: candidate.arguments });
	return result.output;
}
