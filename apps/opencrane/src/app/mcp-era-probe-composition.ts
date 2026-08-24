import type { PrismaClient } from "@prisma/client";

import { __CreateMcpEraProbeWorkflow, MCP_ERA_PROTOCOL_VERSION, McpEraProbeFailure, McpEraProbeFailureCodes, McpEraProbeTaskNames, PrismaMcpOperatorUnitOfWork } from "@opencrane/backend/server/gateways/mcp";
import type { McpEraProbeClient } from "@opencrane/backend/server/gateways/mcp";
import { __CreateHttpsMcpEraProbeClient, McpEraProbeConfigurationError, McpEraProbeProtocolError, McpEraProbeTransportError } from "@opencrane/backend/server/infra/mcp-era-probe";
import { _CreateAbsurdDurableExecution } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import { __CreateWorkflowKit, __CreateWorkflowTaskQueueAuthority } from "@opencrane/backend/server/infra/workflows/kit";

import type { OpenCraneWorkflowConfig } from "./config.types";
import { _log } from "./log";
import type { McpEraProbeComposition } from "./mcp-era-probe-composition.types";

/** Translate infrastructure failures into the bounded outcomes owned by the MCP domain. */
export function _McpEraProbeFailure(error: unknown): McpEraProbeFailure
{
	if (error instanceof McpEraProbeConfigurationError) return new McpEraProbeFailure(McpEraProbeFailureCodes.UnsafeEndpoint);
	if (error instanceof McpEraProbeProtocolError) return new McpEraProbeFailure(McpEraProbeFailureCodes.InvalidResponse);
	if (error instanceof McpEraProbeTransportError)
	{
		const status = error.code.startsWith("http_") ? Number(error.code.slice(5)) : null;
		if (error.code === "network" || error.code === "timeout" || status === 429 || (status !== null && status >= 500)) return new McpEraProbeFailure(McpEraProbeFailureCodes.RetryableUnavailable);
		return new McpEraProbeFailure(McpEraProbeFailureCodes.InvalidResponse);
	}
	throw error;
}

/** Compose one Absurd engine, guarded workflow API, and direct HTTPS MCP protocol checker. */
export function _CreateMcpEraProbeComposition(prisma: PrismaClient, config: OpenCraneWorkflowConfig): McpEraProbeComposition
{
	const queueAuthority = __CreateWorkflowTaskQueueAuthority([
		{ taskName: McpEraProbeTaskNames.Probe, queue: "control-plane" },
	]);
	const runtime = _CreateAbsurdDurableExecution({
		databasePoolSize: config.databasePoolSize,
		databaseUrl: config.databaseUrl,
		log: _log,
		pollIntervalMs: config.pollIntervalMilliseconds,
		queueAuthority,
		workerConcurrency: config.workerConcurrency,
	});
	const execution = __CreateWorkflowKit({ execution: runtime, log: _log, queueAuthority, siloId: config.siloId });
	const transport = __CreateHttpsMcpEraProbeClient({ protocolVersion: MCP_ERA_PROTOCOL_VERSION, maximumResponseBytes: config.mcpEraProbeMaximumResponseBytes, requestTimeoutMilliseconds: config.mcpEraProbeTimeoutMilliseconds });
	const probe: McpEraProbeClient = {
		async probe(request)
		{
			try { return await transport.probe(request); }
			catch (error) { throw _McpEraProbeFailure(error); }
		},
	};
	const unitOfWork = new PrismaMcpOperatorUnitOfWork(prisma);
	const workflow = __CreateMcpEraProbeWorkflow({ execution, probe, unitOfWork });
	return { runtime, unitOfWork, workflow };
}
