import type { JsonValue } from "@opencrane/util";

import type { DurableExternalActionCommand, ExternalActionExecutorDependencies } from "./external-action-executor.types.js";
import { PersonalMemorySafeDeliveryRequiredError } from "./external-action-errors.js";

/**
 * Refuse generic personal-memory delivery until the transient safe path owns recalled content.
 *
 * The production adapter verifies an exact elicitation receipt before this boundary. This generic
 * executor still never calls Cognee or returns fact content because ordinary tool completion would
 * persist that content in ToolInvocation and its runtime delivery outbox.
 *
 * @param _candidate - Exact admitted command retained only for the common executor signature.
 * @param _dependencies - Server transports that this fail-closed boundary deliberately never uses.
 * @throws {PersonalMemorySafeDeliveryRequiredError} Always, before any personal-memory request.
 */
export async function _ExecuteMemoryExternalAction(_candidate: DurableExternalActionCommand, _dependencies: ExternalActionExecutorDependencies): Promise<JsonValue>
{
	throw new PersonalMemorySafeDeliveryRequiredError();
}
