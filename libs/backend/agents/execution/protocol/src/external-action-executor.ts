import { RunInputSnapshotIdentityKinds, type RunInputSnapshot, type RuntimeExternalActionCandidate } from "@opencrane/contracts";
import type { JsonValue } from "@opencrane/util";

import type { ExternalActionExecutor } from "./external-action-authority.types.js";
import { ExternalActionRevisionKinds, type ExternalActionExecutorDependencies } from "./external-action-executor.types.js";
import { _ExecuteIntegrationExternalAction, UnsupportedExternalActionError } from "./integration-external-action-executor.js";
import { _ExecuteMemoryExternalAction, MemoryScopeUnavailableError } from "./memory-external-action-executor.js";
import { _ExecuteSandboxExternalAction } from "./sandbox-external-action-executor.js";

export { UnsupportedExternalActionError } from "./integration-external-action-executor.js";
export { MemoryScopeUnavailableError } from "./memory-external-action-executor.js";

/**
 * Select the personal Cognee dataset frozen into an admitted snapshot.
 *
 * Runtime arguments and subject identifiers are deliberately ignored: memory recall is available
 * only when admission sealed a non-empty dataset under a personal memory policy for a user identity.
 *
 * @param snapshot - Immutable run input snapshot admitted by the control plane.
 * @returns The frozen dataset identifier, or null for every non-personal or malformed policy.
 */
export function __PersonalMemoryDatasetId(snapshot: RunInputSnapshot): string | null
{
	if (snapshot.identitySnapshot.kind !== RunInputSnapshotIdentityKinds.User) return null;
	const policy = snapshot.memoryQueryPolicy;
	if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return null;
	const record = policy as Readonly<Record<string, unknown>>;
	if (record["scope"] !== "personal") return null;
	const candidate = record["cogneeDatasetId"];
	return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}

/**
 * Build the concrete external-action executor for one admitted candidate, in the composition root.
 *
 * The factory owns transport selection only. Each selected executor owns its single external seam:
 * the integration executor rechecks live custody through Obot, the sandbox executor submits the
 * immutable invocation tuple, and the memory executor uses only the snapshot-frozen dataset. All
 * unavailable transports and unknown revision kinds throw so `__ExecuteExternalAction` records the
 * reserved invocation as failed instead of fabricating a successful result.
 *
 * @param candidate - Runtime external-action candidate whose tool revision selects the transport.
 * @param dependencies - Injected concrete transports and correlation identity.
 * @returns An executor whose `execute` performs exactly one routed, fail-closed tool call.
 */
export function __CreateExternalActionExecutor(candidate: RuntimeExternalActionCandidate, dependencies: ExternalActionExecutorDependencies): ExternalActionExecutor<JsonValue>
{
	return {
		async execute(): Promise<JsonValue>
		{
			const toolRevisionId = candidate.toolRevisionId;
			if (toolRevisionId.startsWith(`${ExternalActionRevisionKinds.Integration}:`)) return _ExecuteIntegrationExternalAction(candidate, dependencies);
			if (toolRevisionId.startsWith(`${ExternalActionRevisionKinds.Sandbox}:`)) return _ExecuteSandboxExternalAction(candidate, dependencies);
			if (toolRevisionId.startsWith(`${ExternalActionRevisionKinds.Memory}:`)) return _ExecuteMemoryExternalAction(candidate, dependencies);
			throw new UnsupportedExternalActionError(toolRevisionId);
		},
	};
}
