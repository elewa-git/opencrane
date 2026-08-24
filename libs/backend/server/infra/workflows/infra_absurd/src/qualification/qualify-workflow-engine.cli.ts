import { __QualifyWorkflowEnginePickup } from "./workflow-engine-qualification";

/** Read a required qualification input without echoing its value. */
function _Required(name: string): string
{
	const value = process.env[name];
	if (value === undefined || value.trim().length === 0)
		throw new Error(`${name} is required.`);
	return value;
}

/** Read a numeric qualification input; the runner applies its exact bounds. */
function _Number(name: string): number
{
	return Number(_Required(name));
}

try
{
	process.stderr.write("Workflow engine qualification started.\n");
	const result = await __QualifyWorkflowEnginePickup({
		databaseUrl: _Required("DATABASE_URL"),
		siloId: _Required("OPENCRANE_WORKFLOW_ENGINE_SILO_ID"),
		pollIntervalMs: _Number("OPENCRANE_WORKFLOW_ENGINE_POLL_INTERVAL_MS"),
		sampleCount: _Number("OPENCRANE_WORKFLOW_ENGINE_SAMPLE_COUNT"),
		thresholdMs: _Number("OPENCRANE_WORKFLOW_ENGINE_THRESHOLD_MS"),
		databasePoolSize: _Number("OPENCRANE_WORKFLOW_ENGINE_DATABASE_POOL_SIZE"),
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
	if (!result.passed)
		process.exitCode = 2;
}
catch (error)
{
	process.stderr.write(`Workflow engine qualification failed (${error instanceof Error ? error.name : "unknown error"}).\n`);
	process.exitCode = 1;
}
