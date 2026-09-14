import { WorkflowError } from "@opencrane/backend/server/infra/workflows/contract";

import type { IAbsurdWorkflowEngineOptions } from "./absurd-workflow-engine.types";

/** Rejects an empty name before it becomes a persisted queue, event, or task identity. */
export function _RequiredString(name: string, value: string): string
{
	if (value.trim().length === 0)
	{
		throw new WorkflowError(`${name} must be a non-empty string.`);
	}
	return value;
}

/** Rejects an invalid shared-pool limit before the engine creates database connections. */
function _databasePoolSize(value: number): number
{
	if (!Number.isSafeInteger(value) || value < 1)
	{
		throw new WorkflowError("databasePoolSize must be a positive integer.");
	}
	return value;
}

/** Validates the positive lease duration used before an uncached checkpoint effect. */
function _checkpointOperationLeaseSeconds(value: number | undefined): number
{
	if (value === undefined)
		return 120;
	if (!Number.isSafeInteger(value) || value < 1)
		throw new WorkflowError("checkpointOperationLeaseSeconds must be a finite positive integer.");
	return value;
}

/** Validates and normalizes engine options before SDK clients or pools are created. */
export function _ValidateAbsurdWorkflowEngineOptions(options: IAbsurdWorkflowEngineOptions): IAbsurdWorkflowEngineOptions
{
	return { ...options, databaseUrl: _RequiredString("databaseUrl", options.databaseUrl), databasePoolSize: _databasePoolSize(options.databasePoolSize), checkpointOperationLeaseSeconds: _checkpointOperationLeaseSeconds(options.checkpointOperationLeaseSeconds) };
}
