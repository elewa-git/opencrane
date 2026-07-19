import { __ReconcileAgentJob } from "@opencrane/backend/agent-controller";
import type { AgentControllerDependencies } from "@opencrane/backend/agent-controller";

import type { ControllerLoopLogger, ControllerReadiness } from "./controller-loop.types.js";

/** Runs one bounded reconciliation and reflects its full authority outcome in readiness. */
export async function _ReconcileOnce(dependencies: AgentControllerDependencies, readiness: ControllerReadiness, log: ControllerLoopLogger): Promise<void>
{
	try
	{
		const result = await __ReconcileAgentJob(dependencies);
		await dependencies.jobs.check(dependencies.policy.runtimeNamespace);
		readiness.markReady();
		if (result.outcome !== "idle") log.info({ outcome: result.outcome, runId: result.runId, attempt: result.attempt }, "agent Job reconciliation completed");
	}
	catch (err)
	{
		readiness.markUnready();
		log.warn({ err }, "agent Job reconciliation failed; will retry");
	}
}
