import { AgentRunTaskDeclaration } from "@opencrane/backend/agents/execution/runs/workflows/contract";
import { __CreateWorkflowGuard, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/guard";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";

import { _log } from "../app/log";
import type { DevelopmentWorkflowComposition } from "./workflow.types";

/**
 * Compose durable Tier 2 task admission without enabling Kubernetes or MCP service routes.
 *
 * The server declares controller-owned tasks while the local controller registers their handlers
 * against the same PostgreSQL database and queues. Called by: the Tier 2 development entrypoint.
 */
export function _CreateDevelopmentWorkflowComposition(databaseUrl: string, siloId: string): DevelopmentWorkflowComposition
{
	const queueAuthority = __CreateWorkflowTaskQueueAuthority([
		{ taskName: AgentRunTaskDeclaration.taskName, queue: "agent-runs" },
	]);
	const runtime = _CreateAbsurdWorkflowEngine({
		databasePoolSize: 2,
		databaseUrl,
		log: _log,
		pollIntervalMs: 100,
		queueAuthority,
		workerConcurrency: 2,
	});
	const execution = __CreateWorkflowGuard({ execution: runtime, log: _log, queueAuthority, siloId });
	execution.declare(AgentRunTaskDeclaration);
	return { execution, runtime };
}
